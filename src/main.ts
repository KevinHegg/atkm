import { ChevronsLeft, ChevronsRight, createIcons, RotateCcw, Scan, ScrollText, Volume2, VolumeX } from "lucide";
import { TheatreAudio } from "./audio.js";
import { CURIO_LINES, LINES, type Cue, type Speaker } from "./lines.js";
import { review } from "./review.js";
import { StageView } from "./render/view.js";
import { AMMO } from "./sim/ballistics.js";
import { CHALLENGES } from "./sim/challenges.js";
import { BOMB_FUSE, Game, HUMPTY_REST, STEP } from "./sim/game.js";
import { HUMPTY_BASE } from "./sim/level.js";
import { MAYHEM, type MayhemKind } from "./sim/mayhem.js";
import { LEVELS } from "./sim/levels.js";
import parSolutions from "./sim/par.json" with { type: "json" };
import type { PlannedShot } from "./sim/autoplay.js";
import type { LevelDef } from "./sim/level.js";
import type { AmmoKind, CurioId, GameEvent, StockKind, Vec3 } from "./sim/types.js";

const BASE = import.meta.env.BASE_URL;
/** Tray order and the number keys: 1 shot, 2 shell, 3 grape, 4 chain, 5 bomb, 6 the Queen's blunderbuss. */
const AMMO_ORDER: AmmoKind[] = ["shot", "shell", "grape", "chain", "bomb", "blunderbuss"];
const STOCK_ORDER: StockKind[] = ["shot", "shell", "grape", "chain", "bomb"];
const NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX"];
const numeral = (index: number): string => NUMERALS[index] ?? String(index + 1);
/** Bumped to wipe everyone's stars when the scoring changed (v1 had a different third star). */
const STORAGE_KEY = "great-fall:progress:v2";
const OLD_STORAGE_KEYS = ["great-fall:progress:v1"];

type Screen = "title" | "levels" | "play" | "result" | "replay" | "finale";

interface Progress {
  stars: Record<string, number>;
  /** Best mayhem per verse. */
  best: Record<string, number>;
  muted: boolean;
  /** The Grand Finale has been played for this player. */
  finale?: boolean;
  /** Side challenges done, per verse. */
  challenges?: Record<string, true>;
}

const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
};

function loadProgress(): Progress {
  try {
    for (const key of OLD_STORAGE_KEYS) localStorage.removeItem(key);
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Progress>;
      return { stars: parsed.stars ?? {}, best: parsed.best ?? {}, muted: Boolean(parsed.muted), finale: Boolean(parsed.finale), challenges: parsed.challenges ?? {} };
    }
  } catch {
    // Storage can be unavailable (private windows, embedded previews); progress is then per-session.
  }
  return { stars: {}, best: {}, muted: false, challenges: {} };
}

function saveProgress(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Non-fatal: the game still plays without saved stars.
  }
}

const progress = loadProgress();
const unlockAll = new URLSearchParams(location.search).has("all");
const audio = new TheatreAudio(BASE);
audio.setMuted(progress.muted);
document.documentElement.classList.toggle("muted", progress.muted);
createIcons({ icons: { ChevronsLeft, ChevronsRight, RotateCcw, Scan, ScrollText, Volume2, VolumeX } });

const view = new StageView($("#stage"));
const canvas = view.canvas;
const touchDevice = matchMedia("(pointer: coarse)").matches;
if (touchDevice) {
  for (const hint of document.querySelectorAll<HTMLElement>("#title-screen .controls")) {
    hint.textContent = "Drag to aim · tap Fire · two fingers to look around";
  }
}

let screen: Screen = "title";
let game: Game | undefined;
let levelIndex = 0;
let loading = false;
let accumulator = 0;
let timeScale = 1;
let hitStop = 0;
let crackedAt = -1;
let aimTarget: Vec3 | undefined;
let aimedAt = 0;
let lastAimedLine = -99;
let resultTimer = 0;
let verseOpen = false;
let attractTimer = 0;
const pointer = { x: 0, y: 0, inside: false };
const PAR = parSolutions as Record<string, PlannedShot[]>;
/** Verses lost this session; after a loss the Court Astrologer marks a winning shot. */
const losses = new Map<string, number>();
let hintShot: PlannedShot | undefined;
/** True while the pointer is inside the Astrologer's ring: the shot is then the recorded one. */
let hintLocked = false;
/** Until when the plumb line showing Humpty's height stays up (performance.now ms). */
let plumbUntil = 0;
let plumbHover = false;
let lastHeight = "";
let musicBox = 0;
let musicNote = 0;
let launchCued = false;

// ------------------------------------------------------------------ speech

