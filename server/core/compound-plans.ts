import type {
  LegalActionRequest,
  Quat,
  Team,
  Vec3,
} from "../../shared/core-protocol.js";
import type {
  MachineCapability,
  SimpleMachineId,
} from "../../shared/agent-rules.js";
import { CorePhysicsWorld, TOWER_SPEC } from "./physics.js";

export type CompoundPlanId =
  | "escalade-ramp"
  | "rescue-hoist"
  | "wheel-shot"
  | "compound-ram"
  | "pivoted-striker"
  | "counterweight-sling";

export interface CompoundPlanOption {
  id: string;
  baseId?: string;
  composition?: readonly string[];
  componentParts?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  ruleId: string;
  team: Team;
  label: string;
  announcement: string;
  weight: number;
  simpleMachines: readonly SimpleMachineId[];
  capabilities: readonly MachineCapability[];
  requiredFacts: readonly string[];
  observedFacts: readonly string[];
  eligible: boolean;
  parts: Readonly<Record<string, string>>;
  requests: LegalActionRequest[];
}

export function observedCompoundPlans(
  physics: CorePhysicsWorld,
  team: Team,
): CompoundPlanOption[] {
  return team === "king"
    ? [escaladeRampPlan(physics), rescueHoistPlan(physics)]
    : [compoundRamPlan(physics), wheelShotPlan(physics), pivotedStrikerPlan(physics), counterweightSlingPlan(physics)];
}

function escaladeRampPlan(physics: CorePhysicsWorld): CompoundPlanOption {
  const team = "king" as const;
  const workers = physics.workerIds(team);
  const first = workers[0];
  const second = workers[1];
  const third = workers[2];
  const wedgeId = partByFamily(physics, team, "wedge", 0);
  const plankId = partByFamily(physics, team, "plank", 1);
  const retreatId = partByFamily(physics, team, "hub", 0);
  const requiredFacts = [
    "three-red-workers-ready",
    "red-wedge-visible",
    "red-plank-visible",
    "tower-approach-open",
  ] as const;
  const observedFacts = compactFacts([
    ["three-red-workers-ready", Boolean(first && second && third)],
    ["red-wedge-visible", partIsAvailable(physics, wedgeId)],
    ["red-plank-visible", partIsAvailable(physics, plankId)],
    ["tower-approach-open", Boolean(physics.records.get("tower-02-1")?.dynamic)],
  ]);
  const parts = compactParts({ wedge: wedgeId, plank: plankId, retreat: retreatId });
  const requests: LegalActionRequest[] = [];
  if (first && second && third && wedgeId && plankId && retreatId) {
    const z = .82;
    const wedgePose = { x: -2.58, y: .1, z };
    const plankPose = { x: -3.36, y: .25, z };
    const plankTurnPose = { x: -5.05, y: .52, z };
    const plankFlatOrientation = yawQuat(Math.PI / 2);
    const plankOrientation = multiplyQuat(plankFlatOrientation, xQuat(-18 * Math.PI / 180));
    requests.push(
      { action: "reserve", actorIds: [third], targetId: wedgeId },
      { action: "fetch", actorIds: [third], targetId: wedgeId },
      {
        action: "carry",
        actorIds: [third],
        targetId: wedgeId,
        targetPort: "hold-opposite",
        destination: wedgePose,
        orientation: yawQuat(0),
      },
      {
        action: "release",
        actorIds: [third],
        targetId: wedgeId,
        targetPort: "stable-staging",
        destination: wedgePose,
      },
      { action: "reserve", actorIds: [second], targetId: plankId },
      { action: "fetch", actorIds: [first, second], targetId: plankId },
      { action: "carry", actorIds: [first, second], targetId: plankId, destination: plankTurnPose },
      {
        action: "align",
        actorIds: [first, second],
        targetId: plankId,
        targetPort: "front-side",
        destination: plankTurnPose,
        orientation: plankFlatOrientation,
      },
      {
        action: "carry",
        actorIds: [first, second],
        targetId: plankId,
        targetPort: "resume-grip",
        destination: { ...plankPose, y: .5 },
        orientation: plankFlatOrientation,
      },
      {
        action: "align",
        actorIds: [first, second],
        targetId: plankId,
        targetPort: "side-on",
        destination: { ...plankPose, y: .5 },
        orientation: plankFlatOrientation,
      },
      {
        action: "align",
        actorIds: [first, second],
        targetId: plankId,
        targetPort: "assembly-hold",
        destination: { ...plankPose, y: .5 },
        orientation: plankOrientation,
      },
      { action: "test", actorIds: [first], targetId: plankId, magnitude: .7 },
      { action: "climb", actorIds: [third], targetId: plankId },
      { action: "fetch", actorIds: [third], targetId: retreatId },
      { action: "release", actorIds: [first, second], targetId: plankId, destination: plankPose },
    );
  }
  return option({
    id: "escalade-ramp",
    ruleId: "raise-escalade-ramp",
    team,
    label: "wedge + inclined plane: escalade",
    announcement: "Red combines a wedge and broad plank into a climbable escalade ramp.",
    weight: 1.35,
    simpleMachines: ["wedge", "inclined-plane"],
    capabilities: ["climb"],
    requiredFacts,
    observedFacts,
    parts,
    requests,
  });
}

