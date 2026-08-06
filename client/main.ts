import {
  ChevronDown,
  ClipboardList,
  Eye,
  FastForward,
  Hand,
  History as HistoryIcon,
  Maximize2,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  RotateCcw,
  Radio,
  Rewind,
  Rocket,
  Send,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Wrench,
  createElement as createLucideElement,
} from "lucide";
import {
  CORE_MODE,
  CONNECTION_CLASSES,
  LEGAL_ACTIONS,
  type CoreClientCommand,
  type CoreSnapshot,
  type LegalActionRequest,
  type ReplayArchiveEntry,
  type ReplaySummary,
} from "../shared/core-protocol.js";
import { LabWorld } from "./lab-world.js";
import { WorksiteAudio, type RoyalSpeaker } from "./worksite-audio.js";

const errors: string[] = [];
const SIDEBAR_COLLAPSED_KEY = "humpty-sidebar-collapsed";
window.addEventListener("error", (event) => errors.push(event.message));
window.addEventListener("unhandledrejection", (event) => errors.push(String(event.reason)));

navigator.serviceWorker?.getRegistrations()
  .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
  .catch(() => undefined);

const url = new URL(location.href);
if (!url.searchParams.has("mode")) url.searchParams.set("mode", CORE_MODE);
if (!url.searchParams.has("seed")) url.searchParams.set("seed", "1881");
if (url.href !== location.href) history.replaceState({}, "", url);
const staticPreview = location.hostname.endsWith(".github.io") || url.searchParams.get("preview") === "static";

interface PublicReplaySummary extends ReplaySummary {
  title?: string;
  description?: string;
  path: string;
}

interface PublicReplayManifest {
  generatedAt: string;
  build: string;
  replays: PublicReplaySummary[];
}

const stage = required<HTMLElement>("stage");
const world = new LabWorld(stage);
const audio = new WorksiteAudio();
const transcript = required<HTMLOListElement>("transcript");
const elapsedValue = required<HTMLElement>("elapsed-value");
const stageTime = required<HTMLElement>("stage-time");
const heightValue = required<HTMLElement>("height-value");
const integrityValue = required<HTMLElement>("integrity-value");
const integrityFill = required<HTMLElement>("integrity-fill");
const modeLabel = required<HTMLElement>("mode-mark").querySelector("span");
const matchStatus = required<HTMLOutputElement>("match-status");
const watchWorkspaceStatus = required<HTMLOutputElement>("watch-workspace-status");
const watchWorkspaceKicker = required<HTMLElement>("watch-workspace-kicker");
const watchWorkspaceTitle = required<HTMLElement>("watch-workspace-title");
const matchTurn = required<HTMLElement>("match-turn");
const matchPhase = required<HTMLElement>("match-phase");
const ruleCount = required<HTMLElement>("rule-count");
const kingObjective = required<HTMLElement>("king-objective");
const queenObjective = required<HTMLElement>("queen-objective");
const kingMachine = required<HTMLElement>("king-machine");
const queenMachine = required<HTMLElement>("queen-machine");
const queenAdvantageState = required<HTMLElement>("queen-advantage-state");
const queenAdvantageMeta = required<HTMLElement>("queen-advantage-meta");
const kingRule = required<HTMLElement>("king-rule");
const queenRule = required<HTMLElement>("queen-rule");
const gateList = required<HTMLOListElement>("gate-list");
const gateSummary = required<HTMLOutputElement>("gate-summary");
const connectionLabel = required<HTMLElement>("connection-label");
const seedLabel = required<HTMLElement>("seed-label");
const buildLabel = required<HTMLElement>("build-label");
const sidebarToggle = required<HTMLButtonElement>("sidebar-toggle");
const collapsedContext = required<HTMLElement>("collapsed-context");
const collapsedStatusValue = required<HTMLElement>("collapsed-status-value");
const engineeringOverlay = required<HTMLElement>("engineering-overlay");
const engineeringTick = required<HTMLOutputElement>("engineering-tick");
const engineeringValues = required<HTMLDListElement>("engineering-values");
const actionSelect = required<HTMLSelectElement>("action-select");
const targetSelect = required<HTMLSelectElement>("target-select");
const secondarySelect = required<HTMLSelectElement>("secondary-select");
const connectionClassSelect = required<HTMLSelectElement>("connection-class-select");
const secondaryField = required<HTMLElement>("secondary-field");
const connectionClassField = required<HTMLElement>("connection-class-field");
const workerSelect = required<HTMLSelectElement>("worker-select");
const issueOrder = required<HTMLButtonElement>("issue-order");
const commandFeedback = required<HTMLElement>("command-feedback");
const sidebarTabs = [...document.querySelectorAll<HTMLButtonElement>("[data-sidebar-view]")];
const sidebarPanels = [...document.querySelectorAll<HTMLElement>("[data-sidebar-panel]")];
const collapsedViews = [...document.querySelectorAll<HTMLElement>("[data-collapsed-view]")];
const archiveStatus = required<HTMLOutputElement>("archive-status");
const archiveList = required<HTMLOListElement>("archive-list");
const archiveCount = required<HTMLElement>("archive-count");
const archiveFeedback = required<HTMLElement>("archive-feedback");
const replayConsole = required<HTMLElement>("replay-console");
const replayName = required<HTMLElement>("replay-name");
const replayTime = required<HTMLElement>("replay-time");
const replayScrubber = required<HTMLInputElement>("replay-scrubber");
const replaySpeed = required<HTMLSelectElement>("replay-speed");
const organizeForm = required<HTMLFormElement>("organize-form");
const organizeSeed = required<HTMLInputElement>("organize-seed");
const organizeSpeed = required<HTMLSelectElement>("organize-speed");
const organizeStatus = required<HTMLOutputElement>("organize-status");
const organizeFeedback = required<HTMLElement>("organize-feedback");
const organizeRecipeSummary = required<HTMLElement>("organize-recipe-summary");

