import {
  CORE_FIXED_DT,
  CORE_MODE,
  type ActivityEvent,
  type ConnectionState,
  type CoreClientCommand,
  type CoreSnapshot,
  type LegalActionRequest,
  type Quat,
  type Team,
  type Vec3,
  type WorkerState,
} from "../../shared/core-protocol.js";
import { CoreActionSystem, type ActionEvent } from "./actions.js";
import type { AgentStrategist } from "./agent-strategist.js";
import {
  MockMatchDirector,
  type AutonomousActionLane,
  type AutonomousTeamLane,
} from "./mock-director.js";
import { CorePhysicsWorld } from "./physics.js";

export interface CoreSimulationOptions {
  seed: number;
  build: string;
  autoMatch?: boolean;
  strategist?: AgentStrategist | undefined;
}

function stageOneWorkerPart(
  workerId: string,
  partId: string,
  pose: Vec3,
  orientation: Quat,
  carryPort?: string,
): LegalActionRequest[] {
  return [
    { action: "reserve", actorIds: [workerId], targetId: partId },
    { action: "fetch", actorIds: [workerId], targetId: partId },
    {
      action: "carry",
      actorIds: [workerId],
      targetId: partId,
      ...(carryPort ? { targetPort: carryPort } : {}),
      destination: { ...pose, y: pose.y + .26 },
      orientation,
    },
    { action: "align", actorIds: [workerId], targetId: partId, destination: pose, orientation },
    { action: "release", actorIds: [workerId], targetId: partId, destination: pose },
  ];
}

function holdOneWorkerPart(
  workerId: string,
  partId: string,
  pose: Vec3,
  orientation: Quat,
  carryPort?: string,
  secondaryId?: string,
  secondaryPort?: string,
): LegalActionRequest[] {
  return [
    { action: "reserve", actorIds: [workerId], targetId: partId },
    { action: "fetch", actorIds: [workerId], targetId: partId },
    {
      action: "carry",
      actorIds: [workerId],
      targetId: partId,
      ...(carryPort ? { targetPort: carryPort } : {}),
      destination: { ...pose, y: pose.y + .26 },
      orientation,
    },
    {
      action: "align",
      actorIds: [workerId],
      targetId: partId,
      targetPort: "assembly-hold",
      ...(secondaryId ? { secondaryId } : {}),
      ...(secondaryPort ? { secondaryPort } : {}),
      destination: pose,
      orientation,
    },
  ];
}

export class CoreSimulation {
  readonly build: string;
  readonly seed: number;
  physics: CorePhysicsWorld;
  readonly actions: CoreActionSystem;
  readonly autonomousLanes: AutonomousActionLane[];
  readonly autonomousTeams: AutonomousTeamLane[];
  readonly match: MockMatchDirector;

  private paused = false;
  private timeScale = 1;
  private events: ActivityEvent[] = [];
  private eventSequence = 0;
  private selectedFixture?: string;
  private completedFixtures = new Set<string>();
  private fixtureWasBusy = false;
  private fixtureInitialPositions = new Map<string, Vec3>();
  private fixtureInitialRotations = new Map<string, Quat>();
  private fixtureEvidence = new Set<string>();

  private constructor(options: CoreSimulationOptions, physics: CorePhysicsWorld) {
    this.build = options.build;
    this.seed = options.seed;
    this.physics = physics;
    this.actions = new CoreActionSystem(physics, (event) => this.addActionEvent(event));
    this.autonomousLanes = physics.workerIds().map((workerId) => ({
      workerId,
      actions: new CoreActionSystem(
        physics,
        (event) => this.addActionEvent(event),
        [workerId],
      ),
    }));
    this.autonomousTeams = (["king", "queen"] as const).map((team: Team) => ({
      team,
      actions: new CoreActionSystem(
        physics,
        (event) => this.addActionEvent(event),
        physics.workerIds(team),
      ),
    }));
    this.match = new MockMatchDirector(
      physics,
      this.autonomousLanes,
      this.autonomousTeams,
      (event) => this.addActionEvent(event),
      options.seed,
      options.autoMatch ?? false,
      options.strategist,
    );
    this.addEvent("The legibility lab is ready. Physical authority: Rapier 3D.");
  }

  static async create(options: CoreSimulationOptions): Promise<CoreSimulation> {
    const physics = await CorePhysicsWorld.create(options.seed);
    return new CoreSimulation(options, physics);
  }

  step(): void {
    if (this.paused) return;
    const steps = Math.max(1, Math.min(8, Math.round(this.timeScale)));
    for (let index = 0; index < steps; index += 1) {
      this.match.update();
      this.actions.update(CORE_FIXED_DT);
      for (const team of this.autonomousTeams) team.actions.update(CORE_FIXED_DT);
      for (const lane of this.autonomousLanes) lane.actions.update(CORE_FIXED_DT);
      this.physics.step();
      this.updateFixtureResult();
    }
  }

