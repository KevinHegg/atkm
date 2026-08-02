import {
  Hand,
  History,
  Maximize2,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  Radio,
  RotateCcw,
  ScanSearch,
  Volume2,
  VolumeX,
  Wrench,
  createElement as createLucideElement,
} from "lucide";
import type {
  ClientCommand,
  ReplayBundle,
  ReplayManifestEntry,
  PuzzleSnapEvent,
  PuzzleSnapPreview,
  ServerSnapshot,
  SoundCue,
  SpeechLine,
  Team,
  TransformState,
} from "../shared/protocol.js";
// The query version prevents stale browser module graphs from mixing builds.
// @ts-expect-error TypeScript does not resolve Vite query-suffixed modules.
import { PhysicalWorld as VersionedPhysicalWorld } from "./world3d.js?build=20260801-repair-4";
const PhysicalWorld: typeof import("./world3d.js").PhysicalWorld =
  VersionedPhysicalWorld;
type PhysicalWorldInstance = import("./world3d.js").PhysicalWorld;

const SPEECH_MS = 6400;
const BUBBLE_REST_MS = 1400;
navigator.serviceWorker
  ?.getRegistrations()
  .then((registrations) =>
    Promise.all(registrations.map((registration) => registration.unregister())),
  )
  .catch(() => undefined);
const stageElement = required<HTMLElement>("stage");
const stageShell = required<HTMLElement>("stage-shell");
const transcript = required<HTMLOListElement>("transcript");
const elapsedValue = required<HTMLElement>("elapsed-value");
const heightValue = required<HTMLElement>("height-value");
const integrityValue = required<HTMLElement>("integrity-value");
const integrityFill = required<HTMLElement>("integrity-fill");
const kingDeaths = required<HTMLElement>("king-deaths");
const queenDeaths = required<HTMLElement>("queen-deaths");
const collapsedElapsed = required<HTMLElement>("collapsed-elapsed");
const sidebarToggle = required<HTMLButtonElement>("sidebar-toggle");
const seedLabel = required<HTMLElement>("seed-label");
const buildLabel = document.getElementById("build-label");
const agentStrip = required<HTMLElement>("agent-strip");
const constructionCues = required<HTMLElement>("construction-cues");
const endCard = required<HTMLElement>("end-card");
const endTitle = required<HTMLElement>("end-title");
const endCopy = required<HTMLElement>("end-copy");
const zoomReadout = required<HTMLElement>("zoom-readout");
const replayControls = required<HTMLElement>("replay-controls");
const replayScrubber = required<HTMLInputElement>("replay-scrubber");
const replaySpeed = required<HTMLSelectElement>("replay-speed");
const replayTime = required<HTMLOutputElement>("replay-time");
const replayLive = required<HTMLButtonElement>("replay-live");
const engineeringOverlay = required<HTMLElement>("engineering-overlay");
const engineeringChecksum = required<HTMLOutputElement>("engineering-checksum");
const engineeringSummary = required<HTMLElement>("engineering-summary");
const engineeringList = required<HTMLOListElement>("engineering-list");

let latest: ServerSnapshot | undefined;
let latestLive: ServerSnapshot | undefined;
let socket: WebSocket;
let reconnectTimer = 0;
let connectionWatchdog = 0;
let polling = false;
let pollTimer = 0;
let pauseRequested = false;
let audioEnabled = false;
let sidebarCollapsed = false;
let replayActive = false;
let replayPaused = false;
let replayBundle: ReplayBundle | undefined;
let replayClock = 0;
let replayCursor = 0;
let replayLastWall = 0;
let replayAnimation = 0;
let engineeringEnabled = false;
const seenSpeech = new Set<string>();
const seenSoundCues = new Set<number>();
const bubbles = new Map<string, HTMLElement>();
const bubbleTimers = new Map<string, number>();
const bubbleRestUntil = new Map<string, number>();
let audio: WorksiteAudio;
let world: PhysicalWorldInstance;

function required<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

function formatElapsed(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  return `${String(minutes).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

function teamCss(team: Team): string {
  return team === "king" ? "king" : team === "queen" ? "queen" : "humpty";
}

function connect(): void {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  stageElement.dataset.connection = "connecting";
  delete stageElement.dataset.connectionError;
  try {
    socket = new WebSocket(`${protocol}//${location.host}/ws`);
  } catch {
    startPolling();
    return;
  }
  connectionWatchdog = window.setTimeout(() => {
    if (socket.readyState !== WebSocket.OPEN) startPolling();
  }, 1200);
  socket.addEventListener("open", () => {
    window.clearTimeout(connectionWatchdog);
    stopPolling();
    stageElement.dataset.connection = "open";
    document.body.classList.remove("disconnected");
  });
  socket.addEventListener("message", (event) => {
    try {
      const payload = JSON.parse(String(event.data)) as ServerSnapshot;
      stageElement.dataset.connection = "receiving";
      if (payload.type === "snapshot") acceptSnapshot(payload);
    } catch (error) {
      stageElement.dataset.connection = "fault";
      stageElement.dataset.connectionError =
        error instanceof Error ? error.message : String(error);
      console.error("Unable to render simulation snapshot", error);
    }
  });
  socket.addEventListener("error", () => {
    stageElement.dataset.connection = "error";
    startPolling();
  });
  socket.addEventListener("close", () => {
    window.clearTimeout(connectionWatchdog);
    stageElement.dataset.connection = "closed";
    document.body.classList.add("disconnected");
    startPolling();
    reconnectTimer = window.setTimeout(connect, 1000);
  });
}

