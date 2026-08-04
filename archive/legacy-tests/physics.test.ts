import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AGENTS,
  MockAgentDriver,
  type AgentDefinition,
  type AgentDriver,
} from "../server/agents.js";
import { validateSubmission } from "../server/actions.js";
import { createBlueprint } from "../server/construction.js";
import {
  disassembleMachineCatalog,
  gameplayPuzzleCatalog,
  portsCompatible,
  puzzlePortPose,
  summarizeAssembly,
} from "../server/puzzle.js";
import { machineGrammar, validateMachineGrammar } from "../server/grammar.js";
import { SeededRandom } from "../server/random.js";
import { GameSimulation } from "../server/simulation.js";
import type { AgentState, AgentSubmission } from "../shared/protocol.js";

test("seeded random produces a reproducible tower sequence", () => {
  const first = new SeededRandom(1881);
  const second = new SeededRandom(1881);
  const a = Array.from({ length: 10 }, () => first.range(-12, 12));
  const b = Array.from({ length: 10 }, () => second.range(-12, 12));
  assert.deepEqual(a, b);
});

test("the repair kit validates and expands to 24 neutral pieces", () => {
  assert.equal(validateMachineGrammar(machineGrammar), machineGrammar);
  const parts = disassembleMachineCatalog();
  assert.equal(parts.length, 24);
  assert.equal(new Set(parts.map((part) => part.id)).size, parts.length);
  assert.ok(
    parts.every(
      (part) =>
        part.ports.length > 0 &&
        part.affordances.length >= 2 &&
        part.constraints.length >= 2,
    ),
  );
  assert.equal(
    parts.some((part) => /crossbow|catapult|gear|rack|screw|sling|torsion/.test(part.id)),
    false,
  );
  assert.equal(
    machineGrammar.inventory.entries.reduce((sum, entry) => sum + entry.quantity, 0),
    24,
  );
  assert.deepEqual(
    Object.fromEntries(
      machineGrammar.inventory.entries.map((entry) => [entry.definitionId, entry.quantity]),
    ),
    {
      beam_short: 2,
      beam_medium: 2,
      beam_long: 2,
      hub: 4,
      axle_short: 1,
      axle_long: 1,
      wheel: 2,
      sheave: 2,
      drum: 1,
      plank: 2,
      rope_hook: 2,
      wedge: 3,
    },
  );
});

test("machine, observation, replay, and benchmark contracts are strict JSON schemas", () => {
  for (const file of [
    "parts.schema.json",
    "ports.schema.json",
    "assemblies.schema.json",
    "agent-observation.schema.json",
    "agent-actions.schema.json",
    "replay-events.schema.json",
    "benchmark-results.schema.json",
  ]) {
    const schema = JSON.parse(
      readFileSync(join(process.cwd(), "schemas", file), "utf8"),
    ) as { $schema?: string; $id?: string; type?: string; additionalProperties?: boolean };
    assert.match(schema.$schema ?? "", /2020-12/);
    assert.equal(schema.$id, file);
    assert.equal(schema.type, "object");
    assert.equal(schema.additionalProperties, false);
  }
  const results = JSON.parse(
    readFileSync(join(process.cwd(), "data", "benchmark-results.json"), "utf8"),
  ) as { results: Array<{ policy: string; matches: number; status?: string }> };
  assert.deepEqual(
    results.results.map((result) => result.policy),
    ["random_legal", "nearest_compatible", "fixture_playback", "heuristic", "reasoning"],
  );
  assert.ok(results.results.every((result) => result.matches === 0 && result.status));
});

test("every declared connection pair is legal and unrelated ports are rejected", () => {
  const parts = disassembleMachineCatalog();
  const allPorts = parts.flatMap((part) => part.ports);
  for (const rule of machineGrammar.compatibility) {
    const first = allPorts.find((port) => port.kind === rule.first)!;
    const second = allPorts.find((port) => port.kind === rule.second)!;
    assert.ok(first && second, `${rule.first}>${rule.second} appears in the kit`);
    assert.equal(portsCompatible(first, second), true);
    assert.ok(rule.warningLoad < rule.safeLoad);
    assert.ok(rule.safeLoad < rule.breakForce);
    assert.ok(rule.dofBefore.length > rule.dofAfter.length || rule.joint !== "fixed");
  }
  const peg = allPorts.find((port) => port.kind === "rigid_peg")!;
  const groove = allPorts.find((port) => port.kind === "sheave_groove")!;
  const keyway = allPorts.find((port) => port.kind === "keyway")!;
  assert.equal(portsCompatible(peg, groove), false);
  assert.equal(portsCompatible(peg, keyway), false);
  assert.deepEqual(
    [...new Set(machineGrammar.compatibility.map((rule) => rule.class))].sort(),
    ["AXLE_BEARING", "KEYED_COAXIAL", "ROPE_ATTACH", "TENON_LOCK"],
  );
});

test("every snap port has a deterministic physical pose on its part", () => {
  const parts = disassembleMachineCatalog();
  for (const part of parts) {
    for (const port of part.ports) {
      const pose = puzzlePortPose(part, port.id);
      assert.ok(
        [pose.x, pose.y, pose.depth, pose.normal].every(Number.isFinite),
        `${part.id}:${port.id} has a finite connector pose`,
      );
    }
  }
  const beam = parts.find((part) => part.id === "beam_long_01")!;
  const hub = parts.find((part) => part.id === "hub_01")!;
  assert.ok(puzzlePortPose(beam, "left_tenon").x < 0);
  assert.ok(puzzlePortPose(beam, "right_tenon").x > 0);
  assert.equal(hub.ports.filter((port) => port.kind === "rigid_socket").length, 8);
  assert.deepEqual(
    puzzlePortPose(hub, "axial_bore"),
    { x: 0, y: 0, depth: 0, normal: 0 },
  );
});

test("compound assemblies derive only the neutral repair capabilities", () => {
  const parts = disassembleMachineCatalog();
  const byId = new Map(parts.map((part) => [part.id, part]));
  const analyze = (
    ids: string[],
    connections: Array<{ firstId: string; firstPort: string; secondId: string; secondPort: string }>,
  ) => summarizeAssembly(ids, byId, connections);

  const frame = analyze(["beam_long_01", "hub_01"], [{
    firstId: "beam_long_01", firstPort: "right_tenon", secondId: "hub_01", secondPort: "socket_w",
  }]);
  assert.ok(frame.capabilities.includes("support"));
  assert.ok(frame.capabilities.includes("brace"));

  const wheel = analyze(["axle_short_01", "wheel_01", "hub_01"], [
    { firstId: "axle_short_01", firstPort: "left_key", secondId: "wheel_01", secondPort: "keyed_bore" },
    { firstId: "axle_short_01", firstPort: "right_journal", secondId: "hub_01", secondPort: "axial_bore" },
  ]);
  assert.ok(wheel.simpleMachines.some((machine) => machine.kind === "wheel_and_axle"));
  assert.ok(wheel.capabilities.includes("roll"));

  const pulley = analyze(["rope_hook_01", "sheave_01"], [{
    firstId: "rope_hook_01", firstPort: "plain_end", secondId: "sheave_01", secondPort: "groove",
  }]);
  assert.ok(pulley.simpleMachines.some((machine) => machine.kind === "pulley"));
  assert.ok(pulley.capabilities.includes("redirect_rope"));

  const plane = analyze(["plank_01", "beam_short_01"], [{
    firstId: "plank_01", firstPort: "left_saddle", secondId: "beam_short_01", secondPort: "left_tenon",
  }]);
  assert.ok(plane.simpleMachines.some((machine) => machine.kind === "inclined_plane"));
  assert.ok(plane.capabilities.includes("ramp"));

  const allowed = new Set([
    "support", "brace", "roll", "ramp", "pivot", "pull", "push", "lift",
    "lower", "redirect_rope", "wind_rope", "chock", "strike",
  ]);
  assert.ok([frame, wheel, pulley, plane].every((summary) =>
    summary.capabilities.every((capability) => allowed.has(capability)),
  ));
});

