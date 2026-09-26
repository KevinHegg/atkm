import assert from "node:assert/strict";
import { test } from "node:test";
import { arcPoint, solveLaunch } from "../src/sim/ballistics.js";
import { Game, STEP } from "../src/sim/game.js";
import { Mason, perchAt, type LevelDef } from "../src/sim/level.js";
import { distanceToSegment } from "../src/sim/geometry.js";
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
    mayhem: 0,
    star: { crew: "nobody" },
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

async function stepUntilReady(game: Game): Promise<void> {
  for (let step = 0; step < 240 && !game.canFire(); step += 1) game.step();
  game.drainEvents();
}

test("the music-box turntable carries Humpty round without dropping him", async () => {
  const { levelById } = await import("../src/sim/levels.js");
  const game = await Game.create(levelById("had-a-great-fall")!);
  const start = game.humptyPosition!;
  await run(game, 4);
  const later = game.humptyPosition!;
  assert.ok(Math.hypot(later.x - start.x, later.z - start.z) > 1, "he should have ridden round");
  assert.ok(Math.abs(later.y - start.y) < 0.2, "and still be on his seat");
  game.destroy();
});

test("only chain shot cuts the swing's ropes", async () => {
  const { levelById } = await import("../src/sim/levels.js");
  const level = levelById("hanging-by-a-thread")!;
  const aimAtRope = (game: Game) => {
    const rope = game.ropeViews[0]!;
    return { x: (rope.top.x + rope.bottom.x) / 2, y: (rope.top.y + rope.bottom.y) / 2, z: (rope.top.z + rope.bottom.z) / 2 };
  };
  const shot = await Game.create(level);
  await stepUntilReady(shot);
  shot.select("shot");
  assert.ok(shot.fire(aimAtRope(shot)));
  const shotEvents = await run(shot, 3);
  assert.ok(!shotEvents.some((event) => event.type === "rope-cut"), "round shot must not cut rope");
  shot.destroy();
  let cut = false;
  for (const dy of [0, 0.6, -0.6, 1.2]) {
    const chain = await Game.create(level);
    await stepUntilReady(chain);
    chain.select("chain");
    const at = aimAtRope(chain);
    chain.fire({ ...at, y: at.y + dy });
    cut ||= (await run(chain, 3)).some((event) => event.type === "rope-cut");
    chain.destroy();
    if (cut) break;
  }
  assert.ok(cut, "chain shot should cut a rope");
});

test("an ignored rat steals a charge, but never the last one", async () => {
  const game = await Game.create(arena((mason) => perchAt(0, mason.wall("stone", 0, -1, 4, 5), -1), {
    ammo: { shot: 2 },
    rat: { first: 0.5, every: 1, visits: 3 },
  }));
  const events = await run(game, 60);
  const steals = events.filter((event) => event.type === "rat" && event.action === "steal");
  assert.equal(steals.length, 1, "one theft takes him to his last shot");
  assert.equal(game.ammoLeft, 1);
  game.destroy();
});

test("the Queen's blunderbuss sends the rat packing", async () => {
  const game = await Game.create(arena((mason) => perchAt(0, mason.wall("stone", 0, -1, 4, 5), -1), {
    ammo: { shot: 2 },
    rat: { first: 0.5, every: 30, visits: 1 },
  }));
  const events: GameEvent[] = [];
  for (let step = 0; step < 60 * 12; step += 1) {
    const rat = game.ratView;
    if (rat && game.vermin && game.select("blunderbuss") && game.canFire()) {
      const target = game.bodies.find((body) => body.id === rat.id)!.position;
      game.fire({ x: target.x, y: 0.35, z: target.z });
    }
    game.step();
    events.push(...game.drainEvents());
    if (events.some((event) => event.type === "rat" && event.action === "scared")) break;
  }
  assert.ok(events.some((event) => event.type === "rat" && event.action === "scared"), "the rat should be startled");
  assert.ok(!events.some((event) => event.type === "rat" && event.action === "steal"));
  assert.equal(game.stats.shots, 0, "the blunderbuss does not spend the verse's shot");
  game.destroy();
});

