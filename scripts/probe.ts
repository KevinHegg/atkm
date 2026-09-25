/**
 * Grid-test shots on one verse, optionally after an opening shot:
 *   npx tsx scripts/probe.ts <verse-id> <ammo> <xs> <ys> <zs> [opener-json]
 * Ranges are "from:to:step" or comma lists, e.g.
 *   npx tsx scripts/probe.ts chain-of-command chain 0 1:5:0.5 -1.8 '{"ammo":"shot","at":{"x":6.2,"y":1,"z":-1.4}}'
 */
import { playOut, type PlannedShot } from "../src/sim/autoplay.js";
import { levelById } from "../src/sim/levels.js";
import type { StockKind } from "../src/sim/types.js";

const [id, ammo, xs, ys, zs, openerJson] = process.argv.slice(2);
const level = levelById(id ?? "");
if (!level || !ammo || !xs || !ys || !zs) {
  console.error("usage: probe.ts <verse-id> <ammo> <xs> <ys> <zs> [opener-json]");
  process.exit(1);
}
const opener = openerJson ? [JSON.parse(openerJson) as PlannedShot] : [];
const values = (spec: string): number[] => {
  if (!spec.includes(":")) return spec.split(",").map(Number);
  const [from, to, step] = spec.split(":").map(Number) as [number, number, number];
  const out: number[] = [];
  for (let value = from; value <= to + 1e-9; value += step) out.push(Math.round(value * 100) / 100);
  return out;
};
let wins = 0;
let total = 0;
for (const x of values(xs)) {
  for (const y of values(ys)) {
    for (const z of values(zs)) {
      const result = await playOut(level, [...opener, { ammo: ammo as StockKind, at: { x, y, z } }], 30);
      total += 1;
      if (result.won) wins += 1;
      const landing = result.landing ? `(${result.landing.x.toFixed(1)}, ${result.landing.y.toFixed(1)}, ${result.landing.z.toFixed(1)})` : "-";
      console.log(`${ammo}@(${x}, ${y}, ${z}) ${result.won ? "WIN" : "   "} fall ${result.fall.toFixed(1)} ${result.stars}★ landing ${landing} caught ${result.catches}`);
    }
  }
}
console.log(`${wins}/${total} win`);
