import type { ConnectionClass } from "./machines.js";
export { CONNECTION_CLASSES } from "./machines.js";
export type { ConnectionClass } from "./machines.js";

export const CORE_MODE = "legibility-lab" as const;
export const CORE_FIXED_DT = 1 / 60;
export const CORE_SNAPSHOT_HZ = 20;
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
  nextMoveIn: number;
  outcome?: "king" | "queen" | "draw";
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
