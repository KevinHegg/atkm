/**
 * Brute-force shot search used to prove each verse is winnable and to gauge difficulty.
 *
 *   npm run solve                      # every verse
 *   npm run solve -- over-the-wall     # one verse
 *   npm run solve -- --write           # record the best line per verse in src/sim/par.json
 *   npm run solve -- --mayhem          # also report the mayhem the par line earns, with and without exploring
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { candidateTargets, machineTargets, mayhemTargets, playOut, settleDrift, type PlannedShot } from "../src/sim/autoplay.js";
import { LEVELS } from "../src/sim/levels.js";
import type { StockKind } from "../src/sim/types.js";

const args = process.argv.slice(2);
const write = args.includes("--write");
const calibrate = args.includes("--mayhem");
const only = args.filter((arg) => !arg.startsWith("--"));
const parPath = resolve(import.meta.dirname, "../src/sim/par.json");
const par: Record<string, PlannedShot[]> = JSON.parse(readFileSync(parPath, "utf8"));

const HUMPTY_OFFSETS = [
  { x: 0, y: 0.2, z: 0 },
  { x: -0.38, y: 0.1, z: 0 },
  { x: 0.38, y: 0.1, z: 0 },
];

interface Win {
  shots: PlannedShot[];
  fall: number;
  stars: number;
  /** Share of nudged variants (aim off a little, fired a little late) that still win. */
  robust: number;
}

const round = (value: number): number => Math.round(value * 100) / 100;
const describe = (shot: PlannedShot): string =>
  `${shot.ammo}${shot.relativeToHumpty ? "→H" : "@"}(${shot.at.x.toFixed(2)}, ${shot.at.y.toFixed(2)}, ${shot.at.z.toFixed(2)})${shot.wait ? ` +${shot.wait}s` : ""}`;

