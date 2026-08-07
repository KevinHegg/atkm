import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { after, before, test } from "node:test";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  CONNECTION_CLASSES,
  CORE_FIXED_DT,
  CORE_MATCH_DURATION_SECONDS,
  LEGAL_ACTIONS,
  type PartFamily,
} from "../shared/core-protocol.js";
import { AGENT_OBJECTIVES, AGENT_RULES } from "../shared/agent-rules.js";
import { INVENTORY_COUNT, INVENTORY_DEFINITIONS } from "../server/core/catalog.js";
import { CorePhysicsWorld, QUEEN_CROWN_BOLT_COUNT, TOWER_SPEC } from "../server/core/physics.js";
import {
  connectionClassSupportsFamilies,
  connectionJointKind,
} from "../server/core/connections.js";
import { CoreSimulation } from "../server/core/simulation.js";
import { evaluateMatchObjective, evaluateSiegeClock, siegeUrgency } from "../server/core/mock-director.js";
import { observedCompoundPlans } from "../server/core/compound-plans.js";
import { queenAdvantagePlans, redCounterplayPlans } from "../server/core/special-plans.js";
import { expandContraptionPlans } from "../server/core/contraption-grammar.js";
import { REPO_AGENT_CONTEXT } from "../server/core/repo-context.js";
import { ReplayArchive } from "../server/core/replay-archive.js";
import {
  validateDecision,
  type AgentStrategist,
  type StrategyDecision,
  type StrategyRequest,
} from "../server/core/agent-strategist.js";

const root = resolve(import.meta.dirname, "..");
let physics: CorePhysicsWorld;

before(async () => {
  physics = await CorePhysicsWorld.create(1881);
});

after(() => {
  physics.free();
});

test("Gate A uses one server-authoritative Rapier 3D world", async () => {
  const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
  };
  assert.ok(packageJson.dependencies["@dimforge/rapier3d-compat"]);
  assert.equal(packageJson.dependencies["@dimforge/rapier2d-compat"], undefined);
  assert.equal(packageJson.dependencies["sync-ammo"], undefined);
  const diagnostics = physics.diagnostics();
  assert.equal(diagnostics.physicsAdapter, "rapier3d");
  assert.equal(diagnostics.physicsWorlds, 1);
  assert.equal(diagnostics.units, "m-kg-s-N-Nm");
  assert.equal(diagnostics.fixedHz, 60);
  assert.equal(CORE_FIXED_DT, 1 / 60);
});