interface Bubble {
  element: HTMLElement;
  speaker: Speaker;
  until: number;
  /** How far it has been nudged aside from its speaker, eased so it slides rather than jumps. */
  nudge?: { x: number; y: number };
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const bubbles: Bubble[] = [];
const lastLine = new Map<Cue, string>();
const cueCooldown = new Map<Cue, number>();

function say(speaker: Speaker, text: string, seconds = 3.4): void {
  for (const bubble of bubbles.filter((item) => item.speaker === speaker)) dismissBubble(bubble);
  const element = document.createElement("div");
  element.className = `bubble ${speaker}`;
  const name = document.createElement("b");
  name.textContent = speaker === "queen" ? "The Queen" : speaker === "king" ? "Old King Cole" : "Humpty";
  element.append(name, document.createTextNode(text));
  $("#bubbles").append(element);
  bubbles.push({ element, speaker, until: performance.now() + seconds * 1000 });
  if (!audio.voice(text)) audio.mumble(speaker, text);
  if (speaker !== "king") view.talk(speaker, Math.min(seconds, 0.4 + text.length * 0.05));
  positionBubbles();
}

function dismissBubble(bubble: Bubble): void {
  const index = bubbles.indexOf(bubble);
  if (index >= 0) bubbles.splice(index, 1);
  bubble.element.classList.add("leaving");
  window.setTimeout(() => bubble.element.remove(), 260);
}

/** A delayed line that is dropped if the verse was restarted or left in the meantime. */
function later(seconds: number, action: () => void): void {
  const scheduledFor = game;
  window.setTimeout(() => {
    if (game === scheduledFor && screen === "play") action();
  }, seconds * 1000);
}

/** The best mayhem before this attempt, so the result can say whether it was beaten. */
let previousBest = 0;
/** The last of all the stars has just been won: the finale plays instead of the usual result. */
let finalePending = false;

/** Small numbers as the Queen would say them: 60 is "sixty", 48 "forty-eight". */
function inWords(n: number): string {
  const ones = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  if (n < 20) return ones[n]!;
  if (n >= 100) return String(n);
  return tens[Math.floor(n / 10)]! + (n % 10 ? `-${ones[n % 10]}` : "");
}

function totalStars(): number {
  return LEVELS.reduce((sum, level) => sum + (progress.stars[level.id] ?? 0), 0);
}

/** The Grand Finale: the Queen marches to the broken egg and plants her standard. */
function startFinale(): void {
  finalePending = false;
  $("#finale-kicker").textContent = `All ${inWords(LEVELS.length * 3)} stars`;
  progress.finale = true;
  saveProgress();
  for (const bubble of [...bubbles]) dismissBubble(bubble);
  $("#toast").replaceChildren();
  $("#popups").replaceChildren();
  show("finale");
  $("#hud-top").hidden = true;
  view.startFinale();
  audio.fanfare();
  audio.applause(4);
  window.setTimeout(() => screen === "finale" && audio.fanfare(), 4600);
  window.setTimeout(() => screen === "finale" && audio.applause(6), 4800);
  window.setTimeout(() => screen === "finale" && say("queen", `All ${inWords(LEVELS.length * 3)}! The stage is MINE.`, 4), 5200);
}

function recordStars(current: Game): void {
  if (!current.cracked) return;
  const id = current.level.id;
  progress.stars[id] = Math.max(progress.stars[id] ?? 0, current.stars().count);
  progress.best[id] = Math.max(progress.best[id] ?? 0, current.mayhem.total);
  if (current.challengeMet) (progress.challenges ??= {})[id] = true;
  // Marked as seen only once it actually plays (a restart or reload before then keeps it owed).
  if (!progress.finale && totalStars() === LEVELS.length * 3) finalePending = true;
  saveProgress();
}

function cue(kind: Cue, chance = 1, cooldown = 4): void {
  if (Math.random() > chance) return;
  const now = performance.now();
  if (now < (cueCooldown.get(kind) ?? 0)) return;
  cueCooldown.set(kind, now + cooldown * 1000);
  const { speaker, lines } = LINES[kind];
  const options = lines.filter((line) => line !== lastLine.get(kind));
  const line = options[Math.floor(Math.random() * options.length)] ?? lines[0]!;
  lastLine.set(kind, line);
  say(speaker, line);
}

function positionBubbles(): void {
  const now = performance.now();
  // Keep speech clear of the verse title and caption at the top.
  const top = bubbles.length ? $("#hud-top").getBoundingClientRect().bottom + 8 : 0;
  const wanted: Array<{ bubble: Bubble; x: number; y: number; width: number; height: number; visible: boolean }> = [];
  for (const bubble of [...bubbles]) {
    if (now > bubble.until) {
      dismissBubble(bubble);
      continue;
    }
    const anchor = bubble.speaker === "queen" ? view.queenHead() : bubble.speaker === "king" ? view.kingHead() : view.humptyHead();
    if (!anchor) {
      dismissBubble(bubble);
      continue;
    }
    const point = view.project(anchor);
    bubble.element.style.visibility = point.visible ? "visible" : "hidden";
    const width = bubble.element.offsetWidth;
    const height = bubble.element.offsetHeight;
    wanted.push({
      bubble,
      width,
      height,
      visible: point.visible,
      x: Math.min(window.innerWidth - width - 8, Math.max(8, point.x - 30)),
      y: Math.max(top, point.y - height - 14),
    });
  }
  // Speech never sits on top of other speech or of the big shout in the middle: the topmost
  // bubble keeps its place, and the rest step aside (sideways round a shout, down below a bubble).
  const taken: Box[] = [];
  const shout = $("#toast").firstElementChild;
  const shoutBox = shout && now < toastUntil ? shout.getBoundingClientRect() : undefined;
  if (shoutBox) taken.push(shoutBox);
  wanted.sort((a, b) => a.y - b.y);
  for (const want of wanted) {
    let { x, y } = want;
    for (let tries = 0; tries < 4; tries += 1) {
      const hit = taken.find((box) => x < box.right + 6 && x + want.width > box.left - 6 && y < box.bottom + 6 && y + want.height > box.top - 6);
      if (!hit) break;
      const right = hit.right + 8;
      const left = hit.left - want.width - 8;
      if (hit === shoutBox && right + want.width <= window.innerWidth - 8 && (x + want.width / 2 >= (hit.left + hit.right) / 2 || left < 8)) x = right;
      else if (hit === shoutBox && left >= 8) x = left;
      else y = hit.bottom + 8;
    }
    if (want.visible) taken.push({ left: x, top: y, right: x + want.width, bottom: y + want.height });
    const nudge = (want.bubble.nudge ??= { x: x - want.x, y: y - want.y });
    nudge.x += (x - want.x - nudge.x) * 0.25;
    nudge.y += (y - want.y - nudge.y) * 0.25;
    want.bubble.element.style.transform = `translate(${(want.x + nudge.x).toFixed(1)}px, ${(want.y + nudge.y).toFixed(1)}px)`;
  }
}

/** When the current shout has finished its animation (see `.toast-word` in the stylesheet). */
let toastUntil = 0;

function toast(word: string, small = false, subtitle?: string): void {
  toastUntil = performance.now() + 1800;
  const host = $("#toast");
  host.replaceChildren();
  const element = document.createElement("span");
  element.className = `toast-word${small ? " small" : ""}`;
  element.textContent = word;
  if (subtitle) {
    const sub = document.createElement("small");
    sub.textContent = subtitle;
    element.append(sub);
  }
  host.append(element);
}

// ------------------------------------------------------------------ screens

let levelsReturn: Screen = "title";

function show(next: Screen): void {
  if (next === "levels") levelsReturn = screen === "play" && !game?.cracked && game?.phase !== "lost" ? "play" : "title";
  if (next === "title") view.setCameraMode("title");
  screen = next;
  $("#title-screen").hidden = next !== "title";
  $("#levels-screen").hidden = next !== "levels";
  $("#result-screen").hidden = next !== "result";
  if (next !== "finale") $("#finale-screen").hidden = true;
  $("#replay-banner").hidden = next !== "replay";
  const playing = next === "play" || next === "result" || next === "replay";
  $("#hud-top").hidden = !playing;
  $("#hud-bottom").hidden = next !== "play";
  if (next !== "play") $("#fall-meter").hidden = true;
  if (next === "levels") renderLevelList();
}

function unlocked(index: number): boolean {
  if (unlockAll || index === 0) return true;
  // A verse already won stays open, even if a new verse is added before it.
  if ((progress.stars[LEVELS[index]?.id ?? ""] ?? 0) > 0) return true;
  const previous = LEVELS[index - 1];
  return Boolean(previous && (progress.stars[previous.id] ?? 0) > 0);
}

function renderLevelList(): void {
  const list = $("#level-list");
  list.replaceChildren();
  let total = 0;
  let challenges = 0;
  LEVELS.forEach((level, index) => {
    const stars = progress.stars[level.id] ?? 0;
    total += stars;
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.disabled = !unlocked(index);
    const best = progress.best[level.id];
    const challenged = Boolean(progress.challenges?.[level.id]);
    if (challenged) challenges += 1;
    button.innerHTML = `<span class="numeral">Verse ${numeral(index)}</span><span class="name"></span><span class="foot"><span class="stars">${[0, 1, 2].map((star) => `<i class="star${star < stars ? " lit" : ""}"></i>`).join("")}</span>${best ? `<span class="best">Best ${best.toLocaleString("en-GB")}</span>` : ""}${challenged ? `<i class="rosette lit" title="Side challenge done"></i>` : ""}</span>`;
    button.querySelector(".name")!.textContent = button.disabled ? "Locked" : level.title;
    item.classList.toggle("complete", stars === 3);
    button.addEventListener("click", () => {
      audio.unlock();
      audio.click();
      void startLevel(index);
    });
    item.append(button);
    list.append(item);
  });
  const all = total === LEVELS.length * 3;
  $("#star-total").textContent = (all ? `All ${total} stars! The Queen's flag flies over the stage.` : `${total} of ${LEVELS.length * 3} stars`) + (challenges ? ` · ${challenges} of ${LEVELS.length} side challenges` : "");
  $("#star-total").classList.toggle("all", all);
  $("#build-tag").textContent = `v${__BUILD__.version} · ${__BUILD__.commit} · ${__BUILD__.date}`;
}

async function loadGame(index: number): Promise<Game> {
  const level = LEVELS[index]!;
  const next = await Game.create(level);
  game?.destroy();
  game = next;
  levelIndex = index;
  accumulator = 0;
  timeScale = 1;
  hitStop = 0;
  crackedAt = -1;
  aimTarget = undefined;
  aimedAt = 0;
  resultTimer = 0;
  finalePending = false;
  view.bind(next);
  return next;
}

async function startLevel(index: number): Promise<void> {
  if (loading) return;
  loading = true;
  try {
    const next = await loadGame(index);
    const level = next.level;
    for (const bubble of [...bubbles]) dismissBubble(bubble);
    $("#toast").replaceChildren();
    show("play");
    view.setCameraMode("intro");
    $("#hud-number").textContent = `Verse ${numeral(index)}`;
    $("#hud-title").textContent = level.title;
    $("#great-fall").textContent = String(level.greatFall);
    $("#mayhem-target").textContent = level.mayhem.toLocaleString("en-GB");
    $("#mayhem-now").textContent = "0";
    previousBest = progress.best[level.id] ?? 0;
    $("#popups").replaceChildren();
    for (const item of document.querySelectorAll<HTMLElement>("#objectives li")) item.classList.remove("lit", "lost");
    $("#verse-number").textContent = `Verse ${numeral(index)}`;
    $("#verse-title").textContent = level.title;
    $("#verse-lines").innerHTML = "";
    level.verse.forEach((line, lineIndex) => {
      if (lineIndex) $("#verse-lines").append(document.createElement("br"));
      $("#verse-lines").append(document.createTextNode(line));
    });
    $("#verse-hint").textContent = level.hint;
    showChallenge($("#verse-challenge"), level, Boolean(progress.challenges?.[level.id]));
    $("#verse-ammo").textContent = STOCK_ORDER.filter((kind) => (level.ammo[kind] ?? 0) > 0)
      .map((kind) => `${level.ammo[kind]} × ${AMMO[kind].name}`)
      .join("  ·  ");
    hintShot = (losses.get(level.id) ?? 0) > 0 ? PAR[level.id]?.[0] : undefined;
    const timing = hintShot?.wait ? " Timing matters: the stars are fickle." : "";
    $("#hint").textContent = hintShot
      ? `The Court Astrologer has marked a winning shot with a green ring. Aim anywhere inside it and he'll fire ${AMMO[hintShot.ammo].name.toLowerCase()} exactly where it should go.${timing}`
      : level.hint;
    $("#hint").classList.toggle("astrologer", Boolean(hintShot));
    launchCued = false;
    plumbUntil = 0;
    $("#hint").classList.remove("faded");
    $("#fire-button").hidden = !touchDevice;
    verseOpen = true;
    $("#verse-card").hidden = false;
    renderTray();
  } finally {
    loading = false;
  }
}

// ------------------------------------------------------------------ replay

interface ReplayRun {
  original: Game;
  shadow: Game;
  shots: Game["log"];
  next: number;
  lastStep: number;
  /** The step to rewind to before the slow-motion part starts. */
  from: number;
  /** Rewound and on stage. */
  ready: boolean;
}

let replaying: ReplayRun | undefined;

/** Fire the recorded shots that fall due on this step. The simulation is deterministic, so they land the same. */
function fireDue(target: Game, run: ReplayRun): void {
  while (run.next < run.shots.length && run.shots[run.next]!.step <= target.steps) {
    const shot = run.shots[run.next]!;
    run.next += 1;
    target.select(shot.ammo);
    target.fire(shot.at);
  }
}

/** The instant replay: re-run the verse quietly up to the final shot, then show it again, slowly. */
async function startReplay(): Promise<void> {
  const original = game;
  if (!original?.cracked || !original.log.length || loading || replaying) return;
  loading = true;
  try {
    const shadow = await Game.create(original.level);
    const shots = original.log;
    const lastStep = shots[shots.length - 1]!.step;
    // Start just before the last real shot (a blunderbuss blast may have come after it).
    const finale = [...shots].reverse().find((shot) => shot.ammo !== "blunderbuss") ?? shots[shots.length - 1]!;
    replaying = { original, shadow, shots, next: 0, lastStep, from: Math.max(0, finale.step - 75), ready: false };
    $("#replay-banner span").textContent = "Rewinding…";
    show("replay");
  } finally {
    loading = false;
  }
}

/** Rewind a few milliseconds' worth of steps per frame, so a long verse never freezes the page. */
function rewindReplay(run: ReplayRun): void {
  const deadline = performance.now() + 10;
  while (run.shadow.steps < run.from && performance.now() < deadline) {
    fireDue(run.shadow, run);
    run.shadow.step();
  }
  if (run.shadow.steps < run.from) return;
  run.shadow.drainEvents();
  run.ready = true;
  game = run.shadow;
  accumulator = 0;
  timeScale = 0.6;
  hitStop = 0;
  crackedAt = -1;
  for (const bubble of [...bubbles]) dismissBubble(bubble);
  $("#popups").replaceChildren();
  $("#replay-banner span").textContent = "Replay";
  view.bind(run.shadow);
  view.setCameraMode("replay");
}

function endReplay(): void {
  const run = replaying;
  if (!run) return;
  replaying = undefined;
  run.shadow.destroy();
  game = run.original;
  view.bind(run.original);
  view.setCameraMode("play");
  show("result");
}

function closeVerse(): void {
  if (!verseOpen) return;
  verseOpen = false;
  $("#verse-card").hidden = true;
  // Show how high he sits for a few seconds, so "a 5 m fall" means something.
  plumbUntil = performance.now() + 6000;
  if (hintShot) toast("The Astrologer", true, "has marked a winning shot in green");
  later(0.5, () => cue("start", 1, 0));
  later(3.6, () => !game?.cracked && cue("retort", 1, 0));
}

function showResult(): void {
  const current = game;
  if (!current) return;
  const level = current.level;
  const stars = current.stars();
  const won = current.cracked;
  recordStars(current);
  $("#result-kicker").textContent = `Verse ${numeral(levelIndex)} · ${level.title}`;
  $("#result-title").textContent = won ? "Humpty had a great fall" : "All the King's men win";
  $("#result-stars").innerHTML = [0, 1, 2].map((star) => `<i class="star${star < stars.count ? " lit" : ""}"></i>`).join("");
  showChallenge($("#result-challenge"), level, won && current.challengeMet, won && current.challengeMet ? "Side challenge done" : undefined);
  const notice = review({
    won,
    fall: current.stats.fall,
    greatFall: level.greatFall,
    stars: stars.count,
    mayhem: current.mayhem.total,
    tally: current.mayhem.entries,
    shots: current.stats.shots,
    title: level.title,
    starFrom: starHolderName(level.star),
  });
  $("#paper-name").textContent = notice.paper;
  $("#paper-date").textContent = `Verse ${numeral(levelIndex)} · price one penny`;
  $("#paper-headline").textContent = notice.headline;
  $("#paper-body").textContent = notice.body;
  $("#paper-critic").textContent = notice.critic;
  const lines = current.mayhem.lines();
  $("#bill-lines").innerHTML = lines.length
    ? lines
      .map((line) => {
        const detail = line.kind === "crack" ? `${current.stats.fall.toFixed(1)} m fall` : line.count > 1 ? `×${line.count}` : "";
        return `<li><span>${line.bill}${detail ? ` <em>${detail}</em>` : ""}</span><b>${line.points.toLocaleString("en-GB")}</b></li>`;
      })
      .join("")
    : `<li class="none"><span>Nothing broken. Not even the egg.</span><b>0</b></li>`;
  $("#bill-total").textContent = current.mayhem.total.toLocaleString("en-GB");
  const best = progress.best[level.id] ?? 0;
  $("#bill-best").textContent = !won
    ? `Mayhem only counts once he cracks. ${level.mayhem.toLocaleString("en-GB")} for the mayhem star.`
    : current.mayhem.total > previousBest
      ? `A new record for this verse!${stars.mayhem ? "" : ` ${level.mayhem.toLocaleString("en-GB")} for the mayhem star.`}`
      : `Best so far: ${best.toLocaleString("en-GB")}.${stars.mayhem ? "" : ` ${level.mayhem.toLocaleString("en-GB")} for the mayhem star.`}`;
  const hasNext = levelIndex + 1 < LEVELS.length;
  $("#next-button").hidden = !won || !hasNext;
  $("#replay-button").hidden = !won || current.log.length === 0;
  $("#retry-button").classList.toggle("primary", !won || !hasNext);
  show("result");
  if (won) audio.fanfare();
  else audio.sadTrombone();
}

/** A verse's side challenge on a card: its rosette, lit once it's been done. */
function showChallenge(element: HTMLElement, level: LevelDef, done: boolean, heading = done ? "Side challenge (done)" : "Side challenge"): void {
  const challenge = CHALLENGES[level.id];
  element.hidden = !challenge;
  if (!challenge) return;
  element.classList.toggle("done", done);
  element.querySelector(".rosette")!.classList.toggle("lit", done);
  element.querySelector("span")!.textContent = `${heading}: ${challenge.text}`;
}

/** The released star flies from the stage up into its chip in the HUD. */
function flyStarToChip(): void {
  const from = view.risingStarPoint();
  const chip = document.querySelector<HTMLElement>("#objectives [data-star=\"star\"]");
  if (!from?.visible || !chip) return;
  const to = chip.getBoundingClientRect();
  const flyer = document.createElement("div");
  flyer.className = "star-flyer";
  flyer.style.transform = `translate(${from.x}px, ${from.y}px) translate(-50%, -50%) scale(1.4)`;
  document.body.append(flyer);
  requestAnimationFrame(() => {
    flyer.style.transform = `translate(${to.left + 16}px, ${to.top + to.height / 2}px) translate(-50%, -50%) scale(0.5) rotate(216deg)`;
    flyer.style.opacity = "0.9";
  });
  window.setTimeout(() => {
    flyer.remove();
    chip.classList.remove("caught");
    void chip.offsetWidth;
    chip.classList.add("caught");
    audio.tally(200);
  }, 720);
}

/** Who hides the star, as a newspaper would put it. */
function starHolderName(holder: LevelDef["star"]): string {
  if ("rat" in holder) return "the rat";
  if ("curio" in holder) {
    const names: Record<CurioId, string> = {
      cow: "the cow",
      moon: "the moon",
      "jack-and-jill": "Jack and Jill",
      cuckoo: "the cuckoo clock",
      well: "the well",
      spider: "Miss Muffet's spider",
      king: "Old King Cole",
      duke: "the Grand Old Duke's army",
      stagehands: "the stagehands",
      tower: "the royal box",
      pie: "the King's pie",
      mouse: "the clock mouse",
    };
    return names[holder.curio];
  }
  if (holder.crew.startsWith("guard")) return "a King's guard";
  if (holder.crew.startsWith("cart")) return "the King's horses";
  return "a stretcher crew";
}

// ------------------------------------------------------------------ HUD

function ammoIcon(kind: AmmoKind): string {
  const ball = (cx: number, cy: number, r: number): string =>
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor"/><circle cx="${cx - r * 0.35}" cy="${cy - r * 0.35}" r="${r * 0.28}" fill="#fff" opacity=".35"/>`;
  if (kind === "shot") return `<svg viewBox="0 0 40 40" aria-hidden="true">${ball(20, 21, 12)}</svg>`;
  if (kind === "shell") {
    return `<svg viewBox="0 0 40 40" aria-hidden="true">${ball(19, 24, 11)}<path d="M24 14 L29 6" stroke="#c7641a" stroke-width="3" stroke-linecap="round"/><circle cx="30" cy="5" r="3" fill="#e8b23a"/></svg>`;
  }
  if (kind === "grape") {
    return `<svg viewBox="0 0 40 40" aria-hidden="true">${[[13, 14], [26, 13], [20, 22], [11, 27], [28, 27], [19, 32]].map(([x, y]) => ball(x!, y!, 5.5)).join("")}</svg>`;
  }
  if (kind === "bomb") {
    return `<svg viewBox="0 0 40 40" aria-hidden="true">${ball(18, 24, 12)}<rect x="22" y="9" width="7" height="6" rx="1" transform="rotate(35 25 12)" fill="#b8862a"/><path d="M27 9 Q31 3 35 5" stroke="#c7641a" stroke-width="2.5" fill="none" stroke-linecap="round"/><path d="M35 1 L36 4 L39 4 L36.5 6 L37.5 9 L35 7 L32.5 9 L33.5 6 L31 4 L34 4 Z" fill="#e8b23a"/></svg>`;
  }
  if (kind === "blunderbuss") {
    return `<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M6 27 L22 19" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><path d="M21 14 L34 8 L34 26 L21 21 Z" fill="currentColor"/><path d="M4 25 L12 33" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>`;
  }
  return `<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M11 29 Q20 12 29 11" stroke="currentColor" stroke-width="2.5" fill="none" stroke-dasharray="3 2"/>${ball(10, 29, 7)}${ball(30, 11, 7)}</svg>`;
}

function renderTray(): void {
  const current = game;
  const tray = $("#ammo-tray");
  tray.replaceChildren();
  if (!current) return;
  AMMO_ORDER.forEach((kind, index) => {
    const blunderbuss = kind === "blunderbuss";
    const total = blunderbuss ? (current.vermin ? 1 : 0) : current.issued[kind as StockKind];
    if (total <= 0) return;
    const left = blunderbuss ? 1 : current.ammo[kind];
    const button = document.createElement("button");
    button.type = "button";
    button.className = `ammo${current.selected === kind ? " selected" : ""}${left <= 0 ? " empty" : ""}${blunderbuss ? " vermin" : ""}`;
    button.title = `${AMMO[kind].name} (${index + 1}): ${AMMO[kind].blurb}`;
    button.setAttribute("aria-pressed", String(current.selected === kind));
    const pips = blunderbuss
      ? "<em>RAT!</em>"
      : Array.from({ length: total }, (_, pip) => `<b class="${pip < left ? "" : "spent"}"></b>`).join("") + `<small>${left > 0 ? `${left} left` : "none left"}</small>`;
    button.innerHTML = `${ammoIcon(kind)}<span class="label"><strong>${AMMO[kind].name}</strong><span class="pips">${pips}</span></span><kbd>${index + 1}</kbd>`;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      selectAmmo(kind);
    });
    tray.append(button);
  });
  tray.classList.toggle("crowded", tray.children.length >= 4);
}