test("striking a curio makes mischief but does not stop the shot", async () => {
  const { CURIOS } = await import("../src/sim/curios.js");
  const game = await Game.create(arena((mason) => perchAt(0, mason.wall("stone", 0, -1, 4, 5), -1)));
  await stepUntilReady(game);
  const moon = CURIOS.find((curio) => curio.id === "moon")!;
  assert.ok(game.fire(moon.at));
  const events = await run(game, 3);
  assert.ok(events.some((event) => event.type === "curio" && event.id === "moon"));
  game.destroy();
});

test("a canopy shields Humpty from a mortar dropped on his head", async () => {
  const game = await Game.create(arena((mason) => {
    const top = mason.pillar("stone", 0, -2, 4, { size: 1.6, height: 1 });
    mason.canopy(0, top, -2);
    return perchAt(0, top, -2);
  }, { ammo: { shell: 1 } }));
  await stepUntilReady(game);
  const h = game.humptyPosition!;
  game.select("shell");
  assert.ok(game.fire({ x: h.x, y: h.y + 0.3, z: h.z }));
  const events = await run(game, 6);
  assert.ok(events.some((event) => event.type === "explode"));
  assert.ok(!events.some((event) => event.type === "crack"), "the canopy should take the blast");
  game.destroy();
});

test("round shot cannot move a maypole, but chain shot cuts it and brings the top down", async () => {
  const build = (ammo: LevelDef["ammo"]) => arena((mason) => perchAt(0, mason.maypole(0, -2, 4.5), -2), { ammo });
  const shot = await Game.create(build({ shot: 1 }));
  await stepUntilReady(shot);
  assert.ok(shot.fire({ x: 0, y: 2.5, z: -2 }));
  const shotEvents = await run(shot, 3);
  assert.ok(!shotEvents.some((event) => event.type === "cut"), "round shot must not cut a maypole");
  assert.ok(Math.abs(shot.humptyPosition!.y - build({}).humpty.y) < 0.1, "Humpty stays up");
  shot.destroy();
  const chain = await Game.create(build({ chain: 1 }));
  await stepUntilReady(chain);
  chain.select("chain");
  assert.ok(chain.fire({ x: 0, y: 2.5, z: -2 }));
  const chainEvents = await run(chain, 5);
  assert.ok(chainEvents.some((event) => event.type === "cut"), "chain shot should cut the maypole");
  assert.ok(chainEvents.some((event) => event.type === "crack"), "with nobody to catch him, the fall cracks him");
  chain.destroy();
});

test("the dinner gong sends every crew to lunch, and they come back", async () => {
  const { LUNCH_BREAK } = await import("../src/sim/crew.js");
  const game = await Game.create(arena((mason) => {
    mason.gong(4, -1);
    return perchAt(0, mason.wall("stone", 0, -1, 2, 6), -1);
  }, {
    crews: [
      { id: "litter", kind: "litter", home: { x: -1.5, y: 0, z: -3 }, yaw: Math.PI / 2, zone: { minX: -9, maxX: 9, minZ: -8, maxZ: 0 } },
      { id: "guard", kind: "guard", home: { x: -2.5, y: 0, z: 2 }, yaw: 0 },
    ],
  }));
  await stepUntilReady(game);
  assert.ok(game.fire({ x: 4, y: 1, z: -1 }));
  const events = await run(game, 6);
  assert.ok(events.some((event) => event.type === "cue" && event.cue === "lunch"));
  assert.ok(game.crewViews.every((crew) => crew.mode === "lunch" && Math.abs(crew.x) > 8), "everyone heads for the wings");
  assert.ok(game.lunchLeft > 0);
  await run(game, LUNCH_BREAK + 10);
  assert.equal(game.lunchLeft, 0);
  for (const crew of game.crewViews) {
    const home = crew.id === "litter" ? { x: -1.5, z: -3 } : { x: -2.5, z: 2 };
    assert.ok(Math.hypot(crew.x - home.x, crew.z - home.z) < 0.3, `${crew.id} is back at their post`);
  }
  game.destroy();
});