function rescueHoistPlan(physics: CorePhysicsWorld): CompoundPlanOption {
  const team = "king" as const;
  const workers = physics.workerIds(team);
  const first = workers[0];
  const second = workers[1];
  const third = workers[2];
  const axleId = physics.inventoryIds(team).find((id) => id.includes("axle-long"));
  const sheaveId = partByFamily(physics, team, "sheave", 0);
  const ropeId = partByFamily(physics, team, "rope", 1);
  const loadId = partByFamily(physics, team, "plank", 1);
  const requiredFacts = [
    "three-red-workers-ready",
    "red-keyed-axle-visible",
    "red-sheave-visible",
    "red-hooked-line-visible",
    "red-proof-load-visible",
    "humpty-still-aloft",
  ] as const;
  const cradle = physics.bodyPosition("central-cradle");
  const observedFacts = compactFacts([
    ["three-red-workers-ready", Boolean(first && second && third)],
    ["red-keyed-axle-visible", partIsAvailable(physics, axleId)],
    ["red-sheave-visible", partIsAvailable(physics, sheaveId)],
    ["red-hooked-line-visible", partIsAvailable(physics, ropeId)],
    ["red-proof-load-visible", partIsAvailable(physics, loadId)],
    ["humpty-still-aloft", Boolean(cradle && cradle.y > 1.5)],
  ]);
  const parts = compactParts({ axle: axleId, sheave: sheaveId, rope: ropeId, load: loadId });
  const requests: LegalActionRequest[] = [];
  if (first && second && third && axleId && sheaveId && ropeId && loadId) {
    const axleOrientation = yawQuat(Math.PI / 2);
    const axlePose = { x: -4.35, y: .98, z: 2.2 };
    const sheavePose = { x: axlePose.x - .65, y: axlePose.y, z: axlePose.z };
    const sheaveParkingPose = { ...sheavePose, x: sheavePose.x - .28 };
    const ropePose = { x: -5.3, y: .5, z: 1.9 };
    const loadHookPose = { x: -5.4, y: .16, z: 1.5 };
    const loadCarryPose = { ...loadHookPose, y: .78 };
    const loadPlacementPose = { ...loadHookPose, y: .42 };
    const loadTurnPose = { x: -5.05, y: .58, z: -2.35 };
    const loadOrientation = yawQuat(0);
    requests.push(
      ...machineBayMuster(team, workers),
      { action: "reserve", actorIds: [second], targetId: axleId },
      { action: "fetch", actorIds: [second], targetId: axleId },
      {
        action: "carry",
        actorIds: [second],
        targetId: axleId,
        targetPort: "hold-front",
        destination: { ...axlePose, y: axlePose.y + .26 },
        orientation: axleOrientation,
      },
      {
        action: "align",
        actorIds: [second],
        targetId: axleId,
        targetPort: "assembly-hold",
        destination: axlePose,
        orientation: axleOrientation,
      },
      {
        action: "hold",
        actorIds: [second],
        targetId: axleId,
        targetPort: "brace-assembly",
        orientation: axleOrientation,
        magnitude: .65,
      },
      ...holdOneWorkerPart(third, sheaveId, sheaveParkingPose, axleOrientation),
      {
        action: "align",
        actorIds: [third],
        targetId: sheaveId,
        targetPort: "assembly-hold",
        secondaryId: axleId,
        secondaryPort: "axle-end-negative",
        destination: sheavePose,
        orientation: axleOrientation,
      },
      {
        action: "connect",
        actorIds: [third],
        targetId: axleId,
        secondaryId: sheaveId,
        connectionClass: "KEYED_COAXIAL",
      },
      { action: "test", actorIds: [third], targetId: axleId, magnitude: .8 },
      ...holdOneWorkerPart(third, ropeId, ropePose, yawQuat(0), "hold-behind"),
      {
        action: "reeveRope",
        actorIds: [third],
        targetId: ropeId,
        secondaryId: sheaveId,
        connectionClass: "ROPE_ATTACH",
      },
      {
        action: "release",
        actorIds: [third],
        targetId: ropeId,
        targetPort: "hoist-rope-clear",
        destination: ropePose,
      },
      { action: "reserve", actorIds: [first], targetId: loadId },
      { action: "fetch", actorIds: [first, third], targetId: loadId },
      { action: "carry", actorIds: [first, third], targetId: loadId, destination: loadTurnPose },
      {
        action: "align",
        actorIds: [first, third],
        targetId: loadId,
        targetPort: "front-side",
        destination: loadTurnPose,
        orientation: loadOrientation,
      },
      {
        action: "carry",
        actorIds: [first, third],
        targetId: loadId,
        targetPort: "resume-grip",
        destination: loadCarryPose,
        orientation: loadOrientation,
      },
      {
        action: "align",
        actorIds: [first, third],
        targetId: loadId,
        targetPort: "side-on",
        destination: loadPlacementPose,
        orientation: loadOrientation,
      },
      {
        action: "release",
        actorIds: [first, third],
        targetId: loadId,
        targetPort: "hoist-load-clear",
        destination: loadHookPose,
      },
      { action: "fetch", actorIds: [first], targetId: axleId, targetPort: "hoist-brace-approach" },
      {
        action: "hold",
        actorIds: [first, second],
        targetId: axleId,
        targetPort: "brace-assembly",
        orientation: axleOrientation,
        magnitude: .8,
      },
      { action: "fetch", actorIds: [third], targetId: loadId, targetPort: "hoist-hook-approach" },
      {
        action: "hookRope",
        actorIds: [third],
        targetId: ropeId,
        secondaryId: loadId,
        connectionClass: "ROPE_ATTACH",
      },
      {
        action: "tension",
        actorIds: [third],
        targetId: ropeId,
        targetPort: "hoist-tension-stance",
        magnitude: .62,
      },
      { action: "test", actorIds: [third], targetId: ropeId, magnitude: 1.2 },
      { action: "wait", actorIds: [third], targetId: loadId, magnitude: 2 },
    );
  }
  return option({
    id: "rescue-hoist",
    ruleId: "operate-rescue-crane",
    team,
    label: "wheel + sheave + line: rescue hoist",
    announcement: "Red assembles a keyed sheave and routed line, then raises a physical receiving load.",
    weight: 1.55,
    simpleMachines: ["wheel-and-axle", "pulley", "lever"],
    capabilities: ["lift", "lower"],
    requiredFacts,
    observedFacts,
    parts,
    requests,
  });
}