function selectAmmo(kind: AmmoKind): void {
  if (!game || screen !== "play") return;
  if (game.select(kind)) {
    audio.click();
    renderTray();
  }
}

function updateObjectives(): void {
  const current = game;
  if (!current) return;
  const stars = current.stars();
  const set = (name: string, lit: boolean, lost: boolean): void => {
    const item = document.querySelector<HTMLElement>(`#objectives [data-star="${name}"]`);
    item?.classList.toggle("lit", lit);
    item?.classList.toggle("lost", lost);
  };
  const over = current.phase === "won" || current.phase === "lost";
  set("cracked", stars.cracked, current.phase === "lost");
  set("mayhem", stars.mayhem, over && !stars.mayhem);
  set("star", stars.star, over && !stars.star);
  // Found but not yet earned: it only counts once he cracks.
  const starChip = document.querySelector<HTMLElement>("#objectives [data-star=\"star\"]");
  starChip?.classList.toggle("found", current.starFound && !stars.star);
  const starText = stars.star ? "The hidden star" : current.starFound ? "Star found! Now crack him" : "A hidden star";
  const starState = $("#star-state");
  if (starState.textContent !== starText) starState.textContent = starText;
  const shown = $("#mayhem-now");
  const total = current.mayhem.total.toLocaleString("en-GB");
  if (shown.textContent !== total) shown.textContent = total;
  document.querySelector("#objectives [data-star=\"mayhem\"]")?.classList.toggle("enough", current.mayhem.total >= current.level.mayhem);
}