for (const level of LEVELS) {
  if (only.length && !only.includes(level.id)) continue;
  const started = performance.now();
  const drift = await settleDrift(level);
  const targets = await candidateTargets(level);
  // Stage cues and machinery head the target list: they open (and finish) two-shot lines.
  const machines = machineTargets(level).length;
  const cueCount = level.pieces.filter((piece) => piece.kind === "fixture" && piece.cue).length + machines;
  const kinds = (Object.keys(level.ammo) as StockKind[]).filter((kind) => (level.ammo[kind] ?? 0) > 0);
  const moving = level.pieces.some((piece) => piece.kind === "turntable" || piece.kind === "carousel");
  // The carousel's four paddles come round every couple of seconds: time it finely over one turn.
  const carousel = level.pieces.some((piece) => piece.kind === "carousel");
  const waits = carousel ? Array.from({ length: 21 }, (_, index) => index / 10) : moving ? [0, 1, 2, 3, 4, 5, 6, 7, 8] : level.crews.some((crew) => crew.patrol?.length) || level.rat ? [0, 2.5] : [0];
  const singles: PlannedShot[] = [];
  for (const kind of kinds) {
    for (const at of targets) for (const wait of waits) singles.push({ ammo: kind, at: { x: round(at.x), y: round(at.y), z: round(at.z) }, wait });
    for (const at of HUMPTY_OFFSETS) for (const wait of waits) singles.push({ ammo: kind, at, relativeToHumpty: true, wait });
  }

  const wins: Win[] = [];
  for (const shot of singles) {
    const result = await playOut(level, [shot], 16);
    if (result.won) wins.push({ shots: [shot], fall: result.fall, stars: result.stars, robust: 0 });
  }
  const singleRate = wins.length / singles.length;
  if (wins.length < 3) console.log(`  (${level.id}: ${wins.length} one-shot wins; searching two-shot lines…)`);

  // Two-shot lines: any opener (stage cues first), then a shot at Humpty or at what he sits on.
  let pairsTried = 0;
  let pairWins = 0;
  if (wins.length < 3) {
    const cues = singles.filter((shot) => !shot.relativeToHumpty && targets.slice(0, cueCount).some((at) => round(at.x) === shot.at.x && round(at.y) === shot.at.y && round(at.z) === shot.at.z) && !shot.wait);
    const openers = [...cues, ...singles.filter((shot, index) => !shot.relativeToHumpty && index % 2 === 0)].slice(0, 70);
    const perch = level.humpty;
    const under = targets.filter((at) => Math.hypot(at.x - perch.x, at.z - perch.z) < 1 && at.y < perch.y - 0.5).slice(-4);
    // A revolve takes a few seconds to bring the stage round: give the second shot time to wait for it.
    const revolve = level.pieces.some((piece) => piece.kind === "revolve");
    const followWaits = revolve ? [0, 1.5, 3] : [0];
    const follows = (kind: StockKind): PlannedShot[] => [
      ...HUMPTY_OFFSETS.flatMap((offset) => followWaits.map((wait): PlannedShot => ({ ammo: kind, at: offset, relativeToHumpty: true, ...(wait ? { wait } : {}) }))),
      ...under.map((at): PlannedShot => ({ ammo: kind, at: { x: round(at.x), y: round(at.y), z: round(at.z) } })),
      // A second shot at the machinery: bank off the weathercock once it's turned, and so on.
      ...targets.slice(cueCount - machines, cueCount).map((at): PlannedShot => ({ ammo: kind, at: { x: round(at.x), y: round(at.y), z: round(at.z) } })),
    ];
    for (const opener of openers) {
      for (const kind of kinds) {
        const available = (level.ammo[kind] ?? 0) - (kind === opener.ammo ? 1 : 0);
        if (available <= 0) continue;
        for (const follow of follows(kind)) {
          const result = await playOut(level, [opener, follow], 24);
          pairsTried += 1;
          if (result.won) {
            pairWins += 1;
            wins.push({ shots: [opener, follow], fall: result.fall, stars: result.stars, robust: 0 });
          }
        }
      }
    }
  }

  // Hints must survive a human hand: re-run the best candidates with the aim nudged and fired late.
  wins.sort((a, b) => b.stars - a.stars || a.shots.length - b.shots.length || b.fall - a.fall);
  for (const win of wins.slice(0, 40)) {
    const [first, ...rest] = win.shots;
    if (!first) continue;
    const variants: PlannedShot[] = [
      { ...first, at: { ...first.at, x: first.at.x + 0.07 } },
      { ...first, at: { ...first.at, x: first.at.x - 0.07 } },
      { ...first, at: { ...first.at, y: first.at.y + 0.07 } },
      { ...first, at: { ...first.at, y: first.at.y - 0.07 } },
      { ...first, wait: (first.wait ?? 0) + 0.6 },
    ];
    let held = 1;
    for (const variant of variants) if ((await playOut(level, [variant, ...rest], 24)).won) held += 1;
    win.robust = held / (variants.length + 1);
  }

  // Ties go to lines that use more kinds of ammunition (a gong rung with round shot, then the
  // chain), then to the longer fall.
  const variety = (win: Win): number => new Set(win.shots.map((shot) => shot.ammo)).size;
  wins.sort((a, b) => b.robust - a.robust || b.stars - a.stars || a.shots.length - b.shots.length || variety(b) - variety(a) || b.fall - a.fall);
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(`\n${level.id}: drift ${drift.drift.toFixed(3)} (Humpty ${drift.humptyDrift.toFixed(3)})${drift.cracked ? " CRACKED AT REST" : ""} — ${seconds}s`);
  console.log(`  one-shot wins ${Math.round(singleRate * 100)}% of ${singles.length}` + (pairsTried ? `; two-shot wins ${pairWins}/${pairsTried}` : ""));
  for (const win of wins.slice(0, 3)) console.log(`  ✓ ${win.shots.map(describe).join(" then ")} → ${win.fall} m, ${win.stars}★, holds ${Math.round(win.robust * 100)}%`);
  const best = wins[0];
  if (best) par[level.id] = best.shots;
  else console.log("  ✗ NO SOLUTION FOUND");
  if (best && calibrate) {
    // How much mayhem the par line earns alone, and with one exploring round shot fired first.
    const alone = await playOut(level, best.shots, 24);
    let top = { mayhem: alone.mayhem, label: "par alone" };
    for (const target of await mayhemTargets(level)) {
      const line: PlannedShot[] = [{ ammo: "shot", at: target.at }, ...best.shots];
      const result = await playOut(level, line, 30);
      if (result.won && result.mayhem > top.mayhem) top = { mayhem: result.mayhem, label: target.label };
    }
    console.log(`  mayhem: par line ${alone.mayhem}; with one exploring shot ${top.mayhem} (${top.label}); target ${level.mayhem}`);
  }
}

if (write) {
  writeFileSync(parPath, `${JSON.stringify(par, null, 2)}\n`);
  console.log(`\nwrote ${parPath}`);
}