function wheelShotPlan(physics: CorePhysicsWorld): CompoundPlanOption {
  const team = "queen" as const;
  const workers = physics.workerIds(team);
  const first = workers[0];
  const second = workers[1];
  const third = workers[2];
  const wedgeId = partByFamily(physics, team, "wedge", 0);
  const beamId = physics.inventoryIds(team).filter((id) => id.includes("beam-medium")).at(1);
  const wheelId = partByFamily(physics, team, "wheel", 1);
  const targetId = "tower-02-3";
  const requiredFacts = [
    "three-green-workers-ready",
    "green-wedge-visible",
    "green-rail-visible",
    "green-wheel-visible",
    "lower-timber-exposed",
  ] as const;
  const observedFacts = compactFacts([
    ["three-green-workers-ready", Boolean(first && second && third)],
    ["green-wedge-visible", partIsAvailable(physics, wedgeId)],
    ["green-rail-visible", partIsAvailable(physics, beamId)],
    ["green-wheel-visible", partIsAvailable(physics, wheelId)],
    ["lower-timber-exposed", Boolean(physics.records.get(targetId)?.dynamic)],
  ]);
  const parts = compactParts({ wedge: wedgeId, rail: beamId, projectile: wheelId, target: targetId });
  const requests: LegalActionRequest[] = [];
  if (first && second && third && wedgeId && beamId && wheelId) {
    const z = .72;
    const wedgePose = { x: 4.02, y: .1, z };
    const beamPose = { x: 3.45, y: .18, z };
    const wheelPose = { x: 3.92, y: .64, z: .83 };
    const beamOrientation = multiplyQuat(yawQuat(Math.PI / 2), xQuat(-12 * Math.PI / 180));
    requests.push(
      { action: "reserve", actorIds: [third], targetId: wedgeId },
      { action: "fetch", actorIds: [third], targetId: wedgeId },
      {
        action: "carry",
        actorIds: [third],
        targetId: wedgeId,
        targetPort: "hold-opposite",
        destination: wedgePose,
        orientation: yawQuat(0),
      },
      {
        action: "release",
        actorIds: [third],
        targetId: wedgeId,
        targetPort: "stable-staging",
        destination: wedgePose,
      },
      { action: "reserve", actorIds: [first], targetId: beamId },
      { action: "fetch", actorIds: [first], targetId: beamId },
      {
        action: "carry",
        actorIds: [first],
        targetId: beamId,
        targetPort: "hold-front",
        destination: { x: 5.1, y: .5, z: -2.4 },
        orientation: yawQuat(0),
      },
      {
        action: "carry",
        actorIds: [first],
        targetId: beamId,
        targetPort: "resume-grip",
        destination: { x: 5.1, y: .5, z: 1.2 },
        orientation: yawQuat(0),
      },
      {
        action: "carry",
        actorIds: [first],
        targetId: beamId,
        targetPort: "resume-grip",
        destination: { x: 4.4, y: .5, z: 1.2 },
        orientation: yawQuat(0),
      },
      {
        action: "carry",
        actorIds: [first],
        targetId: beamId,
        targetPort: "resume-grip",
        destination: { x: 3.9, y: .5, z: 1.2 },
        orientation: yawQuat(0),
      },
      {
        action: "align",
        actorIds: [first],
        targetId: beamId,
        targetPort: "assembly-hold",
        destination: beamPose,
        orientation: beamOrientation,
      },
      { action: "reserve", actorIds: [third], targetId: wheelId },
      { action: "fetch", actorIds: [third], targetId: wheelId },
      {
        action: "carry",
        actorIds: [third],
        targetId: wheelId,
        targetPort: "hold-front",
        destination: { ...wheelPose, y: 1.08 },
        orientation: yawQuat(0),
      },
      { action: "fetch", actorIds: [second], targetId: wheelId, targetPort: "gunner-approach" },
      { action: "release", actorIds: [third], targetId: wheelId, destination: wheelPose },
      {
        action: "push",
        actorIds: [second],
        targetId: wheelId,
        targetPort: "projectile-launch",
        destination: { x: .1, y: .56, z: wheelPose.z },
        magnitude: 3.25,
        loadId: targetId,
        loadTravel: .025,
      },
      { action: "test", actorIds: [second], targetId: wheelId, magnitude: .6 },
      { action: "release", actorIds: [first], targetId: beamId, destination: beamPose },
    );
  }
  return option({
    id: "wheel-shot",
    ruleId: "launch-wheel-shot",
    team,
    label: "wedge + inclined plane + wheel: bombard",
    announcement: "Green combines a wedge, inclined spar, and wheel into an assault launcher.",
    weight: 1.55,
    simpleMachines: ["wedge", "inclined-plane", "wheel-and-axle"],
    capabilities: ["launch", "strike", "dislodge-timber"],
    requiredFacts,
    observedFacts,
    parts,
    requests,
  });
}