/** Points float up from wherever the mayhem happened. Rubble is counted in one pop-up, not twenty. */
const openPopups = new Map<MayhemKind, { element: HTMLElement; points: number; count: number; until: number; at: Vec3 }>();

function popup(kind: MayhemKind, points: number, at: Vec3, label?: string): void {
  const now = performance.now();
  const open = openPopups.get(kind);
  if (open && now < open.until && (kind === "masonry" || kind === "hay" || kind === "bowled" || kind === "keg" || kind === "trap")) {
    open.points += points;
    open.count += 1;
    open.element.querySelector("b")!.textContent = `+${open.points}`;
    open.element.querySelector("span")!.textContent = open.count > 1 ? `${MAYHEM[kind].shout} ×${open.count}` : MAYHEM[kind].shout;
    return;
  }
  const host = $("#popups");
  if (host.children.length > 7) host.firstElementChild?.remove();
  const element = document.createElement("div");
  element.className = `popup${kind === "crack" ? " big" : kind === "combo" ? " combo" : ""}`;
  element.innerHTML = `<b>+${points}</b><span>${label ?? MAYHEM[kind].shout}</span>`;
  host.append(element);
  const entry = { element, points, count: 1, until: now + 450, at: { ...at } };
  openPopups.set(kind, entry);
  placePopup(entry);
  window.setTimeout(() => element.remove(), 1500);
}

function placePopup(entry: { element: HTMLElement; at: Vec3 }): void {
  const point = view.project({ x: entry.at.x, y: entry.at.y + 0.8, z: entry.at.z });
  entry.element.hidden = !point.visible;
  entry.element.style.left = `${Math.min(window.innerWidth - 90, Math.max(10, point.x))}px`;
  entry.element.style.top = `${Math.max(90, point.y)}px`;
}

function updateFallMeter(): void {
  const meter = $("#fall-meter");
  const current = game;
  const head = view.humptyHead();
  const showMeter = current && screen === "play" && (current.humptyAirborne || (current.cracked && current.time - crackedAt < 2.2));
  if (!current || !showMeter) {
    meter.hidden = true;
    return;
  }
  const drop = current.cracked ? current.stats.fall : current.humptyDrop;
  if (drop < 0.6) {
    meter.hidden = true;
    return;
  }
  const anchor = head ?? current.humptyPosition;
  if (anchor) {
    const point = view.project(anchor);
    meter.style.transform = `translate(${Math.min(window.innerWidth - 150, point.x + 40)}px, ${Math.max(80, point.y - 20)}px)`;
  }
  meter.hidden = false;
  meter.querySelector("strong")!.textContent = drop.toFixed(1);
  meter.classList.toggle("great", drop >= current.level.greatFall);
  meter.querySelector("em")!.textContent = drop >= current.level.greatFall ? "GREAT fall!" : "fall";
}