test("a fizzing bomb lights its fuse on landing and goes off where it has rolled to", async () => {
  const { BOMB_FUSE } = await import("../src/sim/game.js");
  const game = await Game.create(arena((mason) => perchAt(0, mason.wall("stone", 0, -4, 2, 6), -4), { ammo: { bomb: 1 } }));
  await stepUntilReady(game);
  game.select("bomb");
  assert.ok(game.fire({ x: 3, y: 0, z: 0 }));
  let landed: number | undefined;
  let exploded: number | undefined;
  for (let step = 0; step < 60 * 8 && exploded === undefined; step += 1) {
    game.step();
    if (landed === undefined && game.fuses.length) landed = game.time;
    for (const event of game.drainEvents()) if (event.type === "explode") exploded = game.time;
  }
  assert.ok(landed !== undefined && landed > 1, "the fuse waits for the bomb to land");
  assert.ok(exploded !== undefined && Math.abs(exploded - landed - BOMB_FUSE) < 0.05, "then burns for the fuse time");
  game.destroy();
});

test("a stone wall keeps a blast from setting off the powder behind it", async () => {
  for (const walled of [true, false]) {
    const game = await Game.create(arena((mason) => {
      if (walled) mason.wall("stone", 0, -3, 3, 3, { brick: { x: 1, y: 0.5, z: 0.6 } });
      mason.keg(0, -4.4);
      return perchAt(6, mason.wall("stone", 6, -1, 2, 6), -1);
    }, { ammo: { shell: 1 } }));
    await stepUntilReady(game);
    game.select("shell");
    assert.ok(game.fire({ x: 0, y: 0, z: -2 }));
    const events = await run(game, 5);
    const kegs = events.filter((event) => event.type === "explode" && event.keg).length;
    assert.equal(kegs > 0, !walled, walled ? "the wall should stop the flash" : "an open keg should go up");
    game.destroy();
  }
});

test("mayhem is tallied until the crack and not a moment after", async () => {
  const game = await Game.create(arena((mason) => perchAt(0, mason.wall("oak", 0, -1, 2, 7), -1)));
  await stepUntilReady(game);
  const h = game.humptyPosition!;
  assert.ok(game.fire({ x: h.x, y: h.y + 0.2, z: h.z }));
  const events = await run(game, 6, (event) => event.type === "crack");
  assert.ok(events.some((event) => event.type === "crack"));
  const atCrack = game.mayhem.total;
  assert.ok(atCrack >= 300, "the crack itself is worth something");
  assert.equal(game.mayhem.entries.get("crack")?.count, 1);
  await run(game, 3);
  assert.equal(game.mayhem.total, atCrack, "debris after the crack earns nothing");
  game.destroy();
});

test("each curio pays out once, however often it is struck", async () => {
  const { CURIOS } = await import("../src/sim/curios.js");
  const game = await Game.create(arena((mason) => perchAt(0, mason.wall("stone", 0, -1, 4, 5), -1)));
  const moon = CURIOS.find((curio) => curio.id === "moon")!;
  for (let shot = 0; shot < 2; shot += 1) {
    await stepUntilReady(game);
    assert.ok(game.fire(moon.at));
    await run(game, 3);
  }
  assert.equal(game.mayhem.entries.get("curio")?.count, 1);
  game.destroy();
});

test("a paint pot knocked onto a guard's head blinds his crew for a while", async () => {
  const { BUCKET_TIME } = await import("../src/sim/crew.js");
  const level = arena((mason) => {
    mason.paintPot(2.1, 2.95);
    return perchAt(0, mason.wall("stone", 0, -1, 2, 5), -1);
  }, { crews: [{ id: "guard", kind: "guard", home: { x: 2.4, y: 0, z: 2.44 }, yaw: 0 }] });
  const game = await Game.create(level);
  await stepUntilReady(game);
  const pot = { ...game.bodies.find((body) => body.kind === "bucket")!.position };
  assert.ok(game.fire(pot));
  const events = await run(game, 2);
  assert.ok(events.some((event) => event.type === "mayhem" && event.kind === "bucket"));
  assert.ok(game.crewViews[0]!.bucket && game.crewViews[0]!.mode === "blind");
  await run(game, BUCKET_TIME);
  assert.ok(!game.crewViews[0]!.bucket, "the bucket comes off in the end");
  game.destroy();
});