test("the live puzzle keeps a focused set of mechanically distinct parts", () => {
  const parts = gameplayPuzzleCatalog();
  assert.equal(parts.length, 24);
  assert.equal(new Set(parts.map((part) => part.definitionId)).size, 12);
  assert.deepEqual(
    [...new Set(parts.map((part) => part.componentType))].sort(),
    ["axle", "bar", "brace", "cheek", "drum", "lashing", "platform", "sheave", "wheel"],
  );
});

test("both teams receive fixed mirrored edge inventories", async () => {
  const root = mkdtempSync(join(tmpdir(), "humpty-puzzle-"));
  const driver: AgentDriver = {
    model: "puzzle-test",
    async act(): Promise<AgentSubmission> {
      return { action: { type: "wait" } };
    },
  };
  const simulation = new GameSimulation({ root, driver, seed: 7411 });
  await simulation.initialize();
  const snapshot = simulation.snapshot();
  const kitFor = (team: "king" | "queen") =>
    snapshot.entities
      .filter((entity) => entity.team === team && entity.puzzleKind)
      .map((entity) => entity.puzzleKind)
      .sort();
  assert.equal(snapshot.puzzleMode, true);
  assert.deepEqual(kitFor("king"), kitFor("queen"));
  assert.equal(kitFor("king").length, 24);
  const looseParts = snapshot.entities.filter((entity) => entity.puzzleKind);
  assert.ok(
    looseParts.every((entity) =>
      entity.snapPorts?.every((port) =>
        [port.x, port.y, port.depth, port.normal].every(Number.isFinite),
      ),
    ),
  );
  assert.ok(looseParts.every((entity) => Math.abs(entity.x - 600) > 350));
  assert.deepEqual(
    [...new Set(
      snapshot.entities
        .filter((entity) => entity.team === "king" && entity.puzzleKind)
        .map((entity) => entity.x),
    )].sort((first, second) => first - second),
    [62, 148],
  );
  assert.deepEqual(
    [...new Set(
      snapshot.entities
        .filter((entity) => entity.team === "queen" && entity.puzzleKind)
        .map((entity) => entity.x),
    )].sort((first, second) => first - second),
    [1052, 1138],
  );
  assert.ok(
    looseParts
      .filter((entity) =>
        ["bar", "brace", "platform", "axle", "lashing"].includes(
          entity.componentType ?? "",
        ),
      )
      .every((entity) => Math.abs((entity.puzzleYaw ?? 0) - Math.PI / 2) < 0.001),
  );
  assert.ok(
    looseParts.every((entity) => {
      const halfHeight = entity.radius
        ? entity.radius
        : Math.max(
            4,
            Math.abs(Math.sin(entity.angle)) * ((entity.width ?? 8) / 2) +
              Math.abs(Math.cos(entity.angle)) * ((entity.height ?? 8) / 2),
          );
      return Math.abs(entity.y - halfHeight - 30) < 0.1;
    }),
  );
  const depths = looseParts.map((entity) => entity.puzzleDepth ?? 0);
  assert.ok(Math.abs(Math.max(...depths) - Math.min(...depths) - 11) < 0.001);
  for (const kingPart of snapshot.entities.filter(
    (entity) => entity.team === "king" && entity.puzzleKind,
  )) {
    const queenPart = snapshot.entities.find(
      (entity) =>
        entity.id === kingPart.id.replace("kit_king_", "kit_queen_"),
    );
    assert.ok(queenPart);
    assert.ok(Math.abs(kingPart.x + queenPart.x - 1200) < 0.01);
    assert.equal(kingPart.puzzleDepth, queenPart.puzzleDepth);
  }
  assert.equal(
    snapshot.entities.filter((entity) => /^block_\d+$/.test(entity.id)).length,
    36,
  );
  assert.ok(snapshot.entities.some((entity) => entity.id === "humpty_seat"));

  const collisionPart = snapshot.entities.find(
    (entity) => entity.id === "kit_king_wedge_01",
  )!;
  const collision = simulation.debugMovePuzzleAssembly(
    collisionPart.id,
    900,
    collisionPart.y,
    collisionPart.puzzleDepth ?? 0,
  );
  const stopped = simulation
    .snapshot()
    .entities.find((entity) => entity.id === collisionPart.id)!;
  assert.equal(collision.blocked, true);
  assert.ok(stopped.x < 520);

  const settlingPart = simulation.snapshot().entities.find(
    (entity) => entity.id === "kit_king_rope_hook_01",
  )!;
  simulation.debugMovePuzzleAssembly(
    settlingPart.id,
    250,
    settlingPart.y,
    6.5,
  );
  simulation.debugLiftPuzzleAssembly(settlingPart.id, 120);
  simulation.debugStep(2);
  const settled = simulation
    .snapshot()
    .entities.find((entity) => entity.id === settlingPart.id)!;
  const settledHalfHeight = settled.radius
    ? settled.radius
    : Math.max(
        4,
        Math.abs(Math.sin(settled.angle)) * ((settled.width ?? 8) / 2) +
          Math.abs(Math.cos(settled.angle)) * ((settled.height ?? 8) / 2),
      );
  assert.ok(settled.y - settledHalfHeight < 34);
  simulation.dispose();
  rmSync(root, { recursive: true, force: true });
});

test("the center is a 36-block alternating Jenga tower on a visible plinth", async () => {
  const root = mkdtempSync(join(tmpdir(), "humpty-jenga-topology-"));
  const simulation = new GameSimulation({
    root,
    driver: {
      model: "tower-topology-test",
      async act(): Promise<AgentSubmission> {
        return { action: { type: "wait" } };
      },
    },
    seed: 1881,
  });
  await simulation.initialize();
  const topology = simulation.debugTowerTopology();
  assert.equal(topology.blocks.length, 36);
  assert.equal(topology.constraintCount, 0);
  assert.equal(new Set(topology.blocks.map((block) => block.mass.toFixed(4))).size, 1);
  for (let layer = 0; layer < 12; layer += 1) {
    const course = topology.blocks.filter((block) => block.layer === layer);
    assert.deepEqual(course.map((block) => block.slot), [0, 1, 2]);
    assert.equal(new Set(course.map((block) => block.yaw)).size, 1);
    if (layer > 0) {
      const previousYaw = topology.blocks.find((block) => block.layer === layer - 1)!.yaw;
      assert.ok(Math.abs(Math.abs(course[0]!.yaw - previousYaw) - Math.PI / 2) < 0.001);
    }
  }
  assert.ok(simulation.snapshot().entities.some((entity) => entity.kind === "plinth"));
  simulation.debugStep(10);
  const standing = simulation.snapshot().entities.filter((entity) => /^block_\d+$/.test(entity.id));
  assert.equal(standing.length, 36);
  assert.ok(standing.every((block) => Math.abs(block.angle) < 0.03));
  simulation.dispose();
  rmSync(root, { recursive: true, force: true });
});

test("Humpty rests on the visible seat and falls when support is removed", async () => {
  const root = mkdtempSync(join(tmpdir(), "humpty-seat-support-"));
  const simulation = new GameSimulation({
    root,
    driver: {
      model: "seat-support-test",
      async act(): Promise<AgentSubmission> {
        return { action: { type: "wait" } };
      },
    },
    seed: 1882,
  });
  await simulation.initialize();
  const before = simulation.snapshot().entities.find((entity) => entity.id === "humpty")!;
  const support = simulation.debugHumptySupport();
  assert.ok(support.humptySeatContacts > 0);
  assert.ok(support.seatTowerContacts > 0);
  assert.ok(Math.abs(support.humptySeatSeparation) <= 1);
  assert.ok(Math.abs(support.seatTowerSeparation) <= 1);
  assert.equal(support.centerInsideSeat, true);
  assert.ok(support.humptyVerticalSpeed < 0.2);
  simulation.debugStep(5);
  const settled = simulation.snapshot().entities.find((entity) => entity.id === "humpty")!;
  assert.ok(Math.abs(settled.y - before.y) <= 2);
  simulation.debugRemoveRoyalSeat();
  for (const blockId of ["block_33", "block_34", "block_35"]) {
    simulation.debugRemoveTowerBlock(blockId);
  }
  simulation.debugStep(0.5);
  const falling = simulation.snapshot().entities.find((entity) => entity.id === "humpty")!;
  assert.ok(falling.y < settled.y - 10);
  simulation.dispose();
  rmSync(root, { recursive: true, force: true });
});