  handleCommand(command: CoreClientCommand): { ok: boolean; message?: string } {
    if (command.type === "pause") {
      this.paused = command.paused ?? !this.paused;
      this.addEvent(this.paused ? "The laboratory pauses." : "The laboratory resumes.");
      return { ok: true };
    }
    if (command.type === "time-scale") {
      this.timeScale = Math.max(0.25, Math.min(8, command.value));
      return { ok: true };
    }
    if (command.type === "debug-poke") {
      const bodyId = command.bodyId ?? "tower-05-2";
      const impulse = command.impulse ?? { x: 400, y: 0, z: 80 };
      const ok = this.physics.applyImpulse(bodyId, impulse);
      if (ok) this.addEvent("A measured test force reaches a tower timber.", bodyId);
      return ok ? { ok } : { ok, message: `Unknown dynamic body ${bodyId}` };
    }
    if (command.type === "legal-action") {
      this.match.stopForManualControl();
      return this.actions.submit(command.request);
    }
    if (command.type === "run-fixture") {
      this.match.stopForManualControl();
      this.selectedFixture = command.fixture;
      this.paused = false;
      this.fixtureWasBusy = false;
      this.fixtureEvidence.clear();
      this.fixtureInitialPositions.clear();
      this.fixtureInitialRotations.clear();
      if (command.fixture === "transport") {
        const beamId = this.physics.inventoryIds("king").filter((id) => id.includes("beam-long")).at(1);
        if (!beamId) return { ok: false, message: "The long beam is missing." };
        return this.actions.enqueue([
          { action: "reserve", actorIds: ["king-worker-1"], targetId: beamId },
          { action: "fetch", actorIds: ["king-worker-1", "king-worker-2"], targetId: beamId },
          {
            action: "carry",
            actorIds: ["king-worker-1", "king-worker-2"],
            targetId: beamId,
            destination: { x: 3.2, y: 0.45, z: 2.75 },
          },
          { action: "release", actorIds: ["king-worker-1", "king-worker-2"], targetId: beamId, destination: { x: 3.2, y: .12, z: 2.75 } },
        ]);
      }
      if (command.fixture === "lever") {
        const beamId = this.physics.inventoryIds("king").filter((id) => id.includes("beam-long")).at(1);
        const hubId = this.physics.inventoryIds("king").filter((id) => id.includes("hub")).at(0);
        const blockId = "tower-03-3";
        if (!beamId || !hubId) {
          return { ok: false, message: "The lever pieces are missing." };
        }
        const blockStart = this.physics.bodyPosition(blockId);
        const beamRackOrientation = this.physics.bodyRotation(beamId);
        if (!blockStart || !beamRackOrientation) {
          return { ok: false, message: "A lever piece has no physical pose." };
        }
        const alongBlock = {
          x: Math.cos(TOWER_YAW),
          y: 0,
          z: Math.sin(TOWER_YAW),
        };
        const acrossBlock = {
          x: -Math.sin(TOWER_YAW),
          y: 0,
          z: Math.cos(TOWER_YAW),
        };
        const beamOrientation = yawQuat(-TOWER_YAW);
        const loadContact = addVec(blockStart, scaleVec(alongBlock, -.81), .64);
        const beamSeatBase = addVec(loadContact, scaleVec(acrossBlock, -.8), .61);
        const beamSeatPose = addVec(beamSeatBase, scaleVec(alongBlock, .03), .61);
        const hubPose = { ...beamSeatPose, x: beamSeatPose.x - .28, y: .28 };
        const beamPreseatPose = addVec(beamSeatPose, scaleVec(alongBlock, -.48), .86);
        const beamHighPose = { ...beamPreseatPose, y: 1.18 };
        const beamSideApproach = { ...beamHighPose, x: -2.85 };
        const beamCarryPose = { x: -3.35, y: 1.18, z: 3.2 };
        const beamTurnPose = { x: -4.2, y: .78, z: -2.65 };
        const effortEnd = addVec(beamSeatPose, scaleVec(acrossBlock, -.9), .61);
        const effortPoint = addVec(
          addVec(effortEnd, scaleVec(alongBlock, .7), .61),
          scaleVec(acrossBlock, .7),
          .61,
        );
        this.fixtureInitialPositions.set(blockId, blockStart);
        return this.actions.enqueue([
          { action: "reserve", actorIds: ["king-worker-1"], targetId: beamId },
          { action: "fetch", actorIds: ["king-worker-1", "king-worker-3"], targetId: beamId },
          { action: "reserve", actorIds: ["king-worker-2"], targetId: hubId },
          { action: "fetch", actorIds: ["king-worker-2"], targetId: hubId },
          {
            action: "carry",
            actorIds: ["king-worker-2"],
            targetId: hubId,
            destination: { ...hubPose, y: hubPose.y + .26 },
            orientation: yawQuat(0),
          },
          {
            action: "align",
            actorIds: ["king-worker-2"],
            targetId: hubId,
            targetPort: "assembly-hold",
            destination: hubPose,
            orientation: yawQuat(0),
          },
          {
            action: "hold",
            actorIds: ["king-worker-2"],
            targetId: hubId,
            targetPort: "brace-assembly",
            magnitude: .6,
          },
          {
            action: "carry",
            actorIds: ["king-worker-1", "king-worker-3"],
            targetId: beamId,
            destination: beamTurnPose,
            orientation: beamRackOrientation,
          },
          {
            action: "align",
            actorIds: ["king-worker-1", "king-worker-3"],
            targetId: beamId,
            targetPort: "lever-carry-side",
            destination: beamTurnPose,
            orientation: beamOrientation,
          },
          {
            action: "carry",
            actorIds: ["king-worker-1", "king-worker-3"],
            targetId: beamId,
            targetPort: "lever-approach",
            destination: beamCarryPose,
            orientation: beamOrientation,
          },
          {
            action: "carry",
            actorIds: ["king-worker-1", "king-worker-3"],
            targetId: beamId,
            targetPort: "lever-approach",
            destination: beamSideApproach,
            orientation: beamOrientation,
          },
          {
            action: "carry",
            actorIds: ["king-worker-1", "king-worker-3"],
            targetId: beamId,
            targetPort: "lever-final-approach",
            destination: beamHighPose,
            orientation: beamOrientation,
          },
          {
            action: "align",
            actorIds: ["king-worker-1", "king-worker-3"],
            targetId: beamId,
            targetPort: "assembly-hold",
            destination: beamPreseatPose,
            orientation: beamOrientation,
          },
          {
            action: "push",
            actorIds: ["king-worker-1", "king-worker-3"],
            targetId: beamId,
            secondaryId: hubId,
            targetPort: "supported-center",
            secondaryPort: blockId,
            destination: beamSeatPose,
            magnitude: 360,
          },
          {
            action: "push",
            actorIds: ["king-worker-1", "king-worker-3"],
            targetId: beamId,
            secondaryId: blockId,
            targetPort: "end-negative",
            secondaryPort: "supported-horizontal",
            destination: effortPoint,
            magnitude: 1_800,
          },
        ]);
      }
      if (command.fixture === "ramp") {
        const wedgeId = this.physics.inventoryIds("king").filter((id) => id.includes("wedge")).at(0);
        const plankId = this.physics.inventoryIds("king").filter((id) => id.includes("plank")).at(1);
        const wheelId = this.physics.inventoryIds("king").filter((id) => id.includes("wheel")).at(1);
        if (!wedgeId || !plankId || !wheelId) {
          return { ok: false, message: "The ramp pieces are missing." };
        }
        const wedgePose = { x: -2.58, y: .1, z: 1.1 };
        const plankPose = { x: -3.36, y: .15, z: 1.1 };
        const plankTurnPose = { x: -5.05, y: .52, z: 1.1 };
        const plankFlatOrientation = yawQuat(degrees(90));
        const plankOrientation = multiplyQuat(plankFlatOrientation, xQuat(degrees(-7.2)));
        const wheelPose = { x: -4.0, y: .64, z: 1.1 };
        const wheelOrientation = yawQuat(0);
        return this.actions.enqueue([
          { action: "reserve", actorIds: ["king-worker-3"], targetId: wedgeId },
          { action: "fetch", actorIds: ["king-worker-3"], targetId: wedgeId },
          {
            action: "carry",
            actorIds: ["king-worker-3"],
            targetId: wedgeId,
            targetPort: "hold-opposite",
            destination: wedgePose,
            orientation: yawQuat(0),
          },
          { action: "reserve", actorIds: ["king-worker-2"], targetId: plankId },
          { action: "fetch", actorIds: ["king-worker-1", "king-worker-2"], targetId: plankId },
          {
            action: "carry",
            actorIds: ["king-worker-1", "king-worker-2"],
            targetId: plankId,
            destination: plankTurnPose,
          },
          {
            action: "align",
            actorIds: ["king-worker-1", "king-worker-2"],
            targetId: plankId,
            targetPort: "front-side",
            destination: plankTurnPose,
            orientation: plankFlatOrientation,
          },
          {
            action: "carry",
            actorIds: ["king-worker-1", "king-worker-2"],
            targetId: plankId,
            targetPort: "resume-grip",
            destination: { ...plankPose, y: .42 },
            orientation: plankFlatOrientation,
          },
          {
            action: "align",
            actorIds: ["king-worker-1", "king-worker-2"],
            targetId: plankId,
            targetPort: "side-on",
            destination: { ...plankPose, y: .42 },
            orientation: plankFlatOrientation,
          },
          {
            action: "carry",
            actorIds: ["king-worker-1", "king-worker-2"],
            targetId: plankId,
            targetPort: "resume-grip",
            destination: { ...plankPose, y: .42 },
            orientation: plankOrientation,
          },
          { action: "release", actorIds: ["king-worker-1", "king-worker-2"], targetId: plankId, destination: plankPose },
          { action: "reserve", actorIds: ["king-worker-2"], targetId: wheelId },
          { action: "fetch", actorIds: ["king-worker-2"], targetId: wheelId },
          {
            action: "carry",
            actorIds: ["king-worker-2"],
            targetId: wheelId,
            targetPort: "hold-front",
            destination: { ...wheelPose, y: .78 },
            orientation: wheelOrientation,
          },
          { action: "release", actorIds: ["king-worker-2"], targetId: wheelId, destination: wheelPose },
          { action: "wait", actorIds: ["king-worker-2"], targetId: wheelId, magnitude: 4 },
        ]);
      }
      if (command.fixture === "hoist") {
        const axleId = this.physics.inventoryIds("king").find((id) => id.includes("axle-long"));
        const sheaveId = this.physics.inventoryIds("king").filter((id) => id.includes("sheave")).at(0);
        const ropeId = this.physics.inventoryIds("king")
          .filter((id) => this.physics.records.get(id)?.family === "rope").at(1);
        const loadId = this.physics.inventoryIds("king").filter((id) => id.includes("plank")).at(1);
        if (!loadId || !axleId || !sheaveId || !ropeId) {
          return { ok: false, message: "The hoist pieces are missing." };
        }
        const axleOrientation = yawQuat(degrees(90));
        const axlePose = { x: -4.35, y: .98, z: 2.2 };
        const sheavePose = { x: axlePose.x - .65, y: axlePose.y, z: axlePose.z };
        const sheaveParkingPose = { ...sheavePose, x: sheavePose.x - .28 };
        const ropePose = { x: -5.3, y: .5, z: 1.9 };
        const loadHookPose = { x: -5.4, y: .16, z: 1.5 };
        const loadCarryPose = { ...loadHookPose, y: .78 };
        const loadPlacementPose = { ...loadHookPose, y: .42 };
        const loadTurnPose = { x: -5.05, y: .58, z: -2.35 };
        const loadOrientation = yawQuat(0);
        return this.actions.enqueue([
          { action: "reserve", actorIds: ["king-worker-2"], targetId: axleId },
          { action: "fetch", actorIds: ["king-worker-2"], targetId: axleId },
          {
            action: "carry",
            actorIds: ["king-worker-2"],
            targetId: axleId,
            targetPort: "hold-front",
            destination: { ...axlePose, y: axlePose.y + .26 },
            orientation: axleOrientation,
          },
          {
            action: "align",
            actorIds: ["king-worker-2"],
            targetId: axleId,
            targetPort: "assembly-hold",
            destination: axlePose,
            orientation: axleOrientation,
          },
          {
            action: "hold",
            actorIds: ["king-worker-2"],
            targetId: axleId,
            targetPort: "brace-assembly",
            orientation: axleOrientation,
            magnitude: .65,
          },
          ...holdOneWorkerPart(
            "king-worker-3",
            sheaveId,
            sheaveParkingPose,
            axleOrientation,
          ),
          {
            action: "align",
            actorIds: ["king-worker-3"],
            targetId: sheaveId,
            targetPort: "assembly-hold",
            secondaryId: axleId,
            secondaryPort: "axle-end-negative",
            destination: sheavePose,
            orientation: axleOrientation,
          },
          {
            action: "connect",
            actorIds: ["king-worker-3"],
            targetId: axleId,
            secondaryId: sheaveId,
            connectionClass: "KEYED_COAXIAL",
          },
          { action: "test", actorIds: ["king-worker-3"], targetId: axleId, magnitude: .8 },
          ...holdOneWorkerPart("king-worker-3", ropeId, ropePose, yawQuat(0), "hold-behind"),
          {
            action: "reeveRope",
            actorIds: ["king-worker-3"],
            targetId: ropeId,
            secondaryId: sheaveId,
            connectionClass: "ROPE_ATTACH",
          },
          {
            action: "release",
            actorIds: ["king-worker-3"],
            targetId: ropeId,
            targetPort: "hoist-rope-clear",
            destination: ropePose,
          },
          { action: "reserve", actorIds: ["king-worker-1"], targetId: loadId },
          { action: "fetch", actorIds: ["king-worker-1", "king-worker-3"], targetId: loadId },
          {
            action: "carry",
            actorIds: ["king-worker-1", "king-worker-3"],
            targetId: loadId,
            destination: loadTurnPose,
          },
          {
            action: "align",
            actorIds: ["king-worker-1", "king-worker-3"],
            targetId: loadId,
            targetPort: "front-side",
            destination: loadTurnPose,
            orientation: loadOrientation,
          },
          {
            action: "carry",
            actorIds: ["king-worker-1", "king-worker-3"],
            targetId: loadId,
            targetPort: "resume-grip",
            destination: loadCarryPose,
            orientation: loadOrientation,
          },
          {
            action: "align",
            actorIds: ["king-worker-1", "king-worker-3"],
            targetId: loadId,
            targetPort: "side-on",
            destination: loadPlacementPose,
            orientation: loadOrientation,
          },
          {
            action: "release",
            actorIds: ["king-worker-1", "king-worker-3"],
            targetId: loadId,
            targetPort: "hoist-load-clear",
            destination: loadHookPose,
          },
          {
            action: "fetch",
            actorIds: ["king-worker-1"],
            targetId: axleId,
            targetPort: "hoist-brace-approach",
          },
          {
            action: "hold",
            actorIds: ["king-worker-1", "king-worker-2"],
            targetId: axleId,
            targetPort: "brace-assembly",
            orientation: axleOrientation,
            magnitude: .8,
          },
          {
            action: "fetch",
            actorIds: ["king-worker-3"],
            targetId: loadId,
            targetPort: "hoist-hook-approach",
          },
          {
            action: "hookRope",
            actorIds: ["king-worker-3"],
            targetId: ropeId,
            secondaryId: loadId,
            connectionClass: "ROPE_ATTACH",
          },
          {
            action: "tension",
            actorIds: ["king-worker-3"],
            targetId: ropeId,
            targetPort: "hoist-tension-stance",
            magnitude: .62,
          },
          { action: "test", actorIds: ["king-worker-3"], targetId: ropeId, magnitude: 1.2 },
          { action: "wait", actorIds: ["king-worker-3"], targetId: loadId, magnitude: 2 },
        ]);
      }
      if (command.fixture === "ram") {
        const axleIds = this.physics.inventoryIds("king").filter((id) => id.includes("axle"));
        const wheelIds = this.physics.inventoryIds("king").filter((id) => id.includes("wheel"));
        const plankId = this.physics.inventoryIds("king").filter((id) => id.includes("plank")).at(1);
        const beamId = this.physics.inventoryIds("king").filter((id) => id.includes("beam-long")).at(1);
        const axleId = axleIds.find((id) => id.includes("axle-long"));
        const negativeWheelId = wheelIds.at(1);
        const positiveWheelId = wheelIds.at(0);
        const blockId = "tower-04-1";
        if (!axleId || !negativeWheelId || !positiveWheelId || !plankId || !beamId) {
          return { ok: false, message: "The ram pieces are missing." };
        }
        const axlePose = { x: -3.4, y: .36, z: 0 };
        const negativeWheelPose = { ...axlePose, z: -.55 };
        const positiveWheelPose = { ...axlePose, z: .55 };
        const negativeWheelParking = { ...negativeWheelPose, z: -.78 };
        const positiveWheelParking = { x: axlePose.x, y: .36, z: 1.3 };
        const chassisPose = { x: -2.9, y: .48, z: 0 };
        const beamPose = { x: -2.38, y: .67, z: 0 };
        const plankTurnPose = { x: -5.05, y: .52, z: 2.35 };
        const beamTurnPose = { x: -4.25, y: .8, z: -2.35 };
        const axleOrientation = yawQuat(0);
        const chassisOrientation = yawQuat(degrees(90));
        const beamOrientation = multiplyQuat(chassisOrientation, xQuat(RAM_SADDLE_PITCH));
        const assemblyCrew = ["king-worker-1", "king-worker-2"];
        const mountingCrew = ["king-worker-2", "king-worker-3"];
        const blockStart = this.physics.bodyPosition(blockId);
        if (blockStart) this.fixtureInitialPositions.set(blockId, blockStart);
        for (const wheelId of wheelIds) {
          const rotation = this.physics.bodyRotation(wheelId);
          if (rotation) this.fixtureInitialRotations.set(wheelId, rotation);
        }
        return this.actions.enqueue([
          ...holdOneWorkerPart("king-worker-1", axleId, axlePose, axleOrientation),
          ...holdOneWorkerPart(
            "king-worker-2",
            negativeWheelId,
            negativeWheelParking,
            axleOrientation,
            "hold-behind",
          ),
          {
            action: "align",
            actorIds: ["king-worker-2"],
            targetId: negativeWheelId,
            targetPort: "assembly-hold",
            secondaryId: axleId,
            secondaryPort: "axle-end-negative",
            destination: negativeWheelPose,
            orientation: axleOrientation,
          },
          {
            action: "connect",
            actorIds: ["king-worker-2"],
            targetId: axleId,
            secondaryId: negativeWheelId,
            connectionClass: "KEYED_COAXIAL",
          },
          { action: "test", actorIds: ["king-worker-1"], targetId: axleId, magnitude: .65 },
          {
            action: "release",
            actorIds: ["king-worker-2"],
            targetId: negativeWheelId,
            destination: negativeWheelPose,
          },
          ...holdOneWorkerPart(
            "king-worker-3",
            positiveWheelId,
            positiveWheelParking,
            axleOrientation,
            "hold-front",
          ),
          {
            action: "align",
            actorIds: ["king-worker-3"],
            targetId: positiveWheelId,
            targetPort: "assembly-hold",
            secondaryId: axleId,
            secondaryPort: "axle-approach-positive",
            destination: { ...positiveWheelPose, z: .82 },
            orientation: axleOrientation,
          },
          {
            action: "align",
            actorIds: ["king-worker-3"],
            targetId: positiveWheelId,
            targetPort: "assembly-hold",
            secondaryId: axleId,
            secondaryPort: "axle-end-positive",
            destination: positiveWheelPose,
            orientation: axleOrientation,
          },
          {
            action: "connect",
            actorIds: ["king-worker-3"],
            targetId: axleId,
            secondaryId: positiveWheelId,
            connectionClass: "KEYED_COAXIAL",
          },
          { action: "test", actorIds: ["king-worker-1"], targetId: axleId, magnitude: .65 },
          {
            action: "release",
            actorIds: ["king-worker-3"],
            targetId: positiveWheelId,
            destination: positiveWheelPose,
          },
          { action: "reserve", actorIds: ["king-worker-2"], targetId: plankId },
          { action: "fetch", actorIds: mountingCrew, targetId: plankId },
          {
            action: "carry",
            actorIds: mountingCrew,
            targetId: plankId,
            destination: plankTurnPose,
          },
          {
            action: "align",
            actorIds: mountingCrew,
            targetId: plankId,
            targetPort: "front-side",
            destination: plankTurnPose,
            orientation: chassisOrientation,
          },
          {
            action: "carry",
            actorIds: mountingCrew,
            targetId: plankId,
            targetPort: "resume-grip",
            destination: { ...chassisPose, y: .78, z: .65 },
            orientation: chassisOrientation,
          },
          {
            action: "align",
            actorIds: mountingCrew,
            targetId: plankId,
            targetPort: "assembly-hold",
            secondaryId: axleId,
            secondaryPort: "axle-chassis-bearing",
            destination: chassisPose,
            orientation: chassisOrientation,
          },
          {
            action: "connect",
            actorIds: mountingCrew,
            targetId: axleId,
            secondaryId: plankId,
            connectionClass: "AXLE_BEARING",
          },
          {
            action: "hold",
            actorIds: ["king-worker-3"],
            targetId: plankId,
            targetPort: "brace-assembly",
            magnitude: .65,
          },
          { action: "test", actorIds: mountingCrew, targetId: plankId, magnitude: .9 },
          { action: "reserve", actorIds: ["king-worker-1"], targetId: beamId },
          { action: "fetch", actorIds: assemblyCrew, targetId: beamId },
          {
            action: "carry",
            actorIds: assemblyCrew,
            targetId: beamId,
            destination: beamTurnPose,
          },
          {
            action: "align",
            actorIds: assemblyCrew,
            targetId: beamId,
            targetPort: "ram-west-side",
            destination: beamTurnPose,
            orientation: beamOrientation,
          },
          {
            action: "carry",
            actorIds: assemblyCrew,
            targetId: beamId,
            targetPort: "ram-west-side",
            secondaryId: plankId,
            secondaryPort: "plank-ram-overhead",
            destination: { ...beamPose, y: 1.42 },
            orientation: beamOrientation,
          },
          {
            action: "align",
            actorIds: assemblyCrew,
            targetId: beamId,
            targetPort: "assembly-hold",
            secondaryId: plankId,
            secondaryPort: "plank-ram-high",
            destination: { ...beamPose, y: .93 },
            orientation: beamOrientation,
          },
          {
            action: "align",
            actorIds: assemblyCrew,
            targetId: beamId,
            targetPort: "assembly-hold",
            secondaryId: plankId,
            secondaryPort: "plank-ram-socket",
            destination: beamPose,
            orientation: beamOrientation,
          },
          {
            action: "connect",
            actorIds: assemblyCrew,
            targetId: beamId,
            secondaryId: plankId,
            connectionClass: "TENON_LOCK",
            secondaryPort: "plank-ram-socket",
          },
          {
            action: "test",
            actorIds: assemblyCrew,
            targetId: beamId,
            magnitude: 1.2,
          },
          {
            action: "push",
            actorIds: ["king-worker-1", "king-worker-2", "king-worker-3"],
            targetId: plankId,
            secondaryId: beamId,
            targetPort: "assembly-push",
            secondaryPort: "worker-supported",
            destination: { x: .5, y: chassisPose.y, z: 0 },
            orientation: chassisOrientation,
            magnitude: 3.4,
            loadId: blockId,
            loadTravel: .4,
          },
        ]);
      }
      return {
        ok: false,
        message: `${command.fixture} remains locked until its preceding gate passes.`,
      };
    }
    if (command.type === "reset") {
      return { ok: false, message: "Reset is performed by the server runtime." };
    }
    return { ok: false, message: "Unknown command" };
  }

