import assert from "node:assert/strict";
import { test } from "node:test";
import { playOut, settleDrift, type PlannedShot } from "../src/sim/autoplay.js";
import { LEVELS } from "../src/sim/levels.js";
import par from "../src/sim/par.json" with { type: "json" };

const solutions = par as Record<string, PlannedShot[]>;

test("verse ids are unique", () => {
  assert.equal(new Set(LEVELS.map((level) => level.id)).size, LEVELS.length);
});

for (const level of LEVELS) {
  test(`${level.id}: stands still until the first shot`, async () => {
    const { drift, cracked, humptyDrift, humptyDrop } = await settleDrift(level, 5);
    assert.ok(!cracked, "Humpty cracked with nobody touching him");
    const ride = level.perch && level.perch !== "highest";
    if (ride) {
      // On a turntable or swing he moves, but he must stay aboard.
      assert.ok(humptyDrop < 0.3, `Humpty sank ${humptyDrop.toFixed(3)} m on his ride`);
    } else {
      assert.ok(humptyDrift < 0.12, `Humpty drifted ${humptyDrift.toFixed(3)} m`);
      assert.ok(drift < 0.15, `the masonry drifted ${drift.toFixed(3)} m`);
    }
  });

  test(`${level.id}: the recorded par solution still cracks Humpty`, async () => {
    const shots = solutions[level.id];
    assert.ok(shots?.length, "run `npm run solve -- --write` to record a solution");
    const result = await playOut(level, shots);
    assert.ok(result.won, `par for ${level.id} no longer wins`);
  });
}