test("the A-frame fixture raises, holds, and lowers dynamic Humpty", async () => {
  const root = mkdtempSync(join(tmpdir(), "humpty-rescue-fixture-"));
  const simulation = new GameSimulation({
    root,
    driver: {
      model: "rescue-fixture-test",
      async act(): Promise<AgentSubmission> {
        return { action: { type: "wait" } };
      },
    },
    seed: 1883,
  });
  await simulation.initialize();
  const fixture = simulation.debugArrangeRescueFixture();
  assert.ok(fixture.partIds.includes("kit_king_beam_long_01"));
  assert.ok(fixture.partIds.includes("kit_king_beam_long_02"));
  assert.ok(fixture.partIds.includes("kit_king_drum_01"));
  assert.ok(fixture.partIds.includes("kit_king_sheave_01"));
  assert.ok(fixture.capabilities.includes("lift"));
  assert.ok(fixture.capabilities.includes("lower"));

  const opening = simulation
    .snapshot()
    .entities.find((entity) => entity.id === "humpty")!;
  simulation.debugStartRescueFixture(fixture.assemblyId);
  const samples: Array<{ time: number; y: number }> = [];
  for (let index = 1; index <= 90; index += 1) {
    simulation.debugStep(0.1);
    const humpty = simulation
      .snapshot()
      .entities.find((entity) => entity.id === "humpty")!;
    samples.push({ time: index / 10, y: humpty.y });
    assert.equal(simulation.debugBodyIsDynamic("humpty"), true);
  }
  const lifts = samples.map((sample) => sample.y - opening.y);
  assert.ok(Math.max(...lifts) >= 12);
  assert.ok(Math.max(...lifts) <= 14.5);
  const hold = samples.filter(
    (sample) => sample.time >= 2.4 && sample.time <= 4.2,
  );
  assert.ok(Math.max(...hold.map((sample) => sample.y)) - Math.min(...hold.map((sample) => sample.y)) < 0.5);
  assert.ok(
    samples.every(
      (sample, index) =>
        index === 0 || Math.abs(sample.y - samples[index - 1]!.y) < 2,
    ),
  );
  const finalHumpty = simulation
    .snapshot()
    .entities.find((entity) => entity.id === "humpty")!;
  assert.ok(Math.abs(finalHumpty.y - opening.y) < 2);
  assert.equal(
    simulation.snapshot().entities.filter((entity) => entity.kind === "rope").length,
    0,
  );

  simulation.dispose();
  rmSync(root, { recursive: true, force: true });
});

test("the wheeled ram transfers its push to a real Jenga block", async () => {
  const root = mkdtempSync(join(tmpdir(), "humpty-attack-fixture-"));
  const simulation = new GameSimulation({
    root,
    driver: {
      model: "attack-fixture-test",
      async act(): Promise<AgentSubmission> {
        return { action: { type: "wait" } };
      },
    },
    seed: 1884,
  });
  await simulation.initialize();
  const fixture = simulation.debugArrangeAttackFixture();
  assert.ok(fixture.partIds.includes("kit_queen_beam_long_01"));
  assert.ok(fixture.partIds.includes("kit_queen_hub_01"));
  assert.ok(fixture.partIds.includes("kit_queen_axle_short_01"));
  assert.ok(fixture.partIds.includes("kit_queen_wheel_01"));
  assert.ok(fixture.partIds.includes("kit_queen_wheel_02"));
  const before = simulation.snapshot();
  const blockBefore = before.entities.find(
    (entity) => entity.id === fixture.blockId,
  )!;
  const ramBefore = before.entities.find(
    (entity) => entity.id === fixture.ramId,
  )!;
  assert.ok(ramBefore.x > blockBefore.x);
  assert.equal(simulation.debugBodyIsDynamic(fixture.blockId), true);

  simulation.debugDriveAttackFixture(fixture.ramId, fixture.blockId, 1);
  simulation.debugStep(0.2);
  const after = simulation.snapshot();
  const blockAfter = after.entities.find(
    (entity) => entity.id === fixture.blockId,
  )!;
  assert.ok(blockAfter.x < blockBefore.x - 0.1);
  assert.equal(simulation.debugBodyIsDynamic(fixture.blockId), true);
  assert.ok(
    simulation
      .debugPuzzleHistory(fixture.ramId)
      .some((entry) => entry.includes("fixture_ram_drive")),
  );

  simulation.dispose();
  rmSync(root, { recursive: true, force: true });
});

test("physical sabotage leaves a failed joint that can be repaired and recovered", async () => {
  const root = mkdtempSync(join(tmpdir(), "humpty-sabotage-"));
  const driver: AgentDriver = {
    model: "puzzle-test",
    async act(): Promise<AgentSubmission> {
      return { action: { type: "wait" } };
    },
  };
  const simulation = new GameSimulation({ root, driver, seed: 8113 });
  await simulation.initialize();
  const first = "kit_king_wedge_01";
  const second = "kit_king_beam_short_01";
  const connectionId = simulation.debugConnectPuzzleParts(
    first,
    "rear_socket",
    second,
    "left_tenon",
  );
  simulation.debugSetElapsed(190);
  const sabotageTarget = simulation.snapshot().entities.find((entity) => entity.id === first)!;
  simulation.debugPlaceMan(
    "queen_1",
    sabotageTarget.x,
    sabotageTarget.puzzleDepth ?? 0,
  );
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = simulation.debugApplyAgentSubmission("queen_1", {
      action: { type: "sabotage", connectionId, method: "strike" },
    });
    assert.equal(result.accepted, true);
  }
  assert.equal(simulation.debugPuzzleConnection(connectionId)?.state, "failed");
  assert.equal(simulation.debugPuzzleLifecycle(first), "damaged");

  simulation.debugRealignPuzzleConnection(connectionId);
  const repairTarget = simulation.snapshot().entities.find((entity) => entity.id === first)!;
  simulation.debugPlaceMan(
    "king_1",
    repairTarget.x,
    repairTarget.puzzleDepth ?? 0,
  );
  const repair = simulation.debugApplyAgentSubmission("king_1", {
    action: { type: "repair", connectionId },
  });
  assert.equal(repair.accepted, true);
  assert.equal(simulation.debugPuzzleConnection(connectionId)?.state, "locked");
  assert.equal(simulation.debugPuzzleConnection(connectionId)?.integrity, 0.72);

  const detach = simulation.debugApplyAgentSubmission("king_1", {
    action: { type: "detach", partId: first },
  });
  assert.equal(detach.accepted, true);
  assert.equal(simulation.debugPuzzleLifecycle(first), "detached");
  const recover = simulation.debugApplyAgentSubmission("king_1", {
    action: { type: "recover", partId: first },
  });
  assert.equal(recover.accepted, true);
  let sawPhysicalCarry = false;
  for (let sample = 0; sample < 300; sample += 1) {
    simulation.debugStep(0.1);
    const state = simulation.debugPuzzleLifecycle(first);
    sawPhysicalCarry ||= state === "carried";
    if (state === "stored_or_reused") break;
  }
  assert.equal(sawPhysicalCarry, true);
  assert.equal(simulation.debugPuzzleLifecycle(first), "stored_or_reused");
  for (let sample = 0; sample < 180; sample += 1) {
    simulation.debugStep(0.1);
    const worker = simulation
      .snapshot()
      .entities.find((entity) => entity.id === "king_1");
    if (!worker?.taskOperation) break;
  }
  assert.equal(
    simulation.snapshot().entities.find((entity) => entity.id === "king_1")
      ?.taskOperation,
    undefined,
  );
  simulation.dispose();
  rmSync(root, { recursive: true, force: true });
});