test("a sandbag swings when shot and only chain shot cuts its line", async () => {
  const build = (ammo: LevelDef["ammo"]) => arena((mason) => {
    mason.sandbag(3, 1.2, -2);
    return perchAt(-3, mason.wall("stone", -3, -1, 2, 5), -1);
  }, { ammo });
  const shot = await Game.create(build({ shot: 1 }));
  await stepUntilReady(shot);
  const bag = { ...shot.bodies.find((body) => body.kind === "sandbag")!.position };
  assert.ok(shot.fire(bag));
  const shotEvents = await run(shot, 2);
  assert.ok(!shotEvents.some((event) => event.type === "rope-cut"), "round shot must not cut the line");
  const swung = shot.bodies.find((body) => body.kind === "sandbag")!.position;
  assert.ok(Math.hypot(swung.x - bag.x, swung.z - bag.z) > 0.5, "the bag swings");
  shot.destroy();
  let cut = false;
  for (const dy of [2, 4, 6]) {
    const chain = await Game.create(build({ chain: 1 }));
    await stepUntilReady(chain);
    chain.select("chain");
    chain.fire({ x: bag.x, y: bag.y + dy, z: bag.z });
    cut ||= (await run(chain, 3)).some((event) => event.type === "rope-cut");
    chain.destroy();
    if (cut) break;
  }
  assert.ok(cut, "chain shot should cut the sandbag's line");
});

test("replaying the shot log reproduces the verse exactly", async () => {
  const { levelById } = await import("../src/sim/levels.js");
  const level = levelById("sat-on-a-wall")!;
  const live = await Game.create(level);
  await stepUntilReady(live);
  for (let step = 0; step < 37; step += 1) live.step();
  assert.ok(live.fire({ x: 0, y: 3.25, z: -1 }));
  await run(live, 8);
  assert.ok(live.cracked);
  const replay = await Game.create(level);
  let next = 0;
  while (replay.steps < live.steps) {
    while (live.log[next] && live.log[next]!.step === replay.steps) {
      replay.select(live.log[next]!.ammo);
      replay.fire(live.log[next]!.at);
      next += 1;
    }
    replay.step();
  }
  assert.equal(replay.cracked, true);
  assert.equal(replay.stats.fall, live.stats.fall);
  assert.equal(replay.mayhem.total, live.mayhem.total);
  assert.deepEqual(replay.humptyPosition, live.humptyPosition);
  live.destroy();
  replay.destroy();
});

test("any munition that reaches a chest forces it open and tops up the battery", async () => {
  for (const ammo of ["shot", "grape"] as const) {
    const game = await Game.create(arena((mason) => {
      mason.chest(-4, -2);
      return perchAt(3, mason.wall("stone", 3, -1, 2, 5), -1);
    }, { ammo: { [ammo]: 2 } }));
    await stepUntilReady(game);
    game.select(ammo);
    const chest = { ...game.bodies.find((body) => body.kind === "chest")!.position };
    assert.ok(game.fire(chest));
    const events = await run(game, 2);
    const opened = events.find((event) => event.type === "chest");
    assert.ok(opened && opened.type === "chest" && opened.gained[ammo] === 3, `${ammo} should force the chest`);
    assert.equal(game.ammo[ammo], 4, "one spent, three gained");
    assert.equal(game.issued[ammo], 5);
    game.destroy();
  }
});

test("the hidden star comes out of its figure, and counts only when he cracks", async () => {
  const game = await Game.create(arena((mason) => perchAt(0, mason.wall("stone", 0, -1, 2, 6), -1), {
    ammo: { shot: 3 },
    star: { crew: "guard" },
    crews: [{ id: "guard", kind: "guard", home: { x: 3, y: 0, z: 1 }, yaw: 0 }],
  }));
  await stepUntilReady(game);
  assert.ok(game.fire({ x: 3, y: 1, z: 1 }));
  const events = await run(game, 3);
  assert.ok(events.some((event) => event.type === "star"), "bowling the guard releases the star");
  assert.ok(game.starFound);
  assert.equal(game.stars().star, false, "not yet: he hasn't cracked");
  await stepUntilReady(game);
  const h = game.humptyPosition!;
  assert.ok(game.fire({ x: h.x, y: h.y + 0.2, z: h.z }));
  await run(game, 6, (event) => event.type === "crack");
  assert.ok(game.cracked);
  assert.equal(game.stars().star, true);
  game.destroy();
});