function compoundRamPlan(physics: CorePhysicsWorld): CompoundPlanOption {
  const team = "queen" as const;
  const workers = physics.workerIds(team);
  const first = workers[0];
  const second = workers[1];
  const third = workers[2];
  const axleId = physics.inventoryIds(team).find((id) => id.includes("axle-long"));
  const wheelIds = physics.inventoryIds(team).filter((id) => id.includes("wheel"));
  const negativeWheelId = wheelIds.at(1);
  const positiveWheelId = wheelIds.at(0);
  const plankId = partByFamily(physics, team, "plank", 1);
  const beamId = physics.inventoryIds(team).filter((id) => id.includes("beam-long")).at(1);
  const stagedBeamId = physics.inventoryIds(team).filter((id) => id.includes("beam-medium")).at(1);
  const stagedHubId = partByFamily(physics, team, "hub", 0);
  const targetId = "tower-04-3";
  const requiredFacts = [
    "three-green-workers-ready",
    "green-keyed-axle-visible",
    "green-wheel-pair-visible",
    "green-chassis-visible",
    "green-striker-visible",
    "green-siege-lanes-clear",
    "lower-timber-exposed",
  ] as const;
  const observedFacts = compactFacts([
    ["three-green-workers-ready", Boolean(first && second && third)],
    ["green-keyed-axle-visible", partIsAvailable(physics, axleId)],
    ["green-wheel-pair-visible", partIsAvailable(physics, negativeWheelId) && partIsAvailable(physics, positiveWheelId)],
    ["green-chassis-visible", partIsAvailable(physics, plankId)],
    ["green-striker-visible", partIsAvailable(physics, beamId)],
    ["green-siege-lanes-clear", partsAreOutsideSiegeLanes(physics, stagedBeamId, stagedHubId)],
    ["lower-timber-exposed", Boolean(physics.records.get(targetId)?.dynamic)],
  ]);
  const parts = compactParts({
    axle: axleId,
    negativeWheel: negativeWheelId,
    positiveWheel: positiveWheelId,
    chassis: plankId,
    striker: beamId,
    target: targetId,
  });
  const requests: LegalActionRequest[] = [];
  if (
    first && second && third && axleId && negativeWheelId && positiveWheelId && plankId && beamId
  ) {
    const axlePose = { x: 3.4, y: .36, z: 0 };
    const negativeWheelPose = { ...axlePose, z: -.55 };
    const positiveWheelPose = { ...axlePose, z: .55 };
    const negativeWheelParking = { ...negativeWheelPose, z: -.78 };
    const positiveWheelParking = { x: axlePose.x, y: .36, z: 1.3 };
    const chassisPose = { x: 2.9, y: .48, z: 0 };
    const beamPose = { x: 2.38, y: .67, z: 0 };
    const plankTurnPose = { x: 5.05, y: .52, z: 2.35 };
    const beamTurnPose = { x: 4.25, y: .8, z: -2.35 };
    const axleOrientation = yawQuat(0);
    const chassisOrientation = yawQuat(-Math.PI / 2);
    const beamOrientation = chassisOrientation;
    const assemblyCrew = [first, second];
    const mountingCrew = [second, third];
    const mountingRegripCrew = mountingCrew;
    requests.push(
      ...machineBayMuster(team, workers),
      ...holdOneWorkerPart(first, axleId, axlePose, axleOrientation),
      ...holdOneWorkerPart(second, negativeWheelId, negativeWheelParking, axleOrientation, "hold-behind"),
      {
        action: "align",
        actorIds: [second],
        targetId: negativeWheelId,
        targetPort: "assembly-hold",
        secondaryId: axleId,
        secondaryPort: "axle-end-negative",
        destination: negativeWheelPose,
        orientation: axleOrientation,
      },
      {
        action: "connect",
        actorIds: [second],
        targetId: axleId,
        secondaryId: negativeWheelId,
        connectionClass: "KEYED_COAXIAL",
      },
      { action: "test", actorIds: [first], targetId: axleId, magnitude: .65 },
      { action: "release", actorIds: [second], targetId: negativeWheelId, destination: negativeWheelPose },
      ...holdOneWorkerPart(third, positiveWheelId, positiveWheelParking, axleOrientation, "hold-front"),
      {
        action: "align",
        actorIds: [third],
        targetId: positiveWheelId,
        targetPort: "assembly-hold",
        secondaryId: axleId,
        secondaryPort: "axle-approach-positive",
        destination: { ...positiveWheelPose, z: .82 },
        orientation: axleOrientation,
      },
      {
        action: "align",
        actorIds: [third],
        targetId: positiveWheelId,
        targetPort: "assembly-hold",
        secondaryId: axleId,
        secondaryPort: "axle-end-positive",
        destination: positiveWheelPose,
        orientation: axleOrientation,
      },
      {
        action: "connect",
        actorIds: [third],
        targetId: axleId,
        secondaryId: positiveWheelId,
        connectionClass: "KEYED_COAXIAL",
      },
      { action: "test", actorIds: [first], targetId: axleId, magnitude: .65 },
      { action: "release", actorIds: [third], targetId: positiveWheelId, destination: positiveWheelPose },
      { action: "reserve", actorIds: [second], targetId: plankId },
      { action: "fetch", actorIds: mountingCrew, targetId: plankId },
      { action: "carry", actorIds: mountingCrew, targetId: plankId, destination: plankTurnPose },
      {
        action: "align",
        actorIds: mountingRegripCrew,
        targetId: plankId,
        targetPort: "front-side",
        destination: plankTurnPose,
        orientation: chassisOrientation,
      },
      {
        action: "carry",
        actorIds: mountingRegripCrew,
        targetId: plankId,
        targetPort: "resume-grip",
        destination: { ...chassisPose, y: .78, z: .65 },
        orientation: chassisOrientation,
      },
      {
        action: "align",
        actorIds: mountingRegripCrew,
        targetId: plankId,
        targetPort: "assembly-hold",
        secondaryId: axleId,
        secondaryPort: "axle-chassis-bearing",
        destination: chassisPose,
        orientation: chassisOrientation,
      },
      {
        action: "connect",
        actorIds: mountingRegripCrew,
        targetId: axleId,
        secondaryId: plankId,
        connectionClass: "AXLE_BEARING",
      },
      { action: "hold", actorIds: [third], targetId: plankId, targetPort: "brace-assembly", magnitude: .65 },
      { action: "test", actorIds: mountingRegripCrew, targetId: plankId, magnitude: .9 },
      { action: "wait", actorIds: [first], destination: { x: 6, y: .775, z: -3.35 }, magnitude: .35 },
      { action: "wait", actorIds: [second], destination: { x: 6, y: .775, z: -2.65 }, magnitude: .35 },
      { action: "reserve", actorIds: [first], targetId: beamId },
      { action: "fetch", actorIds: assemblyCrew, targetId: beamId },
      { action: "carry", actorIds: assemblyCrew, targetId: beamId, destination: beamTurnPose },
      {
        action: "align",
        actorIds: assemblyCrew,
        targetId: beamId,
        targetPort: "ram-open-side",
        destination: beamTurnPose,
        orientation: beamOrientation,
      },
      {
        action: "carry",
        actorIds: assemblyCrew,
        targetId: beamId,
        targetPort: "ram-open-side",
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
      { action: "test", actorIds: assemblyCrew, targetId: beamId, magnitude: 1.2 },
      {
        action: "push",
        actorIds: [first, second, third],
        targetId: plankId,
        secondaryId: beamId,
        targetPort: "assembly-push",
        secondaryPort: "worker-supported",
        destination: { x: -.5, y: chassisPose.y, z: 0 },
        orientation: chassisOrientation,
        magnitude: 3.4,
        loadId: targetId,
        loadTravel: .4,
      },
    );
  }
  return option({
    id: "compound-ram",
    ruleId: "drive-compound-ram",
    team,
    label: "wheelset + chassis + striker: ram",
    announcement: "Green keys a wheelset, pins a chassis, and locks a long striker into a rolling ram.",
    weight: 1.7,
    simpleMachines: ["wheel-and-axle", "lever"],
    capabilities: ["strike", "dislodge-timber"],
    requiredFacts,
    observedFacts,
    parts,
    requests,
  });
}

function pivotedStrikerPlan(physics: CorePhysicsWorld): CompoundPlanOption {
  const team = "queen" as const;
  const workers = physics.workerIds(team);
  const first = workers[0];
  const second = workers[1];
  const third = workers[2];
  const beamId = physics.inventoryIds(team).filter((id) => id.includes("beam-medium")).at(1);
  const hubId = partByFamily(physics, team, "hub", 0);
  const targetId = "tower-03-1";
  const targetStart = physics.bodyPosition(targetId);
  const beamRackOrientation = beamId ? physics.bodyRotation(beamId) : undefined;
  const requiredFacts = [
    "three-green-workers-ready",
    "green-striker-visible",
    "green-fulcrum-visible",
    "green-pivot-lane-clear",
    "lower-timber-exposed",
  ] as const;
  const observedFacts = compactFacts([
    ["three-green-workers-ready", Boolean(first && second && third)],
    ["green-striker-visible", partIsAvailable(physics, beamId)],
    ["green-fulcrum-visible", partIsAvailable(physics, hubId)],
    ["green-pivot-lane-clear", Boolean(targetStart)],
    ["lower-timber-exposed", Boolean(physics.records.get(targetId)?.dynamic)],
  ]);
  const parts = compactParts({ striker: beamId, fulcrum: hubId, target: targetId });
  const requests: LegalActionRequest[] = [];
  if (first && second && third && beamId && hubId && targetStart && beamRackOrientation) {
    const yaw = TOWER_SPEC.yawRadians;
    const alongBlock = { x: Math.cos(yaw), y: 0, z: Math.sin(yaw) };
    const acrossBlock = { x: -Math.sin(yaw), y: 0, z: Math.cos(yaw) };
    const beamOrientation = yawQuat(Math.PI - yaw);
    const loadContact = addVec(targetStart, scaleVec(alongBlock, .81), .64);
    const beamSeatBase = addVec(loadContact, scaleVec(acrossBlock, .8), .61);
    const rawBeamSeatPose = addVec(beamSeatBase, scaleVec(alongBlock, -.03), .61);
    const beamSeatPose = { ...rawBeamSeatPose, x: rawBeamSeatPose.x + .2 };
    const hubPose = { ...beamSeatPose, x: beamSeatPose.x + .28, y: .28 };
    const beamPreseatPose = addVec(beamSeatPose, scaleVec(alongBlock, .48), .86);
    const beamHighPose = { ...beamPreseatPose, y: 1.18 };
    const beamSideApproach = { ...beamHighPose, x: 2.85 };
    const beamCarryPose = { x: 3.35, y: 1.18, z: -3.2 };
    const beamTurnPose = { x: 4.2, y: .78, z: -2.65 };
    const effortEnd = addVec(beamSeatPose, scaleVec(acrossBlock, .9), .61);
    const effortPoint = addVec(
      addVec(effortEnd, scaleVec(alongBlock, -.7), .61),
      scaleVec(acrossBlock, -.7),
      .61,
    );
    requests.push(
      ...machineBayMuster(team, workers),
      { action: "reserve", actorIds: [first], targetId: beamId },
      { action: "fetch", actorIds: [first, third], targetId: beamId },
      { action: "reserve", actorIds: [second], targetId: hubId },
      { action: "fetch", actorIds: [second], targetId: hubId },
      {
        action: "carry", actorIds: [second], targetId: hubId,
        destination: { ...hubPose, y: hubPose.y + .26 }, orientation: yawQuat(0),
      },
      {
        action: "align", actorIds: [second], targetId: hubId,
        targetPort: "assembly-hold", destination: hubPose, orientation: yawQuat(0),
      },
      { action: "hold", actorIds: [second], targetId: hubId, targetPort: "brace-assembly", magnitude: .6 },
      {
        action: "carry", actorIds: [first, third], targetId: beamId,
        destination: beamTurnPose, orientation: beamRackOrientation,
      },
      {
        action: "align", actorIds: [first, third], targetId: beamId,
        targetPort: "lever-carry-side", destination: beamTurnPose, orientation: beamOrientation,
      },
      {
        action: "carry", actorIds: [first, third], targetId: beamId,
        targetPort: "lever-approach", destination: beamCarryPose, orientation: beamOrientation,
      },
      {
        action: "carry", actorIds: [first, third], targetId: beamId,
        targetPort: "lever-approach", destination: beamSideApproach, orientation: beamOrientation,
      },
      {
        action: "carry", actorIds: [first, third], targetId: beamId,
        targetPort: "lever-final-approach", destination: beamHighPose, orientation: beamOrientation,
      },
      {
        action: "align", actorIds: [first, third], targetId: beamId,
        targetPort: "assembly-hold", destination: beamPreseatPose, orientation: beamOrientation,
      },
      {
        action: "push", actorIds: [first, third], targetId: beamId, secondaryId: hubId,
        targetPort: "supported-center", secondaryPort: targetId, destination: beamSeatPose, magnitude: 360,
      },
      {
        action: "push", actorIds: [first, third], targetId: beamId, secondaryId: targetId,
        targetPort: "end-negative", secondaryPort: "supported-horizontal", destination: effortPoint,
        magnitude: 1_800, loadId: targetId, loadTravel: .08,
      },
    );
  }
  return option({
    id: "pivoted-striker",
    ruleId: "operate-pivoted-striker",
    team,
    label: "beam + fulcrum: pivoted striker",
    announcement: "Green seats a beam over a braced hub and swings its far end into a tower timber.",
    weight: 1.45,
    simpleMachines: ["lever", "wedge"],
    capabilities: ["strike", "dislodge-timber"],
    requiredFacts,
    observedFacts,
    parts,
    requests,
  });
}

function counterweightSlingPlan(physics: CorePhysicsWorld): CompoundPlanOption {
  const team = "queen" as const;
  const workers = physics.workerIds(team);
  const first = workers[0];
  const second = workers[1];
  const third = workers[2];
  const axleId = physics.inventoryIds(team).find((id) => id.includes("axle-long"));
  const sheaveId = partByFamily(physics, team, "sheave", 0);
  const ropeId = partByFamily(physics, team, "rope", 1);
  const counterweightId = partByFamily(physics, team, "plank", 1);
  const projectileId = partByFamily(physics, team, "wheel", 1);
  const targetId = "tower-02-3";
  const requiredFacts = [
    "three-green-workers-ready",
    "green-sling-axle-visible",
    "green-sling-sheave-visible",
    "green-sling-line-visible",
    "green-counterweight-visible",
    "green-projectile-visible",
    "lower-timber-exposed",
  ] as const;
  const observedFacts = compactFacts([
    ["three-green-workers-ready", Boolean(first && second && third)],
    ["green-sling-axle-visible", partIsAvailable(physics, axleId)],
    ["green-sling-sheave-visible", partIsAvailable(physics, sheaveId)],
    ["green-sling-line-visible", partIsAvailable(physics, ropeId)],
    ["green-counterweight-visible", partIsAvailable(physics, counterweightId)],
    ["green-projectile-visible", partIsAvailable(physics, projectileId)],
    ["lower-timber-exposed", Boolean(physics.records.get(targetId)?.dynamic)],
  ]);
  const parts = compactParts({
    axle: axleId,
    sheave: sheaveId,
    rope: ropeId,
    counterweight: counterweightId,
    projectile: projectileId,
    target: targetId,
  });
  const requests: LegalActionRequest[] = [];
  if (first && second && third && axleId && sheaveId && ropeId && counterweightId && projectileId) {
    const axleOrientation = yawQuat(Math.PI / 2);
    const axlePose = { x: 5.2, y: 1.05, z: 2.2 };
    const axleParkingPose = { x: 5.7, y: 1.05, z: 0 };
    const sheavePose = { x: axlePose.x - .65, y: axlePose.y, z: axlePose.z };
    const sheaveParkingPose = { x: 4.1, y: axlePose.y, z: 3.2 };
    const ropePose = { x: 4.22, y: .5, z: 2.2 };
    const counterweightPose = { x: 5.45, y: .18, z: 1.5 };
    const counterweightCarry = { ...counterweightPose, y: .78 };
    const counterweightTurn = { x: 5.15, y: .58, z: -2.35 };
    const projectilePose = { x: 3.9, y: .64, z: .78 };
    requests.push(
      ...machineBayMuster(team, workers),
      ...holdOneWorkerPart(second, axleId, axleParkingPose, axleOrientation, "hold-front"),
      ...holdOneWorkerPart(third, sheaveId, sheaveParkingPose, axleOrientation, "hold-behind"),
      { action: "reserve", actorIds: [first], targetId: ropeId },
      { action: "fetch", actorIds: [first], targetId: ropeId },
      {
        action: "carry", actorIds: [first], targetId: ropeId, targetPort: "hold-behind",
        destination: { x: 5.45, y: .76, z: 3.15 }, orientation: yawQuat(0),
      },
      {
        action: "carry", actorIds: [first], targetId: ropeId, targetPort: "resume-grip",
        destination: { x: 5.25, y: .76, z: 1.55 }, orientation: yawQuat(0),
      },
      {
        action: "carry", actorIds: [first], targetId: ropeId, targetPort: "resume-grip",
        destination: { x: 4.4, y: .76, z: 1.0 }, orientation: yawQuat(0),
      },
      {
        action: "release", actorIds: [first], targetId: ropeId,
        targetPort: "stable-staging", destination: { x: 4.4, y: .06, z: 1.0 },
      },
      {
        action: "carry", actorIds: [second], targetId: axleId, targetPort: "resume-grip",
        destination: { ...axlePose, y: axlePose.y + .26 }, orientation: axleOrientation,
      },
      {
        action: "align", actorIds: [second], targetId: axleId, targetPort: "assembly-hold",
        destination: axlePose, orientation: axleOrientation,
      },
      {
        action: "carry", actorIds: [third], targetId: sheaveId, targetPort: "hold-behind",
        destination: { ...sheavePose, y: sheavePose.y + .26 }, orientation: axleOrientation,
      },
      {
        action: "align", actorIds: [third], targetId: sheaveId, targetPort: "assembly-hold",
        secondaryId: axleId, secondaryPort: "axle-end-negative", destination: sheavePose,
        orientation: axleOrientation,
      },
      { action: "connect", actorIds: [third], targetId: axleId, secondaryId: sheaveId, connectionClass: "KEYED_COAXIAL" },
      { action: "test", actorIds: [third], targetId: axleId, magnitude: .8 },
      { action: "fetch", actorIds: [first], targetId: ropeId },
      {
        action: "carry", actorIds: [first], targetId: ropeId, targetPort: "resume-grip",
        destination: { x: 4.4, y: .76, z: 1.55 }, orientation: yawQuat(0),
      },
      {
        action: "carry", actorIds: [first], targetId: ropeId, targetPort: "resume-grip",
        destination: { ...ropePose, y: .76 }, orientation: yawQuat(0),
      },
      {
        action: "align", actorIds: [first], targetId: ropeId, targetPort: "assembly-hold",
        destination: ropePose, orientation: yawQuat(0),
      },
      { action: "reeveRope", actorIds: [first], targetId: ropeId, secondaryId: sheaveId, connectionClass: "ROPE_ATTACH" },
      { action: "release", actorIds: [first], targetId: ropeId, targetPort: "hoist-rope-clear", destination: ropePose },
      { action: "reserve", actorIds: [first], targetId: counterweightId },
      { action: "fetch", actorIds: [first, third], targetId: counterweightId },
      { action: "carry", actorIds: [first, third], targetId: counterweightId, destination: counterweightTurn },
      {
        action: "align", actorIds: [first, third], targetId: counterweightId,
        targetPort: "front-side", destination: counterweightTurn, orientation: yawQuat(0),
      },
      {
        action: "carry", actorIds: [first, third], targetId: counterweightId,
        targetPort: "resume-grip", destination: counterweightCarry, orientation: yawQuat(0),
      },
      {
        action: "align", actorIds: [first, third], targetId: counterweightId,
        targetPort: "side-on", destination: { ...counterweightPose, y: .42 }, orientation: yawQuat(0),
      },
      { action: "release", actorIds: [first, third], targetId: counterweightId, targetPort: "hoist-load-clear", destination: counterweightPose },
      { action: "fetch", actorIds: [third], targetId: counterweightId, targetPort: "hoist-hook-approach" },
      { action: "hookRope", actorIds: [third], targetId: ropeId, secondaryId: counterweightId, connectionClass: "ROPE_ATTACH" },
      { action: "tension", actorIds: [third], targetId: ropeId, targetPort: "hoist-tension-stance", magnitude: .62 },
      { action: "test", actorIds: [third], targetId: ropeId, magnitude: 1.1 },
      { action: "reserve", actorIds: [first], targetId: projectileId },
      { action: "fetch", actorIds: [first, second], targetId: projectileId },
      {
        action: "carry", actorIds: [first, second], targetId: projectileId,
        destination: projectilePose, orientation: yawQuat(0),
      },
      { action: "release", actorIds: [first, second], targetId: projectileId, destination: projectilePose },
      { action: "fetch", actorIds: [first, second], targetId: projectileId, targetPort: "gunner-approach" },
      {
        action: "pull", actorIds: [first, second], targetId: projectileId,
        targetPort: "projectile-launch", destination: { x: .1, y: .56, z: projectilePose.z },
        magnitude: 3.6, loadId: targetId, loadTravel: .025,
      },
      { action: "wait", actorIds: [third], targetId: counterweightId, magnitude: 1.2 },
    );
  }
  return option({
    id: "counterweight-sling",
    ruleId: "fire-counterweight-sling",
    team,
    label: "keyed sheave + line + counterweight: sling",
    announcement: "Green keys a sheave, tensions a routed counterweight line, and pulls a wheel projectile through the firing lane.",
    weight: 1.5,
    simpleMachines: ["lever", "pulley", "wheel-and-axle"],
    capabilities: ["launch", "strike"],
    requiredFacts,
    observedFacts,
    parts,
    requests,
  });
}

function holdOneWorkerPart(
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
    {
      action: "align",
      actorIds: [workerId],
      targetId: partId,
      targetPort: "assembly-hold",
      destination: pose,
      orientation,
    },
  ];
}