function startPolling(): void {
  if (polling) return;
  polling = true;
  document.body.classList.remove("disconnected");
  void pollSnapshot();
}

function stopPolling(): void {
  polling = false;
  window.clearTimeout(pollTimer);
}

async function pollSnapshot(): Promise<void> {
  if (!polling) return;
  try {
    const response = await fetch(`/snapshot?at=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Snapshot request failed: ${response.status}`);
    const snapshot = (await response.json()) as ServerSnapshot;
    stageElement.dataset.connection = "receiving";
    delete stageElement.dataset.connectionError;
    document.body.classList.remove("disconnected");
    acceptSnapshot(snapshot);
  } catch (error) {
    stageElement.dataset.connection = "poll-error";
    stageElement.dataset.connectionError =
      error instanceof Error ? error.message : String(error);
  } finally {
    if (polling) {
      pollTimer = window.setTimeout(() => void pollSnapshot(), 125);
    }
  }
}

function send(command: ClientCommand): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(command));
    return;
  }
  void fetch("/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
  }).catch(() => undefined);
}

function acceptSnapshot(snapshot: ServerSnapshot): void {
  latestLive = snapshot;
  if (replayActive) return;
  renderSnapshot(snapshot);
}

function renderSnapshot(snapshot: ServerSnapshot): void {
  latest = snapshot;
  updateHud(snapshot);
  updateAgents(snapshot);
  ingestSpeech(snapshot.speech);
  for (const cue of snapshot.soundCues) {
    if (seenSoundCues.has(cue.id)) continue;
    seenSoundCues.add(cue.id);
    if (audioEnabled) audio.cue(cue);
  }
  world.acceptSnapshot(snapshot);
  updateConstructionCues(snapshot);
  updateEngineeringOverlay(snapshot);
}

function updateEngineeringOverlay(snapshot: ServerSnapshot): void {
  if (!engineeringEnabled) return;
  engineeringChecksum.textContent = `tick ${snapshot.simulationTick} / ${snapshot.stateChecksum}`;
  const diagnostics = snapshot.physicsDiagnostics;
  const parts = snapshot.entities.filter((entity) => entity.puzzleKind);
  const states = new Map<string, number>();
  for (const part of parts) {
    const state = part.lifecycleState ?? "stored";
    states.set(state, (states.get(state) ?? 0) + 1);
  }
  const connections = new Map<
    string,
    { state: string; integrity: number; load: number; parts: string[] }
  >();
  for (const part of parts) {
    for (const port of part.snapPorts ?? []) {
      if (!port.connectionId || connections.has(port.connectionId)) continue;
      connections.set(port.connectionId, {
        state: port.connectionState ?? "unknown",
        integrity: port.connectionIntegrity ?? 0,
        load: port.connectionLoad ?? 0,
        parts: [part.id, ...(port.occupiedBy ? [port.occupiedBy] : [])],
      });
    }
  }
  engineeringSummary.replaceChildren();
  const inventorySummary = document.createElement("div");
  inventorySummary.textContent = `${parts.length} parts | ${connections.size} joints | ${[...states]
    .map(([state, count]) => `${state} ${count}`)
    .join(" | ")}`;
  engineeringSummary.append(inventorySummary);
  if (diagnostics) {
    const physicsSummary = document.createElement("div");
    physicsSummary.className = "physics-diagnostics";
    physicsSummary.textContent = [
      `fixed ${diagnostics.fixedTick}`,
      `dynamic ${diagnostics.dynamicBodyCount}`,
      `constraints ${diagnostics.activeConstraintCount}`,
      `worker penetration ${diagnostics.workerPenetration}`,
      `deep penetration ${diagnostics.deepBodyPenetrations}`,
      `transform writes ${diagnostics.illegalTransformWrites}`,
      `late inventory ${diagnostics.spawnedAfterStartInventory}`,
      `Humpty contacts ${diagnostics.humptySupportContacts}`,
      `tower contacts ${diagnostics.towerContactCount}`,
      diagnostics.currentPartLifecycle,
    ].join(" | ");
    if ((diagnostics.workerPenetrationDetails?.length ?? 0) > 0) {
      physicsSummary.textContent += ` | ${diagnostics.workerPenetrationDetails!.join(" | ")}`;
    }
    physicsSummary.classList.toggle(
      "warning",
      diagnostics.workerPenetration > 0 ||
        diagnostics.deepBodyPenetrations > 0 ||
        diagnostics.illegalTransformWrites > 0 ||
        diagnostics.spawnedAfterStartInventory > 0,
    );
    engineeringSummary.append(physicsSummary);
  }
  const rows = [...connections]
    .sort((a, b) => b[1].load - a[1].load)
    .slice(0, 8)
    .map(([id, connection]) => {
      const item = document.createElement("li");
      const loadClass = connection.state === "failed" || connection.state === "yielding";
      item.classList.toggle("warning", loadClass);
      item.textContent = `${id} ${connection.state} load ${connection.load} integrity ${Math.round(
        connection.integrity * 100,
      )}%`;
      return item;
    });
  engineeringList.replaceChildren(...rows);
}