let socket: WebSocket | undefined;
let polling = false;
let pollTimer = 0;
let reconnectTimer = 0;
let latest: CoreSnapshot | undefined;
let sidebarCollapsed = readSidebarState();
let engineering = false;
let receivedFirstSnapshot = false;
const seenAudioEvents = new Set<string>();
let sidebarView: "watch" | "archive" | "organize" = "watch";
let replayEntry: ReplayArchiveEntry | undefined;
let replayFrameIndex = 0;
let replayPlaying = false;
let replayClock = 0;
let replayTimer = 0;
let archiveTimer = 0;
let archiveDurable = false;
let archiveSummaries: ReplaySummary[] = [];
let publicReplayBaseUrl: URL | undefined;
let publicReplaySummaries: PublicReplaySummary[] = [];

for (const action of LEGAL_ACTIONS) {
  const option = document.createElement("option");
  option.value = action;
  option.textContent = actionLabel(action);
  actionSelect.append(option);
}
for (const connectionClass of CONNECTION_CLASSES) {
  const option = document.createElement("option");
  option.value = connectionClass;
  option.textContent = connectionClass.replaceAll("_", " ");
  connectionClassSelect.append(option);
}

installControls();
renderIcons();
applySidebarState(sidebarCollapsed, false);
setSidebarView("watch");
if (staticPreview) {
  void loadStaticPreview();
} else {
  connect();
  void refreshArchiveList();
  void refreshContraptionSummary();
  archiveTimer = window.setInterval(() => void refreshArchiveList(), 2500);
}

function required<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
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
    stopPolling();
    document.body.classList.remove("disconnected");
    connectionLabel.textContent = "live";
    connectionLabel.classList.add("open");
  });
  socket.addEventListener("message", (event) => {
    try {
      const payload = JSON.parse(String(event.data)) as CoreSnapshot | { type: string; message?: string };
      if (payload.type === "core-snapshot") acceptSnapshot(payload as CoreSnapshot);
      else if (payload.type === "command-error" && payload.message) commandFeedback.textContent = payload.message;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  });
  socket.addEventListener("error", startPolling);
  socket.addEventListener("close", () => {
    document.body.classList.add("disconnected");
    connectionLabel.textContent = "reconnecting";
    connectionLabel.classList.remove("open");
    startPolling();
    reconnectTimer = window.setTimeout(connect, 1000);
  });
}

async function loadStaticPreview(): Promise<void> {
  document.body.classList.add("static-preview");
  connectionLabel.textContent = "preview";
  connectionLabel.classList.add("open");
  organizeStatus.textContent = "preview";
  commandFeedback.textContent = "Static preview only. Live orders are available from the local theatre server.";
  try {
    const replays = await refreshStaticArchiveList();
    if (replays.length > 0) {
      const requestedReplay = url.searchParams.get("replay");
      const selected = replays.find((summary) => summary.id === requestedReplay) ?? replays[0];
      if (!selected) throw new Error("Public replay manifest is empty.");
      await openReplay(selected.id, { autoplay: true });
      organizeRecipeSummary.textContent = "3 packaged autonomous games";
      return;
    }
  } catch (error) {
    archiveFeedback.textContent = error instanceof Error ? error.message : "Public replays unavailable.";
  }

  try {
    const assetUrl = new URL("demo-snapshot.json", new URL(".", location.href));
    const response = await fetch(assetUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`Preview ${response.status}`);
    const snapshot = await response.json() as CoreSnapshot;
    latest = snapshot;
    presentSnapshot(snapshot, false);
    archiveStatus.textContent = "static preview";
    archiveFeedback.textContent = "Recorded stage state. Run the theatre server for live autonomous play.";
    archiveCount.textContent = "1 preview";
  } catch (error) {
    connectionLabel.textContent = "unavailable";
    commandFeedback.textContent = error instanceof Error ? error.message : "Preview unavailable.";
  }
}

function startPolling(): void {
  if (polling) return;
  polling = true;
  void pollSnapshot();
}

function stopPolling(): void {
  polling = false;
  window.clearTimeout(pollTimer);
}

async function pollSnapshot(): Promise<void> {
  if (!polling) return;
  try {
    const response = await fetch(`/snapshot?at=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Snapshot ${response.status}`);
    acceptSnapshot(await response.json() as CoreSnapshot);
    connectionLabel.textContent = "live";
    connectionLabel.classList.add("open");
  } catch {
    document.body.classList.add("disconnected");
  }
  pollTimer = window.setTimeout(pollSnapshot, 250);
}

function acceptSnapshot(snapshot: CoreSnapshot): void {
  latest = snapshot;
  if (!replayEntry) presentSnapshot(snapshot, true);
}

function presentSnapshot(snapshot: CoreSnapshot, live: boolean): void {
  world.sync(snapshot);
  if (live) processAudioEvents(snapshot);
  if (window.__HUMPTY_LAB__) window.__HUMPTY_LAB__.consoleErrors = errors;
  const elapsed = formatElapsed(snapshot.elapsed);
  elapsedValue.textContent = elapsed;
  stageTime.textContent = elapsed;
  seedLabel.textContent = `seed ${snapshot.seed}`;
  buildLabel.textContent = `build ${snapshot.build}`;
  const humpty = snapshot.bodies.find((body) => body.id === "humpty");
  if (humpty) {
    heightValue.textContent = humpty.position.y.toFixed(2);
    const integrity = humpty.integrity ?? 100;
    integrityValue.textContent = String(Math.round(integrity));
    integrityFill.style.width = `${Math.max(0, integrity)}%`;
  }
  renderEvents(snapshot);
  renderMatch(snapshot);
  renderGates(snapshot);
  renderDiagnostics(snapshot);
  updateSidebarContext();
  populateTargets(snapshot);
  if (live) {
    archiveStatus.textContent = archiveDurable ? "durable archive" : "session archive";
    organizeStatus.textContent = "ready";
  } else {
    archiveStatus.textContent = staticPreview ? "public demo reel" : "replay view";
  }
}

