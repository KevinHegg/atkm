/**
 * Brute-force shot search used to prove each verse is winnable and to gauge difficulty.
 *
 *   npm run solve                      # every verse
 *   npm run solve -- over-the-wall     # one verse
 *   npm run solve -- --write           # record the best line per verse in src/sim/par.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { candidateTargets, playOut, settleDrift, type PlannedShot } from "../src/sim/autoplay.js";
import { LEVELS } from "../src/sim/levels.js";
import type { AmmoKind } from "../src/sim/types.js";

const args = process.argv.slice(2);
const write = args.includes("--write");
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
}

const round = (value: number): number => Math.round(value * 100) / 100;
const describe = (shot: PlannedShot): string =>
  `${shot.ammo}${shot.relativeToHumpty ? "→H" : "@"}(${shot.at.x.toFixed(2)}, ${shot.at.y.toFixed(2)}, ${shot.at.z.toFixed(2)})${shot.wait ? ` +${shot.wait}s` : ""}`;

for (const level of LEVELS) {
  if (only.length && !only.includes(level.id)) continue;
  const started = performance.now();
  const drift = await settleDrift(level);
  const targets = await candidateTargets(level);
  const kinds = (Object.keys(level.ammo) as AmmoKind[]).filter((kind) => (level.ammo[kind] ?? 0) > 0);
  const waits = level.crews.some((crew) => crew.patrol?.length) ? [0, 2.5] : [0];
  const singles: PlannedShot[] = [];
  for (const kind of kinds) for (const at of targets) for (const wait of waits) singles.push({ ammo: kind, at: { x: round(at.x), y: round(at.y), z: round(at.z) }, wait });

  const wins: Win[] = [];
  for (const shot of singles) {
    const result = await playOut(level, [shot], 16);
    if (result.won) wins.push({ shots: [shot], fall: result.fall, stars: result.stars });
  }
  const singleRate = wins.length / singles.length;

  // Two-shot lines: any opener, then a shot at wherever Humpty is.
  let pairsTried = 0;
  let pairWins = 0;
  if (wins.length < 3) {
    const openers = singles.filter((_, index) => index % 2 === 0).slice(0, 70);
    for (const opener of openers) {
      for (const kind of kinds) {
        const available = (level.ammo[kind] ?? 0) - (kind === opener.ammo ? 1 : 0);
        if (available <= 0) continue;
        for (const offset of HUMPTY_OFFSETS) {
          const follow: PlannedShot = { ammo: kind, at: offset, relativeToHumpty: true };
          const result = await playOut(level, [opener, follow], 24);
          pairsTried += 1;
          if (result.won) {
            pairWins += 1;
            wins.push({ shots: [opener, follow], fall: result.fall, stars: result.stars });
          }
        }
      }
    }
  }

  wins.sort((a, b) => b.stars - a.stars || a.shots.length - b.shots.length || b.fall - a.fall);
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(`\n${level.id}: drift ${drift.drift.toFixed(3)} (Humpty ${drift.humptyDrift.toFixed(3)})${drift.cracked ? " CRACKED AT REST" : ""} — ${seconds}s`);
  console.log(`  one-shot wins ${Math.round(singleRate * 100)}% of ${singles.length}` + (pairsTried ? `; two-shot wins ${pairWins}/${pairsTried}` : ""));
  for (const win of wins.slice(0, 3)) console.log(`  ✓ ${win.shots.map(describe).join(" then ")} → ${win.fall} m, ${win.stars}★`);
  const best = wins[0];
  if (best) par[level.id] = best.shots;
  else console.log("  ✗ NO SOLUTION FOUND");
}

if (write) {
  writeFileSync(parPath, `${JSON.stringify(par, null, 2)}\n`);
  console.log(`\nwrote ${parPath}`);
}