function toggleEngineering(): void {
  engineeringEnabled = !engineeringEnabled;
  engineeringOverlay.hidden = !engineeringEnabled;
  world.setEngineeringOverlay(engineeringEnabled);
  const button = document.querySelector<HTMLButtonElement>(
    '[data-command="engineering"]',
  );
  button?.classList.toggle("active", engineeringEnabled);
  if (button) {
    button.ariaLabel = engineeringEnabled
      ? "Hide engineering overlay"
      : "Show engineering overlay";
  }
  if (latest) updateEngineeringOverlay(latest);
}

function updateConstructionCues(snapshot: ServerSnapshot): void {
  const active = (snapshot.snapPreviews ?? []).filter(
    (preview) => preview.phase === "carry" || preview.phase === "snap",
  );
  const recent = (snapshot.snapEvents ?? []).filter(
    (event) => snapshot.elapsed - event.at < 4.2,
  );
  const selected: Array<
    | { kind: "active"; preview: PuzzleSnapPreview }
    | { kind: "complete"; event: PuzzleSnapEvent }
  > = [];
  for (const team of ["king", "queen"] as const) {
    const preview = active
      .filter((candidate) => candidate.team === team)
      .sort((first, second) => second.progress - first.progress)[0];
    if (preview) {
      selected.push({ kind: "active", preview });
      continue;
    }
    const event = recent
      .filter((candidate) => candidate.team === team)
      .sort((first, second) => second.at - first.at)[0];
    if (event) selected.push({ kind: "complete", event });
  }

  const fragment = document.createDocumentFragment();
  for (const item of selected) {
    const detail = item.kind === "active" ? item.preview : item.event;
    const anchor = world.puzzleAnchor(detail.targetId);
    if (!anchor) continue;
    const point = world.projectToStage(anchor, 1.15);
    if (!point.visible) continue;
    const gained = detail.gainedCapabilities;
    const abilities =
      gained.length > 0
        ? `adds ${gained.slice(0, 2).join(" + ")}`
        : `keeps ${detail.resultCapabilities.slice(-2).join(" + ")}`;
    const cue = document.createElement("div");
    cue.className = `construction-cue ${detail.team} ${item.kind}`;
    cue.style.left = `${
      stageShell.clientWidth * (detail.team === "king" ? 0.29 : 0.71)
    }px`;
    cue.style.top = `${stageShell.clientHeight - 18}px`;
    const action = document.createElement("small");
    action.textContent =
      item.kind === "complete"
        ? `${detail.movingPortKind} locked into ${detail.targetPortKind}`
        : item.preview.phase === "snap"
          ? `${detail.movingPortKind} aligning with ${detail.targetPortKind}`
          : `carrying ${detail.movingPortKind} toward ${detail.targetPortKind}`;
    const join = document.createElement("strong");
    join.textContent = `${detail.movingLabel} → ${detail.targetLabel}`;
    const result = document.createElement("span");
    result.textContent = abilities;
    cue.append(action, join, result);
    fragment.append(cue);
  }
  constructionCues.replaceChildren(fragment);
}

function mixNumber(first: number, second: number, amount: number): number {
  return first + (second - first) * amount;
}

function mixOptional(
  first: number | undefined,
  second: number | undefined,
  amount: number,
): number | undefined {
  if (first === undefined && second === undefined) return undefined;
  return mixNumber(first ?? second ?? 0, second ?? first ?? 0, amount);
}

