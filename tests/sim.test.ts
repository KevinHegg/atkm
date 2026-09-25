import assert from "node:assert/strict";
import { test } from "node:test";
import { arcPoint, solveLaunch } from "../src/sim/ballistics.js";
import { Game, STEP } from "../src/sim/game.js";
import { Mason, perchAt, type LevelDef } from "../src/sim/level.js";
import type { GameEvent } from "../src/sim/types.js";

function arena(build: (mason: Mason) => { x: number; y: number; z: number }, extra: Partial<LevelDef> = {}): LevelDef {
  const mason = new Mason();
  const humpty = build(mason);
  return {
    id: "test",
    title: "Test",
    verse: ["", ""],
    hint: "",
    ammo: { shot: 3 },
    greatFall: 3,
    humpty,
    pieces: mason.pieces,
    crews: [],
    view: { yaw: 0, pitch: -20, distance: 20, target: { x: 0, y: 2, z: 0 } },
    ...extra,
  };
}

async function run(game: Game, seconds: number, until?: (event: GameEvent) => boolean): Promise<GameEvent[]> {
  const events: GameEvent[] = [];
  for (let step = 0; step < Math.round(seconds / STEP); step += 1) {
    game.step();
    for (const event of game.drainEvents()) {
      events.push(event);
      if (until?.(event)) return events;
    }
  }
  return events;
}

function ready(game: Game): void {
  for (let step = 0; step < 120 && !game.canFire(); step += 1) game.step();
  game.drainEvents();
}

function wake(game: Game): void {
  for (const body of game.world.bodies.getAll()) if (body.isDynamic()) body.wakeUp();
}

test("launch solutions pass through the aim point", () => {
  const from = { x: -0.9, y: 1, z: 8.4 };
  const to = { x: 1.5, y: 4, z: -2 };
  for (const lob of [false, true]) {
    const { velocity, reachable } = solveLaunch(from, to, 18, lob);
    assert.ok(reachable);
    const flat = Math.hypot(to.x - from.x, to.z - from.z);
    const t = flat / Math.hypot(velocity.x, velocity.z);
    const point = arcPoint(from, velocity, t);
    assert.ok(Math.hypot(point.x - to.x, point.y - to.y, point.z - to.z) < 1e-6);
  }
});

test("a short drop is safe but a great fall cracks Humpty", async () => {
  for (const [height, cracks] of [[1, false], [3, true]] as const) {
    const game = await Game.create(arena(() => perchAt(0, height, 0)));
    wake(game);
    const events = await run(game, 3, (event) => event.type === "crack");
    assert.equal(events.some((event) => event.type === "crack"), cracks, `drop from ${height} m`);
    game.destroy();
  }
});

test("hay cushions a fall that would otherwise crack him", async () => {
  const game = await Game.create(arena((mason) => {
    mason.hay(0, 0);
    return perchAt(0, 5, 0);
  }));
  wake(game);
  const events = await run(game, 4);
  assert.ok(!events.some((event) => event.type === "crack"));
  assert.ok(events.some((event) => event.type === "caught" && event.by === "hay"));
  game.destroy();
});

test("the stretcher crew runs under a falling Humpty and catches him", async () => {
  const level = arena(() => perchAt(0, 6, -3), {
    crews: [{ id: "litter", kind: "litter", home: { x: -2.5, y: 0, z: -3 }, yaw: Math.PI / 2, zone: { minX: -8, maxX: 8, minZ: -8, maxZ: 2 } }],
  });
  const game = await Game.create(level);
  wake(game);
  const events = await run(game, 5);
  assert.ok(!events.some((event) => event.type === "crack"), "the crew should make the catch");
  assert.ok(events.some((event) => event.type === "caught" && event.by === "litter"));
  game.destroy();
});

test("a safe landing gets Humpty hoisted back onto his wall", async () => {
  const game = await Game.create(arena((mason) => {
    const top = mason.wall("oak", 0, 0, 4, 6);
    for (const z of [-1, -1.8, -2.6, -3.4]) mason.hay(0, z);
    return perchAt(0, top, 0);
  }));
  const start = game.humptyPosition!;
  ready(game);
  const fired = game.fire({ x: start.x, y: start.y + 0.2, z: start.z });
  assert.ok(fired);
  const events = await run(game, 12, (event) => event.type === "hoist-end");
  assert.ok(events.some((event) => event.type === "caught"), "he should land in the hay");
  const end = events.find((event) => event.type === "hoist-end");
  assert.ok(end && end.type === "hoist-end", "the stagehands should hoist him back");
  assert.ok(Math.abs(end.at.y - start.y) < 0.6, "back at roughly his old height");
  assert.equal(game.phase, "aim");
  const body = (game as unknown as { humpty: { body: { mass(): number } } }).humpty.body;
  assert.ok(Math.abs(body.mass() - 90) < 1, "he keeps his mass after the round trip");
  game.destroy();
});

test("running out of shot without cracking him loses the verse", async () => {
  const game = await Game.create(arena((mason) => perchAt(0, mason.wall("stone", 0, 0, 4, 4), 0), { ammo: { shot: 1 } }));
  ready(game);
  assert.ok(game.fire({ x: 6, y: 0, z: 4 }));
  const events = await run(game, 20, (event) => event.type === "result");
  const result = events.find((event) => event.type === "result");
  assert.ok(result && result.type === "result" && !result.won);
  assert.equal(game.stars().count, 0);
  game.destroy();
});

test("mortar shells burst on contact and throw nearby blocks", async () => {
  const game = await Game.create(arena((mason) => {
    mason.pillar("oak", 3, -2, 3);
    return perchAt(-4, mason.pillar("stone", -4, -2, 3), -2);
  }, { ammo: { shell: 1 } }));
  ready(game);
  assert.ok(game.fire({ x: 3, y: 0.4, z: -1.2 }));
  const events = await run(game, 6, (event) => event.type === "explode");
  assert.ok(events.some((event) => event.type === "explode"));
  game.destroy();
});

test("the King's men never crack Humpty by barging or crushing him", async () => {
  // Found in review: recovering crews and a horse cart used to shove or pin him hard enough to crack.
  const { levelById } = await import("../src/sim/levels.js");
  const scenarios: Array<Array<{ ammo: "shot" | "shell" | "chain"; at: { x: number; y: number; z: number } }>> = [
    [{ ammo: "shot", at: { x: 0, y: 0.277, z: -2.4 } }, { ammo: "shell", at: { x: 0, y: 3.803, z: -1.89 } }],
    [{ ammo: "chain", at: { x: 0.51, y: 4.155, z: -2.4 } }],
  ];
  for (const shots of scenarios) {
    const game = await Game.create(levelById("the-encore")!);
    let index = 0;
    const events: GameEvent[] = [];
    while (game.time < 14) {
      const shot = shots[index];
      if (shot && game.canFire()) {
        game.select(shot.ammo);
        if (game.fire(shot.at)) index += 1;
      }
      game.step();
      events.push(...game.drainEvents());
    }
    const crack = events.find((event) => event.type === "crack");
    assert.ok(!crack || (crack.type === "crack" && crack.fall > 0.5), `cracked without a fall: ${JSON.stringify(crack)}`);
    game.destroy();
  }
});
