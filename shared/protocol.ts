export type Team = "king" | "queen" | "humpty";
export type WeaponType = "pike" | "crossbow";

export type MoveAction = { type: "move"; x: number; y?: number };
export type ClimbAction = { type: "climb"; targetId: string };
export type PlacePlankAction = {
  type: "place_plank";
  x: number;
  y: number;
  angle: number;
};
export type PlaceItemAction = {
  type: "place_item";
  itemId: string;
  x: number;
  y: number;
  angle: number;
};
export type StartProjectAction = {
  type: "start_project";
  blueprintId:
    | "skid"
    | "cart"
    | "lever"
    | "screw_jack"
    | "mast"
    | "brace"
    | "ladder"
    | "winch"
    | "pulley"
    | "sling"
    | "spring_trap"
    | "barricade";
};
export type FitItemAction = {
  type: "fit_item";
  itemId: string;
  targetId: string;
};
export type OperateAction = {
  type: "operate";
  targetId: string;
  effort: number;
};
export type ShiftWeightAction = {
  type: "shift_weight";
  direction: -1 | 0 | 1;
  effort: number;
};
export type AttachRopeAction = {
  type: "attach_rope";
  fromId: string;
  toId: string;
};
export type CutRopeAction = { type: "cut_rope"; ropeId: string };
export type CarryAction = { type: "carry"; targetId: string };
export type PushAction = {
  type: "push";
  targetId: string;
  dir: -1 | 1;
};
export type ThrowAction = {
  type: "throw";
  targetId: string;
  angle: number;
  power: number;
};
export type UseWeaponAction = {
  type: "use_weapon";
  weapon: WeaponType;
  targetId: string;
};
export type SnapAction = {
  type: "snap";
  partId: string;
  targetId: string;
};
export type ConnectAction = {
  type: "connect";
  partId: string;
  targetId: string;
};
export type DetachAction = {
  type: "detach";
  partId: string;
};
export type TestAssemblyAction = {
  type: "test";
  partId: string;
  effort: number;
};
export type SabotageAction = {
  type: "sabotage";
  connectionId: string;
  method: "pull" | "strike" | "cut" | "jam";
};
export type RepairAction = {
  type: "repair";
  connectionId: string;
};
export type RecoverAction = {
  type: "recover";
  partId: string;
};
export type UseAssemblyAction = {
  type: "use_assembly";
  partId: string;
  targetId: string;
  effort: number;
};
export type WaitAction = { type: "wait" };

export type AgentAction =
  | MoveAction
  | ClimbAction
  | PlacePlankAction
  | PlaceItemAction
  | StartProjectAction
  | FitItemAction
  | OperateAction
  | ShiftWeightAction
  | AttachRopeAction
  | CutRopeAction
  | CarryAction
  | PushAction
  | ThrowAction
  | UseWeaponAction
  | SnapAction
  | ConnectAction
  | DetachAction
  | TestAssemblyAction
  | SabotageAction
  | RepairAction
  | RecoverAction
  | UseAssemblyAction
  | WaitAction;

export interface AgentSubmission {
  say?: string;
  action: AgentAction;
}

export type EntityKind =
  | "ground"
  | "plinth"
  | "block"
  | "seat"
  | "humpty"
  | "king"
  | "queen"
  | "man"
  | "limb"
  | "plank"
  | "stone"
  | "rope"
  | "machine"
  | "component";

export type MachinePart =
  | "beam"
  | "cart"
  | "lever"
  | "screw"
  | "spring"
  | "ladder"
  | "winch"
  | "pulley";

export type ComponentType =
  | "timber"
  | "rail"
  | "rung"
  | "brace"
  | "crossbeam"
  | "axle"
  | "drum"
  | "bar"
  | "pawl"
  | "cheek"
  | "sheave"
  | "wheel"
  | "gear"
  | "spring"
  | "fulcrum"
  | "screw"
  | "nut"
  | "saddle"
  | "trigger"
  | "counterweight"
  | "platform"
  | "pin"
  | "hook"
  | "fastener"
  | "lashing"
  | "canvas";

export type ConnectionType =
  | "peg"
  | "lash"
  | "dog"
  | "bolt"
  | "pin"
  | "socket"
  | "hook"
  | "wedge"
  | "scarf"
  | "stitch"
  | "bearing"
  | "thread"
  | "catch";

export type AssemblyState = "stock" | "carried" | "staged" | "installed";