/** A surveyor's line from Humpty down to the boards: how far he'd fall if he dropped straight. */
function updatePlumb(): void {
  const plumb = $("#plumb");
  const current = game;
  const h = current?.humptyPosition;
  const chip = $("#height-now");
  if (current && h && screen === "play") {
    const up = current.humptyHeight;
    const text = `· he sits ${up.toFixed(1)} m up`;
    if (text !== lastHeight) {
      lastHeight = text;
      chip.textContent = text;
    }
    chip.classList.toggle("enough", up >= current.level.greatFall);
  }
  const aiming = aimedAt > 0 || plumbHover || performance.now() < plumbUntil;
  const show = current && h && screen === "play" && !verseOpen && !current.humptyAirborne && !current.hoisting && current.phase !== "won" && aiming;
  if (!show || !current || !h) {
    plumb.hidden = true;
    return;
  }
  // Hung a little to his right, like a surveyor's tape, so it never hides behind his perch.
  const x = h.x + 1.1;
  const top = view.project({ x, y: h.y - HUMPTY_BASE, z: h.z });
  const foot = view.project({ x, y: 0, z: h.z });
  const great = view.project({ x, y: current.level.greatFall + HUMPTY_REST, z: h.z });
  if (!top.visible || !foot.visible) {
    plumb.hidden = true;
    return;
  }
  plumb.hidden = false;
  const dx = foot.x - top.x;
  const dy = foot.y - top.y;
  const line = plumb.querySelector<HTMLElement>(".line")!;
  line.style.height = `${Math.hypot(dx, dy)}px`;
  line.style.transform = `translate(${top.x}px, ${top.y}px) rotate(${Math.atan2(-dx, dy)}rad)`;
  const tick = plumb.querySelector<HTMLElement>(".great")!;
  tick.style.transform = `translate(${great.x}px, ${great.y}px)`;
  const label = plumb.querySelector<HTMLElement>("span")!;
  label.style.transform = `translate(${(top.x + foot.x) / 2 + 10}px, ${(top.y + foot.y) / 2}px) translateY(-50%)`;
  label.querySelector("b")!.textContent = current.humptyHeight.toFixed(1);
  plumb.classList.toggle("enough", current.humptyHeight >= current.level.greatFall);
}

/** Label the Astrologer's ring so nobody wonders what the green circle is. */
function updateRingTag(ring: Vec3 | undefined): void {
  const tag = $("#ring-tag");
  const current = game;
  if (!ring || !current?.canFire() || screen !== "play" || verseOpen) {
    tag.hidden = true;
    return;
  }
  const point = view.project({ x: ring.x, y: ring.y + 0.9, z: ring.z });
  tag.hidden = !point.visible;
  tag.classList.toggle("locked", hintLocked);
  tag.style.transform = `translate(${point.x}px, ${point.y}px) translate(-50%, -100%)`;
}

/** Timed stage business the player is waiting on: lunch, for now. */
function updateStatus(): void {
  const status = $("#status");
  const lunch = game && screen === "play" ? game.lunchLeft : 0;
  const trap = game && screen === "play" ? game.trapLeft : 0;
  const gate = game && screen === "play" ? (game.gateView?.left ?? 0) : 0;
  if (lunch <= 0 && trap <= 0 && gate <= 0) {
    status.hidden = true;
    return;
  }
  status.hidden = false;
  const html = lunch > 0
    ? `The King's men are at lunch: back in <b>${Math.ceil(lunch)}</b> s`
    : trap > 0
      ? `The King's men are down the trapdoor: back up in <b>${Math.ceil(trap)}</b> s`
      : `The portcullis is up: it comes down in <b>${Math.ceil(gate)}</b> s`;
  if (status.innerHTML !== html) status.innerHTML = html;
}

// ------------------------------------------------------------------ input

function updateAim(): void {
  const current = game;
  if (screen === "title") return;
  if (!current || screen !== "play" || verseOpen || !current.canFire() || !pointer.inside) {
    view.setAim(undefined);
    if (!current?.canFire()) aimTarget = undefined;
    return;
  }
  const ray = view.screenRay(pointer.x, pointer.y);
  let target = current.raycast(ray.origin, ray.direction);
  if (!target && ray.direction.y < -0.01) {
    const t = -ray.origin.y / ray.direction.y;
    target = { x: ray.origin.x + ray.direction.x * t, y: 0, z: ray.origin.z + ray.direction.z * t };
  }
  aimTarget = target;
  if (!target) {
    view.setAim(undefined);
    return;
  }
  // Inside the Astrologer's ring, the shot becomes exactly the recorded winning shot.
  hintLocked = false;
  const hinted = hintAim(current);
  if (hinted && Math.hypot(target.x - hinted.ring.x, target.y - hinted.ring.y, target.z - hinted.ring.z) < 0.9) {
    hintLocked = true;
    aimTarget = hinted.aim;
    if (current.selected !== hinted.ammo) current.select(hinted.ammo);
  }
  view.setHintLocked(hintLocked);
  const preview = current.aim(aimTarget!);
  view.setAim(preview);
  const humpty = current.humptyPosition;
  const onHumpty = preview.hit && humpty && Math.hypot(preview.hit.x - humpty.x, preview.hit.y - humpty.y, preview.hit.z - humpty.z) < 1.2;
  aimedAt = onHumpty ? aimedAt + 1 : 0;
  if (aimedAt > 40 && performance.now() - lastAimedLine > 22000) {
    lastAimedLine = performance.now();
    cue("aimed", 1, 0);
  }
  view.lookHumptyAt(onHumpty ? { x: -0.9, y: 1, z: 8.4 } : undefined);
}

/** Where the recorded hint shot aims, and where its ring sits (its first contact). */
function hintAim(current: Game): { aim: Vec3; ring: Vec3; ammo: StockKind } | undefined {
  if (!hintShot) return undefined;
  const humpty = current.humptyPosition;
  const aim = hintShot.relativeToHumpty
    ? humpty && { x: humpty.x + hintShot.at.x, y: humpty.y + hintShot.at.y, z: humpty.z + hintShot.at.z }
    : hintShot.at;
  if (!aim) return undefined;
  return { aim, ring: current.aim(aim, hintShot.ammo).hit ?? aim, ammo: hintShot.ammo };
}

function fire(): void {
  const current = game;
  if (!current || screen !== "play" || verseOpen || !aimTarget) return;
  const wasBlunderbuss = current.selected === "blunderbuss";
  if (current.fire(aimTarget)) {
    if (!wasBlunderbuss) {
      if (hintShot) {
        $("#hint").textContent = current.level.hint;
        $("#hint").classList.remove("astrologer");
      }
      $("#hint").classList.add("faded");
      hintShot = undefined;
      hintLocked = false;
      view.setHint(undefined);
      view.setHintLocked(false);
    }
    renderTray();
  }
}

const pointers = new Map<number, { x: number; y: number; startX: number; startY: number; start: number; button: number; type: string; dragged: boolean }>();

canvas.addEventListener("pointerdown", (event) => {
  audio.unlock();
  canvas.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, {
    x: event.clientX,
    y: event.clientY,
    startX: event.clientX,
    startY: event.clientY,
    start: performance.now(),
    button: event.button,
    type: event.pointerType,
    dragged: false,
  });
  pointer.x = event.clientX;
  pointer.y = event.clientY;
  pointer.inside = true;
  if (verseOpen) closeVerse();
});

canvas.addEventListener("pointermove", (event) => {
  const tracked = pointers.get(event.pointerId);
  if (event.pointerType === "mouse" || tracked?.type === "touch") {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.inside = true;
  }
  if (!tracked) return;
  const dx = event.clientX - tracked.x;
  const dy = event.clientY - tracked.y;
  tracked.x = event.clientX;
  tracked.y = event.clientY;
  if (Math.hypot(event.clientX - tracked.startX, event.clientY - tracked.startY) > 8) tracked.dragged = true;
  if (tracked.type === "touch") {
    if (pointers.size >= 2) view.orbit(dx / pointers.size, dy / pointers.size);
  } else if (tracked.dragged || tracked.button !== 0) {
    view.orbit(dx, dy);
  }
});