function interpolateEntity(
  first: TransformState,
  second: TransformState,
  amount: number,
): TransformState {
  const base = amount < 0.5 ? first : second;
  const vx = mixOptional(first.vx, second.vx, amount);
  const vy = mixOptional(first.vy, second.vy, amount);
  const stress = mixOptional(first.stress, second.stress, amount);
  const integrity = mixOptional(first.integrity, second.integrity, amount);
  const taskProgress = mixOptional(
    first.taskProgress,
    second.taskProgress,
    amount,
  );
  const puzzleDepth = mixOptional(
    first.puzzleDepth,
    second.puzzleDepth,
    amount,
  );
  const fromX = mixOptional(first.fromX, second.fromX, amount);
  const fromY = mixOptional(first.fromY, second.fromY, amount);
  const toX = mixOptional(first.toX, second.toX, amount);
  const toY = mixOptional(first.toY, second.toY, amount);
  return {
    ...base,
    x: mixNumber(first.x, second.x, amount),
    y: mixNumber(first.y, second.y, amount),
    angle: mixNumber(first.angle, second.angle, amount),
    ...(vx !== undefined ? { vx } : {}),
    ...(vy !== undefined ? { vy } : {}),
    ...(stress !== undefined ? { stress } : {}),
    ...(integrity !== undefined ? { integrity } : {}),
    ...(taskProgress !== undefined ? { taskProgress } : {}),
    ...(puzzleDepth !== undefined ? { puzzleDepth } : {}),
    ...(fromX !== undefined ? { fromX } : {}),
    ...(fromY !== undefined ? { fromY } : {}),
    ...(toX !== undefined ? { toX } : {}),
    ...(toY !== undefined ? { toY } : {}),
  };
}

function interpolateSnapshot(
  first: ServerSnapshot,
  second: ServerSnapshot,
  amount: number,
  elapsed: number,
): ServerSnapshot {
  const secondById = new Map(second.entities.map((entity) => [entity.id, entity]));
  const firstIds = new Set(first.entities.map((entity) => entity.id));
  const entities = first.entities.map((entity) => {
    const later = secondById.get(entity.id);
    return later ? interpolateEntity(entity, later, amount) : entity;
  });
  if (amount >= 0.5) {
    entities.push(...second.entities.filter((entity) => !firstIds.has(entity.id)));
  }
  const base = amount < 0.999 ? first : second;
  return {
    ...base,
    elapsed,
    entities,
    speech: second.speech.filter((line) => line.elapsed <= elapsed),
    soundCues: [],
    humptyHeight: mixNumber(
      first.humptyHeight,
      second.humptyHeight,
      amount,
    ),
    humptyIntegrity: mixNumber(
      first.humptyIntegrity,
      second.humptyIntegrity,
      amount,
    ),
    aggregateStress: mixNumber(
      first.aggregateStress,
      second.aggregateStress,
      amount,
    ),
  };
}

function replaySnapshotAt(seconds: number): ServerSnapshot | undefined {
  const frames = replayBundle?.frames;
  if (!frames?.length) return undefined;
  while (
    replayCursor < frames.length - 2 &&
    frames[replayCursor + 1]!.elapsed <= seconds
  ) {
    replayCursor += 1;
  }
  while (replayCursor > 0 && frames[replayCursor]!.elapsed > seconds) {
    replayCursor -= 1;
  }
  const first = frames[replayCursor]!;
  const second = frames[Math.min(frames.length - 1, replayCursor + 1)]!;
  const span = Math.max(0.001, second.elapsed - first.elapsed);
  const amount = Math.max(0, Math.min(1, (seconds - first.elapsed) / span));
  return interpolateSnapshot(first, second, amount, seconds);
}

function clearReplayRecord(): void {
  seenSpeech.clear();
  seenSoundCues.clear();
  transcript.replaceChildren();
  for (const timer of bubbleTimers.values()) window.clearTimeout(timer);
  bubbleTimers.clear();
  bubbles.forEach((bubble) => bubble.remove());
  bubbles.clear();
  bubbleRestUntil.clear();
}

function updatePauseButton(paused: boolean): void {
  const button = document.querySelector<HTMLButtonElement>(
    '[data-command="pause"]',
  );
  if (!button) return;
  renderIcon(button, paused ? "play" : "pause");
  button.ariaLabel = paused ? "Resume performance" : "Pause performance";
}

function renderReplayAt(seconds: number, rebuildRecord = false): void {
  const duration = replayBundle?.frames.at(-1)?.elapsed ?? 0;
  replayClock = Math.max(0, Math.min(duration, seconds));
  if (rebuildRecord) {
    replayCursor = 0;
    clearReplayRecord();
  }
  const snapshot = replaySnapshotAt(replayClock);
  if (!snapshot) return;
  renderSnapshot(snapshot);
  replayScrubber.value = String(replayClock);
  replayTime.textContent = `${formatElapsed(replayClock)} / ${formatElapsed(duration)}`;
}

function advanceReplay(wallTime: number): void {
  if (!replayActive) return;
  const duration = replayBundle?.frames.at(-1)?.elapsed ?? 0;
  if (!replayPaused) {
    const delta = Math.min(0.25, (wallTime - replayLastWall) / 1000);
    replayClock += delta * Number(replaySpeed.value);
    if (replayClock >= duration) {
      replayClock = duration;
      replayPaused = true;
      updatePauseButton(true);
    }
  }
  replayLastWall = wallTime;
  renderReplayAt(replayClock);
  replayAnimation = requestAnimationFrame(advanceReplay);
}