test("a connection is logged from reserve through physical proof test", async () => {
  const root = mkdtempSync(join(tmpdir(), "humpty-lifecycle-"));
  const simulation = new GameSimulation({
    root,
    driver: {
      model: "lifecycle-test",
      async act(): Promise<AgentSubmission> {
        return { action: { type: "wait" } };
      },
    },
    seed: 8114,
  });
  await simulation.initialize();
  const movingId = "kit_king_beam_short_01";
  const targetId = "kit_king_hub_01";
  const opening = simulation.snapshot();
  assert.equal(simulation.debugPuzzleConnectionCount(), 0);
  assert.ok(
    opening.entities
      .filter((entity) => entity.puzzleKind)
      .every((entity) => (entity.connectedTo?.length ?? 0) === 0),
  );
  const accepted = simulation.debugApplyAgentSubmission("king_1", {
    action: { type: "snap", partId: movingId, targetId },
  });
  assert.equal(accepted.accepted, true);
  for (let sample = 0; sample < 600; sample += 1) {
    simulation.debugStep(0.1);
    if (simulation.debugPuzzleLifecycle(movingId) === "tested") break;
  }
  assert.ok(simulation.debugPuzzleConnectionCount() >= 1);
  assert.equal(simulation.debugPuzzleLifecycle(movingId), "tested");
  assert.equal(simulation.debugPuzzleLifecycle(targetId), "tested");
  for (let sample = 0; sample < 180; sample += 1) {
    simulation.debugStep(0.1);
    if (
      !simulation
        .snapshot()
        .snapPreviews.some((preview) => preview.workerId === "king_1")
    ) {
      break;
    }
  }
  assert.equal(
    simulation.snapshot().entities.find((entity) => entity.id === "king_1")
      ?.taskOperation,
    undefined,
  );
  assert.equal(simulation.snapshot().physicsDiagnostics!.workerPenetration, 0);
  const connected = simulation
    .snapshot()
    .entities.find((entity) => entity.id === movingId)?.connectedTo ?? [];
  assert.ok(connected.includes(targetId));
  const actions = [
    ...simulation.debugPuzzleHistory(movingId),
    ...simulation.debugPuzzleHistory(targetId),
  ]
    .flatMap((entry) => {
      const [tick, , action] = entry.split(":");
      return action ? [{ tick: Number(tick), action }] : [];
    })
    .sort((first, second) => first.tick - second.tick)
    .map((entry) => entry.action);
  const expected = [
    "reserve_for_connect",
    "fetch_target",
    "lift_target",
    "stage_target",
    "fetch_part",
    "lift_part",
    "align_ports",
    "connect_ports",
    "release_to_joint",
    "proof_test",
  ];
  let cursor = -1;
  for (const action of expected) {
    cursor = actions.indexOf(action, cursor + 1);
    assert.ok(cursor >= 0, `missing ordered lifecycle action ${action}`);
  }
  simulation.dispose();
  rmSync(root, { recursive: true, force: true });
});

test("interrupting alignment leaves visible parts unconnected", async () => {
  const root = mkdtempSync(join(tmpdir(), "humpty-interrupt-"));
  const simulation = new GameSimulation({
    root,
    driver: {
      model: "interruption-test",
      async act(): Promise<AgentSubmission> {
        return { action: { type: "wait" } };
      },
    },
    seed: 8115,
  });
  await simulation.initialize();
  const movingId = "kit_king_beam_short_01";
  const targetId = "kit_king_hub_01";
  const accepted = simulation.debugApplyAgentSubmission("king_1", {
    action: { type: "snap", partId: movingId, targetId },
  });
  assert.equal(accepted.accepted, true);
  let reachedAlignment = false;
  for (let sample = 0; sample < 500; sample += 1) {
    simulation.debugStep(0.1);
    reachedAlignment ||= simulation
      .snapshot()
      .snapPreviews.some(
        (preview) => preview.workerId === "king_1" && preview.phase === "snap",
      );
    if (reachedAlignment) break;
  }
  assert.equal(reachedAlignment, true);
  assert.equal(simulation.debugPuzzleConnectionCount(), 0);
  assert.equal(simulation.debugInterruptPuzzleTask("king_1"), true);
  assert.equal(simulation.debugPuzzleConnectionCount(), 0);
  assert.equal(simulation.debugPuzzleLifecycle(movingId), "recoverable");
  assert.equal(simulation.debugPuzzleLifecycle(targetId), "recoverable");
  const snapshot = simulation.snapshot();
  assert.ok(snapshot.entities.some((entity) => entity.id === movingId));
  assert.ok(snapshot.entities.some((entity) => entity.id === targetId));
  assert.ok(
    simulation
      .debugPuzzleHistory(movingId)
      .some((entry) => entry.endsWith(":connect_interrupted")),
  );
  simulation.dispose();
  rmSync(root, { recursive: true, force: true });
});

test("same-runtime fixed-step snapshots retain deterministic checksums", async () => {
  const roots = [
    mkdtempSync(join(tmpdir(), "humpty-replay-a-")),
    mkdtempSync(join(tmpdir(), "humpty-replay-b-")),
  ];
  const driver: AgentDriver = {
    model: "puzzle-test",
    async act(): Promise<AgentSubmission> {
      return { action: { type: "wait" } };
    },
  };
  const simulations = roots.map((root) => new GameSimulation({ root, driver, seed: 9191 }));
  await Promise.all(simulations.map((simulation) => simulation.initialize()));
  for (const simulation of simulations) {
    simulation.debugStep(4);
    simulation.debugPlaceMan("king_1", 220, -2);
    simulation.debugStep(2);
  }
  const [first, second] = simulations.map((simulation) => simulation.snapshot());
  assert.equal(first?.simulationTick, second?.simulationTick);
  assert.equal(first?.stateChecksum, second?.stateChecksum);
  simulations.forEach((simulation) => simulation.dispose());
  roots.forEach((root) => rmSync(root, { recursive: true, force: true }));
});

test("full live inventory stays inside the fixed-step performance budget", async () => {
  const root = mkdtempSync(join(tmpdir(), "humpty-performance-"));
  const driver: AgentDriver = {
    model: "puzzle-test",
    async act(): Promise<AgentSubmission> {
      return { action: { type: "wait" } };
    },
  };
  const simulation = new GameSimulation({ root, driver, seed: 4801 });
  await simulation.initialize();
  for (const team of ["king", "queen"] as const) {
    simulation.debugConnectPuzzleParts(
      `kit_${team}_beam_long_01`,
      "right_tenon",
      `kit_${team}_hub_01`,
      "socket_w",
    );
    simulation.debugConnectPuzzleParts(
      `kit_${team}_axle_short_01`,
      "left_key",
      `kit_${team}_wheel_01`,
      "keyed_bore",
    );
  }
  const started = performance.now();
  simulation.debugStep(5);
  const duration = performance.now() - started;
  assert.ok(duration < 1000, `five simulated seconds took ${duration.toFixed(1)}ms`);
  assert.equal(simulation.snapshot().entities.filter((entity) => entity.puzzleKind).length, 48);
  simulation.dispose();
  rmSync(root, { recursive: true, force: true });
});

test("live play exposes paced build, contest, and decisive beats", async () => {
  const root = mkdtempSync(join(tmpdir(), "humpty-beats-"));
  const driver: AgentDriver = {
    model: "beat-test",
    async act(): Promise<AgentSubmission> {
      return { action: { type: "wait" } };
    },
  };
  const simulation = new GameSimulation({ root, driver, seed: 7412 });
  await simulation.initialize();
  assert.equal(simulation.snapshot().matchBeat, "layout");
  simulation.debugSetElapsed(76);
  assert.equal(simulation.snapshot().matchBeat, "build");
  simulation.debugSetElapsed(181);
  assert.equal(simulation.snapshot().matchBeat, "contest");
  simulation.debugSetElapsed(301);
  assert.equal(simulation.snapshot().matchBeat, "decisive");
  simulation.dispose();
  rmSync(root, { recursive: true, force: true });
});

