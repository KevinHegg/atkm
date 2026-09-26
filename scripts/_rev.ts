import { playOut } from "../src/sim/autoplay.js";
import { levelById } from "../src/sim/levels.js";
const level = levelById("the-powder-room")!;
const capstan = { ammo: "shot" as const, at: { x: 7.4, y: 0.6, z: 3.2 } };
for (const wait of [0, 1, 2, 3, 4, 5, 6]) {
  let wins = 0; const notes: string[] = [];
  for (const [x, y] of [[-0.2, 4.6], [0, 4.6], [0.2, 4.6], [0, 4.3], [0, 4.9], [-0.4, 4.6], [0.4, 4.6]]) {
    const r = await playOut(level, [capstan, { ammo: "shot", at: { x: x!, y: y!, z: -1.4 }, wait }], 30);
    if (r.won) wins++; else notes.push(r.landing ? `(${r.landing.x.toFixed(1)},${r.landing.z.toFixed(1)})` : "-");
  }
  console.log(`wait ${wait}: ${wins}/7 ${notes.join(" ")}`);
}
