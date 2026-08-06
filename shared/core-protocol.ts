import type { ConnectionClass } from "./machines.js";
export { CONNECTION_CLASSES } from "./machines.js";
export type { ConnectionClass } from "./machines.js";

export const CORE_MODE = "siege" as const;
export const CORE_FIXED_DT = 1 / 60;
export const CORE_SNAPSHOT_HZ = 20;
export const CORE_MATCH_DURATION_SECONDS = 10 * 60;
export const CORE_STAGE = {
  width: 18.4,
  depth: 10,
  floorThickness: 0.5,
  backWallZ: -5.25,
} as const;

export type Team = "king" | "queen";
export type PartFamily =
  | "beam"
  | "hub"
  | "axle"
  | "wheel"
  | "sheave"
  | "drum"
  | "plank"
  | "rope"
  | "wedge";

export type CoreBodyKind =
  | "floor"
  | "wall"
  | "rack"
  | "tower-block"
  | "cradle"
  | "humpty"
  | "worker"
  | "part"
  | "battle-machine"
  | "battle-projectile"
  | "queen-device"
  | "queen-bolt";

export type CoreShape =
  | "box"
  | "round-box"
  | "sphere"
  | "capsule"
  | "cylinder"
  | "cradle"
  | "humpty"
  | "rope-coil"
  | "wedge";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface CoreBodyState {
  id: string;
  kind: CoreBodyKind;
  shape: CoreShape;
  position: Vec3;
  rotation: Quat;
  size: Vec3;
  dynamic: boolean;
  sleeping: boolean;
  team?: Team;
  family?: PartFamily;
  variant?: string;
  course?: number;
  lane?: number;
  axis?: "x" | "z";
  stored?: boolean;
  carriedBy?: string[];
  integrity?: number;
}

export type WorkerPhase =
  | "idle"
  | "routing"
  | "reaching"
  | "grasping"
  | "carrying"
  | "staging"
  | "aligning"
  | "fastening"
  | "testing"
  | "pulling"
  | "pushing"
  | "climbing"
  | "holding"
  | "step-clear";

export interface WorkerState {
  id: string;
  name: string;
  team: Team;
  phase: WorkerPhase;
  action?: LegalActionName;
  targetId?: string;
  destination?: Vec3;
  facing: Vec3;
  reservedWorkPose?: string;
}

export interface ConnectionState {
  id: string;
  class: ConnectionClass;
  bodyA: string;
  bodyB: string;
  actorIds: string[];
  createdTick: number;
  tested: boolean;
  tension?: number;
  slack?: number;
}

export type LegalActionName =
  | "reserve"
  | "fetch"
  | "climb"
  | "carry"
  | "assistCarry"
  | "stage"
  | "hold"
  | "align"
  | "connect"
  | "hookRope"
  | "reeveRope"
  | "tension"
  | "push"
  | "pull"
  | "turn"
  | "test"
  | "operate"
  | "strike"
  | "release"
  | "detach"
  | "recover"
  | "wait"
  | "cancel";

export interface LegalActionRequest {
  action: LegalActionName;
  actorIds: string[];
  targetId?: string;
  secondaryId?: string;
  destination?: Vec3;
  orientation?: Quat;
  targetPort?: string;
  secondaryPort?: string;
  connectionClass?: ConnectionClass;
  magnitude?: number;
  loadId?: string;
  loadTravel?: number;
}

export interface ActivityEvent {
  id: string;
  tick: number;
  elapsed: number;
  actorId?: string;
  team?: Team;
  text: string;
  technical?: string;
}

export interface TransformWriteRecord {
  bodyId: string;
  callSite: string;
  tick: number;
  oldPosition: Vec3;
  requestedPosition: Vec3;
  classification: "initialization" | "snapshot-render" | "illegal-gameplay";
}

export interface CoreDiagnostics {
  physicsAdapter: "rapier3d";
  physicsWorlds: 1;
  units: "m-kg-s-N-Nm";
  fixedHz: 60;
  dynamicBodies: number;
  activeJoints: number;
  jointsByClass: Record<ConnectionClass, number>;
  towerBodies: number;
  inventoryByTeam: Record<Team, number>;
  illegalTransformWrites: number;
  workerPenetrations: number;
  deepBodyPenetrations: number;
  carriedPartPenetrations: number;
  lateCreatedInventory: number;
  renderPoseDivergence: number;
  humptyCradleContacts: number;
  cradleTowerContacts: number;
  humptyVisibleSupportGap: number;
  llmEnabled: boolean;
  lastWrite?: TransformWriteRecord;
}

export interface CoreMatchState {
  driver: "llm" | "mock" | "manual";
  status: "waiting" | "active" | "complete" | "manual";
  phase: "muster" | "advance" | "contest" | "complete" | "manual";
  urgency: "opening" | "siege" | "desperate" | "last-minute" | "complete" | "manual";
  timeRemaining: number;
  moves: number;
  busyWorkers: number;
  kingObjective: string;
  queenObjective: string;
  rulebookSize: number;
  activeRuleIds: Record<string, string>;
  applicableRuleIds: Record<string, string[]>;
  machinePlans: Record<Team, string>;
  machinePlanOptions: Record<Team, MachinePlanOptionState[]>;
  selectedMachinePlanIds: Partial<Record<Team, string>>;
  machineEvidence: string[];
  queenAdvantage: QueenAdvantageState;
  battle?: BattleState;
  nextMoveIn: number;
  outcome?: "king" | "queen" | "draw";
}