  snapshot(): CoreSnapshot {
    const snapshot: CoreSnapshot = {
      type: "core-snapshot",
      mode: CORE_MODE,
      build: this.build,
      seed: this.seed,
      tick: this.physics.tick,
      elapsed: this.physics.tick * CORE_FIXED_DT,
      paused: this.paused,
      timeScale: this.timeScale,
      bodies: this.physics.snapshotBodies(),
      workers: this.workers(),
      connections: this.connections(),
      events: this.events.slice(0, 60),
      diagnostics: {
        ...this.physics.diagnostics(),
        llmEnabled: this.match.snapshot().driver === "llm",
      },
      match: this.match.snapshot(),
      completedFixtures: [...this.completedFixtures],
    };
    if (this.selectedFixture) snapshot.selectedFixture = this.selectedFixture;
    return snapshot;
  }

  destroy(): void {
    this.match.destroy();
    this.physics.free();
  }

  private workers(): WorkerState[] {
    if (this.match.usesManualControl()) return this.actions.states();
    if (this.match.usesCompoundControl()) {
      return this.autonomousTeams.flatMap((team) => team.actions.states());
    }
    return this.autonomousLanes.flatMap((lane) => lane.actions.states());
  }

  private connections(): ConnectionState[] {
    const connections = [
      ...this.actions.connectionStates(),
      ...this.autonomousTeams.flatMap((team) => team.actions.connectionStates()),
      ...this.autonomousLanes.flatMap((lane) => lane.actions.connectionStates()),
    ];
    return [...new Map(connections.map((connection) => [connection.id, connection])).values()];
  }