function renderEvents(snapshot: CoreSnapshot): void {
  transcript.replaceChildren(...snapshot.events.map((event) => {
    const item = document.createElement("li");
    const time = document.createElement("time");
    time.textContent = formatElapsed(event.elapsed);
    const text = document.createElement("span");
    text.textContent = event.text;
    if (event.team) item.dataset.team = event.team;
    item.append(time, text);
    return item;
  }));
  transcript.scrollTop = 0;
}

function renderMatch(snapshot: CoreSnapshot): void {
  const match = snapshot.match;
  matchStatus.textContent = match.outcome ?? match.status;
  watchWorkspaceStatus.textContent = match.outcome ?? match.status;
  matchStatus.dataset.status = match.status;
  matchStatus.dataset.outcome = match.outcome ?? "";
  matchTurn.textContent = `${match.busyWorkers} active / ${match.moves} moves`;
  matchPhase.textContent = match.phase.charAt(0).toUpperCase() + match.phase.slice(1);
  ruleCount.textContent = `${match.rulebookSize} rules`;
  kingObjective.textContent = match.kingObjective;
  queenObjective.textContent = match.queenObjective;
  kingMachine.textContent = match.machinePlans.king;
  queenMachine.textContent = match.machinePlans.queen;
  const advantage = match.queenAdvantage;
  queenAdvantageState.textContent = advantage.disabled
    ? "command post broken"
    : advantage.armed
      ? "crown bolt armed"
      : "crown bolts spent";
  queenAdvantageState.dataset.state = advantage.disabled ? "broken" : advantage.armed ? "armed" : "spent";
  queenAdvantageMeta.textContent = `${advantage.charges} / ${advantage.maxCharges} crown bolts · ${Math.round(advantage.deviceIntegrity)}% integrity`;
  kingRule.textContent = teamRuleText(snapshot, "king");
  queenRule.textContent = teamRuleText(snapshot, "queen");
  if (modeLabel) {
    modeLabel.textContent = match.driver === "manual"
      ? "Legibility lab"
      : match.driver === "llm" ? "Model-led match" : "Autonomous match";
  }
}

function teamRuleText(snapshot: CoreSnapshot, team: "king" | "queen"): string {
  return snapshot.workers
    .filter((worker) => worker.team === team)
    .map((worker) => `${worker.name}: ${snapshot.match.activeRuleIds[worker.id] ?? "observing"}`)
    .join("\n");
}

function renderGates(snapshot: CoreSnapshot): void {
  const diagnostics = snapshot.diagnostics;
  const completed = new Set(snapshot.completedFixtures);
  const clientDivergence = window.__HUMPTY_LAB__?.maxPoseDivergence ?? 0;
  const gateA =
    diagnostics.physicsAdapter === "rapier3d" &&
    diagnostics.physicsWorlds === 1 &&
    diagnostics.illegalTransformWrites === 0 &&
    diagnostics.lateCreatedInventory === 0 &&
    clientDivergence < .01;
  const tower = snapshot.bodies.filter((body) => body.kind === "tower-block");
  const courses = new Map<number, CoreSnapshot["bodies"]>();
  for (const block of tower) {
    const course = block.course ?? -1;
    const entries = courses.get(course) ?? [];
    entries.push(block);
    courses.set(course, entries);
  }
  const topology = tower.length === 36 && courses.size === 12 && [...courses.values()].every((entries) => entries.length === 3);
  const gateB = topology && diagnostics.humptyCradleContacts > 0 && diagnostics.cradleTowerContacts > 0 && diagnostics.humptyVisibleSupportGap < .02;
  const gateC =
    snapshot.completedFixtures.includes("transport") &&
    snapshot.workers.length === 6 &&
    diagnostics.workerPenetrations === 0 &&
    diagnostics.carriedPartPenetrations === 0 &&
    diagnostics.deepBodyPenetrations === 0;
  const approvedFamilies = new Set(["beam", "hub", "axle", "wheel", "sheave", "drum", "plank", "rope", "wedge"]);
  const parts = snapshot.bodies.filter((body) => body.kind === "part");
  const gateD =
    diagnostics.inventoryByTeam.king === 24 &&
    diagnostics.inventoryByTeam.queen === 24 &&
    parts.every((part) => part.family && approvedFamilies.has(part.family)) &&
    parts.every((part) => Math.abs(part.position.x) > 5.9 || part.stored === false);
  const rows = [
    ["A", "One world", gateA],
    ["B", "Grounded king", gateB],
    ["C", "Workers carry", gateC],
    ["D", "Opening kit", gateD],
    ["E", "Lever + ramp", snapshot.completedFixtures.includes("lever") && snapshot.completedFixtures.includes("ramp")],
    ["F", "Wheeled ram", snapshot.completedFixtures.includes("ram")],
    ["G", "Routed hoist", snapshot.completedFixtures.includes("hoist")],
    ["H", "Autonomous", completed.has("autonomous") || (snapshot.match.driver !== "manual" && snapshot.match.moves > 0)],
    ["I", "LLM match", completed.has("llm") || (snapshot.match.driver === "llm" && diagnostics.llmEnabled)],
  ] as const;
  let passCount = 0;
  let currentCount = 0;
  gateList.replaceChildren(...rows.map(([letter, label, pass], index) => {
    if (pass) passCount += 1;
    const current = !pass && rows.slice(0, index).every((row) => row[2]);
    if (current) currentCount += 1;
    const state = pass ? "pass" : current ? "current" : "locked";
    const stateLabel = pass ? "Cleared" : current ? "Next" : "Inactive";
    const item = document.createElement("li");
    item.className = state;
    item.dataset.state = state;
    item.title = `Gate ${letter}: ${stateLabel}. ${label}`;
    item.setAttribute("aria-label", `Gate ${letter}, ${label}, ${stateLabel}`);
    const heading = document.createElement("b");
    heading.textContent = `Gate ${letter}`;
    const detail = document.createElement("span");
    detail.textContent = label;
    const status = document.createElement("em");
    status.textContent = stateLabel;
    item.append(heading, detail, status);
    return item;
  }));
  gateSummary.textContent = `${passCount}/9 cleared · ${currentCount > 0 ? `${currentCount} next` : "all staged"}`;
}

