import {
  Eye,
  FastForward,
  Gauge,
  History as HistoryIcon,
  Maximize2,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  Radio,
  Rewind,
  RotateCcw,
  ShieldCheck,
  SkipBack,
  SkipForward,
  Swords,
  X,
  createElement as createLucideElement,
} from "lucide";
import {
  CORE_MODE,
  type BattleOrderAction,
  type BattleOrderState,
  type BattleTargetId,
  type BattleUnitState,
  type CoreClientCommand,
  type CoreSnapshot,
  type ReplayArchiveEntry,
  type ReplaySummary,
  type Team,
} from "../shared/core-protocol.js";
import { siegeEquipment } from "../shared/siege-equipment.js";
import { LabWorld } from "./lab-world.js";

interface PublicReplaySummary extends ReplaySummary {
  title: string;
  description: string;
  path: string;
}

interface PublicReplayManifest {
  generatedAt: string;
  build: string;
  replays: PublicReplaySummary[];
}

const errors: string[] = [];
window.addEventListener("error", (event) => errors.push(event.message));
window.addEventListener("unhandledrejection", (event) => errors.push(String(event.reason)));
navigator.serviceWorker?.getRegistrations()
  .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
  .catch(() => undefined);

const url = new URL(location.href);
if (url.searchParams.get("mode") !== CORE_MODE) url.searchParams.set("mode", CORE_MODE);
if (!url.searchParams.has("seed")) url.searchParams.set("seed", "1881");
if (url.href !== location.href) history.replaceState({}, "", url);
const staticPreview = location.hostname.endsWith(".github.io") || url.searchParams.get("preview") === "static";

const world = new LabWorld(required("stage"));
const ledger = required("battle-ledger");
const ledgerToggle = required<HTMLButtonElement>("ledger-toggle");
const replayName = required("replay-name");
const replayTime = required("replay-time");
const replayScrubber = required<HTMLInputElement>("replay-scrubber");
const replaySpeed = required<HTMLSelectElement>("replay-speed");
const stageTime = required("stage-time");
const stagePhase = required("stage-phase");
const stageTurn = required("stage-turn");
const redDoctrine = required("red-doctrine");
const greenDoctrine = required("green-doctrine");
const compactClock = required("compact-clock");
const compactPhase = required("compact-phase");
const connectionLabel = required("connection-label");
const matchStatus = required<HTMLOutputElement>("match-status");
const watchKicker = required("watch-kicker");
const watchTitle = required("watch-title");
const positionLabel = required("position-label");
const targetList = required("target-list");
const orderList = required("order-list");
const orderCountdown = required("order-countdown");
const unitList = required("unit-list");
const recordList = required<HTMLOListElement>("battle-record");
const recordCount = required("record-count");
const archiveStatus = required<HTMLOutputElement>("archive-status");
const archiveList = required<HTMLOListElement>("archive-list");
const archiveFeedback = required("archive-feedback");
const commandForm = required<HTMLFormElement>("command-form");
const commandUnit = required<HTMLSelectElement>("command-unit");
const commandAction = required<HTMLSelectElement>("command-action");
const commandTarget = required<HTMLSelectElement>("command-target");
const commandStatus = required<HTMLOutputElement>("command-status");
const commandFeedback = required("command-feedback");
const commandRoster = required("command-roster");
const sealOrderButton = required<HTMLButtonElement>("seal-order");
const engineeringOverlay = required("engineering-overlay");
const engineeringValues = required<HTMLDListElement>("engineering-values");

let socket: WebSocket | undefined;
let pollTimer = 0;
let reconnectTimer = 0;
let latestLive: CoreSnapshot | undefined;
let displayed: CoreSnapshot | undefined;
let activeView: "watch" | "archive" | "command" = "watch";
let ledgerCollapsed = localStorage.getItem("atkm-ledger-collapsed") === "true";
let replayEntry: ReplayArchiveEntry | undefined;
let replayFrameIndex = 0;
let replayPlaying = false;
let replayClock = 0;
let replayTimer = 0;
let replayBaseUrl: URL | undefined;
let archiveSummaries: Array<ReplaySummary | PublicReplaySummary> = [];
let selectedReplayId = "";
let commandTeam: Team = "king";