  private addActionEvent(event: ActionEvent): void {
    if (
      this.selectedFixture === "ramp" &&
      event.technical?.startsWith("release:") &&
      event.technical.includes("wheel")
    ) {
      this.fixtureEvidence.add("wheel-released");
    }
    this.eventSequence += 1;
    const activity: ActivityEvent = {
      id: `event-${this.eventSequence}`,
      tick: this.physics.tick,
      elapsed: this.physics.tick * CORE_FIXED_DT,
      text: event.text,
    };
    if (event.actorId) activity.actorId = event.actorId;
    if (event.team) activity.team = event.team;
    if (event.technical) activity.technical = event.technical;
    this.events.unshift(activity);
    this.events = this.events.slice(0, 100);
  }

  private updateFixtureResult(): void {
    if (!this.selectedFixture) return;
    const busy = this.actions.isBusy();
    if (busy) this.fixtureWasBusy = true;
    if (this.selectedFixture === "lever") this.observeLeverFixture();
    if (this.selectedFixture === "ramp") this.observeRampFixture();
    if (this.selectedFixture === "hoist") this.observeHoistFixture();
    if (this.selectedFixture === "ram") this.observeRamFixture();
    if (!this.fixtureWasBusy || busy) return;
    if (this.selectedFixture === "transport") {
      const beamId = this.physics.inventoryIds("king").filter((id) => id.includes("beam-long")).at(1);
      const beam = beamId ? this.physics.bodyPosition(beamId) : undefined;
      const diagnostics = this.physics.diagnostics();
      if (
        beam &&
        beam.x > 2 &&
        diagnostics.workerPenetrations === 0 &&
        diagnostics.carriedPartPenetrations === 0 &&
        diagnostics.deepBodyPenetrations === 0
      ) {
        this.completedFixtures.add("transport");
        this.addEvent("Collision-aware transport passes its physical check.", "fixture:transport:pass");
      }
    }
    if (this.selectedFixture === "lever") {
      const blockId = "tower-03-3";
      const start = this.fixtureInitialPositions.get(blockId);
      const end = this.physics.bodyPosition(blockId);
      const diagnostics = this.physics.diagnostics();
      if (
        start &&
        end &&
        distance(start, end) >= .065 &&
        this.fixtureEvidence.has("lever-supported") &&
        this.fixtureEvidence.has("lever-load-contact") &&
        diagnostics.illegalTransformWrites === 0
      ) {
        this.completedFixtures.add("lever");
        this.addEvent("The physical lever shifts a tower timber through supported contact.", "fixture:lever:pass");
      } else if (start && end) {
        this.addEvent(`The lever test moves its tower timber ${distance(start, end).toFixed(2)} metres.`, "fixture:lever:incomplete");
      }
    }
    if (this.selectedFixture === "ramp") {
      const wheelId = this.physics.inventoryIds("king").filter((id) => id.includes("wheel")).at(1);
      const contactStart = this.fixtureInitialPositions.get("ramp-wheel-contact");
      const wheelEnd = wheelId ? this.physics.bodyPosition(wheelId) : undefined;
      const travel = contactStart && wheelEnd ? distance(contactStart, wheelEnd) : 0;
      if (
        this.fixtureEvidence.has("ramp-supported") &&
        this.fixtureEvidence.has("wheel-on-ramp") &&
        this.fixtureEvidence.has("wheel-released") &&
        travel >= .55 &&
        this.physics.diagnostics().illegalTransformWrites === 0
      ) {
        this.completedFixtures.add("ramp");
        this.addEvent("The physical ramp supports and redirects the grooved wheel.", "fixture:ramp:pass");
      } else {
        this.addEvent(`The ramp wheel travels ${travel.toFixed(2)} metres after contact.`, "fixture:ramp:incomplete");
      }
    }
    if (this.selectedFixture === "hoist") {
      const ropeId = this.physics.inventoryIds("king")
        .filter((id) => this.physics.records.get(id)?.family === "rope").at(1);
      const loadId = this.physics.inventoryIds("king").filter((id) => id.includes("plank")).at(1);
      const start = this.fixtureInitialPositions.get("hoist-load");
      const end = loadId ? this.physics.bodyPosition(loadId) : undefined;
      const connections = this.actions.connectionStates();
      const ropeConnections = ropeId
        ? connections.filter((connection) =>
          connection.class === "ROPE_ATTACH" &&
          (connection.bodyA === ropeId || connection.bodyB === ropeId))
        : [];
      const receiverFamilies = new Set(ropeConnections.map((connection) => {
        const receiverId = connection.bodyA === ropeId ? connection.bodyB : connection.bodyA;
        return this.physics.records.get(receiverId)?.family;
      }));
      const loadTravel = start && end ? distance(start, end) : 0;
      const verticalTravel = start && end ? end.y - start.y : 0;
      const loadLine = ropeConnections.find((connection) =>
        connection.bodyA === loadId || connection.bodyB === loadId);
      if (
        ropeConnections.length === 2 &&
        receiverFamilies.has("sheave") &&
        receiverFamilies.has("plank") &&
        connections.some((connection) => connection.class === "KEYED_COAXIAL") &&
        loadLine?.tested &&
        (loadLine.tension ?? 0) > 0 &&
        (loadLine.slack ?? 1) < .08 &&
        loadTravel >= .2 &&
        verticalTravel >= .04 &&
        this.physics.diagnostics().illegalTransformWrites === 0
      ) {
        this.completedFixtures.add("hoist");
        this.addEvent("The routed line raises and holds its plank proof load under tension.", "fixture:hoist:pass");
      } else {
        this.addEvent(
          `The hoist shifts its proof load ${loadTravel.toFixed(2)} metres with ${Math.max(0, loadLine?.slack ?? 0).toFixed(2)} metres slack.`,
          "fixture:hoist:incomplete",
        );
      }
    }
    if (this.selectedFixture === "ram") {
      const blockId = "tower-04-1";
      const start = this.fixtureInitialPositions.get(blockId);
      const end = this.physics.bodyPosition(blockId);
      const blockTravel = start && end ? distance(start, end) : 0;
      const connections = this.actions.connectionStates();
      const axleConnections = connections.filter((connection) =>
        connection.bodyA.includes("axle") || connection.bodyB.includes("axle"));
      if (
        blockTravel >= .4 &&
        this.fixtureEvidence.has("ram-wheels-rolling") &&
        this.fixtureEvidence.has("ram-contact") &&
        axleConnections.filter((connection) => connection.class === "KEYED_COAXIAL").length === 2 &&
        axleConnections.filter((connection) => connection.class === "AXLE_BEARING").length === 1 &&
        connections.some((connection) =>
          connection.class === "TENON_LOCK" &&
          ((connection.bodyA.includes("beam") && connection.bodyB.includes("plank")) ||
            (connection.bodyB.includes("beam") && connection.bodyA.includes("plank")))) &&
        this.physics.diagnostics().illegalTransformWrites === 0
      ) {
        this.completedFixtures.add("ram");
        this.addEvent("The wheeled ram rolls into the tower and drives a timber clear.", "fixture:ram:pass");
      } else {
        this.addEvent(`The ram moves its timber ${blockTravel.toFixed(2)} metres.`, "fixture:ram:incomplete");
      }
    }
    if (this.selectedFixture && this.completedFixtures.has(this.selectedFixture)) {
      this.paused = true;
    }
    this.fixtureWasBusy = false;
  }