function machineBayMuster(team: Team, workerIds: readonly string[]): LegalActionRequest[] {
  const direction = team === "king" ? -1 : 1;
  const x = [4.55, 4.71, 4.87];
  const z = [-1.35, 0, 1.35];
  return workerIds.flatMap((workerId, index) => workerId ? [{
    action: "wait" as const,
    actorIds: [workerId],
    destination: { x: direction * (x[index] ?? 4.71), y: .775, z: z[index] ?? 0 },
    magnitude: .35,
  }] : []);
}

function option(
  value: Omit<CompoundPlanOption, "eligible">,
): CompoundPlanOption {
  return {
    ...value,
    baseId: value.baseId ?? value.id as CompoundPlanId,
    eligible: value.requests.length > 0 &&
      value.requiredFacts.every((fact) => value.observedFacts.includes(fact)),
  };
}

function compactFacts(entries: ReadonlyArray<readonly [string, boolean]>): string[] {
  return entries.filter(([, present]) => present).map(([fact]) => fact);
}

function compactParts(entries: Record<string, string | undefined>): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(entries).filter((entry): entry is [string, string] => Boolean(entry[1])));
}

function partByFamily(
  physics: CorePhysicsWorld,
  team: Team,
  family: "wedge" | "plank" | "wheel" | "hub" | "sheave" | "rope" | "drum",
  index: number,
): string | undefined {
  return physics.inventoryIds(team)
    .filter((id) => physics.records.get(id)?.family === family)
    .at(index);
}

