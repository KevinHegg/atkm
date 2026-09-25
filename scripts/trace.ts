/** Trace one shot: npx tsx scripts/trace.ts <level-id> <ammo> x y z [wait] */
import { Game } from "../src/sim/game.js";
import { levelById } from "../src/sim/levels.js";
import type { AmmoKind } from "../src/sim/types.js";

const [id, ammo, x, y, z, wait] = process.argv.slice(2);
const level = levelById(id ?? "")!;
const game = await Game.create(level);
const at = { x: Number(x), y: Number(y), z: Number(z) };
let fired = false;
let readyAt = -1;
let lastLog = -1;
while (game.time < 14) {
  if (!fired && game.canFire()) {
    if (readyAt < 0) readyAt = game.time;
    if (game.time - readyAt >= Number(wait ?? 0)) {
      game.select(ammo as AmmoKind);
      fired = game.fire(at);
    }
  }
  game.step();
  const events = game.drainEvents().filter((e) => e.type !== "impact");
  const p = game.humptyPosition;
  const moving = game.humptyAirborne || events.length > 0;
  if (p && (moving && game.time - lastLog > 0.1)) {
    lastLog = game.time;
    const crews = game.crewViews.map((c) => `${c.id}:${c.mode}(${c.x.toFixed(1)},${c.z.toFixed(1)})`).join(" ");
    console.log(`${game.time.toFixed(2)} H(${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}) air=${game.humptyAirborne} ${crews}`);
  }
  for (const e of events) console.log(`  ${game.time.toFixed(2)} ${e.type} ${JSON.stringify(e).slice(0, 140)}`);
  if (game.phase === "won" || game.phase === "lost") break;
}