function renderDiagnostics(snapshot: CoreSnapshot): void {
  const d = snapshot.diagnostics;
  engineeringTick.textContent = `tick ${snapshot.tick}`;
  const values: Array<[string, string | number]> = [
    ["Authority", `${d.physicsAdapter} / ${d.physicsWorlds} world`],
    ["Units", d.units],
    ["Dynamic bodies", d.dynamicBodies],
    ["Tenon / bearing joints", `${d.jointsByClass.TENON_LOCK} / ${d.jointsByClass.AXLE_BEARING}`],
    ["Keyed / rope joints", `${d.jointsByClass.KEYED_COAXIAL} / ${d.jointsByClass.ROPE_ATTACH}`],
    ["Tower bodies", d.towerBodies],
    ["King / Queen parts", `${d.inventoryByTeam.king} / ${d.inventoryByTeam.queen}`],
    ["Humpty / cradle contacts", d.humptyCradleContacts],
    ["Cradle / tower contacts", d.cradleTowerContacts],
    ["Visible support gap", `${d.humptyVisibleSupportGap.toFixed(4)} m`],
    ["Illegal pose writes", d.illegalTransformWrites],
    ["Deep penetrations", d.deepBodyPenetrations],
    ["Late inventory", d.lateCreatedInventory],
    ["Client Ammo bodies", window.__HUMPTY_LAB__?.ammoBodies ?? 0],
    ["Render lag", `${(window.__HUMPTY_LAB__?.maxPoseDivergence ?? 0).toFixed(4)} m`],
    ["Agent driver", snapshot.match.driver.toUpperCase()],
  ];
  engineeringValues.replaceChildren(...values.map(([label, value]) => {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    term.textContent = label;
    detail.textContent = String(value);
    row.append(term, detail);
    return row;
  }));
}

function populateTargets(snapshot: CoreSnapshot): void {
  if (targetSelect.options.length > 1) return;
  const options = snapshot.bodies
    .filter((body) => body.kind === "part" || body.kind === "tower-block" || body.kind === "cradle" || body.kind === "queen-device" || body.kind === "queen-bolt")
    .sort((left, right) => left.id.localeCompare(right.id));
  for (const body of options) {
    const option = document.createElement("option");
    option.value = body.id;
    option.textContent = body.kind === "part" ? `${body.team}: ${body.family} ${body.variant ?? ""}` : body.kind === "queen-device" ? "queen: command post" : body.kind === "queen-bolt" ? `queen: ${body.variant ?? "crown bolt"}` : body.id;
    targetSelect.append(option);
    secondarySelect.append(option.cloneNode(true));
  }
  workerSelect.replaceChildren(...snapshot.workers.map((worker) => {
    const option = document.createElement("option");
    option.value = worker.id;
    option.textContent = `${worker.name} (${worker.team})`;
    return option;
  }));
  if (snapshot.workers.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Workers locked";
    workerSelect.append(option);
  }
  issueOrder.disabled = snapshot.workers.length === 0;
}

function setSidebarView(view: "watch" | "archive" | "organize"): void {
  sidebarView = view;
  for (const tab of sidebarTabs) {
    const active = tab.dataset.sidebarView === view;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  }
  for (const panel of sidebarPanels) panel.hidden = panel.dataset.sidebarPanel !== view;
  for (const controls of collapsedViews) controls.hidden = controls.dataset.collapsedView !== view;
  updateSidebarContext();
}

function updateSidebarContext(): void {
  if (sidebarView === "watch") {
    collapsedContext.textContent = replayEntry ? replayTitle(replayEntry.summary) : modeLabel?.textContent ?? "Live match";
    collapsedStatusValue.textContent = replayEntry
      ? replayTime.textContent ?? "00:00"
      : latest ? formatElapsed(latest.elapsed) : "00:00";
    return;
  }
  if (sidebarView === "archive") {
    collapsedContext.textContent = replayEntry ? replayTitle(replayEntry.summary) : "Replay archive";
    collapsedStatusValue.textContent = archiveCount.textContent ?? archiveStatus.textContent ?? "ready";
    return;
  }
  const pace = organizeSpeed.selectedOptions[0]?.textContent ?? "Standard";
  collapsedContext.textContent = `Seed ${organizeSeed.value} · ${pace}`;
  collapsedStatusValue.textContent = organizeStatus.textContent ?? "ready";
}