function partIsAvailable(physics: CorePhysicsWorld, id: string | undefined): boolean {
  const part = id ? physics.records.get(id) : undefined;
  return Boolean(part?.dynamic && part.kind === "part" && !part.carriedBy);
}

function partsAreOutsideSiegeLanes(
  physics: CorePhysicsWorld,
  beamId: string | undefined,
  hubId: string | undefined,
): boolean {
  const positions = [beamId, hubId].map((id) => id ? physics.bodyPosition(id) : undefined);
  return positions.every((position) => Boolean(position && (
    Math.abs(position.x) < 2.1 || Math.abs(position.x) > 5.8
  )));
}

function yawQuat(radians: number): Quat {
  return { x: 0, y: Math.sin(radians / 2), z: 0, w: Math.cos(radians / 2) };
}

function xQuat(radians: number): Quat {
  return { x: Math.sin(radians / 2), y: 0, z: 0, w: Math.cos(radians / 2) };
}

function multiplyQuat(first: Quat, second: Quat): Quat {
  return {
    x: first.w * second.x + first.x * second.w + first.y * second.z - first.z * second.y,
    y: first.w * second.y - first.x * second.z + first.y * second.w + first.z * second.x,
    z: first.w * second.z + first.x * second.y - first.y * second.x + first.z * second.w,
    w: first.w * second.w - first.x * second.x - first.y * second.y - first.z * second.z,
  };
}

function addVec(first: Vec3, second: Vec3, y: number): Vec3 {
  return { x: first.x + second.x, y, z: first.z + second.z };
}

function scaleVec(vector: Vec3, scalar: number): Vec3 {
  return { x: vector.x * scalar, y: vector.y * scalar, z: vector.z * scalar };
}