test("nothing scores before the Queen's first shot", async () => {
  const game = await Game.create(arena(() => perchAt(0, 3, 0)));
  wake(game);
  await run(game, 3);
  assert.ok(game.cracked, "he falls off by himself");
  assert.equal(game.mayhem.total, 0);
  game.destroy();
});

test("the royal bed throws him back up and never breaks him itself", async () => {
  const game = await Game.create(arena((mason) => {
    mason.bouncyBed(0, 0);
    return perchAt(0, 3.5, 0);
  }));
  wake(game);
  let peak = 0;
  let bounced = false;
  let cracked = false;
  for (let step = 0; step < 60 * 2.5; step += 1) {
    game.step();
    for (const event of game.drainEvents()) {
      if (event.type === "bounce") bounced = true;
      if (event.type === "crack") cracked = true;
    }
    if (bounced) peak = Math.max(peak, game.humptyPosition?.y ?? 0);
  }
  assert.ok(bounced, "he lands on the bed and bounces");
  assert.ok(peak > 4.5, `the bed throws him high (peak ${peak.toFixed(1)} m)`);
  assert.ok(!cracked, "the bed itself never cracks him");
  game.destroy();
});

test("the wind machine rocks the cradle harder and harder", async () => {
  const { levelById } = await import("../src/sim/levels.js");
  const game = await Game.create(levelById("rock-a-bye-baby")!);
  await stepUntilReady(game);
  const rest = game.bodies.find((body) => body.material === "cradle")!.position.x;
  const machine = { ...game.bodies.find((body) => body.material === "windmachine")!.position };
  assert.ok(game.fire(machine));
  const events = await run(game, 1.5);
  assert.ok(events.some((event) => event.type === "cue" && event.cue === "wind"));
  assert.ok(game.windy);
  let reach = 0;
  for (let step = 0; step < 60 * 8; step += 1) {
    game.step();
    reach = Math.max(reach, Math.abs(game.bodies.find((body) => body.material === "cradle")!.position.x - 0.6));
  }
  assert.ok(Math.abs(rest - 0.6) < 0.5);
  assert.ok(reach > 2, `the cradle swings out over the boards (${reach.toFixed(1)} m)`);
  game.destroy();
});

test("the stage lever drops the King's men through the trapdoor, and they climb back out", async () => {
  const { levelById } = await import("../src/sim/levels.js");
  const { TRAP_TIME } = await import("../src/sim/crew.js");
  const game = await Game.create(levelById("ring-of-roses")!);
  await stepUntilReady(game);
  const lever = game.bodies.find((body) => body.material === "lever")!.position;
  assert.ok(game.fire({ ...lever, y: lever.y + 0.4 }));
  const events = await run(game, 2.5);
  assert.ok(events.some((event) => event.type === "cue" && event.cue === "trap"));
  assert.ok(game.crewViews.length > 0 && game.crewViews.every((crew) => crew.mode === "trapped"), "every dancer drops");
  assert.equal(game.mayhem.entries.get("trap")?.count, game.crewViews.length);
  assert.ok(game.trapLeft > 0);
  // A second pull while the leaves are open does nothing, and says nothing.
  await stepUntilReady(game);
  assert.ok(game.fire({ ...lever, y: lever.y + 0.4 }));
  const again = await run(game, 2.5);
  assert.ok(again.some((event) => event.type === "impact" && Math.hypot(event.at.x - lever.x, event.at.z - lever.z) < 0.8), "the second shot strikes the lever");
  assert.ok(!again.some((event) => event.type === "cue"), "the lever won't budge until they're back up");
  await run(game, TRAP_TIME + 6);
  assert.equal(game.trapLeft, 0);
  assert.ok(game.crewViews.every((crew) => crew.mode !== "trapped"), "they all climb back up");
  game.destroy();
});