async function refreshArchiveList(): Promise<void> {
  try {
    const response = await fetch(`/archive?at=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Archive ${response.status}`);
    const payload = await response.json() as { durable: boolean; replays: ReplaySummary[] };
    archiveDurable = payload.durable;
    archiveSummaries = payload.replays;
    archiveStatus.textContent = payload.durable ? "durable archive" : "session archive";
    archiveCount.textContent = `${payload.replays.length} ${payload.replays.length === 1 ? "record" : "records"}`;
    updateSidebarContext();
    renderArchiveList(payload.replays);
    if (payload.replays.length === 0) archiveFeedback.textContent = "No match has been recorded yet.";
  } catch (error) {
    archiveFeedback.textContent = error instanceof Error ? error.message : "Archive unavailable.";
  }
}

async function refreshStaticArchiveList(): Promise<PublicReplaySummary[]> {
  const manifestUrl = new URL("replays/manifest.json", new URL(".", location.href));
  const response = await fetch(manifestUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`Public replays ${response.status}`);
  const manifest = await response.json() as PublicReplayManifest;
  publicReplayBaseUrl = new URL(".", manifestUrl);
  publicReplaySummaries = manifest.replays;
  archiveSummaries = manifest.replays;
  archiveDurable = false;
  archiveStatus.textContent = "public demo reel";
  archiveCount.textContent = `${manifest.replays.length} ${manifest.replays.length === 1 ? "game" : "games"}`;
  archiveFeedback.textContent = `Packaged autonomous games generated for ${manifest.build}.`;
  renderArchiveList(manifest.replays);
  updateSidebarContext();
  return manifest.replays;
}

function renderArchiveList(summaries: ReplaySummary[]): void {
  archiveList.replaceChildren(...summaries.map((summary) => {
    const publicSummary = asPublicReplaySummary(summary);
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.replayId = summary.id;
    button.classList.toggle("active", replayEntry?.summary.id === summary.id);
    const title = document.createElement("span");
    title.className = "archive-row-title";
    const name = document.createElement("strong");
    name.textContent = publicSummary?.title ?? (summary.live ? "Live match" : `Match ${summary.id}`);
    const status = document.createElement("span");
    status.textContent = summary.outcome ? `${summary.outcome} wins` : summary.status;
    title.append(name, status);
    const meta = document.createElement("span");
    meta.className = "archive-row-meta";
    meta.textContent = `seed ${summary.seed} · ${summary.driver === "mock" ? "synthetic" : summary.driver} · ${formatElapsed(summary.duration)} · ${summary.frameCount} frames`;
    button.append(title, meta);
    if (publicSummary?.description) {
      const description = document.createElement("span");
      description.className = "archive-row-description";
      description.textContent = publicSummary.description;
      button.append(description);
    }
    button.addEventListener("click", () => void openReplay(summary.id, { autoplay: true, showWatch: true }));
    item.append(button);
    return item;
  }));
}

function asPublicReplaySummary(summary: ReplaySummary): PublicReplaySummary | undefined {
  return "path" in summary && typeof summary.path === "string"
    ? summary as PublicReplaySummary
    : undefined;
}

async function refreshContraptionSummary(): Promise<void> {
  try {
    const response = await fetch(`/contraptions?at=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Recipes ${response.status}`);
    const payload = await response.json() as { contraptions: Array<{ id: string; hybrid?: boolean }> };
    const hybrids = payload.contraptions.filter((recipe) => recipe.hybrid).length;
    const base = payload.contraptions.filter((recipe) => !recipe.id.includes(":"));
    const variants = payload.contraptions.length - base.length - hybrids;
    organizeRecipeSummary.textContent = `${base.length} base · ${variants} crew variations · ${hybrids} hybrid recipes`;
  } catch {
    organizeRecipeSummary.textContent = "Recipe pool unavailable";
  }
}

async function openReplay(id: string, options: { autoplay?: boolean; showWatch?: boolean } = {}): Promise<void> {
  archiveFeedback.textContent = "Loading public snapshots...";
  try {
    const response = await fetch(replayUrl(id), { cache: "no-store" });
    if (!response.ok) throw new Error(`Replay ${response.status}`);
    replayEntry = await response.json() as ReplayArchiveEntry;
    replayFrameIndex = 0;
    replayPlaying = false;
    syncReplayClockToFrame();
    replayConsole.hidden = false;
    replayName.textContent = "Replay transport";
    watchWorkspaceKicker.textContent = "Recorded theatre";
    watchWorkspaceTitle.textContent = replayTitle(replayEntry.summary);
    archiveFeedback.textContent = staticPreview
      ? `${replayEntry.frames.length} public snapshots ready in Watch.`
      : `${replayEntry.frames.length} snapshots ready in Watch. The live match continues independently.`;
    presentReplayFrame();
    replayPlaying = Boolean(options.autoplay);
    setSidebarView(options.showWatch === false ? "archive" : "watch");
    if (staticPreview) {
      url.searchParams.set("replay", id);
      history.replaceState({}, "", url);
    }
    updateReplayControls();
    if (staticPreview) renderArchiveList(publicReplaySummaries);
    else void refreshArchiveList();
  } catch (error) {
    archiveFeedback.textContent = error instanceof Error ? error.message : "Replay unavailable.";
  }
}

function replayUrl(id: string): string {
  if (!staticPreview) return `/archive/${encodeURIComponent(id)}?at=${Date.now()}`;
  const summary = publicReplaySummaries.find((candidate) => candidate.id === id);
  if (!summary || !publicReplayBaseUrl) throw new Error(`Unknown public replay ${id}`);
  const replayUrl = new URL(summary.path, publicReplayBaseUrl);
  replayUrl.searchParams.set("at", String(Date.now()));
  return replayUrl.href;
}