function release(event: PointerEvent): void {
  const tracked = pointers.get(event.pointerId);
  pointers.delete(event.pointerId);
  if (!tracked || event.type === "pointercancel") return;
  if (tracked.type === "mouse" && tracked.button === 0 && !tracked.dragged) fire();
}

canvas.addEventListener("pointerup", release);
canvas.addEventListener("pointercancel", release);
canvas.addEventListener("pointerleave", (event) => {
  if (event.pointerType === "mouse" && !pointers.size) pointer.inside = false;
});
canvas.addEventListener("contextmenu", (event) => event.preventDefault());
canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  view.zoom(event.deltaY * 0.01);
}, { passive: false });

window.addEventListener("keydown", (event) => {
  if (event.repeat && event.key !== " ") return;
  audio.unlock();
  if (screen === "play") {
    const index = ["1", "2", "3", "4", "5", "6"].indexOf(event.key);
    if (index >= 0) {
      // Keys match the numbers printed on the tray: 1 shot, 2 shell, 3 grape, 4 chain, 5 bomb, 6 blunderbuss.
      const kind = AMMO_ORDER[index];
      if (kind) selectAmmo(kind);
      return;
    }
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (verseOpen) closeVerse();
      else fire();
      return;
    }
    if (event.key === "r" || event.key === "R") void startLevel(levelIndex);
    if (event.key === "c" || event.key === "C") view.resetCamera();
    if (event.key === "Escape") show("levels");
    if (event.key === "ArrowLeft") view.look(-30);
    if (event.key === "ArrowRight") view.look(30);
  } else if (screen === "result" && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    if (game?.cracked && levelIndex + 1 < LEVELS.length) void startLevel(levelIndex + 1);
    else void startLevel(levelIndex);
  } else if (screen === "levels" && event.key === "Escape") {
    show(levelsReturn);
  } else if (screen === "finale" && $("#finale-screen").hidden && (event.key === "Enter" || event.key === " " || event.key === "Escape")) {
    // Skip ahead to the card; the fireworks carry on behind it.
    event.preventDefault();
    revealFinaleCard();
  } else if (screen === "finale" && event.key === "Escape") {
    show("levels");
  }
  if (event.key === "m" || event.key === "M") toggleMute();
});

function toggleMute(): void {
  audio.unlock();
  progress.muted = !progress.muted;
  audio.setMuted(progress.muted);
  document.documentElement.classList.toggle("muted", progress.muted);
  saveProgress();
}

$("#hud-bottom").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
  if (!button) return;
  audio.unlock();
  audio.click();
  const action = button.dataset.action;
  if (action === "menu") show("levels");
  if (action === "restart") void startLevel(levelIndex);
  if (action === "camera") view.resetCamera();
  if (action === "look-left") view.look(-30);
  if (action === "look-right") view.look(30);
  if (action === "mute") toggleMute();
});

$("#fire-button").addEventListener("click", () => fire());
const greatChip = $("#objectives [data-info=\"fall\"]");
greatChip.addEventListener("pointerenter", () => { plumbHover = true; });
greatChip.addEventListener("pointerleave", () => { plumbHover = false; });
$("#verse-go").addEventListener("click", () => {
  audio.unlock();
  audio.click();
  closeVerse();
});
$("#verse-card").addEventListener("pointerdown", (event) => event.stopPropagation());

function firstOpenLevel(): number {
  const index = LEVELS.findIndex((level, levelNumber) => unlocked(levelNumber) && !(progress.stars[level.id] ?? 0));
  return index >= 0 ? index : 0;
}

$("#play-button").addEventListener("click", () => {
  audio.unlock();
  audio.click();
  void startLevel(firstOpenLevel());
});
$("#verses-button").addEventListener("click", () => {
  audio.unlock();
  audio.click();
  show("levels");
});
$("#levels-back").addEventListener("click", () => {
  audio.click();
  show(levelsReturn);
});
$("#next-button").addEventListener("click", () => {
  audio.click();
  void startLevel(Math.min(levelIndex + 1, LEVELS.length - 1));
});
/** The curtain-call card over the finale; its first button takes the keyboard. */
function revealFinaleCard(): void {
  $("#finale-screen").hidden = false;
  $<HTMLButtonElement>("#finale-again").focus({ preventScroll: true });
}
$("#finale-again").addEventListener("click", () => {
  audio.click();
  $("#finale-screen").hidden = true;
  view.startFinale();
  audio.fanfare();
  audio.applause(4);
});
$("#finale-verses").addEventListener("click", () => {
  audio.click();
  show("levels");
});
$("#replay-button").addEventListener("click", () => {
  audio.click();
  void startReplay();
});
$("#replay-skip").addEventListener("click", () => {
  audio.click();
  endReplay();
});
$("#retry-button").addEventListener("click", () => {
  audio.click();
  void startLevel(levelIndex);
});
$("#menu-button").addEventListener("click", () => {
  audio.click();
  show("levels");
});

// ------------------------------------------------------------------ events