renderIcons();
installControls();
setLedgerCollapsed(ledgerCollapsed);
setView("watch");
if (staticPreview) void loadStaticSite();
else {
  connect();
  void refreshLiveArchive();
  window.setInterval(() => void refreshLiveArchive(), 4000);
}
replayTimer = window.setInterval(advanceReplay, 50);

function required<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

function installControls(): void {
  ledgerToggle.addEventListener("click", () => setLedgerCollapsed(!ledgerCollapsed));
  document.querySelectorAll<HTMLButtonElement>("[data-ledger-view]").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.ledgerView as typeof activeView));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-stage-command]").forEach((button) => {
    button.addEventListener("click", () => {
      const command = button.dataset.stageCommand;
      if (command === "fit") world.fit();
      else if (command === "diagnostics") engineeringOverlay.hidden = !engineeringOverlay.hidden;
      else if (command === "pause") togglePlayback();
      else if (command === "restart") void send({ type: "reset", seed: Number(url.searchParams.get("seed") ?? 1881) });
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-replay-command]").forEach((button) => {
    button.addEventListener("click", () => {
      const command = button.dataset.replayCommand;
      if (command === "play") togglePlayback();
      else if (command === "rewind") jumpReplay(-10);
      else if (command === "fast-forward") jumpReplay(10);
      else if (command === "live") returnToLive();
    });
  });
  replayScrubber.addEventListener("input", () => {
    if (!replayEntry) return;
    replayFrameIndex = Number(replayScrubber.value);
    replayClock = replayEntry.frames[replayFrameIndex]?.elapsed ?? 0;
    presentReplayFrame();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-archive-command]").forEach((button) => {
    button.addEventListener("click", () => {
      const command = button.dataset.archiveCommand;
      if (command === "watch") void openReplay(selectedReplayId, true);
      else selectAdjacentReplay(command === "previous" ? -1 : 1);
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-command-team]").forEach((button) => {
    button.addEventListener("click", () => {
      commandTeam = button.dataset.commandTeam as Team;
      document.querySelectorAll<HTMLButtonElement>("[data-command-team]").forEach((candidate) => candidate.classList.toggle("active", candidate === button));
      renderCommandControls();
      updateCompactStatus();
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-compact-team]").forEach((button) => {
    button.addEventListener("click", () => {
      commandTeam = button.dataset.compactTeam as Team;
      renderCommandControls();
      updateCompactStatus();
    });
  });
  document.querySelector<HTMLButtonElement>('[data-compact-command="seal"]')?.addEventListener("click", () => commandForm.requestSubmit());
  commandUnit.addEventListener("change", renderCommandActions);
  commandAction.addEventListener("change", renderCommandTargets);
  commandForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (staticPreview) return;
    void send({
      type: "battle-order",
      team: commandTeam,
      unitId: commandUnit.value as BattleUnitState["id"],
      action: commandAction.value as BattleOrderAction,
      targetId: commandTarget.value as BattleTargetId,
    }).then((result) => {
      commandFeedback.textContent = result.message ?? (result.ok ? "Order sealed." : "Order rejected.");
    });
  });
  window.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    if (event.code === "Space") {
      event.preventDefault();
      togglePlayback();
    }
    if (event.key === "ArrowLeft") jumpReplay(-10);
    if (event.key === "ArrowRight") jumpReplay(10);
  });
}