export type WorkOperation =
  | "fetch"
  | "carry"
  | "snap"
  | "measure"
  | "saw"
  | "bore"
  | "position"
  | "peg"
  | "lash"
  | "wedge"
  | "mount"
  | "raise"
  | "inspect"
  | "stitch"
  | "grease"
  | "shape"
  | "forge"
  | "temper"
  | "thread"
  | "tension"
  | "reeve";

export type AgentActivity =
  | "idle"
  | "march"
  | "build"
  | "climb"
  | "fight"
  | "aim"
  | "rig"
  | "haul"
  | "guard"
  | "carry"
  | "measure"
  | "saw"
  | "bore"
  | "hammer"
  | "forge"
  | "thread"
  | "tension"
  | "lash"
  | "lift"
  | "inspect";

export interface TransformState {
  id: string;
  kind: EntityKind;
  team?: Team;
  ownerId?: string;
  part?: "head" | "arm-left" | "arm-right" | "leg-left" | "leg-right";
  machinePart?: MachinePart;
  componentType?: ComponentType;
  projectId?: string;
  assemblyState?: AssemblyState;
  connectionType?: ConnectionType;
  activity?: AgentActivity;
  harnessed?: boolean;
  righting?: boolean;
  buildProgress?: number;
  buildStage?: string;
  material?: string;
  taskOperation?: WorkOperation;
  taskProgress?: number;
  weapon?: WeaponType;
  taskTargetId?: string;
  carryingId?: string;
  tool?: string;
  x: number;
  y: number;
  angle: number;
  width?: number;
  height?: number;
  radius?: number;
  stress?: number;
  integrity?: number;
  alive?: boolean;
  vx?: number;
  vy?: number;
  fromX?: number;
  fromY?: number;
  toX?: number;
  toY?: number;
  progress?: number;
  puzzleKind?: string;
  puzzleLabel?: string;
  puzzleDepth?: number;
  puzzleYaw?: number;
  snapPorts?: PuzzlePortState[];
  connectedTo?: string[];
  capabilities?: string[];
  mass?: number;
  lifecycleState?: string;
  reservedBy?: string;
  connectionIntegrity?: number;
  connectionLoad?: number;
  connectionState?: string;
}

export interface SpeechLine {
  turn: number;
  agentId: string;
  name: string;
  team: Team;
  text: string;
  at: number;
  elapsed: number;
}

export interface PublicAgent {
  id: string;
  name: string;
  team: Team;
  alive: boolean;
  integrity: number;
}

export type SoundCueType =
  | "footstep"
  | "hammer"
  | "rope"
  | "throw"
  | "shove"
  | "climb"
  | "impact"
  | "fall"
  | "crack"
  | "winch"
  | "splat";

export interface SoundCue {
  id: number;
  type: SoundCueType;
  team?: Team;
  intensity: number;
  x: number;
  at: number;
  weapon?: WeaponType;
  targetId?: string;
}

export type MatchBeat = "layout" | "build" | "contest" | "decisive";

export interface TeamWorkStatus {
  label: string;
  detail: string;
  progress: number;
}

export interface ServerSnapshot {
  type: "snapshot";
  seed: number;
  turn: number;
  phase: "running" | "deliberating" | "paused" | "ended";
  phaseEndsAt: number | null;
  elapsed: number;
  entities: TransformState[];
  speech: SpeechLine[];
  soundCues: SoundCue[];
  agents: PublicAgent[];
  humptyHeight: number;
  humptyIntegrity: number;
  deaths: { king: number; queen: number };
  aggregateStress: number;
  winner: Team | "draw" | null;
  outcome: string | null;
  runId: string;
  puzzleMode: boolean;
  matchBeat: MatchBeat;
  beatCopy: string;
  workStatus: {
    king: TeamWorkStatus;
    queen: TeamWorkStatus;
  };
  snapPreviews: PuzzleSnapPreview[];
  snapEvents: PuzzleSnapEvent[];
  simulationTick: number;
  stateChecksum: string;
  physicsDiagnostics?: PhysicsDiagnosticsState;
}

export interface PhysicsDiagnosticsState {
  fixedTick: number;
  dynamicBodyCount: number;
  activeConstraintCount: number;
  workerPenetration: number;
  workerPenetrationDetails?: string[];
  deepBodyPenetrations: number;
  illegalTransformWrites: number;
  spawnedAfterStartInventory: number;
  humptySupportContacts: number;
  towerContactCount: number;
  currentPartLifecycle: string;
}