test("one compact team decision starts distinct physical jobs", async () => {
  let teamCalls = 0;
  const driver: AgentDriver = {
    model: "team-board-test",
    async act(): Promise<AgentSubmission> {
      return { action: { type: "wait" } };
    },
    async actTeam(team, state) {
      teamCalls += 1;
      const used = new Set<string>();
      const options = state.joinOptions.filter((option) => {
        if (used.has(option.partId) || used.has(option.targetId)) return false;
        used.add(option.partId);
        used.add(option.targetId);
        return true;
      });
      return {
        order:
          team === "king"
            ? "Build three useful mechanisms at once."
            : "Prepare three attacks at once.",
        actions: state.crew.flatMap((worker, index) => {
          const option = options[index];
          return option
            ? [
                {
                  agentId: worker.id,
                  say: "Taking my assigned connection.",
                  action: {
                    type: "snap",
                    partId: option.partId,
                    targetId: option.targetId,
                  },
                },
              ]
            : [];
        }),
      };
    },
  };
  const root = mkdtempSync(join(tmpdir(), "humpty-team-board-"));
  const simulation = new GameSimulation({ root, driver, seed: 52 });
  await simulation.initialize();

  const board = simulation.debugTeamState("king");
  const encoded = JSON.stringify(board);
  assert.ok(encoded.length < 17_000);
  assert.ok(board.joinOptions.length >= 8);
  assert.equal(
    board.joinOptions.some(
      (option) =>
        /hub/.test(option.partId) && /rope_hook/.test(option.targetId) ||
        /rope_hook/.test(option.partId) && /hub/.test(option.targetId),
    ),
    false,
  );
  assert.equal(
    board.joinOptions.some(
      (option) =>
        /sheave/.test(option.partId) && /sheave/.test(option.targetId),
    ),
    false,
  );
  assert.doesNotMatch(encoded, /"affordances"|"constraints"/);
  assert.match(board.space.axes, /x left-right, y back-front, z height/);
  assert.deepEqual(board.space.bounds.x, [0, 1200]);
  assert.ok(board.space.landmarks.some((landmark) => landmark.id === "tower"));
  assert.equal(board.tower.blockCount, 36);
  assert.ok(board.tower.signedSupportMargin > 0);
  assert.ok(board.tower.maximumTilt < 0.01);
  assert.ok(board.stock.every((part) => part.pose.p.length === 3));
  assert.ok(board.stock.every((part) => part.pose.size.length === 3));
  assert.ok(
    board.joinOptions.every(
      (option) =>
        option.travel > 0 &&
        option.worksite.length === 3 &&
        option.resultMass > 0 &&
        Array.isArray(option.gainedCapabilities) &&
        Array.isArray(option.completedFunctions) &&
        Array.isArray(option.resultSimpleMachines),
    ),
  );
  const leadingOptions = board.joinOptions.slice(0, 3);
  assert.ok(
    new Set(leadingOptions.flatMap((option) => option.completedFunctions)).size >= 3,
  );
  assert.equal(
    new Set(
      leadingOptions.flatMap((option) => [option.partId, option.targetId]),
    ).size,
    6,
  );

  await simulation.debugRunTeamDecision("king");
  const activeWorkers = simulation
    .snapshot()
    .entities.filter(
      (entity) =>
        entity.kind === "man" &&
        entity.team === "king" &&
        entity.taskOperation === "fetch",
    );
  assert.equal(teamCalls, 1);
  assert.equal(activeWorkers.length, 3);

  simulation.debugStep(18);
  const staged = simulation.snapshot().entities.filter(
    (entity) =>
      entity.team === "king" &&
      entity.puzzleKind &&
      entity.assemblyState !== "stock",
  );
  assert.ok(staged.length > 0);
  assert.ok(staged.some((entity) => entity.x > 145 && entity.x < 345));
  assert.ok(
    simulation
      .snapshot()
      .entities.some(
        (entity) =>
          entity.team === "king" &&
          entity.puzzleKind &&
          (entity.connectedTo?.length ?? 0) > 0,
      ),
  );
  assert.ok(
    simulation
      .snapshot()
      .entities.filter(
        (entity) =>
          entity.kind === "man" &&
          entity.team === "king" &&
          entity.taskOperation,
      ).length >= 2,
  );

  simulation.dispose();
  rmSync(root, { recursive: true, force: true });
});

test("workers route around the stone tower instead of crossing it", async () => {
  const root = mkdtempSync(join(tmpdir(), "humpty-floor-routing-"));
  const simulation = new GameSimulation({
    root,
    driver: {
      model: "floor-routing-test",
      async act(): Promise<AgentSubmission> {
        return { action: { type: "wait" } };
      },
    },
    seed: 54,
  });
  await simulation.initialize();
  simulation.debugMoveMan("king_1", 770, 0);

  let diverted = false;
  let crossedSolidTower = false;
  for (let sample = 0; sample < 160; sample += 1) {
    simulation.debugStep(0.1);
    const worker = simulation
      .snapshot()
      .entities.find((entity) => entity.id === "king_1")!;
    diverted ||= Math.abs(worker.puzzleDepth ?? 0) > 2.45;
    if (
      worker.x > 495 &&
      worker.x < 705 &&
      Math.abs(worker.puzzleDepth ?? 0) < 2.42
    ) {
      crossedSolidTower = true;
    }
  }
  const worker = simulation
    .snapshot()
    .entities.find((entity) => entity.id === "king_1")!;
  assert.ok(diverted);
  assert.equal(crossedSolidTower, false);
  assert.ok(worker.x > 735);

  simulation.dispose();
  rmSync(root, { recursive: true, force: true });
});

test("a worker stops at the stage wall and remains grounded", async () => {
  const root = mkdtempSync(join(tmpdir(), "humpty-worker-wall-"));
  const simulation = new GameSimulation({
    root,
    driver: {
      model: "worker-wall-test",
      async act(): Promise<AgentSubmission> {
        return { action: { type: "wait" } };
      },
    },
    seed: 56,
  });
  await simulation.initialize();
  simulation.debugPlaceMan("king_1", 100, 7.5);
  simulation.debugMoveMan("king_1", 0, 7.5);
  let minimumX = Infinity;
  for (let sample = 0; sample < 50; sample += 1) {
    simulation.debugStep(0.1);
    const worker = simulation
      .snapshot()
      .entities.find((entity) => entity.id === "king_1")!;
    minimumX = Math.min(minimumX, worker.x);
    assert.ok(worker.y >= 52 && worker.y <= 54);
  }
  const snapshot = simulation.snapshot();
  const worker = snapshot.entities.find((entity) => entity.id === "king_1")!;
  assert.ok(minimumX >= 42);
  assert.ok(worker.x < 58);
  assert.equal(worker.vx, 0);
  assert.equal(snapshot.physicsDiagnostics!.workerPenetration, 0);

  simulation.dispose();
  rmSync(root, { recursive: true, force: true });
});

test("workers meeting in a narrow lane separate instead of interpenetrating", async () => {
  const root = mkdtempSync(join(tmpdir(), "humpty-worker-lane-"));
  const simulation = new GameSimulation({
    root,
    driver: {
      model: "worker-lane-test",
      async act(): Promise<AgentSubmission> {
        return { action: { type: "wait" } };
      },
    },
    seed: 55,
  });
  await simulation.initialize();
  simulation.debugPlaceMan("king_1", 420, 0);
  simulation.debugPlaceMan("queen_1", 520, 0);
  simulation.debugMoveMan("king_1", 560, 0);
  simulation.debugMoveMan("queen_1", 380, 0);
  let closest = Infinity;
  let laneChange = false;
  for (let sample = 0; sample < 100; sample += 1) {
    simulation.debugStep(0.1);
    const entities = simulation.snapshot().entities;
    const king = entities.find((entity) => entity.id === "king_1")!;
    const queen = entities.find((entity) => entity.id === "queen_1")!;
    closest = Math.min(
      closest,
      Math.hypot(
        king.x - queen.x,
        ((king.puzzleDepth ?? 0) - (queen.puzzleDepth ?? 0)) * 45,
      ),
    );
    laneChange ||=
      Math.abs(king.puzzleDepth ?? 0) > 0.5 ||
      Math.abs(queen.puzzleDepth ?? 0) > 0.5;
  }
  assert.ok(closest > 20);
  assert.equal(laneChange, true);
  assert.equal(simulation.snapshot().physicsDiagnostics!.workerPenetration, 0);

  simulation.dispose();
  rmSync(root, { recursive: true, force: true });
});