  private observeRampFixture(): void {
    const wedgeId = this.physics.inventoryIds("king").filter((id) => id.includes("wedge")).at(0);
    const plankId = this.physics.inventoryIds("king").filter((id) => id.includes("plank")).at(1);
    const wheelId = this.physics.inventoryIds("king").filter((id) => id.includes("wheel")).at(1);
    if (!wedgeId || !plankId || !wheelId) return;
    if (this.physics.contactCount(plankId, wedgeId) > 0) {
      this.fixtureEvidence.add("ramp-supported");
    }
    const wheel = this.physics.records.get(wheelId);
    if (!wheel?.carriedBy && this.physics.contactCount(wheelId, plankId) > 0) {
      this.fixtureEvidence.add("wheel-on-ramp");
      if (!this.fixtureInitialPositions.has("ramp-wheel-contact")) {
        const position = this.physics.bodyPosition(wheelId);
        if (position) this.fixtureInitialPositions.set("ramp-wheel-contact", position);
      }
    }
  }

  private observeLeverFixture(): void {
    const beamId = this.physics.inventoryIds("king").filter((id) => id.includes("beam-long")).at(1);
    const hubId = this.physics.inventoryIds("king").filter((id) => id.includes("hub")).at(0);
    if (!beamId || !hubId) return;
    if (this.physics.contactCount(beamId, hubId) > 0) {
      this.fixtureEvidence.add("lever-supported");
    }
    if (this.physics.contactCount(beamId, "tower-03-3") > 0) {
      this.fixtureEvidence.add("lever-load-contact");
    }
  }