function connect(): void {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  connectionLabel.textContent = "connecting";
  try {
    socket = new WebSocket(`${protocol}//${location.host}/ws`);
  } catch {
    startPolling();
    return;
  }
  socket.addEventListener("open", () => {
    connectionLabel.textContent = "live";
    document.body.classList.remove("disconnected");
    stopPolling();
  });
  socket.addEventListener("message", (event) => {
    try {
      const payload = JSON.parse(String(event.data)) as CoreSnapshot | { type: string; message?: string };
      if (payload.type === "core-snapshot") acceptLiveSnapshot(payload as CoreSnapshot);
      else if ("message" in payload && payload.message) commandFeedback.textContent = payload.message;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  });
  socket.addEventListener("close", () => {
    connectionLabel.textContent = "reconnecting";
    document.body.classList.add("disconnected");
    startPolling();
    reconnectTimer = window.setTimeout(connect, 1200);
  });
  socket.addEventListener("error", startPolling);
}

function startPolling(): void {
  if (pollTimer) return;
  pollTimer = window.setInterval(() => void pollSnapshot(), 800);
  void pollSnapshot();
}

function stopPolling(): void {
  if (!pollTimer) return;
  window.clearInterval(pollTimer);
  pollTimer = 0;
}

async function pollSnapshot(): Promise<void> {
  try {
    const response = await fetch(`/snapshot?at=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return;
    connectionLabel.textContent = "live";
    acceptLiveSnapshot(await response.json() as CoreSnapshot);
  } catch {
    connectionLabel.textContent = "offline";
  }
}

function acceptLiveSnapshot(snapshot: CoreSnapshot): void {
  latestLive = snapshot;
  if (!replayEntry) presentSnapshot(snapshot);
}

async function loadStaticSite(): Promise<void> {
  document.body.classList.add("static-preview");
  connectionLabel.textContent = "public replay";
  sealOrderButton.disabled = true;
  commandStatus.textContent = "replay only";
  commandFeedback.textContent = "The public page plays complete battles. Live command requires the local theatre server.";
  try {
    const manifestUrl = new URL("replays/manifest.json", new URL(".", location.href));
    const response = await fetch(manifestUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`Replay manifest ${response.status}`);
    const manifest = await response.json() as PublicReplayManifest;
    replayBaseUrl = new URL(".", manifestUrl);
    archiveSummaries = manifest.replays;
    selectedReplayId = url.searchParams.get("replay") ?? manifest.replays[0]?.id ?? "";
    archiveStatus.textContent = `${manifest.replays.length} battles`;
    archiveFeedback.textContent = `Deterministic siege reel generated for ${manifest.build}.`;
    renderArchive();
    await openReplay(selectedReplayId, false);
  } catch (error) {
    archiveStatus.textContent = "unavailable";
    archiveFeedback.textContent = error instanceof Error ? error.message : "Public replays unavailable.";
  }
}

async function refreshLiveArchive(): Promise<void> {
  try {
    const response = await fetch(`/archive?at=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json() as { durable: boolean; replays: ReplaySummary[] };
    archiveSummaries = payload.replays;
    selectedReplayId ||= payload.replays[0]?.id ?? "";
    archiveStatus.textContent = payload.durable ? "saved locally" : "session archive";
    archiveFeedback.textContent = `${payload.replays.length} battle records available.`;
    renderArchive();
  } catch {
    archiveStatus.textContent = "offline";
  }
}

function renderArchive(): void {
  archiveList.replaceChildren(...archiveSummaries.map((summary) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.classList.toggle("active", summary.id === selectedReplayId);
    const title = document.createElement("strong");
    title.textContent = replayTitle(summary);
    const result = document.createElement("b");
    result.textContent = summary.outcome ? outcomeLabel(summary.outcome) : summary.status;
    const meta = document.createElement("span");
    meta.textContent = `seed ${summary.seed} · ${summary.frameCount} frames · ${formatElapsed(summary.duration)}`;
    button.append(title, result, meta);
    if ("description" in summary) {
      const description = document.createElement("p");
      description.textContent = summary.description;
      button.append(description);
    }
    button.addEventListener("click", () => {
      selectedReplayId = summary.id;
      renderArchive();
      updateCompactStatus();
    });
    item.append(button);
    return item;
  }));
}

function selectAdjacentReplay(direction: number): void {
  if (archiveSummaries.length === 0) return;
  const current = Math.max(0, archiveSummaries.findIndex((summary) => summary.id === selectedReplayId));
  const index = (current + direction + archiveSummaries.length) % archiveSummaries.length;
  selectedReplayId = archiveSummaries[index]!.id;
  renderArchive();
  updateCompactStatus();
}

async function openReplay(id: string, switchToWatch: boolean): Promise<void> {
  if (!id) return;
  archiveFeedback.textContent = "Loading battle snapshots...";
  try {
    const response = await fetch(replayUrl(id), { cache: "no-store" });
    if (!response.ok) throw new Error(`Replay ${response.status}`);
    replayEntry = await response.json() as ReplayArchiveEntry;
    replayFrameIndex = 0;
    replayClock = replayEntry.frames[0]?.elapsed ?? 0;
    replayPlaying = true;
    selectedReplayId = id;
    replayName.textContent = replayTitle(replayEntry.summary);
    watchKicker.textContent = "Recorded battle";
    watchTitle.textContent = replayTitle(replayEntry.summary);
    presentReplayFrame();
    updatePlaybackButtons();
    renderArchive();
    archiveFeedback.textContent = `${replayEntry.frames.length} physical snapshots loaded.`;
    if (staticPreview) {
      url.searchParams.set("replay", id);
      history.replaceState({}, "", url);
    }
    if (switchToWatch) setView("watch");
  } catch (error) {
    archiveFeedback.textContent = error instanceof Error ? error.message : "Replay unavailable.";
  }
}

function replayUrl(id: string): string {
  const summary = archiveSummaries.find((candidate) => candidate.id === id);
  if (staticPreview) {
    if (!summary || !("path" in summary) || !replayBaseUrl) throw new Error(`Unknown replay ${id}`);
    return new URL(summary.path, replayBaseUrl).href;
  }
  return `/archive/${encodeURIComponent(id)}?at=${Date.now()}`;
}

function advanceReplay(): void {
  if (!replayEntry || !replayPlaying) return;
  replayClock += .05 * Number(replaySpeed.value);
  const frames = replayEntry.frames;
  while (replayFrameIndex < frames.length - 1 && (frames[replayFrameIndex + 1]?.elapsed ?? Infinity) <= replayClock) replayFrameIndex += 1;
  presentReplayFrame();
  if (replayFrameIndex >= frames.length - 1) {
    replayPlaying = false;
    updatePlaybackButtons();
  }
}

function presentReplayFrame(): void {
  const frame = replayEntry?.frames[replayFrameIndex];
  if (!frame || !replayEntry) return;
  presentSnapshot(frame);
  replayScrubber.max = String(Math.max(0, replayEntry.frames.length - 1));
  replayScrubber.value = String(replayFrameIndex);
  replayTime.textContent = `${formatElapsed(frame.elapsed)} / ${formatElapsed(replayEntry.summary.duration)}`;
}

function jumpReplay(seconds: number): void {
  if (!replayEntry) return;
  const target = Math.max(0, Math.min(replayEntry.summary.duration, replayClock + seconds));
  let index = replayEntry.frames.findIndex((frame) => frame.elapsed >= target);
  if (index < 0) index = replayEntry.frames.length - 1;
  replayFrameIndex = index;
  replayClock = replayEntry.frames[index]?.elapsed ?? target;
  presentReplayFrame();
}

function togglePlayback(): void {
  if (replayEntry) {
    if (!replayPlaying && replayFrameIndex >= replayEntry.frames.length - 1) {
      replayFrameIndex = 0;
      replayClock = replayEntry.frames[0]?.elapsed ?? 0;
    }
    replayPlaying = !replayPlaying;
    updatePlaybackButtons();
    presentReplayFrame();
    return;
  }
  void send({ type: "pause" });
}

function returnToLive(): void {
  if (staticPreview || !latestLive) return;
  replayEntry = undefined;
  replayPlaying = false;
  replayName.textContent = "Live siege";
  watchKicker.textContent = "Live theatre";
  watchTitle.textContent = "Siege command";
  presentSnapshot(latestLive);
  updatePlaybackButtons();
}

function presentSnapshot(snapshot: CoreSnapshot): void {
  displayed = snapshot;
  world.sync(snapshot);
  const battle = snapshot.match.battle;
  if (!battle) return;
  const clock = formatClock(battle.timeRemaining);
  const phase = phaseLabel(battle.phase);
  stageTime.textContent = clock;
  compactClock.textContent = clock;
  stagePhase.textContent = phase;
  stageTurn.textContent = `Turn ${Math.max(1, battle.round)} of ${battle.maxRounds}`;
  redDoctrine.textContent = battle.doctrine.king;
  greenDoctrine.textContent = battle.doctrine.queen;
  positionLabel.textContent = `Humpty ${battle.humptyPosition === "crown" ? "at crown" : battle.humptyPosition}`;
  matchStatus.textContent = snapshot.match.status === "complete" && snapshot.match.outcome
    ? outcomeLabel(snapshot.match.outcome)
    : phase;
  orderCountdown.textContent = snapshot.match.status === "complete"
    ? "final"
    : `${Math.ceil(snapshot.match.nextMoveIn)}s`;
  renderTargets(snapshot);
  renderOrders(snapshot);
  renderUnits(snapshot);
  renderRecord(snapshot);
  renderCommandControls();
  renderDiagnostics(snapshot);
  updateCompactStatus();
  updatePlaybackButtons();
  document.body.dataset.battlePhase = battle.phase;
  document.body.dataset.outcome = snapshot.match.outcome ?? "";
  document.body.dataset.rendered = "true";
}

function renderTargets(snapshot: CoreSnapshot): void {
  const battle = snapshot.match.battle!;
  targetList.replaceChildren(...battle.targets.map((target) => {
    const row = document.createElement("div");
    row.className = `target-row ${target.status}`;
    const copy = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = target.name;
    const state = document.createElement("span");
    state.textContent = target.protection > 0 ? `${target.status} · ${target.protection}% cover` : target.status;
    copy.append(name, state);
    const value = document.createElement("b");
    value.textContent = String(Math.round(target.integrity));
    const track = document.createElement("i");
    const fill = document.createElement("span");
    fill.style.width = `${target.integrity}%`;
    track.append(fill);
    row.append(copy, value, track);
    return row;
  }));
}

function renderOrders(snapshot: CoreSnapshot): void {
  const battle = snapshot.match.battle!;
  orderList.replaceChildren(...(["king", "queen"] as const).map((team) => {
    const order = battle.orders[team];
    const row = document.createElement("article");
    row.className = `order-row ${team === "king" ? "red" : "green"}`;
    const side = document.createElement("b");
    side.textContent = team === "king" ? "RED" : "GREEN";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    const detail = document.createElement("p");
    if (order) {
      title.textContent = `${order.unitName} · ${actionLabel(order.action)}`;
      const chain = battle.chains[team];
      const definition = siegeEquipment(order.unitId);
      const stage = definition?.drill.find((candidate) => candidate.label === chain.stageLabel);
      const lead = stage?.leadCrew.map((index) => definition?.crew[index]?.role).filter(Boolean).join(" + ");
      detail.textContent = battle.phase === "resolving"
        ? `${chain.stageLabel}${lead ? ` · ${lead}` : ""}`
        : order.status === "resolved" ? order.result : `Target: ${order.targetName}`;
    } else if (battle.sealedTeams.includes(team)) {
      title.textContent = "Order sealed";
      detail.textContent = "Hidden until both commanders reveal.";
    } else {
      title.textContent = "Planning in secret";
      detail.textContent = "Reading damage, ammunition, and the previous exchange.";
    }
    copy.append(title, detail);
    row.append(side, copy);
    return row;
  }));
}

function renderUnits(snapshot: CoreSnapshot): void {
  const units = snapshot.match.battle!.units;
  const fragments: HTMLElement[] = [];
  for (const team of ["king", "queen"] as const) {
    const heading = document.createElement("h3");
    heading.className = team === "king" ? "red" : "green";
    heading.textContent = team === "king" ? "Red defense" : "Green assault";
    fragments.push(heading);
    for (const unit of units.filter((candidate) => candidate.team === team)) fragments.push(unitRow(unit));
  }
  unitList.replaceChildren(...fragments);
}

function unitRow(unit: BattleUnitState): HTMLElement {
  const row = document.createElement("div");
  row.className = `unit-row ${unit.state}`;
  const name = document.createElement("div");
  const strong = document.createElement("strong");
  strong.textContent = unit.name;
  const role = document.createElement("span");
  role.textContent = unit.state === "recovering" ? "cooling down" : unit.role;
  const crew = document.createElement("span");
  crew.className = "unit-crew";
  crew.textContent = unit.crewRoles.join(" · ");
  name.append(strong, role, crew);
  row.title = `${unit.purpose}\nCrew: ${unit.crewRoles.join(", ")}\nDrill: ${unit.drill.join("; ")}\nAffordances: ${unit.affordances.join("; ")}`;
  const integrity = document.createElement("b");
  integrity.textContent = String(Math.round(unit.integrity));
  const ammo = document.createElement("div");
  ammo.className = "ammo";
  ammo.setAttribute("aria-label", `${unit.ammunition} of ${unit.maxAmmunition} ${unit.munition}`);
  for (let index = 0; index < unit.maxAmmunition; index += 1) {
    const pip = document.createElement("i");
    pip.classList.toggle("spent", index >= unit.ammunition);
    ammo.append(pip);
  }
  row.append(name, integrity, ammo);
  return row;
}

function renderRecord(snapshot: CoreSnapshot): void {
  const history = snapshot.match.battle!.history;
  recordCount.textContent = `${history.length} ${history.length === 1 ? "turn" : "turns"}`;
  recordList.replaceChildren(...[...history].reverse().slice(0, 10).map((record) => {
    const item = document.createElement("li");
    const turn = document.createElement("b");
    turn.textContent = `T${record.round}`;
    const summary = document.createElement("p");
    summary.textContent = record.summary;
    item.append(turn, summary);
    return item;
  }));
}

function renderCommandControls(): void {
  const battle = displayed?.match.battle;
  if (!battle) return;
  const units = battle.units.filter((unit) => unit.team === commandTeam && unit.state === "ready");
  const selectedId = commandUnit.value;
  commandUnit.replaceChildren(...units.map((unit) => option(unit.id, `${unit.name} · ${unit.ammunition} ammo`)));
  if (units.some((unit) => unit.id === selectedId)) commandUnit.value = selectedId;
  renderCommandActions();
  const planning = battle.phase === "planning" && displayed?.match.status !== "complete";
  sealOrderButton.disabled = staticPreview || !planning || units.length === 0;
  commandStatus.textContent = staticPreview ? "replay only" : planning ? `${Math.ceil(displayed?.match.nextMoveIn ?? 0)}s` : "orders locked";
  commandRoster.replaceChildren(...battle.units.filter((unit) => unit.team === commandTeam).map((unit) => unitRow(unit)));
}

function renderCommandActions(): void {
  const unit = displayed?.match.battle?.units.find((candidate) => candidate.id === commandUnit.value);
  const selected = commandAction.value;
  commandAction.replaceChildren(...(unit?.availableActions ?? []).map((action) => option(action, actionLabel(action))));
  if (unit?.availableActions.includes(selected as BattleOrderAction)) commandAction.value = selected;
  renderCommandTargets();
}

function renderCommandTargets(): void {
  const unit = displayed?.match.battle?.units.find((candidate) => candidate.id === commandUnit.value);
  let targets = unit?.availableTargets ?? [];
  if (commandAction.value === "fortify") targets = targets.filter((target) => target !== "enemy-machine");
  if (commandAction.value === "raid") targets = targets.filter((target) => target === "enemy-machine");
  commandTarget.replaceChildren(...targets.map((target) => option(target, targetLabel(target))));
}

function renderDiagnostics(snapshot: CoreSnapshot): void {
  const entries: Array<[string, string]> = [
    ["World", `${snapshot.diagnostics.physicsWorlds} Rapier 3D`],
    ["Fixed step", `${snapshot.diagnostics.fixedHz} Hz`],
    ["Dynamic bodies", String(snapshot.diagnostics.dynamicBodies)],
    ["Tower bodies", String(snapshot.diagnostics.towerBodies)],
    ["Illegal transforms", String(snapshot.diagnostics.illegalTransformWrites)],
    ["Render divergence", snapshot.diagnostics.renderPoseDivergence.toFixed(4)],
    ["Build", snapshot.build],
    ["Seed", String(snapshot.seed)],
  ];
  engineeringValues.replaceChildren(...entries.flatMap(([term, value]) => {
    const dt = document.createElement("dt");
    dt.textContent = term;
    const dd = document.createElement("dd");
    dd.textContent = value;
    return [dt, dd];
  }));
}

function setView(view: typeof activeView): void {
  activeView = view;
  document.querySelectorAll<HTMLButtonElement>("[data-ledger-view]").forEach((button) => {
    const active = button.dataset.ledgerView === view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll<HTMLElement>("[data-ledger-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.ledgerPanel !== view;
  });
  document.querySelectorAll<HTMLElement>("[data-compact-view]").forEach((panel) => {
    panel.hidden = panel.dataset.compactView !== view;
  });
  updateCompactStatus();
}

function setLedgerCollapsed(collapsed: boolean): void {
  ledgerCollapsed = collapsed;
  ledger.classList.toggle("collapsed", collapsed);
  document.body.classList.toggle("ledger-collapsed", collapsed);
  ledgerToggle.setAttribute("aria-expanded", String(!collapsed));
  ledgerToggle.setAttribute("aria-label", collapsed ? "Expand battle ledger" : "Collapse battle ledger");
  ledgerToggle.title = collapsed ? "Expand battle ledger" : "Collapse battle ledger";
  setIcon(ledgerToggle, collapsed ? PanelRightOpen : PanelRightClose);
  localStorage.setItem("atkm-ledger-collapsed", String(collapsed));
  window.setTimeout(() => world.resizeToHost(), 250);
}

function updateCompactStatus(): void {
  if (activeView === "archive") {
    const selected = archiveSummaries.find((summary) => summary.id === selectedReplayId);
    compactPhase.textContent = selected ? replayTitle(selected) : "Archive";
    compactClock.textContent = `${archiveSummaries.length} games`;
    return;
  }
  if (activeView === "command") {
    compactPhase.textContent = `${commandTeam === "king" ? "Red" : "Green"} command`;
    compactClock.textContent = displayed?.match.battle ? phaseLabel(displayed.match.battle.phase) : "waiting";
    return;
  }
  compactPhase.textContent = displayed?.match.battle ? phaseLabel(displayed.match.battle.phase) : "Battle";
  compactClock.textContent = displayed?.match.battle ? formatClock(displayed.match.battle.timeRemaining) : "10:00";
}

function updatePlaybackButtons(): void {
  const paused = replayEntry ? !replayPlaying : displayed?.paused ?? false;
  document.querySelectorAll<HTMLButtonElement>('[data-replay-command="play"], [data-stage-command="pause"]').forEach((button) => {
    setIcon(button, paused ? Play : Pause);
    button.setAttribute("aria-label", paused ? "Play" : "Pause");
    button.title = paused ? "Play" : "Pause";
  });
}

async function send(command: CoreClientCommand): Promise<{ ok: boolean; message?: string }> {
  if (staticPreview) return { ok: false, message: "Public replay mode cannot issue live orders." };
  if (socket?.readyState === WebSocket.OPEN && command.type !== "reset") {
    socket.send(JSON.stringify(command));
    return { ok: true, message: "Order sent to the theatre." };
  }
  try {
    const response = await fetch("/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(command),
    });
    return await response.json() as { ok: boolean; message?: string };
  } catch {
    return { ok: false, message: "The theatre server is unreachable." };
  }
}

function renderIcons(): void {
  const icons = {
    eye: Eye,
    history: HistoryIcon,
    swords: Swords,
    pause: Pause,
    play: Play,
    rewind: Rewind,
    "fast-forward": FastForward,
    radio: Radio,
    "skip-back": SkipBack,
    "skip-forward": SkipForward,
    "maximize-2": Maximize2,
    gauge: Gauge,
    "rotate-ccw": RotateCcw,
    "panel-right-close": PanelRightClose,
    "shield-check": ShieldCheck,
    x: X,
  };
  document.querySelectorAll<HTMLElement>("[data-lucide]").forEach((placeholder) => {
    const icon = icons[placeholder.dataset.lucide as keyof typeof icons];
    if (icon) placeholder.replaceWith(createLucideElement(icon));
  });
}

function setIcon(button: HTMLButtonElement, icon: Parameters<typeof createLucideElement>[0]): void {
  const span = button.querySelector("span");
  button.replaceChildren(createLucideElement(icon));
  if (span) button.append(span);
}

function option(value: string, label: string): HTMLOptionElement {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = label;
  return element;
}

function replayTitle(summary: ReplaySummary | PublicReplaySummary): string {
  if ("title" in summary) return summary.title;
  const publicSummary = archiveSummaries.find((candidate) => candidate.id === summary.id);
  if (publicSummary && "title" in publicSummary) return publicSummary.title;
  return summary.live ? "Live siege" : `Battle ${summary.id}`;
}

function actionLabel(action: BattleOrderAction): string {
  return ({
    hold: "Hold position",
    breach: "Fire round shot",
    bombard: "Lob mortar shell",
    snipe: "Fire matchlock volley",
    fortify: "Set gabions and repair",
    reposition: "Tension rescue capstan",
    deploy: "Deploy rescue cart",
    raid: "Raid the powder train",
  })[action];
}

function targetLabel(target: BattleTargetId): string {
  return ({
    foundation: "Tower foundation",
    "tower-face": "Exposed tower face",
    humpty: "Humpty",
    "enemy-machine": "Enemy equipment",
  })[target];
}

function phaseLabel(phase: NonNullable<CoreSnapshot["match"]["battle"]>["phase"]): string {
  return ({ planning: "Planning", reveal: "Orders revealed", resolving: "Resolving fire", aftermath: "Assessing damage", complete: "Battle complete" })[phase];
}

function outcomeLabel(outcome: "king" | "queen" | "draw"): string {
  return outcome === "king" ? "Red holds" : outcome === "queen" ? "Green victory" : "Draw";
}

function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

function formatElapsed(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

window.addEventListener("beforeunload", () => {
  window.clearInterval(replayTimer);
  window.clearInterval(pollTimer);
  window.clearTimeout(reconnectTimer);
  world.destroy();
});

declare global {
  interface Window {
    __HUMPTY_ERRORS__?: string[];
  }
}
window.__HUMPTY_ERRORS__ = errors;