test("a carried long beam takes the wider route around the tower", async () => {
  const runRoute = async (carry: boolean): Promise<number> => {
    const root = mkdtempSync(join(tmpdir(), `humpty-carry-clearance-${carry}-`));
    const simulation = new GameSimulation({
      root,
      driver: {
        model: "carry-clearance-test",
        async act(): Promise<AgentSubmission> {
          return { action: { type: "wait" } };
        },
      },
      seed: 54,
    });
    await simulation.initialize();
    if (carry) {
      simulation.debugAssignCarryEnvelope(
        "king_1",
        "kit_king_beam_long_01",
      );
    }
    simulation.debugMoveMan("king_1", 770, 0);
    let maximumDepth = 0;
    for (let sample = 0; sample < 180; sample += 1) {
      simulation.debugStep(0.1);
      const worker = simulation
        .snapshot()
        .entities.find((entity) => entity.id === "king_1")!;
      maximumDepth = Math.max(
        maximumDepth,
        Math.abs(worker.puzzleDepth ?? 0),
      );
    }
    assert.equal(simulation.snapshot().physicsDiagnostics!.workerPenetration, 0);
    simulation.dispose();
    rmSync(root, { recursive: true, force: true });
    return maximumDepth;
  };

  const emptyHandedDepth = await runRoute(false);
  const carriedDepth = await runRoute(true);
  assert.ok(carriedDepth > emptyHandedDepth + 1);
});

test("an unfinished episode becomes a draw at ten minutes", async () => {
  const root = mkdtempSync(join(tmpdir(), "humpty-ten-minute-draw-"));
  const simulation = new GameSimulation({
    root,
    driver: {
      model: "clock-test",
      async act(): Promise<AgentSubmission> {
        return { action: { type: "wait" } };
      },
    },
    seed: 53,
  });
  await simulation.initialize();
  simulation.debugSetElapsed(599.95);
  simulation.debugStep(0.1);
  const outcome = simulation.snapshot();
  assert.equal(outcome.winner, "draw");
  assert.match(outcome.outcome ?? "", /Ten minutes elapsed/);
  assert.ok(outcome.elapsed >= 600);
  assert.ok(outcome.elapsed < 600.1);

  simulation.dispose();
  rmSync(root, { recursive: true, force: true });
});

test("frenetic opening work stays onstage without waking the tower", async () => {
  const root = mkdtempSync(join(tmpdir(), "humpty-safe-opening-"));
  const simulation = new GameSimulation({
    root,
    driver: {
      model: "local-initiative-test",
      async act(): Promise<AgentSubmission> {
        return { action: { type: "wait" } };
      },
      async actTeam() {
        return { actions: [] };
      },
    },
    seed: 897080708,
  });
  await simulation.initialize();
  for (let cycle = 0; cycle < 8; cycle += 1) {
    await simulation.debugRunTeamDecision("king");
    await simulation.debugRunTeamDecision("queen");
    simulation.debugStep(5);
  }
  const opening = simulation.snapshot();
  const workers = opening.entities.filter((entity) => entity.kind === "man");
  assert.equal(opening.winner, null);
  assert.equal(opening.humptyIntegrity, 100);
  assert.ok(opening.humptyHeight > 470);
  assert.deepEqual(opening.deaths, { king: 0, queen: 0 });
  assert.ok(workers.every((worker) => worker.x >= 42 && worker.x <= 1158));

  simulation.dispose();
  rmSync(root, { recursive: true, force: true });
});

test.skip("legacy blueprint fixtures are excluded from puzzle play", () => {
  const winch = createBlueprint("winch", "king");
  const tackle = createBlueprint("pulley", "king");
  const launcher = createBlueprint("spring_trap", "queen");
  const cart = createBlueprint("cart", "king");
  const jack = createBlueprint("screw_jack", "king");
  const lever = createBlueprint("lever", "king");
  for (const plan of [winch, tackle, launcher]) {
    const componentIds = new Set(plan.components.map((component) => component.id));
    assert.ok(plan.mechanisms.length >= 3);
    assert.ok(
      plan.mechanisms.every((stage) =>
        stage.requires.every((componentId) => componentIds.has(componentId)),
      ),
    );
    assert.ok(plan.mechanisms.every((stage) => stage.input !== stage.output));
    assert.ok(plan.mechanisms.every((stage) => stage.efficiency > 0));
    assert.ok(plan.mechanisms.every((stage) => stage.efficiency <= 1));
    assert.deepEqual(plan.mechanisms[0]?.dependsOn, []);
    for (let index = 1; index < plan.mechanisms.length; index += 1) {
      assert.deepEqual(plan.mechanisms[index]?.dependsOn, [
        plan.mechanisms[index - 1]!.id,
      ]);
    }
    assert.ok(
      plan.mechanisms.every(
        (stage) => stage.testDuration >= 4 && stage.commissioning.length > 0,
      ),
    );
  }
  assert.deepEqual(
    winch.mechanisms.map((stage) => stage.capability),
    [
      "support",
      "multiply_force",
      "convert_motion",
      "hold_load",
      "control_motion",
    ],
  );
  assert.ok(
    tackle.mechanisms.some(
      (stage) =>
        stage.capability === "multiply_force" &&
        stage.mechanicalAdvantage === 4,
    ),
  );
  assert.ok(
    launcher.mechanisms.some(
      (stage) => stage.capability === "store_energy",
    ),
  );
  assert.ok(
    launcher.mechanisms.some(
      (stage) => stage.capability === "release_energy",
    ),
  );
  assert.equal(
    cart.components.filter((component) => component.id.includes("_bearing_"))
      .length,
    4,
  );
  assert.ok(
    jack.components.some((component) => component.id.endsWith("_guide_collar")),
  );
  assert.equal(
    lever.components.filter((component) =>
      component.id.includes("_pivot_cheek_"),
    ).length,
    2,
  );
  assert.equal(
    tackle.components.filter((component) => component.componentType === "cheek")
      .every((component) => Math.abs(component.final.z ?? 0) > 0),
    true,
  );
});

test("malformed actions are rejected into an explicit wait", () => {
  const result = validateSubmission({
    say: "This line is accepted.",
    action: { type: "repair", targetId: "humpty" },
  });
  assert.equal(result.accepted, false);
  assert.deepEqual(result.submission.action, { type: "wait" });
  assert.match(result.reason ?? "", /Malformed/);

  const weapon = validateSubmission({
    action: {
      type: "use_weapon",
      weapon: "crossbow",
      targetId: "queen_1",
    },
  });
  assert.equal(weapon.accepted, true);
  assert.deepEqual(weapon.submission.action, {
    type: "use_weapon",
    weapon: "crossbow",
    targetId: "queen_1",
  });

  const move = validateSubmission({
    action: { type: "move", x: 440, y: -150 },
  });
  assert.equal(move.accepted, true);
  assert.deepEqual(move.submission.action, {
    type: "move",
    x: 440,
    y: -150,
  });
});

test("the public cast has one Egg King and replays survive a restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "humpty-replay-"));
  const simulation = new GameSimulation({
    root,
    driver: {
      model: "replay-test",
      async act(): Promise<AgentSubmission> {
        return { action: { type: "wait" } };
      },
    },
    seed: 1881,
  });
  await simulation.initialize();
  const opening = simulation.snapshot();
  assert.equal(
    opening.agents.filter((agent) => agent.name === "Humpty, the Egg King")
      .length,
    1,
  );
  assert.equal(opening.agents.some((agent) => agent.id === "king"), false);

  const firstRun = opening.runId;
  simulation.debugStep(2);
  simulation.handleCommand({ type: "command", command: "restart" });
  const manifest = simulation.replayManifest();
  const archived = manifest.find((entry) => entry.runId === firstRun);
  assert.ok(archived);
  assert.equal(archived.current, false);
  assert.ok(archived.frameCount >= 2);
  const bundle = simulation.replayBundle(firstRun);
  assert.ok(bundle);
  assert.equal(bundle.version, 1);
  assert.equal(bundle.frames[0]?.elapsed, 0);
  assert.ok((bundle.frames.at(-1)?.elapsed ?? 0) >= 1.9);

  simulation.dispose();
  rmSync(root, { recursive: true, force: true });
});