function replayTitle(summary: ReplaySummary): string {
  const publicSummary = publicReplaySummaries.find((candidate) => candidate.id === summary.id);
  return publicSummary?.title ?? (summary.live ? "Live match snapshot" : `Match ${summary.id}`);
}

function presentReplayFrame(): void {
  const frame = replayEntry?.frames[replayFrameIndex];
  if (!frame || !replayEntry) return;
  presentSnapshot(frame, false);
  replayScrubber.max = String(Math.max(0, replayEntry.frames.length - 1));
  replayScrubber.value = String(replayFrameIndex);
  replayTime.textContent = `${formatElapsed(frame.elapsed)} / ${formatElapsed(replayEntry.summary.duration)}`;
  updateReplayControls();
}

function updateReplayControls(): void {
  const replayButtons = [
    document.querySelector<HTMLButtonElement>('[data-replay-command="play"]'),
    document.querySelector<HTMLButtonElement>('[data-compact-command="watch-toggle"]'),
  ].filter((button): button is HTMLButtonElement => Boolean(button));
  const paused = replayEntry ? !replayPlaying : latest?.paused ?? false;
  const subject = replayEntry ? "replay" : "match";
  for (const button of replayButtons) {
    button.setAttribute("aria-label", paused ? `Play ${subject}` : `Pause ${subject}`);
    button.title = paused ? `Play ${subject}` : `Pause ${subject}`;
    button.classList.toggle("active", !paused);
    setIcon(button, paused ? Play : Pause);
  }
  const stageButton = document.querySelector<HTMLButtonElement>('[data-command="pause"]');
  if (stageButton) {
    stageButton.setAttribute("aria-label", paused ? `Play ${subject}` : `Pause ${subject}`);
    stageButton.title = paused ? `Play ${subject}` : `Pause ${subject}`;
    stageButton.classList.toggle("active", paused);
    setIcon(stageButton, paused ? Play : Pause);
  }
  if (replayEntry) watchWorkspaceStatus.textContent = replayPlaying ? `${replaySpeed.value}x replay` : "replay paused";
  updateSidebarContext();
}

function jumpReplay(seconds: number): void {
  if (!replayEntry) return;
  const current = replayEntry.frames[replayFrameIndex];
  const first = replayEntry.frames[0];
  const final = replayEntry.frames.at(-1);
  if (!current || !first || !final) return;
  const target = Math.max(first.elapsed, Math.min(final.elapsed, current.elapsed + seconds));
  let next = replayEntry.frames.findIndex((frame) => frame.elapsed >= target);
  if (next < 0) next = replayEntry.frames.length - 1;
  replayFrameIndex = next;
  syncReplayClockToFrame();
  presentReplayFrame();
  updateReplayControls();
}

function togglePrimaryPlayback(): void {
  if (replayEntry) {
    if (!replayPlaying && replayFrameIndex >= replayEntry.frames.length - 1) {
      replayFrameIndex = 0;
      presentReplayFrame();
    }
    if (!replayPlaying) syncReplayClockToFrame();
    replayPlaying = !replayPlaying;
    updateReplayControls();
    return;
  }
  void send({ type: "pause" });
  const stageButton = document.querySelector<HTMLButtonElement>('[data-command="pause"]');
  if (!stageButton) return;
  const paused = latest ? !latest.paused : true;
  stageButton.classList.toggle("active", paused);
  stageButton.setAttribute("aria-label", paused ? "Play match" : "Pause match");
  stageButton.title = paused ? "Play match" : "Pause match";
  setIcon(stageButton, paused ? Play : Pause);
}

async function openAdjacentReplay(direction: -1 | 1, showWatch = false): Promise<void> {
  if (archiveSummaries.length === 0) return;
  const currentIndex = replayEntry
    ? archiveSummaries.findIndex((summary) => summary.id === replayEntry?.summary.id)
    : -1;
  const nextIndex = currentIndex < 0
    ? 0
    : (currentIndex + direction + archiveSummaries.length) % archiveSummaries.length;
  const next = archiveSummaries[nextIndex];
  if (next) await openReplay(next.id, { autoplay: showWatch, showWatch });
}

function watchSelectedReplay(): void {
  if (replayEntry) {
    setSidebarView("watch");
    replayPlaying = true;
    updateReplayControls();
    return;
  }
  const first = archiveSummaries[0];
  if (first) void openReplay(first.id, { autoplay: true, showWatch: true });
}

function syncReplayClockToFrame(): void {
  if (!replayEntry) {
    replayClock = 0;
    return;
  }
  const first = replayEntry.frames[0];
  const current = replayEntry.frames[replayFrameIndex];
  replayClock = Math.max(0, (current?.elapsed ?? first?.elapsed ?? 0) - (first?.elapsed ?? 0));
}

function advanceReplay(): void {
  if (!replayPlaying || !replayEntry) return;
  const first = replayEntry.frames[0];
  const final = replayEntry.frames.at(-1);
  if (!first || !final) return;
  replayClock += Number(replaySpeed.value) * .1;
  const targetElapsed = first.elapsed + replayClock;
  let next = replayFrameIndex;
  while (next < replayEntry.frames.length - 1 && (replayEntry.frames[next + 1]?.elapsed ?? Infinity) <= targetElapsed) {
    next += 1;
  }
  if (targetElapsed >= final.elapsed) {
    replayFrameIndex = replayEntry.frames.length - 1;
    replayPlaying = false;
    presentReplayFrame();
    updateReplayControls();
    return;
  }
  if (next !== replayFrameIndex) {
    replayFrameIndex = next;
    presentReplayFrame();
  }
}