  private observeHoistFixture(): void {
    const active = this.actions.activeDescription();
    if (!active?.startsWith("tension:work") || this.fixtureInitialPositions.has("hoist-load")) return;
    const loadId = this.physics.inventoryIds("king").filter((id) => id.includes("plank")).at(1);
    const position = loadId ? this.physics.bodyPosition(loadId) : undefined;
    if (position) this.fixtureInitialPositions.set("hoist-load", position);
  }

  private observeRamFixture(): void {
    const beamId = this.physics.inventoryIds("king").filter((id) => id.includes("beam-long")).at(1);
    const wheelIds = this.physics.inventoryIds("king").filter((id) => id.includes("wheel"));
    const active = this.actions.activeDescription();
    if (active?.startsWith("push:") && !this.fixtureEvidence.has("ram-push-started")) {
      this.fixtureEvidence.add("ram-push-started");
      for (const wheelId of wheelIds) {
        const rotation = this.physics.bodyRotation(wheelId);
        if (rotation) this.fixtureInitialRotations.set(wheelId, rotation);
      }
    }
    if (this.fixtureEvidence.has("ram-push-started")) {
      const turns = wheelIds.map((wheelId) => {
        const initial = this.fixtureInitialRotations.get(wheelId);
        const current = this.physics.bodyRotation(wheelId);
        return initial && current ? quaternionDistance(initial, current) : 0;
      });
      if (turns.length === 2 && turns.every((turn) => turn >= .6)) {
        this.fixtureEvidence.add("ram-wheels-rolling");
      }
    }
    if (beamId && this.physics.contactCount(beamId, "tower-04-1") > 0) {
      this.fixtureEvidence.add("ram-contact");
    }
  }