test("short team orders cause the next mock actions", async () => {
  const driver = new MockAgentDriver();
  const bell = AGENTS.find((agent) => agent.id === "king_1");
  const vex = AGENTS.find((agent) => agent.id === "queen_1");
  assert.ok(bell && vex);

  const baseState: AgentState = {
    turn: 22,
    elapsed: 210,
    goals: ["Complete the current operation."],
    self: { id: "king_1", x: 170, y: 62, integrity: 100 },
    humpty: {
      x: 550,
      y: 775,
      height: 745,
      integrity: 100,
      cracked: false,
    },
    teammates: [],
    opponents: [],
    nearby: [],
    supply: {
      planks: 6,
      ropes: 6,
      stones: 4,
      pikes: 1,
      crossbows: 1,
      bolts: 2,
    },
    inventory: [],
    speech: [],
    projects: [],
    connections: [],
  };

  const kingOrdered = (await driver.act(bell, {
    ...baseState,
    speech: [
      { turn: 21, name: "Bell", text: "Hold position until the footing settles." },
    ],
  })) as AgentSubmission;
  const kingUnordered = (await driver.act(bell, baseState)) as AgentSubmission;
  assert.deepEqual(kingOrdered.action, { type: "wait" });
  assert.deepEqual(kingUnordered.action, {
    type: "start_project",
    blueprintId: "skid",
  });

  const queenState: AgentState = {
    ...baseState,
    turn: 30,
    elapsed: 280,
    self: { ...baseState.self, id: "queen_1", x: 370 },
    projects: [
      {
        id: "queen_barricade_test",
        blueprintId: "barricade",
        workerId: "queen_1",
        team: "queen",
        progress: 1,
        stage: "complete",
        complete: true,
      },
    ],
    speech: [
      { turn: 29, name: "The Queen", text: "One clean stone. Do not touch my dessert." },
    ],
  };
  const queenOrdered = (await driver.act(vex, queenState)) as AgentSubmission;
  const queenUnordered = (await driver.act(vex, {
    ...queenState,
    speech: [],
  })) as AgentSubmission;
  assert.equal(queenOrdered.action.type, "throw");
  assert.deepEqual(queenUnordered.action, { type: "wait" });

  for (const submission of [kingOrdered, kingUnordered, queenOrdered, queenUnordered]) {
    assert.ok((submission.say ?? "").trim().split(/\s+/).length <= 10);
  }
});

test("agents receive neutral material affordances instead of suggested tactics", async () => {
  const observed: AgentState[] = [];
  const driver: AgentDriver = {
    model: "inventory-capture",
    async act(agent: AgentDefinition, state: AgentState): Promise<AgentSubmission> {
      if (agent.team === "king") observed.push(state);
      return { action: { type: "wait" } };
    },
  };
  const root = mkdtempSync(join(tmpdir(), "humpty-inventory-"));
  const simulation = new GameSimulation({ root, driver, seed: 31 });
  await simulation.initialize();
  await simulation.debugRunTurn();

  const inventory = observed[0]?.inventory ?? [];
  assert.ok(
    inventory.some((item) => item.id === "rail_and_rung_stock" && item.quantity > 0),
  );
  assert.ok(inventory.some((item) => item.id === "sheave_stock"));
  assert.ok(inventory.some((item) => item.id === "canvas_sling"));
  assert.ok(inventory.some((item) => item.id === "wheel_and_axle_stock"));
  assert.ok(inventory.some((item) => item.id === "lever_and_fulcrum_stock"));
  assert.ok(inventory.some((item) => item.id === "wooden_screw_stock"));
  assert.ok(inventory.some((item) => item.id === "spring_and_catch_stock"));
  assert.ok(
    inventory.some((item) => item.id === "pike" && item.quantity === 1),
  );
  assert.ok(
    inventory.some((item) => item.id === "crossbow" && item.quantity === 1),
  );
  assert.ok(
    inventory.some(
      (item) => item.id === "crossbow_bolt" && item.quantity === 2,
    ),
  );
  assert.ok(inventory.every((item) => item.material.length > 0));
  assert.ok(inventory.every((item) => item.affordances.length > 0));
  assert.ok(inventory.every((item) => item.constraints.length > 0));
  assert.doesNotMatch(
    JSON.stringify(inventory),
    /\b(rescue|attack|defend|strategy|should)\b/i,
  );

  simulation.dispose();
  rmSync(root, { recursive: true, force: true });
});

test("a rope cannot be attached directly to Humpty without the sling and tackle", async () => {
  const driver: AgentDriver = {
    model: "unsafe-rope",
    async act(agent: AgentDefinition): Promise<AgentSubmission> {
      return agent.id === "king_1"
        ? {
            action: {
              type: "attach_rope",
              fromId: "king_1",
              toId: "humpty",
            },
          }
        : { action: { type: "wait" } };
    },
  };
  const root = mkdtempSync(join(tmpdir(), "humpty-direct-rope-"));
  const simulation = new GameSimulation({ root, driver, seed: 57 });
  await simulation.initialize();
  await simulation.debugRunTurn();

  assert.equal(
    simulation.snapshot().entities.filter((entity) => entity.kind === "rope").length,
    0,
  );

  simulation.dispose();
  rmSync(root, { recursive: true, force: true });
});

test("the 36-block Jenga tower exposes a bounded reaction probe", async () => {
  const root = mkdtempSync(join(tmpdir(), "humpty-physics-"));
  const simulation = new GameSimulation({
    root,
    driver: new MockAgentDriver(),
    seed: 1881,
  });
  await simulation.initialize();

  const opening = simulation.snapshot();
  const blocks = opening.entities.filter((entity) => /^block_\d+$/.test(entity.id));
  assert.equal(blocks.length, 36);
  assert.ok(opening.humptyHeight > 460);
  assert.deepEqual(opening.deaths, { king: 0, queen: 0 });
  assert.ok(blocks.every((block) => Math.abs(block.angle) < 0.001));

  const topBefore = opening.entities.find((entity) => entity.id === "block_35");
  const probe = simulation.debugProbeTower("block_0", 0.12);
  assert.ok(probe.reactionForce >= 0);
  assert.ok(probe.signedSupportMargin > 0);
  simulation.debugStep(1);
  const collapsed = simulation.snapshot();
  const topAfter = collapsed.entities.find((entity) => entity.id === "block_35");
  assert.ok(topBefore && topAfter);
  assert.ok(collapsed.humptyHeight > opening.humptyHeight - 80);

  simulation.dispose();
  rmSync(root, { recursive: true, force: true });
});

test("Humpty only cracks from a hard fall or a strong physical projectile", async () => {
  const weakRoot = mkdtempSync(join(tmpdir(), "humpty-weak-hit-"));
  const weak = new GameSimulation({
    root: weakRoot,
    driver: new MockAgentDriver(),
    seed: 7,
  });
  await weak.initialize();
  weak.debugLaunchStoneAtHumpty(320);
  weak.debugStep(0.8);
  assert.equal(weak.snapshot().humptyIntegrity, 100);
  weak.dispose();
  rmSync(weakRoot, { recursive: true, force: true });

  const strongRoot = mkdtempSync(join(tmpdir(), "humpty-strong-hit-"));
  const strong = new GameSimulation({
    root: strongRoot,
    driver: new MockAgentDriver(),
    seed: 8,
  });
  await strong.initialize();
  strong.debugLaunchStoneAtHumpty(900);
  strong.debugStep(0.8);
  assert.equal(strong.snapshot().humptyIntegrity, 0);
  assert.equal(strong.snapshot().winner, "queen");
  strong.dispose();
  rmSync(strongRoot, { recursive: true, force: true });

  const fallRoot = mkdtempSync(join(tmpdir(), "humpty-hard-fall-"));
  const fall = new GameSimulation({
    root: fallRoot,
    driver: new MockAgentDriver(),
    seed: 9,
  });
  await fall.initialize();
  fall.debugDropHumpty();
  fall.debugStep(2);
  assert.equal(fall.snapshot().humptyIntegrity, 0);
  assert.equal(fall.snapshot().winner, "queen");
  fall.dispose();
  rmSync(fallRoot, { recursive: true, force: true });
});