function handle(event: GameEvent): void {
  view.react(event);
  const current = game;
  if (!current) return;
  const live = screen === "play";
  switch (event.type) {
    case "fire":
      audio.fire(event.ammo);
      if (live) cue("fire", 0.3, 6);
      break;
    case "impact": {
      audio.impact(event.material, event.strength);
      const humpty = current.humptyPosition;
      if (live && humpty && !current.humptyAirborne && event.material !== "egg" && Math.hypot(event.at.x - humpty.x, event.at.y - humpty.y, event.at.z - humpty.z) < 2.2) {
        cue("nearMiss", 0.35, 9);
      }
      break;
    }
    case "explode":
      audio.explode(event.keg);
      break;
    case "crack":
      // Stars are earned the moment he cracks, even if the player leaves before the curtain.
      if (live) recordStars(current);
      audio.crack();
      audio.cymbal();
      if (live) audio.applause(3);
      hitStop = 0.16;
      crackedAt = current.time;
      if (live) {
        const great = event.fall >= current.level.greatFall;
        toast("Cracked!", false, great ? `A ${event.fall.toFixed(1)} m great fall` : undefined);
        later(0.7, () => cue("crack", 1, 0));
        later(2, () => cue("kingSulk", 0.6, 0));
      }
      break;
    case "caught":
      if (!live) break;
      audio.boing();
      audio.aww();
      later(3.4, () => cue("kingCheer", 0.35, 15));
      toast(event.by === "hay" ? "Saved by the hay" : event.by === "ground" ? "Still in one piece" : "Caught!", true);
      later(0.3, () => cue("caught", 1, 0));
      later(2.2, () => cue("caughtQueen", 0.8, 0));
      break;
    case "hoist-start":
      audio.creak();
      if (live) later(1.4, () => cue("hoist", 0.6, 5));
      break;
    case "challenge":
      if (live) {
        later(1.3, () => {
          audio.flourish();
          toast("Side challenge done!", true, CHALLENGES[current.level.id]?.text);
        });
        later(2.6, () => cue("challenge", 0.8, 0));
      }
      break;
    case "revolved":
      audio.clunk();
      if (live) later(0.5, () => cue("revolved", 0.8, 0));
      break;
    case "slip":
      audio.slip();
      if (live) {
        audio.laugh();
        toast("Whoops!", true, "A banana skin");
        later(0.7, () => cue("slip", 1, 5));
      }
      break;
    case "stung":
      audio.ow();
      if (live) {
        audio.laugh();
        later(0.6, () => cue("stung", 0.5, 8));
      }
      break;
    case "bowled":
      audio.bowled();
      if (live) audio.laugh();
      if (live) cue("bowled", 0.5, 6);
      if (live) later(1.2, () => cue("kingLaugh", 0.3, 14));
      break;
    case "airborne":
      audio.whoosh();
      audio.gasp();
      if (live && current.level.perch === "seesaw" && !launchCued) {
        launchCued = true;
        cue("launch", 1, 0);
      } else if (live) cue("falling", 1, 3);
      break;
    case "ricochet":
      audio.ricochet(event.strength);
      if (live) cue("ricochet", 0.5, 8);
      break;
    case "rope-cut":
      audio.ropeSnap();
      if (live) later(0.3, () => cue("ropeCut", 1, 6));
      break;
    case "spin":
      audio.whirr(event.speed);
      if (live) cue("spin", 0.6, 7);
      break;
    case "curio":
      playCurio(event.id);
      break;
    case "mayhem":
      popup(event.kind, event.points, event.at, event.label);
      audio.tally(event.points);
      if (event.kind === "combo") {
        audio.combo(Number(event.label?.match(/\d+/)?.[0] ?? 3));
        if (live) {
          audio.applause(1.4);
          toast("Trick shot!", true, `${event.label ?? "Combo"} · +${event.points}`);
          later(0.6, () => cue("combo", 1, 4));
        }
      }
      if (live && event.kind === "bucket") {
        audio.clang();
        audio.laugh();
        later(0.5, () => cue("bucket", 1, 6));
      }
      break;
    case "teeter":
      audio.gasp();
      if (live) later(0.25, () => cue("teeter", 1, 5));
      break;
    case "turn":
      audio.creak();
      if (live) later(0.5, () => cue("vane", 0.7, 6));
      break;
    case "smash":
      audio.smash(event.piece);
      if (live) later(0.5, () => cue("china", 0.8, 7));
      break;
    case "dish":
      if (live) {
        audio.laugh();
        toast("Hey diddle diddle!", true, "The dish ran away with the spoon");
        later(2.6, () => cue("dish", 1, 0));
      }
      break;
    case "chute":
      audio.chute();
      if (live) {
        toast("Down the chute!", true);
        later(0.8, () => cue("chute", 1, 5));
      }
      break;
    case "cue":
      if (event.cue === "release") {
        audio.clang();
        audio.tumble();
        if (live) {
          toast("Look out below!", true, "The barrel is rolling");
          later(0.8, () => cue("barrel", 1, 0));
        }
        break;
      }
      if (event.cue === "revolve") {
        audio.clang();
        if (live) {
          toast("Round she goes!", true, "The stagehands are turning the stage");
          later(1, () => cue("revolve", 1, 0));
        }
        break;
      }
      if (event.cue === "hive") {
        audio.rattle();
        if (live) {
          toast("Bees!", true, "They're after the King's men");
          later(0.9, () => cue("bees", 1, 0));
        }
        break;
      }
      if (event.cue === "gate") {
        audio.portcullis();
        if (live) {
          toast("Up she goes!", true, "The portcullis is up");
          later(1, () => cue("gate", 1, 0));
        }
        break;
      }
      if (event.cue === "trap") {
        audio.trapdoor();
        if (live) {
          audio.laugh();
          toast("A-tishoo!", true, "We all fall down");
          later(1.4, () => cue("trapdoor", 1, 0));
        }
        break;
      }
      if (event.cue === "wind") {
        audio.gust();
        if (live) {
          toast("A gale!", true, "The wind machine is blowing");
          later(1.5, () => cue("gale", 1, 0));
        }
        break;
      }
      audio.gong();
      if (live) {
        audio.laugh();
        toast("Luncheon!", true, "The King's men have gone to lunch");
        later(0.4, () => cue("lunch", 1, 0));
        later(3, () => cue("lunchQueen", 1, 0));
      }
      break;
    case "chest": {
      audio.chest();
      if (live) {
        const gained = (Object.entries(event.gained) as Array<[StockKind, number]>).map(([kind, count]) => `+${count} ${AMMO[kind].name.toLowerCase()}`).join(" · ");
        toast("Treasure!", true, gained);
        later(0.6, () => cue("chest", 1, 0));
        renderTray();
      }
      break;
    }
    case "star":
      audio.starChime();
      if (live) {
        audio.gasp();
        audio.applause(1.2);
        // A breath of slow motion so nobody misses it.
        hitStop = Math.max(hitStop, 0.35);
        toast("A hidden star!", true, "It's yours if he cracks");
        later(1.2, () => cue("star", 1, 0));
        later(1.55, flyStarToChip);
      }
      break;
    case "bounce":
      audio.sproing();
      if (live) cue("bounce", 0.6, 5);
      break;
    case "cut":
      audio.chop();
      if (live) {
        audio.gasp();
        later(0.2, () => cue("timber", 1, 3));
      }
      break;
    case "rat":
      if (event.action === "enter") {
        audio.squeak();
        if (live) {
          cue("ratEnter", 1, 0);
          toast("Rat!", true, "Press 6 for the Queen's blunderbuss");
          later(3, () => cue("ratHumpty", 0.5, 20));
        }
      } else if (event.action === "steal") {
        audio.chomp();
        audio.aww();
        if (live) cue("ratSteal", 1, 0);
      } else if (event.action === "scared") {
        audio.squeak();
        audio.laugh();
        if (live) cue("ratScared", 1, 4);
      } else if (event.action === "trapped") {
        audio.snap();
        audio.squeak();
        if (live) {
          audio.laugh();
          toast("Snap!", true, "The rat went for the cheese");
          later(0.8, () => cue("mousetrap", 1, 0));
        }
      }
      if (live) renderTray();
      break;
    case "wobble":
      if (live) cue("wobble", 0.7, 6);
      break;
    case "reload":
      audio.reload();
      if (live) renderTray();
      break;
    case "result":
      if (live) {
        // Leave time to see the stagehand come on with his mop.
        resultTimer = event.won ? 1.6 : 1.4;
        if (!event.won) {
          cue("lose", 1, 0);
          losses.set(current.level.id, (losses.get(current.level.id) ?? 0) + 1);
        }
      }
      break;
    default:
      break;
  }
}

const CURIO_SOUNDS: Record<CurioId, () => void> = {
  king: () => audio.fiddle(),
  duke: () => audio.drumroll(),
  cow: () => audio.moo(),
  moon: () => audio.wink(),
  "jack-and-jill": () => audio.tumble(),
  cuckoo: () => audio.cuckoo(),
  well: () => audio.dingDong(),
  spider: () => audio.zip(),
  stagehands: () => audio.oof(),
  tower: () => audio.rattle(),
  pie: () => audio.birdsong(),
  mouse: () => {
    audio.strikeOne();
    audio.squeak();
  },
};

function playCurio(id: CurioId): void {
  CURIO_SOUNDS[id]();
  audio.laugh();
  if (screen !== "play") return;
  if (id === "king" || id === "tower") {
    cue("kingOutrage", 1, 4);
    return;
  }
  const line = CURIO_LINES[id];
  if (line) later(0.8, () => say(line.speaker, line.line));
}

/** Stage business that runs continuously: the music box and a scurrying rat. */
function playAmbience(current: Game, realDt: number): void {
  const spin = Math.abs(current.turntableSpeed);
  if (spin > 0.01) {
    musicBox += realDt * (2.2 + spin * 2.5);
    if (musicBox >= 1) {
      musicBox = 0;
      audio.musicBoxNote(musicNote++);
    }
  }
  if (current.ratView?.mode === "creep" || current.ratView?.mode === "flee") audio.scurry();
  if (current.windy) audio.gust();
  for (const fuse of current.fuses) audio.fizz(1 - fuse.left / BOMB_FUSE);
  const swarm = current.swarmView;
  audio.buzz(swarm ? (swarm.home ? 0.35 : 1) : 0);
  audio.rumble(current.revolving);
}

/** The house and the pit follow the physics: a roll while he teeters or falls, gasps for close shaves. */
const SHOT_KINDS = new Set(["shot", "shell", "bomb", "grape", "chain"]);
const crowd = {
  game: undefined as Game | undefined,
  /** Each shot's closest pass by Humpty so far, in metres clear of his shell. */
  passes: new Map<number, { closest: number; seen: number; done: boolean }>(),
  frame: 0,
  teeterSince: -1,
  teeterEnded: -1,
};