async function beginReplay(): Promise<void> {
  const manifestResponse = await fetch("/replays", { cache: "no-store" });
  if (!manifestResponse.ok) return;
  const manifest = (await manifestResponse.json()) as ReplayManifestEntry[];
  const candidate =
    manifest.find(
      (entry) => !entry.current && entry.winner && entry.frameCount > 1,
    ) ??
    manifest.find((entry) => !entry.current && entry.frameCount > 1) ??
    manifest.find((entry) => entry.frameCount > 1);
  if (!candidate) return;
  const url = new URL(location.href);
  url.searchParams.set("replay", candidate.runId);
  location.href = url.toString();
}

async function loadReplay(runId: string): Promise<void> {
  try {
    const replayResponse = await fetch(
      `/replays/${encodeURIComponent(runId)}`,
      { cache: "no-store" },
    );
    if (!replayResponse.ok) throw new Error("Replay not found");
    replayBundle = (await replayResponse.json()) as ReplayBundle;
    if (replayBundle.frames.length < 2) {
      throw new Error("Replay has too few frames");
    }
  } catch {
    const url = new URL(location.href);
    url.searchParams.delete("replay");
    location.replace(url.toString());
    return;
  }
  replayActive = true;
  replayPaused = false;
  replayClock = replayBundle.frames[0]?.elapsed ?? 0;
  replayCursor = 0;
  replayLastWall = performance.now();
  replayScrubber.min = String(replayClock);
  replayScrubber.max = String(replayBundle.frames.at(-1)?.elapsed ?? replayClock);
  replayControls.hidden = false;
  document
    .querySelector<HTMLButtonElement>('[data-command="replay"]')
    ?.classList.add("active");
  clearReplayRecord();
  world.setPaused(false);
  updatePauseButton(false);
  renderReplayAt(replayClock);
  cancelAnimationFrame(replayAnimation);
  replayAnimation = requestAnimationFrame(advanceReplay);
}

function exitReplay(): void {
  if (!replayActive) return;
  const url = new URL(location.href);
  if (url.searchParams.has("replay")) {
    url.searchParams.delete("replay");
    location.href = url.toString();
    return;
  }
  replayActive = false;
  replayPaused = false;
  replayBundle = undefined;
  cancelAnimationFrame(replayAnimation);
  replayControls.hidden = true;
  document
    .querySelector<HTMLButtonElement>('[data-command="replay"]')
    ?.classList.remove("active");
  clearReplayRecord();
  world.setPaused(pauseRequested);
  updatePauseButton(pauseRequested);
  if (latestLive) renderSnapshot(latestLive);
}

function updateHud(snapshot: ServerSnapshot): void {
  const elapsed = formatElapsed(snapshot.elapsed);
  elapsedValue.textContent = elapsed;
  collapsedElapsed.textContent = elapsed;
  heightValue.textContent = String(Math.max(0, Math.round(snapshot.humptyHeight)));
  integrityValue.textContent = String(
    Math.max(0, Math.round(snapshot.humptyIntegrity)),
  );
  integrityFill.style.width = `${Math.max(0, snapshot.humptyIntegrity)}%`;
  integrityFill.classList.toggle("damaged", snapshot.humptyIntegrity < 65);
  kingDeaths.textContent = String(snapshot.deaths.king);
  queenDeaths.textContent = String(snapshot.deaths.queen);
  seedLabel.textContent = `Seed ${snapshot.seed}`;
  zoomReadout.textContent = world.getFollow() ? "Follow" : "Free camera";
  if (snapshot.winner) {
    endCard.hidden = false;
    endTitle.textContent =
      snapshot.winner === "king"
        ? "The Egg King Is Safe"
        : snapshot.winner === "queen"
          ? "The Shell Is Lost"
          : "No Verdict";
    endCopy.textContent = snapshot.outcome ?? "";
  } else {
    endCard.hidden = true;
  }
}

function updateAgents(snapshot: ServerSnapshot): void {
  if (agentStrip.childElementCount === 0) {
    for (const agent of snapshot.agents) {
      const mark = document.createElement("div");
      mark.className = `agent-mark ${teamCss(agent.team)}`;
      mark.dataset.agentId = agent.id;
      const initial = document.createElement("span");
      initial.textContent = agent.name.at(0) ?? "?";
      const label = document.createElement("small");
      label.textContent = agent.name;
      mark.append(initial, label);
      agentStrip.append(mark);
    }
  }
  for (const agent of snapshot.agents) {
    const mark = agentStrip.querySelector<HTMLElement>(
      `[data-agent-id="${agent.id}"]`,
    );
    mark?.classList.toggle("dead", !agent.alive);
  }
}

function speechKey(line: SpeechLine): string {
  return `${line.turn}:${line.agentId}:${line.text}`;
}