export interface ReplayManifestEntry {
  runId: string;
  seed: number;
  model: string;
  elapsed: number;
  winner: Team | "draw" | null;
  outcome: string | null;
  frameCount: number;
  current: boolean;
}

export interface ReplayBundle extends ReplayManifestEntry {
  version: 1;
  frames: ServerSnapshot[];
}

export type ClientCommand =
  | { type: "command"; command: "pause" }
  | { type: "command"; command: "resume" }
  | { type: "command"; command: "poke"; targetId?: string }
  | { type: "command"; command: "restart" };

export interface NearbyBody {
  id: string;
  kind: EntityKind;
  x: number;
  y: number;
  distance: number;
  integrity?: number;
  buildProgress?: number;
  componentType?: ComponentType;
  assemblyState?: AssemblyState;
}

export interface InventoryItem {
  id: string;
  name: string;
  material: string;
  quantity: number;
  affordances: string[];
  constraints: string[];
}

export interface PuzzlePortState {
  id: string;
  kind: string;
  accepts: string[];
  x: number;
  y: number;
  depth: number;
  normal: number;
  occupiedBy?: string;
  connectionId?: string;
  connectionIntegrity?: number;
  connectionLoad?: number;
  connectionState?: string;
}

export interface PuzzleSnapPreview {
  workerId: string;
  team: "king" | "queen";
  movingId: string;
  movingLabel: string;
  movingPort: string;
  movingPortKind: string;
  targetId: string;
  targetLabel: string;
  targetPort: string;
  targetPortKind: string;
  phase:
    | "fetch_target"
    | "stage_target"
    | "fetch"
    | "carry"
    | "snap"
    | "release"
    | "test"
    | "retreat";
  progress: number;
  targetX: number;
  targetY: number;
  targetAngle: number;
  targetDepth: number;
  gainedCapabilities: string[];
  resultCapabilities: string[];
}

export interface PuzzleSnapEvent {
  id: string;
  at: number;
  workerId: string;
  team: "king" | "queen";
  movingLabel: string;
  targetLabel: string;
  movingPortKind: string;
  targetPortKind: string;
  targetId: string;
  x: number;
  y: number;
  depth: number;
  gainedCapabilities: string[];
  resultCapabilities: string[];
}

export interface PuzzlePartState {
  id: string;
  label: string;
  componentType: ComponentType;
  material: string;
  mass: number;
  x: number;
  y: number;
  ports: PuzzlePortState[];
  affordances: string[];
  constraints: string[];
  capabilities: string[];
  connectedTo: string[];
  lifecycleState: string;
  integrity: number;
}

export interface PuzzleAssemblyState {
  id: string;
  partIds: string[];
  capabilities: string[];
  mass: number;
  stability: number;
  freePorts: number;
  supportMargin?: number;
  failureMargin?: number;
  warnings?: string[];
}

export interface AgentState {
  turn: number;
  elapsed: number;
  goals: string[];
  self: {
    id: string;
    x: number;
    y: number;
    integrity: number;
    weapon?: WeaponType;
  };
  humpty: {
    x: number;
    y: number;
    height: number;
    integrity: number;
    cracked: boolean;
  };
  teammates: Array<{ id: string; x: number; y: number; integrity: number }>;
  opponents: Array<{ id: string; x: number; y: number; integrity: number }>;
  nearby: NearbyBody[];
  projects: Array<{
    id: string;
    blueprintId: string;
    workerId: string;
    team: Team;
    progress: number;
    stage: string;
    complete: boolean;
    mechanisms?: Array<{
      id: string;
      label: string;
      primitive: string;
      capability: string;
      input: string;
      output: string;
      dependsOn: string[];
      commissioning: string;
      mechanicalAdvantage: number;
      efficiency: number;
      ready: boolean;
    }>;
  }>;
  currentTask?: {
    projectId: string;
    componentId: string;
    componentLabel: string;
    componentType?: ComponentType;
    operation: WorkOperation;
    progress: number;
  };
  connections: string[];
  supply: {
    planks: number;
    ropes: number;
    stones: number;
    pikes: number;
    crossbows: number;
    bolts: number;
  };
  inventory: InventoryItem[];
  parts?: PuzzlePartState[];
  assemblies?: PuzzleAssemblyState[];
  opponentAssemblies?: PuzzleAssemblyState[];
  speech: Array<{ turn: number; name: string; text: string }>;
}