function returnToLive(): void {
  replayPlaying = false;
  replayEntry = undefined;
  replayConsole.hidden = true;
  watchWorkspaceKicker.textContent = "Live theatre";
  watchWorkspaceTitle.textContent = "Watch current match";
  updateReplayControls();
  if (latest) presentSnapshot(latest, true);
  archiveStatus.textContent = staticPreview ? "public demo reel" : archiveDurable ? "durable archive" : "session archive";
  archiveFeedback.textContent = staticPreview
    ? "Choose a packaged game from the public replay archive."
    : "The server keeps a session archive of public snapshots.";
  updateSidebarContext();
}

function installControls(): void {
  document.querySelectorAll<HTMLButtonElement>("#controls button").forEach((button) => {
    button.addEventListener("click", () => {
      const command = button.dataset.command;
      if (command === "pause") {
        togglePrimaryPlayback();
      } else if (command === "fit") world.fit();
      else if (command === "poke") void send({ type: "debug-poke" });
      else if (command === "sound") void toggleSound(button);
      else if (command === "engineering") {
        engineering = !engineering;
        engineeringOverlay.hidden = !engineering;
        button.classList.toggle("active", engineering);
      } else if (command === "restart") void send({ type: "reset", seed: 1881 });
    });
  });
  sidebarToggle.addEventListener("click", () => {
    applySidebarState(!sidebarCollapsed);
  });
  for (const tab of sidebarTabs) {
    tab.addEventListener("click", () => {
      const view = tab.dataset.sidebarView as "watch" | "archive" | "organize";
      setSidebarView(view);
    });
  }
  document.querySelectorAll<HTMLButtonElement>("[data-replay-command]").forEach((button) => {
    button.addEventListener("click", () => {
      const command = button.dataset.replayCommand;
      if (!replayEntry && command !== "live") return;
      if (command === "rewind") {
        jumpReplay(-10);
      } else if (command === "fast-forward") {
        jumpReplay(10);
      } else if (command === "play") {
        togglePrimaryPlayback();
      } else if (command === "live") {
        setSidebarView("watch");
        returnToLive();
      }
      updateReplayControls();
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-compact-command]").forEach((button) => {
    button.addEventListener("click", () => {
      const command = button.dataset.compactCommand;
      if (command === "watch-rewind") jumpReplay(-10);
      else if (command === "watch-toggle") togglePrimaryPlayback();
      else if (command === "watch-forward") jumpReplay(10);
      else if (command === "archive-previous") void openAdjacentReplay(-1);
      else if (command === "archive-watch") watchSelectedReplay();
      else if (command === "archive-next") void openAdjacentReplay(1);
      else if (command === "organize-launch") organizeForm.requestSubmit();
    });
  });
  replayScrubber.addEventListener("input", () => {
    if (!replayEntry) return;
    replayPlaying = false;
    replayFrameIndex = Number(replayScrubber.value);
    syncReplayClockToFrame();
    presentReplayFrame();
    updateReplayControls();
  });
  replaySpeed.addEventListener("change", () => {
    syncReplayClockToFrame();
    updateReplayControls();
  });
  replayTimer = window.setInterval(advanceReplay, 100);
  organizeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const seed = Math.max(0, Math.min(999999, Number(organizeSeed.value) || 1881));
    const pace = Number(organizeSpeed.value);
    organizeSeed.value = String(seed);
    organizeStatus.textContent = "launching";
    updateSidebarContext();
    organizeFeedback.textContent = "The current match is being archived and the new theatre is mustering.";
    returnToLive();
    setSidebarView("organize");
    void send({ type: "reset", seed }).then(() => {
      void send({ type: "time-scale", value: pace });
      organizeStatus.textContent = "live";
      organizeFeedback.textContent = `Match seed ${seed} launched at ${pace}x opening pace.`;
      updateSidebarContext();
      void refreshArchiveList();
    });
  });
  actionSelect.addEventListener("change", syncConnectionControls);
  organizeSeed.addEventListener("input", updateSidebarContext);
  organizeSpeed.addEventListener("change", updateSidebarContext);
  syncConnectionControls();
  issueOrder.addEventListener("click", () => {
    const actor = workerSelect.value;
    if (!actor) return;
    const action = actionSelect.value as (typeof LEGAL_ACTIONS)[number];
    const connectionAction = isConnectionAction(action);
    if (connectionAction && (!secondarySelect.value || secondarySelect.value === targetSelect.value)) {
      commandFeedback.textContent = "Choose a different second object for the connection.";
      return;
    }
    const request: LegalActionRequest = {
      action,
      actorIds: [actor],
      ...(targetSelect.value ? { targetId: targetSelect.value } : {}),
      ...(connectionAction ? {
        secondaryId: secondarySelect.value,
        connectionClass: connectionClassSelect.value as (typeof CONNECTION_CLASSES)[number],
      } : {}),
    };
    void send({
      type: "legal-action",
      request,
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-fixture]").forEach((button) => {
    button.addEventListener("click", () => {
      const fixture = button.dataset.fixture as "lever" | "ramp" | "ram" | "hoist" | "transport";
      void send({ type: "run-fixture", fixture });
    });
  });
  window.addEventListener("keydown", (event) => {
    if (event.code === "Space" && event.target === document.body) {
      event.preventDefault();
      togglePrimaryPlayback();
    }
    if (event.target === document.body && event.key === "ArrowLeft" && replayEntry) jumpReplay(-10);
    if (event.target === document.body && event.key === "ArrowRight" && replayEntry) jumpReplay(10);
    if (event.key.toLowerCase() === "r") void send({ type: "reset", seed: 1881 });
    if (event.key.toLowerCase() === "m") {
      const button = document.querySelector<HTMLButtonElement>('[data-command="sound"]');
      if (button) void toggleSound(button);
    }
    if (event.key === "0") world.fit();
  });
}

