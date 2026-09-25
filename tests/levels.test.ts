import assert from "node:assert/strict";
import { test } from "node:test";
import { playOut, settleDrift, type PlannedShot } from "../src/sim/autoplay.js";
import { Game } from "../src/sim/game.js";
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

  test(`${level.id}: left alone for a minute, nothing happens by itself`, async () => {
    const game = await Game.create(level);
    let bowled = 0;
    for (let step = 0; step < 60 * 60; step += 1) {
      game.step();
      for (const event of game.drainEvents()) if (event.type === "bowled") bowled += 1;
    }
    assert.ok(!game.cracked, "Humpty cracked with nobody firing");
    assert.equal(game.mayhem.total, 0, "mayhem before the first shot");
    assert.ok(!game.starFound, "the star came out by itself");
    assert.equal(bowled, 0, "a crew was bowled over by the scenery");
    game.destroy();
  });

  test(`${level.id}: the recorded par solution still cracks Humpty`, async () => {
    const shots = solutions[level.id];
    assert.ok(shots?.length, "run `npm run solve -- --write` to record a solution");
    const result = await playOut(level, shots);
    assert.ok(result.won, `par for ${level.id} no longer wins`);
  });
}