test("render path contains no Ammo or gameplay rigid-body components", async () => {
  const sources = await Promise.all([
    readFile(resolve(root, "client/main.ts"), "utf8"),
    readFile(resolve(root, "client/lab-world.ts"), "utf8"),
  ]);
  const liveSource = sources.join("\n");
  assert.doesNotMatch(liveSource, /sync-ammo|window\.Ammo|addComponent\(["']rigidbody/);
  assert.doesNotMatch(liveSource, /addComponent\(["']collision/);
});

test("both royal characters have local audio clips and browser fallbacks", async () => {
  const clips = [
    "humpty-principal-load.m4a",
    "humpty-measuring.m4a",
    "humpty-competence.m4a",
    "humpty-brakes.m4a",
    "queen-consequence.m4a",
    "queen-tower-opinions.m4a",
    "queen-gravity.m4a",
    "queen-spherical.m4a",
  ];
  const source = await readFile(resolve(root, "client/worksite-audio.ts"), "utf8");
  for (const clip of clips) {
    assert.ok((await readFile(resolve(root, "public/audio", clip))).byteLength > 10_000, `${clip} is empty`);
    assert.ok(source.includes(`/audio/${clip}`), `${clip} is not routed to the client`);
  }
  assert.match(source, /SpeechSynthesisUtterance/);
});

test("fixed-step progression is exactly 60 Hz", () => {
  const start = physics.tick;
  for (let index = 0; index < 60; index += 1) physics.step();
  assert.equal(physics.tick - start, 60);
});

test("the transform interceptor rejects post-initialization pose writes", async () => {
  const isolated = await CorePhysicsWorld.create(1881);
  try {
    const beforePosition = isolated.bodyPosition("humpty");
    assert.ok(beforePosition);
    isolated.forcePoseForTest(
      "humpty",
      { x: beforePosition.x, y: beforePosition.y + 1, z: beforePosition.z },
      "core-reset.test.ts:tripwire",
    );
    const diagnostic = isolated.diagnostics();
    assert.equal(diagnostic.illegalTransformWrites, 1);
    assert.equal(diagnostic.lastWrite?.classification, "illegal-gameplay");
    assert.equal(diagnostic.lastWrite?.bodyId, "humpty");
  } finally {
    isolated.free();
  }
});

test("fixed-seed fixed-step replay is repeatable in the supported runtime", async () => {
  const first = await CorePhysicsWorld.create(1881);
  const second = await CorePhysicsWorld.create(1881);
  try {
    const impulse = { x: 38, y: 4, z: -11 };
    assert.equal(first.applyImpulse("tower-05-2", impulse), true);
    assert.equal(second.applyImpulse("tower-05-2", impulse), true);
    for (let index = 0; index < 240; index += 1) {
      first.step();
      second.step();
    }
    for (const id of ["tower-05-2", "central-cradle", "humpty"]) {
      const a = first.bodyPosition(id);
      const b = second.bodyPosition(id);
      assert.ok(a && b);
      assert.ok(distance(a, b) < 0.00001, `${id} diverged by ${distance(a, b)} m`);
    }
  } finally {
    first.free();
    second.free();
  }
});

test("Gate B tower is twelve literal alternating courses of three full timbers", () => {
  const blocks = [...physics.records.values()].filter(
    (record) => record.kind === "tower-block",
  );
  assert.equal(blocks.length, TOWER_SPEC.totalBlocks);
  assert.equal(new Set(blocks.map((block) => block.id)).size, TOWER_SPEC.totalBlocks);
  for (let course = 0; course < TOWER_SPEC.courses; course += 1) {
    const courseBlocks = blocks.filter((block) => block.course === course);
    assert.equal(courseBlocks.length, TOWER_SPEC.blocksPerCourse);
    assert.deepEqual(
      courseBlocks.map((block) => block.lane).sort(),
      [0, 1, 2],
    );
    assert.ok(courseBlocks.every((block) => block.axis === (course % 2 === 0 ? "x" : "z")));
    assert.ok(courseBlocks.every((block) => block.dynamic));
    assert.ok(courseBlocks.every((block) => block.colliders.length === 1));
    assert.ok(courseBlocks.every((block) => block.size.x === 1.54));
    assert.ok(courseBlocks.every((block) => block.size.z === 0.5));
  }
});

test("tower footprint is square and neighboring courses turn 90 degrees", () => {
  const blocks = [...physics.records.values()].filter((record) => record.kind === "tower-block");
  const yaw = TOWER_SPEC.yawRadians;
  const local = blocks.map((block) => {
    const position = block.body.translation();
    return {
      course: block.course ?? -1,
      x: position.x * Math.cos(yaw) + position.z * Math.sin(yaw),
      z: -position.x * Math.sin(yaw) + position.z * Math.cos(yaw),
    };
  });
  const xExtent = Math.max(...local.map((entry) => entry.x)) - Math.min(...local.map((entry) => entry.x));
  const zExtent = Math.max(...local.map((entry) => entry.z)) - Math.min(...local.map((entry) => entry.z));
  assert.ok(Math.abs(xExtent - zExtent) < 0.035, `footprint extents ${xExtent} x ${zExtent}`);
  for (let course = 0; course < TOWER_SPEC.courses - 1; course += 1) {
    const current = blocks.find((block) => block.course === course && block.lane === 1);
    const next = blocks.find((block) => block.course === course + 1 && block.lane === 1);
    assert.ok(current && next);
    const dot = Math.abs(quatDot(current.body.rotation(), next.body.rotation()));
    const angle = 2 * Math.acos(Math.min(1, dot));
    assert.ok(Math.abs(angle - Math.PI / 2) < 0.02, `courses ${course}/${course + 1}: ${angle}`);
  }
});

test("tower begins without deep interpenetration", () => {
  const ids = physics.towerBlockIds();
  for (let left = 0; left < ids.length; left += 1) {
    for (let right = left + 1; right < ids.length; right += 1) {
      const depth = physics.deepestContactDistance(ids[left]!, ids[right]!);
      if (depth !== undefined) assert.ok(depth > -0.02, `${ids[left]} / ${ids[right]}: ${depth}`);
    }
  }
});

test("Humpty and cradle are grounded by contact, not world joints", () => {
  const diagnostics = physics.diagnostics();
  assert.ok(diagnostics.humptyCradleContacts > 0);
  assert.ok(diagnostics.cradleTowerContacts > 0);
  assert.ok(diagnostics.humptyVisibleSupportGap < 0.02);
  assert.equal(diagnostics.activeJoints, 0);
  assert.equal(physics.records.get("humpty")?.dynamic, true);
  assert.equal(physics.records.get("central-cradle")?.dynamic, true);
  assert.equal(physics.world.gravity.y, -9.81);
});

test("moving a top support changes cradle response through physics", async () => {
  const isolated = await CorePhysicsWorld.create(1881);
  try {
    const before = isolated.bodyPosition("central-cradle");
    assert.ok(before);
    const beforeContacts = isolated.diagnostics().cradleTowerContacts;
    const topMiddleBlockId = `tower-${String(TOWER_SPEC.courses).padStart(2, "0")}-2`;
    assert.equal(isolated.applyImpulse(topMiddleBlockId, { x: 400, y: 0, z: 80 }), true);
    for (let index = 0; index < 180; index += 1) isolated.step();
    const after = isolated.bodyPosition("central-cradle");
    assert.ok(after);
    const afterContacts = isolated.diagnostics().cradleTowerContacts;
    assert.ok(distance(before, after) > 0.02 || beforeContacts !== afterContacts);
    assert.equal(isolated.diagnostics().illegalTransformWrites, 0);
  } finally {
    isolated.free();
  }
});

test("Gate D opening inventory is the exact mirrored 24-piece manifest", async () => {
  const manifest = JSON.parse(
    await readFile(resolve(root, "data/opening-inventory.json"), "utf8"),
  ) as { countPerTeam: number; entries: Array<{ definitionId: string; quantity: number }> };
  assert.equal(INVENTORY_COUNT, 24);
  assert.equal(INVENTORY_DEFINITIONS.reduce((sum, entry) => sum + entry.quantity, 0), 24);
  assert.deepEqual(
    INVENTORY_DEFINITIONS.map(({ definitionId, quantity }) => ({ definitionId, quantity })),
    manifest.entries,
  );
  assert.equal(manifest.countPerTeam, INVENTORY_COUNT);
  const approved = new Set<PartFamily>([
    "beam", "hub", "axle", "wheel", "sheave", "drum", "plank", "rope", "wedge",
  ]);
  const king = physics.inventoryIds("king");
  const queen = physics.inventoryIds("queen");
  assert.equal(king.length, 24);
  assert.equal(queen.length, 24);
  assert.equal(new Set([...king, ...queen]).size, 48);
  for (const record of physics.records.values()) {
    if (record.kind !== "part") continue;
    assert.ok(record.family && approved.has(record.family));
  }
  assert.deepEqual(
    new Set([...physics.records.values()]
      .filter((record) => record.kind === "part")
      .map((record) => record.family)),
    approved,
  );
  const signature = (team: "king" | "queen") => [...physics.records.values()]
    .filter((record) => record.kind === "part" && record.team === team)
    .map((record) => `${record.family}:${record.variant}`)
    .sort();
  assert.deepEqual(signature("king"), signature("queen"));
  assert.equal(physics.diagnostics().lateCreatedInventory, 0);
});

test("Gate E exposes exactly four frozen connection classes and port families", async () => {
  assert.deepEqual(CONNECTION_CLASSES, [
    "TENON_LOCK", "AXLE_BEARING", "KEYED_COAXIAL", "ROPE_ATTACH",
  ]);
  const matrix = JSON.parse(
    await readFile(resolve(root, "data/compatibility-matrix.json"), "utf8"),
  ) as { compatibility: Array<{ class: string }> };
  assert.deepEqual(
    [...new Set(matrix.compatibility.map((rule) => rule.class))].sort(),
    [...CONNECTION_CLASSES].sort(),
  );
  assert.equal(connectionClassSupportsFamilies("TENON_LOCK", "beam", "hub"), true);
  assert.equal(connectionClassSupportsFamilies("AXLE_BEARING", "axle", "hub"), true);
  assert.equal(connectionClassSupportsFamilies("KEYED_COAXIAL", "axle", "wheel"), true);
  assert.equal(connectionClassSupportsFamilies("ROPE_ATTACH", "rope", "sheave"), true);
  assert.equal(connectionClassSupportsFamilies("AXLE_BEARING", "axle", "wheel"), false);
  assert.equal(connectionClassSupportsFamilies("KEYED_COAXIAL", "beam", "hub"), false);
  assert.equal(connectionJointKind("TENON_LOCK"), "fixed");
  assert.equal(connectionJointKind("AXLE_BEARING"), "revolute");
  assert.equal(connectionJointKind("KEYED_COAXIAL"), "fixed");
  assert.equal(connectionJointKind("ROPE_ATTACH"), "rope");
});

test("each frozen class creates and reports its own physical joint", async () => {
  const isolated = await CorePhysicsWorld.create(1881);
  try {
    const ids = isolated.inventoryIds("king");
    const findPart = (needle: string): string => {
      const id = ids.find((candidate) => candidate.includes(needle));
      assert.ok(id, `missing ${needle}`);
      return id;
    };
    const beam = findPart("beam-long");
    const hub = findPart("hub-");
    const axle = findPart("axle-long");
    const wheel = findPart("wheel-");
    const rope = findPart("king-rope-");
    const plank = findPart("king-plank-");
    assert.equal(isolated.createAssemblyJoint("test-tenon", "TENON_LOCK", beam, hub), true);
    assert.equal(isolated.createAssemblyJoint("test-bearing", "AXLE_BEARING", axle, hub), true);
    assert.equal(isolated.createAssemblyJoint("test-keyed", "KEYED_COAXIAL", axle, wheel), true);
    assert.equal(isolated.createAssemblyJoint("test-rope", "ROPE_ATTACH", rope, plank), true);
    assert.equal(isolated.createAssemblyJoint("test-wrong", "AXLE_BEARING", axle, wheel), false);
    assert.deepEqual(isolated.diagnostics().jointsByClass, {
      TENON_LOCK: 1,
      AXLE_BEARING: 1,
      KEYED_COAXIAL: 1,
      ROPE_ATTACH: 1,
    });
    assert.equal(isolated.diagnostics().activeJoints, 4);
    for (const id of ["test-tenon", "test-bearing", "test-keyed", "test-rope"]) {
      assert.equal(isolated.removeAssemblyJoint(id), true);
    }
    assert.deepEqual(isolated.diagnostics().jointsByClass, {
      TENON_LOCK: 0,
      AXLE_BEARING: 0,
      KEYED_COAXIAL: 0,
      ROPE_ATTACH: 0,
    });
  } finally {
    isolated.free();
  }
});

test("the public action boundary rejects a compatible pair under the wrong class", async () => {
  const simulation = await CoreSimulation.create({ seed: 1881, build: "test" });
  try {
    const axle = simulation.physics.inventoryIds("king")
      .find((id) => id.includes("axle-long"));
    const wheel = simulation.physics.inventoryIds("king")
      .find((id) => id.includes("wheel-"));
    assert.ok(axle && wheel);
    const missingClass = simulation.handleCommand({
      type: "legal-action",
      request: {
        action: "connect",
        actorIds: ["king-worker-1"],
        targetId: axle,
        secondaryId: wheel,
      },
    });
    assert.equal(missingClass.ok, false);
    const wrongClass = simulation.handleCommand({
      type: "legal-action",
      request: {
        action: "connect",
        actorIds: ["king-worker-1"],
        targetId: axle,
        secondaryId: wheel,
        connectionClass: "AXLE_BEARING",
      },
    });
    assert.equal(wrongClass.ok, false);
    const keyedClass = simulation.handleCommand({
      type: "legal-action",
      request: {
        action: "connect",
        actorIds: ["king-worker-1"],
        targetId: axle,
        secondaryId: wheel,
        connectionClass: "KEYED_COAXIAL",
      },
    });
    assert.equal(keyedClass.ok, true);
  } finally {
    simulation.destroy();
  }
});

test("the long keyed axle remains a one-worker load", async () => {
  const simulation = await CoreSimulation.create({ seed: 1881, build: "test" });
  try {
    const axle = simulation.physics.inventoryIds("king")
      .find((id) => id.includes("axle-long"));
    const beam = simulation.physics.inventoryIds("king")
      .find((id) => id.includes("beam-long"));
    assert.ok(axle && beam);
    assert.equal(simulation.handleCommand({
      type: "legal-action",
      request: {
        action: "carry",
        actorIds: ["king-worker-1"],
        targetId: axle,
        destination: { x: -4.8, y: .42, z: 0 },
      },
    }).ok, true);
    assert.equal(simulation.handleCommand({
      type: "legal-action",
      request: {
        action: "carry",
        actorIds: ["king-worker-1"],
        targetId: beam,
        destination: { x: -4.8, y: .42, z: 0 },
      },
    }).ok, false);
  } finally {
    simulation.destroy();
  }
});

test("the siege director reveals and resolves one simultaneous order per team", async () => {
  const simulation = await CoreSimulation.create({
    seed: 4198,
    build: "test",
    autoMatch: true,
  });
  try {
    assert.equal(simulation.handleCommand({ type: "time-scale", value: 8 }).ok, true);
    while ((simulation.snapshot().match.battle?.history.length ?? 0) < 1) {
      simulation.step();
    }
    const snapshot = simulation.snapshot();
    assert.equal(snapshot.match.driver, "mock");
    assert.equal(snapshot.match.status, "active");
    assert.equal(snapshot.match.kingObjective, "Keep Humpty uncracked through ten simultaneous siege turns.");
    assert.equal(snapshot.match.queenObjective, "Crack Humpty before the tenth turn is resolved.");
    assert.ok(snapshot.match.timeRemaining <= CORE_MATCH_DURATION_SECONDS);
    assert.equal(snapshot.match.rulebookSize, 7);
    assert.equal(Object.keys(snapshot.match.activeRuleIds).length, 6);
    assert.equal(snapshot.match.moves, 2);
    assert.ok(snapshot.match.battle);
    assert.equal(snapshot.match.battle.maxRounds, 10);
    assert.equal(snapshot.match.battle.units.length, 6);
    assert.equal(snapshot.match.battle.targets.length, 3);
    assert.equal(snapshot.match.battle.history.length, 1);
    assert.deepEqual(
      new Set(snapshot.match.battle.units.map((unit) => unit.id)),
      new Set(["red-engineers", "red-rescue-winch", "red-catch-sledge", "green-battering-ram", "green-stone-thrower", "green-ballista"]),
    );
    assert.equal(
      snapshot.match.battle.units.find((unit) => unit.id === "green-stone-thrower")?.name,
      "Bed Mortar",
    );
    assert.ok(snapshot.events.some((event) => event.technical === "siege:round:1:reveal"));
    assert.ok(snapshot.events.some((event) => event.technical === "siege:round:1:resolved"));
    assert.equal(snapshot.match.battle.history[0]?.kingOrder.status, "resolved");
    assert.equal(snapshot.match.battle.history[0]?.queenOrder.status, "resolved");
    assert.equal(snapshot.diagnostics.illegalTransformWrites, 0);
    assert.equal(snapshot.diagnostics.lateCreatedInventory, 0);
  } finally {
    simulation.destroy();
  }
});

test("matchlock volleys resolve to a physical impact or a finite miss", async () => {
  const hitWorld = await CorePhysicsWorld.create(1881, true);
  const missWorld = await CorePhysicsWorld.create(1881, true);
  try {
    assert.equal(hitWorld.fireBattleBallista("humpty", true).ok, true);
    assert.equal(missWorld.fireBattleBallista("humpty", false).ok, true);
    for (let tick = 0; tick < 300; tick += 1) {
      hitWorld.step();
      missWorld.step();
    }
    assert.ok(hitWorld.records.get("green-ballista-bolt-1")?.variant?.startsWith("spent"));
    assert.ok(missWorld.records.get("green-ballista-bolt-1")?.variant?.startsWith("spent"));
    assert.ok(hitWorld.consumeBattleEvents().some((event) => event.type === "volley-impact"));
    assert.ok(missWorld.consumeBattleEvents().some((event) => event.type === "projectile-miss"));
  } finally {
    hitWorld.free();
    missWorld.free();
  }
});

test("demi-culverin round shot resolves to a physical impact or a finite miss", async () => {
  const hitWorld = await CorePhysicsWorld.create(1881, true);
  const missWorld = await CorePhysicsWorld.create(1881, true);
  try {
    assert.equal(hitWorld.operateBattleMachine("green-battering-ram", "tower-02-3", true).ok, true);
    assert.equal(missWorld.operateBattleMachine("green-battering-ram", "tower-02-3", false).ok, true);
    for (let tick = 0; tick < 300; tick += 1) {
      hitWorld.step();
      missWorld.step();
    }
    assert.ok(hitWorld.records.get("green-cannonball-1")?.variant?.startsWith("spent"));
    assert.ok(missWorld.records.get("green-cannonball-1")?.variant?.startsWith("spent"));
    assert.ok(hitWorld.consumeBattleEvents().some((event) => event.type === "cannon-impact"));
    assert.ok(missWorld.consumeBattleEvents().some((event) => event.type === "projectile-miss"));
  } finally {
    hitWorld.free();
    missWorld.free();
  }
});

test("a rescue capstan cannot lift a fallen Humpty back onto the tower", async () => {
  const world = await CorePhysicsWorld.create(1881, true);
  try {
    const humpty = world.records.get("humpty")!;
    humpty.body.setTranslation({ x: 3.1, y: .82, z: -3.2 }, true);
    humpty.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    assert.equal(world.operateBattleMachine("red-rescue-winch").ok, true);
    let maximumY = world.bodyPosition("humpty")!.y;
    for (let tick = 0; tick < 360; tick += 1) {
      world.step();
      maximumY = Math.max(maximumY, world.bodyPosition("humpty")!.y);
    }
    assert.ok(maximumY < 1.25, `fallen Humpty rose to ${maximumY.toFixed(2)}m`);
  } finally {
    world.free();
  }
});

test("both teams can seal hidden orders before the same reveal", async () => {
  const simulation = await CoreSimulation.create({
    seed: 1881,
    build: "test",
    autoMatch: true,
  });
  try {
    assert.equal(simulation.handleCommand({
      type: "battle-order",
      team: "king",
      unitId: "red-engineers",
      action: "fortify",
      targetId: "foundation",
    }).ok, true);
    assert.equal(simulation.handleCommand({
      type: "battle-order",
      team: "queen",
      unitId: "green-battering-ram",
      action: "breach",
      targetId: "foundation",
    }).ok, true);
    assert.deepEqual(new Set(simulation.snapshot().match.battle?.sealedTeams), new Set(["king", "queen"]));
    assert.deepEqual(simulation.snapshot().match.battle?.orders, {});
    while (simulation.snapshot().match.battle?.phase === "planning") simulation.step();
    const revealed = simulation.snapshot();
    assert.equal(revealed.match.battle?.orders.king?.unitId, "red-engineers");
    assert.equal(revealed.match.battle?.orders.queen?.unitId, "green-battering-ram");
    assert.equal(revealed.events.filter((event) => event.technical === "siege:round:1:reveal").length, 1);

    const result = simulation.handleCommand({
      type: "legal-action",
      request: { action: "wait", actorIds: ["king-worker-1"], magnitude: .5 },
    });
    assert.equal(result.ok, true);
    assert.equal(simulation.snapshot().match.driver, "manual");
  } finally {
    simulation.destroy();
  }
});

test("the agent rulebook is finite, public-action-only, and covers every frozen connection class", () => {
  assert.equal(AGENT_OBJECTIVES.king.color, "red");
  assert.equal(AGENT_OBJECTIVES.queen.color, "green");
  assert.ok(AGENT_RULES.length >= 20);
  assert.equal(new Set(AGENT_RULES.map((rule) => rule.id)).size, AGENT_RULES.length);
  const legal = new Set(LEGAL_ACTIONS);
  for (const rule of AGENT_RULES) {
    assert.ok(rule.teams.length > 0, `${rule.id} has no eligible team`);
    assert.ok(rule.phases.length > 0, `${rule.id} has no phase`);
    assert.ok(rule.when.length > 0, `${rule.id} has no enumerable precondition`);
    assert.ok(rule.actions.length > 0, `${rule.id} has no public action packet`);
    assert.ok(rule.actions.every((action) => legal.has(action)), `${rule.id} names a private action`);
  }
  assert.deepEqual(
    new Set(AGENT_RULES.flatMap((rule) =>
      "connectionClass" in rule ? [rule.connectionClass] : [])),
    new Set(CONNECTION_CLASSES),
  );
  assert.deepEqual(
    new Set(AGENT_RULES.flatMap((rule) => "simpleMachines" in rule ? rule.simpleMachines : [])),
    new Set(["lever", "wheel-and-axle", "pulley", "inclined-plane", "wedge"]),
  );
  assert.deepEqual(
    new Set(AGENT_RULES.flatMap((rule) => "capabilities" in rule ? rule.capabilities : [])),
    new Set(["climb", "launch", "strike", "dislodge-timber", "lift", "lower"]),
  );
});

test("the six compound plans are derived from visible stage facts", async () => {
  const isolated = await CorePhysicsWorld.create(1881);
  try {
    const plans = [
      ...observedCompoundPlans(isolated, "king"),
      ...observedCompoundPlans(isolated, "queen"),
    ];
    assert.deepEqual(
      plans.map((plan) => plan.id),
      ["escalade-ramp", "rescue-hoist", "compound-ram", "wheel-shot", "pivoted-striker", "counterweight-sling"],
    );
    assert.ok(plans.every((plan) => plan.eligible));
    assert.ok(plans.every((plan) => plan.requests.length > 0));
    assert.ok(plans.every((plan) =>
      plan.requiredFacts.every((fact) => plan.observedFacts.includes(fact))));
  } finally {
    isolated.free();
  }
});

test("the Queen's advantage is a finite physical body with public counterplay", async () => {
  const isolated = await CorePhysicsWorld.create(1881);
  try {
    isolated.ensureQueenAdvantage();
    const device = isolated.records.get("queen-command-post");
    assert.equal(device?.kind, "queen-device");
    assert.equal(device?.dynamic, true);
    assert.equal(device?.integrity, 100);
    assert.equal(isolated.inventoryIds("king").length, INVENTORY_COUNT);
    assert.equal(isolated.inventoryIds("queen").length, INVENTORY_COUNT);
    assert.deepEqual(isolated.queenAdvantageState(), {
      deviceId: "queen-command-post",
      deviceIntegrity: 100,
      charges: QUEEN_CROWN_BOLT_COUNT,
      maxCharges: QUEEN_CROWN_BOLT_COUNT,
      armed: true,
      disabled: false,
      firedBoltIds: [],
    });
    assert.equal(queenAdvantagePlans(isolated)[0]?.requests.at(-1)?.action, "operate");
    assert.equal(redCounterplayPlans(isolated)[0]?.requests.at(-1)?.action, "strike");
    const fired = isolated.fireQueenBolt();
    assert.equal(fired.ok, true);
    assert.equal(isolated.queenAdvantageState().charges, QUEEN_CROWN_BOLT_COUNT - 1);
    assert.ok((isolated.bodyLinearVelocity(fired.boltId ?? "")?.x ?? 0) < 0);
    assert.equal(isolated.applyDamage("queen-command-post", 100), 0);
    assert.equal(isolated.queenAdvantageState().disabled, true);
  } finally {
    isolated.free();
  }
});

test("the legacy lab still expands fixtures while the repo contract points to the siege", async () => {
  const isolated = await CorePhysicsWorld.create(1881);
  try {
    const base = observedCompoundPlans(isolated, "queen");
    const expanded = expandContraptionPlans(base);
    assert.ok(expanded.length > base.length * 3);
    assert.equal(new Set(expanded.map((plan) => plan.id)).size, expanded.length);
    assert.ok(expanded.some((plan) => plan.id.endsWith(":reversed-crew")));
    assert.ok(expanded.some((plan) => plan.composition?.length === 2));
    assert.ok(expanded.every((plan) => plan.requests.length > 0));
    assert.ok(expanded.every((plan) => plan.requests.every((request) =>
      request.actorIds.every((actorId) => isolated.workerIds("queen").includes(actorId)))));
    assert.equal(REPO_AGENT_CONTEXT.contractVersion, "simultaneous-siege-v1");
    assert.ok(REPO_AGENT_CONTEXT.sourceOfTruth.includes("server/core/siege-rules.ts"));
    assert.ok(REPO_AGENT_CONTEXT.mcpTools.includes("list_legal_siege_orders"));
  } finally {
    isolated.free();
  }
});

test("the replay archive survives a server restart in its durable store", async () => {
  const directory = await mkdtemp(join(tmpdir(), "humpty-replay-"));
  const simulation = await CoreSimulation.create({ seed: 1881, build: "test", autoMatch: false });
  try {
    const archive = new ReplayArchive(directory);
    await archive.load();
    archive.start(simulation.snapshot());
    for (let index = 0; index < 45; index += 1) simulation.step();
    const id = archive.summaries()[0]?.id;
    assert.ok(id);
    archive.finalize(simulation.snapshot());
    await archive.flush();

    const reopened = new ReplayArchive(directory);
    await reopened.load();
    const restored = reopened.entry(id);
    assert.ok(restored);
    assert.equal(restored.summary.live, false);
    assert.ok(restored.frames.length >= 2);
  } finally {
    simulation.destroy();
    await rm(directory, { recursive: true, force: true });
  }
});

test("the session replay archive retains a public past match", async () => {
  const simulation = await CoreSimulation.create({ seed: 1881, build: "test", autoMatch: false });
  const archive = new ReplayArchive();
  try {
    archive.start(simulation.snapshot());
    for (let index = 0; index < 45; index += 1) simulation.step();
    archive.capture(simulation.snapshot(), true);
    const liveId = archive.summaries()[0]?.id;
    assert.ok(liveId);
    archive.finalize(simulation.snapshot());
    const summary = archive.summaries()[0];
    assert.equal(summary?.live, false);
    assert.ok(summary && summary.frameCount >= 2);
    const entry = archive.entry(liveId);
    assert.ok(entry);
    assert.ok(entry.frames.length >= 2);
    assert.equal(entry.frames[0]?.type, "core-snapshot");
  } finally {
    simulation.destroy();
  }
});

test("the fixed-seed autonomous battle replays exactly", async () => {
  const play = async (seed: number) => {
    const simulation = await CoreSimulation.create({ seed, build: "test", autoMatch: true });
    try {
      assert.equal(simulation.handleCommand({ type: "time-scale", value: 8 }).ok, true);
      const choices = new Map<string, string>();
      while (simulation.snapshot().match.status !== "complete") {
        simulation.step();
        for (const event of simulation.snapshot().events) {
          if (event.technical?.startsWith("siege:")) choices.set(event.id, event.technical);
        }
      }
      return {
        rules: [...choices.values()],
        plans: simulation.snapshot().match.selectedMachinePlanIds,
        history: simulation.snapshot().match.battle?.history,
        outcome: simulation.snapshot().match.outcome,
      };
    } finally {
      simulation.destroy();
    }
  };
  const first = await play(4198);
  const replay = await play(4198);
  assert.deepEqual(first, replay);
  assert.ok(first.rules.includes("siege:round:1:reveal"));
  assert.ok(first.rules.includes("siege:round:1:resolved"));
  assert.equal(first.history?.length, 10);
  assert.ok(first.history?.some((record) => record.queenOrder.unitId === "green-battering-ram"));
  assert.ok(first.history?.some((record) => record.queenOrder.unitId === "green-stone-thrower"));
  assert.equal(first.outcome, "king");
  assert.ok(first.plans.king);
  assert.ok(first.plans.queen);
});

test("seeded siege doctrines advertise three distinct opening stone targets", async () => {
  const targets = new Map<number, string>();
  for (const seed of [1881, 4198, 7331]) {
    const simulation = await CoreSimulation.create({ seed, build: "test", autoMatch: true });
    try {
      targets.set(seed, simulation.physics.battleStoneTargetId());
    } finally {
      simulation.destroy();
    }
  }
  assert.deepEqual(targets, new Map([
    [1881, "humpty"],
    [4198, "tower-10-2"],
    [7331, "tower-06-1"],
  ]));
});

test("model decisions are rejected unless every ID was advertised", () => {
  const request: StrategyRequest = {
    id: "test-choice",
    phase: "contest",
    trigger: "impact",
    figures: [{
      workerId: "queen-worker-1",
      team: "queen",
      objective: "Crack Humpty.",
      observedFacts: ["worker:idle"],
      options: [{ id: "survey-tower", label: "Read the tower", when: ["A support is visible."] }],
    }],
    teams: [{
      team: "queen",
      objective: "Crack Humpty.",
      observedFacts: ["lower-timber-exposed"],
      attemptedPlanIds: [],
      options: [{
        id: "pivoted-striker",
        ruleId: "operate-pivoted-striker",
        label: "Pivoted striker",
        observedFacts: ["lower-timber-exposed"],
        missingFacts: [],
        capabilities: ["strike"],
        simpleMachines: ["lever"],
      }],
    }],
  };
  assert.deepEqual(validateDecision(request, {
    figures: [{ workerId: "queen-worker-1", ruleId: "survey-tower", say: "Mark that support." }],
    teams: [{ team: "queen", planId: "pivoted-striker", say: "Swing it." }],
  }), {
    figures: [{ workerId: "queen-worker-1", ruleId: "survey-tower", say: "Mark that support." }],
    teams: [{ team: "queen", planId: "pivoted-striker", say: "Swing it." }],
  });
  assert.throws(() => validateDecision(request, {
    figures: [{ workerId: "queen-worker-1", ruleId: "teleport-king", say: "" }],
    teams: [{ team: "queen", planId: "pivoted-striker", say: "" }],
  }), /unlisted rule/);
});

test("the battle commander stays deterministic even when an LLM strategist is available", async () => {
  const decisions = new Map<string, StrategyDecision>();
  let requests = 0;
  const strategist: AgentStrategist = {
    enabled: true,
    name: "scripted-test",
    request(request) {
      requests += 1;
      decisions.set(request.id, {
        figures: (request.figures ?? []).map((figure) => ({
          workerId: figure.workerId,
          ruleId: figure.options[0]!.id,
        })),
        teams: (request.teams ?? []).map((team) => ({
          team: team.team,
          planId: team.options.find((option) => option.id === (team.team === "queen" ? "green-fire-stone" : "red-deploy-catch-sledge"))?.id ?? team.options[0]!.id,
        })),
      });
    },
    poll(requestId) {
      const decision = decisions.get(requestId);
      if (!decision) return { state: "missing" };
      decisions.delete(requestId);
      return { state: "ready", decision };
    },
    cancel(requestId) {
      decisions.delete(requestId);
    },
  };
  const simulation = await CoreSimulation.create({
    seed: 1881,
    build: "test",
    autoMatch: true,
    strategist,
  });
  try {
    simulation.handleCommand({ type: "time-scale", value: 8 });
    while ((simulation.snapshot().match.battle?.history.length ?? 0) < 1) simulation.step();
    const snapshot = simulation.snapshot();
    assert.equal(snapshot.match.driver, "mock");
    assert.equal(snapshot.diagnostics.llmEnabled, false);
    assert.equal(requests, 0);
    assert.equal(snapshot.match.battle?.history.length, 1);
    assert.ok(snapshot.events.some((event) => event.technical === "siege:round:1:resolved"));
  } finally {
    simulation.destroy();
  }
});

test("climb is public but rejects a non-climbable machine part", async () => {
  const simulation = await CoreSimulation.create({ seed: 1881, build: "test" });
  try {
    const wheel = simulation.physics.inventoryIds("king")
      .find((id) => id.includes("wheel"));
    assert.ok(wheel);
    const result = simulation.handleCommand({
      type: "legal-action",
      request: { action: "climb", actorIds: ["king-worker-3"], targetId: wheel },
    });
    assert.equal(result.ok, false);
    assert.match(result.message ?? "", /plank or beam/i);
  } finally {
    simulation.destroy();
  }
});

test("the siege clock only awards Red at ten minutes while cracks award Green immediately", () => {
  const safe = evaluateMatchObjective({
    integrity: 100,
    floorContact: true,
    impactSpeed: .4,
    speed: .1,
    safeFloorSeconds: .99,
    dt: CORE_FIXED_DT,
  });
  assert.equal(safe.outcome, undefined);
  assert.equal(evaluateSiegeClock(CORE_MATCH_DURATION_SECONDS - CORE_FIXED_DT, 100), undefined);
  assert.equal(evaluateSiegeClock(CORE_MATCH_DURATION_SECONDS, 100), "king");
  assert.equal(evaluateSiegeClock(30, 0), "queen");
  const impact = evaluateMatchObjective({
    integrity: 100,
    floorContact: true,
    impactSpeed: 3.1,
    speed: .2,
    safeFloorSeconds: .4,
    dt: CORE_FIXED_DT,
  });
  assert.equal(impact.outcome, "queen");
  assert.equal(impact.reason, "hard-impact");
  assert.equal(siegeUrgency(0), "opening");
  assert.equal(siegeUrgency(300), "siege");
  assert.equal(siegeUrgency(480), "desperate");
  assert.equal(siegeUrgency(540), "last-minute");
});

test("lever, ramp, ram, and hoist fixtures complete from the frozen opening kit", async () => {
  for (const fixture of ["lever", "ramp", "ram", "hoist"] as const) {
    const simulation = await CoreSimulation.create({ seed: 1881, build: "test" });
    try {
      assert.equal(simulation.handleCommand({ type: "run-fixture", fixture }).ok, true);
      for (let tick = 0; tick < 60 * 180 && simulation.actions.isBusy(); tick += 1) {
        simulation.step();
      }
      const snapshot = simulation.snapshot();
      assert.equal(simulation.actions.isBusy(), false, `${fixture} did not finish`);
      assert.ok(snapshot.completedFixtures.includes(fixture), `${fixture} did not pass`);
      assert.ok(snapshot.events.some((event) => event.technical === `fixture:${fixture}:pass`));
      assert.equal(snapshot.diagnostics.illegalTransformWrites, 0);
      assert.equal(snapshot.diagnostics.lateCreatedInventory, 0);
      if (fixture !== "ram" && fixture !== "hoist") {
        assert.equal(snapshot.diagnostics.workerPenetrations, 0);
        assert.equal(snapshot.diagnostics.carriedPartPenetrations, 0);
        assert.equal(snapshot.diagnostics.deepBodyPenetrations, 0);
      } else if (fixture === "ram") {
        assert.deepEqual(
          snapshot.connections.map((connection) => connection.class).sort(),
          ["AXLE_BEARING", "KEYED_COAXIAL", "KEYED_COAXIAL", "TENON_LOCK"],
        );
        assert.deepEqual(snapshot.diagnostics.jointsByClass, {
          TENON_LOCK: 1,
          AXLE_BEARING: 1,
          KEYED_COAXIAL: 2,
          ROPE_ATTACH: 0,
        });
        assert.ok(snapshot.connections.some((connection) =>
          connection.class === "AXLE_BEARING" &&
          [connection.bodyA, connection.bodyB].some((id) => id.includes("plank"))));
        assert.ok(snapshot.connections.some((connection) =>
          connection.class === "TENON_LOCK" &&
          [connection.bodyA, connection.bodyB].some((id) => id.includes("beam")) &&
          [connection.bodyA, connection.bodyB].some((id) => id.includes("plank"))));
      } else {
        assert.deepEqual(
          snapshot.connections.map((connection) => connection.class).sort(),
          ["KEYED_COAXIAL", "ROPE_ATTACH", "ROPE_ATTACH"],
        );
        assert.deepEqual(snapshot.diagnostics.jointsByClass, {
          TENON_LOCK: 0,
          AXLE_BEARING: 0,
          KEYED_COAXIAL: 1,
          ROPE_ATTACH: 2,
        });
        const ropeAttachments = snapshot.connections.filter(
          (connection) => connection.class === "ROPE_ATTACH",
        );
        const ropeIds = ropeAttachments.flatMap((connection) =>
          [connection.bodyA, connection.bodyB].filter((id) => id.includes("rope")),
        );
        const receiverIds = ropeAttachments.flatMap((connection) =>
          [connection.bodyA, connection.bodyB].filter((id) => !id.includes("rope")),
        );
        assert.equal(new Set(ropeIds).size, 1);
        assert.ok(receiverIds.some((id) => id.includes("sheave")));
        assert.ok(receiverIds.some((id) => id.includes("plank")));
        assert.ok(ropeAttachments.every((connection) => connection.tested));
        assert.ok(ropeAttachments.every((connection) => (connection.tension ?? 0) > 0));
        assert.ok(ropeAttachments.every((connection) => (connection.slack ?? Infinity) < .08));
        assert.equal(snapshot.diagnostics.workerPenetrations, 0);
        assert.equal(snapshot.diagnostics.carriedPartPenetrations, 0);
        assert.equal(snapshot.diagnostics.deepBodyPenetrations, 0);
      }
    } finally {
      simulation.destroy();
    }
  }
});

test("the public action surface contains only the reset vocabulary", () => {
  assert.deepEqual(LEGAL_ACTIONS, [
    "reserve", "fetch", "climb", "carry", "assistCarry", "stage", "hold", "align",
    "connect", "hookRope", "reeveRope", "tension", "push", "pull", "turn",
    "test", "operate", "strike", "release", "detach", "recover", "wait", "cancel",
  ]);
});

test("Gate C creates six physical collision-aware worker capsules", () => {
  const workers = [...physics.records.values()].filter((record) => record.kind === "worker");
  assert.equal(workers.length, 6);
  assert.equal(workers.filter((worker) => worker.team === "king").length, 3);
  assert.equal(workers.filter((worker) => worker.team === "queen").length, 3);
  assert.ok(workers.every((worker) => worker.shape === "capsule"));
  assert.ok(workers.every((worker) => worker.body.isKinematic()));
});

test("a character-controller sweep cannot cross the tower collider", async () => {
  const isolated = await CorePhysicsWorld.create(1881);
  try {
    const before = isolated.bodyPosition("king-worker-2");
    assert.ok(before);
    const result = isolated.moveCharacter(
      "king-worker-2",
      { x: 10, y: -0.04, z: 0 },
      { x: 1, y: 0, z: 0 },
    );
    assert.ok(result);
    isolated.step();
    const after = isolated.bodyPosition("king-worker-2");
    assert.ok(after);
    assert.ok(after.x < -1.05, `worker crossed to x=${after.x}`);
    assert.ok(result.collisions > 0);
    assert.equal(isolated.diagnostics().workerPenetrations, 0);
  } finally {
    isolated.free();
  }
});

test("two workers physically carry a long beam around the tower without a jump", async () => {
  const simulation = await CoreSimulation.create({ seed: 1881, build: "test" });
  try {
    assert.equal(
      simulation.handleCommand({ type: "run-fixture", fixture: "transport" }).ok,
      true,
    );
    const beamId = simulation.physics
      .inventoryIds("king")
      .filter((id) => id.includes("beam-long"))
      .at(1);
    assert.ok(beamId);
    const start = simulation.physics.bodyPosition(beamId);
    assert.ok(start);
    let previous = start;
    let largestStep = 0;
    let carriedObserved = false;
    let passedTowerAtSafeDepth = false;
    for (let tick = 0; tick < 60 * 55 && simulation.actions.isBusy(); tick += 1) {
      simulation.step();
      const position = simulation.physics.bodyPosition(beamId);
      assert.ok(position);
      largestStep = Math.max(largestStep, distance(previous, position));
      previous = position;
      const record = simulation.physics.records.get(beamId);
      carriedObserved ||= Boolean(record?.carriedBy?.length === 2);
      if (position.x > -1.5 && position.x < 1.5 && Math.abs(position.z) > 2.1) {
        passedTowerAtSafeDepth = true;
      }
    }
    const end = simulation.physics.bodyPosition(beamId);
    assert.ok(end);
    assert.equal(simulation.actions.isBusy(), false);
    assert.ok(carriedObserved);
    assert.ok(passedTowerAtSafeDepth, "beam did not visibly route around the tower footprint");
    assert.ok(distance(start, end) > 9, `beam moved only ${distance(start, end)} m`);
    assert.ok(largestStep < 0.11, `beam jumped ${largestStep} m in one fixed tick`);
    assert.equal(simulation.physics.records.get(beamId)?.carriedBy, undefined);
    const diagnostics = simulation.physics.diagnostics();
    assert.equal(diagnostics.workerPenetrations, 0);
    assert.equal(diagnostics.carriedPartPenetrations, 0);
    assert.equal(diagnostics.deepBodyPenetrations, 0);
    assert.equal(diagnostics.illegalTransformWrites, 0);
    assert.ok(simulation.actions.states().every((worker) => worker.phase === "idle"));
  } finally {
    simulation.destroy();
  }
});

test("five simulated idle minutes remain penetration- and write-clean", async () => {
  const isolated = await CorePhysicsWorld.create(1881);
  try {
    for (let tick = 0; tick < 60 * 60 * 5; tick += 1) isolated.step();
    const diagnostics = isolated.diagnostics();
    assert.equal(diagnostics.workerPenetrations, 0);
    assert.equal(diagnostics.carriedPartPenetrations, 0);
    assert.equal(diagnostics.deepBodyPenetrations, 0);
    assert.equal(diagnostics.illegalTransformWrites, 0);
    assert.equal(diagnostics.lateCreatedInventory, 0);
  } finally {
    isolated.free();
  }
});

test("opening inventory stays in mirrored edge racks and leaves the center clear", () => {
  const parts = [...physics.records.values()].filter((record) => record.kind === "part");
  assert.equal(parts.length, 48);
  assert.ok(parts.every((part) => Math.abs(part.body.translation().x) > 6));
  const occupiedEdgeArea = 2 * 2.2 * 10;
  const usableArea = 18.4 * 10;
  assert.ok(1 - occupiedEdgeArea / usableArea > 0.7);
});

function distance(
  first: { x: number; y: number; z: number },
  second: { x: number; y: number; z: number },
): number {
  return Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z);
}

function quatDot(
  first: { x: number; y: number; z: number; w: number },
  second: { x: number; y: number; z: number; w: number },
): number {
  return first.x * second.x + first.y * second.y + first.z * second.z + first.w * second.w;
}