test("while he falls the gun crew reloads double-quick, but never instantly", async () => {
  const reloadTime = async (fall: boolean): Promise<number> => {
    const game = await Game.create(arena(() => perchAt(0, 9, 0), { ammo: { shot: 4 } }));
    await stepUntilReady(game);
    assert.ok(game.fire({ x: 9, y: 0.5, z: 5 }));
    if (fall) wake(game);
    let steps = 0;
    while (!game.canFire() && steps < 600) {
      game.step();
      steps += 1;
    }
    assert.equal(game.humptyAirborne, fall);
    game.destroy();
    return steps * STEP;
  };
  const standing = await reloadTime(false);
  const falling = await reloadTime(true);
  assert.ok(falling < standing * 0.6, `falling ${falling.toFixed(2)} s against ${standing.toFixed(2)} s`);
  assert.ok(falling > 0.4, "no volleys");
});

test("a crew knocked flat drops through the trapdoor and climbs out on its feet, even mid-cheer", async () => {
  const { createCrewState, dropThroughTrap, steerCrew, TRAP_TIME } = await import("../src/sim/crew.js");
  const crew = createCrewState({ id: "c", kind: "litter", home: { x: 0, y: 0, z: 0 } });
  crew.mode = "stunned";
  crew.toppled = 1;
  crew.modeUntil = 5;
  dropThroughTrap(crew, 0);
  assert.equal(crew.toppled, 0);
  let time = 0;
  for (; time < TRAP_TIME + 0.5; time += STEP) steerCrew(crew, STEP, time, undefined, 0.5);
  assert.ok(crew.sink > 0.5, "on the way back up");
  // Humpty cracks mid-climb: everyone cheers, and they still come up out of the floor.
  crew.mode = "cheer";
  crew.modeUntil = time + 99;
  for (let step = 0; step < 60 * 3; step += 1, time += STEP) steerCrew(crew, STEP, time, undefined, 0.5);
  assert.equal(crew.sink, 0);
  assert.equal(crew.mode, "cheer");
});

test("a chest replaces the shot that opened it, then fills the emptiest racks, left to right", async () => {
  const game = await Game.create(arena((mason) => {
    mason.chest(-4, -2);
    return perchAt(3, mason.wall("stone", 3, -1, 2, 5), -1);
  }, { ammo: { shot: 3, shell: 1, bomb: 2 } }));
  await stepUntilReady(game);
  // Spend the only shell well away from the chest, then open it with round shot.
  game.select("shell");
  assert.ok(game.fire({ x: 8, y: 0.3, z: 5 }));
  await run(game, 2);
  await stepUntilReady(game);
  game.select("shot");
  assert.ok(game.fire({ ...game.bodies.find((body) => body.kind === "chest")!.position }));
  const opened = (await run(game, 2)).find((event) => event.type === "chest");
  assert.ok(opened && opened.type === "chest");
  // Round shot back (3 of 3), the empty shell rack next (1 of 1), then a three-way tie: leftmost wins.
  assert.deepEqual(opened.gained, { shot: 2, shell: 1 });
  assert.deepEqual({ shot: game.ammo.shot, shell: game.ammo.shell, bomb: game.ammo.bomb }, { shot: 4, shell: 1, bomb: 2 });
  game.destroy();
});

test("the chain shot's arc stops where its whirling balls will first strike", async () => {
  const { levelById } = await import("../src/sim/levels.js");
  const game = await Game.create(levelById("the-encore")!);
  await stepUntilReady(game);
  game.select("chain");
  // A clear line for a round shot, but not for a chain's balls whirling either side of it.
  const target = { x: 2.5, y: 0.8, z: -1.4 };
  assert.ok((game.aim(target, "shot").hit?.z ?? 0) < 0, "round shot flies clear to the back");
  // A ball clips the guard beside the line of flight (and bowls him over), well short of that.
  const preview = game.aim(target, "chain");
  assert.ok(preview.hit && preview.hit.z > 0.5, `the chain's arc ends early (z ${preview.hit?.z.toFixed(2)})`);
  // Aiming chain shot doesn't leave round shot's arc thinking it's a chain.
  assert.ok((game.aim(target, "shot").hit?.z ?? 0) < 0, "round shot's arc is unchanged after a chain preview");
  game.destroy();
});