export type BattleChainStage =
  | "choosing"
  | "crewing"
  | "operating"
  | "impact"
  | "assessing"
  | "recovering"
  | "idle";

export interface BattleChainState {
  tacticId: string;
  title: string;
  intent: string;
  machineId: string;
  machineName: string;
  targetId: string;
  targetName: string;
  stage: BattleChainStage;
  stageLabel: string;
  progress: number;
  utility: number;
  lastResult: string;
  simpleMachines: string[];
}

export interface BattleMachineState {
  id: string;
  team: Team;
  role: "war" | "rescue";
  name: string;
  purpose: string;
  simpleMachines: string[];
  integrity: number;
  charges: number;
  maxCharges: number;
  state: "ready" | "moving" | "working" | "returning" | "spent" | "disabled";
}

export type BattleUnitId =
  | "red-engineers"
  | "red-rescue-winch"
  | "red-catch-sledge"
  | "green-battering-ram"
  | "green-stone-thrower"
  | "green-ballista";

export type BattleTargetId = "foundation" | "tower-face" | "humpty" | "enemy-machine";

export type BattleOrderAction =
  | "hold"
  | "breach"
  | "bombard"
  | "snipe"
  | "fortify"
  | "reposition"
  | "deploy"
  | "raid";

export interface BattleUnitState {
  id: BattleUnitId;
  team: Team;
  name: string;
  role: string;
  purpose: string;
  integrity: number;
  maxIntegrity: number;
  ammunition: number;
  maxAmmunition: number;
  cooldown: number;
  state: "ready" | "committed" | "recovering" | "spent" | "disabled";
  availableActions: BattleOrderAction[];
  availableTargets: BattleTargetId[];
}

export interface BattleTargetState {
  id: Exclude<BattleTargetId, "enemy-machine">;
  name: string;
  integrity: number;
  maxIntegrity: number;
  protection: number;
  status: "secure" | "damaged" | "critical" | "destroyed";
}

export interface BattleOrderState {
  team: Team;
  unitId: BattleUnitId;
  unitName: string;
  action: BattleOrderAction;
  targetId: BattleTargetId;
  targetName: string;
  status: "sealed" | "revealed" | "resolved";
  result: string;
  hit?: boolean;
  damage?: number;
  resolvedTargetId?: string;
}

export interface BattleRoundRecord {
  round: number;
  clock: string;
  kingOrder: BattleOrderState;
  queenOrder: BattleOrderState;
  summary: string;
}

export interface BattleState {
  round: number;
  maxRounds: number;
  phase: "planning" | "reveal" | "resolving" | "aftermath" | "complete";
  phaseProgress: number;
  timeRemaining: number;
  towerStress: number;
  humptyRisk: number;
  tempo: "opening" | "pressing" | "critical" | "last-stand" | "complete";
  chains: Record<Team, BattleChainState>;
  machines: BattleMachineState[];
  units: BattleUnitState[];
  targets: BattleTargetState[];
  sealedTeams: Team[];
  orders: Partial<Record<Team, BattleOrderState>>;
  history: BattleRoundRecord[];
  doctrine: Record<Team, string>;
  catchReady: boolean;
  humptyPosition: "crown" | "sheltered" | "exposed";
}

export interface QueenAdvantageState {
  deviceId: string;
  deviceIntegrity: number;
  charges: number;
  maxCharges: number;
  armed: boolean;
  disabled: boolean;
  firedBoltIds: string[];
}

export interface MachinePlanOptionState {
  id: string;
  ruleId: string;
  label: string;
  eligible: boolean;
  observedFacts: string[];
  missingFacts: string[];
}

export interface CoreSnapshot {
  type: "core-snapshot";
  mode: typeof CORE_MODE;
  build: string;
  seed: number;
  tick: number;
  elapsed: number;
  paused: boolean;
  timeScale: number;
  bodies: CoreBodyState[];
  workers: WorkerState[];
  connections: ConnectionState[];
  events: ActivityEvent[];
  diagnostics: CoreDiagnostics;
  match: CoreMatchState;
  completedFixtures: string[];
  selectedFixture?: string;
}

export interface ReplaySummary {
  id: string;
  seed: number;
  build: string;
  driver: CoreMatchState["driver"];
  status: CoreMatchState["status"];
  outcome?: CoreMatchState["outcome"];
  duration: number;
  frameCount: number;
  createdAt: string;
  live: boolean;
}

export interface ReplayArchiveEntry {
  summary: ReplaySummary;
  frames: CoreSnapshot[];
}

export type CoreClientCommand =
  | { type: "pause"; paused?: boolean }
  | { type: "reset"; seed?: number }
  | { type: "time-scale"; value: number }
  | { type: "debug-poke"; bodyId?: string; impulse?: Vec3 }
  | { type: "legal-action"; request: LegalActionRequest }
  | {
      type: "battle-order";
      team: Team;
      unitId: BattleUnitId;
      action: BattleOrderAction;
      targetId: BattleTargetId;
    }
  | { type: "run-fixture"; fixture: "lever" | "ramp" | "ram" | "hoist" | "transport" | "failure" };

export const LEGAL_ACTIONS: readonly LegalActionName[] = [
  "reserve",
  "fetch",
  "climb",
  "carry",
  "assistCarry",
  "stage",
  "hold",
  "align",
  "connect",
  "hookRope",
  "reeveRope",
  "tension",
  "push",
  "pull",
  "turn",
  "test",
  "operate",
  "strike",
  "release",
  "detach",
  "recover",
  "wait",
  "cancel",
] as const;