function readSidebarState(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function applySidebarState(collapsed: boolean, refit = true): void {
  sidebarCollapsed = collapsed;
  document.body.classList.toggle("sidebar-collapsed", collapsed);
  sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
  sidebarToggle.setAttribute("aria-label", collapsed ? "Expand ledger" : "Collapse ledger");
  sidebarToggle.title = collapsed ? "Expand ledger" : "Collapse ledger";
  setIcon(sidebarToggle, collapsed ? PanelRightOpen : PanelRightClose);
  updateSidebarContext();
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  } catch {
    // The control still works when storage is unavailable.
  }
  if (refit) window.setTimeout(() => world.fit(), 190);
}

function syncConnectionControls(): void {
  const action = actionSelect.value as (typeof LEGAL_ACTIONS)[number];
  const connectionAction = isConnectionAction(action);
  secondaryField.hidden = !connectionAction;
  connectionClassField.hidden = !connectionAction;
  const ropeAction = action === "hookRope" || action === "reeveRope";
  connectionClassSelect.disabled = ropeAction;
  if (ropeAction) connectionClassSelect.value = "ROPE_ATTACH";
  else if (connectionClassSelect.value === "ROPE_ATTACH") connectionClassSelect.value = "TENON_LOCK";
}

function isConnectionAction(action: LegalActionRequest["action"]): boolean {
  return action === "connect" || action === "hookRope" || action === "reeveRope";
}

async function send(command: CoreClientCommand): Promise<void> {
  if (staticPreview) {
    commandFeedback.textContent = "Static preview only. Run the theatre server for live orders.";
    return;
  }
  if (socket?.readyState === WebSocket.OPEN && command.type !== "reset" && command.type !== "run-fixture") {
    socket.send(JSON.stringify(command));
    return;
  }
  const response = await fetch("/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  if (response.status !== 204) {
    const result = await response.json() as { message?: string };
    commandFeedback.textContent = result.message ?? (response.ok ? "Order accepted." : "Order rejected.");
  }
}

function renderIcons(): void {
  const iconMap = {
    pause: Pause,
    play: Play,
    "maximize-2": Maximize2,
    hand: Hand,
    eye: Eye,
    history: HistoryIcon,
    "clipboard-list": ClipboardList,
    "skip-back": SkipBack,
    "skip-forward": SkipForward,
    rewind: Rewind,
    "fast-forward": FastForward,
    radio: Radio,
    rocket: Rocket,
    "volume-x": VolumeX,
    wrench: Wrench,
    "rotate-ccw": RotateCcw,
    "panel-right-close": PanelRightClose,
    "chevron-down": ChevronDown,
    send: Send,
  };
  document.querySelectorAll<HTMLElement>("[data-lucide]").forEach((placeholder) => {
    const name = placeholder.dataset.lucide as keyof typeof iconMap;
    const icon = iconMap[name];
    if (icon) placeholder.replaceWith(createLucideElement(icon));
  });
}

async function toggleSound(button: HTMLButtonElement): Promise<void> {
  if (audio.enabled) {
    audio.disable();
    button.classList.remove("active");
    button.setAttribute("aria-label", "Enable sound");
    button.title = "Enable sound";
    setIcon(button, VolumeX);
    return;
  }
  await audio.enable();
  button.classList.add("active");
  button.setAttribute("aria-label", "Mute sound");
  button.title = "Mute sound";
  setIcon(button, Volume2);
  if (!latest) return;
  const humpty = latest.events.find((event) => event.technical === "match:speech:humpty");
  const queen = latest.events.find((event) => event.technical === "match:speech:queen");
  const humptyDuration = speakRoyal(
    "humpty",
    humpty?.text ?? "I should like it noted that I remain the principal load.",
  );
  window.setTimeout(
    () => speakRoyal("queen", queen?.text ?? "Let gravity serve the crown that understands it."),
    humptyDuration * 1000 + 180,
  );
}

function processAudioEvents(snapshot: CoreSnapshot): void {
  if (!receivedFirstSnapshot) {
    for (const event of snapshot.events) seenAudioEvents.add(event.id);
    receivedFirstSnapshot = true;
    return;
  }
  const fresh = snapshot.events.filter((event) => !seenAudioEvents.has(event.id)).reverse();
  for (const event of fresh) {
    seenAudioEvents.add(event.id);
    if (!audio.enabled) continue;
    if (event.technical === "match:speech:humpty") speakRoyal("humpty", event.text);
    else if (event.technical === "match:speech:queen") speakRoyal("queen", event.text);
    else audio.cue(event);
  }
  if (seenAudioEvents.size > 300) {
    const current = new Set(snapshot.events.map((event) => event.id));
    for (const id of seenAudioEvents) if (!current.has(id)) seenAudioEvents.delete(id);
  }
}

function speakRoyal(speaker: RoyalSpeaker, text: string): number {
  const duration = audio.speak(speaker, text);
  if (duration > 0) world.speak(speaker, duration);
  return duration;
}

function setIcon(button: HTMLButtonElement, icon: Parameters<typeof createLucideElement>[0]): void {
  button.replaceChildren(createLucideElement(icon));
}

function actionLabel(action: string): string {
  return action.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
}

function formatElapsed(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

window.addEventListener("beforeunload", () => {
  window.clearTimeout(reconnectTimer);
  stopPolling();
  window.clearInterval(replayTimer);
  window.clearInterval(archiveTimer);
  audio.disable();
  socket?.close();
  world.destroy();
});

void reconnectTimer;