test("once he's down safe with nothing left to fire, the curtain doesn't wait for the scenery", async () => {
  const game = await Game.create(arena((mason) => {
    mason.sandbag(3, 1.2, -2);
    return perchAt(-3, 1.1, -1);
  }, { ammo: { shot: 1 } }));
  await stepUntilReady(game);
  // The last shot sets the sandbag swinging for a good long while; he tumbles off his low perch.
  assert.ok(game.fire({ ...game.bodies.find((body) => body.kind === "sandbag")!.position }));
  wake(game);
  const events = await run(game, 14, (event) => event.type === "result");
  assert.ok(!game.cracked);
  assert.equal(game.phase, "lost");
  assert.ok(game.time < 6, `the verse ended ${game.time.toFixed(1)} s in`);
  assert.ok(events.some((event) => event.type === "caught"));
  const bag = game.world.bodies.getAll().find((body) => body.isDynamic() && body.linvel().x ** 2 + body.linvel().z ** 2 > 0.35 ** 2);
  assert.ok(bag, "the sandbag is still swinging when the curtain falls");
});

test("pointing at a swing rope aims at the rope, and chain shot's arc marks the cut it will make", async () => {
  const { levelById } = await import("../src/sim/levels.js");
  const game = await Game.create(levelById("hanging-by-a-thread")!);
  await stepUntilReady(game);
  game.select("chain");
  const rope = game.ropeViews[3]!;
  const on = { x: rope.bottom.x + (rope.top.x - rope.bottom.x) * 0.6, y: rope.bottom.y + (rope.top.y - rope.bottom.y) * 0.6, z: rope.bottom.z + (rope.top.z - rope.bottom.z) * 0.6 };
  // A ray from the front of the house that passes a few centimetres beside the rope snaps onto it.
  const eye = { x: 0.3, y: 9, z: 18 };
  const toward = { x: on.x + 0.04 - eye.x, y: on.y - eye.y, z: on.z - eye.z };
  const length = Math.hypot(toward.x, toward.y, toward.z);
  const picked = game.raycast(eye, { x: toward.x / length, y: toward.y / length, z: toward.z / length })!;
  assert.ok(Math.hypot(picked.x - on.x, picked.y - on.y, picked.z - on.z) < 0.1, "the aim point is on the rope");
  const preview = game.aim(picked, "chain");
  assert.ok(preview.cuts?.some((cut) => Math.hypot(cut.x - on.x, cut.y - on.y, cut.z - on.z) < 0.3), "the cut is marked");
  assert.ok(game.fire(picked));
  assert.ok((await run(game, 2)).some((event) => event.type === "rope-cut"), "and the chain cuts it");
  game.destroy();
});

test("the weathercock turns an eighth of a turn each time it's struck, and bounces the shot", async () => {
  const game = await Game.create(arena((mason) => {
    mason.vane(4, -4, 0.3);
    return perchAt(-6, 1, -6);
  }, { ammo: { shot: 2 } }));
  await stepUntilReady(game);
  const plate = () => game.bodies.find((body) => body.material === "vane")!;
  const yaw = () => 2 * Math.atan2(plate().rotation.y, plate().rotation.w);
  const before = yaw();
  assert.ok(game.fire({ ...plate().position }));
  const events = await run(game, 1.5);
  assert.ok(events.some((event) => event.type === "ricochet"));
  assert.ok(events.some((event) => event.type === "turn"));
  assert.ok(Math.abs(yaw() - before - Math.PI / 4) < 0.01, `turned ${(((yaw() - before) * 180) / Math.PI).toFixed(1)} degrees`);
  game.destroy();
});

