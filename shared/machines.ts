export type PortKind =
  | "rigid_peg"
  | "rigid_socket"
  | "axle_shaft"
  | "bearing_bore"
  | "key_flat"
  | "keyway"
  | "hook"
  | "load_eye"
  | "rope_end"
  | "cleat"
  | "sheave_groove"
  | "ground_foot";

export type ConnectionClass =
  | "TENON_LOCK"
  | "AXLE_BEARING"
  | "KEYED_COAXIAL"
  | "ROPE_ATTACH";

export type PrimitiveClass = "fundamental" | "extension" | "omit";
export type PartLifecycleState =
  | "stored"
  | "reserved"
  | "being_fetched"
  | "carried"
  | "staged"
  | "supported"
  | "aligning"
  | "connected"
  | "tested"
  | "operating"
  | "detached"
  | "damaged"
  | "dropped"
  | "recoverable"
  | "stored_or_reused";

export interface Vector3Data {
  x: number;
  y: number;
  z: number;
}

export interface PortPoseData {
  position: Vector3Data;
  normal: Vector3Data;
  tangent: Vector3Data;
  rotationalSymmetry: number;
}

export interface MaterialDefinition {
  id: string;
  label: string;
  density: number;
  friction: number;
  restitution: number;
  linearDamping: number;
  angularDamping: number;
  credibility: "attested" | "plausible" | "game_abstraction";
  appearance: string;
}

export interface PortTypeDefinition {
  id: PortKind;
  label: string;
  primitiveClass: PrimitiveClass;
  visual: string;
  transmits: Array<"tension" | "compression" | "shear" | "torque">;
}

export interface PartPortDefinition {
  id: string;
  kind: PortKind;
  pose: PortPoseData;
}

export interface PartDefinitionData {
  id: string;
  label: string;
  componentType: string;
  primitiveClass: PrimitiveClass;
  materialId: string;
  mass: number;
  dimensions: { width: number; height: number; depth: number; radius?: number };
  handling: { workers: number; clearance: number; maxCarrySpeed: number };
  ports: PartPortDefinition[];
  affordances: string[];
  nonAffordances: string[];
  intrinsicCapabilities: string[];
}

export interface CompatibilityRule {
  class: ConnectionClass;
  first: PortKind;
  second: PortKind;
  directional: boolean;
  joint: "fixed" | "revolute" | "rope";
  tolerance: { distance: number; angleDegrees: number };
  action: { workers: number; duration: number; supportRequired: boolean };
  dofBefore: string[];
  dofAfter: string[];
  compliance: number;
  backlash: number;
  damping: number;
  friction: number;
  safeLoad: number;
  warningLoad: number;
  breakForce: number;
  breakTorque: number;
  detachUnderLoad: boolean;
  failureState: "broken" | "bent" | "pulled_out" | "slipped" | "detached";
}

export interface OpeningInventoryEntry {
  definitionId: string;
  quantity: number;
}

export interface OpeningInventoryDefinition {
  version: number;
  countPerTeam: number;
  entries: OpeningInventoryEntry[];
}

export interface MachineGrammarData {
  materials: MaterialDefinition[];
  portTypes: PortTypeDefinition[];
  parts: PartDefinitionData[];
  compatibility: CompatibilityRule[];
  inventory: OpeningInventoryDefinition;
}

export interface AssemblyConnectionState {
  id: string;
  firstPartId: string;
  firstPortId: string;
  secondPartId: string;
  secondPortId: string;
  joint: CompatibilityRule["joint"];
  integrity: number;
  currentLoad: number;
  state: "aligning" | "locked" | "loaded" | "slipping" | "binding" | "yielding" | "failed";
  failureState?: CompatibilityRule["failureState"];
}

export interface DerivedCapability {
  id: string;
  confidence: number;
  inputPortId: string;
  outputPortId: string;
  expectedDirection: Vector3Data;
  ratio: number;
  currentLoad: number;
  clearance: number;
  stability: number;
  failureMargin: number;
  evidence: string[];
}

export interface AssemblyObservation {
  id: string;
  partIds: string[];
  connectionIds: string[];
  mass: number;
  centerOfMass: Vector3Data;
  supportMargin: number;
  capabilities: DerivedCapability[];
  warnings: string[];
}

export interface InventoryLedgerEntry {
  partId: string;
  definitionId: string;
  owner: "king" | "queen";
  state: PartLifecycleState;
  reservedBy?: string;
  carriedBy?: string;
  assemblyId?: string;
  integrity: number;
  actionHistory: string[];
}

export type ConstructionAction =
  | { type: "reserve"; partId: string }
  | { type: "fetch"; partId: string }
  | { type: "carry"; partId: string; x: number; y: number }
  | { type: "support"; partId: string }
  | { type: "stage"; partId: string; x: number; y: number }
  | { type: "align"; partId: string; partPortId: string; targetId: string; targetPortId: string }
  | { type: "connect"; partId: string; partPortId: string; targetId: string; targetPortId: string }
  | { type: "anchor"; partId: string; targetId: string }
  | { type: "reeve"; ropeId: string; throughPartId: string; throughPortId: string }
  | { type: "tension"; assemblyId: string; effort: number }
  | { type: "load"; assemblyId: string; loadId: string }
  | { type: "test"; assemblyId: string; effort: number }
  | { type: "operate"; assemblyId: string; targetId: string; effort: number }
  | { type: "detach"; partId: string; connectionId?: string }
  | { type: "guard"; targetId: string }
  | { type: "block"; x: number; y: number }
  | { type: "strike"; targetId: string; effort: number }
  | { type: "sabotage"; connectionId: string; method: "pull" | "strike" | "cut" | "jam" }
  | { type: "repair"; connectionId: string }
  | { type: "recover"; partId: string }
  | { type: "release"; partId: string }
  | { type: "cancel"; partId: string };

export interface ConstructionReplayEvent {
  tick: number;
  elapsed: number;
  actorId: string;
  action: ConstructionAction;
  accepted: boolean;
  reason?: string;
  checksum: string;
}

export interface BenchmarkDefinition {
  id: string;
  category: "connection" | "simple_machine" | "reasoning" | "replay" | "performance";
  description: string;
  pass: { metric: string; operator: ">=" | "<=" | "=="; value: number };
}

export interface BenchmarkResult {
  benchmarkId: string;
  seed: number;
  metric: string;
  value: number;
  passed: boolean;
  durationMs: number;
}