test("an intact Humpty must stand upright before the King wins", async () => {
  const uprightRoot = mkdtempSync(join(tmpdir(), "humpty-upright-"));
  const upright = new GameSimulation({
    root: uprightRoot,
    driver: new MockAgentDriver(),
    seed: 14,
  });
  await upright.initialize();
  upright.debugPlaceHumptyOnFloor(0.08);
  upright.debugStep(0.12);
  const uprightOutcome = upright.snapshot();
  assert.equal(uprightOutcome.winner, "king");
  assert.match(uprightOutcome.outcome ?? "", /upright/);
  assert.ok(
    Math.abs(
      uprightOutcome.entities.find((entity) => entity.id === "humpty")?.angle ??
        1,
    ) < 0.01,
  );
  upright.dispose();
  rmSync(uprightRoot, { recursive: true, force: true });

  const sideRoot = mkdtempSync(join(tmpdir(), "humpty-side-landing-"));
  const side = new GameSimulation({
    root: sideRoot,
    driver: new MockAgentDriver(),
    seed: 15,
  });
  await side.initialize();
  side.debugPlaceHumptyOnFloor(Math.PI / 2);
  side.debugStep(0.12);
  const righting = side.snapshot();
  assert.equal(righting.winner, null);
  assert.equal(
    righting.entities.find((entity) => entity.id === "humpty")?.righting,
    true,
  );
  side.debugStep(3);
  const righted = side.snapshot();
  assert.equal(righted.winner, "king");
  assert.match(righted.outcome ?? "", /rocked himself upright/);
  assert.ok(
    Math.abs(
      righted.entities.find((entity) => entity.id === "humpty")?.angle ?? 1,
    ) < 0.01,
  );
  side.dispose();
  rmSync(sideRoot, { recursive: true, force: true });
});

test.skip("legacy recipe battle is not part of puzzle play", async () => {
  const root = mkdtempSync(join(tmpdir(), "humpty-full-round-"));
  const mock = new MockAgentDriver();
  const constructionPathDriver: AgentDriver = {
    model: "mock",
    async act(agent, state): Promise<AgentSubmission> {
      const submission = (await mock.act(agent, state)) as AgentSubmission;
      if (
        agent.team === "queen" &&
        submission.action.type === "throw"
      ) {
        return {
          ...submission,
          action: {
            ...submission.action,
            targetId: `stone_queen_${state.turn % 9}`,
            power: 0.2,
          },
        };
      }
      if (
        submission.action.type === "use_weapon" ||
        (agent.team === "queen" && submission.action.type === "push")
      ) {
        return { ...submission, action: { type: "wait" } };
      }
      return submission;
    },
  };
  const simulation = new GameSimulation({
    root,
    driver: constructionPathDriver,
    seed: 7,
  });
  await simulation.initialize();

  const heard = new Set<string>();
  const operations = new Set<string>();
  let hadMixedSite = false;
  let hadPartialLadder = false;
  let sawCarriedPart = false;
  const observe = (): void => {
    const snapshot = simulation.snapshot();
    for (const cue of snapshot.soundCues) heard.add(cue.type);
    for (const entity of snapshot.entities) {
      if (entity.taskOperation) operations.add(entity.taskOperation);
    }
    const components = snapshot.entities.filter(
      (entity) => entity.kind === "component",
    );
    const states = new Set(components.map((entity) => entity.assemblyState));
    hadMixedSite ||= states.size >= 3;
    sawCarriedPart ||= components.some(
      (entity) => entity.assemblyState === "carried",
    );
    const ladderParts = components.filter(
      (entity) => entity.projectId === "machine_ladder",
    );
    hadPartialLadder ||=
      ladderParts.some((entity) => entity.assemblyState === "installed") &&
      ladderParts.some((entity) => entity.assemblyState !== "installed");
  };

  for (let turn = 0; turn < 2; turn += 1) {
    await simulation.debugRunTurn();
    observe();
  }
  const firstSite = simulation.snapshot();
  const skid = firstSite.entities.find((entity) => entity.id === "machine_skid");
  assert.ok(skid);
  assert.ok((skid.buildProgress ?? 1) > 0);
  assert.ok((skid.buildProgress ?? 1) < 1);
  const ladderParts = firstSite.entities.filter(
    (entity) => entity.projectId === "machine_ladder",
  );
  assert.equal(
    ladderParts.filter((entity) => entity.componentType === "rail").length,
    4,
  );
  assert.equal(
    ladderParts.filter((entity) => entity.componentType === "rung").length,
    12,
  );
  assert.ok(ladderParts.some((entity) => entity.assemblyState !== "installed"));

  for (let turn = 2; turn < 8; turn += 1) {
    await simulation.debugRunTurn();
    observe();
  }
  const earlyBattle = simulation.snapshot();
  assert.equal(earlyBattle.winner, null);
  assert.ok(earlyBattle.elapsed > 79.9);
  assert.ok(heard.has("footstep"));
  const ladder = earlyBattle.entities.find((entity) => entity.id === "machine_ladder");
  assert.ok(ladder);
  assert.ok((ladder.buildProgress ?? 1) < 1);

  for (
    let turn = 8;
    turn < 60 && !simulation.snapshot().winner;
    turn += 1
  ) {
    await simulation.debugRunTurn();
    observe();
  }
  const outcome = simulation.snapshot();
  for (const operation of simulation.debugWorkOperations()) {
    operations.add(operation);
  }
  assert.equal(outcome.winner, "king");
  assert.ok(outcome.elapsed >= 300);
  assert.ok(outcome.elapsed <= 600.1);
  assert.ok(hadMixedSite);
  assert.ok(hadPartialLadder);
  assert.ok(sawCarriedPart);
  for (const operation of [
    "carry",
    "measure",
    "saw",
    "bore",
    "position",
    "peg",
    "lash",
    "raise",
    "mount",
    "stitch",
  ]) {
    assert.ok(operations.has(operation), `missing visible ${operation} task`);
  }
  const rescueComponents = outcome.entities.filter(
    (entity) =>
      entity.kind === "component" &&
      entity.team === "king",
  );
  assert.ok(rescueComponents.length >= 45);
  assert.ok(
    rescueComponents.every((entity) => entity.assemblyState === "installed"),
  );
  for (const machineId of [
    "machine_cart",
    "machine_screw_jack",
    "machine_lever",
    "queen_machine_cart",
    "queen_machine_lever",
    "queen_machine_spring_trap",
  ]) {
    assert.equal(
      outcome.entities.find((entity) => entity.id === machineId)?.buildProgress,
      1,
    );
  }
  assert.equal(
    outcome.entities.filter(
      (entity) =>
        entity.projectId === "machine_cart" &&
        entity.componentType === "wheel",
    ).length,
    4,
  );
  assert.equal(
    outcome.entities.filter(
      (entity) =>
        entity.projectId === "queen_machine_cart" &&
        entity.componentType === "wheel",
    ).length,
    4,
  );
  assert.ok(outcome.entities.filter((entity) => entity.kind === "rope").length >= 3);
  assert.equal(
    outcome.entities.find((entity) => entity.id === "humpty")?.harnessed,
    true,
  );
  assert.ok(
    outcome.speech.every((line) => line.text.trim().split(/\s+/).length <= 10),
  );
  assert.deepEqual(
    outcome.speech
      .filter((line) => /[_]|(?:machine|rescue)_/i.test(line.text))
      .map((line) => line.text),
    [],
  );
  for (const agentId of ["king", "king_1", "queen", "humpty"]) {
    const lines = outcome.speech
      .filter((line) => line.agentId === agentId)
      .map((line) => line.text);
    assert.equal(new Set(lines).size, lines.length);
  }
  assert.ok(heard.has("hammer"));
  assert.ok(heard.has("rope"));
  assert.ok(heard.has("winch"));
  assert.ok(heard.has("throw"));
  assert.ok(outcome.speech.some((line) => line.agentId === "queen"));
  assert.ok(outcome.speech.some((line) => line.agentId === "king"));
  assert.ok(outcome.speech.some((line) => line.agentId === "humpty"));

  simulation.dispose();
  rmSync(root, { recursive: true, force: true });
});