  private addEvent(text: string, technical?: string): void {
    this.eventSequence += 1;
    const event: ActivityEvent = {
      id: `event-${this.eventSequence}`,
      tick: this.physics.tick,
      elapsed: this.physics.tick * CORE_FIXED_DT,
      text,
    };
    if (technical) event.technical = technical;
    this.events.unshift(event);
  }
}

const TOWER_YAW = degrees(14);
const RAM_SADDLE_PITCH = 0;

function localStagePoint(x: number, y: number, z: number): Vec3 {
  return {
    x: x * Math.cos(TOWER_YAW) - z * Math.sin(TOWER_YAW),
    y,
    z: x * Math.sin(TOWER_YAW) + z * Math.cos(TOWER_YAW),
  };
}

function yawQuat(angle: number): Quat {
  return { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) };
}

function xQuat(angle: number): Quat {
  return { x: Math.sin(angle / 2), y: 0, z: 0, w: Math.cos(angle / 2) };
}

function multiplyQuat(left: Quat, right: Quat): Quat {
  return {
    w: left.w * right.w - left.x * right.x - left.y * right.y - left.z * right.z,
    x: left.w * right.x + left.x * right.w + left.y * right.z - left.z * right.y,
    y: left.w * right.y - left.x * right.z + left.y * right.w + left.z * right.x,
    z: left.w * right.z + left.x * right.y - left.y * right.x + left.z * right.w,
  };
}

function degrees(value: number): number {
  return value * Math.PI / 180;
}

function distance(first: Vec3, second: Vec3): number {
  return Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z);
}

function addVec(origin: Vec3, offset: Vec3, y: number): Vec3 {
  return {
    x: origin.x + offset.x,
    y,
    z: origin.z + offset.z,
  };
}

function scaleVec(vector: Vec3, scalar: number): Vec3 {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
    z: vector.z * scalar,
  };
}

function quaternionDistance(first: Quat, second: Quat): number {
  const dot = Math.min(1, Math.abs(
    first.x * second.x + first.y * second.y + first.z * second.z + first.w * second.w,
  ));
  return 2 * Math.acos(dot);
}