function listenToCrowd(current: Game): void {
  if (crowd.game !== current) {
    crowd.game = current;
    crowd.passes.clear();
    crowd.teeterSince = -1;
    crowd.teeterEnded = -1;
  }
  crowd.frame += 1;
  const teetering = Boolean(current.teeterView) && !current.cracked;
  const falling = current.humptyAirborne && current.humptyDrop > 0.3 && !current.cracked;
  if (teetering && crowd.teeterSince < 0) crowd.teeterSince = current.time;
  if (!teetering && crowd.teeterSince >= 0) {
    crowd.teeterSince = -1;
    crowd.teeterEnded = current.time;
  }
  // The roll builds the longer he hangs there, holds while we wait to see which way he goes, and
  // runs on through the fall to the crash (or the catch).
  const waiting = crowd.teeterEnded >= 0 && !current.cracked;
  audio.roll(teetering ? Math.min(1, 0.45 + (current.time - crowd.teeterSince) * 0.4) : falling ? 0.85 : waiting ? 0.7 : 0);
  if (crowd.teeterEnded >= 0 && current.time - crowd.teeterEnded > 0.7) {
    crowd.teeterEnded = -1;
    if (!current.humptyAirborne && !current.cracked && !current.teeterView) {
      audio.phew();
      if (screen === "play") cue("phew", 0.6, 8);
    }
  }
  const humpty = current.bodies.find((body) => body.kind === "humpty");
  if (!humpty || current.cracked || current.humptyAirborne) {
    crowd.passes.clear();
    return;
  }
  let loudest = 0;
  const closeness = (pass: { closest: number }): number => (pass.closest <= 0 ? 0 : 1 - pass.closest / 1.4);
  for (const body of current.bodies) {
    if (!SHOT_KINDS.has(body.kind) || body.removed) continue;
    // How far the shot is clear of his shell, taking him as an egg-shaped ellipsoid (taller than wide).
    const r = body.size.x / 2 + 0.06;
    const across = humpty.size.x / 2 + r;
    const tall = humpty.size.y / 2 + r;
    const scaled = Math.hypot((body.position.x - humpty.position.x) / across, (body.position.y - humpty.position.y) / tall, (body.position.z - humpty.position.z) / across);
    const d = (scaled - 1) * across;
    let pass = crowd.passes.get(body.id);
    if (!pass) {
      pass = { closest: d, seen: crowd.frame, done: false };
      crowd.passes.set(body.id, pass);
    }
    pass.seen = crowd.frame;
    if (pass.done) continue;
    pass.closest = Math.min(pass.closest, d);
    // A shot that struck him is no near miss; one on its way out again is.
    if (pass.closest <= 0) pass.done = true;
    else if (d > pass.closest + 0.8) {
      pass.done = true;
      loudest = Math.max(loudest, closeness(pass));
    }
  }
  for (const [id, pass] of crowd.passes) {
    if (pass.seen === crowd.frame) continue;
    // Gone (burst, or rolled away out of play) while still near him.
    if (!pass.done) loudest = Math.max(loudest, closeness(pass));
    crowd.passes.delete(id);
  }
  if (loudest > 0) audio.nearMiss(loudest);
}

let fusesSeen = 0;

/** Little countdowns over lit bombs; Humpty notices one landing near him. */
function updateFuseTags(): void {
  const host = $("#fuse-tags");
  const fuses = game && screen === "play" ? game.fuses : [];
  const humpty = game?.humptyPosition;
  if (fuses.length > fusesSeen && humpty && fuses.some((fuse) => fuse.left > BOMB_FUSE - 0.2 && Math.hypot(fuse.at.x - humpty.x, fuse.at.z - humpty.z) < 4)) {
    cue("fizz", 1, 5);
  }
  fusesSeen = fuses.length;
  while (host.children.length < fuses.length) host.append(document.createElement("span"));
  [...host.children].forEach((child, index) => {
    const tag = child as HTMLElement;
    const fuse = fuses[index];
    if (!fuse) {
      tag.hidden = true;
      return;
    }
    const point = view.project({ x: fuse.at.x, y: fuse.at.y + 0.7, z: fuse.at.z });
    tag.hidden = !point.visible;
    tag.textContent = fuse.left > 0.05 ? Math.ceil(fuse.left).toString() : "!";
    tag.classList.toggle("soon", fuse.left < 1);
    tag.style.transform = `translate(${point.x}px, ${point.y}px) translate(-50%, -100%)`;
  });
}

// ------------------------------------------------------------------ loop

/** The title screen plays itself: the Queen takes pot-shots behind the playbill. */
function attract(realDt: number): void {
  const current = game;
  if (!current || screen !== "title") return;
  attractTimer += realDt;
  if (current.phase === "won" || current.phase === "lost") {
    if (attractTimer > 5 && !loading) {
      attractTimer = 0;
      void loadGame(0);
    }
    return;
  }
  const humpty = current.humptyPosition;
  if (!humpty || !current.canFire()) {
    view.setAim(undefined);
    return;
  }
  // Swing the guns onto him for a moment, then fire.
  const target = { x: humpty.x + Math.sin(attractTimer) * 0.2, y: humpty.y + 0.15, z: humpty.z };
  if (attractTimer > 2.5) view.setAim(current.aim(target));
  if (attractTimer > 4) {
    attractTimer = 0;
    current.fire(target);
    view.setAim(undefined);
  }
}

function tick(realDt: number): void {
  if (replaying && !replaying.ready) {
    // Rewinding: the stage holds still while the tape winds back.
    rewindReplay(replaying);
    view.frame(0, realDt);
    return;
  }
  const current = game;
  if (!current) return;
  let scale = 1;
  if (hitStop > 0) {
    hitStop -= realDt;
    scale = 0.03;
  } else {
    let target = 1;
    if (current.humptyAirborne && current.humptyDrop > 1.2) target = 0.42;
    if (crackedAt >= 0 && current.time - crackedAt < 0.8) target = 0.35;
    // The replay runs in slow motion throughout.
    if (screen === "replay") target *= 0.6;
    timeScale += (target - timeScale) * Math.min(1, realDt * 7);
    scale = timeScale;
  }
  const paused = (screen === "play" && verseOpen) || (screen === "levels" && levelsReturn === "play");
  if (!paused) {
    accumulator += realDt * scale;
    let steps = 0;
    while (accumulator >= STEP && steps < 4) {
      if (replaying) fireDue(current, replaying);
      current.step();
      accumulator -= STEP;
      steps += 1;
    }
    if (steps === 4) accumulator = Math.min(accumulator, STEP);
    for (const event of current.drainEvents()) handle(event);
  }
  attract(realDt);
  updateAim();
  const ring = screen === "play" && hintShot ? hintAim(current)?.ring : undefined;
  if (screen === "play" && hintShot) view.setHint(ring);
  updateRingTag(ring);
  updatePlumb();
  updateStatus();
  updateFuseTags();
  if (screen === "play") playAmbience(current, realDt);
  else {
    audio.buzz(0);
    audio.rumble(false);
  }
  if (screen === "play" || screen === "replay") listenToCrowd(current);
  else audio.roll(0);
  view.sync(Math.min(1, accumulator / STEP));
  view.frame(realDt * scale, realDt);
  positionBubbles();
  updateFallMeter();
  if (screen === "finale" && $("#finale-screen").hidden && view.finaleAge > 9.5) revealFinaleCard();
  if (screen === "replay" && replaying) {
    const late = current.steps > replaying.lastStep + 60 * 14;
    if ((current.cracked && current.time - crackedAt > 2.4) || late) endReplay();
  }
  if (screen === "play" || screen === "replay") updateObjectives();
  if (screen === "play") {
    const fireButton = $<HTMLButtonElement>("#fire-button");
    fireButton.disabled = !current.canFire() || !aimTarget;
    const selected = document.querySelector<HTMLElement>(".ammo.selected");
    selected?.classList.toggle("reloading", current.phase === "flight" && current.reload > 0);
    if (resultTimer > 0) {
      resultTimer -= realDt;
      if (resultTimer <= 0) {
        if (finalePending && current.cracked) startFinale();
        else showResult();
      }
    }
  }
}

view.onUpdate(tick);

declare global {
  interface Window {
    __GREAT_FALL__?: {
      game: () => Game | undefined;
      view: StageView;
      pointer: typeof pointer;
      screen: () => Screen;
      start: (index: number) => Promise<void>;
      advance: (seconds: number) => void;
      /** Play the Grand Finale now (for testing). */
      finale: () => void;
    };
  }
}
window.__GREAT_FALL__ = {
  game: () => game,
  view,
  pointer,
  screen: () => screen,
  start: startLevel,
  finale: () => {
    if (screen === "play" || screen === "result") startFinale();
  },
  /** Fast-forward for automated checks when the tab is not painting frames. */
  advance: (seconds: number) => {
    for (let frame = 0; frame < Math.round(seconds * 60); frame += 1) tick(1 / 60);
  },
};

void loadGame(0).then(() => {
  view.setCameraMode("title");
  show("title");
  const play = $<HTMLButtonElement>("#play-button");
  play.disabled = false;
  play.textContent = Object.keys(progress.stars).length ? "Continue" : "Play";
  $<HTMLButtonElement>("#verses-button").disabled = false;
});