function ingestSpeech(lines: readonly SpeechLine[]): void {
  const currentElapsed = latest?.elapsed ?? 0;
  for (const line of lines) {
    const key = speechKey(line);
    if (seenSpeech.has(key)) continue;
    seenSpeech.add(key);
    prependRecord(line);
    if (
      audioEnabled &&
      (line.agentId === "king" || line.agentId === "queen")
    ) {
      audio.speakRoyal(line);
    }
    if (
      line.agentId !== "king" &&
      line.agentId !== "queen" &&
      currentElapsed - line.elapsed < 3.2
    ) {
      const delay = bubbleDelay(line.agentId);
      window.setTimeout(() => releaseBubble(key, line), delay);
    }
  }
  while (transcript.childElementCount > 120) {
    transcript.lastElementChild?.remove();
  }
  transcript.scrollTop = 0;
}

function bubbleDelay(agentId: string): number {
  const slots: Record<string, number> = {
    king: 0,
    king_1: 550,
    queen_1: 350,
    king_2: 700,
    queen_2: 1050,
    king_3: 1400,
    queen_3: 1750,
    queen: 1850,
    humpty: 2450,
  };
  return slots[agentId] ?? 0;
}

function prependRecord(line: SpeechLine): void {
  const item = document.createElement("li");
  item.className = teamCss(line.team);
  item.dataset.elapsed = String(line.elapsed);
  const time = document.createElement("span");
  time.className = "line-turn";
  time.textContent = formatElapsed(line.elapsed);
  const copy = document.createElement("p");
  const name = document.createElement("b");
  name.textContent = line.name;
  copy.append(name, document.createTextNode(` ${limitSpeech(line.text)}`));
  item.append(time, copy);
  const before = [...transcript.children].find(
    (child) =>
      Number((child as HTMLElement).dataset.elapsed ?? -1) <= line.elapsed,
  );
  transcript.insertBefore(item, before ?? null);
}

function limitSpeech(text: string): string {
  const words = text.trim().split(/\s+/);
  return words.slice(0, 10).join(" ");
}

function releaseBubble(key: string, line: SpeechLine): void {
  const anchor = world.bubbleAnchor(line.agentId);
  if (!anchor) return;
  const lane = line.team === "humpty" ? "humpty" : line.team;
  if (
    bubbles.has(lane) ||
    performance.now() < (bubbleRestUntil.get(lane) ?? 0)
  ) {
    return;
  }

  const bubble = document.createElement("div");
  bubble.className = `speech-float ${teamCss(line.team)}`;
  bubble.dataset.key = key;
  bubble.textContent = limitSpeech(line.text);
  stageShell.append(bubble);
  bubbles.set(lane, bubble);
  const started = performance.now();

  const position = () => {
    if (!bubble.isConnected) return;
    const age = performance.now() - started;
    const point = world.projectToStage(anchor, line.agentId === "humpty" ? 1.7 : 1.25);
    const x = Math.max(100, Math.min(stageShell.clientWidth - 100, point.x));
    const y = Math.max(88, point.y - Math.min(54, age * 0.014));
    bubble.style.left = `${x}px`;
    bubble.style.top = `${y}px`;
    bubble.hidden = !point.visible;
    requestAnimationFrame(position);
  };
  requestAnimationFrame(position);
  const timer = window.setTimeout(() => {
    bubble.classList.add("popping");
    window.setTimeout(() => bubble.remove(), 260);
    bubbles.delete(lane);
    bubbleTimers.delete(lane);
    bubbleRestUntil.set(lane, performance.now() + BUBBLE_REST_MS);
  }, SPEECH_MS);
  bubbleTimers.set(lane, timer);
}

function renderIcon(button: HTMLButtonElement, name: string): void {
  const icons = {
    pause: Pause,
    play: Play,
    follow: ScanSearch,
    fit: Maximize2,
    poke: Hand,
    sound: audioEnabled ? Volume2 : VolumeX,
    replay: History,
    restart: RotateCcw,
    engineering: Wrench,
  } as const;
  const icon = icons[name as keyof typeof icons];
  if (!icon) return;
  const element = createLucideElement(icon);
  element.setAttribute("width", "20");
  element.setAttribute("height", "20");
  button.replaceChildren(element);
}

function renderSidebarToggle(): void {
  const element = createLucideElement(
    sidebarCollapsed ? PanelRightOpen : PanelRightClose,
  );
  element.setAttribute("width", "20");
  element.setAttribute("height", "20");
  sidebarToggle.replaceChildren(element);
  sidebarToggle.ariaExpanded = String(!sidebarCollapsed);
  sidebarToggle.ariaLabel = sidebarCollapsed
    ? "Expand performance ledger"
    : "Collapse performance ledger";
  sidebarToggle.title = sidebarToggle.ariaLabel;
}