test("the portcullis winds up when its counterweight is struck, lets shot through, and comes down again", async () => {
  const { GATE_RISE, GATE_TIME, GATE_FALL } = await import("../src/sim/game.js");
  const game = await Game.create(arena((mason) => {
    mason.gatehouse(0, -3);
    return perchAt(-6, 1, -6);
  }, { ammo: { shot: 2 } }));
  await stepUntilReady(game);
  const through = { x: 0, y: 1.2, z: -3 };
  assert.ok((game.aim(through, "shot").hit?.z ?? -99) > -3.2, "the gate stops the arc");
  assert.ok(game.fire({ ...game.bodies.find((body) => body.material === "counterweight")!.position }));
  const events = await run(game, 2);
  assert.ok(events.some((event) => event.type === "cue" && event.cue === "gate"));
  assert.equal(game.gateView!.lift, 1);
  assert.ok((game.aim(through, "shot").hit?.z ?? -99) < -5, "the arc passes the open gate");
  await run(game, GATE_RISE + GATE_TIME + GATE_FALL);
  assert.equal(game.gateView!.lift, 0);
  game.destroy();
});

test("a bomb dropped in the hopper rolls down the chute and goes off at the far end", async () => {
  const path = [{ x: -3.9, y: 3.6, z: -3 }, { x: -1.4, y: 1.9, z: -4.3 }, { x: 0, y: 0.62, z: -4.3 }, { x: 1.3, y: 0.3, z: -4.3 }];
  const game = await Game.create(arena((mason) => {
    mason.chute(path);
    return perchAt(-7, 1, -7);
  }, { ammo: { bomb: 1 } }));
  await stepUntilReady(game);
  const { hopperFrame } = await import("../src/sim/level.js");
  assert.ok(game.fire(hopperFrame(path).mouth));
  const events = await run(game, 6);
  assert.ok(events.some((event) => event.type === "chute"), "it drops into the hopper");
  const blast = events.find((event) => event.type === "explode");
  assert.ok(blast && blast.type === "explode" && blast.at.x > 0.4 && blast.at.y < 1.2, "and goes off down at the end of the trough");
});

test("the carousel's aim arc bounces off its paddles where they will be when the shot arrives", async () => {
  const level = arena((mason) => {
    mason.carousel(0, -2, { y: 1.9, speed: 0.9 });
    return perchAt(-6, 1, -6);
  }, { ammo: { shot: 1 } });
  // Over a spread of moments and aims, the real ball should follow the predicted bounce closely
  // for the first quarter of a second (a graze on a paddle's very tip is the odd one out).
  let bounced = 0;
  let close = 0;
  for (const wait of [0, 25, 50, 75]) {
    for (const x of [-1.2, -0.8, 0.8, 1.2]) {
      const game = await Game.create(level);
      await stepUntilReady(game);
      for (let step = 0; step < wait; step += 1) game.step();
      const target = { x, y: 1.9, z: -2 };
      const preview = game.aim(target, "shot");
      assert.ok(game.fire(target));
      let hitAt = -1;
      let stray = 0;
      for (let step = 0; step < 60; step += 1) {
        game.step();
        if (hitAt < 0 && game.drainEvents().some((event) => event.type === "ricochet")) hitAt = step;
        const ball = game.bodies.find((body) => body.kind === "shot");
        if (!ball || hitAt < 0 || step > hitAt + 15) continue;
        let nearest = Infinity;
        for (let index = 1; index < preview.points.length; index += 1) nearest = Math.min(nearest, distanceToSegment(ball.position, preview.points[index - 1]!, preview.points[index]!));
        stray = Math.max(stray, nearest);
      }
      if (hitAt >= 0) {
        bounced += 1;
        if (stray < 0.3) close += 1;
      }
      game.destroy();
    }
  }
  assert.ok(bounced >= 12, `${bounced} shots struck a paddle`);
  assert.ok(close / bounced >= 0.75, `${close} of ${bounced} followed the predicted bounce`);
});

test("knock a post from under a sleeping deck and the deck comes down", async () => {
  const game = await Game.create(arena((mason) => {
    for (const x of [-1.05, 1.05]) mason.block("post", x, 0, -4.6, 0.24, 2.9, 0.24);
    mason.slab("plank", 0, 2.902, -4.6, 2.5, 1.1, 0.16);
    return perchAt(-6, 1, -6);
  }));
  await stepUntilReady(game);
  assert.ok(game.fire({ x: 1.05, y: 1.5, z: -4.6 }));
  await run(game, 3);
  const deck = game.bodies.find((body) => body.material === "plank")!;
  assert.ok(deck.position.y < 2, `the deck fell to ${deck.position.y.toFixed(2)} m`);
  game.destroy();
});