function hydrateIcons(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "#controls button",
  )) {
    renderIcon(button, button.dataset.command ?? "");
  }
  const liveIcon = createLucideElement(Radio);
  liveIcon.setAttribute("width", "18");
  liveIcon.setAttribute("height", "18");
  replayLive.replaceChildren(liveIcon);
  renderSidebarToggle();
}

function toggleSidebar(): void {
  sidebarCollapsed = !sidebarCollapsed;
  document.body.classList.toggle("sidebar-collapsed", sidebarCollapsed);
  renderSidebarToggle();
}

function togglePause(): void {
  if (replayActive) {
    replayPaused = !replayPaused;
    replayLastWall = performance.now();
    updatePauseButton(replayPaused);
    return;
  }
  pauseRequested = !pauseRequested;
  send({ type: "command", command: pauseRequested ? "pause" : "resume" });
  world.setPaused(pauseRequested);
  const button = document.querySelector<HTMLButtonElement>(
    '[data-command="pause"]',
  );
  if (button) {
    renderIcon(button, pauseRequested ? "play" : "pause");
    button.ariaLabel = pauseRequested ? "Resume performance" : "Pause performance";
  }
}

async function toggleSound(): Promise<void> {
  audioEnabled = !audioEnabled;
  if (audioEnabled) {
    await audio.enable();
  } else {
    audio.disable();
  }
  const button = document.querySelector<HTMLButtonElement>(
    '[data-command="sound"]',
  );
  if (button) {
    renderIcon(button, "sound");
    button.classList.toggle("active", audioEnabled);
    button.ariaLabel = audioEnabled ? "Mute sound" : "Enable sound";
  }
}

for (const button of document.querySelectorAll<HTMLButtonElement>(
  "#controls button",
)) {
  button.addEventListener("click", () => {
    switch (button.dataset.command) {
      case "pause":
        togglePause();
        break;
      case "follow":
        world.setFollow(!world.getFollow());
        button.classList.toggle("active", world.getFollow());
        break;
      case "fit":
        world.fit();
        break;
      case "poke":
        world.poke();
        send({ type: "command", command: "poke" });
        break;
      case "sound":
        void toggleSound();
        break;
      case "replay":
        if (replayActive) exitReplay();
        else void beginReplay();
        break;
      case "engineering":
        toggleEngineering();
        break;
      case "restart":
        exitReplay();
        send({ type: "command", command: "restart" });
        break;
    }
  });
}

required<HTMLButtonElement>("end-restart").addEventListener("click", () => {
  exitReplay();
  send({ type: "command", command: "restart" });
});
replayLive.addEventListener("click", exitReplay);
replayScrubber.addEventListener("input", () => {
  replayPaused = true;
  replayLastWall = performance.now();
  updatePauseButton(true);
  renderReplayAt(Number(replayScrubber.value), true);
});
replaySpeed.addEventListener("change", () => {
  replayLastWall = performance.now();
});
sidebarToggle.addEventListener("click", toggleSidebar);

window.addEventListener("keydown", (event) => {
  if (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLSelectElement
  ) {
    return;
  }
  if (event.code === "Space") {
    event.preventDefault();
    togglePause();
  } else if (event.key.toLowerCase() === "f") {
    world.setFollow(!world.getFollow());
  } else if (event.key === "0") {
    world.fit();
  } else if (event.key.toLowerCase() === "p") {
    world.poke();
  } else if (event.key.toLowerCase() === "m") {
    void toggleSound();
  } else if (event.key.toLowerCase() === "r") {
    exitReplay();
    send({ type: "command", command: "restart" });
  } else if (event.key.toLowerCase() === "d") {
    toggleEngineering();
  }
});

window.addEventListener("beforeunload", () => {
  clearTimeout(reconnectTimer);
  cancelAnimationFrame(replayAnimation);
  socket?.close();
  if (world) world.destroy();
});

class WorksiteAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private lastByType = new Map<string, number>();

  async enable(): Promise<void> {
    this.context ??= new AudioContext();
    if (!this.master) {
      this.master = this.context.createGain();
      this.master.gain.value = 0.17;
      this.master.connect(this.context.destination);
    }
    await this.context.resume();
    this.bell(330, 0.11, 0.8);
  }

  disable(): void {
    window.speechSynthesis?.cancel();
  }

  speakRoyal(line: SpeechLine): void {
    if (!("speechSynthesis" in window)) return;
    const utterance = new SpeechSynthesisUtterance(line.text);
    const voices = window.speechSynthesis.getVoices();
    const englishVoices = voices.filter((voice) =>
      voice.lang.toLowerCase().startsWith("en"),
    );
    utterance.voice =
      englishVoices.find((voice) =>
        line.agentId === "queen"
          ? /moira|serena|victoria|tessa|karen|female/i.test(voice.name)
          : /male|daniel|alex|arthur|fred/i.test(voice.name),
      ) ??
      englishVoices[line.agentId === "queen" ? 0 : 1] ??
      voices[0] ??
      null;
    utterance.rate = line.agentId === "queen" ? 0.76 : 0.86;
    utterance.pitch = line.agentId === "queen" ? 0.58 : 0.76;
    utterance.volume = line.agentId === "queen" ? 0.96 : 0.88;
    if (line.agentId === "queen") {
      this.queenUndertone(Math.min(4.8, 1.4 + line.text.split(/\s+/).length * 0.31));
    }
    window.speechSynthesis.speak(utterance);
  }

  private queenUndertone(duration: number): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master) return;
    const lowpass = context.createBiquadFilter();
    const gain = context.createGain();
    const first = context.createOscillator();
    const second = context.createOscillator();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 135;
    lowpass.Q.value = 1.2;
    first.type = "triangle";
    first.frequency.value = 46;
    second.type = "sine";
    second.frequency.value = 69;
    second.detune.value = -11;
    gain.gain.setValueAtTime(0.001, context.currentTime);
    gain.gain.linearRampToValueAtTime(0.055, context.currentTime + 0.18);
    gain.gain.setValueAtTime(0.055, context.currentTime + Math.max(0.25, duration - 0.3));
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
    first.connect(lowpass);
    second.connect(lowpass);
    lowpass.connect(gain).connect(master);
    first.start();
    second.start();
    first.stop(context.currentTime + duration);
    second.stop(context.currentTime + duration);
  }

  cue(cue: SoundCue): void {
    const now = performance.now();
    if (now - (this.lastByType.get(cue.type) ?? 0) < 90) return;
    this.lastByType.set(cue.type, now);
    switch (cue.type) {
      case "hammer":
        this.hammer(cue.intensity);
        break;
      case "footstep":
      case "climb":
        this.step(cue.intensity);
        break;
      case "rope":
      case "winch":
        this.creak(cue.intensity);
        break;
      case "throw":
        this.whoosh(cue.intensity);
        break;
      case "impact":
      case "shove":
      case "fall":
        this.localImpact(cue.intensity * 5);
        break;
      case "crack":
        this.crack();
        break;
      case "splat":
        this.splat();
        break;
    }
  }

  localImpact(strength: number): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master) return;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(95 + Math.min(70, strength * 4), context.currentTime);
    osc.frequency.exponentialRampToValueAtTime(42, context.currentTime + 0.18);
    gain.gain.setValueAtTime(Math.min(0.75, 0.12 + strength * 0.03), context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.22);
    osc.connect(gain).connect(master);
    osc.start();
    osc.stop(context.currentTime + 0.23);
  }

  splat(): void {
    this.localImpact(18);
    this.bell(68, 0.38, 0.5, "sawtooth");
  }

  private hammer(intensity: number): void {
    this.bell(680 + intensity * 110, 0.055, 0.42, "triangle");
    window.setTimeout(() => this.bell(390, 0.04, 0.2, "sine"), 36);
  }

  private step(intensity: number): void {
    this.bell(92 + intensity * 18, 0.045, 0.16, "sine");
  }

  private creak(intensity: number): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master) return;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(118, context.currentTime);
    osc.frequency.linearRampToValueAtTime(160 + intensity * 20, context.currentTime + 0.22);
    osc.frequency.linearRampToValueAtTime(105, context.currentTime + 0.5);
    gain.gain.setValueAtTime(0.001, context.currentTime);
    gain.gain.linearRampToValueAtTime(0.2, context.currentTime + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.52);
    osc.connect(gain).connect(master);
    osc.start();
    osc.stop(context.currentTime + 0.54);
  }

  private whoosh(intensity: number): void {
    this.bell(210 + intensity * 50, 0.18, 0.22, "sine");
  }

  private crack(): void {
    this.bell(920, 0.055, 0.55, "square");
    window.setTimeout(() => this.bell(520, 0.08, 0.35, "triangle"), 45);
    window.setTimeout(() => this.bell(230, 0.14, 0.28, "sine"), 95);
  }

  private bell(
    frequency: number,
    duration: number,
    volume: number,
    type: OscillatorType = "sine",
  ): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
    oscillator.connect(gain).connect(master);
    oscillator.start();
    oscillator.stop(context.currentTime + duration);
  }
}

audio = new WorksiteAudio();
world = new PhysicalWorld(stageElement, {
  onImpact: (strength) => audio.localImpact(strength),
  onHumptyFall: () => audio.splat(),
});
hydrateIcons();
void fetch("/health", { cache: "no-store" })
  .then((response) => response.json() as Promise<{ build?: string }>)
  .then((health) => {
    if (buildLabel && health.build) {
      buildLabel.textContent = `3D live ${health.build}`;
    }
  })
  .catch(() => undefined);
const requestedReplay = new URLSearchParams(location.search).get("replay");
if (requestedReplay) {
  void loadReplay(requestedReplay);
} else {
  connect();
}
