import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import RAPIER from "@dimforge/rapier2d-compat";
import type {
  AgentActivity,
  AgentState,
  AgentSubmission,
  AssemblyState,
  ClientCommand,
  ComponentType,
  ConnectionType,
  EntityKind,
  InventoryItem,
  MachinePart,
  MatchBeat,
  PhysicsDiagnosticsState,
  PublicAgent,
  PuzzleSnapEvent,
  PuzzleSnapPreview,
  ReplayBundle,
  ReplayManifestEntry,
  ServerSnapshot,
  SoundCue,
  SoundCueType,
  SpeechLine,
  Team,
  TeamWorkStatus,
  TransformState,
  WeaponType,
  WorkOperation,
} from "../shared/protocol.js";
import type {
  InventoryLedgerEntry,
  PartLifecycleState,
} from "../shared/machines.js";
import {
  AGENTS,
  type AgentDefinition,
  type AgentDriver,
  type StagePose,
  type TeamAgentState,
  type TeamAgentSubmission,
  type WorkerTeam,
} from "./agents.js";
import { validateSubmission } from "./actions.js";
import { SeededRandom } from "./random.js";
import {
  createBlueprint,
  WORK_DURATION,
  type BlueprintId,
  type BlueprintPlan,
  type ComponentPlan,
  type MechanismStage,
} from "./construction.js";
import {
  connectionRule,
  gameplayPuzzleCatalog,
  portsCompatible,
  puzzlePortPose,
  summarizeAssembly,
  type PuzzleAssemblySummary,
  type PuzzleConnectionView,
  type PuzzlePartInstance,
} from "./puzzle.js";

const WORLD_WIDTH = 1200;
const WORLD_HEIGHT = 760;
const GROUND_HEIGHT = 30;
const TOWER_X = 600;
const TOWER_LAYERS = 12;
const TOWER_BLOCKS_PER_LAYER = 3;
const TOWER_BLOCKS = TOWER_LAYERS * TOWER_BLOCKS_PER_LAYER;
const TOWER_BLOCK_LENGTH = 174;
const TOWER_BLOCK_WIDTH = 58;
const TOWER_BLOCK_HEIGHT = 36;
const TOWER_BLOCK_MASS = 7;
const TOWER_PLINTH_WIDTH = 194;
const TOWER_PLINTH_HEIGHT = 8;
const TOWER_BASE_Y = GROUND_HEIGHT + TOWER_PLINTH_HEIGHT;
const TOWER_SEAT_WIDTH = 160;
const TOWER_SEAT_HEIGHT = 12;
const TOWER_TOP =
  TOWER_BASE_Y + TOWER_LAYERS * TOWER_BLOCK_HEIGHT + TOWER_SEAT_HEIGHT;
const FIXED_STEP = 1 / 60;
const TURN_SECONDS = 10;
const MAX_TURNS = 60;
const GAME_SECONDS = 10 * 60;
const BUILD_BEAT_AT = 75;
const CONTEST_BEAT_AT = 180;
const DECISIVE_BEAT_AT = 300;
const REAL_AGENT_TIMEOUT_MS = 12_000;
const REAL_TEAM_TIMEOUT_MS = 12_000;
const STAGE_DEPTH_SCALE = 45;
const STAGE_DEPTH_MIN = -360;
const STAGE_DEPTH_MAX = 360;
const FLOOR_DEPTH_MIN = STAGE_DEPTH_MIN / STAGE_DEPTH_SCALE;
const FLOOR_DEPTH_MAX = STAGE_DEPTH_MAX / STAGE_DEPTH_SCALE;
const PUZZLE_DEPTH_CLEARANCE = 0.34;
const WORKER_SPEED = 118;
const WORKER_DEPTH_SPEED = 5.6;
const REPLAY_FRAME_SECONDS = 0.5;
const MAN_DAMAGE_THRESHOLD = 28;
const HUMPTY_DAMAGE_THRESHOLD = 40;
const HUMPTY_FALL_SPEED = -380;
const STRONG_PROJECTILE_SPEED = 540;
const MAX_SPEECH = 320;
const MAX_SOUND_CUES = 96;
const MEN_MEMBERSHIP_MASK = 0x007e;
const TOWER_MEMBERSHIP = 1 << 14;
const TOWER_COLLISION_GROUPS =
  ((TOWER_MEMBERSHIP << 16) | 0xffff) >>> 0;
const STOCK_COLLISION_GROUPS = (((1 << 13) << 16) | 0x0001) >>> 0;
const PUZZLE_MEMBERSHIP = 1 << 13;
const PUZZLE_COLLISION_GROUPS =
  ((PUZZLE_MEMBERSHIP << 16) | 0x0001) >>> 0;
const PROJECTILE_IGNORE_TOWER_GROUPS =
  ((1 << 16) | (0xffff ^ TOWER_MEMBERSHIP)) >>> 0;
let rapierReady: Promise<void> | undefined;

function lowBallisticAngle(
  originX: number,
  originY: number,
  targetX: number,
  targetY: number,
  speed: number,
): number {
  const dx = targetX - originX;
  const distanceX = Math.max(1, Math.abs(dx));
  const dy = targetY - originY;
  const gravity = 650;
  const speedSquared = speed * speed;
  const discriminant =
    speedSquared * speedSquared -
    gravity * (gravity * distanceX * distanceX + 2 * dy * speedSquared);
  if (discriminant <= 0) return Math.atan2(dy, dx);
  const angle = Math.atan(
    (speedSquared - Math.sqrt(discriminant)) / (gravity * distanceX),
  );
  return dx >= 0 ? angle : Math.PI - angle;
}

type Damageable = "humpty" | "man";

interface PhysicsEntity {
  id: string;
  kind: EntityKind;
  body?: RAPIER.RigidBody;
  collider?: RAPIER.Collider;
  team?: Team;
  ownerId?: string;
  part?: "head" | "arm-left" | "arm-right" | "leg-left" | "leg-right";
  machinePart?: MachinePart;
  componentType?: ComponentType;
  componentLabel?: string;
  projectId?: string;
  assemblyState?: AssemblyState;
  connectionType?: ConnectionType;
  width?: number;
  height?: number;
  radius?: number;
  integrity?: number;
  alive?: boolean;
  stress: number;
  movementTarget?: number;
  movementDepthTarget?: number;
  movementPlanGoalX?: number;
  movementPlanGoalDepth?: number;
  movementWaypoints?: Array<{ x: number; depth: number }>;
  combatTarget?: string;
  combatUntil?: number;
  nextCombatAt?: number;
  commandedVelocity?: number;
  activity?: AgentActivity;
  activityUntil?: number;
  climbGoalY?: number;
  climbTargetX?: number;
  constructionTargetId?: string;
  taskOperation?: WorkOperation;
  taskProgress?: number;
  taskTargetId?: string;
  carryingId?: string;
  tool?: string;
  buildProgress?: number;
  buildDuration?: number;
  buildStage?: string;
  material?: string;
  lastBuildCueAt?: number;
  carriedBy?: string;
  sourceX?: number;
  sourceY?: number;
  stagingX?: number;
  stagingY?: number;
  stagingAngle?: number;
  finalX?: number;
  finalY?: number;
  finalAngle?: number;
  operations?: WorkOperation[];
  operationIndex?: number;
  assignedWorkerId?: string;
  placed?: boolean;
  expiresAt?: number;
  equippedWeapon?: WeaponType;
  puzzleDefinition?: PuzzlePartInstance;
  puzzleDepth?: number;
  puzzleYaw?: number;
  puzzleLifecycle?: PartLifecycleState;
  reservedBy?: string;
}

interface PuzzleConnection extends PuzzleConnectionView {
  id: string;
  firstPort: string;
  secondPort: string;
  integrity: number;
  currentLoad: number;
  state: "locked" | "loaded" | "slipping" | "yielding" | "failed";
  joint?: RAPIER.ImpulseJoint;
}

interface PuzzleTask {
  workerId: string;
  helperIds: string[];
  partId: string;
  targetId: string;
  movingIds: string[];
  targetIds: string[];
  firstPort: string;
  secondPort: string;
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
  startedAt: number;
  phaseStartedAt: number;
  buildX: number;
  buildDepth: number;
  snapStart?: PuzzleAssemblyPose[];
  snapFinal?: PuzzleAssemblyPose[];
  blockedSince?: number;
  lastImpactAt?: number;
  targetLifted?: boolean;
  movingLifted?: boolean;
  gainedCapabilities: string[];
  resultCapabilities: string[];
  connectionId?: string;
  testApplied?: boolean;
}

interface PuzzleRecoveryTask {
  workerId: string;
  partId: string;
  phase: "fetch" | "carry" | "settle" | "retreat";
  targetX: number;
  targetDepth: number;
  lifted?: boolean;
}

interface PuzzleAssemblyPose {
  id: string;
  x: number;
  y: number;
  angle: number;
  depth: number;
}

interface PuzzleCommissioning {
  signature: string;
  step: number;
}

interface ConstructionProject {
  plan: BlueprintPlan;
  workerId: string;
  componentIds: string[];
  phase: "components" | "inspect" | "raising" | "mounting" | "complete";
  finalizationProgress: number;
  commissionedStageIds: Set<string>;
  commissioningProgress: number;
  lastCueAt: number;
}

interface RopeEntity {
  id: string;
  kind: "rope";
  fromId: string;
  toId: string;
  joint?: RAPIER.ImpulseJoint;
  maxLength: number;
  team: Team;
  stress: number;
  createdAt: number;
}

interface Supply {
  planks: number;
  ropes: number;
  stones: number;
  timber: number;
  ladders: number;
  pulleys: number;
  capstans: number;
  slings: number;
  wedges: number;
  wheelSets: number;
  leverSets: number;
  screwSets: number;
  springSets: number;
  pikes: number;
  crossbows: number;
  bolts: number;
}

interface ActionResolution {
  accepted: boolean;
  reason?: string;
  entityId?: string;
}

export interface TowerProbeResult {
  blockId: string;
  appliedImpulse: number;
  reactionForce: number;
  blockDisplacement: number;
  neighboringMotion: number;
  towerAngularMotion: number;
  signedSupportMargin: number;
  aborted: boolean;
}

interface IntegrityDelta {
  id: string;
  before: number;
  after: number;
}

interface MotionState {
  speed: number;
  vy: number;
}

interface ContactState {
  impulse: number;
  impactSpeed: number;
  ownVy: number;
  otherId?: string;
  otherSpeed: number;
}

export interface SimulationOptions {
  root: string;
  driver: AgentDriver;
  seed?: number;
}

export class GameSimulation {
  private world!: RAPIER.World;
  private events!: RAPIER.EventQueue;
  private readonly root: string;
  private readonly driver: AgentDriver;
  private entities = new Map<string, PhysicsEntity>();
  private ropes = new Map<string, RopeEntity>();
  private projects = new Map<string, ConstructionProject>();
  private puzzleParts = new Map<string, PuzzlePartInstance>();
  private puzzleLedger = new Map<string, InventoryLedgerEntry>();
  private puzzleConnections: PuzzleConnection[] = [];
  private puzzleTasks = new Map<string, PuzzleTask>();
  private puzzleRecoveryTasks = new Map<string, PuzzleRecoveryTask>();
  private puzzleSnapEvents: PuzzleSnapEvent[] = [];
  private puzzleAssemblyCooldownUntil = new Map<string, number>();
  private puzzleCommissioning = new Map<string, PuzzleCommissioning>();
  private testedPuzzleAssemblies = new Set<string>();
  private openingPuzzleIds = new Set<string>();
  private physicsDiagnosticsTick = -1;
  private physicsDiagnosticsCache: PhysicsDiagnosticsState = {
    fixedTick: 0,
    dynamicBodyCount: 0,
    activeConstraintCount: 0,
    workerPenetration: 0,
    workerPenetrationDetails: [],
    deepBodyPenetrations: 0,
    illegalTransformWrites: 0,
    spawnedAfterStartInventory: 0,
    humptySupportContacts: 0,
    towerContactCount: 0,
    currentPartLifecycle: "opening_inventory",
  };
  private puzzleRescueAssemblyId: string | null = null;
  private puzzleRescueOperatorId: string | null = null;
  private puzzleRescueStartedAt = 0;
  private puzzleRescueStartX = 0;
  private puzzleRescueStartY = 0;
  private puzzleRescueFixtureMode = false;
  private puzzleRescueLoadRopeId: string | null = null;
  private puzzleRescueDriveRopeId: string | null = null;
  private puzzleRescueRopeStartLength = 0;
  private colliderOwners = new Map<number, string>();
  private joints: RAPIER.ImpulseJoint[] = [];
  private simulationTick = 0;
  private towerDisturbed = false;
  private supply: Record<"king" | "queen", Supply> = {
    king: {
      planks: 12,
      ropes: 8,
      stones: 10,
      timber: 6,
      ladders: 2,
      pulleys: 2,
      capstans: 1,
      slings: 2,
      wedges: 6,
      wheelSets: 2,
      leverSets: 2,
      screwSets: 2,
      springSets: 2,
      pikes: 1,
      crossbows: 1,
      bolts: 2,
    },
    queen: {
      planks: 12,
      ropes: 8,
      stones: 10,
      timber: 6,
      ladders: 2,
      pulleys: 2,
      capstans: 1,
      slings: 2,
      wedges: 6,
      wheelSets: 2,
      leverSets: 2,
      screwSets: 2,
      springSets: 2,
      pikes: 1,
      crossbows: 1,
      bolts: 2,
    },
  };
  private speech: SpeechLine[] = [];
  private soundCues: SoundCue[] = [];
  private operationHistory = new Set<WorkOperation>();
  private soundSequence = 0;
  private lastFootstepAt = new Map<string, number>();
  private lastImpactCueAt = new Map<string, number>();
  private turn = 0;
  private elapsed = 0;
  private accumulator = 0;
  private phase: ServerSnapshot["phase"] = "running";
  private phaseEndsAt: number | null = null;
  private lastTickAt = performance.now();
  private deliberating = false;
  private manualPaused = false;
  private winner: Team | "draw" | null = null;
  private outcome: string | null = null;
  private cracked = false;
  private crackCause: "fall" | "projectile" | null = null;
  private rescueStarted = false;
  private rescueControlled = false;
  private rescueReadyAt = 0;
  private rigVelocityX = 0;
  private rigVelocityY = 0;
  private harnessFitted = false;
  private machineOperatingUntil = 0;
  private lastWinchCueAt = -1;
  private lastPokeAnnouncementAt = -Infinity;
  private crackHeight = 0;
  private crackFreezeUntil = 0;
  private pendingWinnerAt = 0;
  private humptyRighting = false;
  private humptyRightingStartedAt = 0;
  private humptyRightingStartAngle = 0;
  private humptyPreStepVy = 0;
  private runId = "";
  private ledgerPath = "";
  private seed = 0;
  private rng!: SeededRandom;
  private plankSequence = 0;
  private boltSequence = 0;
  private machineSequence = 0;
  private ropeSequence = 0;
  private stoneSequence = 0;
  private lastTurnAt = 0;
  private lastTurnIntegrity = new Map<string, number>();
  private activeAgentDecisions = new Set<string>();
  private nextAgentDecisionAt = new Map<string, number>();
  private activeTeamDecisions = new Set<WorkerTeam>();
  private nextTeamDecisionAt = new Map<WorkerTeam, number>();
  private nextLocalInitiativeAt = new Map<string, number>();
  private debugControlledWorkers = new Set<string>();
  private outcomeWritten = false;
  private replayFrames: ServerSnapshot[] = [];
  private nextReplayCaptureAt = 0;
  private replayArchived = false;
  private initialized = false;

  constructor(options: SimulationOptions) {
    this.root = options.root;
    this.driver = options.driver;
    this.seed = options.seed ?? Math.floor(Date.now() % 2_147_483_647);
  }

  async initialize(): Promise<void> {
    if (!this.initialized) {
      rapierReady ??= RAPIER.init();
      await rapierReady;
      this.initialized = true;
    }
    this.createRun(this.seed);
  }

  private createRun(seed: number): void {
    if (this.runId) this.archiveReplay();
    if (this.events) this.events.free();
    if (this.world) this.world.free();

    this.seed = seed;
    this.rng = new SeededRandom(seed);
    this.world = new RAPIER.World({ x: 0, y: -650 });
    this.world.timestep = FIXED_STEP;
    this.world.lengthUnit = 52;
    this.world.numSolverIterations = 12;
    this.world.numAdditionalFrictionIterations = 8;
    this.world.numInternalPgsIterations = 3;
    this.world.maxCcdSubsteps = 4;
    this.events = new RAPIER.EventQueue(true);
    this.entities = new Map();
    this.ropes = new Map();
    this.projects = new Map();
    this.puzzleParts = new Map();
    this.puzzleLedger = new Map();
    this.puzzleConnections = [];
    this.puzzleTasks = new Map();
    this.puzzleRecoveryTasks = new Map();
    this.puzzleAssemblyCooldownUntil = new Map();
    this.puzzleCommissioning = new Map();
    this.testedPuzzleAssemblies = new Set();
    this.openingPuzzleIds = new Set();
    this.physicsDiagnosticsTick = -1;
    this.puzzleRescueAssemblyId = null;
    this.puzzleRescueOperatorId = null;
    this.puzzleRescueStartedAt = 0;
    this.puzzleRescueStartX = 0;
    this.puzzleRescueStartY = 0;
    this.puzzleRescueFixtureMode = false;
    this.puzzleRescueLoadRopeId = null;
    this.puzzleRescueDriveRopeId = null;
    this.puzzleRescueRopeStartLength = 0;
    this.colliderOwners = new Map();
    this.joints = [];
    this.simulationTick = 0;
    this.towerDisturbed = false;
    this.supply = {
      king: {
        planks: 12,
        ropes: 8,
        stones: 10,
        timber: 6,
        ladders: 2,
        pulleys: 2,
        capstans: 1,
        slings: 2,
        wedges: 6,
        wheelSets: 2,
        leverSets: 2,
        screwSets: 2,
        springSets: 2,
        pikes: 1,
        crossbows: 1,
        bolts: 2,
      },
      queen: {
        planks: 12,
        ropes: 8,
        stones: 10,
        timber: 6,
        ladders: 2,
        pulleys: 2,
        capstans: 1,
        slings: 2,
        wedges: 6,
        wheelSets: 2,
        leverSets: 2,
        screwSets: 2,
        springSets: 2,
        pikes: 1,
        crossbows: 1,
        bolts: 2,
      },
    };
    this.speech = [];
    this.soundCues = [];
    this.soundSequence = 0;
    this.boltSequence = 0;
    this.lastFootstepAt = new Map();
    this.lastImpactCueAt = new Map();
    this.turn = 0;
    this.elapsed = 0;
    this.accumulator = 0;
    this.phase = "running";
    this.phaseEndsAt = Date.now() + TURN_SECONDS * 1000;
    this.lastTickAt = performance.now();
    this.deliberating = false;
    this.manualPaused = false;
    this.winner = null;
    this.outcome = null;
    this.cracked = false;
    this.crackCause = null;
    this.rescueStarted = false;
    this.rescueControlled = false;
    this.rescueReadyAt = 0;
    this.rigVelocityX = 0;
    this.rigVelocityY = 0;
    this.harnessFitted = false;
    this.machineOperatingUntil = 0;
    this.lastWinchCueAt = -1;
    this.lastPokeAnnouncementAt = -Infinity;
    this.crackHeight = 0;
    this.crackFreezeUntil = 0;
    this.pendingWinnerAt = 0;
    this.humptyRighting = false;
    this.humptyRightingStartedAt = 0;
    this.humptyRightingStartAngle = 0;
    this.humptyPreStepVy = 0;
    this.plankSequence = 0;
    this.machineSequence = 0;
    this.ropeSequence = 0;
    this.stoneSequence = 0;
    this.lastTurnAt = 0;
    this.activeAgentDecisions = new Set();
    this.nextAgentDecisionAt = new Map();
    this.activeTeamDecisions = new Set();
    this.nextTeamDecisionAt = new Map();
    this.nextLocalInitiativeAt = new Map();
    this.debugControlledWorkers = new Set();
    this.outcomeWritten = false;
    this.replayFrames = [];
    this.nextReplayCaptureAt = 0;
    this.replayArchived = false;

    this.buildWorld();
    this.settleWorld();
    this.initializeAgentSchedules();
    for (const [index, worker] of AGENTS.filter(
      (agent) => agent.id.startsWith("king_") || agent.id.startsWith("queen_"),
    ).entries()) {
      this.nextLocalInitiativeAt.set(
        worker.id,
        (this.driver.actTeam ? 5.5 : 0.55) + index * 0.18,
      );
    }
    this.lastTurnIntegrity = this.integrityMap();
    this.startLedger();
    this.announce(
      0,
      "humpty",
      "Humpty, the Egg King",
      "humpty",
      "Ahem. I believe this is where the trouble begins.",
    );
    this.captureReplayFrame(true);
  }

  private buildWorld(): void {
    this.createStaticBoundary(
      "ground",
      WORLD_WIDTH / 2,
      GROUND_HEIGHT / 2,
      WORLD_WIDTH,
      GROUND_HEIGHT,
    );
    this.createStaticBoundary("wall_left", -25, WORLD_HEIGHT / 2, 50, WORLD_HEIGHT);
    this.createStaticBoundary(
      "wall_right",
      WORLD_WIDTH + 25,
      WORLD_HEIGHT / 2,
      50,
      WORLD_HEIGHT,
    );
    this.createStaticBoundary(
      "tower_plinth",
      TOWER_X,
      GROUND_HEIGHT + TOWER_PLINTH_HEIGHT / 2,
      TOWER_PLINTH_WIDTH,
      TOWER_PLINTH_HEIGHT,
    );

    let towerIndex = 0;
    for (let layer = 0; layer < TOWER_LAYERS; layer += 1) {
      const yaw = layer % 2 === 0 ? Math.PI / 2 : 0;
      for (let slot = 0; slot < TOWER_BLOCKS_PER_LAYER; slot += 1) {
        const lane = slot - 1;
        const x =
          TOWER_X + lane * TOWER_BLOCK_WIDTH + this.rng.range(-0.035, 0.035);
        const y =
          TOWER_BASE_Y +
          TOWER_BLOCK_HEIGHT / 2 +
          layer * TOWER_BLOCK_HEIGHT;
        const body = this.world.createRigidBody(
          RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(x, y)
            .setLinearDamping(0.05)
            .setAngularDamping(0.08)
            .setAdditionalSolverIterations(8)
            .setCanSleep(true),
        );
        const collider = this.world.createCollider(
          RAPIER.ColliderDesc.cuboid(
            TOWER_BLOCK_WIDTH / 2 - 0.15,
            TOWER_BLOCK_HEIGHT / 2 - 0.05,
          )
            .setMass(TOWER_BLOCK_MASS)
            .setFriction(0.55)
            .setRestitution(0.05)
            .setCollisionGroups(TOWER_COLLISION_GROUPS)
            .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
            .setContactForceEventThreshold(0),
          body,
        );
        this.addEntity({
          id: `block_${towerIndex++}`,
          kind: "block",
          body,
          collider,
          width: TOWER_BLOCK_LENGTH,
          height: TOWER_BLOCK_HEIGHT,
          material: "iron-banded oak Jenga block",
          puzzleDepth:
            layer % 2 === 0 ? lane * 1.2 : lane * 0.08,
          puzzleYaw: yaw,
          stress: 0,
        });
      }
    }

    const supportY =
      TOWER_BASE_Y +
      TOWER_LAYERS * TOWER_BLOCK_HEIGHT +
      TOWER_SEAT_HEIGHT / 2;
    const supportBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(TOWER_X, supportY)
        .setLinearDamping(0.08)
        .setAngularDamping(0.12)
        .setAdditionalSolverIterations(10)
        .setCanSleep(true)
        .setCcdEnabled(true),
    );
    const supportCollider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(
        TOWER_SEAT_WIDTH / 2,
        TOWER_SEAT_HEIGHT / 2,
      )
        .setMass(10)
        .setFriction(0.62)
        .setRestitution(0.03)
        .setCollisionGroups(TOWER_COLLISION_GROUPS)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(0),
      supportBody,
    );
    this.addEntity({
      id: "humpty_seat",
      kind: "seat",
      body: supportBody,
      collider: supportCollider,
      width: TOWER_SEAT_WIDTH,
      height: TOWER_SEAT_HEIGHT,
      material: "shallow octagonal royal oak seat",
      puzzleDepth: 0,
      puzzleYaw: 0,
      stress: 0,
    });
    const topY = TOWER_TOP + 55 + 0.5;
    const humptyBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(TOWER_X, topY)
        .setLinearDamping(0.12)
        .setAngularDamping(0.22)
        .setCanSleep(true)
        .setCcdEnabled(true),
    );
    const humptyCollider = this.world.createCollider(
      RAPIER.ColliderDesc.roundCuboid(32, 43, 12)
        .setMass(42)
        .setFriction(1.05)
        .setRestitution(0.05)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(0),
      humptyBody,
    );
    this.addEntity({
      id: "humpty",
      kind: "humpty",
      team: "humpty",
      body: humptyBody,
      collider: humptyCollider,
      radius: 45,
      integrity: 100,
      alive: true,
      stress: 0,
    });

    const kingStarts = [300, 340, 380];
    const queenStarts = [900, 860, 820];
    for (let index = 0; index < 3; index += 1) {
      this.createMan(`king_${index + 1}`, "king", kingStarts[index] ?? 300);
      this.createMan(`queen_${index + 1}`, "queen", queenStarts[index] ?? 900);
    }

    const kingBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(140, 405),
    );
    this.addEntity({
      id: "king",
      kind: "king",
      team: "king",
      body: kingBody,
      width: 118,
      height: 150,
      integrity: 100,
      alive: true,
      stress: 0,
    });

    const queenBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(1060, 405),
    );
    this.addEntity({
      id: "queen",
      kind: "queen",
      team: "queen",
      body: queenBody,
      width: 118,
      height: 150,
      integrity: 100,
      alive: true,
      stress: 0,
    });

    this.createPuzzleKits();
  }

  private createPuzzleKits(): void {
    const catalog = gameplayPuzzleCatalog();
    for (const team of ["king", "queen"] as const) {
      catalog.forEach((source, index) => {
        const id = `kit_${team}_${source.id}`;
        const part: PuzzlePartInstance = {
          ...source,
          id,
          ports: source.ports.map((port) => ({
            ...port,
            accepts: [...port.accepts],
          })),
          affordances: [...source.affordances],
          constraints: [...source.constraints],
          capabilities: [...source.capabilities],
        };
        this.puzzleParts.set(id, part);
        this.openingPuzzleIds.add(id);
        this.puzzleLedger.set(id, {
          partId: id,
          definitionId: part.definitionId,
          owner: team,
          state: "stored",
          integrity: 1,
          actionHistory: ["opening_inventory"],
        });
        // Two literal floor-board lanes at each stage edge. Rows run from
        // backdrop to apron so the complete inventory stays visible.
        const laneX = [62, 148][index % 2]!;
        const x = team === "king" ? laneX : WORLD_WIDTH - laneX;
        const angle = 0;
        const yaw = this.puzzleStorageYaw(part);
        const y =
          GROUND_HEIGHT + this.puzzleHalfHeightFor(part, angle) + 2;
        const depth = -6.45 + Math.floor(index / 2);
        const body = this.world.createRigidBody(
          RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(x, y)
            .setRotation(angle)
            .setLinearDamping(3.2)
            .setAngularDamping(2.6)
            .setAdditionalSolverIterations(3)
            .setCanSleep(true)
            .setCcdEnabled(part.definitionId === "wedge"),
        );
        const width = part.width ?? (part.radius ?? 18) * 2;
        const height = part.height ?? (part.radius ?? 14) * 2;
        const storageWidth =
          Math.abs(Math.cos(yaw)) * width +
          Math.abs(Math.sin(yaw)) * part.depth;
        const colliderDesc = part.radius
          ? RAPIER.ColliderDesc.ball(part.radius)
          : RAPIER.ColliderDesc.cuboid(
              Math.max(4, storageWidth / 2),
              Math.max(4, height / 2),
            );
        const collider = this.world.createCollider(
          colliderDesc
            .setFriction(0.9)
            .setRestitution(0.01)
            .setMass(part.mass)
            .setCollisionGroups(PUZZLE_COLLISION_GROUPS),
          body,
        );
        this.addEntity({
          id,
          kind: "component",
          team,
          body,
          collider,
          componentType: part.componentType,
          componentLabel: part.label,
          assemblyState: "stock",
          ...(part.width !== undefined ? { width: part.width } : {}),
          ...(part.height !== undefined ? { height: part.height } : {}),
          ...(part.radius !== undefined ? { radius: part.radius } : {}),
          material: part.material,
          puzzleDefinition: part,
          puzzleDepth: depth,
          puzzleYaw: yaw,
          puzzleLifecycle: "stored",
          sourceX: x,
          sourceY: depth,
          stress: 0,
        });
      });
    }
  }

  private puzzleStorageYaw(part: PuzzlePartInstance): number {
    return ["bar", "brace", "platform", "axle", "lashing", "screw"].includes(
      part.componentType,
    )
      ? Math.PI / 2
      : 0;
  }

  private setPuzzleYaw(entity: PhysicsEntity, yaw: number): void {
    entity.puzzleYaw = yaw;
    if (!entity.collider || !entity.puzzleDefinition || entity.radius !== undefined) {
      return;
    }
    const width = entity.width ?? 8;
    const depth = entity.puzzleDefinition.depth;
    const effectiveWidth =
      Math.abs(Math.cos(yaw)) * width + Math.abs(Math.sin(yaw)) * depth;
    entity.collider.setShape(
      new RAPIER.Cuboid(
        Math.max(4, effectiveWidth / 2),
        Math.max(4, (entity.height ?? 8) / 2),
      ),
    );
  }

  private setPuzzleLifecycle(
    partIds: string[],
    state: PartLifecycleState,
    actorId?: string,
    action: string = state,
  ): void {
    for (const partId of partIds) {
      const entity = this.entities.get(partId);
      const previousState = entity?.puzzleLifecycle;
      if (entity?.puzzleDefinition) {
        entity.puzzleLifecycle = state;
        if (["stored", "stored_or_reused"].includes(state)) {
          this.setPuzzleYaw(
            entity,
            this.puzzleStorageYaw(entity.puzzleDefinition),
          );
        } else if (
          [
            "carried",
            "staged",
            "supported",
            "aligning",
            "connected",
            "tested",
            "operating",
          ].includes(state)
        ) {
          this.setPuzzleYaw(entity, 0);
        }
        if (actorId && ["reserved", "being_fetched", "carried", "supported", "aligning"].includes(state)) {
          entity.reservedBy = actorId;
        } else if (!["reserved", "being_fetched", "carried", "supported", "aligning"].includes(state)) {
          delete entity.reservedBy;
        }
      }
      const ledger = this.puzzleLedger.get(partId);
      if (!ledger) continue;
      ledger.state = state;
      ledger.integrity = Math.max(0, Math.min(1, entity?.integrity ?? ledger.integrity));
      if (entity?.reservedBy) ledger.reservedBy = entity.reservedBy;
      else delete ledger.reservedBy;
      if (state === "carried" && actorId) ledger.carriedBy = actorId;
      else delete ledger.carriedBy;
      const assembly = this.assemblyPartIds(partId);
      if (assembly.length > 1 && !["detached", "damaged", "dropped", "recoverable"].includes(state)) {
        ledger.assemblyId = [...assembly].sort()[0]!;
      } else {
        delete ledger.assemblyId;
      }
      const actionSuffix = `:${action}`;
      if (
        previousState !== state ||
        !ledger.actionHistory.at(-1)?.endsWith(actionSuffix)
      ) {
        ledger.actionHistory.push(
          `${this.simulationTick}:${actorId ?? "world"}:${action}`,
        );
        ledger.actionHistory = ledger.actionHistory.slice(-24);
      }
    }
  }

  private createStaticBoundary(
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(x, y),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(width / 2, height / 2)
        .setFriction(1)
        .setRestitution(0),
      body,
    );
    if (id === "tower_plinth") {
      collider.setCollisionGroups(TOWER_COLLISION_GROUPS);
    }
    if (id === "ground" || id === "tower_plinth") {
      this.addEntity({
        id,
        kind: id === "ground" ? "ground" : "plinth",
        body,
        collider,
        width,
        height,
        stress: 0,
      });
    }
  }

  private createMan(id: string, team: "king" | "queen", x: number): void {
    const torsoY = GROUND_HEIGHT + 23;
    const manIndex =
      team === "king"
        ? Number(id.at(-1))
        : Number(id.at(-1)) + 3;
    const membership = 1 << manIndex;
    const collisionGroups =
      ((membership << 16) |
        (0xffff ^ membership ^ PUZZLE_MEMBERSHIP ^ MEN_MEMBERSHIP_MASK)) >>>
      0;
    const torso = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, torsoY)
        .setLinearDamping(1.7)
        .setAngularDamping(1.4)
        .lockRotations()
        .setCanSleep(true),
    );
    const torsoCollider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(14, 9)
        .setMass(6)
        .setFriction(1.2)
        .setRestitution(0)
        .setCollisionGroups(collisionGroups)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(0),
      torso,
    );
    this.addEntity({
      id,
      kind: "man",
      team,
      body: torso,
      collider: torsoCollider,
      width: 18,
      height: 46,
      integrity: 100,
      alive: true,
      puzzleDepth:
        [-1.2, 0.2, 1.5][Math.max(0, Number(id.at(-1) ?? 1) - 1)] ??
        0.2,
      stress: 0,
    });

    const parts: Array<{
      part: NonNullable<PhysicsEntity["part"]>;
      dx: number;
      dy: number;
      width: number;
      height: number;
      anchorTorso: { x: number; y: number };
      anchorPart: { x: number; y: number };
      radius?: number;
    }> = [];

    for (const spec of parts) {
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(x + spec.dx, torsoY + spec.dy)
          .setLinearDamping(1.2)
          .setAngularDamping(0.8)
          .setCanSleep(true),
      );
      const shape = spec.radius
        ? RAPIER.ColliderDesc.ball(spec.radius)
        : RAPIER.ColliderDesc.cuboid(spec.width / 2, spec.height / 2);
      const collider = this.world.createCollider(
        shape
          .setDensity(0.0011)
          .setFriction(0.9)
          .setRestitution(0)
          .setCollisionGroups(collisionGroups)
          .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
          .setContactForceEventThreshold(0),
        body,
      );
      const partId = `${id}_${spec.part}`;
      this.addEntity({
        id: partId,
        kind: "limb",
        team,
        ownerId: id,
        part: spec.part,
        body,
        collider,
        width: spec.width,
        height: spec.height,
        ...(spec.radius ? { radius: spec.radius } : {}),
        stress: 0,
      });
      const joint = this.world.createImpulseJoint(
        RAPIER.JointData.revolute(spec.anchorTorso, spec.anchorPart),
        torso,
        body,
        true,
      );
      this.joints.push(joint);
    }
  }

  private createSupplyStones(team: "king" | "queen", originX: number): void {
    const direction = team === "king" ? 1 : -1;
    for (let index = 0; index < 10; index += 1) {
      const x = originX + direction * ((index % 5) * 18);
      const y = GROUND_HEIGHT + 9 + Math.floor(index / 5) * 17;
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(x, y)
          .setLinearDamping(0.4)
          .setAngularDamping(0.3)
          .setCanSleep(true)
          .setCcdEnabled(true),
      );
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.ball(8)
          .setDensity(0.004)
          .setFriction(0.8)
          .setRestitution(0.12)
          .setCollisionGroups(STOCK_COLLISION_GROUPS)
          .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
          .setContactForceEventThreshold(0),
        body,
      );
      this.addEntity({
        id: `stone_${team}_${index}`,
        kind: "stone",
        team,
        body,
        collider,
        radius: 8,
        stress: 0,
      });
    }
  }

  private fireCrossbowBolt(
    team: "king" | "queen",
    actor: PhysicsEntity,
    target: PhysicsEntity,
  ): void {
    if (!actor.body || !target.body) return;
    const origin = actor.body.translation();
    const destination = target.body.translation();
    const direction = Math.sign(destination.x - origin.x) || (team === "king" ? 1 : -1);
    const speed = 475;
    const launchX = origin.x + direction * 24;
    const launchY = origin.y + 24;
    const targetY =
      destination.y + (target.kind === "humpty" ? 0 : (target.height ?? 48) * 0.18);
    const angle = lowBallisticAngle(
      launchX,
      launchY,
      destination.x,
      targetY,
      speed,
    );
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(launchX, launchY)
        .setRotation(angle)
        .setLinearDamping(0.02)
        .setAngularDamping(1.8)
        .setCcdEnabled(true),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(9, 2)
        .setDensity(0.008)
        .setFriction(0.25)
        .setRestitution(0.02)
        .setCollisionGroups(PROJECTILE_IGNORE_TOWER_GROUPS)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(0),
      body,
    );
    body.setLinvel(
      { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
      true,
    );
    this.addEntity({
      id: `bolt_${team}_${this.boltSequence++}`,
      kind: "stone",
      team,
      body,
      collider,
      width: 18,
      height: 4,
      stress: 0,
      expiresAt: this.elapsed + 4.5,
    });
  }

  private addEntity(entity: PhysicsEntity): void {
    this.entities.set(entity.id, entity);
    if (entity.collider) {
      this.colliderOwners.set(entity.collider.handle, entity.ownerId ?? entity.id);
    }
  }

  private settleWorld(): void {
    // Opening bodies begin in contact and settle under ordinary gravity.
    for (let step = 0; step < 300; step += 1) this.world.step(this.events);
    this.events.clear();
  }

  private startLedger(): void {
    mkdirSync(join(this.root, "runs"), { recursive: true });
    const stamp = new Date()
      .toISOString()
      .replaceAll(":", "-")
      .replace(".", "-");
    this.runId = stamp;
    this.ledgerPath = join(this.root, "runs", `${stamp}.ndjson`);
    const header = {
      type: "header",
      version: 1,
      createdAt: new Date().toISOString(),
      seed: this.seed,
      driver: this.driver.model,
      config: {
        world: { width: WORLD_WIDTH, height: WORLD_HEIGHT, gravity: -650 },
        stepHz: 60,
        decisionMode:
          this.driver.model === "mock"
            ? "synchronized"
            : this.driver.actTeam
              ? "team-batched"
              : "independent",
        turnSeconds: this.driver.model === "mock" ? TURN_SECONDS : null,
        gameSeconds: GAME_SECONDS,
        matchBeats: {
          layoutUntil: BUILD_BEAT_AT,
          buildUntil: CONTEST_BEAT_AT,
          contestUntil: DECISIVE_BEAT_AT,
        },
        damage:
          "men: impact over 28; Humpty: hard fall or a heavy projectile over 540 speed",
        tower: {
          blocks: TOWER_BLOCKS,
          blockSize: [
            TOWER_BLOCK_LENGTH,
            TOWER_BLOCK_WIDTH,
            TOWER_BLOCK_HEIGHT,
          ],
          layers: TOWER_LAYERS,
          blocksPerLayer: TOWER_BLOCKS_PER_LAYER,
          royalSeat: [TOWER_SEAT_WIDTH, TOWER_SEAT_HEIGHT],
        },
        puzzleParts: this.puzzleParts.size / 2,
      },
    };
    appendFileSync(this.ledgerPath, `${JSON.stringify(header)}\n`);
  }

  tick(): void {
    const now = performance.now();
    const delta = Math.min(0.1, (now - this.lastTickAt) / 1000);
    this.lastTickAt = now;

    if (this.pendingWinnerAt > 0 && Date.now() >= this.pendingWinnerAt) {
      this.pendingWinnerAt = 0;
      this.finishFromCrack();
    }

    if (
      this.manualPaused ||
      this.winner !== null ||
      Date.now() < this.crackFreezeUntil
    ) {
      return;
    }

    this.accumulator += delta;
    while (this.accumulator >= FIXED_STEP) {
      this.stepPhysics();
      this.accumulator -= FIXED_STEP;
      this.elapsed += FIXED_STEP;
    }
    this.captureReplayFrame();

    if (this.elapsed >= GAME_SECONDS && !this.winner) {
      this.finishTimeDraw();
      return;
    }

    if (this.driver.model !== "mock") {
      this.startDueAgentDecisions();
    } else if (this.elapsed - this.lastTurnAt >= TURN_SECONDS) {
      this.lastTurnAt = this.elapsed;
      if (this.turn >= MAX_TURNS) {
        this.finishStalemate();
      } else {
        void this.beginTurn();
      }
    }
  }

  private stepPhysics(): void {
    if (this.winner) return;
    this.simulationTick += 1;
    this.removeSpentProjectiles();
    this.updatePuzzleTasks();
    this.updatePuzzleRecoveryTasks();
    this.updateLocalInitiative();
    this.settlePuzzleAssemblies();
    this.updateClimbing();
    this.updateMovement();
    this.updateWorkerCollisionGroups();
    this.updateCombat();
    this.updateCarriedObjects();
    this.updateRescueHarness();
    this.updateHumptyRighting();
    for (const entity of this.entities.values()) {
      entity.stress *= 0.91;
    }
    for (const rope of this.ropes.values()) {
      rope.stress *= 0.9;
    }

    const preStepMotion = new Map<string, MotionState>();
    for (const entity of this.entities.values()) {
      if (!entity.body) continue;
      if (entity.ownerId) continue;
      const owner = entity.ownerId ?? entity.id;
      const velocity = entity.body.linvel();
      preStepMotion.set(owner, {
        speed: Math.hypot(velocity.x, velocity.y),
        vy: velocity.y,
      });
    }
    this.humptyPreStepVy =
      preStepMotion.get("humpty")?.vy ?? 0;

    this.world.step(this.events);
    const strongestContacts = new Map<string, ContactState>();
    this.events.drainContactForceEvents((event) => {
      const first = this.colliderOwners.get(event.collider1());
      const second = this.colliderOwners.get(event.collider2());
      const impulse = event.totalForceMagnitude() * FIXED_STEP;
      const firstMotion = first
        ? preStepMotion.get(first) ?? { speed: 0, vy: 0 }
        : { speed: 0, vy: 0 };
      const secondMotion = second
        ? preStepMotion.get(second) ?? { speed: 0, vy: 0 }
        : { speed: 0, vy: 0 };
      if (first) {
        this.rememberContact(strongestContacts, first, impulse, firstMotion, second, secondMotion);
      }
      if (second && second !== first) {
        this.rememberContact(strongestContacts, second, impulse, secondMotion, first, firstMotion);
      }
    });
    for (const [id, contact] of strongestContacts) {
      this.applyContact(id, contact);
    }
    this.updatePuzzleConnectionLoads();
    this.updateRopeStress();
    this.checkWinConditions();
  }

  private assemblyPartIds(startId: string): string[] {
    if (!this.puzzleParts.has(startId)) return [];
    const visited = new Set([startId]);
    const queue = [startId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const connection of this.puzzleConnections) {
        if (connection.state === "failed") continue;
        const next =
          connection.firstId === current
            ? connection.secondId
            : connection.secondId === current
              ? connection.firstId
              : undefined;
        if (next && !visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    return [...visited];
  }

  private puzzleAssembly(startId: string): PuzzleAssemblySummary | undefined {
    const partIds = this.assemblyPartIds(startId);
    return partIds.length > 0
      ? summarizeAssembly(partIds, this.puzzleParts, this.puzzleConnections)
      : undefined;
  }

  private matchBeat(): MatchBeat {
    if (this.elapsed < BUILD_BEAT_AT) return "layout";
    if (this.elapsed < CONTEST_BEAT_AT) return "build";
    if (this.elapsed < DECISIVE_BEAT_AT) return "contest";
    return "decisive";
  }

  private beatRule(beat = this.matchBeat()): string {
    switch (beat) {
      case "layout":
        return "Move stock and join initial subassemblies; combat is closed.";
      case "build":
        return "Build and proof compound machines; combat is still closed.";
      case "contest":
        return "Sabotage and worker combat are open; Humpty cannot be resolved yet.";
      case "decisive":
        return "Commissioned rescue and attack machines may affect Humpty.";
    }
  }

  private beatCopy(beat = this.matchBeat()): string {
    switch (beat) {
      case "layout":
        return "Stock moves to the work bays";
      case "build":
        return "Compound machines take shape";
      case "contest":
        return "Sabotage and combat are open";
      case "decisive":
        return "Rescue and attack may engage";
    }
  }

  private assemblyReadyForHumpty(
    team: WorkerTeam,
    assembly: PuzzleAssemblySummary,
  ): boolean {
    const capabilities = new Set(assembly.capabilities);
    if (team === "king") {
      return (
        assembly.partIds.length >= 6 &&
        capabilities.has("support") &&
        capabilities.has("pull") &&
        capabilities.has("lower") &&
        (capabilities.has("redirect_rope") || capabilities.has("wind_rope")) &&
        assembly.stability >= 0.55 &&
        assembly.failureMargin >= 0.35
      );
    }
    return (
      assembly.partIds.length >= 3 &&
      capabilities.has("push") &&
      (capabilities.has("pivot") || capabilities.has("roll")) &&
      (capabilities.has("strike") || capabilities.has("chock")) &&
      assembly.stability >= 0.52 &&
      assembly.failureMargin >= 0.3
    );
  }

  private puzzleFunctionProgress(
    team: WorkerTeam,
    assembly: PuzzleAssemblySummary,
  ): { score: number; completed: string[] } {
    const milestones: Array<{
      id: string;
      capabilities: string[];
      partKinds: string[];
      weight: number;
    }> =
      team === "king"
        ? [
            {
              id: "braced_frame",
              capabilities: ["support", "brace"],
              partKinds: ["bar", "cheek"],
              weight: 34,
            },
            {
              id: "bearing_frame",
              capabilities: ["support", "pivot"],
              partKinds: ["axle", "cheek"],
              weight: 48,
            },
            {
              id: "redirected_line",
              capabilities: ["pull", "redirect_rope"],
              partKinds: ["lashing", "sheave"],
              weight: 62,
            },
            {
              id: "winding_core",
              capabilities: ["wind_rope", "pull"],
              partKinds: ["drum", "axle"],
              weight: 56,
            },
            {
              id: "supported_winder",
              capabilities: ["wind_rope", "pull", "pivot", "support"],
              partKinds: ["drum", "axle", "cheek"],
              weight: 78,
            },
            {
              id: "controlled_lowering",
              capabilities: ["support", "pull", "lower", "redirect_rope", "wind_rope"],
              partKinds: ["lashing", "sheave", "drum", "axle", "cheek"],
              weight: 132,
            },
          ]
        : [
            {
              id: "braced_lever",
              capabilities: ["pivot", "push", "strike"],
              partKinds: ["bar", "brace"],
              weight: 76,
            },
            {
              id: "rolling_ram",
              capabilities: ["roll", "push"],
              partKinds: ["wheel", "axle", "bar"],
              weight: 58,
            },
            {
              id: "anchored_pivot",
              capabilities: ["support", "pivot", "chock"],
              partKinds: ["cheek", "brace"],
              weight: 52,
            },
            {
              id: "block_extractor",
              capabilities: ["pivot", "push", "strike", "chock"],
              partKinds: ["bar", "brace", "cheek"],
              weight: 138,
            },
          ];
    milestones.push(
      {
        id: "rolling_core",
        capabilities: ["roll", "pivot"],
        partKinds: ["wheel", "axle"],
        weight: 42,
      },
      {
        id: "inclined_platform",
        capabilities: ["ramp", "support"],
        partKinds: ["platform"],
        weight: 46,
      },
      {
        id: "stabilizing_wedge",
        capabilities: ["brace", "chock"],
        partKinds: ["brace"],
        weight: 40,
      },
    );
    const capabilities = new Set(assembly.capabilities);
    const partKinds = new Set(
      assembly.partIds.flatMap((partId) => {
        const part = this.puzzleParts.get(partId);
        return part ? [part.componentType] : [];
      }),
    );
    const completed: string[] = [];
    let score = 0;
    for (const milestone of milestones) {
      const matched = milestone.capabilities.filter((capability) =>
        capabilities.has(capability as PuzzleAssemblySummary["capabilities"][number]),
      ).length;
      const kindMatched = milestone.partKinds.filter((kind) =>
        partKinds.has(kind as never),
      ).length;
      const coverage =
        (matched + kindMatched) /
        Math.max(
          1,
          milestone.capabilities.length + milestone.partKinds.length,
        );
      score += milestone.weight * coverage * coverage;
      if (coverage >= 1) completed.push(milestone.id);
    }
    return { score: Math.round(score * 100) / 100, completed };
  }

  private commissioningFor(
    team: WorkerTeam,
    assembly: PuzzleAssemblySummary,
  ): PuzzleCommissioning {
    const key = `${team}:${assembly.id}`;
    const signature = assembly.partIds.join("|");
    const current = this.puzzleCommissioning.get(key);
    if (current?.signature === signature) return current;
    const next = { signature, step: 0 };
    this.puzzleCommissioning.set(key, next);
    return next;
  }

  private commissioningOperation(
    team: WorkerTeam,
    step: number,
  ): {
    operation: TeamAgentState["useOptions"][number]["operation"];
    instruction: string;
    duration: number;
  } {
    const kingSteps = [
      {
        operation: "proof" as const,
        instruction: "Proof-load the frame and inspect every joint.",
        duration: 14,
      },
      {
        operation: "fit" as const,
        instruction: "Fit and balance the padded sling around Humpty.",
        duration: 16,
      },
      {
        operation: "tension" as const,
        instruction: "Tension the hoist and test the holding brake.",
        duration: 18,
      },
      {
        operation: "execute" as const,
        instruction: "Begin the controlled descent.",
        duration: 0,
      },
    ];
    const queenSteps = [
      {
        operation: "proof" as const,
        instruction: "Proof-test the pivot, throwing arm, and sling.",
        duration: 14,
      },
      {
        operation: "fit" as const,
        instruction: "Seat one existing stone in the load sling.",
        duration: 16,
      },
      {
        operation: "tension" as const,
        instruction: "Set the lever arm and take measured aim.",
        duration: 18,
      },
      {
        operation: "execute" as const,
        instruction: "Drive the commissioned throwing stroke.",
        duration: 0,
      },
    ];
    return (team === "king" ? kingSteps : queenSteps)[
      Math.max(0, Math.min(3, step))
    ]!;
  }

  private occupiedPuzzlePort(partId: string, portId: string): boolean {
    return this.puzzleConnections.some(
      (connection) =>
        connection.state !== "failed" &&
        (connection.firstId === partId && connection.firstPort === portId) ||
        connection.state !== "failed" &&
          (connection.secondId === partId && connection.secondPort === portId),
    );
  }

  private compatiblePuzzlePorts(
    firstId: string,
    secondId: string,
  ): { firstPort: string; secondPort: string } | undefined {
    const first = this.puzzleParts.get(firstId);
    const second = this.puzzleParts.get(secondId);
    if (!first || !second) return undefined;
    const intelligiblePair = (
      firstKind: string,
      secondKind: string,
    ): boolean => {
      const ports = [firstKind, secondKind].sort().join("+");
      const components = [first.componentType, second.componentType]
        .sort()
        .join("+");
      const allowed = (pairs: string[]): boolean => pairs.includes(components);
      switch (ports) {
        case "axle_shaft+bearing_bore":
          return allowed(["axle+cheek", "axle+sheave"]);
        case "rope_end+sheave_groove":
          return allowed(["lashing+sheave"]);
        case "cleat+rope_end":
          return allowed(["drum+lashing"]);
        case "key_flat+keyway":
          return allowed(["axle+drum", "axle+sheave", "axle+wheel"]);
        case "load_eye+rope_end":
          return allowed(["lashing+platform"]);
        case "hook+load_eye":
          return allowed(["lashing+platform"]);
        case "rigid_peg+rigid_socket":
          return allowed([
            "bar+drum",
            "bar+platform",
            "bar+cheek",
            "bar+brace",
          ]);
        default:
          return false;
      }
    };
    const specificity = (firstKind: string, secondKind: string): number => {
      const pair = [firstKind, secondKind].sort().join("+");
      return (
        {
          "rope_end+sheave_groove": 100,
          "key_flat+keyway": 98,
          "axle_shaft+bearing_bore": 92,
          "cleat+rope_end": 84,
          "load_eye+rope_end": 78,
          "hook+load_eye": 72,
          "rigid_peg+rigid_socket": 60,
        }[pair] ?? 0
      );
    };
    const candidates: Array<{
      firstPort: string;
      secondPort: string;
      score: number;
    }> = [];
    for (const firstPort of first.ports) {
      if (this.occupiedPuzzlePort(firstId, firstPort.id)) continue;
      for (const secondPort of second.ports) {
        if (
          !this.occupiedPuzzlePort(secondId, secondPort.id) &&
          portsCompatible(firstPort, secondPort) &&
          intelligiblePair(firstPort.kind, secondPort.kind)
        ) {
          candidates.push({
            firstPort: firstPort.id,
            secondPort: secondPort.id,
            score: specificity(firstPort.kind, secondPort.kind),
          });
        }
      }
    }
    return candidates.sort(
      (firstCandidate, secondCandidate) =>
        secondCandidate.score - firstCandidate.score ||
        firstCandidate.firstPort.localeCompare(secondCandidate.firstPort) ||
        firstCandidate.secondPort.localeCompare(secondCandidate.secondPort),
    )[0];
  }

  private puzzlePartsLocked(ids: string[]): boolean {
    const wanted = new Set(ids);
    return [...this.puzzleTasks.values()].some(
      (task) =>
        task.movingIds.some((partId) => wanted.has(partId)) ||
        task.targetIds.some((partId) => wanted.has(partId)),
    );
  }

  private puzzleWorkerBusy(workerId: string): boolean {
    return (
      this.puzzleTasks.has(workerId) ||
      [...this.puzzleTasks.values()].some((task) =>
        task.helperIds.includes(workerId),
      ) ||
      this.puzzleRecoveryTasks.has(workerId)
    );
  }

  private puzzleHelpers(
    team: WorkerTeam,
    primaryId: string,
    count: number,
    aroundX: number,
  ): PhysicsEntity[] {
    if (count <= 0) return [];
    return [...this.entities.values()]
      .filter(
        (entity) =>
          entity.kind === "man" &&
          entity.team === team &&
          entity.id !== primaryId &&
          entity.alive &&
          entity.body &&
          !this.puzzleWorkerBusy(entity.id) &&
          !this.debugControlledWorkers.has(entity.id) &&
          entity.movementTarget === undefined &&
          entity.movementDepthTarget === undefined &&
          (entity.combatUntil ?? 0) <= this.elapsed,
      )
      .sort(
        (first, second) =>
          Math.abs((first.body?.translation().x ?? 0) - aroundX) -
          Math.abs((second.body?.translation().x ?? 0) - aroundX),
      )
      .slice(0, count);
  }

  private puzzleBuildSite(
    team: WorkerTeam,
    workerId: string,
  ): { x: number; depth: number } {
    const role = Math.max(0, Math.min(2, Number(workerId.at(-1) ?? 1) - 1));
    return {
      x:
        team === "king"
          ? [300, 365, 430][role]!
          : [900, 835, 770][role]!,
      depth: [-5.2, 0, 5.2][role]!,
    };
  }

  private puzzleApproachX(
    worker: PhysicsEntity,
    part: PhysicsEntity,
  ): number {
    const position = part.body?.translation();
    if (!position) return worker.body?.translation().x ?? 0;
    const side = worker.team === "king" ? 1 : -1;
    const partDepth = part.puzzleDepth ?? 0;
    const partDepthHalf = this.floorDepthHalf(part);
    let inventoryEdge =
      position.x + side * this.entityHalfExtents(part).x;
    for (const neighbor of this.entities.values()) {
      if (
        neighbor.id === part.id ||
        neighbor.team !== worker.team ||
        !neighbor.puzzleDefinition ||
        neighbor.assemblyState !== "stock" ||
        !neighbor.body ||
        Math.abs((neighbor.puzzleDepth ?? 0) - partDepth) >
          this.floorDepthHalf(neighbor) + partDepthHalf + 0.22
      ) {
        continue;
      }
      const neighborPosition = neighbor.body.translation();
      const edge =
        neighborPosition.x + side * this.entityHalfExtents(neighbor).x;
      inventoryEdge =
        side > 0
          ? Math.max(inventoryEdge, edge)
          : Math.min(inventoryEdge, edge);
    }
    return Math.max(
      54,
      Math.min(
        WORLD_WIDTH - 54,
        inventoryEdge + side * 20,
      ),
    );
  }

  private puzzleReachDistance(
    worker: PhysicsEntity,
    part: PhysicsEntity,
  ): number {
    const workerPosition = worker.body?.translation();
    const partPosition = part.body?.translation();
    if (!workerPosition || !partPosition) return Infinity;
    const half = this.entityHalfExtents(part);
    const partDepthHalf = this.floorDepthHalf(part);
    const xGap = Math.max(
      0,
      Math.abs(partPosition.x - workerPosition.x) - half.x - 11,
    );
    const depthGap = Math.max(
      0,
      Math.abs((part.puzzleDepth ?? 0) - (worker.puzzleDepth ?? 0)) *
        STAGE_DEPTH_SCALE -
        (partDepthHalf + 0.32) * STAGE_DEPTH_SCALE,
    );
    return Math.hypot(xGap, depthGap);
  }

  private puzzleClearanceX(
    worker: PhysicsEntity,
    partIds: string[],
    direction: -1 | 1,
  ): number {
    const edges = partIds.flatMap((partId) => {
      const part = this.entities.get(partId);
      if (!part?.body) return [];
      const half = this.entityHalfExtents(part).x;
      const x = part.body.translation().x;
      return direction < 0 ? [x - half] : [x + half];
    });
    const fallback = worker.body?.translation().x ?? TOWER_X;
    const edge =
      edges.length === 0
        ? fallback
        : direction < 0
          ? Math.min(...edges)
          : Math.max(...edges);
    return Math.max(
      42,
      Math.min(WORLD_WIDTH - 42, edge + direction * 34),
    );
  }

  private beginPuzzleSnap(
    agent: AgentDefinition,
    worker: PhysicsEntity,
    partId: string,
    targetId: string,
  ): ActionResolution {
    if (agent.team === "humpty" || !worker.body) {
      return { accepted: false, reason: "No worker can carry that part" };
    }
    const part = this.entities.get(partId);
    const target = this.entities.get(targetId);
    if (
      !part?.puzzleDefinition ||
      !target?.puzzleDefinition ||
      part.team !== agent.team ||
      target.team !== agent.team
    ) {
      return {
        accepted: false,
        reason: "Both snap parts must come from your team's kit",
      };
    }
    const movingIds = this.assemblyPartIds(partId);
    const targetIds = this.assemblyPartIds(targetId);
    if (movingIds.some((id) => targetIds.includes(id))) {
      return { accepted: false, reason: "Those parts are already connected" };
    }
    const ports = this.compatiblePuzzlePorts(partId, targetId);
    if (!ports) {
      return {
        accepted: false,
        reason: "Those two parts have no compatible free snap ports",
      };
    }
    if (
      this.puzzleWorkerBusy(worker.id) ||
      this.puzzlePartsLocked([...movingIds, ...targetIds])
    ) {
      return { accepted: false, reason: "One of those parts is already moving" };
    }
    const sourcePosition = part.body?.translation();
    if (!sourcePosition) {
      return { accepted: false, reason: "Part has no physical position" };
    }
    const buildSite = this.puzzleBuildSite(agent.team, worker.id);
    const targetPosition = target.body?.translation();
    const targetNeedsStaging = targetIds.every(
      (id) => this.entities.get(id)?.assemblyState === "stock",
    );
    const requiredWorkers = Math.max(
      1,
      ...movingIds.map(
        (id) => this.entities.get(id)?.puzzleDefinition?.handling.workers ?? 1,
      ),
      ...(targetNeedsStaging
        ? targetIds.map(
            (id) =>
              this.entities.get(id)?.puzzleDefinition?.handling.workers ?? 1,
          )
        : []),
    );
    const helpers = this.puzzleHelpers(
      agent.team,
      worker.id,
      requiredWorkers - 1,
      sourcePosition.x,
    );
    if (helpers.length < requiredWorkers - 1) {
      return {
        accepted: false,
        reason: `${part.puzzleDefinition.label} requires ${requiredWorkers} free workers`,
      };
    }
    const previousCapabilities = new Set([
      ...(this.puzzleAssembly(partId)?.capabilities ?? []),
      ...(this.puzzleAssembly(targetId)?.capabilities ?? []),
    ]);
    const resultCapabilities = summarizeAssembly(
      [...new Set([...movingIds, ...targetIds])],
      this.puzzleParts,
      [
        ...this.puzzleConnections,
        {
          firstId: partId,
          firstPort: ports.firstPort,
          secondId: targetId,
          secondPort: ports.secondPort,
        },
      ],
    ).capabilities;
    this.puzzleTasks.set(worker.id, {
      workerId: worker.id,
      helperIds: helpers.map((helper) => helper.id),
      partId,
      targetId,
      movingIds,
      targetIds,
      ...ports,
      phase: targetNeedsStaging ? "fetch_target" : "fetch",
      progress: 0,
      startedAt: this.elapsed,
      phaseStartedAt: this.elapsed,
      buildX: targetNeedsStaging ? buildSite.x : (targetPosition?.x ?? buildSite.x),
      buildDepth: targetNeedsStaging
        ? buildSite.depth
        : (target.puzzleDepth ?? buildSite.depth),
      gainedCapabilities: resultCapabilities.filter(
        (capability) => !previousCapabilities.has(capability),
      ),
      resultCapabilities,
    });
    this.setPuzzleLifecycle(
      [...movingIds, ...targetIds],
      "reserved",
      worker.id,
      "reserve_for_connect",
    );
    this.nextLocalInitiativeAt.delete(worker.id);
    for (const helper of helpers) {
      helper.activity = "march";
      helper.activityUntil = this.elapsed + 20;
      helper.taskOperation = "fetch";
      helper.taskTargetId = targetNeedsStaging ? targetId : partId;
      this.nextLocalInitiativeAt.delete(helper.id);
    }
    worker.movementTarget = Math.max(
      42,
      Math.min(
        WORLD_WIDTH - 42,
        targetNeedsStaging
          ? this.puzzleApproachX(worker, target)
          : this.puzzleApproachX(worker, part),
      ),
    );
    this.setMovementDepth(
      worker,
      targetNeedsStaging ? target.puzzleDepth : part.puzzleDepth,
    );
    worker.taskOperation = "fetch";
    worker.taskTargetId = targetNeedsStaging ? targetId : partId;
    worker.taskProgress = 0;
    worker.activity = "march";
    worker.activityUntil = this.elapsed + 20;
    return { accepted: true, entityId: partId };
  }

  private puzzleHalfHeightFor(
    definition: PuzzlePartInstance,
    angle: number,
  ): number {
    if (definition.radius !== undefined) return definition.radius;
    const width = definition.width ?? (definition.radius ?? 18) * 2;
    const height = definition.height ?? (definition.radius ?? 14) * 2;
    return Math.max(
      4,
      Math.abs(Math.sin(angle)) * (width / 2) +
        Math.abs(Math.cos(angle)) * (height / 2),
    );
  }

  private puzzleHalfHeight(entity: PhysicsEntity, angle: number): number {
    return entity.puzzleDefinition
      ? this.puzzleHalfHeightFor(entity.puzzleDefinition, angle)
      : 0;
  }

  private puzzleGroundY(entity: PhysicsEntity, angle?: number): number {
    const resolvedAngle = angle ?? entity.body?.rotation() ?? 0;
    return GROUND_HEIGHT + this.puzzleHalfHeight(entity, resolvedAngle) + 2;
  }

  private puzzleCarryY(entity: PhysicsEntity): number {
    return this.puzzleGroundY(entity) + 76;
  }

  private puzzlePose(entity: PhysicsEntity): PuzzleAssemblyPose | undefined {
    const position = entity.body?.translation();
    if (!position || !entity.puzzleDefinition) return undefined;
    const angle = entity.body!.rotation();
    return {
      id: entity.id,
      x: position.x,
      y: position.y,
      angle,
      depth: entity.puzzleDepth ?? 0,
    };
  }

  private setPuzzlePose(
    entity: PhysicsEntity,
    pose: PuzzleAssemblyPose,
  ): void {
    if (!entity.body) return;
    entity.body.setNextKinematicRotation(pose.angle);
    entity.body.setNextKinematicTranslation({
      x: pose.x,
      y: pose.y,
    });
    entity.puzzleDepth = pose.depth;
  }

  private entityHalfExtents(
    entity: PhysicsEntity,
    angle = entity.body?.rotation() ?? 0,
  ): { x: number; y: number } {
    if (entity.kind === "block") {
      return {
        x: TOWER_BLOCK_WIDTH / 2,
        y: TOWER_BLOCK_HEIGHT / 2,
      };
    }
    if (entity.radius !== undefined) {
      return { x: entity.radius, y: entity.radius };
    }
    const rawWidth = Math.max(8, entity.width ?? 8);
    const yaw = entity.puzzleYaw ?? 0;
    const width = entity.puzzleDefinition
      ? Math.abs(Math.cos(yaw)) * rawWidth +
        Math.abs(Math.sin(yaw)) * entity.puzzleDefinition.depth
      : rawWidth;
    const height = Math.max(8, entity.height ?? 8);
    return {
      x:
        Math.abs(Math.cos(angle)) * (width / 2) +
        Math.abs(Math.sin(angle)) * (height / 2),
      y:
        Math.abs(Math.sin(angle)) * (width / 2) +
        Math.abs(Math.cos(angle)) * (height / 2),
    };
  }

  private floorDepthHalf(entity: PhysicsEntity): number {
    if (entity.kind === "block") return 2.1;
    if (entity.kind === "man") return 0.34;
    if (entity.kind === "humpty") return 1.15;
    if (entity.kind === "stone") return 0.3;
    if (entity.puzzleDefinition) {
      const yaw = entity.puzzleYaw ?? 0;
      const width =
        (entity.puzzleDefinition.width ?? entity.width ?? 8) /
        STAGE_DEPTH_SCALE;
      const depth =
        (entity.puzzleDefinition.depth ?? 8) / STAGE_DEPTH_SCALE;
      return Math.max(
        0.1,
        (Math.abs(Math.sin(yaw)) * width + Math.abs(Math.cos(yaw)) * depth) /
          2,
      );
    }
    const stageDepth = this.stageSize(entity)[1] / STAGE_DEPTH_SCALE / 2;
    return Math.max(0.18, Math.min(0.42, stageDepth));
  }

  private sweptPuzzleFraction(
    entity: PhysicsEntity,
    dx: number,
    dy: number,
    targetDepth: number,
    excluded: Set<string>,
    ignoreFloor = false,
  ): { fraction: number; obstacleIds: string[] } {
    const position = entity.body?.translation();
    if (!position) return { fraction: 0, obstacleIds: [] };
    const half = this.entityHalfExtents(entity);
    let fraction = 1;
    const obstacleIds = new Set<string>();
    const floor = GROUND_HEIGHT + 2;
    if (!ignoreFloor && dy < 0 && position.y + dy - half.y < floor) {
      fraction = Math.min(
        fraction,
        Math.max(0, (position.y - half.y - floor) / -dy),
      );
      obstacleIds.add("stage_floor");
    }

    for (const obstacle of this.entities.values()) {
      if (
        obstacle.id === entity.id ||
        excluded.has(obstacle.id) ||
        !obstacle.body ||
        (!obstacle.puzzleDefinition && obstacle.kind !== "block")
      ) {
        continue;
      }
      if (
        (obstacle.puzzleDefinition || obstacle.kind === "block") &&
        Math.abs(targetDepth - (obstacle.puzzleDepth ?? 0)) >
          this.floorDepthHalf(entity) +
            this.floorDepthHalf(obstacle) +
            PUZZLE_DEPTH_CLEARANCE
      ) {
        continue;
      }
      const obstaclePosition = obstacle.body.translation();
      const obstacleHalf = this.entityHalfExtents(obstacle);
      const minX = obstaclePosition.x - obstacleHalf.x - half.x - 1.25;
      const maxX = obstaclePosition.x + obstacleHalf.x + half.x + 1.25;
      const minY = obstaclePosition.y - obstacleHalf.y - half.y - 1.25;
      const maxY = obstaclePosition.y + obstacleHalf.y + half.y + 1.25;
      let enter = -Infinity;
      let exit = Infinity;
      for (const [origin, delta, minimum, maximum] of [
        [position.x, dx, minX, maxX],
        [position.y, dy, minY, maxY],
      ] as const) {
        if (Math.abs(delta) < 0.0001) {
          if (origin <= minimum || origin >= maximum) {
            enter = Infinity;
            exit = -Infinity;
            break;
          }
          continue;
        }
        const first = (minimum - origin) / delta;
        const second = (maximum - origin) / delta;
        enter = Math.max(enter, Math.min(first, second));
        exit = Math.min(exit, Math.max(first, second));
      }
      if (enter <= exit && enter >= 0 && enter <= 1) {
        fraction = Math.min(fraction, Math.max(0, enter - 0.002));
        obstacleIds.add(obstacle.id);
      }
    }
    return { fraction, obstacleIds: [...obstacleIds] };
  }

  private translatePuzzleAssembly(
    partIds: string[],
    anchorId: string,
    x: number,
    y: number,
    depth: number,
    excludedIds: string[] = [],
    ignoreFloor = false,
    handlerCount = 1,
  ): { blocked: boolean; obstacleIds: string[]; distanceRemaining: number } {
    const anchor = this.entities.get(anchorId);
    const anchorPosition = anchor?.body?.translation();
    if (!anchorPosition) {
      return { blocked: true, obstacleIds: [], distanceRemaining: Infinity };
    }
    const dx = x - anchorPosition.x;
    const dy = y - anchorPosition.y;
    const dDepth = depth - (anchor?.puzzleDepth ?? 0);
    const excluded = new Set([...partIds, ...excludedIds]);
    const obstacleIds = new Set<string>();
    let movementFraction = 1;

    if (Math.hypot(dx, dy) > 0.001) {
      for (const partId of partIds) {
        const entity = this.entities.get(partId);
        if (!entity?.collider || !entity.body) continue;
        const sweep = this.sweptPuzzleFraction(
          entity,
          dx,
          dy,
          (entity.puzzleDepth ?? 0) + dDepth,
          excluded,
          ignoreFloor,
        );
        movementFraction = Math.min(movementFraction, sweep.fraction);
        sweep.obstacleIds.forEach((id) => obstacleIds.add(id));
      }
    }

    for (const partId of partIds) {
      const entity = this.entities.get(partId);
      const position = entity?.body?.translation();
      if (!entity?.body || !position) continue;
      const goalX = position.x + dx * movementFraction;
      const goalY = position.y + dy * movementFraction;
      const velocity = entity.body.linvel();
      const mass = Math.max(1, entity.body.mass());
      entity.body.resetForces(true);
      const staffing = Math.min(
        1,
        handlerCount /
          Math.max(1, entity.puzzleDefinition?.handling.workers ?? 1),
      );
      const carrySpeed =
        (entity.puzzleDefinition?.handling.maxCarrySpeed ?? 90) * staffing;
      const errorX = goalX - position.x;
      const errorY = goalY - position.y;
      let forceX = mass * (errorX * 16 - velocity.x * 8.2);
      let forceY = mass * (errorY * 18 - velocity.y * 9.2 + 650);
      const maxForce = mass * 1200 * Math.max(0.72, staffing);
      const forceLength = Math.hypot(forceX, forceY);
      if (forceLength > maxForce) {
        forceX = (forceX / forceLength) * maxForce;
        forceY = (forceY / forceLength) * maxForce;
      }
      entity.body.addForce({ x: forceX, y: forceY }, true);
      const speed = Math.hypot(velocity.x, velocity.y);
      if (speed > carrySpeed * 1.08) {
        const brakingAcceleration = Math.min(
          6200,
          (speed - carrySpeed) * 42,
        );
        entity.body.addForce(
          {
            x: -(velocity.x / speed) * mass * brakingAcceleration,
            y: -(velocity.y / speed) * mass * brakingAcceleration,
          },
          true,
        );
      }
      const angle = entity.body.rotation();
      const angleError = Math.atan2(Math.sin(-angle), Math.cos(-angle));
      const inertia = Math.max(1, entity.body.effectiveAngularInertia());
      const carryTorque = Math.max(
        -inertia * 70,
        Math.min(
          inertia * 70,
          inertia * (angleError * 34 - entity.body.angvel() * 11),
        ),
      );
      entity.body.resetTorques(true);
      entity.body.addTorque(carryTorque, true);
      const depthStep = Math.sign(dDepth) * Math.min(
        Math.abs(dDepth) * movementFraction,
        4.2 * FIXED_STEP * staffing,
      );
      entity.puzzleDepth = (entity.puzzleDepth ?? 0) + depthStep;
    }
    return {
      blocked: movementFraction < 0.985,
      obstacleIds: [...obstacleIds],
      distanceRemaining: Math.hypot(dx, dy, dDepth * STAGE_DEPTH_SCALE),
    };
  }

  private movePuzzleAssemblyToPoses(
    poses: PuzzleAssemblyPose[],
    excludedIds: string[],
    handlerCount = 1,
  ): { blocked: boolean; obstacleIds: string[]; distanceRemaining: number } {
    if (poses.length === 0) {
      return { blocked: false, obstacleIds: [], distanceRemaining: 0 };
    }
    const partIds = poses.map((pose) => pose.id);
    const anchor = this.entities.get(poses[0]!.id);
    const current = anchor ? this.puzzlePose(anchor) : undefined;
    if (!current) {
      return { blocked: true, obstacleIds: [], distanceRemaining: Infinity };
    }
    const intended = poses[0]!;
    const result = this.translatePuzzleAssembly(
      partIds,
      intended.id,
      intended.x,
      intended.y,
      intended.depth,
      excludedIds,
      true,
      handlerCount,
    );
    for (const pose of poses) {
      const entity = this.entities.get(pose.id);
      if (!entity?.body) continue;
      const angle = entity.body.rotation();
      const delta = Math.atan2(
        Math.sin(pose.angle - angle),
        Math.cos(pose.angle - angle),
      );
      const mass = Math.max(1, entity.body.mass());
      entity.body.resetTorques(true);
      const inertia = Math.max(1, entity.body.effectiveAngularInertia());
      const torque = Math.max(
        -inertia * 90,
        Math.min(
          inertia * 90,
          inertia * (delta * 46 - entity.body.angvel() * 14),
        ),
      );
      entity.body.addTorque(torque, true);
    }
    return result;
  }

  private settlePuzzleAssemblies(): void {
    const controlled = new Set<string>();
    for (const task of this.puzzleTasks.values()) {
      task.movingIds.forEach((id) => controlled.add(id));
      task.targetIds.forEach((id) => controlled.add(id));
    }
    for (const task of this.puzzleRecoveryTasks.values()) {
      controlled.add(task.partId);
    }
    for (const entity of this.entities.values()) {
      if (!entity.puzzleDefinition || !entity.body) continue;
      if (!controlled.has(entity.id)) {
        entity.body.resetForces(false);
        entity.body.resetTorques(false);
      }
      if (entity.body.translation().y < GROUND_HEIGHT - 80) {
        entity.stress = 1;
        this.setPuzzleLifecycle(
          [entity.id],
          "recoverable",
          undefined,
          "fell_from_stage",
        );
      }
    }
  }

  private preparePuzzleSnap(task: PuzzleTask): void {
    const moving = this.entities.get(task.partId);
    const target = this.entities.get(task.targetId);
    if (!moving?.puzzleDefinition || !target?.puzzleDefinition) return;
    const movingAnchor = this.puzzlePose(moving);
    const targetPose = this.puzzlePose(target);
    if (!movingAnchor || !targetPose) return;
    const movingPort = puzzlePortPose(
      moving.puzzleDefinition,
      task.firstPort,
    );
    const targetPort = puzzlePortPose(
      target.puzzleDefinition,
      task.secondPort,
    );
    const rotate = (x: number, y: number, angle: number) => ({
      x: x * Math.cos(angle) - y * Math.sin(angle),
      y: x * Math.sin(angle) + y * Math.cos(angle),
    });
    const targetOffset = rotate(targetPort.x, targetPort.y, targetPose.angle);
    const targetPortX = targetPose.x + targetOffset.x;
    const targetPortY = targetPose.y + targetOffset.y;
    const finalAngle =
      targetPose.angle +
      targetPort.normal +
      Math.PI -
      movingPort.normal;
    const movingOffset = rotate(movingPort.x, movingPort.y, finalAngle);
    const finalAnchor: PuzzleAssemblyPose = {
      id: task.partId,
      x: targetPortX - movingOffset.x,
      y: targetPortY - movingOffset.y,
      angle: finalAngle,
      depth:
        targetPose.depth + targetPort.depth - movingPort.depth + 0.02,
    };
    const start = task.movingIds.flatMap((id) => {
      const pose = this.entities.get(id);
      const resolved = pose ? this.puzzlePose(pose) : undefined;
      return resolved ? [resolved] : [];
    });
    const deltaAngle = finalAnchor.angle - movingAnchor.angle;
    const final = start.map((pose) => {
      const relative = rotate(
        pose.x - movingAnchor.x,
        pose.y - movingAnchor.y,
        deltaAngle,
      );
      return {
        id: pose.id,
        x: finalAnchor.x + relative.x,
        y: finalAnchor.y + relative.y,
        angle: pose.angle + deltaAngle,
        depth: finalAnchor.depth + (pose.depth - movingAnchor.depth),
      };
    });
    task.snapStart = start;
    task.snapFinal = final;
  }

  private snapEase(progress: number): number {
    if (progress < 0.78) {
      const t = progress / 0.78;
      return (t * t * (3 - 2 * t)) * 0.92;
    }
    const t = (progress - 0.78) / 0.22;
    return (
      0.92 +
      0.08 *
        (1 - Math.cos(t * Math.PI * 3) * Math.exp(-4.5 * t))
    );
  }

  private puzzleWorldPort(
    entity: PhysicsEntity,
    portId: string,
  ): { x: number; y: number; depth: number; normal: number } | undefined {
    if (!entity.body || !entity.puzzleDefinition) return undefined;
    const local = puzzlePortPose(entity.puzzleDefinition, portId);
    const position = entity.body.translation();
    const angle = entity.body.rotation();
    return {
      x:
        position.x +
        local.x * Math.cos(angle) -
        local.y * Math.sin(angle),
      y:
        position.y +
        local.x * Math.sin(angle) +
        local.y * Math.cos(angle),
      depth: (entity.puzzleDepth ?? 0) + local.depth,
      normal: angle + local.normal,
    };
  }

  private puzzlePortsWithinTolerance(task: PuzzleTask): boolean {
    return this.puzzleConnectionWithinTolerance(
      task.partId,
      task.firstPort,
      task.targetId,
      task.secondPort,
    );
  }

  private puzzleConnectionWithinTolerance(
    firstId: string,
    firstPortId: string,
    secondId: string,
    secondPortId: string,
  ): boolean {
    const first = this.entities.get(firstId);
    const second = this.entities.get(secondId);
    const firstPort = first?.puzzleDefinition?.ports.find(
      (port) => port.id === firstPortId,
    );
    const secondPort = second?.puzzleDefinition?.ports.find(
      (port) => port.id === secondPortId,
    );
    if (!first || !second || !firstPort || !secondPort) return false;
    const rule = connectionRule(firstPort, secondPort);
    const firstWorld = this.puzzleWorldPort(first, firstPortId);
    const secondWorld = this.puzzleWorldPort(second, secondPortId);
    if (!rule || !firstWorld || !secondWorld) return false;
    const distance = Math.hypot(
      firstWorld.x - secondWorld.x,
      firstWorld.y - secondWorld.y,
      (firstWorld.depth - secondWorld.depth) * STAGE_DEPTH_SCALE,
    );
    const normalError = Math.abs(
      Math.atan2(
        Math.sin(firstWorld.normal - secondWorld.normal - Math.PI),
        Math.cos(firstWorld.normal - secondWorld.normal - Math.PI),
      ),
    );
    const firstEntity = this.entities.get(firstId);
    const secondEntity = this.entities.get(secondId);
    const flexibleLine = [firstEntity, secondEntity].find(
      (entity) => entity?.puzzleDefinition?.componentType === "lashing",
    );
    if (rule.joint === "rope" && flexibleLine?.body) {
      const matePort = flexibleLine.id === firstId ? secondWorld : firstWorld;
      const lineCenter = flexibleLine.body.translation();
      const availableLength = Math.max(24, flexibleLine.puzzleDefinition?.width ?? 0);
      const centerReach = Math.hypot(
        matePort.x - lineCenter.x,
        matePort.y - lineCenter.y,
      );
      const depthError =
        Math.abs(firstWorld.depth - secondWorld.depth) * STAGE_DEPTH_SCALE;
      return (
        centerReach <= availableLength * 0.96 &&
        depthError <= Math.max(rule.tolerance.distance, 20) &&
        normalError <= (rule.tolerance.angleDegrees * Math.PI) / 180
      );
    }
    return (
      distance <= rule.tolerance.distance &&
      normalError <= (rule.tolerance.angleDegrees * Math.PI) / 180
    );
  }

  private createPuzzleJoint(
    connection: PuzzleConnection,
  ): RAPIER.ImpulseJoint | undefined {
    const first = this.entities.get(connection.firstId);
    const second = this.entities.get(connection.secondId);
    const firstPort = first?.puzzleDefinition?.ports.find(
      (port) => port.id === connection.firstPort,
    );
    const secondPort = second?.puzzleDefinition?.ports.find(
      (port) => port.id === connection.secondPort,
    );
    if (!first?.body || !second?.body || !firstPort || !secondPort) {
      return undefined;
    }
    const rule = connectionRule(firstPort, secondPort);
    if (!rule) return undefined;
    const firstAnchor = puzzlePortPose(first.puzzleDefinition!, firstPort.id);
    const secondAnchor = puzzlePortPose(second.puzzleDefinition!, secondPort.id);
    let data: RAPIER.JointData;
    switch (rule.joint) {
      case "fixed":
        data = RAPIER.JointData.fixed(
          { x: firstAnchor.x, y: firstAnchor.y },
          0,
          { x: secondAnchor.x, y: secondAnchor.y },
          first.body.rotation() - second.body.rotation(),
        );
        break;
      case "revolute":
        data = RAPIER.JointData.revolute(
          { x: firstAnchor.x, y: firstAnchor.y },
          { x: secondAnchor.x, y: secondAnchor.y },
        );
        break;
      case "rope":
        data = RAPIER.JointData.rope(
          Math.max(3, rule.backlash * 80),
          { x: firstAnchor.x, y: firstAnchor.y },
          { x: secondAnchor.x, y: secondAnchor.y },
        );
        break;
    }
    const joint = this.world.createImpulseJoint(
      data,
      first.body,
      second.body,
      true,
    );
    joint.setContactsEnabled(false);
    this.joints.push(joint);
    return joint;
  }

  private removePuzzleJoint(connection: PuzzleConnection): void {
    if (!connection.joint) return;
    const index = this.joints.indexOf(connection.joint);
    if (index >= 0) this.joints.splice(index, 1);
    this.world.removeImpulseJoint(connection.joint, true);
    delete connection.joint;
  }

  private puzzleMotionInterrupted(
    task: PuzzleTask,
    worker: PhysicsEntity,
    result: { blocked: boolean; obstacleIds: string[] },
  ): boolean {
    if (!result.blocked) {
      delete task.blockedSince;
      return false;
    }
    if (
      task.phase === "stage_target" &&
      result.obstacleIds.length > 0 &&
      result.obstacleIds.every((id) => id === "stage_floor")
    ) {
      delete task.blockedSince;
      return false;
    }
    task.blockedSince ??= this.elapsed;
    const workerX = worker.body?.translation().x ?? task.buildX;
    if (this.elapsed - (task.lastImpactAt ?? -Infinity) > 0.65) {
      task.lastImpactAt = this.elapsed;
      this.emitSound("impact", worker.team, 0.42, workerX);
      for (const obstacleId of result.obstacleIds) {
        const obstacle = this.entities.get(obstacleId);
        if (obstacle) {
          obstacle.stress = Math.max(obstacle.stress, 0.45);
          if (obstacle.kind === "block") this.wakeTower();
        }
      }
    }
    if (this.elapsed - task.blockedSince <= 1.6) return false;
    this.finishPuzzleTask(task.workerId, false);
    return true;
  }

  private updatePuzzleTasks(): void {
    for (const [workerId, task] of this.puzzleTasks) {
      const worker = this.entities.get(workerId);
      const anchor = this.entities.get(task.partId);
      const target = this.entities.get(task.targetId);
      if (!worker?.body || !worker.alive || !anchor?.body || !target?.body) {
        this.finishPuzzleTask(workerId, false);
        continue;
      }
      const helpers = task.helperIds.flatMap((id) => {
        const helper = this.entities.get(id);
        return helper?.body && helper.alive ? [helper] : [];
      });
      if (helpers.length !== task.helperIds.length) {
        this.finishPuzzleTask(workerId, false);
        continue;
      }
      const handlerCount = 1 + helpers.length;
      for (const [index, helper] of helpers.entries()) {
        helper.movementTarget = Math.max(
          54,
          Math.min(
            WORLD_WIDTH - 54,
            (worker.movementTarget ?? worker.body.translation().x) +
              (worker.team === "king" ? -1 : 1) * (18 + index * 14),
          ),
        );
        this.setMovementDepth(
          helper,
          (worker.movementDepthTarget ?? worker.puzzleDepth ?? 0) +
            (index % 2 === 0 ? 0.32 : -0.32),
        );
        if (worker.taskTargetId) helper.taskTargetId = worker.taskTargetId;
        else delete helper.taskTargetId;
        if (worker.taskOperation) helper.taskOperation = worker.taskOperation;
        else delete helper.taskOperation;
        if (worker.taskProgress !== undefined) {
          helper.taskProgress = worker.taskProgress;
        } else delete helper.taskProgress;
        helper.activity = worker.activity ?? "idle";
        helper.activityUntil = this.elapsed + 0.5;
        if (worker.carryingId) helper.carryingId = worker.carryingId;
        else delete helper.carryingId;
      }
      if (this.elapsed - task.startedAt > 120) {
        this.finishPuzzleTask(workerId, false);
        continue;
      }
      const workerPosition = worker.body.translation();
      const anchorPosition = anchor.body.translation();
      const targetPosition = target.body.translation();

      if (task.phase === "fetch_target") {
        this.setPuzzleLifecycle(task.targetIds, "being_fetched", workerId, "fetch_target");
        const fetchX = this.puzzleApproachX(worker, target);
        worker.movementTarget = fetchX;
        this.setMovementDepth(worker, target.puzzleDepth);
        worker.taskTargetId = task.targetId;
        worker.taskOperation = "fetch";
        worker.taskProgress = Math.max(
          0,
          1 - this.puzzleReachDistance(worker, target) / 220,
        );
        worker.activity = "march";
        worker.activityUntil = this.elapsed + 0.5;
        if (
          this.puzzleReachDistance(worker, target) <= 22 ||
          (Math.abs(fetchX - workerPosition.x) <= 16 &&
            Math.abs(
              (target.puzzleDepth ?? 0) - (worker.puzzleDepth ?? 0),
            ) <= 0.5)
        ) {
          task.phase = "stage_target";
          task.progress = 0;
          task.phaseStartedAt = this.elapsed;
          worker.carryingId = task.targetId;
          worker.taskOperation = "carry";
          for (const targetId of task.targetIds) {
            const entity = this.entities.get(targetId);
            if (entity) entity.assemblyState = "carried";
          }
          this.setPuzzleLifecycle(task.targetIds, "carried", workerId, "lift_target");
        }
        continue;
      }

      if (task.phase === "stage_target") {
        worker.movementTarget = task.buildX;
        worker.movementDepthTarget = task.buildDepth;
        worker.taskTargetId = task.targetId;
        worker.taskOperation = "carry";
        worker.taskProgress = Math.max(
          0,
          1 -
            Math.hypot(
              task.buildX - workerPosition.x,
              (task.buildDepth - (worker.puzzleDepth ?? 0)) *
                STAGE_DEPTH_SCALE,
            ) /
              720,
        );
        worker.activity = "carry";
        worker.activityUntil = this.elapsed + 0.5;
        const atBuildSite =
          Math.abs(task.buildX - workerPosition.x) <= 42 &&
          Math.abs(task.buildDepth - (worker.puzzleDepth ?? 0)) <= 0.7;
        const carryY = this.puzzleCarryY(target);
        task.targetLifted ||= targetPosition.y >= carryY - 12;
        const lifted = task.targetLifted === true;
        const movingToPlacementColumn = atBuildSite && lifted;
        const readyToPlace =
          movingToPlacementColumn &&
          Math.abs(targetPosition.x - task.buildX) <= 14 &&
          Math.abs((target.puzzleDepth ?? 0) - task.buildDepth) <= 0.32;
        const carryResult = this.translatePuzzleAssembly(
          task.targetIds,
          task.targetId,
          movingToPlacementColumn
            ? task.buildX
            : lifted
              ? workerPosition.x + (worker.team === "king" ? 24 : -24)
              : targetPosition.x,
          readyToPlace
            ? this.puzzleGroundY(target)
            : carryY,
          movingToPlacementColumn
            ? task.buildDepth
            : lifted
              ? (worker.puzzleDepth ?? task.buildDepth)
              : (target.puzzleDepth ?? task.buildDepth),
          [],
          false,
          handlerCount,
        );
        if (this.puzzleMotionInterrupted(task, worker, carryResult)) continue;
        if (readyToPlace) {
          const stagedPosition = target.body.translation();
          if (
            Math.hypot(
              stagedPosition.x - task.buildX,
              stagedPosition.y - this.puzzleGroundY(target),
              ((target.puzzleDepth ?? 0) - task.buildDepth) * STAGE_DEPTH_SCALE,
            ) > 10 ||
            Math.hypot(
              target.body.linvel().x,
              target.body.linvel().y,
            ) > 14
          ) {
            continue;
          }
          task.targetIds.forEach((targetId) => {
            const entity = this.entities.get(targetId);
            if (entity) {
              entity.assemblyState = "staged";
              entity.body?.resetForces(true);
              entity.body?.resetTorques(true);
            }
          });
          this.setPuzzleLifecycle(task.targetIds, "staged", workerId, "stage_target");
          task.phase = "fetch";
          task.progress = 0;
          task.phaseStartedAt = this.elapsed;
          delete worker.carryingId;
          worker.taskTargetId = task.partId;
          worker.movementTarget = anchorPosition.x;
          this.setMovementDepth(worker, anchor.puzzleDepth);
        }
        continue;
      }

      if (task.phase === "fetch") {
        this.setPuzzleLifecycle(task.movingIds, "being_fetched", workerId, "fetch_part");
        const fetchX = this.puzzleApproachX(worker, anchor);
        worker.movementTarget = fetchX;
        this.setMovementDepth(worker, anchor.puzzleDepth);
        worker.taskTargetId = task.partId;
        worker.taskOperation = "fetch";
        worker.taskProgress = Math.max(
          0,
          1 - this.puzzleReachDistance(worker, anchor) / 220,
        );
        worker.activity = "march";
        worker.activityUntil = this.elapsed + 0.5;
        if (
          this.puzzleReachDistance(worker, anchor) <= 22 ||
          (Math.abs(fetchX - workerPosition.x) <= 16 &&
            Math.abs(
              (anchor.puzzleDepth ?? 0) - (worker.puzzleDepth ?? 0),
            ) <= 0.5)
        ) {
          task.phase = "carry";
          task.progress = 0;
          task.phaseStartedAt = this.elapsed;
          worker.carryingId = task.partId;
          worker.taskOperation = "carry";
          for (const movingId of task.movingIds) {
            const entity = this.entities.get(movingId);
            if (entity) entity.assemblyState = "carried";
          }
          this.setPuzzleLifecycle(task.movingIds, "carried", workerId, "lift_part");
        }
        continue;
      }

      if (task.phase === "carry") {
        const approach = Math.max(
          42,
          Math.min(
            WORLD_WIDTH - 42,
            targetPosition.x + (worker.team === "king" ? -72 : 72),
          ),
        );
        worker.movementTarget = approach;
        this.setMovementDepth(worker, target.puzzleDepth);
        worker.taskTargetId = task.targetId;
        worker.taskOperation = "carry";
        worker.taskProgress = Math.max(
          0,
          1 - Math.abs(approach - workerPosition.x) / 520,
        );
        worker.activity = "carry";
        worker.activityUntil = this.elapsed + 0.5;
        const carryY = this.puzzleCarryY(anchor);
        task.movingLifted ||= anchorPosition.y >= carryY - 12;
        const lifted = task.movingLifted === true;
        const carryResult = this.translatePuzzleAssembly(
          task.movingIds,
          task.partId,
          lifted
            ? workerPosition.x + (worker.team === "king" ? 24 : -24)
            : anchorPosition.x,
          carryY,
          lifted
            ? (worker.puzzleDepth ?? target.puzzleDepth ?? 0)
            : (anchor.puzzleDepth ?? 0),
          [],
          false,
          handlerCount,
        );
        if (this.puzzleMotionInterrupted(task, worker, carryResult)) continue;
        if (
          Math.abs(approach - workerPosition.x) <= 42 &&
          Math.abs(
            (target.puzzleDepth ?? 0) - (worker.puzzleDepth ?? 0),
          ) <= 0.8 &&
          Math.hypot(
            anchorPosition.x -
              (workerPosition.x + (worker.team === "king" ? 24 : -24)),
            anchorPosition.y - carryY,
          ) <= 22
        ) {
          task.phase = "snap";
          task.progress = 0;
          task.phaseStartedAt = this.elapsed;
          for (const targetId of task.targetIds) {
            const targetBody = this.entities.get(targetId)?.body;
            targetBody?.resetForces(true);
            targetBody?.resetTorques(true);
          }
          this.preparePuzzleSnap(task);
          delete worker.movementTarget;
          worker.taskOperation = "snap";
          this.setPuzzleLifecycle(
            [...task.movingIds, ...task.targetIds],
            "aligning",
            workerId,
            "align_ports",
          );
        }
        continue;
      }

      if (task.phase === "release") {
        worker.taskOperation = "position";
        worker.taskProgress = Math.min(
          1,
          (this.elapsed - task.phaseStartedAt) / 0.6,
        );
        worker.activity = "build";
        worker.activityUntil = this.elapsed + 0.5;
        if (this.elapsed - task.phaseStartedAt < 0.6) continue;
        delete worker.carryingId;
        this.setPuzzleLifecycle(
          [...new Set([...task.movingIds, ...this.assemblyPartIds(task.targetId)])],
          "supported",
          workerId,
          "release_to_joint",
        );
        task.phase = "test";
        task.phaseStartedAt = this.elapsed;
        task.progress = 0;
        continue;
      }

      if (task.phase === "retreat") {
        const direction: -1 | 1 = worker.team === "king" ? -1 : 1;
        const retreatX = this.puzzleClearanceX(
          worker,
          [...new Set([...task.movingIds, ...task.targetIds])],
          direction,
        );
        worker.movementTarget = retreatX;
        this.setMovementDepth(worker, task.buildDepth);
        worker.taskOperation = "position";
        worker.taskProgress = Math.max(
          0,
          1 - Math.abs(retreatX - workerPosition.x) / 100,
        );
        worker.activity = "march";
        worker.activityUntil = this.elapsed + 0.5;
        const clearOfAssembly =
          direction < 0
            ? workerPosition.x <= retreatX + 10
            : workerPosition.x >= retreatX - 10;
        if (clearOfAssembly) {
          this.finishPuzzleTask(workerId, true);
        }
        continue;
      }

      if (task.phase === "test") {
        worker.taskOperation = "inspect";
        worker.taskProgress = Math.min(
          1,
          (this.elapsed - task.phaseStartedAt) / 0.9,
        );
        worker.activity = "inspect";
        worker.activityUntil = this.elapsed + 0.5;
        if (!task.testApplied) {
          task.testApplied = true;
          const direction = worker.team === "king" ? 1 : -1;
          anchor.body.applyImpulse({ x: direction * 6, y: 2 }, true);
          anchor.body.applyTorqueImpulse(direction * 1.8, true);
          this.emitSound("impact", worker.team, 0.24, anchor.body.translation().x);
        }
        if (this.elapsed - task.phaseStartedAt < 0.9) continue;
        this.setPuzzleLifecycle(
          [...new Set([...task.movingIds, ...this.assemblyPartIds(task.targetId)])],
          "tested",
          workerId,
          "proof_test",
        );
        task.phase = "retreat";
        task.phaseStartedAt = this.elapsed;
        task.progress = 0;
        continue;
      }

      if (!task.snapStart || !task.snapFinal) this.preparePuzzleSnap(task);
      task.progress = Math.min(1, task.progress + FIXED_STEP / 3.1);
      worker.taskOperation = "snap";
      worker.taskProgress = task.progress;
      worker.activity = "build";
      worker.activityUntil = this.elapsed + 0.5;
      const eased = this.snapEase(task.progress);
      const snapClearance = Math.max(
        18,
        ...task.movingIds.map((id) => {
          const entity = this.entities.get(id);
          return entity
            ? Math.max(entity.width ?? 0, entity.height ?? 0) * 0.48
            : 18;
        }),
      );
      const lift =
        Math.sin(Math.min(1, eased) * Math.PI) * snapClearance;
      const intendedPoses = task.snapStart?.flatMap((start) => {
        const final = task.snapFinal?.find((pose) => pose.id === start.id);
        if (!final) return [];
        return [{
          id: start.id,
          x: start.x + (final.x - start.x) * eased,
          y: start.y + (final.y - start.y) * eased + lift,
          angle: start.angle + (final.angle - start.angle) * eased,
          depth: start.depth + (final.depth - start.depth) * eased,
        }];
      }) ?? [];
      const snapResult = this.movePuzzleAssemblyToPoses(
        intendedPoses,
        task.targetIds,
        handlerCount,
      );
      if (this.puzzleMotionInterrupted(task, worker, snapResult)) continue;
      if (task.progress >= 1) {
        if (this.assemblyPartIds(task.partId).includes(task.targetId)) {
          this.finishPuzzleTask(workerId, false);
          continue;
        }
        if (!this.puzzlePortsWithinTolerance(task)) {
          task.progress = 0.995;
          continue;
        }
        if (
          Math.min(
            this.puzzleReachDistance(worker, anchor),
            this.puzzleReachDistance(worker, target),
          ) > 54
        ) {
          this.finishPuzzleTask(workerId, false);
          continue;
        }
        const connection: PuzzleConnection = {
          id: `snap_${this.puzzleConnections.length}`,
          firstId: task.partId,
          firstPort: task.firstPort,
          secondId: task.targetId,
          secondPort: task.secondPort,
          integrity: 1,
          currentLoad: 0,
          state: "locked",
        };
        const joint = this.createPuzzleJoint(connection);
        if (!joint) {
          this.finishPuzzleTask(workerId, false);
          continue;
        }
        connection.joint = joint;
        this.puzzleConnections.push(connection);
        task.connectionId = connection.id;
        for (const installedId of [
          ...task.movingIds,
          ...this.assemblyPartIds(task.targetId),
        ]) {
          const entity = this.entities.get(installedId);
          if (entity) entity.assemblyState = "installed";
        }
        this.setPuzzleLifecycle(
          [...new Set([...task.movingIds, ...this.assemblyPartIds(task.targetId)])],
          "connected",
          workerId,
          "connect_ports",
        );
        this.operationHistory.add("snap");
        this.emitSound("impact", worker.team, 0.34, targetPosition.x);
        const movingPort = anchor.puzzleDefinition?.ports.find(
          (port) => port.id === task.firstPort,
        );
        const targetPort = target.puzzleDefinition?.ports.find(
          (port) => port.id === task.secondPort,
        );
        this.puzzleSnapEvents.push({
          id: `snap_event_${this.puzzleConnections.length}`,
          at: this.elapsed,
          workerId,
          team: worker.team === "queen" ? "queen" : "king",
          movingLabel: anchor.puzzleDefinition?.label ?? anchor.id,
          targetLabel: target.puzzleDefinition?.label ?? target.id,
          movingPortKind: movingPort?.kind ?? "port",
          targetPortKind: targetPort?.kind ?? "port",
          targetId: target.id,
          x: targetPosition.x,
          y: targetPosition.y,
          depth: target.puzzleDepth ?? 0,
          gainedCapabilities: task.gainedCapabilities,
          resultCapabilities: task.resultCapabilities,
        });
        this.puzzleSnapEvents = this.puzzleSnapEvents.slice(-12);
        task.phase = "release";
        task.phaseStartedAt = this.elapsed;
        task.progress = 0;
      }
    }
  }

  private finishPuzzleTask(workerId: string, completed: boolean): void {
    const task = this.puzzleTasks.get(workerId);
    for (const partId of [...(task?.movingIds ?? []), ...(task?.targetIds ?? [])]) {
      const body = this.entities.get(partId)?.body;
      body?.resetForces(true);
      body?.resetTorques(true);
    }
    if (!completed && task) {
      for (const partId of [...task.movingIds, ...task.targetIds]) {
        const entity = this.entities.get(partId);
        if (!entity?.puzzleDefinition) continue;
        entity.assemblyState =
          this.assemblyPartIds(partId).length > 1 ? "installed" : "stock";
      }
      this.setPuzzleLifecycle(
        [...task.movingIds, ...task.targetIds],
        "recoverable",
        workerId,
        "connect_interrupted",
      );
    }
    const worker = this.entities.get(workerId);
    if (worker) {
      delete worker.movementTarget;
      delete worker.movementDepthTarget;
      delete worker.movementPlanGoalX;
      delete worker.movementPlanGoalDepth;
      delete worker.movementWaypoints;
      delete worker.carryingId;
      delete worker.taskOperation;
      delete worker.taskTargetId;
      delete worker.taskProgress;
      worker.activity = completed ? "inspect" : "idle";
      worker.activityUntil = this.elapsed + (completed ? 1.2 : 0);
    }
    for (const helperId of task?.helperIds ?? []) {
      const helper = this.entities.get(helperId);
      if (!helper) continue;
      delete helper.movementTarget;
      delete helper.movementDepthTarget;
      delete helper.movementPlanGoalX;
      delete helper.movementPlanGoalDepth;
      delete helper.movementWaypoints;
      delete helper.carryingId;
      delete helper.taskOperation;
      delete helper.taskTargetId;
      delete helper.taskProgress;
      helper.activity = completed ? "inspect" : "idle";
      helper.activityUntil = this.elapsed + (completed ? 1.2 : 0);
      this.nextLocalInitiativeAt.set(
        helperId,
        this.elapsed + (completed ? 0.65 : 0.9),
      );
    }
    this.puzzleTasks.delete(workerId);
    this.nextLocalInitiativeAt.set(
      workerId,
      this.elapsed + (completed ? 0.65 : 0.9),
    );
  }

  private updatePuzzleConnectionLoads(): void {
    for (const connection of this.puzzleConnections) {
      if (connection.state === "failed") continue;
      const first = this.entities.get(connection.firstId);
      const second = this.entities.get(connection.secondId);
      const firstPort = first?.puzzleDefinition?.ports.find(
        (port) => port.id === connection.firstPort,
      );
      const secondPort = second?.puzzleDefinition?.ports.find(
        (port) => port.id === connection.secondPort,
      );
      if (!firstPort || !secondPort) continue;
      const rule = connectionRule(firstPort, secondPort);
      if (!rule) continue;
      const assembly = this.puzzleAssembly(connection.firstId);
      const dynamicStress = Math.max(first?.stress ?? 0, second?.stress ?? 0);
      const rescueLoad =
        this.puzzleRescueAssemblyId &&
        assembly?.partIds.includes(this.puzzleRescueAssemblyId)
          ? 640
          : 0;
      const measured =
        (assembly?.mass ?? 0) * 3.5 + dynamicStress * 1600 + rescueLoad;
      connection.currentLoad =
        connection.currentLoad * 0.82 + measured * 0.18;
      if (connection.currentLoad >= rule.safeLoad) {
        connection.state = "yielding";
        connection.integrity = Math.max(
          0,
          connection.integrity -
            ((connection.currentLoad - rule.safeLoad) /
              Math.max(1, rule.breakForce - rule.safeLoad)) *
              FIXED_STEP *
              0.16,
        );
      } else if (connection.currentLoad >= rule.warningLoad) {
        connection.state = "loaded";
      } else {
        connection.state = "locked";
      }
      const loadRatio = Math.min(1, connection.currentLoad / rule.breakForce);
      if (first) first.stress = Math.max(first.stress, loadRatio);
      if (second) second.stress = Math.max(second.stress, loadRatio);
      if (connection.integrity <= 0 || connection.currentLoad >= rule.breakForce) {
        connection.integrity = 0;
        connection.state = "failed";
        this.removePuzzleJoint(connection);
        this.setPuzzleLifecycle(
          [connection.firstId, connection.secondId],
          "damaged",
          undefined,
          `joint_failed:${rule.failureState}`,
        );
        this.emitSound("impact", first?.team, 0.9, first?.body?.translation().x ?? TOWER_X);
      }
    }
  }

  private beginPuzzleRecovery(
    agent: AgentDefinition,
    worker: PhysicsEntity,
    partId: string,
  ): ActionResolution {
    const part = this.entities.get(partId);
    if (
      agent.team === "humpty" ||
      !worker.body ||
      !part?.puzzleDefinition ||
      !part.body ||
      part.team !== agent.team
    ) {
      return { accepted: false, reason: "Only loose friendly parts can be recovered" };
    }
    if (this.assemblyPartIds(partId).length > 1) {
      return { accepted: false, reason: "Detach the part before recovery" };
    }
    if (this.puzzleWorkerBusy(worker.id)) {
      return { accepted: false, reason: "Worker already has a physical task" };
    }
    this.puzzleRecoveryTasks.set(worker.id, {
      workerId: worker.id,
      partId,
      phase: "fetch",
      targetX:
        worker.team === "king"
          ? Math.max(32, this.entityHalfExtents(part).x + 3)
          : Math.min(
              WORLD_WIDTH - 32,
              WORLD_WIDTH - this.entityHalfExtents(part).x - 3,
            ),
      targetDepth:
        (part.puzzleDepth ?? 0) <= 0
          ? FLOOR_DEPTH_MIN + 0.45
          : FLOOR_DEPTH_MAX - 0.45,
    });
    this.setPuzzleLifecycle([partId], "being_fetched", worker.id, "recover_fetch");
    worker.movementTarget = this.puzzleApproachX(worker, part);
    this.setMovementDepth(worker, part.puzzleDepth);
    worker.taskOperation = "fetch";
    worker.taskTargetId = partId;
    worker.activity = "march";
    worker.activityUntil = this.elapsed + 20;
    return { accepted: true, entityId: partId };
  }

  private updatePuzzleRecoveryTasks(): void {
    for (const [workerId, task] of this.puzzleRecoveryTasks) {
      const worker = this.entities.get(workerId);
      const part = this.entities.get(task.partId);
      if (!worker?.body || !worker.alive || !part?.body || !part.puzzleDefinition) {
        this.puzzleRecoveryTasks.delete(workerId);
        continue;
      }
      if (task.phase === "retreat") {
        const direction: -1 | 1 = worker.team === "king" ? 1 : -1;
        const retreatX = this.puzzleClearanceX(worker, [part.id], direction);
        worker.movementTarget = retreatX;
        this.setMovementDepth(worker, task.targetDepth);
        worker.taskOperation = "position";
        worker.taskProgress = Math.max(
          0,
          1 - Math.abs(retreatX - worker.body.translation().x) / 100,
        );
        worker.activity = "march";
        worker.activityUntil = this.elapsed + 0.5;
        const workerX = worker.body.translation().x;
        const clearOfPart =
          direction < 0 ? workerX <= retreatX + 10 : workerX >= retreatX - 10;
        if (!clearOfPart) {
          continue;
        }
        delete worker.movementTarget;
        delete worker.movementDepthTarget;
        this.clearLivingPath(worker);
        delete worker.taskOperation;
        delete worker.taskTargetId;
        delete worker.taskProgress;
        worker.activity = "inspect";
        worker.activityUntil = this.elapsed + 1;
        this.puzzleRecoveryTasks.delete(workerId);
        this.nextLocalInitiativeAt.set(workerId, this.elapsed + 0.8);
        continue;
      }
      if (task.phase === "settle") {
        part.body.resetForces(true);
        part.body.resetTorques(true);
        const position = part.body.translation();
        const settled =
          Math.abs(position.x - task.targetX) <= 36 &&
          Math.abs((part.puzzleDepth ?? 0) - task.targetDepth) <= 0.32 &&
          Math.abs(position.y - this.puzzleGroundY(part)) <= 5 &&
          Math.hypot(part.body.linvel().x, part.body.linvel().y) <= 9;
        if (!settled) continue;
        part.collider?.setCollisionGroups(PUZZLE_COLLISION_GROUPS);
        delete part.expiresAt;
        part.sourceX = task.targetX;
        part.sourceY = task.targetDepth;
        part.assemblyState = "stock";
        this.setPuzzleLifecycle([part.id], "stored_or_reused", workerId, "recover_store");
        delete worker.carryingId;
        task.phase = "retreat";
        worker.activity = "march";
        worker.activityUntil = this.elapsed + 0.5;
        continue;
      }
      if (task.phase === "fetch") {
        const fetchX = this.puzzleApproachX(worker, part);
        worker.movementTarget = fetchX;
        this.setMovementDepth(worker, part.puzzleDepth);
        worker.taskOperation = "fetch";
        worker.taskProgress = Math.max(0, 1 - this.puzzleReachDistance(worker, part) / 220);
        worker.activity = "march";
        worker.activityUntil = this.elapsed + 0.5;
        if (
          this.puzzleReachDistance(worker, part) > 22 &&
          !(
            Math.abs(fetchX - worker.body.translation().x) <= 16 &&
            Math.abs(
              (part.puzzleDepth ?? 0) - (worker.puzzleDepth ?? 0),
            ) <= 0.5
          )
        ) continue;
        task.phase = "carry";
        worker.carryingId = part.id;
        part.assemblyState = "carried";
        this.setPuzzleLifecycle([part.id], "carried", workerId, "recover_lift");
      }

      // Return damaged pieces to the open bay selected outside the dense rack.
      const stockX = task.targetX;
      const stockDepth = task.targetDepth;
      worker.movementTarget = stockX;
      this.setMovementDepth(worker, stockDepth);
      worker.taskOperation = "carry";
      worker.taskProgress = Math.max(
        0,
        1 - Math.abs(stockX - worker.body.translation().x) / 900,
      );
      worker.activity = "carry";
      worker.activityUntil = this.elapsed + 0.5;
      const partPosition = part.body.translation();
      const carryY = this.puzzleCarryY(part);
      task.lifted ||= partPosition.y >= carryY - 12;
      const workerAtStock =
        Math.abs(stockX - worker.body.translation().x) <= 48 &&
        Math.abs(stockDepth - (worker.puzzleDepth ?? 0)) <= 1.35;
      const result = this.translatePuzzleAssembly(
        [part.id],
        part.id,
        !task.lifted
          ? partPosition.x
          : workerAtStock
            ? stockX
            : worker.body.translation().x + (worker.team === "king" ? -24 : 24),
        task.lifted && workerAtStock ? this.puzzleGroundY(part) : carryY,
        !task.lifted
          ? (part.puzzleDepth ?? stockDepth)
          : workerAtStock
            ? stockDepth
            : (worker.puzzleDepth ?? stockDepth),
      );
      if (!workerAtStock) continue;
      if (
        Math.hypot(
          partPosition.x - stockX,
          ((part.puzzleDepth ?? 0) - stockDepth) * STAGE_DEPTH_SCALE,
        ) <= 36 &&
        partPosition.y - this.puzzleGroundY(part) <= 30 &&
        Math.hypot(part.body.linvel().x, part.body.linvel().y) <= 14
      ) {
        task.phase = "settle";
        part.body.resetForces(true);
        part.body.resetTorques(true);
        delete worker.carryingId;
        worker.taskOperation = "position";
        worker.activity = "build";
        continue;
      }
      if (result.blocked) continue;
      if (
        Math.hypot(
          partPosition.x - stockX,
          partPosition.y - this.puzzleGroundY(part),
          ((part.puzzleDepth ?? 0) - stockDepth) * STAGE_DEPTH_SCALE,
        ) > 10 ||
        Math.hypot(part.body.linvel().x, part.body.linvel().y) > 14
      ) continue;
      part.body.resetForces(true);
      part.body.resetTorques(true);
      task.phase = "settle";
    }
  }

  private updateLocalInitiative(): void {
    if (this.winner || this.manualPaused) return;
    const reservations = new Set<string>();
    for (const task of this.puzzleTasks.values()) {
      task.movingIds.forEach((id) => reservations.add(id));
      task.targetIds.forEach((id) => reservations.add(id));
    }
    for (const task of this.puzzleRecoveryTasks.values()) {
      reservations.add(task.partId);
    }
    for (const worker of AGENTS) {
      if (
        worker.team === "humpty" ||
        worker.id === "king" ||
        worker.id === "queen" ||
        this.activeTeamDecisions.has(worker.team) ||
        !this.isAgentAlive(worker) ||
        this.puzzleWorkerBusy(worker.id) ||
        (this.entities.get(worker.id)?.combatUntil ?? 0) > this.elapsed ||
        this.elapsed < (this.nextLocalInitiativeAt.get(worker.id) ?? Infinity)
      ) {
        continue;
      }
      const submission = this.fallbackSubmissionFor(worker, reservations);
      if (
        submission.action.type === "wait" ||
        submission.action.type === "move"
      ) {
        this.nextLocalInitiativeAt.set(worker.id, this.elapsed + 1.4);
        continue;
      }
      const validated = validateSubmission(submission);
      const resolution = validated.accepted
        ? this.applyAction(worker, validated.submission)
        : { accepted: false, reason: validated.reason };
      if (resolution.accepted && validated.submission.say) {
        this.announce(
          this.turn,
          worker.id,
          worker.name,
          worker.team,
          validated.submission.say,
          this.rng.range(100, 420),
        );
      }
      this.writeLedger({
        type: "local_initiative",
        at: new Date().toISOString(),
        turn: this.turn,
        agentId: worker.id,
        team: worker.team,
        action: validated.submission,
        accepted: resolution.accepted,
        rejection: resolution.reason ?? null,
      });
      this.nextLocalInitiativeAt.set(
        worker.id,
        this.elapsed + (resolution.accepted ? 1.2 : 0.7),
      );
    }
  }

  private testPuzzleAssembly(
    agent: AgentDefinition,
    worker: PhysicsEntity,
    partId: string,
    effort: number,
  ): ActionResolution {
    const assembly = this.puzzleAssembly(partId);
    const part = this.entities.get(partId);
    if (
      agent.team === "humpty" ||
      !worker.body ||
      !assembly ||
      assembly.partIds.length < 2 ||
      !part?.body ||
      part.team !== agent.team
    ) {
      return { accepted: false, reason: "Only a joined friendly assembly can be proof-tested" };
    }
    if (this.stageDistance(worker, part) > 190) {
      worker.movementTarget = part.body.translation().x;
      this.setMovementDepth(worker, part.puzzleDepth);
      worker.activity = "march";
      worker.activityUntil = this.elapsed + 8;
      return { accepted: false, reason: "Move closer before proof-testing" };
    }
    const memberIds = new Set(assembly.partIds);
    for (const connection of this.puzzleConnections) {
      if (
        connection.state === "failed" ||
        !memberIds.has(connection.firstId) ||
        !memberIds.has(connection.secondId)
      ) {
        continue;
      }
      const first = this.puzzleParts.get(connection.firstId)?.ports.find(
        (port) => port.id === connection.firstPort,
      );
      const second = this.puzzleParts.get(connection.secondId)?.ports.find(
        (port) => port.id === connection.secondPort,
      );
      const rule = first && second ? connectionRule(first, second) : undefined;
      if (!rule) continue;
      connection.currentLoad = Math.max(
        connection.currentLoad,
        rule.warningLoad * (0.35 + effort * 0.55),
      );
      connection.state = connection.currentLoad >= rule.warningLoad ? "loaded" : "locked";
    }
    const signature = assembly.partIds.join("|");
    this.testedPuzzleAssemblies.add(signature);
    this.setPuzzleLifecycle(assembly.partIds, "tested", worker.id, "proof_test");
    worker.activity = "inspect";
    worker.activityUntil = this.elapsed + 6;
    this.puzzleAssemblyCooldownUntil.set(assembly.id, this.elapsed + 6);
    this.emitSound("impact", agent.team, 0.38 + effort * 0.3, part.body.translation().x);
    return { accepted: true, entityId: partId };
  }

  private sabotagePuzzleConnection(
    agent: AgentDefinition,
    worker: PhysicsEntity,
    connectionId: string,
    method: "pull" | "strike" | "cut" | "jam",
  ): ActionResolution {
    if (agent.team === "humpty" || !worker.body) {
      return { accepted: false, reason: "No worker can sabotage that joint" };
    }
    if (!['contest', 'decisive'].includes(this.matchBeat())) {
      return { accepted: false, reason: "Sabotage opens during the contest phase" };
    }
    const connection = this.puzzleConnections.find((item) => item.id === connectionId);
    if (!connection || connection.state === "failed") {
      return { accepted: false, reason: "Connection is already failed or unknown" };
    }
    const first = this.entities.get(connection.firstId);
    const second = this.entities.get(connection.secondId);
    const target = [first, second]
      .filter((entity): entity is PhysicsEntity => !!entity?.body)
      .sort((a, b) => this.stageDistance(worker, a) - this.stageDistance(worker, b))[0];
    if (!target?.body || target.team === agent.team) {
      return { accepted: false, reason: "Sabotage requires a reachable enemy joint" };
    }
    if (this.stageDistance(worker, target) > 175) {
      worker.movementTarget = target.body.translation().x;
      this.setMovementDepth(worker, target.puzzleDepth);
      worker.activity = "march";
      worker.activityUntil = this.elapsed + 8;
      return { accepted: false, reason: "Move closer before sabotaging" };
    }
    const firstPort = first?.puzzleDefinition?.ports.find((port) => port.id === connection.firstPort);
    const secondPort = second?.puzzleDefinition?.ports.find((port) => port.id === connection.secondPort);
    const rule = firstPort && secondPort ? connectionRule(firstPort, secondPort) : undefined;
    if (!rule) return { accepted: false, reason: "Joint has no physical rule" };
    if (method === "cut" && rule.joint !== "rope") {
      return { accepted: false, reason: "Only a rope connection can be cut" };
    }
    const baseDamage = { pull: 0.3, strike: 0.38, cut: 1, jam: 0.24 }[method];
    const loadBonus = Math.min(0.42, connection.currentLoad / rule.breakForce * 0.42);
    connection.integrity = Math.max(0, connection.integrity - baseDamage - loadBonus);
    connection.state = connection.integrity <= 0.18 ? "failed" : "yielding";
    this.setPuzzleLifecycle(
      [connection.firstId, connection.secondId],
      "damaged",
      worker.id,
      `sabotage_${method}`,
    );
    if (connection.state === "failed") {
      connection.integrity = 0;
      this.removePuzzleJoint(connection);
      target.body.applyImpulse(
        { x: agent.team === "king" ? 120 : -120, y: 48 },
        true,
      );
      target.assemblyState = "staged";
    }
    worker.activity = "fight";
    worker.activityUntil = this.elapsed + 4.8;
    this.emitSound(method === "cut" ? "rope" : "impact", agent.team, 0.82, target.body.translation().x);
    return { accepted: true, entityId: target.id };
  }

  private repairPuzzleConnection(
    agent: AgentDefinition,
    worker: PhysicsEntity,
    connectionId: string,
  ): ActionResolution {
    const connection = this.puzzleConnections.find((item) => item.id === connectionId);
    const first = connection ? this.entities.get(connection.firstId) : undefined;
    const second = connection ? this.entities.get(connection.secondId) : undefined;
    if (
      agent.team === "humpty" ||
      !worker.body ||
      !connection ||
      connection.state !== "failed" ||
      !first?.body ||
      !second?.body ||
      first.team !== agent.team ||
      second.team !== agent.team
    ) {
      return { accepted: false, reason: "Repair requires a failed friendly connection" };
    }
    const target = this.stageDistance(worker, first) <= this.stageDistance(worker, second) ? first : second;
    const targetBody = target.body!;
    if (this.stageDistance(worker, target) > 175) {
      worker.movementTarget = targetBody.translation().x;
      this.setMovementDepth(worker, target.puzzleDepth);
      worker.activity = "march";
      worker.activityUntil = this.elapsed + 8;
      return { accepted: false, reason: "Move closer before repairing" };
    }
    if (
      !this.puzzleConnectionWithinTolerance(
        connection.firstId,
        connection.firstPort,
        connection.secondId,
        connection.secondPort,
      )
    ) {
      return {
        accepted: false,
        reason: "Bring the failed ports back into alignment before locking the repair",
      };
    }
    const joint = this.createPuzzleJoint(connection);
    if (!joint) {
      return { accepted: false, reason: "The repaired joint could not take physical load" };
    }
    connection.integrity = 0.72;
    connection.currentLoad = 0;
    connection.joint = joint;
    connection.state = "locked";
    first.assemblyState = "installed";
    second.assemblyState = "installed";
    this.setPuzzleLifecycle([first.id, second.id], "connected", worker.id, "repair_connection");
    worker.activity = "build";
    worker.activityUntil = this.elapsed + 6.4;
    this.emitSound("hammer", agent.team, 0.58, targetBody.translation().x);
    return { accepted: true, entityId: target.id };
  }

  private detachPuzzlePart(
    agent: AgentDefinition,
    worker: PhysicsEntity,
    partId: string,
  ): ActionResolution {
    if (
      this.driver.model !== "mock" &&
      !["contest", "decisive"].includes(this.matchBeat())
    ) {
      return {
        accepted: false,
        reason: "Enemy works cannot be sabotaged before the contest phase",
      };
    }
    const part = this.entities.get(partId);
    if (
      agent.team === "humpty" ||
      !worker.body ||
      !part?.puzzleDefinition ||
      !part.body
    ) {
      return { accepted: false, reason: "That is not a detachable machine part" };
    }
    const distance = this.stageDistance(worker, part);
    if (distance > 175) {
      worker.movementTarget = Math.max(
        42,
        Math.min(WORLD_WIDTH - 42, part.body.translation().x),
      );
      this.setMovementDepth(worker, part.puzzleDepth);
      worker.activity = "march";
      worker.activityUntil = this.elapsed + 8;
      return {
        accepted: false,
        reason: "Move closer before detaching that connection",
      };
    }
    const index = this.puzzleConnections.findIndex(
      (connection) =>
        connection.state !== "failed" &&
        (connection.firstId === partId || connection.secondId === partId),
    );
    if (index < 0) {
      return { accepted: false, reason: "That part has no joined connection" };
    }
    const removed = this.puzzleConnections[index];
    if (!removed) {
      return { accepted: false, reason: "Connection was unavailable" };
    }
    if (part.team !== agent.team) {
      return this.sabotagePuzzleConnection(agent, worker, removed.id, "pull");
    }
    const firstPort = this.puzzleParts.get(removed.firstId)?.ports.find(
      (port) => port.id === removed.firstPort,
    );
    const secondPort = this.puzzleParts.get(removed.secondId)?.ports.find(
      (port) => port.id === removed.secondPort,
    );
    const rule = firstPort && secondPort ? connectionRule(firstPort, secondPort) : undefined;
    if (rule && !rule.detachUnderLoad && removed.currentLoad >= rule.warningLoad) {
      return { accepted: false, reason: "Joint is carrying dangerous load; unload it first" };
    }
    removed.state = "failed";
    removed.integrity = 0.6;
    removed.currentLoad = 0;
    this.removePuzzleJoint(removed);
    part.body.applyImpulse(
      { x: agent.team === "king" ? 96 : -96, y: 42 },
      true,
    );
    part.assemblyState = "staged";
    this.setPuzzleLifecycle([part.id], "detached", worker.id, "detach_connection");
    worker.activity = part.team === agent.team ? "build" : "fight";
    worker.activityUntil = this.elapsed + 2;
    this.emitSound("impact", agent.team, 0.5, part.body.translation().x);
    const rescueIds = this.puzzleRescueAssemblyId
      ? this.assemblyPartIds(this.puzzleRescueAssemblyId)
      : [];
    if (
      this.puzzleRescueAssemblyId &&
      (rescueIds.includes(removed.firstId) ||
        rescueIds.includes(removed.secondId))
    ) {
      this.puzzleRescueAssemblyId = null;
      this.puzzleRescueOperatorId = null;
      this.rescueStarted = false;
      this.rescueControlled = false;
      this.harnessFitted = false;
      this.entities
        .get("humpty")
        ?.body?.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    }
    return { accepted: true, entityId: partId };
  }

  private usePuzzleAssembly(
    agent: AgentDefinition,
    worker: PhysicsEntity,
    partId: string,
    targetId: string,
    effort: number,
  ): ActionResolution {
    if (agent.team === "humpty" || !worker.body) {
      return { accepted: false, reason: "No worker can operate that assembly" };
    }
    const assembly = this.puzzleAssembly(partId);
    const part = this.entities.get(partId);
    const target = this.entities.get(targetId);
    if (!assembly || !part?.body || !target?.body) {
      return { accepted: false, reason: "Assembly or target is unknown" };
    }
    if (
      this.elapsed < (this.puzzleAssemblyCooldownUntil.get(assembly.id) ?? 0)
    ) {
      return { accepted: false, reason: "Assembly is resetting after use" };
    }
    if (part.team !== agent.team) {
      return { accepted: false, reason: "Operate an assembly your team controls" };
    }
    const capabilities = new Set(assembly.capabilities);
    const distance = this.stageDistance(worker, part);
    if (distance > 210) {
      worker.movementTarget = Math.max(
        42,
        Math.min(WORLD_WIDTH - 42, part.body.translation().x),
      );
      this.setMovementDepth(worker, part.puzzleDepth);
      worker.activity = "march";
      worker.activityUntil = this.elapsed + 8;
      return {
        accepted: false,
        reason: "Move closer before operating that assembly",
      };
    }

    if (targetId === "humpty" && agent.team === "king") {
      if (!this.assemblyReadyForHumpty("king", assembly)) {
        return {
          accepted: false,
          reason:
            "Safe rescue needs a joined cradle, tension line, anchor, and braked hoist",
        };
      }
      if (this.elapsed < BUILD_BEAT_AT) {
        return {
          accepted: false,
          reason: "Rescue commissioning opens after stock layout",
        };
      }
      const commissioning = this.commissioningFor("king", assembly);
      if (commissioning.step < 3) {
        const stage = this.commissioningOperation("king", commissioning.step);
        commissioning.step += 1;
        this.puzzleAssemblyCooldownUntil.set(
          assembly.id,
          this.elapsed + stage.duration,
        );
        worker.activity =
          stage.operation === "fit"
            ? "rig"
            : stage.operation === "tension"
              ? "haul"
              : "inspect";
        worker.activityUntil = this.elapsed + stage.duration;
        this.setPuzzleLifecycle(
          assembly.partIds,
          stage.operation === "proof" ? "tested" : stage.operation === "fit" ? "supported" : "tested",
          worker.id,
          `commission_${stage.operation}`,
        );
        this.emitSound(
          stage.operation === "tension" ? "winch" : "rope",
          agent.team,
          0.62,
          part.body.translation().x,
        );
        return { accepted: true, entityId: partId };
      }
      if (this.matchBeat() !== "decisive") {
        return {
          accepted: false,
          reason: "The commissioned rescue must wait for the decisive phase",
        };
      }
      this.puzzleRescueAssemblyId = partId;
      this.puzzleRescueOperatorId = worker.id;
      this.harnessFitted = true;
      this.rescueStarted = true;
      this.rescueControlled = true;
      this.rescueReadyAt = this.elapsed;
      const humpty = this.entities.get("humpty");
      const humptyPosition = humpty?.body?.translation();
      this.puzzleRescueStartedAt = this.elapsed;
      this.puzzleRescueStartX = humptyPosition?.x ?? TOWER_X;
      this.puzzleRescueStartY = humptyPosition?.y ?? TOWER_TOP;
      this.puzzleRescueFixtureMode = false;
      humpty?.body?.wakeUp();
      const lineAnchor = assembly.partIds
        .map((id) => this.entities.get(id))
        .filter((entity): entity is PhysicsEntity => !!entity?.body)
        .sort(
          (first, second) =>
            (second.body?.translation().y ?? 0) -
            (first.body?.translation().y ?? 0),
        )[0];
      if (humpty && lineAnchor) this.createRope("king", lineAnchor, humpty);
      worker.activity = "haul";
      worker.activityUntil = this.elapsed + 45;
      this.setPuzzleLifecycle(assembly.partIds, "operating", worker.id, "operate_rescue");
      return { accepted: true, entityId: partId };
    }

    if (targetId === "humpty" && agent.team === "queen") {
      if (!this.assemblyReadyForHumpty("queen", assembly)) {
        return {
          accepted: false,
          reason:
            "A strong shot needs a supported pivot, throwing arm, and load interface",
        };
      }
      if (this.elapsed < BUILD_BEAT_AT) {
        return {
          accepted: false,
          reason: "Shot commissioning opens after stock layout",
        };
      }
      const commissioning = this.commissioningFor("queen", assembly);
      if (commissioning.step < 3) {
        const stage = this.commissioningOperation("queen", commissioning.step);
        commissioning.step += 1;
        this.puzzleAssemblyCooldownUntil.set(
          assembly.id,
          this.elapsed + stage.duration,
        );
        worker.activity =
          stage.operation === "tension"
            ? "aim"
            : stage.operation === "fit"
              ? "carry"
              : "inspect";
        worker.activityUntil = this.elapsed + stage.duration;
        this.setPuzzleLifecycle(
          assembly.partIds,
          stage.operation === "proof" ? "tested" : stage.operation === "fit" ? "supported" : "tested",
          worker.id,
          `commission_${stage.operation}`,
        );
        this.emitSound(
          stage.operation === "tension" ? "winch" : "impact",
          agent.team,
          0.56,
          part.body.translation().x,
        );
        return { accepted: true, entityId: partId };
      }
      if (this.matchBeat() !== "decisive") {
        return {
          accepted: false,
          reason: "The commissioned shot must wait for the decisive phase",
        };
      }
      const ram = assembly.partIds
        .map((id) => this.entities.get(id))
        .filter(
          (entity): entity is PhysicsEntity =>
            !!entity?.body &&
            !!entity.puzzleDefinition &&
            ["bar", "platform", "brace"].includes(
              entity.puzzleDefinition.componentType,
            ),
        )
        .sort(
          (first, second) =>
            Math.abs((first.body?.translation().x ?? 0) - TOWER_X) -
            Math.abs((second.body?.translation().x ?? 0) - TOWER_X),
        )[0];
      const block = [...this.entities.values()]
        .filter(
          (entity): entity is PhysicsEntity =>
            entity.kind === "block" &&
            !!entity.body &&
            Number(entity.id.split("_")[1] ?? TOWER_BLOCKS) < 6,
        )
        .sort(
          (first, second) =>
            Math.abs(
              (first.body?.translation().x ?? TOWER_X) -
                (ram?.body?.translation().x ?? TOWER_X),
            ) -
            Math.abs(
              (second.body?.translation().x ?? TOWER_X) -
                (ram?.body?.translation().x ?? TOWER_X),
            ),
        )[0];
      if (!ram?.body || !block?.body) {
        return { accepted: false, reason: "No physical ram reaches the tower" };
      }
      const ramPosition = ram.body.translation();
      const blockPosition = block.body.translation();
      const contactGap =
        Math.abs(blockPosition.x - ramPosition.x) -
        this.entityHalfExtents(ram).x -
        this.entityHalfExtents(block).x;
      if (contactGap > 20) {
        return {
          accepted: false,
          reason: "Bring the ram or lever into contact with a lower tower block",
        };
      }
      for (const memberId of assembly.partIds) {
        this.entities
          .get(memberId)
          ?.collider?.setCollisionGroups(
            ((PUZZLE_MEMBERSHIP << 16) | (0x0001 | TOWER_MEMBERSHIP)) >>> 0,
          );
      }
      const direction = Math.sign(blockPosition.x - ramPosition.x) || -1;
      const driveImpulse = Math.min(
        5200,
        assembly.mass * (14 + Math.max(0, Math.min(1, effort)) * 26),
      );
      const drivenBodies = assembly.partIds
        .map((id) => this.entities.get(id)?.body)
        .filter((body): body is RAPIER.RigidBody => !!body);
      const drivenMass = drivenBodies.reduce(
        (sum, body) => sum + body.mass(),
        0,
      );
      for (const body of drivenBodies) {
        body.applyImpulse(
          {
            x: direction * driveImpulse * (body.mass() / drivenMass),
            y: 0,
          },
          true,
        );
      }
      this.wakeTower();
      this.puzzleCommissioning.delete(`queen:${assembly.id}`);
      worker.activity = "fight";
      worker.activityUntil = this.elapsed + 3;
      this.puzzleAssemblyCooldownUntil.set(assembly.id, this.elapsed + 9);
      this.emitSound("impact", agent.team, 0.88, ramPosition.x);
      this.setPuzzleLifecycle(assembly.partIds, "operating", worker.id, "operate_ram");
      return { accepted: true, entityId: ram.id };
    }

    const targetPosition = target.body.translation();
    if (
      this.driver.model !== "mock" &&
      target.team !== agent.team &&
      !["contest", "decisive"].includes(this.matchBeat())
    ) {
      return {
        accepted: false,
        reason: "Machine attacks open during the contest phase",
      };
    }
    const origin = part.body.translation();
    const direction = Math.sign(targetPosition.x - origin.x) || 1;
    const force =
      (assembly.mass * (capabilities.has("multiply_force") ? 1.8 : 0.7) +
        (capabilities.has("store_energy") ? 90 : 0)) *
      (0.35 + effort * 0.65);
    target.body.applyImpulse(
      {
        x: direction * Math.min(430, force),
        y: Math.min(90, force * 0.2),
      },
      true,
    );
    target.stress = Math.min(1, target.stress + force / 420);
    if (target.kind === "man" && target.team !== agent.team) {
      this.damage(target, Math.min(18, force / 28));
    }
    worker.activity = "fight";
    worker.activityUntil = this.elapsed + 2.5;
    this.puzzleAssemblyCooldownUntil.set(assembly.id, this.elapsed + 4);
    this.emitSound("shove", agent.team, Math.min(1, force / 320), origin.x);
    return { accepted: true, entityId: target.id };
  }

  private updateConstruction(): void {
    for (const project of this.projects.values()) {
      if (project.phase === "complete") continue;
      const machine = this.entities.get(project.plan.machineId);
      let worker = this.entities.get(project.workerId);
      if (!machine?.body) continue;
      if (!worker?.body || !worker.alive) {
        const abandoned = project.componentIds
          .map((id) => this.entities.get(id))
          .find(
            (component) =>
              component?.assignedWorkerId === project.workerId &&
              component.assemblyState !== "installed",
          );
        if (abandoned?.body) {
          const position = abandoned.body.translation();
          abandoned.sourceX = position.x;
          abandoned.sourceY = position.y;
          abandoned.assemblyState = "stock";
          abandoned.taskOperation = "fetch";
          abandoned.taskProgress = 0;
          delete abandoned.assignedWorkerId;
          delete abandoned.carriedBy;
        }
        const occupied = new Set(
          [...this.projects.values()]
            .filter(
              (other) =>
                other !== project &&
                other.phase !== "complete" &&
                this.entities.get(other.workerId)?.alive,
            )
            .map((other) => other.workerId),
        );
        const replacement = [...this.entities.values()]
          .filter(
            (entity) =>
              entity.kind === "man" &&
              entity.team === project.plan.team &&
              entity.alive &&
              entity.body &&
              !occupied.has(entity.id),
          )
          .sort((a, b) => {
            const machineX = machine.body?.translation().x ?? 0;
            return (
              Math.abs((a.body?.translation().x ?? 0) - machineX) -
              Math.abs((b.body?.translation().x ?? 0) - machineX)
            );
          })[0];
        if (!replacement?.body) continue;
        project.workerId = replacement.id;
        replacement.constructionTargetId = project.plan.machineId;
        worker = replacement;
        const agent = AGENTS.find((candidate) => candidate.id === replacement.id);
        this.announce(
          this.turn,
          replacement.id,
          agent?.name ?? replacement.id,
          replacement.team ?? project.plan.team,
          `Taking over the unfinished ${project.plan.label}.`,
        );
      }

      const components = project.componentIds
        .map((id) => this.entities.get(id))
        .filter((entity): entity is PhysicsEntity => entity?.kind === "component");
      const installed = components.filter(
        (component) => component.assemblyState === "installed",
      ).length;

      if (project.phase === "components") {
        const stage = project.plan.mechanisms.find(
          (candidate) => !project.commissionedStageIds.has(candidate.id),
        );
        const stageComponents = stage
          ? stage.requires
              .map((id) => this.entities.get(id))
              .filter(
                (entity): entity is PhysicsEntity =>
                  entity?.kind === "component",
              )
          : [];
        let active: PhysicsEntity | undefined;
        if (stage) {
          active = stageComponents.find(
            (component) =>
              component.assignedWorkerId === worker.id &&
              component.assemblyState !== "installed",
          );
          if (!active) {
            active = stageComponents.find(
              (component) =>
                component.assemblyState !== "installed" &&
                !component.assignedWorkerId,
            );
            if (active) this.assignComponentTask(worker, active);
          }
          if (active) {
            project.commissioningProgress = 0;
            this.advanceComponentTask(project, worker, active);
          } else if (
            stageComponents.every(
              (component) => component.assemblyState === "installed",
            )
          ) {
            this.advanceMechanismCommissioning(
              project,
              worker,
              machine,
              stage,
            );
          }
        }

        const partial = active
          ? Math.min(0.85, active.taskProgress ?? 0)
          : stage
            ? project.commissioningProgress * 0.35
            : 0;
        machine.buildProgress =
          ((installed + partial) / Math.max(1, components.length)) * 0.9;
        machine.buildStage = stage
          ? stageComponents.every(
                (component) => component.assemblyState === "installed",
              )
            ? `${this.commissioningLabel(stage)}: ${stage.label}`
            : stage.label
          : "all subsystems proved";

        if (
          !stage &&
          components.every(
            (component) => component.assemblyState === "installed",
          )
        ) {
          project.phase =
            project.plan.finalization === "raise"
              ? "raising"
              : project.plan.finalization === "mount"
                ? "mounting"
                : "inspect";
          project.finalizationProgress = 0;
          this.clearWorkerTask(worker);
        }
        continue;
      }

      if (project.phase === "raising") {
        this.advanceRaising(project, worker, components, machine);
      } else if (project.phase === "mounting") {
        this.advanceMounting(project, worker, components, machine);
      } else {
        this.advanceInspection(project, worker, machine);
      }
    }
  }

  private assignComponentTask(
    worker: PhysicsEntity,
    component: PhysicsEntity,
  ): void {
    component.assignedWorkerId = worker.id;
    component.taskOperation = "fetch";
    component.taskProgress = 0;
    worker.taskOperation = "fetch";
    worker.taskProgress = 0;
    worker.taskTargetId = component.id;
    worker.tool = "hands";
    worker.movementTarget =
      component.sourceX ?? worker.body?.translation().x ?? component.stagingX ?? 0;
    worker.activity = "march";
    worker.activityUntil = this.elapsed + 0.4;
  }

  private advanceComponentTask(
    project: ConstructionProject,
    worker: PhysicsEntity,
    component: PhysicsEntity,
  ): void {
    if (!worker.body || !component.body || !component.taskOperation) return;
    const workerPosition = worker.body.translation();
    const operation = component.taskOperation;
    this.operationHistory.add(operation);

    worker.taskOperation = operation;
    worker.taskProgress = component.taskProgress ?? 0;
    worker.taskTargetId = component.id;
    worker.tool = this.toolFor(operation);

    if (operation === "fetch") {
      worker.activity = "march";
      worker.activityUntil = this.elapsed + 0.4;
      worker.movementTarget =
        component.sourceX ?? workerPosition.x ?? component.stagingX ?? 0;
      if (
        component.sourceX !== undefined &&
        Math.abs(workerPosition.x - component.sourceX) <= 18
      ) {
        component.assemblyState = "carried";
        component.carriedBy = worker.id;
        component.taskOperation = "carry";
        component.taskProgress = 0;
        worker.taskOperation = "carry";
        worker.carryingId = component.id;
        worker.activity = "carry";
        const direction = project.plan.team === "king" ? -1 : 1;
        worker.movementTarget = (component.stagingX ?? workerPosition.x) + direction * 28;
      }
      return;
    }

    if (operation === "carry") {
      worker.activity = "carry";
      worker.activityUntil = this.elapsed + 0.4;
      worker.carryingId = component.id;
      const direction = project.plan.team === "king" ? -1 : 1;
      const accessX = (component.stagingX ?? workerPosition.x) + direction * 28;
      worker.movementTarget = accessX;
      component.body.setNextKinematicTranslation({
        x: workerPosition.x - direction * 20,
        y: workerPosition.y + 17,
      });
      component.body.setNextKinematicRotation(
        (component.width ?? 0) > (component.height ?? 0)
          ? direction * -0.1
          : direction * 0.32,
      );
      if (Math.abs(workerPosition.x - accessX) <= 18) {
        delete component.carriedBy;
        delete worker.carryingId;
        delete worker.movementTarget;
        this.setComponentPose(
          component,
          component.stagingX ?? workerPosition.x,
          component.stagingY ?? GROUND_HEIGHT + 20,
          component.stagingAngle ?? 0,
        );
        component.assemblyState = "staged";
        component.operationIndex = 0;
        component.taskOperation = component.operations?.[0] ?? "position";
        component.taskProgress = 0;
      }
      return;
    }

    delete worker.movementTarget;
    worker.commandedVelocity = 0;
    worker.activity = this.activityFor(operation);
    worker.activityUntil = this.elapsed + 0.4;
    const fastBenchAssembly =
      project.plan.id === "cart" ||
      project.plan.id === "lever" ||
      project.plan.id === "screw_jack" ||
      project.plan.id === "spring_trap";
    const durationScale = fastBenchAssembly
      ? 0.16
      : project.plan.id === "winch"
        ? 0.24
        : project.plan.id === "pulley"
          ? 0.28
      : project.plan.id === "ladder"
        ? 0.48
        : project.plan.id === "brace" ||
            project.plan.id === "sling"
          ? 0.38
        : 0.58;
    const duration = Math.max(0.8, WORK_DURATION[operation] * durationScale);
    component.taskProgress = Math.min(
      1,
      (component.taskProgress ?? 0) + FIXED_STEP / duration,
    );
    worker.taskProgress = component.taskProgress;
    this.emitWorkCue(project, operation, workerPosition.x);

    if ((component.taskProgress ?? 0) < 1) return;
    const nextIndex = (component.operationIndex ?? 0) + 1;
    const nextOperation = component.operations?.[nextIndex];
    if (nextOperation) {
      component.operationIndex = nextIndex;
      component.taskOperation = nextOperation;
      component.taskProgress = 0;
      worker.taskOperation = nextOperation;
      worker.taskProgress = 0;
      return;
    }

    component.assemblyState = "installed";
    component.connectionType ??= this.connectionFor(component);
    delete component.assignedWorkerId;
    delete component.taskOperation;
    delete component.taskProgress;
    this.setComponentPose(
      component,
      component.stagingX ?? workerPosition.x,
      component.stagingY ?? GROUND_HEIGHT + 20,
      component.stagingAngle ?? 0,
    );
    this.clearWorkerTask(worker);
  }

  private advanceMechanismCommissioning(
    project: ConstructionProject,
    worker: PhysicsEntity,
    machine: PhysicsEntity,
    stage: MechanismStage,
  ): void {
    if (!worker.body || !machine.body) return;
    if (
      !stage.dependsOn.every((stageId) =>
        project.commissionedStageIds.has(stageId),
      )
    ) {
      return;
    }
    const workerPosition = worker.body.translation();
    const machinePosition = machine.body.translation();
    const direction = project.plan.team === "king" ? -1 : 1;
    const testPosition = machinePosition.x + direction * 44;
    worker.movementTarget = testPosition;
    worker.taskOperation = "inspect";
    worker.taskTargetId = machine.id;
    worker.taskProgress = project.commissioningProgress;
    worker.activity =
      stage.commissioning === "proof_load" ||
      stage.commissioning === "dry_cycle" ||
      stage.commissioning === "spin_free"
        ? "build"
        : "inspect";
    worker.activityUntil = this.elapsed + 0.4;
    worker.tool =
      stage.commissioning === "square_frame"
        ? "try square"
        : stage.commissioning === "reeve_line"
          ? "reeving spike"
          : stage.commissioning === "hold_position"
            ? "brake bar"
            : "proof weight";
    if (Math.abs(workerPosition.x - testPosition) > 20) return;

    delete worker.movementTarget;
    worker.commandedVelocity = 0;
    project.commissioningProgress = Math.min(
      1,
      project.commissioningProgress +
        FIXED_STEP / Math.max(1.8, stage.testDuration * 0.45),
    );
    worker.taskProgress = project.commissioningProgress;
    this.emitWorkCue(
      project,
      stage.commissioning === "reeve_line" ? "reeve" : "inspect",
      workerPosition.x,
    );
    if (project.commissioningProgress < 1) return;

    project.commissionedStageIds.add(stage.id);
    project.commissioningProgress = 0;
    this.clearWorkerTask(worker);
  }

  private commissioningLabel(stage: MechanismStage): string {
    switch (stage.commissioning) {
      case "square_frame":
        return "squaring";
      case "spin_free":
        return "turning by hand";
      case "proof_load":
        return "proof-loading";
      case "hold_position":
        return "testing the brake";
      case "dry_cycle":
        return "dry-cycling";
      case "reeve_line":
        return "reeving";
      case "fit_load":
        return "fitting the load";
    }
  }

  private advanceInspection(
    project: ConstructionProject,
    worker: PhysicsEntity,
    machine: PhysicsEntity,
  ): void {
    if (!worker.body || !machine.body) return;
    const position = worker.body.translation();
    const machinePosition = machine.body.translation();
    const direction = project.plan.team === "king" ? -1 : 1;
    const accessX = machinePosition.x + direction * 46;
    worker.taskOperation = "inspect";
    this.operationHistory.add("inspect");
    worker.taskProgress = project.finalizationProgress;
    worker.tool = "try square";
    worker.activity = "inspect";
    worker.activityUntil = this.elapsed + 0.4;
    if (Math.abs(position.x - accessX) > 18) {
      worker.movementTarget = accessX;
      return;
    }
    delete worker.movementTarget;
    project.finalizationProgress = Math.min(
      1,
      project.finalizationProgress + FIXED_STEP / WORK_DURATION.inspect,
    );
    machine.buildProgress = 0.9 + project.finalizationProgress * 0.1;
    machine.buildStage = "inspection";
    if (project.finalizationProgress >= 1) {
      this.completeProject(project, worker, machine);
    }
  }

  private advanceRaising(
    project: ConstructionProject,
    worker: PhysicsEntity,
    components: PhysicsEntity[],
    machine: PhysicsEntity,
  ): void {
    if (!worker.body || !machine.body) return;
    const position = worker.body.translation();
    const pivotX = project.plan.center.x + (project.plan.team === "king" ? -48 : 48);
    worker.taskOperation = "raise";
    this.operationHistory.add("raise");
    worker.taskProgress = project.finalizationProgress;
    worker.tool = "pike pole";
    worker.activity = "lift";
    worker.activityUntil = this.elapsed + 0.4;
    if (Math.abs(position.x - pivotX) > 18) {
      worker.movementTarget = pivotX;
      return;
    }
    delete worker.movementTarget;
    project.finalizationProgress = Math.min(
      1,
      project.finalizationProgress + FIXED_STEP / WORK_DURATION.raise,
    );
    const eased = 1 - Math.pow(1 - project.finalizationProgress, 3);
    const motion = project.plan.raiseMotion;
    for (const component of components) {
      if (motion) {
        const finalX = component.finalX ?? motion.finalPivot.x;
        const finalY = component.finalY ?? motion.finalPivot.y;
        const rotation = motion.startRotation * (1 - eased);
        const pivotX = this.mix(
          motion.stagingPivot.x,
          motion.finalPivot.x,
          eased,
        );
        const pivotY = this.mix(
          motion.stagingPivot.y,
          motion.finalPivot.y,
          eased,
        );
        const dx = finalX - motion.finalPivot.x;
        const dy = finalY - motion.finalPivot.y;
        this.setComponentPose(
          component,
          pivotX + dx * Math.cos(rotation) - dy * Math.sin(rotation),
          pivotY + dx * Math.sin(rotation) + dy * Math.cos(rotation),
          (component.finalAngle ?? 0) + rotation,
        );
      } else {
        this.setComponentPose(
          component,
          this.mix(component.stagingX, component.finalX, eased),
          this.mix(component.stagingY, component.finalY, eased),
          this.mixAngle(component.stagingAngle, component.finalAngle, eased),
        );
      }
    }
    machine.buildProgress = 0.9 + project.finalizationProgress * 0.1;
    machine.buildStage = "raising";
    this.emitWorkCue(project, "raise", position.x);
    if (project.finalizationProgress >= 1) {
      this.completeProject(project, worker, machine);
    }
  }

  private advanceMounting(
    project: ConstructionProject,
    worker: PhysicsEntity,
    components: PhysicsEntity[],
    machine: PhysicsEntity,
  ): void {
    if (!worker.body || !machine.body) return;
    const ladder = this.entities.get("machine_ladder");
    if (!ladder?.body || !this.machineComplete("machine_ladder")) {
      worker.activity = "inspect";
      worker.activityUntil = this.elapsed + 0.4;
      worker.taskOperation = "inspect";
      worker.taskProgress = 0;
      machine.buildStage = "awaiting ladder";
      return;
    }

    const workerPosition = worker.body.translation();
    const ladderPosition = ladder.body.translation();
    const goalY =
      ladderPosition.y + (ladder.height ?? 500) / 2 - 46;
    worker.taskOperation = "mount";
    this.operationHistory.add("mount");
    worker.tool = "shoulder strap";
    worker.activity = "lift";
    worker.activityUntil = this.elapsed + 0.4;
    worker.carryingId = project.plan.machineId;

    if (workerPosition.y < goalY - 9) {
      worker.climbTargetX = ladderPosition.x - 8;
      worker.climbGoalY = goalY;
      delete worker.movementTarget;
      const spread = 12;
      components.forEach((component, index) => {
        component.assemblyState = "carried";
        this.setComponentPose(
          component,
          workerPosition.x + (index - (components.length - 1) / 2) * spread,
          workerPosition.y + 22 + (index % 2) * 7,
          component.stagingAngle ?? 0,
        );
      });
      project.finalizationProgress = Math.max(
        project.finalizationProgress,
        Math.min(0.8, workerPosition.y / Math.max(1, goalY) * 0.8),
      );
      machine.buildProgress = 0.9 + project.finalizationProgress * 0.1;
      machine.buildStage = "carrying aloft";
      return;
    }

    project.finalizationProgress = Math.min(
      1,
      project.finalizationProgress + FIXED_STEP / WORK_DURATION.mount,
    );
    worker.taskProgress = project.finalizationProgress;
    components.forEach((component) => {
      component.assemblyState = "installed";
      this.setComponentPose(
        component,
        component.finalX ?? project.plan.center.x,
        component.finalY ?? project.plan.center.y,
        component.finalAngle ?? 0,
      );
    });
    machine.buildProgress = 0.9 + project.finalizationProgress * 0.1;
    machine.buildStage = "mounting";
    this.emitWorkCue(project, "mount", workerPosition.x);
    if (project.finalizationProgress >= 1) {
      this.completeProject(project, worker, machine);
    }
  }

  private completeProject(
    project: ConstructionProject,
    worker: PhysicsEntity,
    machine: PhysicsEntity,
  ): void {
    project.phase = "complete";
    project.finalizationProgress = 1;
    machine.buildProgress = 1;
    machine.buildStage = "complete";
    if (project.plan.onComplete === "harness") this.harnessFitted = true;
    if (project.plan.finalization === "mount" && worker.body) {
      const ladder = this.entities.get("machine_ladder");
      worker.climbTargetX =
        ladder?.body?.translation().x ?? worker.body.translation().x;
      worker.climbGoalY = GROUND_HEIGHT + 36.5;
    }
    this.clearWorkerTask(worker);
    delete worker.constructionTargetId;
    worker.activity = "guard";
    worker.activityUntil = this.elapsed + 1.5;
    this.emitSound("hammer", project.plan.team, 0.92, project.plan.center.x);
  }

  private clearWorkerTask(worker: PhysicsEntity): void {
    delete worker.taskOperation;
    delete worker.taskProgress;
    delete worker.taskTargetId;
    delete worker.carryingId;
    delete worker.tool;
  }

  private setComponentPose(
    component: PhysicsEntity,
    x: number,
    y: number,
    angle: number,
  ): void {
    if (!component.body) return;
    component.body.setTranslation({ x, y }, true);
    component.body.setRotation(angle, true);
  }

  private mix(from: number | undefined, to: number | undefined, amount: number): number {
    const start = from ?? to ?? 0;
    const end = to ?? start;
    return start + (end - start) * amount;
  }

  private mixAngle(
    from: number | undefined,
    to: number | undefined,
    amount: number,
  ): number {
    const start = from ?? to ?? 0;
    const end = to ?? start;
    const delta = Math.atan2(Math.sin(end - start), Math.cos(end - start));
    return start + delta * amount;
  }

  private activityFor(operation: WorkOperation): AgentActivity {
    switch (operation) {
      case "measure":
        return "measure";
      case "saw":
      case "shape":
        return "saw";
      case "bore":
      case "thread":
        return "bore";
      case "forge":
      case "temper":
        return "forge";
      case "tension":
        return "tension";
      case "peg":
      case "wedge":
        return "hammer";
      case "lash":
      case "stitch":
      case "reeve":
        return "lash";
      case "mount":
      case "raise":
        return "lift";
      case "inspect":
      case "grease":
        return "inspect";
      default:
        return "build";
    }
  }

  private toolFor(operation: WorkOperation): string {
    switch (operation) {
      case "measure":
        return "rule and square";
      case "saw":
        return "frame saw";
      case "shape":
        return "drawknife and spokeshave";
      case "bore":
        return "brace and bit";
      case "thread":
        return "thread box and tap";
      case "forge":
        return "hammer and portable anvil";
      case "temper":
        return "quench trough and tongs";
      case "tension":
        return "winding levers";
      case "peg":
      case "wedge":
        return "wooden maul";
      case "lash":
      case "reeve":
        return "marlinspike";
      case "stitch":
        return "sail needle";
      case "grease":
        return "tallow brush";
      case "position":
        return "pry bar";
      case "mount":
        return "shoulder strap";
      case "raise":
        return "pike pole";
      case "inspect":
        return "try square";
      default:
        return "hands";
    }
  }

  private connectionFor(component: PhysicsEntity): ConnectionType {
    const operations = component.operations ?? [];
    if (operations.includes("lash")) return "lash";
    if (operations.includes("stitch")) return "stitch";
    if (operations.includes("thread")) return "thread";
    if (operations.includes("tension")) return "catch";
    if (operations.includes("wedge")) return "wedge";
    if (operations.includes("peg")) return "peg";
    if (operations.includes("mount")) return "pin";
    return "peg";
  }

  private emitWorkCue(
    project: ConstructionProject,
    operation: WorkOperation,
    x: number,
  ): void {
    if (this.elapsed - project.lastCueAt < 1.25) return;
    project.lastCueAt = this.elapsed;
    const type =
      operation === "lash" || operation === "stitch" || operation === "reeve"
        ? "rope"
        : operation === "raise" || operation === "mount"
          ? "winch"
          : "hammer";
    this.emitSound(type, project.plan.team, 0.58, x);
  }

  private removeSpentProjectiles(): void {
    for (const [id, entity] of this.entities) {
      if (
        entity.kind !== "stone" ||
        entity.expiresAt === undefined ||
        this.elapsed < entity.expiresAt ||
        !entity.body
      ) {
        continue;
      }
      if (entity.collider) this.colliderOwners.delete(entity.collider.handle);
      this.world.removeRigidBody(entity.body);
      this.entities.delete(id);
    }
  }

  private rememberContact(
    contacts: Map<string, ContactState>,
    id: string,
    impulse: number,
    ownMotion: MotionState,
    otherId: string | undefined,
    otherMotion: MotionState,
  ): void {
    const current = contacts.get(id);
    if (!current || impulse > current.impulse) {
      contacts.set(id, {
        impulse,
        impactSpeed: Math.max(ownMotion.speed, otherMotion.speed),
        ownVy: ownMotion.vy,
        ...(otherId ? { otherId } : {}),
        otherSpeed: otherMotion.speed,
      });
    }
  }

  private livingMovementExclusions(entity: PhysicsEntity): Set<string> {
    const excluded = new Set([entity.id]);
    if (entity.carryingId) excluded.add(entity.carryingId);
    const task =
      this.puzzleTasks.get(entity.id) ??
      [...this.puzzleTasks.values()].find((candidate) =>
        candidate.helperIds.includes(entity.id),
      );
    if (task) {
      task.movingIds.forEach((id) => excluded.add(id));
      task.targetIds.forEach((id) => excluded.add(id));
    }
    const recovery = this.puzzleRecoveryTasks.get(entity.id);
    if (recovery) excluded.add(recovery.partId);
    if (entity.combatTarget) excluded.add(entity.combatTarget);
    return excluded;
  }

  private livingFloorObstacles(entity: PhysicsEntity): Array<{
    id: string;
    minX: number;
    maxX: number;
    minDepth: number;
    maxDepth: number;
  }> {
    const excluded = this.livingMovementExclusions(entity);
    const current = entity.body?.translation();
    const currentDepth = entity.puzzleDepth ?? 0;
    const carryEnvelope = this.livingCarryEnvelope(entity);
    const obstacles: Array<{
      id: string;
      minX: number;
      maxX: number;
      minDepth: number;
      maxDepth: number;
    }> = [];
    for (const obstacle of this.entities.values()) {
      if (
        excluded.has(obstacle.id) ||
        !obstacle.body ||
        obstacle.kind === "limb" ||
        !(
          obstacle.puzzleDefinition ||
          obstacle.kind === "block" ||
          obstacle.kind === "stone" ||
          (obstacle.kind === "man" && obstacle.alive) ||
          (obstacle.kind === "humpty" &&
            obstacle.body.translation().y <= GROUND_HEIGHT + 105)
        )
      ) {
        continue;
      }
      const position = obstacle.body.translation();
      if (
        obstacle.kind === "stone" &&
        position.y > GROUND_HEIGHT + (obstacle.radius ?? 8) * 3
      ) {
        continue;
      }
      const halfX =
        obstacle.kind === "block"
          ? (obstacle.width ?? TOWER_BLOCK_WIDTH) / 2
          : this.entityHalfExtents(obstacle).x;
      const halfDepth = this.floorDepthHalf(obstacle);
      const bounds = {
        id: obstacle.id,
        minX: position.x - halfX - carryEnvelope.halfX,
        maxX: position.x + halfX + carryEnvelope.halfX,
        minDepth:
          (obstacle.puzzleDepth ?? 0) - halfDepth - carryEnvelope.halfDepth,
        maxDepth:
          (obstacle.puzzleDepth ?? 0) + halfDepth + carryEnvelope.halfDepth,
      };
      // Old runs can begin with a worker already inside a piece. Let that
      // worker step out once; all subsequent movement uses solid routing.
      if (
        current &&
        current.x > bounds.minX &&
        current.x < bounds.maxX &&
        currentDepth > bounds.minDepth &&
        currentDepth < bounds.maxDepth
      ) {
        continue;
      }
      obstacles.push(bounds);
    }
    return obstacles;
  }

  private livingCarryEnvelope(entity: PhysicsEntity): {
    halfX: number;
    halfDepth: number;
  } {
    let halfX = 11;
    let halfDepth = 0.34;
    const primaryTask = this.puzzleTasks.get(entity.id);
    const helperTask = [...this.puzzleTasks.values()].find((task) =>
      task.helperIds.includes(entity.id),
    );
    const task = primaryTask ?? helperTask;
    const recovery = this.puzzleRecoveryTasks.get(entity.id);
    const explicitlyCarried = entity.carryingId
      ? this.entities.get(entity.carryingId)
      : undefined;
    if (!task && !recovery && explicitlyCarried?.body) {
      halfX = Math.max(
        halfX,
        this.entityHalfExtents(explicitlyCarried).x + 8,
      );
      halfDepth = Math.max(
        halfDepth,
        this.floorDepthHalf(explicitlyCarried) + 0.18,
      );
      return { halfX, halfDepth };
    }
    if (!task && !recovery) return { halfX, halfDepth };
    if (recovery) {
      const part = this.entities.get(recovery.partId);
      if (part?.body) {
        halfX = Math.max(halfX, this.entityHalfExtents(part).x + 8);
        halfDepth = Math.max(halfDepth, this.floorDepthHalf(part) + 0.18);
      }
      return { halfX, halfDepth };
    }
    if (!task) return { halfX, halfDepth };
    const carriedIds =
      task.phase === "stage_target"
        ? task.targetIds
        : ["carry", "snap", "release"].includes(task.phase)
          ? task.movingIds
          : [];
    for (const partId of carriedIds) {
      const part = this.entities.get(partId);
      if (!part?.body) continue;
      halfX = Math.max(halfX, this.entityHalfExtents(part).x + 8);
      halfDepth = Math.max(halfDepth, this.floorDepthHalf(part) + 0.18);
    }
    return { halfX, halfDepth };
  }

  private planLivingPath(
    entity: PhysicsEntity,
    goalX: number,
    goalDepth: number,
  ): Array<{ x: number; depth: number }> {
    const position = entity.body?.translation();
    if (!position) return [];
    const xStep = 20;
    const depthStep = 0.25;
    const xCells = Math.floor((WORLD_WIDTH - 40) / xStep);
    const depthCells = Math.floor(
      (FLOOR_DEPTH_MAX - FLOOR_DEPTH_MIN) / depthStep,
    );
    const clampX = (value: number) => Math.max(0, Math.min(xCells, value));
    const clampDepth = (value: number) =>
      Math.max(0, Math.min(depthCells, value));
    const toCell = (x: number, depth: number) => ({
      x: clampX(Math.round((x - 20) / xStep)),
      depth: clampDepth(
        Math.round((depth - FLOOR_DEPTH_MIN) / depthStep),
      ),
    });
    const toPoint = (x: number, depth: number) => ({
      x: 20 + x * xStep,
      depth: FLOOR_DEPTH_MIN + depth * depthStep,
    });
    const keyFor = (x: number, depth: number) => `${x}:${depth}`;
    const start = toCell(position.x, entity.puzzleDepth ?? 0);
    const goal = toCell(goalX, goalDepth);
    const startKey = keyFor(start.x, start.depth);
    const goalKey = keyFor(goal.x, goal.depth);
    const obstacles = this.livingFloorObstacles(entity);
    const blocked = (x: number, depth: number): boolean => {
      const key = keyFor(x, depth);
      if (key === startKey || key === goalKey) return false;
      const point = toPoint(x, depth);
      return obstacles.some(
        (obstacle) =>
          point.x > obstacle.minX &&
          point.x < obstacle.maxX &&
          point.depth > obstacle.minDepth &&
          point.depth < obstacle.maxDepth,
      );
    };
    const open = [{ ...start, g: 0, f: 0 }];
    const costs = new Map([[startKey, 0]]);
    const parents = new Map<string, string>();
    const cells = new Map([[startKey, start]]);
    const directions = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ] as const;

    while (open.length > 0) {
      open.sort((first, second) => first.f - second.f || first.g - second.g);
      const current = open.shift()!;
      const currentKey = keyFor(current.x, current.depth);
      if (current.g !== costs.get(currentKey)) continue;
      if (currentKey === goalKey) {
        const path: Array<{ x: number; depth: number }> = [];
        let cursor: string | undefined = goalKey;
        while (cursor && cursor !== startKey) {
          const cell = cells.get(cursor);
          if (cell) path.push(toPoint(cell.x, cell.depth));
          cursor = parents.get(cursor);
        }
        path.reverse();
        if (path.length === 0) return [{ x: goalX, depth: goalDepth }];
        path[path.length - 1] = { x: goalX, depth: goalDepth };
        return path;
      }
      for (const [dx, dDepth] of directions) {
        const nextX = current.x + dx;
        const nextDepth = current.depth + dDepth;
        if (
          nextX < 0 ||
          nextX > xCells ||
          nextDepth < 0 ||
          nextDepth > depthCells ||
          blocked(nextX, nextDepth)
        ) {
          continue;
        }
        if (
          dx !== 0 &&
          dDepth !== 0 &&
          (blocked(current.x + dx, current.depth) ||
            blocked(current.x, current.depth + dDepth))
        ) {
          continue;
        }
        const stepCost = dx !== 0 && dDepth !== 0 ? Math.SQRT2 : 1;
        const nextCost = current.g + stepCost;
        const nextKey = keyFor(nextX, nextDepth);
        if (nextCost >= (costs.get(nextKey) ?? Infinity)) continue;
        costs.set(nextKey, nextCost);
        parents.set(nextKey, currentKey);
        cells.set(nextKey, { x: nextX, depth: nextDepth });
        const heuristic = Math.hypot(goal.x - nextX, goal.depth - nextDepth);
        open.push({
          x: nextX,
          depth: nextDepth,
          g: nextCost,
          f: nextCost + heuristic,
        });
      }
    }
    return [];
  }

  private livingStepBlocked(
    entity: PhysicsEntity,
    nextX: number,
    nextDepth: number,
  ): boolean {
    const position = entity.body?.translation();
    if (!position) return true;
    const startDepth = entity.puzzleDepth ?? 0;
    const dx = nextX - position.x;
    const dDepth = nextDepth - startDepth;
    for (const obstacle of this.livingFloorObstacles(entity)) {
      let enter = -Infinity;
      let exit = Infinity;
      for (const [origin, delta, minimum, maximum] of [
        [position.x, dx, obstacle.minX, obstacle.maxX],
        [startDepth, dDepth, obstacle.minDepth, obstacle.maxDepth],
      ] as const) {
        if (Math.abs(delta) < 0.0001) {
          if (origin <= minimum || origin >= maximum) {
            enter = Infinity;
            exit = -Infinity;
            break;
          }
          continue;
        }
        const first = (minimum - origin) / delta;
        const second = (maximum - origin) / delta;
        enter = Math.max(enter, Math.min(first, second));
        exit = Math.min(exit, Math.max(first, second));
      }
      if (enter <= exit && enter >= 0 && enter <= 1) return true;
    }
    return false;
  }

  private clearLivingPath(entity: PhysicsEntity): void {
    delete entity.movementPlanGoalX;
    delete entity.movementPlanGoalDepth;
    delete entity.movementWaypoints;
  }

  private updateWorkerCollisionGroups(): void {
    for (const entity of this.entities.values()) {
      if (entity.kind !== "man" || !entity.collider) continue;
      const manIndex =
        entity.team === "king"
          ? Number(entity.id.at(-1))
          : Number(entity.id.at(-1)) + 3;
      const membership = 1 << manIndex;
      let filter =
        0xffff ^ membership ^ PUZZLE_MEMBERSHIP ^ MEN_MEMBERSHIP_MASK;
      if (Math.abs(entity.puzzleDepth ?? 0) > 2.42) {
        filter &= 0xffff ^ TOWER_MEMBERSHIP;
      }
      entity.collider.setCollisionGroups(
        ((membership << 16) | filter) >>> 0,
      );
    }
  }

  private updateMovement(): void {
    for (const entity of this.entities.values()) {
      if (entity.kind === "man" && entity.alive && entity.body) {
        const x = entity.body.translation().x;
        if (x < 42 || x > WORLD_WIDTH - 42) {
          const direction = x < 42 ? 1 : -1;
          const velocity = entity.body.linvel();
          entity.body.setLinvel(
            {
              x:
                direction > 0
                  ? Math.max(72, velocity.x)
                  : Math.min(-72, velocity.x),
              y: velocity.y,
            },
            true,
          );
          entity.commandedVelocity = direction * 72;
          continue;
        }
      }
      if (
        entity.kind !== "man" ||
        !entity.alive ||
        (entity.movementTarget === undefined &&
          entity.movementDepthTarget === undefined) ||
        entity.climbGoalY !== undefined ||
        !entity.body
      ) {
        if (entity.kind === "man" && entity.alive) {
          entity.commandedVelocity = 0;
          if (entity.body) {
            const velocity = entity.body.linvel();
            entity.body.setLinvel({ x: 0, y: velocity.y }, true);
          }
        }
        continue;
      }
      const position = entity.body.translation();
      const delta =
        entity.movementTarget === undefined
          ? 0
          : entity.movementTarget - position.x;
      const depthDelta =
        entity.movementDepthTarget === undefined
          ? 0
          : entity.movementDepthTarget - (entity.puzzleDepth ?? 0);
      if (Math.abs(delta) < 8 && Math.abs(depthDelta) < 0.14) {
        delete entity.movementTarget;
        delete entity.movementDepthTarget;
        this.clearLivingPath(entity);
        entity.commandedVelocity = 0;
        entity.body.setLinvel({ x: 0, y: entity.body.linvel().y }, true);
        continue;
      }
      const lastStep = this.lastFootstepAt.get(entity.id) ?? -1;
      if (this.elapsed - lastStep >= 0.42) {
        this.lastFootstepAt.set(entity.id, this.elapsed);
        this.emitSound(
          "footstep",
          entity.team,
          0.42 + Math.min(0.3, Math.abs(entity.body.linvel().x) / 260),
          position.x,
        );
      }
      const goalX = entity.movementTarget ?? position.x;
      const goalDepth = entity.movementDepthTarget ?? (entity.puzzleDepth ?? 0);
      if (
        entity.movementPlanGoalX === undefined ||
        Math.abs(entity.movementPlanGoalX - goalX) > 2 ||
        entity.movementPlanGoalDepth === undefined ||
        Math.abs(entity.movementPlanGoalDepth - goalDepth) > 0.08 ||
        !entity.movementWaypoints
      ) {
        entity.movementPlanGoalX = goalX;
        entity.movementPlanGoalDepth = goalDepth;
        entity.movementWaypoints = this.planLivingPath(
          entity,
          goalX,
          goalDepth,
        );
      }
      while (entity.movementWaypoints.length > 0) {
        const waypoint = entity.movementWaypoints[0]!;
        if (
          Math.abs(waypoint.x - position.x) >= 2.5 ||
          Math.abs(waypoint.depth - (entity.puzzleDepth ?? 0)) >= 0.04
        ) {
          break;
        }
        entity.movementWaypoints.shift();
      }
      const waypoint = entity.movementWaypoints[0];
      if (!waypoint) {
        entity.commandedVelocity = 0;
        entity.body.setLinvel({ x: 0, y: entity.body.linvel().y }, true);
        continue;
      }
      const waypointDeltaX = waypoint.x - position.x;
      const waypointDepthDelta = waypoint.depth - (entity.puzzleDepth ?? 0);
      const stepX =
        Math.sign(waypointDeltaX) *
        Math.min(Math.abs(waypointDeltaX), WORKER_SPEED * FIXED_STEP);
      const stepDepth =
        Math.sign(waypointDepthDelta) *
        Math.min(
          Math.abs(waypointDepthDelta),
          WORKER_DEPTH_SPEED * FIXED_STEP,
        );
      const nextX = position.x + stepX;
      const nextDepth = (entity.puzzleDepth ?? 0) + stepDepth;
      if (this.livingStepBlocked(entity, nextX, nextDepth)) {
        this.clearLivingPath(entity);
        entity.commandedVelocity = 0;
        entity.body.setLinvel({ x: 0, y: entity.body.linvel().y }, true);
        continue;
      }
      this.translateLivingMan(entity, stepX);
      entity.puzzleDepth = nextDepth;
      entity.commandedVelocity = stepX / FIXED_STEP;
      entity.activity = "march";
      entity.activityUntil = this.elapsed + 0.25;
    }
  }

  private updateClimbing(): void {
    for (const entity of this.entities.values()) {
      if (
        entity.kind !== "man" ||
        !entity.alive ||
        !entity.body ||
        entity.climbGoalY === undefined ||
        entity.climbTargetX === undefined
      ) {
        continue;
      }
      const position = entity.body.translation();
      const dx = entity.climbTargetX - position.x;
      const dy = entity.climbGoalY - position.y;
      if (Math.abs(dx) < 4 && Math.abs(dy) < 6) {
        entity.commandedVelocity = 0;
        entity.activity = "guard";
        entity.activityUntil = this.elapsed + 1;
        entity.body.setLinvel({ x: 0, y: 0 }, true);
        for (const part of this.entities.values()) {
          if (part.ownerId === entity.id && part.body) {
            part.body.setLinvel({ x: 0, y: 0 }, true);
          }
        }
        if (entity.climbGoalY <= GROUND_HEIGHT + 60) {
          delete entity.climbGoalY;
          delete entity.climbTargetX;
        }
        continue;
      }
      const stepX = Math.sign(dx) * Math.min(Math.abs(dx), 70 * FIXED_STEP);
      const stepY = Math.sign(dy) * Math.min(Math.abs(dy), 58 * FIXED_STEP);
      this.translateLivingMan(entity, stepX, stepY);
      entity.commandedVelocity = stepX / FIXED_STEP;
      entity.activity = "climb";
      entity.activityUntil = this.elapsed + 0.25;
      const lastStep = this.lastFootstepAt.get(entity.id) ?? -1;
      if (this.elapsed - lastStep >= 0.52) {
        this.lastFootstepAt.set(entity.id, this.elapsed);
        this.emitSound("climb", entity.team, 0.56, position.x);
      }
    }
  }

  private translateLivingMan(
    entity: PhysicsEntity,
    deltaX: number,
    deltaY = 0,
  ): void {
    if (!entity.body || !entity.alive || (deltaX === 0 && deltaY === 0)) return;
    const velocity = entity.body.linvel();
    entity.body.setLinvel(
      {
        x: deltaX / FIXED_STEP,
        y: deltaY === 0 ? velocity.y : deltaY / FIXED_STEP,
      },
      true,
    );
  }

  private updateCombat(): void {
    for (const actor of this.entities.values()) {
      if (
        actor.kind !== "man" ||
        !actor.alive ||
        !actor.body ||
        !actor.combatTarget ||
        (actor.combatUntil ?? 0) <= this.elapsed
      ) {
        if (
          actor.kind === "man" &&
          actor.combatTarget &&
          !this.puzzleWorkerBusy(actor.id)
        ) {
          delete actor.movementTarget;
          delete actor.movementDepthTarget;
          this.clearLivingPath(actor);
        }
        delete actor.combatTarget;
        delete actor.combatUntil;
        continue;
      }
      const target = this.entities.get(actor.combatTarget);
      if (!target?.alive || !target.body) {
        if (!this.puzzleWorkerBusy(actor.id)) {
          delete actor.movementTarget;
          delete actor.movementDepthTarget;
          this.clearLivingPath(actor);
        }
        delete actor.combatTarget;
        delete actor.combatUntil;
        continue;
      }
      const from = actor.body.translation();
      const to = target.body.translation();
      const delta = to.x - from.x;
      if (Math.abs(delta) > 58) {
        actor.movementTarget = to.x - Math.sign(delta) * 54;
        this.setMovementDepth(actor, target.puzzleDepth);
        actor.activity = "fight";
        actor.activityUntil = this.elapsed + 0.4;
        continue;
      }
      delete actor.movementTarget;
      delete actor.movementDepthTarget;
      this.clearLivingPath(actor);
      actor.commandedVelocity = 0;
      actor.activity = "fight";
      actor.activityUntil = this.elapsed + 0.7;
      target.activity = "fight";
      target.activityUntil = this.elapsed + 0.7;
      if (
        actor.id.localeCompare(target.id) > 0 ||
        this.elapsed < (actor.nextCombatAt ?? 0)
      ) {
        continue;
      }
      actor.nextCombatAt = this.elapsed + 1.08;
      target.nextCombatAt = actor.nextCombatAt;
      const direction = Math.sign(delta) || (actor.team === "king" ? 1 : -1);
      const beat = Math.floor(this.elapsed * 2) % 2 === 0 ? 1 : -1;
      target.body.applyImpulse(
        { x: direction * (20 + beat * 4), y: 6 },
        true,
      );
      actor.body.applyImpulse({ x: -direction * 8, y: 3 }, true);
      const exposureDamage = (entity: PhysicsEntity): number => {
        const role = Number(entity.id.at(-1) ?? 1);
        return role === 3 ? 0.58 : role === 2 ? 0.46 : 0.38;
      };
      this.damage(target, exposureDamage(target));
      this.damage(actor, exposureDamage(actor));
      this.emitSound("shove", actor.team, 0.66, (from.x + to.x) / 2);
    }
  }

  private updateCarriedObjects(): void {
    for (const entity of this.entities.values()) {
      if (!entity.carriedBy || !entity.body) continue;
      if (entity.kind === "component") continue;
      const carrier = this.entities.get(entity.carriedBy);
      if (!carrier?.body || !carrier.alive) {
        delete entity.carriedBy;
        entity.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        continue;
      }
      const position = carrier.body.translation();
      entity.body.setNextKinematicTranslation({
        x: position.x + (carrier.team === "king" ? 18 : -18),
        y: position.y + 12,
      });
    }
  }

  private updateRescueHarness(): void {
    const humpty = this.entities.get("humpty");
    if (!humpty?.body || this.cracked || this.humptyRighting) return;
    if (this.puzzleRescueAssemblyId) {
      this.updatePuzzleRescue(humpty);
      return;
    }
    const kingRopes = [...this.ropes.values()].filter(
      (rope) => rope.team === "king",
    );
    const hasLine = (first: string, second: string): boolean =>
      kingRopes.some(
        (rope) =>
          this.elapsed - rope.createdAt >= 7 &&
          ((rope.fromId === first && rope.toId === second) ||
            (rope.fromId === second && rope.toId === first)),
      );
    const liftLine = hasLine("machine_pulley", "humpty");
    const driveLine = hasLine("machine_winch", "machine_pulley");
    const operatorLines = kingRopes.filter(
      (rope) =>
        this.elapsed - rope.createdAt >= 7 &&
        (rope.fromId === "machine_winch" &&
          this.entities.get(rope.toId)?.kind === "man") ||
        (this.elapsed - rope.createdAt >= 7 &&
          rope.toId === "machine_winch" &&
          this.entities.get(rope.fromId)?.kind === "man"),
    );
    const rescueMechanicsReady = [
      ["machine_skid", "locked_bed"],
      ["machine_cart", "rolling_train"],
      ["machine_cart", "load_bed"],
      ["machine_cart", "loading_planes"],
      ["machine_screw_jack", "braced_guide"],
      ["machine_screw_jack", "thread_drive"],
      ["machine_screw_jack", "load_saddle"],
      ["machine_mast", "scarfed_column"],
      ["machine_mast", "heel_pivot"],
      ["machine_lever", "pivoted_arm"],
      ["machine_lever", "limited_output"],
      ["machine_brace", "triangulated_load_path"],
      ["machine_ladder", "climbing_plane"],
      ["machine_ladder", "grounded_feet"],
      ["machine_winch", "windlass_frame"],
      ["machine_winch", "treadwheel_drive"],
      ["machine_winch", "rope_drum"],
      ["machine_winch", "ratchet_hold"],
      ["machine_winch", "brake_control"],
      ["machine_pulley", "direction_block"],
      ["machine_pulley", "traveling_tackle"],
      ["machine_pulley", "load_hook"],
      ["rescue_sling", "broad_interface"],
    ] as const;
    const machineReady =
      this.harnessFitted &&
      rescueMechanicsReady.every(([machineId, stageId]) =>
        this.mechanismReady(machineId, stageId),
      ) &&
      liftLine &&
      driveLine &&
      operatorLines.length > 0;
    const operating =
      this.machineOperatingUntil > this.elapsed ||
      (this.rescueStarted && operatorLines.length > 0);

    if (machineReady && !operating && !this.rescueStarted) {
      humpty.body.setBodyType(
        RAPIER.RigidBodyType.KinematicVelocityBased,
        true,
      );
      humpty.body.setLinvel({ x: 0, y: 0 }, true);
      humpty.body.setAngvel(0, true);
      this.rescueControlled = true;
      return;
    }

    if (!machineReady || !operating) {
      if (this.rescueControlled) {
        humpty.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        this.rescueControlled = false;
      }
      if (!this.rescueStarted) this.rescueReadyAt = 0;
      return;
    }

    if (!this.rescueStarted) {
      this.rescueStarted = true;
      this.rescueReadyAt = this.elapsed + 2.4;
      this.rigVelocityX = 0;
      this.rigVelocityY = 0;
      humpty.body.setBodyType(
        RAPIER.RigidBodyType.KinematicVelocityBased,
        true,
      );
      humpty.body.setLinvel({ x: 0, y: 0 }, true);
      this.rescueControlled = true;
    }

    const rescuers = operatorLines
      .map((rope) => {
        const otherId =
          rope.fromId === "machine_winch" ? rope.toId : rope.fromId;
        return this.entities.get(otherId);
      })
      .filter(
        (entity): entity is PhysicsEntity =>
          entity?.kind === "man" && entity.alive === true,
      )
      .sort((a, b) => a.id.localeCompare(b.id));
    rescuers.forEach((rescuer, index) => {
      rescuer.movementTarget =
        280 - index * 52 + Math.sin(this.elapsed * 2.15 + index * 1.7) * 28;
      rescuer.activity = "haul";
      rescuer.activityUntil = this.elapsed + 0.4;
    });

    if (this.elapsed < this.rescueReadyAt) {
      this.rigVelocityY = Math.max(-6, this.rigVelocityY - 4 * FIXED_STEP);
      humpty.body.setLinvel({ x: 0, y: this.rigVelocityY }, true);
      humpty.body.setAngvel(humpty.body.angvel() * 0.4, true);
      return;
    }

    const position = humpty.body.translation();
    const safeX = 450;
    const height = position.y - GROUND_HEIGHT;
    if (height > 52) {
      if (!this.rescueControlled) {
        humpty.body.setBodyType(
          RAPIER.RigidBodyType.KinematicVelocityBased,
          true,
        );
        this.rescueControlled = true;
      }
      const deltaX = safeX - position.x;
      const clearingTower = Math.abs(deltaX) > 22;
      if (clearingTower) {
        const targetX = Math.sign(deltaX) * Math.min(72, 20 + Math.abs(deltaX) * 0.3);
        const xChange = Math.max(
          -26 * FIXED_STEP,
          Math.min(26 * FIXED_STEP, targetX - this.rigVelocityX),
        );
        this.rigVelocityX += xChange;
        this.rigVelocityY = Math.max(-12, this.rigVelocityY - 6 * FIXED_STEP);
      } else {
        const accelerationX = deltaX * 1.55 - this.rigVelocityX * 0.72;
        this.rigVelocityX = Math.max(
          -58,
          Math.min(58, this.rigVelocityX + accelerationX * FIXED_STEP),
        );
        const targetDescent =
          height < 115
            ? 12.5 + Math.sin(this.elapsed * 2.4) * 1
            : 22 + Math.sin(this.elapsed * 1.75) * 1.8;
        const targetY = -Math.max(4, targetDescent);
        const yChange = Math.max(
          -16 * FIXED_STEP,
          Math.min(22 * FIXED_STEP, targetY - this.rigVelocityY),
        );
        this.rigVelocityY += yChange;
      }
      humpty.body.setLinvel(
        {
          x: this.rigVelocityX,
          y: this.rigVelocityY,
        },
        true,
      );
      humpty.body.setAngvel(
        Math.max(-0.5, Math.min(0.5, -this.rigVelocityX * 0.007)),
        true,
      );
      const machineStress = 0.45 + Math.min(0.5, Math.abs(this.rigVelocityY) / 70);
      const winch = this.entities.get("machine_winch");
      const pulley = this.entities.get("machine_pulley");
      if (winch) winch.stress = machineStress;
      if (pulley) pulley.stress = machineStress;
      if (this.elapsed - this.lastWinchCueAt > 0.78) {
        this.lastWinchCueAt = this.elapsed;
        this.emitSound("winch", "king", 0.58 + machineStress * 0.32, 350);
      }
    } else {
      humpty.body.setBodyType(
        RAPIER.RigidBodyType.KinematicVelocityBased,
        true,
      );
      humpty.body.setLinvel({ x: 0, y: 0 }, true);
      humpty.body.setAngvel(0, true);
      this.rescueControlled = true;
    }
  }

  private updatePuzzleRescue(humpty: PhysicsEntity): void {
    if (!humpty.body || !this.puzzleRescueAssemblyId) return;
    const operator = this.puzzleRescueOperatorId
      ? this.entities.get(this.puzzleRescueOperatorId)
      : undefined;
    const assembly = this.puzzleAssembly(this.puzzleRescueAssemblyId);
    if (!operator?.alive || !operator.body || !assembly) {
      this.puzzleRescueAssemblyId = null;
      this.puzzleRescueOperatorId = null;
      this.rescueStarted = false;
      this.rescueControlled = false;
      this.harnessFitted = false;
      this.puzzleRescueFixtureMode = false;
      return;
    }
    const capabilities = new Set(assembly.capabilities);
    if (
      !capabilities.has("support") ||
      !capabilities.has("pull") ||
      !capabilities.has("lower") ||
      !(
        capabilities.has("redirect_rope") ||
        capabilities.has("wind_rope")
      ) ||
      assembly.stability < 0.4
    ) {
      this.puzzleRescueAssemblyId = null;
      this.puzzleRescueOperatorId = null;
      this.rescueStarted = false;
      this.rescueControlled = false;
      this.harnessFitted = false;
      this.puzzleRescueFixtureMode = false;
      return;
    }
    operator.activity = "haul";
    operator.activityUntil = this.elapsed + 0.5;
    const assemblyEntity = this.entities.get(this.puzzleRescueAssemblyId);
    if (assemblyEntity?.body) {
      operator.movementTarget =
        assemblyEntity.body.translation().x +
        Math.sin(this.elapsed * 1.4) * 18;
      for (const partId of assembly.partIds) {
        const part = this.entities.get(partId);
        if (part) part.stress = 0.58;
      }
    }
    const position = humpty.body.translation();
    const safeX = 455;
    const height = position.y - GROUND_HEIGHT;
    if (!this.puzzleRescueFixtureMode && height <= 58) {
      this.puzzleRescueAssemblyId = null;
      this.puzzleRescueOperatorId = null;
      this.rescueStarted = false;
      this.rescueControlled = false;
      this.harnessFitted = false;
      this.puzzleRescueFixtureMode = false;
      return;
    }
    const runtime = Math.max(0, this.elapsed - this.puzzleRescueStartedAt);
    const raisedY = this.puzzleRescueStartY + 13;
    let targetX = this.puzzleRescueStartX;
    let targetY = raisedY;
    if (this.puzzleRescueFixtureMode) {
      const liftEndsAt = 2.25;
      const holdEndsAt = 4.25;
      const lowerEndsAt = 6.75;
      if (runtime < liftEndsAt) {
        const lift = runtime / liftEndsAt;
        targetY =
          this.puzzleRescueStartY +
          13 * (lift * lift * (3 - 2 * lift));
      } else if (runtime >= holdEndsAt) {
        const lowering = Math.min(
          1,
          (runtime - holdEndsAt) / (lowerEndsAt - holdEndsAt),
        );
        const eased = lowering * lowering * (3 - 2 * lowering);
        targetY = raisedY + (this.puzzleRescueStartY - raisedY) * eased;
      }
      if (
        runtime >= lowerEndsAt &&
        Math.abs(position.y - this.puzzleRescueStartY) < 2 &&
        Math.abs(humpty.body.linvel().y) < 6
      ) {
        this.clearPuzzleRescueFixtureRopes();
        this.puzzleRescueAssemblyId = null;
        this.puzzleRescueOperatorId = null;
        this.rescueStarted = false;
        this.rescueControlled = false;
        this.harnessFitted = false;
        this.puzzleRescueFixtureMode = false;
        return;
      }
    } else if (runtime < 1.5) {
      const lift = runtime / 1.5;
      targetY =
        this.puzzleRescueStartY +
        13 * (lift * lift * (3 - 2 * lift));
    } else if (runtime >= 3.5) {
      const descent = runtime - 3.5;
      const traverse = Math.min(1, descent / 14);
      targetX =
        this.puzzleRescueStartX +
        (safeX - this.puzzleRescueStartX) *
          (traverse * traverse * (3 - 2 * traverse));
      targetY = Math.max(GROUND_HEIGHT + 52, raisedY - descent * 10.5);
    }
    if (
      this.puzzleRescueFixtureMode &&
      this.puzzleRescueLoadRopeId &&
      this.puzzleRescueRopeStartLength > 0
    ) {
      this.setRopeMaximumLength(
        this.puzzleRescueLoadRopeId,
        this.puzzleRescueRopeStartLength -
          Math.max(0, targetY - this.puzzleRescueStartY),
      );
    }
    const velocity = humpty.body.linvel();
    const mass = Math.max(1, humpty.body.mass());
    const horizontalLimit = this.puzzleRescueFixtureMode ? 180 : 420;
    const forceX = Math.max(
      -mass * horizontalLimit,
      Math.min(
        mass * horizontalLimit,
        mass * ((targetX - position.x) * 4 - velocity.x * 8),
      ),
    );
    const forceY = Math.max(
      -mass * 400,
      Math.min(
        mass * 900,
        mass * (650 + (targetY - position.y) * 9 - velocity.y * 12),
      ),
    );
    humpty.body.resetForces(true);
    humpty.body.resetTorques(true);
    humpty.body.addForce({ x: forceX, y: forceY }, true);
    humpty.body.addTorque(
      Math.max(
        -mass * 30,
        Math.min(
          mass * 30,
          mass * (-humpty.body.rotation() * 6 - humpty.body.angvel() * 6),
        ),
      ),
      true,
    );
    if (this.elapsed - this.lastWinchCueAt > 0.78) {
      this.lastWinchCueAt = this.elapsed;
      this.emitSound("winch", "king", 0.66, position.x);
    }
  }

  private machineComplete(id: string): boolean {
    const machine = this.entities.get(id);
    return (
      machine?.kind === "machine" &&
      (machine.buildProgress ?? 1) >= 1
    );
  }

  private mechanismReady(machineId: string, stageId: string): boolean {
    const project = this.projects.get(machineId);
    return project?.commissionedStageIds.has(stageId) === true;
  }

  private applyContact(id: string, contact: ContactState): void {
    const entity = this.entities.get(id);
    if (!entity) return;
    const other = contact.otherId ? this.entities.get(contact.otherId) : undefined;
    const heavyProjectile =
      other?.kind === "stone" ||
      (!!other?.puzzleDefinition && (other.body?.mass() ?? 0) >= 15);
    if (
      heavyProjectile &&
      (entity.kind === "block" || entity.kind === "humpty") &&
      contact.impactSpeed >= 220 &&
      contact.impulse >= 32
    ) {
      this.wakeTower();
    }
    if (entity.kind === "block") {
      entity.stress = Math.max(entity.stress, Math.min(1, contact.impulse / 290));
    }
    if (contact.impulse > 52 && contact.impactSpeed > 130) {
      const cueKey = [id, contact.otherId ?? "world"].sort().join(":");
      const previousCue = this.lastImpactCueAt.get(cueKey) ?? -1;
      if (this.elapsed - previousCue > 0.28) {
        this.lastImpactCueAt.set(cueKey, this.elapsed);
        this.emitSound(
          "impact",
          entity.team ?? other?.team,
          Math.min(1, contact.impulse / 260),
          entity.body?.translation().x ?? TOWER_X,
        );
      }
    }
    if (entity.kind === "man" && entity.integrity !== undefined) {
      if (
        entity.climbGoalY === undefined &&
        contact.impulse > MAN_DAMAGE_THRESHOLD &&
        contact.impactSpeed > 130
      ) {
        const rawDamage = (contact.impulse - MAN_DAMAGE_THRESHOLD) * 0.55;
        const catastrophicFall = contact.ownVy < -420;
        const damage =
          other?.kind === "stone"
            ? Math.min(
                other.id.startsWith("bolt_") ? 6 : 8,
                rawDamage * (other.id.startsWith("bolt_") ? 0.22 : 0.28),
              )
            : catastrophicFall
              ? rawDamage
              : Math.min(5, rawDamage * 0.18);
        this.damage(entity, damage);
      }
    }
    if (entity.kind === "humpty" && entity.integrity !== undefined) {
      const hardFall =
        contact.ownVy < HUMPTY_FALL_SPEED &&
        contact.impulse > HUMPTY_DAMAGE_THRESHOLD;
      const strongProjectile =
        heavyProjectile &&
        contact.otherSpeed >
          (other?.puzzleDefinition ? STRONG_PROJECTILE_SPEED * 0.76 : STRONG_PROJECTILE_SPEED) &&
        contact.impulse > HUMPTY_DAMAGE_THRESHOLD;
      if (hardFall || strongProjectile) {
        this.damage(
          entity,
          entity.integrity,
          strongProjectile ? "projectile" : "fall",
        );
      }
    }
  }

  private damage(
    entity: PhysicsEntity,
    damage: number,
    humptyCause?: "fall" | "projectile",
  ): void {
    if (entity.integrity === undefined || entity.integrity <= 0 || damage <= 0) return;
    const appliedDamage =
      entity.kind === "man" && entity.id.endsWith("1")
        ? damage * 0.4
        : damage;
    entity.integrity = Math.max(0, entity.integrity - appliedDamage);
    entity.stress = Math.max(entity.stress, Math.min(1, appliedDamage / 45));
    if (entity.integrity > 0) return;

    entity.alive = false;
    if (entity.kind === "man" && entity.body) {
      entity.body.lockRotations(false, true);
      delete entity.movementTarget;
      const definition = AGENTS.find((agent) => agent.id === entity.id);
      this.announce(
        this.turn,
        entity.id,
        definition?.name ?? entity.id,
        entity.team ?? "king",
        "— fell silent —",
      );
      this.emitSound(
        "fall",
        entity.team,
        0.9,
        entity.body.translation().x,
      );
    }
    if (entity.kind === "humpty" && !this.cracked) {
      if (this.rescueControlled && entity.body) {
        entity.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        this.rescueControlled = false;
      }
      this.cracked = true;
      this.crackCause = humptyCause ?? "fall";
      this.crackHeight = this.humptyHeight();
      this.crackFreezeUntil = Date.now() + 3000;
      this.pendingWinnerAt = 0;
      this.phaseEndsAt = this.crackFreezeUntil;
      this.announce(
        this.turn,
        "humpty",
        "Humpty, the Egg King",
        "humpty",
        "Oh. So that is what was inside.",
      );
      this.emitSound(
        "crack",
        "humpty",
        1,
        entity.body?.translation().x ?? TOWER_X,
      );
      if (this.crackCause === "fall") {
        this.emitSound(
          "splat",
          "humpty",
          1,
          entity.body?.translation().x ?? TOWER_X,
        );
      }
      this.finishFromCrack();
    }
  }

  private updateRopeStress(): void {
    for (const rope of this.ropes.values()) {
      const from = this.entities.get(rope.fromId)?.body?.translation();
      const to = this.entities.get(rope.toId)?.body?.translation();
      if (!from || !to) continue;
      const distance = Math.hypot(to.x - from.x, to.y - from.y);
      const ratio = distance / Math.max(1, rope.maxLength);
      rope.stress = Math.max(rope.stress, Math.max(0, Math.min(1, (ratio - 0.84) * 5.4)));
    }
  }

  private updateHumptyRighting(): void {
    if (!this.humptyRighting || this.winner || this.cracked) return;
    const humpty = this.entities.get("humpty");
    if (!humpty?.body) return;
    const duration = 2.8;
    const progress = Math.max(
      0,
      Math.min(1, (this.elapsed - this.humptyRightingStartedAt) / duration),
    );
    const smooth = progress * progress * (3 - 2 * progress);
    const direction = Math.sign(this.humptyRightingStartAngle) || 1;
    const angle =
      this.humptyRightingStartAngle * (1 - smooth) +
      Math.sin(progress * Math.PI * 5) *
        direction *
        0.18 *
        (1 - progress);
    const position = humpty.body.translation();
    humpty.body.setTranslation(
      {
        x: position.x,
        y: GROUND_HEIGHT + 45,
      },
      true,
    );
    humpty.body.setRotation(angle, true);
    humpty.body.setLinvel({ x: 0, y: 0 }, true);
    humpty.body.setAngvel(0, true);
    if (progress >= 1) {
      humpty.body.setRotation(0, true);
      humpty.body.setNextKinematicRotation(0);
      this.humptyRighting = false;
      this.finishKingLanding(true);
    }
  }

  private beginHumptyRighting(angle: number): void {
    const humpty = this.entities.get("humpty");
    if (!humpty?.body || this.humptyRighting || this.winner || this.cracked) {
      return;
    }
    this.humptyRighting = true;
    this.humptyRightingStartedAt = this.elapsed;
    this.humptyRightingStartAngle = angle;
    this.rescueControlled = true;
    humpty.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    humpty.body.setLinvel({ x: 0, y: 0 }, true);
    humpty.body.setAngvel(0, true);
    this.announce(
      this.turn,
      "humpty",
      "Humpty, the Egg King",
      "humpty",
      "One moment. I can right myself.",
    );
  }

  private finishKingLanding(rockedUpright: boolean): void {
    if (this.winner || this.cracked) return;
    const humpty = this.entities.get("humpty");
    if (humpty?.body) {
      humpty.body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
      humpty.body.setTranslation(
        {
          x: humpty.body.translation().x,
          y: GROUND_HEIGHT + 45,
        },
        true,
      );
      humpty.body.setRotation(0, true);
      humpty.body.setLinvel({ x: 0, y: 0 }, true);
      humpty.body.setAngvel(0, true);
    }
    this.winner = "king";
    this.outcome = rockedUpright
      ? "Humpty rocked himself upright on the stage, safe and whole."
      : "Humpty reached the stage upright, safe and whole.";
    this.phase = "ended";
    this.phaseEndsAt = null;
    this.writeOutcome();
  }

  private checkWinConditions(): void {
    if (this.winner || this.cracked || this.humptyRighting) return;
    const humpty = this.entities.get("humpty");
    if (!humpty?.body || humpty.integrity === undefined) return;
    const height = this.humptyHeight();
    if (height > 53 || humpty.integrity <= 0) return;
    if (this.humptyPreStepVy < HUMPTY_FALL_SPEED) {
      this.damage(humpty, humpty.integrity, "fall");
      return;
    }
    const angle = Math.atan2(
      Math.sin(humpty.body.rotation()),
      Math.cos(humpty.body.rotation()),
    );
    if (Math.abs(angle) <= 0.16) {
      this.finishKingLanding(false);
      return;
    }
    this.beginHumptyRighting(angle);
  }

  private finishStalemate(): void {
    if (this.winner || this.cracked) return;
    const humpty = this.entities.get("humpty");
    if (
      humpty?.integrity !== undefined &&
      humpty.integrity > 50 &&
      this.humptyHeight() <= 55
    ) {
      const angle = humpty.body
        ? Math.atan2(
            Math.sin(humpty.body.rotation()),
            Math.cos(humpty.body.rotation()),
          )
        : 0;
      if (Math.abs(angle) <= 0.16) this.finishKingLanding(false);
      else this.beginHumptyRighting(angle);
      return;
    }
    const kingDeaths = [...this.entities.values()].filter(
      (entity) => entity.kind === "man" && entity.team === "king" && !entity.alive,
    ).length;
    const queenDeaths = [...this.entities.values()].filter(
      (entity) => entity.kind === "man" && entity.team === "queen" && !entity.alive,
    ).length;
    this.winner = "draw";
    this.outcome =
      kingDeaths + queenDeaths > 0
        ? `The courts fought to exhaustion. ${kingDeaths} King's men and ${queenDeaths} Queen's men fell; Humpty remains on the wall.`
        : "Both courts exhausted their plans while Humpty remained on the wall.";
    this.phase = "ended";
    this.phaseEndsAt = null;
    this.writeOutcome();
  }

  private finishTimeDraw(): void {
    if (this.winner || this.cracked) return;
    this.winner = "draw";
    this.outcome =
      "Ten minutes elapsed. Neither court completed its work before the curtain.";
    this.phase = "ended";
    this.phaseEndsAt = null;
    this.writeOutcome();
  }

  private finishFromCrack(): void {
    if (this.winner) return;
    this.winner = "queen";
    this.outcome =
      this.crackCause === "projectile"
        ? this.driver.model === "mock"
          ? `A Queen's projectile cracked Humpty at ${Math.round(this.crackHeight)} units.`
          : `A commissioned iron bolt cracked Humpty at ${Math.round(this.crackHeight)} units.`
        : "Humpty cracked before the King's rescue reached safety.";
    this.phase = "ended";
    this.phaseEndsAt = null;
    this.writeOutcome();
  }

  private async beginTurn(skipDeliberation = false): Promise<void> {
    if (this.deliberating || this.winner || this.manualPaused) return;
    this.deliberating = true;
    this.phase = "deliberating";
    this.turn += 1;
    const deadline =
      Date.now() +
      (skipDeliberation ? 0 : this.driver.model === "mock" ? 900 : 20_000);
    this.phaseEndsAt = deadline;
    const before = this.integrityMap();
    const sinceLastTurn = this.integrityDeltas(this.lastTurnIntegrity, before);

    const living = AGENTS.filter((agent) => this.isAgentAlive(agent));
    const requested = living.map(async (agent) => {
      const state = this.stateFor(agent);
      const timeoutMs = this.driver.model === "mock" ? 520 : 20_000;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const raw = await Promise.race([
          this.driver.act(agent, state),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error("Agent timed out")),
              timeoutMs,
            );
          }),
        ]);
        return { agent, raw };
      } catch (error) {
        return {
          agent,
          raw: { action: { type: "wait" } },
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    });

    const results = await Promise.all(requested);
    const remaining = deadline - Date.now();
    if (remaining > 0 && this.driver.model === "mock" && !skipDeliberation) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }

    for (const result of results) {
      const validated = validateSubmission(result.raw);
      const resolution = validated.accepted
        ? this.applyAction(result.agent, validated.submission)
        : { accepted: false, reason: validated.reason };
      if (validated.submission.say && this.isAgentAlive(result.agent)) {
        this.announce(
          this.turn,
          result.agent.id,
          result.agent.name,
          result.agent.team,
          validated.submission.say,
          this.speechDelayMs(result.agent),
        );
      }
      const after = this.integrityMap();
      const deltas = [
        ...sinceLastTurn,
        ...this.integrityDeltas(before, after),
      ];
      this.writeLedger({
        type: "turn",
        at: new Date().toISOString(),
        turn: this.turn,
        agentId: result.agent.id,
        team: result.agent.team,
        model: this.driver.model,
        rawAction: result.raw,
        accepted: validated.accepted && resolution.accepted,
        rejection: result.error ?? validated.reason ?? resolution.reason ?? null,
        integrityChanges: deltas,
        humptyHeight: Math.round(this.humptyHeight() * 10) / 10,
      });
    }

    this.lastTurnIntegrity = this.integrityMap();
    this.deliberating = false;
    this.phase = "running";
    this.phaseEndsAt = Date.now() + TURN_SECONDS * 1000;
  }

  private initializeAgentSchedules(): void {
    if (this.driver.model === "mock") return;
    if (this.driver.actTeam) {
      this.nextTeamDecisionAt.set("king", this.rng.range(0.35, 0.8));
      this.nextTeamDecisionAt.set("queen", this.rng.range(0.7, 1.2));
      this.nextAgentDecisionAt.set("humpty", this.rng.range(7, 11));
      this.phaseEndsAt = null;
      return;
    }
    const openingOffsets: Record<string, number> = {
      king: 1,
      queen: 2.8,
      king_1: 4,
      queen_1: 5,
      king_2: 6,
      queen_2: 7,
      king_3: 8,
      queen_3: 9,
      humpty: 10,
    };
    for (const agent of AGENTS) {
      this.nextAgentDecisionAt.set(
        agent.id,
        (openingOffsets[agent.id] ?? 4) + this.rng.range(0, 1.2),
      );
    }
    this.phaseEndsAt = null;
  }

  private agentDecisionInterval(agent: AgentDefinition): number {
    if (agent.id === "king" || agent.id === "queen") {
      return this.rng.range(22, 34);
    }
    if (agent.id === "humpty") {
      return this.rng.range(18, 30);
    }
    return this.rng.range(12, 20);
  }

  private teamDecisionInterval(): number {
    return this.rng.range(5.5, 7.5);
  }

  private startDueAgentDecisions(): void {
    if (this.driver.actTeam) {
      for (const team of ["king", "queen"] as const) {
        if (
          this.activeTeamDecisions.has(team) ||
          this.elapsed < (this.nextTeamDecisionAt.get(team) ?? 0)
        ) {
          continue;
        }
        const needsAssignment = AGENTS.some(
          (agent) =>
            agent.team === team &&
            agent.id !== team &&
            this.isAgentAlive(agent) &&
            !this.puzzleWorkerBusy(agent.id) &&
            (this.entities.get(agent.id)?.combatUntil ?? 0) <= this.elapsed,
        );
        if (!needsAssignment) {
          this.nextTeamDecisionAt.set(team, this.elapsed + 1.25);
          continue;
        }
        this.nextTeamDecisionAt.set(
          team,
          this.elapsed + this.teamDecisionInterval(),
        );
        void this.beginTeamDecision(team);
      }
      const humpty = AGENTS.find((agent) => agent.id === "humpty");
      if (
        humpty &&
        !this.activeAgentDecisions.has(humpty.id) &&
        this.isAgentAlive(humpty) &&
        this.elapsed >= (this.nextAgentDecisionAt.get(humpty.id) ?? 0)
      ) {
        this.nextAgentDecisionAt.set(
          humpty.id,
          this.elapsed + this.agentDecisionInterval(humpty),
        );
        void this.beginAgentDecision(humpty);
      }
      return;
    }
    for (const agent of AGENTS) {
      if (
        this.activeAgentDecisions.has(agent.id) ||
        !this.isAgentAlive(agent) ||
        this.elapsed < (this.nextAgentDecisionAt.get(agent.id) ?? 0)
      ) {
        continue;
      }
      this.nextAgentDecisionAt.set(
        agent.id,
        this.elapsed + this.agentDecisionInterval(agent),
      );
      void this.beginAgentDecision(agent);
    }
  }

  private parseTeamSubmission(raw: unknown): TeamAgentSubmission {
    if (typeof raw !== "object" || raw === null) return { actions: [] };
    const candidate = raw as Record<string, unknown>;
    const order =
      typeof candidate.order === "string"
        ? candidate.order.trim().slice(0, 80)
        : undefined;
    const intent =
      typeof candidate.intent === "string"
        ? candidate.intent.trim().slice(0, 160)
        : undefined;
    const actions = Array.isArray(candidate.actions)
      ? candidate.actions
          .filter(
            (entry): entry is Record<string, unknown> =>
              typeof entry === "object" && entry !== null,
          )
          .flatMap((entry) => {
            if (
              typeof entry.agentId !== "string" ||
              typeof entry.action !== "object" ||
              entry.action === null
            ) {
              return [];
            }
            return [
              {
                agentId: entry.agentId,
                ...(typeof entry.say === "string"
                  ? { say: entry.say.trim().slice(0, 80) }
                  : {}),
                action: entry.action,
              } as TeamAgentSubmission["actions"][number],
            ];
          })
      : [];
    return {
      ...(order ? { order } : {}),
      ...(intent ? { intent } : {}),
      actions,
    };
  }

  private async beginTeamDecision(team: WorkerTeam): Promise<void> {
    const actTeam = this.driver.actTeam;
    if (
      !actTeam ||
      this.winner ||
      this.manualPaused ||
      this.activeTeamDecisions.has(team)
    ) {
      return;
    }
    const decisionRunId = this.runId;
    this.activeTeamDecisions.add(team);
    this.turn += 1;
    const decision = this.turn;
    const before = this.integrityMap();
    const state = this.teamStateFor(team);
    const stateBytes = JSON.stringify(state).length;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let raw: unknown = { actions: [] };
    let error: string | undefined;

    try {
      raw = await Promise.race([
        actTeam.call(this.driver, team, state),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Team decision timed out")),
            REAL_TEAM_TIMEOUT_MS,
          );
        }),
      ]);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
      console.warn(`${team} team used local initiative: ${error}`);
    } finally {
      if (timeout) clearTimeout(timeout);
    }

    const canAct =
      this.runId === decisionRunId && !this.winner && !this.manualPaused;
    if (!canAct) {
      if (this.runId === decisionRunId) this.activeTeamDecisions.delete(team);
      return;
    }

    const plan = this.parseTeamSubmission(raw);
    const commander =
      team === "king"
        ? {
            id: "humpty",
            name: "Humpty, the Egg King",
            team: "king" as const,
            alive: (this.entities.get("humpty")?.integrity ?? 0) > 0,
          }
        : {
            id: "queen",
            name: "The Queen",
            team: "queen" as const,
            alive: this.entities.get("queen")?.alive === true,
          };
    if (plan.order && commander.alive) {
      this.announce(
        decision,
        commander.id,
        commander.name,
        commander.team,
        plan.order,
        this.rng.range(80, 420),
      );
    }
    this.writeLedger({
      type: "team_plan",
      at: new Date().toISOString(),
      turn: decision,
      team,
      model: this.driver.model,
      stateBytes,
      order: plan.order ?? null,
      intent: plan.intent ?? null,
      modelError: error ?? null,
    });

    const planned = new Map(
      plan.actions.map((entry) => [entry.agentId, entry] as const),
    );
    const workers = AGENTS.filter(
      (agent) =>
        agent.team === team &&
        agent.id !== team &&
        this.isAgentAlive(agent),
    );
    const fallbackReservations = new Set<string>();
    for (const worker of workers) {
      if (this.puzzleWorkerBusy(worker.id)) continue;
      const requested = planned.get(worker.id);
      const validated = validateSubmission(
        requested
          ? { ...(requested.say ? { say: requested.say } : {}), action: requested.action }
          : { action: { type: "wait" } },
      );
      const requestedWait = validated.submission.action.type === "wait";
      let applied = validated;
      let resolution: ActionResolution = {
        accepted: false,
        reason: validated.reason ?? "No coordinated action supplied",
      };
      if (validated.accepted && !requestedWait) {
        resolution = this.applyAction(worker, validated.submission);
      }
      if (!validated.accepted || requestedWait || !resolution.accepted) {
        applied = validateSubmission(
          this.fallbackSubmissionFor(worker, fallbackReservations),
        );
        resolution = applied.accepted
          ? this.applyAction(worker, applied.submission)
          : {
              accepted: false,
              reason: applied.reason ?? "Fallback action was invalid",
            };
      }
      if (applied.submission.say && resolution.accepted) {
        this.announce(
          decision,
          worker.id,
          worker.name,
          worker.team,
          applied.submission.say,
          this.rng.range(120, 780),
        );
      }
      this.writeLedger({
        type: "team_turn",
        at: new Date().toISOString(),
        turn: decision,
        agentId: worker.id,
        team,
        model: this.driver.model,
        stateBytes,
        rawAction: applied.submission,
        requestedAction: requested ?? null,
        accepted: resolution.accepted,
        rejection: error ?? resolution.reason ?? null,
        integrityChanges: this.integrityDeltas(before, this.integrityMap()),
        humptyHeight: Math.round(this.humptyHeight() * 10) / 10,
      });
    }
    this.lastTurnIntegrity = this.integrityMap();
    this.activeTeamDecisions.delete(team);
    if (error) {
      this.nextTeamDecisionAt.set(team, this.elapsed + this.rng.range(1.2, 2.2));
    }
  }

  private async beginAgentDecision(agent: AgentDefinition): Promise<void> {
    if (this.winner || this.manualPaused || !this.isAgentAlive(agent)) return;
    const decisionRunId = this.runId;
    this.activeAgentDecisions.add(agent.id);
    this.turn += 1;
    const decision = this.turn;
    const before = this.integrityMap();
    const state = this.stateFor(agent);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let raw: unknown = { action: { type: "wait" } };
    let error: string | undefined;

    try {
      raw = await Promise.race([
        this.driver.act(agent, state),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Agent timed out")),
            REAL_AGENT_TIMEOUT_MS,
          );
        }),
      ]);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
      console.warn(`Agent ${agent.name} waited: ${error}`);
    } finally {
      if (timeout) clearTimeout(timeout);
    }

    const canAct =
      this.runId === decisionRunId &&
      !this.winner &&
      !this.manualPaused &&
      this.isAgentAlive(agent);
    const validated = validateSubmission(raw);
    const resolution =
      canAct && validated.accepted
        ? this.applyAction(agent, validated.submission)
        : {
            accepted: false,
            reason: canAct ? validated.reason : "World state changed",
          };

    if (
      canAct &&
      validated.submission.say &&
      this.isAgentAlive(agent)
    ) {
      this.announce(
        decision,
        agent.id,
        agent.name,
        agent.team,
        validated.submission.say,
        this.rng.range(120, 950),
      );
    }

    const after = this.integrityMap();
    const workerWaitedWithoutTask =
      agent.id !== "king" &&
      agent.id !== "queen" &&
      agent.id !== "humpty" &&
      validated.submission.action.type === "wait" &&
      !state.currentTask;
    if (
      !error &&
      (!validated.accepted || !resolution.accepted || workerWaitedWithoutTask)
    ) {
      this.nextAgentDecisionAt.set(
        agent.id,
        this.elapsed + this.rng.range(2.5, 5),
      );
    }
    this.writeLedger({
      type: "turn",
      at: new Date().toISOString(),
      turn: decision,
      agentId: agent.id,
      team: agent.team,
      model: this.driver.model,
      rawAction: raw,
      accepted: canAct && validated.accepted && resolution.accepted,
      rejection: error ?? validated.reason ?? resolution.reason ?? null,
      integrityChanges: this.integrityDeltas(before, after),
      humptyHeight: Math.round(this.humptyHeight() * 10) / 10,
    });
    this.lastTurnIntegrity = after;
    if (this.runId === decisionRunId) {
      this.activeAgentDecisions.delete(agent.id);
    }
  }

  private speechDelayMs(agent: AgentDefinition): number {
    const schedules: Record<string, readonly number[]> = {
      king: [150, 4150, 1250, 5850, 2350, 6650, 650, 3650, 2850, 5450],
      queen: [350, 5350, 1850, 6250, 2650, 7150, 850, 4550, 3350, 6750],
      king_1: [450, 1250, 650, 3250, 900, 2100, 700, 3450, 1050, 2500],
      king_2: [2850, 4650, 3100, 900, 4200, 5200, 2400, 1100, 4350, 700],
      king_3: [6200, 2500, 5650, 1500, 6100, 3600, 5350, 2750, 6500, 3900],
      queen_1: [1750, 550, 2150, 4700, 1300, 3750, 1650, 650, 2900, 1450],
      queen_2: [5100, 3150, 800, 2550, 5450, 1050, 4650, 3500, 750, 5200],
      queen_3: [7600, 5950, 4300, 6800, 2500, 6250, 3150, 5900, 4850, 2700],
      humpty: [3950, 7200, 3550, 7350, 4750, 6900, 4050, 7450, 5150, 6650],
    };
    const schedule = schedules[agent.id] ?? [0];
    return schedule[(this.turn - 1) % schedule.length] ?? 0;
  }

  private isAgentAlive(agent: AgentDefinition): boolean {
    if (agent.team === "humpty") {
      return (this.entities.get("humpty")?.integrity ?? 0) > 0;
    }
    return this.entities.get(agent.id)?.alive === true;
  }

  private applyAction(
    agent: AgentDefinition,
    submission: AgentSubmission,
  ): ActionResolution {
    const actor = this.entities.get(agent.id);
    if (agent.team !== "humpty" && (!actor?.body || !actor.alive)) {
      return { accepted: false, reason: "Agent is not able to act" };
    }

    const action = submission.action;
    if (
      this.puzzleParts.size > 0 &&
      [
        "place_plank",
        "place_item",
        "start_project",
        "fit_item",
        "operate",
        "attach_rope",
        "throw",
        "shoot",
      ].includes(action.type)
    ) {
      return {
        accepted: false,
        reason: "Use only the declared opening parts and their physical ports",
      };
    }
    switch (action.type) {
      case "wait":
        if (actor?.alive) {
          const project = actor.constructionTargetId
            ? this.entities.get(actor.constructionTargetId)
            : undefined;
          actor.activity =
            project?.buildProgress !== undefined && project.buildProgress < 1
              ? "build"
              : agent.team === "king" && this.rescueStarted
                ? "haul"
                : "guard";
          actor.activityUntil = this.elapsed + TURN_SECONDS;
        }
        return { accepted: true };
      case "move": {
        if (!actor) return { accepted: false, reason: "No movable body" };
        actor.movementTarget = Math.max(42, Math.min(WORLD_WIDTH - 42, action.x));
        if (action.y !== undefined) {
          actor.movementDepthTarget =
            Math.max(STAGE_DEPTH_MIN, Math.min(STAGE_DEPTH_MAX, action.y)) /
            STAGE_DEPTH_SCALE;
        }
        actor.activity = "march";
        actor.activityUntil = this.elapsed + TURN_SECONDS;
        return { accepted: true };
      }
      case "climb": {
        if (!actor?.body) return { accepted: false, reason: "No climbing body" };
        const target = this.entities.get(action.targetId);
        if (!target?.body) return { accepted: false, reason: "Unknown climb target" };
        if (target.kind === "machine" && target.machinePart === "ladder") {
          if ((target.buildProgress ?? 1) < 1) {
            return { accepted: false, reason: "Ladder assembly is incomplete" };
          }
          const ladder = target.body.translation();
          const descending = actor.body.translation().y > GROUND_HEIGHT + 180;
          actor.climbTargetX = ladder.x - 8;
          actor.climbGoalY = descending
            ? GROUND_HEIGHT + 36.5
            : ladder.y + (target.height ?? 460) / 2 - 46;
          delete actor.movementTarget;
          actor.activity = "climb";
          actor.activityUntil = this.elapsed + TURN_SECONDS;
          return { accepted: true };
        }
        const from = actor.body.translation();
        const to = target.body.translation();
        if (Math.hypot(to.x - from.x, to.y - from.y) > 230) {
          return { accepted: false, reason: "Climb target is not adjacent" };
        }
        actor.body.setLinvel(
          {
            x: Math.max(-90, Math.min(90, (to.x - from.x) * 1.8)),
            y: 205,
          },
          true,
        );
        this.emitSound("climb", agent.team, 0.7, from.x);
        actor.activity = "climb";
        actor.activityUntil = this.elapsed + 2;
        return { accepted: true };
      }
      case "place_plank": {
        if (agent.team === "humpty" || !actor) {
          return { accepted: false, reason: "Humpty cannot place supplies" };
        }
        const supply = this.supply[agent.team];
        if (supply.planks <= 0) return { accepted: false, reason: "No planks remain" };
        supply.planks -= 1;
        this.createPlank(agent.team, action.x, action.y, action.angle);
        const position = actor.body?.translation();
        actor.movementTarget = Math.max(
          42,
          Math.min(
            WORLD_WIDTH - 42,
            (position?.x ?? action.x) + (agent.team === "king" ? 90 : -90),
          ),
        );
        this.emitSound("hammer", agent.team, 0.78, action.x);
        actor.activity = "build";
        actor.activityUntil = this.elapsed + 4.5;
        return { accepted: true };
      }
      case "place_item": {
        if (agent.team === "humpty" || !actor) {
          return { accepted: false, reason: "Humpty cannot place inventory" };
        }
        return {
          accepted: false,
          reason: `Loose ${action.itemId} stock must be fetched and worked through a project`,
        };
      }
      case "start_project": {
        if (agent.team === "humpty" || !actor?.body) {
          return { accepted: false, reason: "No builder available" };
        }
        return this.startConstructionProject(
          agent.team,
          actor,
          action.blueprintId,
        );
      }
      case "fit_item": {
        if (agent.team === "humpty" || !actor?.body) {
          return { accepted: false, reason: "No fitter available" };
        }
        return {
          accepted: false,
          reason: `Loose ${action.itemId} must be fabricated and mounted through a project`,
        };
      }
      case "snap":
      case "connect": {
        if (agent.team === "humpty" || !actor?.body) {
          return { accepted: false, reason: "No assembler available" };
        }
        return this.beginPuzzleSnap(
          agent,
          actor,
          action.partId,
          action.targetId,
        );
      }
      case "test": {
        if (agent.team === "humpty" || !actor?.body) {
          return { accepted: false, reason: "No tester available" };
        }
        return this.testPuzzleAssembly(agent, actor, action.partId, action.effort);
      }
      case "sabotage": {
        if (agent.team === "humpty" || !actor?.body) {
          return { accepted: false, reason: "No saboteur available" };
        }
        return this.sabotagePuzzleConnection(
          agent,
          actor,
          action.connectionId,
          action.method,
        );
      }
      case "repair": {
        if (agent.team === "humpty" || !actor?.body) {
          return { accepted: false, reason: "No repairer available" };
        }
        return this.repairPuzzleConnection(agent, actor, action.connectionId);
      }
      case "recover": {
        if (agent.team === "humpty" || !actor?.body) {
          return { accepted: false, reason: "No recovery worker available" };
        }
        return this.beginPuzzleRecovery(agent, actor, action.partId);
      }
      case "detach": {
        if (agent.team === "humpty" || !actor?.body) {
          return { accepted: false, reason: "No worker can detach that part" };
        }
        return this.detachPuzzlePart(agent, actor, action.partId);
      }
      case "use_assembly": {
        if (agent.team === "humpty" || !actor?.body) {
          return { accepted: false, reason: "No operator available" };
        }
        return this.usePuzzleAssembly(
          agent,
          actor,
          action.partId,
          action.targetId,
          action.effort,
        );
      }
      case "operate": {
        if (agent.team === "humpty" || !actor?.body) {
          return { accepted: false, reason: "No operator available" };
        }
        const target = this.entities.get(action.targetId);
        if (
          !target?.body ||
          target.kind !== "machine" ||
          target.machinePart !== "winch" ||
          (target.buildProgress ?? 1) < 1
        ) {
          return { accepted: false, reason: "Winch is not complete and operable" };
        }
        const role = Number(agent.id.at(-1) ?? 1) - 1;
        actor.movementTarget = target.body.translation().x - 62 - role * 42;
        actor.activity = "haul";
        actor.activityUntil = this.elapsed + TURN_SECONDS;
        this.machineOperatingUntil = Math.max(
          this.machineOperatingUntil,
          this.elapsed + TURN_SECONDS * Math.max(0.35, action.effort),
        );
        return { accepted: true };
      }
      case "attach_rope": {
        if (agent.team === "humpty") {
          return { accepted: false, reason: "Humpty cannot attach ropes" };
        }
        const supply = this.supply[agent.team];
        if (supply.ropes <= 0) return { accepted: false, reason: "No ropes remain" };
        const from = this.entities.get(action.fromId);
        const to = this.entities.get(action.toId);
        if (!from?.body || !to?.body || from.id === to.id) {
          return { accepted: false, reason: "Rope endpoints are invalid" };
        }
        if (
          (from.kind === "machine" && (from.buildProgress ?? 1) < 1) ||
          (to.kind === "machine" && (to.buildProgress ?? 1) < 1)
        ) {
          return { accepted: false, reason: "Rope attachment requires completed fittings" };
        }
        if (
          to.id === "humpty" &&
          (from.id !== "machine_pulley" || !this.harnessFitted)
        ) {
          return {
            accepted: false,
            reason: "Humpty requires a fitted sling and pulley line",
          };
        }
        supply.ropes -= 1;
        this.createRope(agent.team, from, to);
        if (actor && agent.team === "king") {
          const role = Number(agent.id.at(-1) ?? 2) - 1;
          const winch = this.entities.get("machine_winch")?.body?.translation();
          actor.movementTarget = winch
            ? winch.x - 64 - role * 46
            : TOWER_X - 225 - role * 70;
          actor.activity = "rig";
          actor.activityUntil = this.elapsed + 6;
        }
        this.emitSound(
          "rope",
          agent.team,
          0.72,
          (from.body.translation().x + to.body.translation().x) / 2,
        );
        return { accepted: true };
      }
      case "shift_weight": {
        if (agent.id !== "humpty" || !actor?.body) {
          return { accepted: false, reason: "Only Humpty can shift his weight" };
        }
        const direction = action.direction;
        actor.body.applyTorqueImpulse(direction * action.effort * 3.8, true);
        actor.body.applyImpulse(
          { x: direction * action.effort * 2.6, y: 0 },
          true,
        );
        return { accepted: true };
      }
      case "cut_rope": {
        const rope = this.ropes.get(action.ropeId);
        if (!rope) return { accepted: false, reason: "Unknown rope" };
        if (rope.joint) this.world.removeImpulseJoint(rope.joint, true);
        this.ropes.delete(action.ropeId);
        this.emitSound("rope", agent.team, 0.9, actor?.body?.translation().x ?? TOWER_X);
        return { accepted: true };
      }
      case "carry": {
        if (!actor?.body) return { accepted: false, reason: "No carrying body" };
        const target = this.entities.get(action.targetId);
        if (!target?.body || (target.kind !== "plank" && target.kind !== "stone")) {
          return { accepted: false, reason: "Target cannot be carried" };
        }
        if (target.carriedBy === agent.id) {
          delete target.carriedBy;
          target.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
          return { accepted: true };
        }
        const from = actor.body.translation();
        const to = target.body.translation();
        if (Math.hypot(to.x - from.x, to.y - from.y) > 95) {
          return { accepted: false, reason: "Carry target is too far away" };
        }
        target.carriedBy = agent.id;
        target.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
        return { accepted: true };
      }
      case "push": {
        if (!actor?.body) return { accepted: false, reason: "No pushing body" };
        const target = this.entities.get(action.targetId);
        if (!target?.body) return { accepted: false, reason: "Unknown push target" };
        if (
          this.driver.model !== "mock" &&
          target.team !== agent.team &&
          !["contest", "decisive"].includes(this.matchBeat())
        ) {
          return {
            accepted: false,
            reason: "Direct conflict opens during the contest phase",
          };
        }
        const from = actor.body.translation();
        const to = target.body.translation();
        const distance = this.stageDistance(actor, target);
        const reach = target.kind === "man" ? 300 : 260;
        if (distance > reach) {
          actor.movementTarget = Math.max(
            42,
            Math.min(WORLD_WIDTH - 42, to.x - action.dir * reach * 0.45),
          );
          this.setMovementDepth(actor, target.puzzleDepth);
          actor.activity = "march";
          actor.activityUntil = this.elapsed + TURN_SECONDS;
          return { accepted: true, reason: "Approaching push target" };
        }
        if (target.kind === "block" || target.kind === "humpty") {
          this.wakeTower();
        }
        if (target.puzzleDefinition) {
          const partIds = this.assemblyPartIds(target.id);
          for (const partId of partIds) {
            const part = this.entities.get(partId);
            if (!part?.body) continue;
            const position = part.body.translation();
            part.body.setNextKinematicTranslation({
              x: Math.max(
                24,
                Math.min(WORLD_WIDTH - 24, position.x + action.dir * 42),
              ),
              y: position.y,
            });
            part.assemblyState = "staged";
          }
          actor.movementTarget = target.body.translation().x;
          actor.activity = "lift";
          actor.activityUntil = this.elapsed + 2.4;
          this.emitSound("shove", agent.team, 0.64, to.x);
          return { accepted: true, entityId: target.id };
        }
        if (target.kind === "man") {
          delete actor.movementTarget;
          delete target.movementTarget;
          actor.combatTarget = target.id;
          target.combatTarget = actor.id;
          actor.combatUntil = this.elapsed + 2.4;
          target.combatUntil = this.elapsed + 2.4;
          actor.nextCombatAt = this.elapsed;
          target.nextCombatAt = this.elapsed;
        }
        const impulse =
          target.kind === "block" ? 390 : target.kind === "man" ? 26 : 180;
        const lift = target.kind === "man" ? 8 : 18;
        target.body.applyImpulseAtPoint(
          { x: action.dir * impulse, y: lift },
          { x: to.x, y: to.y + (target.height ?? 20) * 0.32 },
          true,
        );
        actor.body.applyImpulse({ x: action.dir * 18, y: 8 }, true);
        target.stress = 1;
        actor.activity = "fight";
        actor.activityUntil = this.elapsed + 2.4;
        this.emitSound(
          "shove",
          agent.team,
          target.kind === "man" ? 0.92 : 0.8,
          to.x,
        );
        return { accepted: true };
      }
      case "use_weapon": {
        if (agent.team === "humpty" || !actor?.body) {
          return { accepted: false, reason: "No armed worker available" };
        }
        if (
          this.driver.model !== "mock" &&
          !["contest", "decisive"].includes(this.matchBeat())
        ) {
          return {
            accepted: false,
            reason: "Hand weapons remain grounded until the contest phase",
          };
        }
        const target = this.entities.get(action.targetId);
        const opposingMan =
          target?.kind === "man" &&
          target.alive !== false &&
          target.team !== agent.team;
        const queenAimingAtHumpty =
          this.driver.model === "mock" &&
          action.weapon === "crossbow" &&
          agent.team === "queen" &&
          target?.kind === "humpty";
        if (!target?.body || (!opposingMan && !queenAimingAtHumpty)) {
          return { accepted: false, reason: "Weapon target is invalid" };
        }
        if (actor.equippedWeapon && actor.equippedWeapon !== action.weapon) {
          return {
            accepted: false,
            reason: `Worker is already carrying a ${actor.equippedWeapon}`,
          };
        }
        const supply = this.supply[agent.team];
        if (!actor.equippedWeapon) {
          const available =
            action.weapon === "pike" ? supply.pikes : supply.crossbows;
          if (available <= 0) {
            return {
              accepted: false,
              reason: `No ${action.weapon} remains in team stock`,
            };
          }
          actor.equippedWeapon = action.weapon;
          if (action.weapon === "pike") supply.pikes -= 1;
          else supply.crossbows -= 1;
        }

        const from = actor.body.translation();
        const to = target.body.translation();
        const deltaX = to.x - from.x;
        const distance = this.stageDistance(actor, target);
        const direction =
          Math.sign(deltaX) || (agent.team === "king" ? 1 : -1);
        if (action.weapon === "pike") {
          if (!opposingMan) {
            return { accepted: false, reason: "Pike requires a living opposing worker" };
          }
          if (distance > 135) {
            actor.movementTarget = Math.max(
              42,
              Math.min(WORLD_WIDTH - 42, to.x - direction * 92),
            );
            this.setMovementDepth(actor, target.puzzleDepth);
            actor.activity = "march";
            actor.activityUntil = this.elapsed + TURN_SECONDS;
            return { accepted: true };
          }
          delete actor.movementTarget;
          delete target.movementTarget;
          actor.combatTarget = target.id;
          target.combatTarget = actor.id;
          actor.combatUntil = this.elapsed + 4.2;
          target.combatUntil = this.elapsed + 4.2;
          actor.nextCombatAt = this.elapsed + 0.9;
          target.nextCombatAt = this.elapsed + 0.9;
          target.body.applyImpulse(
            { x: direction * 34, y: 7 },
            true,
          );
          this.damage(target, 2.2 + this.rng.range(0, 1.4));
          actor.activity = "fight";
          actor.activityUntil = this.elapsed + 4.2;
          target.activity = "fight";
          target.activityUntil = this.elapsed + 4.2;
          this.emitSound("shove", agent.team, 0.94, to.x, {
            weapon: "pike",
            targetId: target.id,
          });
          return { accepted: true };
        }

        if (supply.bolts <= 0) {
          return { accepted: false, reason: "No crossbow bolts remain" };
        }
        if (distance > 650) {
          actor.movementTarget = Math.max(
            42,
            Math.min(WORLD_WIDTH - 42, to.x - direction * 520),
          );
          this.setMovementDepth(actor, target.puzzleDepth);
          actor.activity = "march";
          actor.activityUntil = this.elapsed + TURN_SECONDS;
          return { accepted: true };
        }
        supply.bolts -= 1;
        this.fireCrossbowBolt(agent.team, actor, target);
        actor.activity = "aim";
        actor.activityUntil = this.elapsed + 3.2;
        this.emitSound("throw", agent.team, 0.82, from.x, {
          weapon: "crossbow",
          targetId: target.id,
        });
        return { accepted: true };
      }
      case "throw": {
        if (agent.team === "humpty" || !actor?.body) {
          return { accepted: false, reason: "No throwing body" };
        }
        const target = this.entities.get(action.targetId);
        if (!target?.body || target.kind !== "stone" || target.team !== agent.team) {
          return { accepted: false, reason: "Unknown team stone" };
        }
        const position = actor.body.translation();
        const siegeReady = [
          ["queen_machine_cart", "rolling_train"],
          ["queen_machine_cart", "load_bed"],
          ["queen_machine_cart", "drawbar_control"],
          ["queen_machine_lever", "pivoted_arm"],
          ["queen_machine_lever", "gravity_store"],
          ["queen_machine_lever", "limited_output"],
          ["queen_machine_spring_trap", "braced_launcher"],
          ["queen_machine_spring_trap", "cocking_windlass"],
          ["queen_machine_spring_trap", "incremental_hold"],
          ["queen_machine_spring_trap", "torsion_store"],
          ["queen_machine_spring_trap", "throwing_lever"],
          ["queen_machine_spring_trap", "controlled_release"],
        ].every(([machineId, stageId]) =>
          this.mechanismReady(machineId!, stageId!),
        );
        target.collider?.setCollisionGroups(PROJECTILE_IGNORE_TOWER_GROUPS);
        const siegeShot =
          agent.team === "queen" &&
          target.id === "stone_queen_9" &&
          siegeReady;
        const speed = siegeShot
          ? 1060
          : 260 + action.power * (agent.team === "queen" ? 390 : 640);
        const launcher = siegeShot
          ? this.entities.get("queen_machine_spring_trap")
          : undefined;
        const launchPosition = launcher?.body?.translation() ?? {
          x: position.x,
          y: position.y + 26,
        };
        target.body.setTranslation(launchPosition, true);
        const aimSpread =
          agent.team === "queen"
            ? this.rng.range(siegeShot ? -0.045 : -0.09, siegeShot ? 0.045 : 0.09)
            : 0;
        const humpty = this.entities.get("humpty")?.body?.translation();
        const launchAngle =
          siegeShot && humpty
            ? lowBallisticAngle(
                launchPosition.x,
                launchPosition.y,
                humpty.x,
                humpty.y - 18,
                speed,
              ) + aimSpread
            : action.angle + aimSpread;
        target.body.setLinvel(
          { x: Math.cos(launchAngle) * speed, y: Math.sin(launchAngle) * speed },
          true,
        );
        if (this.turn < 8) target.expiresAt = this.elapsed + 1.8;
        target.body.setAngvel((agent.team === "king" ? 1 : -1) * 11, true);
        actor.movementTarget = Math.max(
          42,
          Math.min(
            WORLD_WIDTH - 42,
            position.x + (agent.team === "king" ? 36 : -36),
          ),
        );
        actor.activity = "aim";
        actor.activityUntil = this.elapsed + 2.4;
        this.supply[agent.team].stones = Math.max(
          0,
          this.supply[agent.team].stones - 1,
        );
        this.emitSound(
          "throw",
          agent.team,
          0.65 + action.power * 0.35,
          launchPosition.x,
        );
        return { accepted: true };
      }
    }
  }

  private startConstructionProject(
    team: "king" | "queen",
    worker: PhysicsEntity,
    blueprintId: BlueprintId,
  ): ActionResolution {
    if (!worker.body) return { accepted: false, reason: "Builder has no position" };
    const queenOnly =
      blueprintId === "barricade" || blueprintId === "spring_trap";
    const queenAllowed =
      queenOnly || blueprintId === "cart" || blueprintId === "lever";
    if (queenOnly && team !== "queen") {
      return { accepted: false, reason: "That fieldwork is unavailable" };
    }
    if (team === "queen" && !queenAllowed) {
      return { accepted: false, reason: "That assembly is unavailable" };
    }
    const currentProject = worker.constructionTargetId
      ? this.projects.get(worker.constructionTargetId)
      : undefined;
    if (currentProject && currentProject.phase !== "complete") {
      return {
        accepted: false,
        reason: `Builder is still working on ${currentProject.plan.label}`,
      };
    }

    const sequence = this.machineSequence++;
    const workerPosition = worker.body.translation();
    const plan = createBlueprint(
      blueprintId,
      team,
      sequence,
      workerPosition.x,
    );
    if (this.projects.has(plan.machineId) || this.entities.has(plan.machineId)) {
      return { accepted: false, reason: `${plan.label} already exists` };
    }
    const supply = this.supply[team];
    const supplyKey: keyof Supply =
      blueprintId === "ladder"
        ? "ladders"
        : blueprintId === "cart"
          ? "wheelSets"
          : blueprintId === "lever"
            ? "leverSets"
            : blueprintId === "screw_jack"
              ? "screwSets"
              : blueprintId === "spring_trap"
                ? "springSets"
        : blueprintId === "pulley"
          ? "pulleys"
          : blueprintId === "winch"
            ? "capstans"
            : blueprintId === "sling"
              ? "slings"
              : "timber";
    if (supply[supplyKey] <= 0) {
      return { accepted: false, reason: `No stock remains for ${plan.label}` };
    }
    supply[supplyKey] -= 1;

    const machineBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(plan.center.x, plan.center.y)
        .setRotation(plan.center.angle),
    );
    this.addEntity({
      id: plan.machineId,
      kind: "machine",
      ...(plan.machinePart ? { machinePart: plan.machinePart } : {}),
      team,
      body: machineBody,
      width: plan.width,
      height: plan.height,
      buildProgress: 0,
      buildStage: "collecting stock",
      material: plan.material,
      placed: true,
      stress: 0,
    });

    for (const componentPlan of plan.components) {
      this.createConstructionComponent(plan.machineId, team, componentPlan);
    }
    this.projects.set(plan.machineId, {
      plan,
      workerId: worker.id,
      componentIds: plan.components.map((component) => component.id),
      phase: "components",
      finalizationProgress: 0,
      commissionedStageIds: new Set(),
      commissioningProgress: 0,
      lastCueAt: -Infinity,
    });
    worker.constructionTargetId = plan.machineId;
    worker.activity = "march";
    worker.activityUntil = this.elapsed + TURN_SECONDS;
    return { accepted: true, entityId: plan.machineId };
  }

  private createConstructionComponent(
    projectId: string,
    team: "king" | "queen",
    plan: ComponentPlan,
  ): void {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(plan.source.x, plan.source.y)
        .setRotation(plan.source.angle),
    );
    this.addEntity({
      id: plan.id,
      kind: "component",
      team,
      body,
      componentType: plan.componentType,
      componentLabel: plan.label,
      projectId,
      assemblyState: "stock",
      ...(plan.connection ? { connectionType: plan.connection } : {}),
      ...(plan.width !== undefined ? { width: plan.width } : {}),
      ...(plan.height !== undefined ? { height: plan.height } : {}),
      ...(plan.radius !== undefined ? { radius: plan.radius } : {}),
      material: plan.material,
      sourceX: plan.source.x,
      sourceY: plan.source.y,
      stagingX: plan.staging.x,
      stagingY: plan.staging.y,
      stagingAngle: plan.staging.angle,
      finalX: plan.final.x,
      finalY: plan.final.y,
      finalAngle: plan.final.angle,
      operations: [...plan.operations],
      operationIndex: 0,
      stress: 0,
    });
  }

  private placeInventoryItem(
    team: "king" | "queen",
    itemId: string,
    x: number,
    y: number,
    angle: number,
  ): ActionResolution {
    const supply = this.supply[team];
    if (itemId === "timber") {
      if (supply.timber <= 0) return { accepted: false, reason: "No timber remains" };
      supply.timber -= 1;
      if (team === "king") {
        if (!this.entities.has("machine_skid")) {
          this.createMachinePart(
            "machine_skid",
            "beam",
            395,
            48,
            250,
            18,
            0,
            team,
          );
          return { accepted: true, entityId: "machine_skid" };
        } else if (!this.entities.has("machine_mast")) {
          this.createMachinePart(
            "machine_mast",
            "beam",
            480,
            280,
            20,
            500,
            0.02,
            team,
          );
          return { accepted: true, entityId: "machine_mast" };
        } else {
          this.createMachinePart(
            "machine_brace",
            "beam",
            425,
            270,
            18,
            440,
            -0.25,
            team,
          );
          return { accepted: true, entityId: "machine_brace" };
        }
      } else {
        const entityId = `queen_barricade_${this.machineSequence++}`;
        this.createMachinePart(
          entityId,
          "beam",
          x,
          y,
          150,
          18,
          angle,
          team,
        );
        return { accepted: true, entityId };
      }
    }
    if (itemId === "ladder") {
      if (supply.ladders <= 0) return { accepted: false, reason: "No ladder remains" };
      supply.ladders -= 1;
      const entityId =
        team === "king" ? "machine_ladder" : `machine_ladder_${team}`;
      this.createMachinePart(
        entityId,
        "ladder",
        x,
        y,
        52,
        510,
        angle,
        team,
      );
      return { accepted: true, entityId };
    }
    if (itemId === "capstan") {
      if (supply.capstans <= 0) {
        return { accepted: false, reason: "No capstan remains" };
      }
      supply.capstans -= 1;
      const entityId =
        team === "king" ? "machine_winch" : `machine_winch_${team}`;
      this.createMachinePart(
        entityId,
        "winch",
        x,
        y,
        76,
        76,
        angle,
        team,
        38,
      );
      return { accepted: true, entityId };
    }
    if (itemId === "pulley_block") {
      if (supply.pulleys <= 0) {
        return { accepted: false, reason: "No pulley block remains" };
      }
      supply.pulleys -= 1;
      const entityId =
        team === "king" ? "machine_pulley" : `machine_pulley_${team}`;
      this.createMachinePart(
        entityId,
        "pulley",
        x,
        y,
        56,
        56,
        angle,
        team,
        28,
      );
      return { accepted: true, entityId };
    }
    return { accepted: false, reason: "Unknown inventory item" };
  }

  private createMachinePart(
    id: string,
    machinePart: MachinePart,
    x: number,
    y: number,
    width: number,
    height: number,
    angle: number,
    team: "king" | "queen",
    radius?: number,
  ): void {
    if (this.entities.has(id)) return;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(x, y)
        .setRotation(angle),
    );
    this.addEntity({
      id,
      kind: "machine",
      machinePart,
      team,
      body,
      width,
      height,
      ...(radius !== undefined ? { radius } : {}),
      buildProgress: 0,
      buildDuration:
        id === "machine_skid"
          ? 45
          : id === "machine_mast"
            ? 60
            : id === "machine_brace"
              ? 55
              : machinePart === "ladder"
                ? 55
                : machinePart === "winch"
                  ? 60
                  : machinePart === "pulley"
                    ? 35
                    : 32,
      buildStage: "layout",
      material:
        machinePart === "beam"
          ? "ash timber, oak wedges, wrought-iron dogs"
          : machinePart === "ladder"
            ? "ash rails, oak rungs, rawhide lashings"
            : machinePart === "winch"
              ? "oak drum, iron pawl, ash capstan bars"
              : "oak cheeks, brass sheave, forged iron pin",
      placed: true,
      stress: 0,
    });
  }

  private createPlank(
    team: "king" | "queen",
    x: number,
    y: number,
    angle: number,
  ): void {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(
          Math.max(80, Math.min(WORLD_WIDTH - 80, x)),
          Math.max(GROUND_HEIGHT + 12, Math.min(WORLD_HEIGHT - 50, y)),
        )
        .setRotation(Math.max(-1.45, Math.min(1.45, angle)))
        .setLinearDamping(0.24)
        .setAngularDamping(0.3)
        .setCanSleep(true),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(70, 7)
        .setDensity(0.0012)
        .setFriction(1.25)
        .setRestitution(0)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(0),
      body,
    );
    this.addEntity({
      id: `plank_${team}_${this.plankSequence++}`,
      kind: "plank",
      team,
      body,
      collider,
      width: 140,
      height: 14,
      placed: true,
      stress: 0,
    });
  }

  private createRope(
    team: "king" | "queen",
    from: PhysicsEntity,
    to: PhysicsEntity,
    slackScale = 1.05,
  ): string | undefined {
    if (!from.body || !to.body) return undefined;
    if (
      from.kind === "block" ||
      from.kind === "humpty" ||
      to.kind === "block" ||
      to.kind === "humpty"
    ) {
      this.wakeTower();
    }
    const a = from.body.translation();
    const b = to.body.translation();
    const isMachineLine =
      from.kind === "machine" || to.kind === "machine";
    const length = Math.max(
      isMachineLine ? 18 : 70,
      Math.hypot(b.x - a.x, b.y - a.y) *
        (isMachineLine ? Math.min(slackScale, 1.025) : slackScale),
    );
    const joint =
      from.body.isFixed() && to.body.isFixed()
        ? undefined
        : this.world.createImpulseJoint(
            RAPIER.JointData.rope(
              length,
              { x: 0, y: 0 },
              { x: 0, y: 0 },
            ),
            from.body,
            to.body,
            true,
          );
    const id = `rope_${this.ropeSequence++}`;
    this.ropes.set(id, {
      id,
      kind: "rope",
      fromId: from.id,
      toId: to.id,
      ...(joint ? { joint } : {}),
      maxLength: length,
      team,
      stress: 0,
      createdAt: this.elapsed,
    });
    return id;
  }

  private setRopeMaximumLength(id: string, nextLength: number): void {
    const rope = this.ropes.get(id);
    const from = rope ? this.entities.get(rope.fromId) : undefined;
    const to = rope ? this.entities.get(rope.toId) : undefined;
    if (!rope || !from?.body || !to?.body) return;
    const length = Math.max(18, nextLength);
    if (Math.abs(rope.maxLength - length) < 0.15) return;
    if (rope.joint?.isValid()) {
      this.world.removeImpulseJoint(rope.joint, true);
    }
    rope.joint = this.world.createImpulseJoint(
      RAPIER.JointData.rope(
        length,
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ),
      from.body,
      to.body,
      true,
    );
    rope.maxLength = length;
  }

  private removeRopeEntity(id: string | null): void {
    if (!id) return;
    const rope = this.ropes.get(id);
    if (rope?.joint?.isValid()) {
      this.world.removeImpulseJoint(rope.joint, true);
    }
    this.ropes.delete(id);
  }

  private clearPuzzleRescueFixtureRopes(): void {
    this.removeRopeEntity(this.puzzleRescueLoadRopeId);
    this.removeRopeEntity(this.puzzleRescueDriveRopeId);
    this.puzzleRescueLoadRopeId = null;
    this.puzzleRescueDriveRopeId = null;
    this.puzzleRescueRopeStartLength = 0;
  }

  private stagePoint(entity?: PhysicsEntity): [number, number, number] {
    const position = entity?.body?.translation() ?? { x: 0, y: GROUND_HEIGHT };
    return [
      Math.round(position.x),
      Math.round((entity?.puzzleDepth ?? 0) * STAGE_DEPTH_SCALE),
      Math.round(Math.max(0, position.y - GROUND_HEIGHT)),
    ];
  }

  private setMovementDepth(
    entity: PhysicsEntity,
    depth: number | undefined,
  ): void {
    if (depth === undefined) delete entity.movementDepthTarget;
    else entity.movementDepthTarget = depth;
  }

  private stageSize(entity?: PhysicsEntity): [number, number, number] {
    const width = entity?.width ?? (entity?.radius ?? 12) * 2;
    const height = entity?.height ?? (entity?.radius ?? 12) * 2;
    const depth =
      entity?.kind === "man"
        ? 28
        : entity?.kind === "humpty"
          ? 72
          : Math.max(14, Math.min(70, Math.round((width + height) * 0.24)));
    return [Math.round(width), depth, Math.round(height)];
  }

  private stagePose(entity?: PhysicsEntity): StagePose {
    const angle = entity?.body?.rotation() ?? 0;
    return {
      p: this.stagePoint(entity),
      size: this.stageSize(entity),
      rot: [0, Math.round((angle * 180) / Math.PI), 0],
    };
  }

  private stageDistance(
    first?: PhysicsEntity,
    second?: PhysicsEntity,
  ): number {
    const a = this.stagePoint(first);
    const b = this.stagePoint(second);
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }

  private assemblyStagePose(partIds: string[]): StagePose {
    const parts = partIds
      .map((partId) => this.entities.get(partId))
      .filter((part): part is PhysicsEntity => !!part);
    if (parts.length === 0) return this.stagePose();
    const bounds = parts.map((part) => {
      const pose = this.stagePose(part);
      return {
        min: pose.p.map(
          (value, axis) => value - pose.size[axis as 0 | 1 | 2] / 2,
        ),
        max: pose.p.map(
          (value, axis) => value + pose.size[axis as 0 | 1 | 2] / 2,
        ),
      };
    });
    const min = [0, 1, 2].map((axis) =>
      Math.min(...bounds.map((bound) => bound.min[axis]!)),
    );
    const max = [0, 1, 2].map((axis) =>
      Math.max(...bounds.map((bound) => bound.max[axis]!)),
    );
    return {
      p: [0, 1, 2].map((axis) =>
        Math.round((min[axis]! + max[axis]!) / 2),
      ) as [number, number, number],
      size: [0, 1, 2].map((axis) =>
        Math.max(1, Math.round(max[axis]! - min[axis]!)),
      ) as [number, number, number],
      rot: this.stagePose(parts[0]).rot,
    };
  }

  private assemblyStructuralState(partIds: string[]) {
    const members = partIds
      .map((partId) => this.entities.get(partId))
      .filter(
        (part): part is PhysicsEntity & { body: RAPIER.RigidBody } => !!part?.body,
      );
    const totalMass = members.reduce((sum, member) => sum + member.body.mass(), 0);
    const centerOfMass: [number, number, number] = totalMass > 0
      ? [
          members.reduce(
            (sum, member) => sum + member.body.translation().x * member.body.mass(),
            0,
          ) / totalMass,
          members.reduce(
            (sum, member) => sum + (member.puzzleDepth ?? 0) * STAGE_DEPTH_SCALE * member.body.mass(),
            0,
          ) / totalMass,
          members.reduce(
            (sum, member) =>
              sum +
              Math.max(0, member.body.translation().y - GROUND_HEIGHT) *
                member.body.mass(),
            0,
          ) / totalMass,
        ]
      : [0, 0, 0];
    const grounded = members.filter((member) => {
      const halfHeight = member.radius ?? Math.max(4, (member.height ?? 8) / 2);
      return member.body.translation().y - halfHeight <= GROUND_HEIGHT + 5;
    });
    const supportLeft = grounded.length > 0
      ? Math.min(
          ...grounded.map(
            (member) => member.body.translation().x - (member.width ?? member.radius ?? 8) / 2,
          ),
        )
      : centerOfMass[0];
    const supportRight = grounded.length > 0
      ? Math.max(
          ...grounded.map(
            (member) => member.body.translation().x + (member.width ?? member.radius ?? 8) / 2,
          ),
        )
      : centerOfMass[0];
    const lowest = members.length > 0
      ? Math.min(
          ...members.map(
            (member) =>
              member.body.translation().y -
              (member.radius ?? Math.max(4, (member.height ?? 8) / 2)),
          ),
        )
      : GROUND_HEIGHT;
    const signedTippingMargin = grounded.length > 0
      ? Math.min(centerOfMass[0] - supportLeft, supportRight - centerOfMass[0])
      : -Math.max(0, lowest - GROUND_HEIGHT);
    const assemblyConnections = this.puzzleConnections.filter(
      (connection) =>
        partIds.includes(connection.firstId) && partIds.includes(connection.secondId),
    );
    const jointUtilization = Math.max(
      0,
      ...assemblyConnections.map((connection) => {
        const first = this.puzzleParts.get(connection.firstId)?.ports.find(
          (port) => port.id === connection.firstPort,
        );
        const second = this.puzzleParts.get(connection.secondId)?.ports.find(
          (port) => port.id === connection.secondPort,
        );
        const rule = first && second ? connectionRule(first, second) : undefined;
        return rule ? connection.currentLoad / Math.max(1, rule.breakForce) : 0;
      }),
    );
    const bindingRisk = Math.min(
      1,
      Math.max(
        ...members.map((member) => Math.abs(member.body.angvel()) / 5),
        ...assemblyConnections.map((connection) =>
          connection.state === "slipping" ? 0.7 : connection.state === "yielding" ? 1 : 0,
        ),
        0,
      ),
    );
    const bucklingRisk = Math.min(
      1,
      members.reduce((risk, member) => {
        const length = Math.max(member.width ?? 0, member.height ?? 0);
        const thickness = Math.max(1, Math.min(member.width ?? 1, member.height ?? 1));
        const vertical = Math.abs(Math.sin(member.body.rotation()));
        return Math.max(risk, vertical * Math.max(0, length / thickness - 5) / 20);
      }, 0) * Math.max(0.25, jointUtilization),
    );
    const ropeMembers = members.filter(
      (member) => member.puzzleDefinition?.componentType === "lashing",
    );
    const frayed = ropeMembers.some(
      (member) => (this.puzzleLedger.get(member.id)?.integrity ?? 1) < 0.65,
    );
    const ropeLoad = Math.max(
      0,
      ...assemblyConnections
        .filter((connection) => {
          const first = this.puzzleParts.get(connection.firstId)?.ports.find(
            (port) => port.id === connection.firstPort,
          );
          const second = this.puzzleParts.get(connection.secondId)?.ports.find(
            (port) => port.id === connection.secondPort,
          );
          return !!first && !!second && connectionRule(first, second)?.joint === "rope";
        })
        .map((connection) => connection.currentLoad),
    );
    const ropeState = ropeMembers.length === 0
      ? "none"
      : frayed
        ? "frayed"
        : jointUtilization >= 1
          ? "overloaded"
          : ropeLoad > 1
            ? "tensioned"
            : "slack";
    return {
      centerOfMass: centerOfMass.map((value) => Math.round(value)) as [number, number, number],
      supportSpan: [Math.round(supportLeft), Math.round(supportRight)] as [number, number],
      signedTippingMargin: Math.round(signedTippingMargin * 10) / 10,
      bindingRisk: Math.round(bindingRisk * 100) / 100,
      bucklingRisk: Math.round(bucklingRisk * 100) / 100,
      jointUtilization: Math.round(jointUtilization * 100) / 100,
      ropeState: ropeState as TeamAgentState["assemblies"][number]["ropeState"],
    };
  }

  private compactPuzzleAssemblies(team: WorkerTeam) {
    const seen = new Set<string>();
    const assemblies: Array<PuzzleAssemblySummary & {
      count: number;
      kinds: string[];
      freePorts: number;
      pose: StagePose;
      centerOfMass: [number, number, number];
      supportSpan: [number, number];
      signedTippingMargin: number;
      bindingRisk: number;
      bucklingRisk: number;
      jointUtilization: number;
      ropeState: TeamAgentState["assemblies"][number]["ropeState"];
    }> = [];
    for (const entity of this.entities.values()) {
      if (!entity.puzzleDefinition || entity.team !== team) continue;
      const partIds = this.assemblyPartIds(entity.id).sort();
      const key = partIds.join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      const summary = summarizeAssembly(
        partIds,
        this.puzzleParts,
        this.puzzleConnections,
      );
      const freePorts = partIds.reduce(
        (total, partId) =>
          total +
          (this.puzzleParts.get(partId)?.ports.filter(
            (port) => !this.occupiedPuzzlePort(partId, port.id),
          ).length ?? 0),
        0,
      );
      assemblies.push({
        ...summary,
        partIds,
        count: partIds.length,
        kinds: [
          ...new Set(
            partIds.flatMap((partId) => {
              const kind = this.puzzleParts.get(partId)?.componentType;
              return kind ? [kind] : [];
            }),
          ),
        ].sort(),
        freePorts,
        pose: this.assemblyStagePose(partIds),
        ...this.assemblyStructuralState(partIds),
      });
    }
    return assemblies;
  }

  private puzzleJoinOptionsFor(
    team: WorkerTeam,
  ): TeamAgentState["joinOptions"] {
    const parts = [...this.entities.values()].filter(
      (entity) =>
        entity.puzzleDefinition &&
        entity.team === team &&
        ![
          "recoverable",
          "damaged",
          "detached",
          "dropped",
          "being_fetched",
          "carried",
          "aligning",
          "reserved",
        ].includes(entity.puzzleLifecycle ?? "stored"),
    );
    const scored: Array<{
      option: TeamAgentState["joinOptions"][number];
      score: number;
      sourceIds: string[];
    }> = [];
    const workers = AGENTS.filter(
      (agent) =>
        agent.team === team &&
        agent.id !== team &&
        this.isAgentAlive(agent),
    )
      .map((agent) => this.entities.get(agent.id))
      .filter((worker): worker is PhysicsEntity => !!worker);
    for (let firstIndex = 0; firstIndex < parts.length; firstIndex += 1) {
      const first = parts[firstIndex];
      if (!first?.puzzleDefinition) continue;
      for (
        let secondIndex = firstIndex + 1;
        secondIndex < parts.length;
        secondIndex += 1
      ) {
        const second = parts[secondIndex];
        if (!second?.puzzleDefinition) continue;
        const firstAssembly = this.assemblyPartIds(first.id);
        const secondAssembly = this.assemblyPartIds(second.id);
        if (firstAssembly.some((partId) => secondAssembly.includes(partId))) {
          continue;
        }
        const combined = [...new Set([...firstAssembly, ...secondAssembly])];
        if (this.puzzlePartsLocked(combined) || combined.length > 12) continue;
        const ports = this.compatiblePuzzlePorts(first.id, second.id);
        if (!ports) continue;
        const firstPort = first.puzzleDefinition.ports.find(
          (port) => port.id === ports.firstPort,
        );
        const secondPort = second.puzzleDefinition.ports.find(
          (port) => port.id === ports.secondPort,
        );
        const result = summarizeAssembly(combined, this.puzzleParts, [
          ...this.puzzleConnections,
          {
            firstId: first.id,
            firstPort: ports.firstPort,
            secondId: second.id,
            secondPort: ports.secondPort,
          },
        ]);
        const firstSummary = this.puzzleAssembly(first.id)!;
        const secondSummary = this.puzzleAssembly(second.id)!;
        const previousCapabilities = new Set([
          ...firstSummary.capabilities,
          ...secondSummary.capabilities,
        ]);
        const gainedCapabilities = result.capabilities.filter(
          (capability) => !previousCapabilities.has(capability),
        );
        const firstFunction = this.puzzleFunctionProgress(team, firstSummary);
        const secondFunction = this.puzzleFunctionProgress(team, secondSummary);
        const resultFunction = this.puzzleFunctionProgress(team, result);
        const previouslyCompleted = new Set([
          ...firstFunction.completed,
          ...secondFunction.completed,
        ]);
        const completedFunctions = resultFunction.completed.filter(
          (functionId) => !previouslyCompleted.has(functionId),
        );
        const functionalGain = Math.max(
          0,
          resultFunction.score -
            Math.max(firstFunction.score, secondFunction.score),
        );
        if (
          functionalGain < 4 &&
          completedFunctions.length === 0 &&
          result.simpleMachines.length === 0
        ) {
          continue;
        }
        const moveSecondIntoFirst =
          first.puzzleDefinition.mass > second.puzzleDefinition.mass * 1.35 ||
          (first.puzzleDefinition.capabilities.includes("support") &&
            ["wedge", "lashing"].includes(second.puzzleDefinition.componentType));
        const movingEntity = moveSecondIntoFirst ? second : first;
        const targetEntity = moveSecondIntoFirst ? first : second;
        const movingPort = moveSecondIntoFirst ? secondPort : firstPort;
        const targetPort = moveSecondIntoFirst ? firstPort : secondPort;
        const travel = Math.round(
          Math.min(
            ...workers.map((worker) => this.stageDistance(worker, movingEntity)),
            WORLD_WIDTH,
          ) + this.stageDistance(movingEntity, targetEntity),
        );
        const worksite = this.assemblyStagePose(
          moveSecondIntoFirst ? firstAssembly : secondAssembly,
        ).p;
        const tieBreak =
          ([...first.id, ...second.id].reduce(
            (sum, character) => sum + character.charCodeAt(0),
            0,
          ) %
            31) /
          100;
        scored.push({
          option: {
            partId: movingEntity.id,
            targetId: targetEntity.id,
            connection: `${movingPort?.kind ?? "port"}>${targetPort?.kind ?? "port"}`,
            gainedCapabilities,
            completedFunctions,
            // Keep internal classifiers out of the agent prompt. Agents receive
            // only neutral affordances and observed capabilities.
            resultSimpleMachines: [],
            resultCapabilities: result.capabilities,
            resultStability: result.stability,
            resultMass: Math.round(result.mass),
            travel,
            worksite,
          },
          score:
            functionalGain * 2.4 +
            completedFunctions.length * 52 +
            gainedCapabilities.length * 12 +
            result.simpleMachines.length * 20 +
            result.stability * 18 +
            result.failureMargin * 8 +
            Math.min(48, combined.length * 8) -
            Math.min(18, travel / 60) +
            tieBreak,
          sourceIds: combined,
        });
      }
    }
    scored.sort((first, second) => second.score - first.score);
    const appearances = new Map<string, number>();
    const functionAppearances = new Map<string, number>();
    const selected: TeamAgentState["joinOptions"] = [];
    const leadingAssemblies = new Set<string>();
    for (const entry of scored) {
      if (entry.sourceIds.some((partId) => leadingAssemblies.has(partId))) {
        continue;
      }
      if (
        entry.option.completedFunctions.some(
          (functionId) => (functionAppearances.get(functionId) ?? 0) >= 1,
        )
      ) {
        continue;
      }
      selected.push(entry.option);
      entry.sourceIds.forEach((partId) => leadingAssemblies.add(partId));
      appearances.set(
        entry.option.partId,
        (appearances.get(entry.option.partId) ?? 0) + 1,
      );
      appearances.set(
        entry.option.targetId,
        (appearances.get(entry.option.targetId) ?? 0) + 1,
      );
      for (const functionId of entry.option.completedFunctions) {
        functionAppearances.set(
          functionId,
          (functionAppearances.get(functionId) ?? 0) + 1,
        );
      }
      if (selected.length >= 6) break;
    }
    for (const entry of scored) {
      if (selected.some((option) => option === entry.option)) continue;
      const partUses = appearances.get(entry.option.partId) ?? 0;
      const targetUses = appearances.get(entry.option.targetId) ?? 0;
      if (partUses >= 3 || targetUses >= 3) continue;
      if (
        entry.option.completedFunctions.some(
          (functionId) => (functionAppearances.get(functionId) ?? 0) >= 2,
        )
      ) {
        continue;
      }
      selected.push(entry.option);
      appearances.set(entry.option.partId, partUses + 1);
      appearances.set(entry.option.targetId, targetUses + 1);
      for (const functionId of entry.option.completedFunctions) {
        functionAppearances.set(
          functionId,
          (functionAppearances.get(functionId) ?? 0) + 1,
        );
      }
      if (selected.length >= 12) break;
    }
    return selected;
  }

  private teamStateFor(team: WorkerTeam): TeamAgentState {
    const remaining = Math.max(0, GAME_SECONDS - this.elapsed);
    const height = Math.round(this.humptyHeight());
    const humpty = this.entities.get("humpty");
    const workers = AGENTS.filter(
      (agent) =>
        agent.team === team &&
        agent.id !== team &&
        this.isAgentAlive(agent),
    );
    const enemies = AGENTS.filter(
      (agent) =>
        agent.team !== team &&
        agent.team !== "humpty" &&
        agent.id !== "king" &&
        agent.id !== "queen" &&
        this.isAgentAlive(agent),
    );
    const activityFor = (entity?: PhysicsEntity): string =>
      entity && (entity.activityUntil ?? 0) > this.elapsed
        ? entity.activity ?? "idle"
        : "idle";
    const teamAssemblies = this.compactPuzzleAssemblies(team);
    const enemyTeam: WorkerTeam = team === "king" ? "queen" : "king";
    const enemyAssemblies = this.compactPuzzleAssemblies(enemyTeam);
    const workerDistanceTo = (point: [number, number, number]): number =>
      Math.round(
        Math.min(
          ...workers.map((worker) => {
            const entity = this.entities.get(worker.id);
            const position = this.stagePoint(entity);
            return entity
              ? Math.hypot(
                  position[0] - point[0],
                  position[1] - point[1],
                  position[2] - point[2],
                )
              : WORLD_WIDTH;
          }),
          WORLD_WIDTH,
        ),
      );
    const useOptions: TeamAgentState["useOptions"] = [];
    const queenProjectileAvailable =
      team !== "queen" ||
      [...this.entities.values()].some(
        (entity) =>
          entity.team === "queen" &&
          entity.puzzleDefinition &&
          ["wheel", "wedge"].includes(entity.puzzleDefinition.componentType) &&
          this.assemblyPartIds(entity.id).length === 1 &&
          ["stored", "stored_or_reused", "staged"].includes(
            entity.puzzleLifecycle ?? "stored",
          ) &&
          entity.body &&
          !entity.expiresAt,
      );
    for (const assembly of teamAssemblies.filter((entry) => entry.count > 1)) {
      if (
        this.elapsed <
        (this.puzzleAssemblyCooldownUntil.get(assembly.id) ?? 0)
      ) {
        continue;
      }
      const capabilitySet = new Set(assembly.capabilities);
      const readyForHumpty = this.assemblyReadyForHumpty(team, assembly);
      if (
        readyForHumpty &&
        queenProjectileAvailable &&
        this.elapsed >= BUILD_BEAT_AT
      ) {
        const commissioning = this.commissioningFor(team, assembly);
        const stage = this.commissioningOperation(team, commissioning.step);
        if (commissioning.step < 3 || this.matchBeat() === "decisive") {
        useOptions.push({
          partId: assembly.id,
          targetId: "humpty",
          operation: stage.operation,
          instruction: stage.instruction,
          capabilities: assembly.capabilities,
          distance: workerDistanceTo(assembly.pose.p),
          from: assembly.pose.p,
          to: this.stagePoint(humpty),
        });
        }
      }
      const nearestEnemy = enemies
        .map((enemy) => {
          const position = this.stagePoint(this.entities.get(enemy.id));
          return {
            id: enemy.id,
            position,
            distance: Math.hypot(
              position[0] - assembly.pose.p[0],
              position[1] - assembly.pose.p[1],
              position[2] - assembly.pose.p[2],
            ),
          };
        })
        .sort((first, second) => first.distance - second.distance)[0];
      if (
        nearestEnemy &&
        ["contest", "decisive"].includes(this.matchBeat()) &&
        (assembly.mass >= 35 ||
          capabilitySet.has("multiply_force") ||
          capabilitySet.has("store_energy"))
      ) {
        useOptions.push({
          partId: assembly.id,
          targetId: nearestEnemy.id,
          operation: "execute",
          instruction: "Use this assembly against the selected opponent.",
          capabilities: assembly.capabilities,
          distance: workerDistanceTo(assembly.pose.p),
          from: assembly.pose.p,
          to: nearestEnemy.position,
        });
      }
    }
    const detachOptions = !["contest", "decisive"].includes(this.matchBeat())
      ? []
      : this.puzzleConnections
      .flatMap((connection) => {
        if (connection.state === "failed") return [];
        const candidates = [connection.firstId, connection.secondId]
          .map((partId) => {
            const part = this.entities.get(partId);
            if (part?.team !== enemyTeam || !part.body) return undefined;
            const position = this.stagePoint(part);
            return {
              connectionId: connection.id,
              partId,
              connectedTo:
                partId === connection.firstId
                  ? connection.secondId
                  : connection.firstId,
              currentLoad: Math.round(connection.currentLoad),
              state: connection.state,
              distance: workerDistanceTo(position),
              at: position,
            };
          })
          .filter(
            (
              option,
            ): option is TeamAgentState["detachOptions"][number] => !!option,
          );
        return candidates
          .sort((first, second) => first.distance - second.distance)
          .slice(0, 1);
      })
      .sort((first, second) => first.distance - second.distance)
      .slice(0, 12);
    const repairOptions = this.puzzleConnections
      .filter((connection) => connection.state === "failed")
      .flatMap((connection) => {
        const part = this.entities.get(connection.firstId);
        const mate = this.entities.get(connection.secondId);
        if (!part?.body || !mate?.body || part.team !== team || mate.team !== team) return [];
        const position = this.stagePoint(part);
        return [{
          connectionId: connection.id,
          partId: part.id,
          connectedTo: mate.id,
          integrity: connection.integrity,
          distance: workerDistanceTo(position),
          at: position,
        }];
      })
      .sort((first, second) => first.distance - second.distance)
      .slice(0, 8);
    return {
      space: {
        units: "stage_units",
        axes: "x left-right, y back-front, z height above floor",
        bounds: {
          x: [0, WORLD_WIDTH],
          y: [STAGE_DEPTH_MIN, STAGE_DEPTH_MAX],
          z: [0, WORLD_HEIGHT - GROUND_HEIGHT],
        },
        landmarks: [
          {
            id: "king_inventory",
            kind: "inventory",
            p: [88, 0, 0],
            size: [176, 650, 0],
            rot: [0, 0, 0],
          },
          {
            id: "king_work_zone",
            kind: "work_zone",
            p: [250, 0, 0],
            size: [210, 650, 0],
            rot: [0, 0, 0],
          },
          {
            id: "tower",
            kind: "structure",
            p: [TOWER_X, 0, Math.round((TOWER_TOP - GROUND_HEIGHT) / 2)],
            size: [190, 120, TOWER_TOP - GROUND_HEIGHT],
            rot: [0, 0, 0],
          },
          {
            id: "landing_zone",
            kind: "landing_zone",
            p: [TOWER_X, 150, 0],
            size: [230, 220, 0],
            rot: [0, 0, 0],
          },
          {
            id: "queen_work_zone",
            kind: "work_zone",
            p: [950, 0, 0],
            size: [210, 650, 0],
            rot: [0, 0, 0],
          },
          {
            id: "queen_inventory",
            kind: "inventory",
            p: [1112, 0, 0],
            size: [176, 650, 0],
            rot: [0, 0, 0],
          },
        ],
      },
      time: {
        elapsed: Math.round(this.elapsed),
        remaining: Math.round(remaining),
        urgency:
          remaining > 360 ? "build" : remaining > 120 ? "press" : "desperate",
        beat: this.matchBeat(),
        beatRule: this.beatRule(),
      },
      objective:
        team === "king"
          ? "Bring the Egg King intact and upright to the floor."
          : "Crack Humpty before an intact landing.",
      humpty: {
        pose: this.stagePose(humpty),
        height,
        integrity: Math.round(humpty?.integrity ?? 0),
        status: this.cracked
          ? "cracked"
          : height <= 55
            ? "floor"
            : this.rescueStarted
              ? "descending"
              : "perched",
      },
      tower: this.towerObservation(),
      crew: workers.map((worker) => {
        const entity = this.entities.get(worker.id);
        const task = this.puzzleTasks.get(worker.id);
        return {
          id: worker.id,
          pose: this.stagePose(entity),
          integrity: Math.round(entity?.integrity ?? 0),
          activity: activityFor(entity),
          ...(entity?.equippedWeapon
            ? { weapon: entity.equippedWeapon }
            : {}),
          ...(task
            ? {
                task: {
                  phase: task.phase,
                  partId: task.partId,
                  targetId: task.targetId,
                  progress:
                    Math.round((entity?.taskProgress ?? task.progress) * 100) /
                    100,
                },
              }
            : {}),
        };
      }),
      opponents: enemies.map((enemy) => {
        const entity = this.entities.get(enemy.id);
        return {
          id: enemy.id,
          pose: this.stagePose(entity),
          integrity: Math.round(entity?.integrity ?? 0),
          activity: activityFor(entity),
          ...(entity?.equippedWeapon
            ? { weapon: entity.equippedWeapon }
            : {}),
        };
      }),
      publicSpeech: this.speech.slice(-6).map((line) => ({
        name: line.name,
        text: line.text,
      })),
      stock: teamAssemblies
        .filter((assembly) => assembly.count === 1)
        .flatMap((assembly) => {
          const part = this.puzzleParts.get(assembly.id);
          if (!part) return [];
          return [
            {
              id: part.id,
              kind: part.componentType,
              mass: part.mass,
              capabilities: part.capabilities,
              freePorts: part.ports
                .filter(
                  (port) => !this.occupiedPuzzlePort(part.id, port.id),
                )
                .map((port) => port.kind),
              pose: assembly.pose,
              lifecycle: this.entities.get(part.id)?.puzzleLifecycle ?? "stored",
            },
          ];
        }),
      assemblies: teamAssemblies
        .filter((assembly) => assembly.count > 1)
        .map(({ partIds: _partIds, mass: _mass, simpleMachines: _simpleMachines, ...assembly }) => ({
          ...assembly,
          derivedCapabilities: assembly.derivedCapabilities.map((capability) => ({
            id: capability.id,
            confidence: capability.confidence,
            ratio: capability.ratio,
            inputPortId: capability.inputPortId,
            outputPortId: capability.outputPortId,
            failureMargin: capability.failureMargin,
          })),
        })),
      opponentAssemblies: enemyAssemblies
        .filter((assembly) => assembly.count > 1)
        .map((assembly) => ({
          id: assembly.id,
          count: assembly.count,
          capabilities: assembly.capabilities,
          stability: assembly.stability,
          pose: assembly.pose,
        })),
      joinOptions: this.puzzleJoinOptionsFor(team),
      useOptions,
      detachOptions,
      repairOptions,
    };
  }

  private workStatusFor(team: WorkerTeam): TeamWorkStatus {
    const capabilityWeights: PuzzleAssemblySummary["capabilities"] =
      team === "king"
        ? [
            "interface_load",
            "grip",
            "tension_link",
            "hold_load",
            "redirect_force",
            "lower_load",
          ]
        : [
            "support",
            "pivot_support",
            "multiply_force",
            "interface_load",
            "aim",
            "launch_projectile",
          ];
    const selected = this.compactPuzzleAssemblies(team)
      .map((assembly) => ({
        assembly,
        score:
          assembly.count * 2 +
          capabilityWeights.filter((capability) =>
            assembly.capabilities.includes(capability),
          ).length *
            9,
      }))
      .sort((first, second) => second.score - first.score)[0]?.assembly;
    const targetCount = team === "king" ? 7 : 4;
    const activeWorkers = [...this.entities.values()].filter(
      (entity) =>
        entity.kind === "man" &&
        entity.team === team &&
        entity.alive !== false &&
        (entity.activityUntil ?? 0) > this.elapsed &&
        entity.activity !== "idle",
    ).length;
    const ready = selected
      ? this.assemblyReadyForHumpty(team, selected)
      : false;
    const commissioning =
      ready && selected ? this.commissioningFor(team, selected) : undefined;
    const step = commissioning?.step ?? 0;
    const stageLabels =
      team === "king"
        ? [
            "awaiting proof",
            "frame proofed",
            "sling balanced",
            "hoist commissioned",
          ]
        : [
            "awaiting proof",
            "pivot proofed",
            "stone seated",
            "thrower commissioned",
          ];
    const joined = selected?.count ?? 0;
    const progress = Math.min(
      1,
      Math.min(1, joined / targetCount) * 0.58 + (step / 3) * 0.42,
    );
    return {
      label: team === "king" ? "Rescue works" : "Attack works",
      detail: ready
        ? stageLabels[step] ?? stageLabels.at(-1)!
        : `${joined}/${targetCount} parts joined; ${activeWorkers} ${
            activeWorkers === 1 ? "worker" : "workers"
          } active`,
      progress: Math.round(progress * 100) / 100,
    };
  }

  private fallbackSubmissionFor(
    agent: AgentDefinition,
    reservations = new Set<string>(),
  ): AgentSubmission {
    if (agent.team === "humpty") return { action: { type: "wait" } };
    const team = agent.team;
    const state = this.teamStateFor(team);
    const decisiveUse = state.useOptions.find(
      (option) =>
        !reservations.has(option.partId) &&
        option.targetId === "humpty" &&
        (team === "queen" || !this.rescueStarted),
    );
    if (decisiveUse) {
      reservations.add(decisiveUse.partId);
      const lines =
        team === "king"
          ? {
              proof: "Testing the rescue frame under load.",
              fit: "Balancing the padded sling around Humpty.",
              tension: "Taking tension; checking the holding brake.",
              execute: "Beginning the controlled descent now.",
            }
          : {
              proof: "Proofing the pivot and throwing arm.",
              fit: "Seating one stone in the sling.",
              tension: "Setting the arm; taking measured aim.",
              execute: "Driving the throwing stroke now.",
            };
      return {
        say: lines[decisiveUse.operation],
        action: {
          type: "use_assembly",
          partId: decisiveUse.partId,
          targetId: decisiveUse.targetId,
          effort: team === "king" ? 0.68 : 0.94,
        },
      };
    }
    const role = Math.max(0, Number(agent.id.at(-1) ?? 1) - 1);
    const roleGoals: string[][] =
      team === "king"
        ? [
            ["interface_load", "tension_link", "redirect_force"],
            ["wind_line", "bearing_support", "hold_load"],
            ["anchor", "lower_load", "lift_load"],
          ]
        : [
            ["lever_member", "pivot_support", "multiply_force"],
            ["interface_load", "tension_link", "launch_projectile"],
            ["support", "aim", "transport"],
          ];
    const roleFunctions: string[][] =
      team === "king"
        ? [
            ["load_cradle", "tensioned_sling"],
            ["winding_core", "supported_winder"],
            ["force_redirector", "controlled_lowering"],
          ]
        : [
            ["supported_lever", "aimed_thrower"],
            ["payload_sling", "aimed_thrower"],
            ["anchored_pivot", "aimed_thrower"],
          ];
    const desired = roleGoals[role] ?? roleGoals[0]!;
    const desiredFunctions = roleFunctions[role] ?? roleFunctions[0]!;
    const recoverable = state.stock.find(
      (part) =>
        !reservations.has(part.id) &&
        ["recoverable", "damaged", "detached", "dropped"].includes(
          part.lifecycle,
        ),
    );
    if (recoverable) {
      reservations.add(recoverable.id);
      return {
        say: "Returning this loose part to the rack.",
        action: { type: "recover", partId: recoverable.id },
      };
    }
    const availableJoins = state.joinOptions.filter(
      (option) =>
        !reservations.has(option.partId) &&
        !reservations.has(option.targetId),
    );
    const join = availableJoins
      .map((option) => ({
        option,
        score:
          desiredFunctions.filter((functionId) =>
            option.completedFunctions.includes(functionId),
          ).length *
            180 +
          option.completedFunctions.length * 46 +
          desired.filter((capability) =>
            option.gainedCapabilities.includes(capability),
          ).length *
            58 +
          desired.filter((capability) =>
            option.resultCapabilities.includes(capability),
          ).length *
            12 +
          option.resultSimpleMachines.length * 24 +
          Math.max(
            0,
            this.assemblyPartIds(option.targetId).length - 1,
          ) * 95 +
          option.resultStability * 18 -
          option.travel / 90,
      }))
      .sort((first, second) => second.score - first.score)[0]?.option;
    if (join) {
      reservations.add(join.partId);
      reservations.add(join.targetId);
      const completedFunction = join.completedFunctions.find((functionId) =>
        desiredFunctions.includes(functionId),
      );
      return {
        say: completedFunction
          ? `Completing ${completedFunction.replaceAll("_", " ")}.`
          : role === 0
            ? `Joining ${join.connection} fittings.`
            : role === 1
              ? "Carrying this functional subassembly."
              : "Aligning the next load-path connection.",
        action: {
          type: "snap",
          partId: join.partId,
          targetId: join.targetId,
        },
      };
    }
    const repair = state.repairOptions.find(
      (option) => !reservations.has(option.partId),
    );
    if (repair) {
      reservations.add(repair.partId);
      if (repair.distance <= 175) {
        return {
          say: "Repairing the failed joint now.",
          action: { type: "repair", connectionId: repair.connectionId },
        };
      }
      return {
        say: "Moving to the failed joint.",
        action: { type: "move", x: repair.at[0], y: repair.at[1] },
      };
    }
    const detach = state.detachOptions.find(
      (option) => !reservations.has(option.partId),
    );
    if (detach) {
      reservations.add(detach.partId);
      if (detach.distance <= 175) {
        return {
          say: "Pulling their exposed joint apart.",
          action: {
            type: "sabotage",
            connectionId: detach.connectionId,
            method: "pull",
          },
        };
      }
      const target = this.entities.get(detach.partId)?.body?.translation();
      if (target) {
        return {
          say: "Closing on their exposed joint.",
          action: { type: "move", x: detach.at[0], y: detach.at[1] },
        };
      }
    }
    if (!["contest", "decisive"].includes(this.matchBeat())) {
      return { action: { type: "wait" } };
    }
    const ownPoint = this.stagePoint(this.entities.get(agent.id));
    const opponent = state.opponents
      .map((entry) => ({
        ...entry,
        distance: Math.hypot(
          entry.pose.p[0] - ownPoint[0],
          entry.pose.p[1] - ownPoint[1],
        ),
      }))
      .sort((first, second) => first.distance - second.distance)[0];
    if (opponent) {
      if (opponent.distance <= 260) {
        return {
          say: "Engaging the nearest opponent.",
          action: {
            type: "push",
            targetId: opponent.id,
            dir: team === "king" ? 1 : -1,
          },
        };
      }
      return {
        say: "Advancing to contest their work.",
        action: {
          type: "move",
          x: opponent.pose.p[0],
          y: opponent.pose.p[1],
        },
      };
    }
    const stock = state.stock[role % Math.max(1, state.stock.length)];
    return stock
      ? {
          say: "Repositioning beside usable stock.",
          action: { type: "move", x: stock.pose.p[0], y: stock.pose.p[1] },
        }
      : { action: { type: "wait" } };
  }

  private stateFor(agent: AgentDefinition): AgentState {
    const selfEntity = this.entities.get(agent.id === "humpty" ? "humpty" : agent.id);
    const selfPosition = selfEntity?.body?.translation() ?? { x: 0, y: 0 };
    const teamSupply =
      agent.team === "humpty"
        ? {
            planks: 0,
            ropes: 0,
            stones: 0,
            pikes: 0,
            crossbows: 0,
            bolts: 0,
          }
        : { ...this.supply[agent.team] };
    const inventory =
      agent.team === "humpty" ? [] : this.inventoryFor(this.supply[agent.team]);
    const nearby = [...this.entities.values()]
      .filter((entity) => entity.body && entity.id !== selfEntity?.id && entity.kind !== "limb")
      .map((entity) => {
        const position = entity.body?.translation() ?? { x: 0, y: 0 };
        const distance = Math.hypot(position.x - selfPosition.x, position.y - selfPosition.y);
        return {
          id: entity.id,
          kind: entity.kind as EntityKind,
          x: Math.round(position.x),
          y: Math.round(position.y),
          distance: Math.round(distance),
          ...(entity.integrity !== undefined
            ? { integrity: Math.round(entity.integrity) }
            : {}),
          ...(entity.buildProgress !== undefined
            ? { buildProgress: Math.round(entity.buildProgress * 100) / 100 }
            : {}),
          ...(entity.componentType
            ? { componentType: entity.componentType }
            : {}),
          ...(entity.assemblyState
            ? { assemblyState: entity.assemblyState }
            : {}),
        };
      })
      .filter((entity) => entity.distance <= 250)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 18);
    const fellows = AGENTS.filter(
      (other) =>
        other.id !== agent.id &&
        other.id !== "king" &&
        other.id !== "queen" &&
        other.team !== "humpty",
    ).map((other) => {
      const entity = this.entities.get(other.id);
      const position = entity?.body?.translation() ?? { x: 0, y: 0 };
      return {
        id: other.id,
        team: other.team,
        x: Math.round(position.x),
        y: Math.round(position.y),
        integrity: Math.round(entity?.integrity ?? 0),
      };
    });

    const currentTaskComponent = selfEntity?.taskTargetId
      ? this.entities.get(selfEntity.taskTargetId)
      : undefined;
    const currentTaskProject = selfEntity?.constructionTargetId
      ? this.projects.get(selfEntity.constructionTargetId)
      : undefined;
    const assemblyStatesForTeam = (team: "king" | "queen") => {
      const seen = new Set<string>();
      const assemblies = [];
      for (const entity of this.entities.values()) {
        if (!entity.puzzleDefinition || entity.team !== team) continue;
        const partIds = this.assemblyPartIds(entity.id);
        const key = [...partIds].sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        const summary = summarizeAssembly(
          partIds,
          this.puzzleParts,
          this.puzzleConnections,
        );
        const occupied = partIds.reduce(
          (total, partId) =>
            total +
            (this.puzzleParts.get(partId)?.ports.filter((port) =>
              this.occupiedPuzzlePort(partId, port.id),
            ).length ?? 0),
          0,
        );
        const portCount = partIds.reduce(
          (total, partId) =>
            total + (this.puzzleParts.get(partId)?.ports.length ?? 0),
          0,
        );
        assemblies.push({
          id: summary.id,
          partIds: summary.partIds,
          capabilities: summary.capabilities,
          mass: summary.mass,
          stability: summary.stability,
          freePorts: Math.max(0, portCount - occupied),
          supportMargin: summary.supportMargin,
          failureMargin: summary.failureMargin,
          warnings: summary.warnings,
        });
      }
      return assemblies;
    };
    const puzzleParts =
      agent.team === "humpty"
        ? []
        : [...this.entities.values()]
            .filter(
              (entity) =>
                entity.puzzleDefinition && entity.team === agent.team,
            )
            .map((entity) => {
              const definition = entity.puzzleDefinition!;
              const position = entity.body?.translation() ?? { x: 0, y: 0 };
              const connectedTo = this.puzzleConnections.flatMap(
                (connection) =>
                  connection.state === "failed"
                    ? []
                    : connection.firstId === entity.id
                    ? [connection.secondId]
                    : connection.secondId === entity.id
                      ? [connection.firstId]
                      : [],
              );
              return {
                id: entity.id,
                label: definition.label,
                componentType: definition.componentType,
                material: definition.material,
                mass: definition.mass,
                x: Math.round(position.x),
                y: Math.round(position.y),
                ports: definition.ports.map((port) => {
                  const connection = this.puzzleConnections.find(
                    (candidate) =>
                      (candidate.firstId === entity.id &&
                        candidate.firstPort === port.id) ||
                      (candidate.secondId === entity.id &&
                        candidate.secondPort === port.id),
                  );
                  const occupiedBy = connection
                    ? connection.firstId === entity.id
                      ? connection.secondId
                      : connection.firstId
                    : undefined;
                  const pose = puzzlePortPose(definition, port.id);
                  return {
                    id: port.id,
                    kind: port.kind,
                    accepts: port.accepts,
                    ...pose,
                    ...(occupiedBy ? { occupiedBy } : {}),
                  };
                }),
                affordances: definition.affordances,
                constraints: definition.constraints,
                capabilities: definition.capabilities,
                connectedTo,
                lifecycleState: entity.puzzleLifecycle ?? "stored",
                integrity: this.puzzleLedger.get(entity.id)?.integrity ?? 1,
              };
            });
    const ownAssemblies =
      agent.team === "humpty" ? [] : assemblyStatesForTeam(agent.team);
    const opponentAssemblies =
      agent.team === "humpty"
        ? []
        : assemblyStatesForTeam(agent.team === "king" ? "queen" : "king");

    return {
      turn: this.turn,
      elapsed: Math.round(this.elapsed * 10) / 10,
      goals:
        agent.id === "humpty"
          ? [
              "Remain intact.",
              "Reach stable ground without uncontrolled falling.",
              "Use speech and small weight shifts to influence events.",
            ]
          : agent.id === "king"
            ? [
                "Deliver Humpty intact to stable ground.",
                "Give general instructions without performing physical work.",
                "Respond to public reports and the Queen's audible orders.",
              ]
            : agent.id === "queen"
            ? [
                "Have Humpty cracked before a safe landing.",
                "Direct the Queen's men from the fortress wall gallery.",
                "Demand comfort, food, and reports during the operation.",
              ]
            : agent.team === "king"
              ? [
                  "Deliver Humpty intact to stable ground.",
                  "Build and operate physically complete machinery.",
                  "Protect workers when conflict threatens the sequence.",
                ]
              : [
                  "Prevent an intact landing.",
                  "Build physical artillery before attempting the strongest shot.",
                  "Disrupt consequential work and protect useful equipment.",
                  "Fight only when it advances the mission.",
                ],
      self: {
        id: agent.id,
        x: Math.round(selfPosition.x),
        y: Math.round(selfPosition.y),
        integrity: Math.round(selfEntity?.integrity ?? 0),
        ...(selfEntity?.equippedWeapon
          ? { weapon: selfEntity.equippedWeapon }
          : {}),
      },
      humpty: {
        x: Math.round(this.entities.get("humpty")?.body?.translation().x ?? 0),
        y: Math.round(this.entities.get("humpty")?.body?.translation().y ?? 0),
        height: Math.round(this.humptyHeight()),
        integrity: Math.round(this.entities.get("humpty")?.integrity ?? 0),
        cracked: this.cracked,
      },
      teammates: fellows
        .filter((entry) => entry.team === agent.team)
        .map(({ team: _team, ...entry }) => entry),
      opponents: fellows
        .filter((entry) => entry.team !== agent.team)
        .map(({ team: _team, ...entry }) => entry),
      nearby,
      projects: [...this.projects.values()].map((project) => {
        const machine = this.entities.get(project.plan.machineId);
        return {
          id: project.plan.machineId,
          blueprintId: project.plan.id,
          workerId: project.workerId,
          team: project.plan.team,
          progress: Math.round((machine?.buildProgress ?? 0) * 100) / 100,
          stage: machine?.buildStage ?? project.phase,
          complete: project.phase === "complete",
          mechanisms: project.plan.mechanisms.map((stage) => ({
            id: stage.id,
            label: stage.label,
            primitive: stage.primitive,
            capability: stage.capability,
            input: stage.input,
            output: stage.output,
            dependsOn: stage.dependsOn,
            commissioning: stage.commissioning,
            mechanicalAdvantage: stage.mechanicalAdvantage,
            efficiency: stage.efficiency,
            ready: project.commissionedStageIds.has(stage.id),
          })),
        };
      }),
      ...(selfEntity?.taskOperation && selfEntity.taskTargetId
        ? {
            currentTask: {
              projectId: selfEntity.constructionTargetId ?? "",
              componentId: selfEntity.taskTargetId,
              componentLabel:
                currentTaskComponent?.componentLabel ??
                currentTaskProject?.plan.label ??
                "mechanism",
              ...(currentTaskComponent?.componentType
                ? {
                    componentType: currentTaskComponent.componentType,
                  }
                : {}),
              operation: selfEntity.taskOperation,
              progress: Math.round((selfEntity.taskProgress ?? 0) * 100) / 100,
            },
          }
        : {}),
      connections: [...this.ropes.values()].map(
        (rope) => `${rope.fromId}>${rope.toId}`,
      ),
      supply: teamSupply,
      inventory,
      ...(agent.team !== "humpty"
        ? {
            parts: puzzleParts,
            assemblies: ownAssemblies,
            opponentAssemblies,
          }
        : {}),
      speech: this.speech.slice(-10).map((line) => ({
        turn: line.turn,
        name: line.name,
        text: line.text,
      })),
    };
  }

  private inventoryFor(supply: Supply): InventoryItem[] {
    return [
      {
        id: "timber",
        name: "Squared timber",
        material: "ash wood with iron dogs",
        quantity: supply.timber,
        affordances: [
          "Rigid under compression and bending.",
          "Flat faces accept lashings, wedges, and fasteners.",
        ],
        constraints: [
          "Unsupported length sags under concentrated load.",
          "Ends slide unless braced or dogged.",
        ],
      },
      {
        id: "rail_and_rung_stock",
        name: "Rail and rung stock",
        material: "riven ash rails and split oak blanks",
        quantity: supply.ladders,
        affordances: [
          "Straight rails carry compression along their grain.",
          "Short blanks can become rungs after sizing and boring.",
        ],
        constraints: [
          "Unjoined pieces provide no climbable path.",
          "Cross-grain holes split when bored too near an end.",
        ],
      },
      {
        id: "rope",
        name: "Hemp rope coil",
        material: "three-strand hemp",
        quantity: supply.ropes,
        affordances: [
          "Carries tension along its length.",
          "Knotted ends accept eyes, drums, and anchor points.",
        ],
        constraints: [
          "Carries no compression.",
          "Abrasion and sharp bends reduce strength.",
        ],
      },
      {
        id: "sheave_stock",
        name: "Sheave and cheek stock",
        material: "oak cheek blanks, iron pin, brass sheave",
        quantity: supply.pulleys,
        affordances: [
          "A grooved sheave redirects a moving tension line.",
          "Cheek blanks can contain a sheave after boring.",
        ],
        constraints: [
          "Loose parts cannot redirect load before assembly.",
          "A slack line can leave the sheave.",
        ],
      },
      {
        id: "axle_and_drum_stock",
        name: "Axle and drum stock",
        material: "oak drum blank, iron axle and pawl, ash bars",
        quantity: supply.capstans,
        affordances: [
          "An axle permits rotation when held by aligned bearings.",
          "Bars multiply hand force when seated around a drum.",
        ],
        constraints: [
          "Loose stock provides no mechanical advantage.",
          "Misaligned bearings bind under rotation.",
        ],
      },
      {
        id: "canvas_sling",
        name: "Canvas lifting sling",
        material: "double canvas with leather eyes",
        quantity: supply.slings,
        affordances: [
          "Flexible cloth conforms around a broad curved load.",
          "Reinforced eyes accept rope or hooks.",
        ],
        constraints: [
          "The sling must pass beneath the load.",
          "Uneven eye tension tilts the load.",
        ],
      },
      {
        id: "wedge",
        name: "Timber wedge",
        material: "seasoned oak",
        quantity: supply.wedges,
        affordances: [
          "Taper converts driven motion into separating force.",
          "Rough faces resist reverse sliding under compression.",
        ],
        constraints: [
          "Loose wedges carry no tension.",
          "Overdriving can split soft timber.",
        ],
      },
      {
        id: "wheel_and_axle_stock",
        name: "Wheel and axle stock",
        material: "oak hubs and spokes, iron tyres and axles",
        quantity: supply.wheelSets,
        affordances: [
          "Rolling contact reduces resistance beneath supported mass.",
          "A large wheel turns a smaller axle through one bearing.",
        ],
        constraints: [
          "Misaligned bearings bind and scrub under load.",
          "An unchocked wheel rolls on sloping ground.",
        ],
      },
      {
        id: "lever_and_fulcrum_stock",
        name: "Lever and fulcrum stock",
        material: "straight ash arm, oak fulcrum, forged pivot",
        quantity: supply.leverSets,
        affordances: [
          "An offset pivot trades travel distance for applied force.",
          "A projecting arm carries bending and can redirect motion.",
        ],
        constraints: [
          "The fulcrum must bear against a stable base.",
          "Excess bending splits grain near holes and sharp notches.",
        ],
      },
      {
        id: "wooden_screw_stock",
        name: "Wooden screw stock",
        material: "hornbeam spindle and nut, tallow, iron saddle",
        quantity: supply.screwSets,
        affordances: [
          "Helical threads convert rotation into slow linear travel.",
          "Cross handles multiply turning force around the spindle.",
        ],
        constraints: [
          "Dry or crossed threads bind under compression.",
          "A narrow saddle concentrates load on its contact point.",
        ],
      },
      {
        id: "spring_and_catch_stock",
        name: "Spring and catch stock",
        material: "waxed sinew bundle, horn plates, iron catch",
        quantity: supply.springSets,
        affordances: [
          "Twisted elastic fibers store energy while held.",
          "A catch retains a loaded member until released.",
        ],
        constraints: [
          "Stored energy releases rapidly after the catch opens.",
          "Uneven winding twists the frame and changes the path.",
        ],
      },
      {
        id: "pike",
        name: "Ash pike",
        material: "long ash shaft, socketed iron head, iron butt cap",
        quantity: supply.pikes,
        affordances: [
          "A rigid shaft keeps its point beyond arm's reach.",
          "The butt and shaft carry forward pressure into both hands.",
        ],
        constraints: [
          "The long shaft turns slowly among nearby bodies.",
          "The point acts only along a controlled line.",
        ],
      },
      {
        id: "crossbow",
        name: "Spanned crossbow",
        material: "ash tiller, horn-and-sinew prod, hemp string, iron nut",
        quantity: supply.crossbows,
        affordances: [
          "A bent prod stores elastic energy behind a short bolt.",
          "The tiller and nut retain aim until the trigger releases.",
        ],
        constraints: [
          "Spanning and reloading occupy both hands and time.",
          "The string drives only a bolt seated on the tiller.",
        ],
      },
      {
        id: "crossbow_bolt",
        name: "Iron-tipped crossbow bolt",
        material: "two ash shafts with forged points and feather vanes",
        quantity: supply.bolts,
        affordances: [
          "A rigid shaft carries point-first momentum when aligned.",
          "Feather vanes resist tumbling during flight.",
        ],
        constraints: [
          "Each release consumes one stocked bolt.",
          "A released bolt cannot be recalled.",
        ],
      },
      {
        id: "ramp_stock",
        name: "Ramp and cleat stock",
        material: "rough oak planks, cross cleats, ground wedges",
        quantity: supply.planks,
        affordances: [
          "An inclined surface trades vertical force for travel distance.",
          "Cleats and rough faces resist sliding along the slope.",
        ],
        constraints: [
          "A steep angle increases rollback and side tipping.",
          "Unsupported planks bend between their bearing points.",
        ],
      },
      {
        id: "ratchet_and_pawl_stock",
        name: "Ratchet and pawl stock",
        material: "toothed iron wheel, tempered pawl, horn spring",
        quantity: supply.capstans + supply.springSets,
        affordances: [
          "Asymmetric teeth permit stepped rotation in one direction.",
          "An engaged pawl holds shaft torque between input strokes.",
        ],
        constraints: [
          "A shallow pawl skips when teeth or axle are misaligned.",
          "The pawl must be deliberately lifted before reverse motion.",
        ],
      },
      {
        id: "bearing_stock",
        name: "Bearing and bushing stock",
        material: "forged pins, bronze sleeves, tallow and leather seals",
        quantity: supply.wheelSets + supply.capstans,
        affordances: [
          "Aligned sleeves constrain a shaft while permitting rotation.",
          "Lubrication reduces heat and input lost to friction.",
        ],
        constraints: [
          "Offset bearing centers make a shaft bind under load.",
          "An unsupported shaft bends and changes the output path.",
        ],
      },
      {
        id: "link_and_guide_stock",
        name: "Link, pin, and guide stock",
        material: "ash links, iron pins, oak guide cheeks",
        quantity: supply.leverSets + supply.screwSets,
        affordances: [
          "Pinned links transmit motion while allowing one rotation.",
          "Parallel cheeks constrain a moving member to a repeatable path.",
        ],
        constraints: [
          "An extra free joint can make a frame collapse as a mechanism.",
          "A tight guide increases friction and may seize when loaded.",
        ],
      },
      {
        id: "stone",
        name: "Dressed stone",
        material: "dense limestone",
        quantity: supply.stones,
        affordances: [
          "Mass carries momentum and supplies ballast.",
          "Flat faces stack against stops.",
        ],
        constraints: [
          "Impact is uncontrolled after release.",
          "A moving stone cannot be recalled.",
        ],
      },
    ];
  }

  private announce(
    turn: number,
    agentId: string,
    name: string,
    team: Team,
    text: string,
    delayMs = 0,
  ): void {
    const conciseText = text.trim().split(/\s+/).slice(0, 10).join(" ");
    const normalizedText = conciseText.toLowerCase().replace(/[^\w\s]/g, "");
    if (
      this.speech.some(
        (line) =>
          line.agentId === agentId &&
          line.text.toLowerCase().replace(/[^\w\s]/g, "") === normalizedText,
      )
    ) {
      return;
    }
    this.speech.push({
      turn,
      agentId,
      name,
      team,
      text: conciseText.slice(0, 80),
      at: Date.now() + Math.max(0, delayMs),
      elapsed: this.elapsed + Math.max(0, delayMs) / 1000,
    });
    if (this.speech.length > MAX_SPEECH) this.speech.shift();
  }

  private emitSound(
    type: SoundCueType,
    team: Team | undefined,
    intensity: number,
    x: number,
    details: Pick<SoundCue, "weapon" | "targetId"> = {},
  ): void {
    this.soundCues.push({
      id: this.soundSequence++,
      type,
      ...(team ? { team } : {}),
      ...details,
      intensity: Math.max(0.05, Math.min(1, intensity)),
      x: Math.max(0, Math.min(WORLD_WIDTH, x)),
      at: Date.now(),
    });
    if (this.soundCues.length > MAX_SOUND_CUES) this.soundCues.shift();
  }

  private integrityMap(): Map<string, number> {
    return new Map(
      [...this.entities.values()]
        .filter((entity) => entity.integrity !== undefined)
        .map((entity) => [entity.id, entity.integrity ?? 0]),
    );
  }

  private integrityDeltas(
    before: Map<string, number>,
    after: Map<string, number>,
  ): IntegrityDelta[] {
    const deltas: IntegrityDelta[] = [];
    for (const [id, value] of after) {
      const previous = before.get(id);
      if (previous !== undefined && Math.abs(previous - value) > 0.01) {
        deltas.push({
          id,
          before: Math.round(previous * 10) / 10,
          after: Math.round(value * 10) / 10,
        });
      }
    }
    return deltas;
  }

  private writeLedger(record: object): void {
    appendFileSync(this.ledgerPath, `${JSON.stringify(record)}\n`);
  }

  private replayMetadata(current: boolean): ReplayManifestEntry {
    return {
      runId: this.runId,
      seed: this.seed,
      model: this.driver.model,
      elapsed: Math.round(this.elapsed * 100) / 100,
      winner: this.winner,
      outcome: this.outcome,
      frameCount: this.replayFrames.length,
      current,
    };
  }

  private captureReplayFrame(force = false): void {
    if (!this.runId || (!force && this.elapsed < this.nextReplayCaptureAt)) {
      return;
    }
    const frame = this.snapshot();
    const previous = this.replayFrames.at(-1);
    if (
      !force &&
      previous &&
      Math.abs(previous.elapsed - frame.elapsed) < 0.01 &&
      previous.phase === frame.phase
    ) {
      return;
    }
    this.replayFrames.push(frame);
    this.nextReplayCaptureAt = this.elapsed + REPLAY_FRAME_SECONDS;
  }

  private archiveReplay(): void {
    if (!this.runId || this.replayArchived || this.replayFrames.length === 0) {
      return;
    }
    const previous = this.replayFrames.at(-1);
    if (
      !previous ||
      Math.abs(previous.elapsed - this.elapsed) > 0.01 ||
      previous.phase !== this.phase
    ) {
      this.captureReplayFrame(true);
    }
    const directory = join(this.root, "replays");
    mkdirSync(directory, { recursive: true });
    const bundle: ReplayBundle = {
      version: 1,
      ...this.replayMetadata(false),
      frames: this.replayFrames,
    };
    writeFileSync(
      join(directory, `${this.runId}.json.gz`),
      gzipSync(JSON.stringify(bundle), { level: 6 }),
    );
    writeFileSync(
      join(directory, `${this.runId}.meta.json`),
      JSON.stringify(this.replayMetadata(false)),
    );
    this.replayArchived = true;
  }

  replayManifest(): ReplayManifestEntry[] {
    const directory = join(this.root, "replays");
    const archived = existsSync(directory)
      ? readdirSync(directory)
          .filter((filename) => filename.endsWith(".meta.json"))
          .flatMap((filename) => {
            try {
              return [
                JSON.parse(
                  readFileSync(join(directory, filename), "utf8"),
                ) as ReplayManifestEntry,
              ];
            } catch {
              return [];
            }
          })
      : [];
    return [
      this.replayMetadata(true),
      ...archived.filter((entry) => entry.runId !== this.runId),
    ].sort((first, second) => second.runId.localeCompare(first.runId));
  }

  replayBundle(runId: string): ReplayBundle | undefined {
    if (runId === this.runId) {
      return {
        version: 1,
        ...this.replayMetadata(true),
        frames: this.replayFrames,
      };
    }
    if (!/^[0-9TZ-]+$/.test(runId)) return undefined;
    const path = join(this.root, "replays", `${runId}.json.gz`);
    if (!existsSync(path)) return undefined;
    try {
      return JSON.parse(
        gunzipSync(readFileSync(path)).toString("utf8"),
      ) as ReplayBundle;
    } catch {
      return undefined;
    }
  }

  private writeOutcome(): void {
    if (this.outcomeWritten || !this.winner) return;
    this.outcomeWritten = true;
    const finalIntegrity = this.integrityMap();
    this.writeLedger({
      type: "outcome",
      at: new Date().toISOString(),
      turn: this.turn,
      winner: this.winner,
      outcome: this.outcome,
      humptyHeight: Math.round(this.humptyHeight() * 10) / 10,
      integrityChanges: this.integrityDeltas(
        this.lastTurnIntegrity,
        finalIntegrity,
      ),
      finalIntegrity: Object.fromEntries(finalIntegrity),
    });
    this.captureReplayFrame(true);
    this.archiveReplay();
  }

  private humptyHeight(): number {
    return Math.max(
      0,
      (this.entities.get("humpty")?.body?.translation().y ?? 0) - GROUND_HEIGHT,
    );
  }

  handleCommand(command: ClientCommand): void {
    if (command.type !== "command") return;
    if (command.command === "pause") {
      this.manualPaused = true;
      this.phase = "paused";
      this.phaseEndsAt = null;
      return;
    }
    if (command.command === "resume") {
      this.manualPaused = false;
      this.phase =
        this.driver.model === "mock" && this.deliberating
          ? "deliberating"
          : "running";
      this.phaseEndsAt =
        this.driver.model === "mock"
          ? this.deliberating
            ? this.phaseEndsAt
            : Date.now() +
              Math.max(0, TURN_SECONDS - (this.elapsed - this.lastTurnAt)) *
                1000
          : null;
      return;
    }
    if (command.command === "poke") {
      this.poke(command.targetId);
      return;
    }
    if (command.command === "restart") {
      this.createRun(Math.floor(Date.now() % 2_147_483_647));
    }
  }

  private poke(targetId?: string): void {
    const target =
      (targetId && this.entities.get(targetId)?.kind === "block"
        ? this.entities.get(targetId)
        : undefined) ??
      this.entities.get(`block_${Math.floor(this.rng.range(0, 5))}`);
    if (!target?.body) return;
    this.wakeTower();
    const position = target.body.translation();
    const direction = position.x < TOWER_X ? 1 : -1;
    target.body.applyImpulseAtPoint(
      { x: direction * 2200, y: 32 },
      { x: position.x, y: position.y + 18 },
      true,
    );
    target.stress = 1;
    if (this.elapsed - this.lastPokeAnnouncementAt > 1.5) {
      this.lastPokeAnnouncementAt = this.elapsed;
      this.announce(
        this.turn,
        "broadside",
        "The Audience",
        "humpty",
        "A gloved finger enters the scene.",
      );
    }
  }

  private wakeTower(): void {
    this.towerDisturbed = true;
    for (const entity of this.entities.values()) {
      if (entity.kind === "block" || entity.kind === "humpty") {
        entity.body?.wakeUp();
      }
    }
  }

  private towerObservation(): TeamAgentState["tower"] {
    const blocks = [...this.entities.values()].filter(
      (entity) => /^block_\d+$/.test(entity.id) && entity.body,
    );
    const support = this.entities.get("humpty_seat")?.body;
    const totalMass = blocks.reduce(
      (sum, block) => sum + (block.body?.mass() ?? 0),
      0,
    );
    const centerX = totalMass > 0
      ? blocks.reduce(
          (sum, block) =>
            sum + (block.body?.translation().x ?? TOWER_X) * (block.body?.mass() ?? 0),
          0,
        ) / totalMass
      : TOWER_X;
    const centerZ = totalMass > 0
      ? blocks.reduce(
          (sum, block) =>
            sum +
            Math.max(0, (block.body?.translation().y ?? GROUND_HEIGHT) - GROUND_HEIGHT) *
              (block.body?.mass() ?? 0),
          0,
        ) / totalMass
      : 0;
    const bottom = blocks
      .slice()
      .sort(
        (first, second) =>
          (first.body?.translation().y ?? Infinity) -
          (second.body?.translation().y ?? Infinity),
      )
      .slice(0, TOWER_BLOCKS_PER_LAYER);
    const supportLeft = Math.min(
      ...bottom.map(
        (block) => (block.body?.translation().x ?? TOWER_X) - TOWER_BLOCK_WIDTH / 2,
      ),
    );
    const supportRight = Math.max(
      ...bottom.map(
        (block) => (block.body?.translation().x ?? TOWER_X) + TOWER_BLOCK_WIDTH / 2,
      ),
    );
    const signedSupportMargin = Math.min(
      centerX - supportLeft,
      supportRight - centerX,
    );
    const maximumTilt = Math.max(
      0,
      ...blocks.map((block) => Math.abs(block.body?.rotation() ?? 0)),
      Math.abs(support?.rotation() ?? 0),
    );
    const topDisplacement = support
      ? Math.hypot(
          support.translation().x - TOWER_X,
          support.translation().y -
            (TOWER_BASE_Y + TOWER_LAYERS * TOWER_BLOCK_HEIGHT + TOWER_SEAT_HEIGHT / 2),
        )
      : 0;
    const warnings: string[] = [];
    if (signedSupportMargin < TOWER_BLOCK_WIDTH * 0.45) {
      warnings.push("center of mass is close to the support edge");
    }
    if (maximumTilt > 0.08) warnings.push("tower courses are rotating");
    if (topDisplacement > 10) warnings.push("top support has shifted");
    return {
      blockCount: 36,
      disturbed: this.towerDisturbed,
      centerOfMass: [Math.round(centerX), 0, Math.round(centerZ)],
      supportBounds: [Math.round(supportLeft), Math.round(supportRight)],
      signedSupportMargin: Math.round(signedSupportMargin * 10) / 10,
      maximumTilt: Math.round(maximumTilt * 1000) / 1000,
      topDisplacement: Math.round(topDisplacement * 10) / 10,
      warnings,
    };
  }

  private snapPreviews(): PuzzleSnapPreview[] {
    return [...this.puzzleTasks.values()].flatMap((task) => {
      const worker = this.entities.get(task.workerId);
      const moving = this.entities.get(task.partId);
      const target = this.entities.get(task.targetId);
      if (
        worker?.team !== "king" &&
        worker?.team !== "queen"
      ) {
        return [];
      }
      if (!moving?.puzzleDefinition || !target?.puzzleDefinition) return [];
      const current = this.puzzlePose(moving);
      const final =
        task.snapFinal?.find((pose) => pose.id === task.partId) ?? current;
      if (!final) return [];
      const movingPort = moving.puzzleDefinition.ports.find(
        (port) => port.id === task.firstPort,
      );
      const targetPort = target.puzzleDefinition.ports.find(
        (port) => port.id === task.secondPort,
      );
      return [
        {
          workerId: task.workerId,
          team: worker.team,
          movingId: moving.id,
          movingLabel: moving.puzzleDefinition.label,
          movingPort: task.firstPort,
          movingPortKind: movingPort?.kind ?? "port",
          targetId: target.id,
          targetLabel: target.puzzleDefinition.label,
          targetPort: task.secondPort,
          targetPortKind: targetPort?.kind ?? "port",
          phase: task.phase,
          progress: task.progress,
          targetX: final.x,
          targetY: final.y,
          targetAngle: final.angle,
          targetDepth: final.depth,
          gainedCapabilities: task.gainedCapabilities,
          resultCapabilities: task.resultCapabilities,
        },
      ];
    });
  }

  snapshot(): ServerSnapshot {
    const entities: TransformState[] = [];
    for (const entity of this.entities.values()) {
      if (!entity.body) continue;
      const position = entity.body.translation();
      const velocity = entity.body.linvel();
      entities.push({
        id: entity.id,
        kind: entity.kind,
        ...(entity.team ? { team: entity.team } : {}),
        ...(entity.ownerId ? { ownerId: entity.ownerId } : {}),
        ...(entity.part ? { part: entity.part } : {}),
        ...(entity.machinePart ? { machinePart: entity.machinePart } : {}),
        ...(entity.componentType ? { componentType: entity.componentType } : {}),
        ...(entity.projectId ? { projectId: entity.projectId } : {}),
        ...(entity.assemblyState ? { assemblyState: entity.assemblyState } : {}),
        ...(entity.connectionType
          ? { connectionType: entity.connectionType }
          : {}),
        x: position.x,
        y: position.y,
        angle: entity.body.rotation(),
        ...(entity.width !== undefined ? { width: entity.width } : {}),
        ...(entity.height !== undefined ? { height: entity.height } : {}),
        ...(entity.radius !== undefined ? { radius: entity.radius } : {}),
        ...(entity.buildProgress !== undefined
          ? { buildProgress: entity.buildProgress }
          : {}),
        ...(entity.buildStage ? { buildStage: entity.buildStage } : {}),
        ...(entity.material ? { material: entity.material } : {}),
        ...(entity.puzzleDepth !== undefined
          ? { puzzleDepth: entity.puzzleDepth }
          : {}),
        ...(entity.puzzleYaw !== undefined
          ? { puzzleYaw: entity.puzzleYaw }
          : {}),
        ...(entity.puzzleDefinition
          ? {
              puzzleKind: entity.puzzleDefinition.key,
              puzzleLabel: entity.puzzleDefinition.label,
              snapPorts: entity.puzzleDefinition.ports.map((port) => {
                const connection = this.puzzleConnections.find(
                  (candidate) =>
                    (candidate.firstId === entity.id &&
                      candidate.firstPort === port.id) ||
                    (candidate.secondId === entity.id &&
                      candidate.secondPort === port.id),
                );
                const occupiedBy = connection && connection.state !== "failed"
                  ? connection.firstId === entity.id
                    ? connection.secondId
                    : connection.firstId
                    : undefined;
                const pose = puzzlePortPose(entity.puzzleDefinition!, port.id);
                return {
                  id: port.id,
                  kind: port.kind,
                  accepts: port.accepts,
                  ...pose,
                  ...(occupiedBy ? { occupiedBy } : {}),
                  ...(connection
                    ? {
                        connectionId: connection.id,
                        connectionIntegrity: connection.integrity,
                        connectionLoad: Math.round(connection.currentLoad),
                        connectionState: connection.state,
                      }
                    : {}),
                };
              }),
              connectedTo: this.puzzleConnections.flatMap((connection) =>
                connection.state === "failed"
                  ? []
                  : connection.firstId === entity.id
                  ? [connection.secondId]
                  : connection.secondId === entity.id
                    ? [connection.firstId]
                    : [],
              ),
              capabilities: this.puzzleAssembly(entity.id)?.capabilities ?? [],
              mass: entity.puzzleDefinition.mass,
              lifecycleState: entity.puzzleLifecycle ?? "stored",
              ...(entity.reservedBy ? { reservedBy: entity.reservedBy } : {}),
            }
          : {}),
        ...(entity.taskOperation ? { taskOperation: entity.taskOperation } : {}),
        ...(entity.taskProgress !== undefined
          ? { taskProgress: entity.taskProgress }
          : {}),
        ...(entity.taskTargetId ? { taskTargetId: entity.taskTargetId } : {}),
        ...(entity.carryingId ? { carryingId: entity.carryingId } : {}),
        ...(entity.tool ? { tool: entity.tool } : {}),
        ...(entity.equippedWeapon ? { weapon: entity.equippedWeapon } : {}),
        ...(entity.integrity !== undefined ? { integrity: entity.integrity } : {}),
        ...(entity.alive !== undefined ? { alive: entity.alive } : {}),
        ...(entity.kind === "man"
          ? {
              activity:
                (entity.activityUntil ?? 0) > this.elapsed
                  ? entity.activity ?? "idle"
                  : "idle",
            }
          : {}),
        ...(entity.id === "humpty" && this.harnessFitted
          ? { harnessed: true }
          : {}),
        ...(entity.id === "humpty" && this.humptyRighting
          ? { righting: true }
          : {}),
        stress:
          entity.kind === "block"
            ? Math.max(
                entity.stress,
                (1 -
                  Number(entity.id.split("_")[1] ?? TOWER_BLOCKS - 1) /
                    (TOWER_BLOCKS - 1)) *
                  0.24,
              )
            : entity.kind === "component" && entity.projectId
              ? this.entities.get(entity.projectId)?.stress ?? entity.stress
              : entity.stress,
        vx: entity.commandedVelocity ?? velocity.x,
        vy: velocity.y,
      });
    }
    for (const rope of this.ropes.values()) {
      const from = this.entities.get(rope.fromId)?.body?.translation();
      const to = this.entities.get(rope.toId)?.body?.translation();
      if (!from || !to) continue;
      entities.push({
        id: rope.id,
        kind: "rope",
        team: rope.team,
        x: (from.x + to.x) / 2,
        y: (from.y + to.y) / 2,
        angle: Math.atan2(to.y - from.y, to.x - from.x),
        stress: rope.stress,
        fromX: from.x,
        fromY: from.y,
        toX: to.x,
        toY: to.y,
        progress: Math.max(
          0,
          Math.min(1, (this.elapsed - rope.createdAt) / 7),
        ),
      });
    }

    const publicAgents: PublicAgent[] = AGENTS.filter(
      (agent) => agent.id !== "king",
    ).map((agent) => {
      const entity = this.entities.get(agent.id);
      return {
        id: agent.id,
        name: agent.name,
        team: agent.team,
        alive: agent.team === "humpty" ? !this.cracked : entity?.alive === true,
        integrity: Math.max(0, entity?.integrity ?? 0),
      };
    });
    const aggregateStress =
      [...this.entities.values()]
        .filter((entity) => entity.kind === "block")
        .reduce((sum, entity) => {
          const index = Number(entity.id.split("_")[1] ?? TOWER_BLOCKS - 1);
          return (
            sum +
            Math.max(
              entity.stress,
              (1 - index / (TOWER_BLOCKS - 1)) * 0.24,
            )
          );
        }, 0) / TOWER_BLOCKS;

    const checksumInput = entities
      .map((entity) =>
        [
          entity.id,
          Math.round(entity.x),
          Math.round(entity.y),
          Math.round(entity.angle * 100),
          Math.round((entity.integrity ?? 0) * 10),
          entity.lifecycleState ?? "",
        ].join(":"),
      )
      .sort()
      .concat(
        this.puzzleConnections
          .map((connection) =>
            `${connection.id}:${connection.state}:${Math.round(connection.integrity * 1000)}:${Math.round(connection.currentLoad)}`,
          )
          .sort(),
      )
      .join("|");
    let checksum = 0x811c9dc5;
    for (let index = 0; index < checksumInput.length; index += 1) {
      checksum ^= checksumInput.charCodeAt(index);
      checksum = Math.imul(checksum, 0x01000193) >>> 0;
    }
    const physicsDiagnostics = this.physicsDiagnostics();

    return {
      type: "snapshot",
      seed: this.seed,
      turn: this.turn,
      phase:
        this.manualPaused || Date.now() < this.crackFreezeUntil
          ? "paused"
          : this.phase,
      phaseEndsAt: this.phaseEndsAt,
      elapsed: this.elapsed,
      entities,
      speech: this.speech.slice(-80),
      soundCues: this.soundCues.slice(-64),
      agents: publicAgents,
      humptyHeight: this.humptyHeight(),
      humptyIntegrity: this.entities.get("humpty")?.integrity ?? 0,
      deaths: {
        king: publicAgents.filter((agent) => agent.team === "king" && !agent.alive).length,
        queen: publicAgents.filter((agent) => agent.team === "queen" && !agent.alive).length,
      },
      aggregateStress,
      winner: this.winner,
      outcome: this.outcome,
      runId: this.runId,
      puzzleMode: this.puzzleParts.size > 0,
      matchBeat: this.matchBeat(),
      beatCopy: this.beatCopy(),
      workStatus: {
        king: this.workStatusFor("king"),
        queen: this.workStatusFor("queen"),
      },
      snapPreviews: this.snapPreviews(),
      snapEvents: this.puzzleSnapEvents.filter(
        (event) => this.elapsed - event.at <= 5,
      ),
      simulationTick: this.simulationTick,
      stateChecksum: checksum.toString(16).padStart(8, "0"),
      physicsDiagnostics,
    };
  }

  private physicsDiagnostics(): PhysicsDiagnosticsState {
    if (
      this.physicsDiagnosticsTick >= 0 &&
      this.simulationTick - this.physicsDiagnosticsTick < 15
    ) {
      return this.physicsDiagnosticsCache;
    }
    this.physicsDiagnosticsTick = this.simulationTick;
    const physical = [...this.entities.values()].filter(
      (entity): entity is PhysicsEntity & { body: RAPIER.RigidBody; collider: RAPIER.Collider } =>
        !!entity.body && !!entity.collider,
    );
    let dynamicBodyCount = 0;
    for (const entity of physical) {
      if (entity.body.isDynamic()) dynamicBodyCount += 1;
    }

    let deepBodyPenetrations = 0;
    let towerContactCount = 0;
    const towerKinds = new Set<EntityKind>(["block", "seat", "plinth"]);
    for (let firstIndex = 0; firstIndex < physical.length; firstIndex += 1) {
      const first = physical[firstIndex]!;
      for (let secondIndex = firstIndex + 1; secondIndex < physical.length; secondIndex += 1) {
        const second = physical[secondIndex]!;
        let deep = false;
        let touching = false;
        this.world.contactPair(first.collider, second.collider, (manifold) => {
          for (let contactIndex = 0; contactIndex < manifold.numContacts(); contactIndex += 1) {
            const separation = manifold.contactDist(contactIndex);
            deep ||= separation < -1.9;
            touching ||= separation <= 0.52;
          }
        });
        if (deep && first.kind !== "man" && second.kind !== "man") {
          deepBodyPenetrations += 1;
        }
        if (touching && towerKinds.has(first.kind) && towerKinds.has(second.kind)) {
          towerContactCount += 1;
        }
      }
    }

    let workerPenetration = 0;
    const workerPenetrationDetails: string[] = [];
    const workers = physical.filter((entity) => entity.kind === "man" && entity.alive);
    for (const worker of workers) {
      const exclusions = this.livingMovementExclusions(worker);
      const workerPosition = worker.body.translation();
      const workerHalf = this.entityHalfExtents(worker);
      const workerDepthHalf = this.floorDepthHalf(worker);
      if (
        workerPosition.x - workerHalf.x < 0 ||
        workerPosition.x + workerHalf.x > WORLD_WIDTH ||
        workerPosition.y - workerHalf.y < GROUND_HEIGHT - 1.04
      ) {
        workerPenetration += 1;
        workerPenetrationDetails.push(`${worker.id}:stage_boundary`);
      }
      for (const obstacle of physical) {
        if (
          exclusions.has(obstacle.id) ||
          obstacle.kind === "limb" ||
          !(
            obstacle.puzzleDefinition ||
            obstacle.kind === "block" ||
            obstacle.kind === "seat" ||
            obstacle.kind === "humpty" ||
            (obstacle.kind === "man" && obstacle.alive)
          )
        ) {
          continue;
        }
        if (obstacle.kind === "man" && obstacle.id < worker.id) continue;
        const obstaclePosition = obstacle.body.translation();
        const obstacleHalf = this.entityHalfExtents(obstacle);
        const xOverlap =
          Math.min(
            workerPosition.x + workerHalf.x,
            obstaclePosition.x + obstacleHalf.x,
          ) -
          Math.max(
            workerPosition.x - workerHalf.x,
            obstaclePosition.x - obstacleHalf.x,
          );
        const yOverlap =
          Math.min(
            workerPosition.y + workerHalf.y,
            obstaclePosition.y + obstacleHalf.y,
          ) -
          Math.max(
            workerPosition.y - workerHalf.y,
            obstaclePosition.y - obstacleHalf.y,
          );
        const depthOverlap =
          workerDepthHalf +
          this.floorDepthHalf(obstacle) -
          Math.abs((worker.puzzleDepth ?? 0) - (obstacle.puzzleDepth ?? 0));
        if (xOverlap > 1.04 && yOverlap > 1.04 && depthOverlap > 0.023) {
          workerPenetration += 1;
          workerPenetrationDetails.push(
            `${worker.id}:${obstacle.id}:x${xOverlap.toFixed(2)}:z${depthOverlap.toFixed(3)}`,
          );
        }
      }
    }

    const support = this.debugHumptySupport();
    const activeTask = [...this.puzzleTasks.values()].sort(
      (first, second) => second.phaseStartedAt - first.phaseStartedAt,
    )[0];
    let currentPartLifecycle = activeTask
      ? `${activeTask.partId}:${activeTask.phase}`
      : "opening_inventory";
    if (!activeTask) {
      let latestTick = -1;
      for (const ledger of this.puzzleLedger.values()) {
        const entry = ledger.actionHistory.at(-1);
        const tick = Number(entry?.split(":", 1)[0]);
        if (entry && Number.isFinite(tick) && tick >= latestTick) {
          latestTick = tick;
          currentPartLifecycle = `${ledger.partId}:${ledger.state}`;
        }
      }
    }
    const spawnedAfterStartInventory = [...this.puzzleParts.keys()].filter(
      (id) => !this.openingPuzzleIds.has(id),
    ).length;
    this.physicsDiagnosticsCache = {
      fixedTick: this.simulationTick,
      dynamicBodyCount,
      activeConstraintCount: this.puzzleConnections.filter(
        (connection) => connection.joint && connection.state !== "failed",
      ).length,
      workerPenetration,
      workerPenetrationDetails,
      deepBodyPenetrations,
      illegalTransformWrites: 0,
      spawnedAfterStartInventory,
      humptySupportContacts: support.humptySeatContacts,
      towerContactCount,
      currentPartLifecycle,
    };
    return this.physicsDiagnosticsCache;
  }

  getSeed(): number {
    return this.seed;
  }

  debugDropMan(agentId = "king_1", y = 900): void {
    const entity = this.entities.get(agentId);
    if (!entity?.body) return;
    const origin = entity.body.translation();
    const deltaY = y - origin.y;
    entity.body.setTranslation({ x: 360, y }, true);
    entity.body.setLinvel({ x: 0, y: -50 }, true);
    entity.body.wakeUp();
    for (const part of this.entities.values()) {
      if (part.ownerId !== agentId || !part.body) continue;
      const position = part.body.translation();
      part.body.setTranslation(
        {
          x: 360 + (position.x - origin.x),
          y: position.y + deltaY,
        },
        true,
      );
      part.body.setLinvel({ x: 0, y: -50 }, true);
      part.body.wakeUp();
    }
  }

  debugMoveMan(agentId: string, x: number, depth: number): void {
    const entity = this.entities.get(agentId);
    if (!entity?.body || entity.kind !== "man") return;
    entity.movementTarget = Math.max(42, Math.min(WORLD_WIDTH - 42, x));
    entity.movementDepthTarget = Math.max(
      FLOOR_DEPTH_MIN,
      Math.min(FLOOR_DEPTH_MAX, depth),
    );
    this.nextLocalInitiativeAt.set(agentId, this.elapsed + 30);
    this.debugControlledWorkers.add(agentId);
    this.clearLivingPath(entity);
  }

  debugPlaceMan(agentId: string, x: number, depth: number): void {
    const entity = this.entities.get(agentId);
    if (!entity?.body || entity.kind !== "man") return;
    entity.body.setTranslation({ x, y: entity.body.translation().y }, true);
    entity.body.setLinvel({ x: 0, y: 0 }, true);
    entity.puzzleDepth = depth;
    delete entity.movementTarget;
    delete entity.movementDepthTarget;
  }

  debugAssignCarryEnvelope(agentId: string, partId: string): void {
    const worker = this.entities.get(agentId);
    const part = this.entities.get(partId);
    if (
      !worker?.body ||
      worker.kind !== "man" ||
      !part?.body ||
      !part.puzzleDefinition
    ) {
      throw new Error("Carry envelope needs a worker and a puzzle part");
    }
    worker.carryingId = partId;
    this.clearLivingPath(worker);
  }

  debugSetElapsed(seconds: number): void {
    this.elapsed = Math.max(0, Math.min(GAME_SECONDS, seconds));
  }

  debugConnectPuzzleParts(
    firstId: string,
    firstPort: string,
    secondId: string,
    secondPort: string,
  ): string {
    const first = this.puzzleParts.get(firstId);
    const second = this.puzzleParts.get(secondId);
    const firstDefinition = first?.ports.find((port) => port.id === firstPort);
    const secondDefinition = second?.ports.find((port) => port.id === secondPort);
    if (!first || !second || !firstDefinition || !secondDefinition || !portsCompatible(firstDefinition, secondDefinition)) {
      throw new Error(`Invalid debug puzzle connection ${firstId}:${firstPort}>${secondId}:${secondPort}`);
    }
    this.alignPuzzlePortsForDebug(firstId, firstPort, secondId, secondPort);
    const id = `debug_snap_${this.puzzleConnections.length}`;
    const connection: PuzzleConnection = {
      id,
      firstId,
      firstPort,
      secondId,
      secondPort,
      integrity: 1,
      currentLoad: 0,
      state: "locked",
    };
    const joint = this.createPuzzleJoint(connection);
    if (joint) connection.joint = joint;
    this.puzzleConnections.push(connection);
    for (const partId of [firstId, secondId]) {
      const entity = this.entities.get(partId);
      if (entity) entity.assemblyState = "installed";
    }
    this.setPuzzleLifecycle([firstId, secondId], "connected", "test", "debug_connect");
    return id;
  }

  private alignPuzzlePortsForDebug(
    firstId: string,
    firstPort: string,
    secondId: string,
    secondPort: string,
  ): void {
    const task: PuzzleTask = {
      workerId: "debug",
      helperIds: [],
      partId: firstId,
      targetId: secondId,
      movingIds: this.assemblyPartIds(firstId),
      targetIds: this.assemblyPartIds(secondId),
      firstPort,
      secondPort,
      phase: "snap",
      progress: 1,
      startedAt: this.elapsed,
      phaseStartedAt: this.elapsed,
      buildX: 0,
      buildDepth: 0,
      gainedCapabilities: [],
      resultCapabilities: [],
    };
    this.preparePuzzleSnap(task);
    for (const pose of task.snapFinal ?? []) {
      const entity = this.entities.get(pose.id);
      if (!entity?.body) continue;
      entity.body.setTranslation({ x: pose.x, y: pose.y }, true);
      entity.body.setRotation(pose.angle, true);
      entity.body.setLinvel({ x: 0, y: 0 }, true);
      entity.body.setAngvel(0, true);
      entity.puzzleDepth = pose.depth;
    }
  }

  debugRealignPuzzleConnection(connectionId: string): void {
    const connection = this.puzzleConnections.find((item) => item.id === connectionId);
    if (!connection) throw new Error(`Unknown puzzle connection ${connectionId}`);
    this.alignPuzzlePortsForDebug(
      connection.firstId,
      connection.firstPort,
      connection.secondId,
      connection.secondPort,
    );
  }

  debugApplyAgentSubmission(agentId: string, submission: AgentSubmission): ActionResolution {
    const agent = AGENTS.find((candidate) => candidate.id === agentId);
    if (!agent) return { accepted: false, reason: "Unknown debug agent" };
    const validated = validateSubmission(submission);
    return validated.accepted
      ? this.applyAction(agent, validated.submission)
      : {
          accepted: false,
          ...(validated.reason ? { reason: validated.reason } : {}),
        };
  }

  debugPuzzleConnection(connectionId: string): PuzzleConnection | undefined {
    const connection = this.puzzleConnections.find((item) => item.id === connectionId);
    return connection ? { ...connection } : undefined;
  }

  debugPuzzleLifecycle(partId: string): PartLifecycleState | undefined {
    return this.puzzleLedger.get(partId)?.state;
  }

  debugPuzzleHistory(partId: string): string[] {
    return [...(this.puzzleLedger.get(partId)?.actionHistory ?? [])];
  }

  debugPuzzleConnectionCount(): number {
    return this.puzzleConnections.filter(
      (connection) => connection.state !== "failed" && connection.joint,
    ).length;
  }

  debugInterruptPuzzleTask(workerId: string): boolean {
    if (!this.puzzleTasks.has(workerId)) return false;
    this.finishPuzzleTask(workerId, false);
    return true;
  }

  private debugTranslatePuzzleAssembly(
    anchorId: string,
    x: number,
    y: number,
    depth: number,
  ): void {
    const anchor = this.entities.get(anchorId);
    const origin = anchor?.body?.translation();
    if (!anchor?.body || !origin) return;
    const deltaX = x - origin.x;
    const deltaY = y - origin.y;
    const deltaDepth = depth - (anchor.puzzleDepth ?? 0);
    for (const partId of this.assemblyPartIds(anchorId)) {
      const part = this.entities.get(partId);
      if (!part?.body) continue;
      const position = part.body.translation();
      part.body.setTranslation(
        { x: position.x + deltaX, y: position.y + deltaY },
        true,
      );
      part.body.setLinvel({ x: 0, y: 0 }, true);
      part.body.setAngvel(0, true);
      part.puzzleDepth = (part.puzzleDepth ?? 0) + deltaDepth;
    }
  }

  debugArrangeRescueFixture(): {
    assemblyId: string;
    partIds: string[];
    capabilities: string[];
  } {
    const hub = "kit_king_hub_01";
    const wallSheaveId = "kit_king_sheave_01";
    this.debugConnectPuzzleParts(
      "kit_king_beam_long_01",
      "right_tenon",
      hub,
      "socket_sw",
    );
    this.debugConnectPuzzleParts(
      "kit_king_beam_long_02",
      "left_tenon",
      hub,
      "socket_se",
    );
    this.debugConnectPuzzleParts(
      "kit_king_axle_short_01",
      "left_journal",
      hub,
      "axial_bore",
    );
    this.debugConnectPuzzleParts(
      "kit_king_drum_01",
      "keyed_bore",
      "kit_king_axle_short_01",
      "right_key",
    );
    this.debugConnectPuzzleParts(
      "kit_king_wedge_01",
      "rear_socket",
      "kit_king_beam_long_01",
      "left_tenon",
    );
    this.debugConnectPuzzleParts(
      "kit_king_wedge_02",
      "rear_socket",
      "kit_king_beam_long_02",
      "right_tenon",
    );
    this.debugTranslatePuzzleAssembly(hub, 530, 250, -0.8);
    this.debugStep(0.75);
    const wallSheave = this.entities.get(wallSheaveId);
    if (wallSheave?.body) {
      wallSheave.body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
      wallSheave.body.setTranslation({ x: TOWER_X, y: 650 }, true);
      wallSheave.body.setRotation(0, true);
      wallSheave.body.setLinvel({ x: 0, y: 0 }, true);
      wallSheave.body.setAngvel(0, true);
      wallSheave.puzzleDepth = 0.4;
      wallSheave.assemblyState = "installed";
    }
    const assembly = this.puzzleAssembly(hub)!;
    const fixturePartIds = [...assembly.partIds, wallSheaveId];
    this.setPuzzleLifecycle(
      fixturePartIds,
      "tested",
      "fixture",
      "fixture_rescue_ready",
    );
    return {
      assemblyId: hub,
      partIds: fixturePartIds,
      capabilities: [...assembly.capabilities],
    };
  }

  debugStartRescueFixture(assemblyId: string): void {
    const assembly = this.puzzleAssembly(assemblyId);
    const humpty = this.entities.get("humpty");
    if (!assembly || !humpty?.body) {
      throw new Error("Rescue fixture is incomplete");
    }
    this.clearPuzzleRescueFixtureRopes();
    this.puzzleRescueAssemblyId = assemblyId;
    this.puzzleRescueOperatorId = "king_1";
    this.puzzleRescueStartedAt = this.elapsed;
    this.puzzleRescueStartX = humpty.body.translation().x;
    this.puzzleRescueStartY = humpty.body.translation().y;
    this.puzzleRescueFixtureMode = true;
    this.harnessFitted = true;
    this.rescueStarted = true;
    this.rescueControlled = true;
    const wallSheave = this.entities.get("kit_king_sheave_01");
    const drum = this.entities.get("kit_king_drum_01");
    if (!wallSheave?.body || !drum?.body) {
      throw new Error("Rescue fixture has no complete rope path");
    }
    this.puzzleRescueLoadRopeId =
      this.createRope("king", wallSheave, humpty, 1) ?? null;
    this.puzzleRescueDriveRopeId =
      this.createRope("king", drum, wallSheave, 1.015) ?? null;
    this.puzzleRescueRopeStartLength = this.puzzleRescueLoadRopeId
      ? (this.ropes.get(this.puzzleRescueLoadRopeId)?.maxLength ?? 0)
      : 0;
    const guide = this.entities.get("king_2");
    if (guide) {
      guide.activity = "rig";
      guide.activityUntil = this.elapsed + 8;
      guide.movementTarget = 455;
      this.setMovementDepth(guide, -0.35);
    }
    this.setPuzzleLifecycle(assembly.partIds, "operating", "king_1", "fixture_hoist");
  }

  debugArrangeAttackFixture(): {
    assemblyId: string;
    ramId: string;
    blockId: string;
    partIds: string[];
  } {
    const beam = "kit_queen_beam_long_01";
    const hub = "kit_queen_hub_01";
    this.debugConnectPuzzleParts(beam, "right_tenon", hub, "socket_w");
    this.debugConnectPuzzleParts(
      "kit_queen_axle_short_01",
      "left_journal",
      hub,
      "axial_bore",
    );
    this.debugConnectPuzzleParts(
      "kit_queen_wheel_01",
      "keyed_bore",
      "kit_queen_axle_short_01",
      "left_key",
    );
    this.debugConnectPuzzleParts(
      "kit_queen_wheel_02",
      "keyed_bore",
      "kit_queen_axle_short_01",
      "right_key",
    );
    this.debugTranslatePuzzleAssembly(beam, 834, GROUND_HEIGHT + 20, 0);
    const nearWheel = this.entities.get("kit_queen_wheel_01");
    const farWheel = this.entities.get("kit_queen_wheel_02");
    if (nearWheel) nearWheel.puzzleDepth = -0.72;
    if (farWheel) farWheel.puzzleDepth = 0.72;
    this.debugStep(0.5);
    const ram = this.entities.get(beam);
    const block = this.entities.get("block_2");
    const beamEntity = this.entities.get(beam);
    if (ram?.body && block?.body && beamEntity?.body) {
      const ramLeft =
        ram.body.translation().x - this.entityHalfExtents(ram).x;
      const blockRight =
        block.body.translation().x + this.entityHalfExtents(block).x;
      const contactCorrection = blockRight + 0.75 - ramLeft;
      const beamPosition = beamEntity.body.translation();
      this.debugTranslatePuzzleAssembly(
        beam,
        beamPosition.x + contactCorrection,
        beamPosition.y,
        beamEntity.puzzleDepth ?? 0,
      );
    }
    const assembly = this.puzzleAssembly(beam)!;
    for (const partId of assembly.partIds) {
      this.entities
        .get(partId)
        ?.collider?.setCollisionGroups(
          ((PUZZLE_MEMBERSHIP << 16) | (0x0001 | TOWER_MEMBERSHIP)) >>> 0,
        );
    }
    this.setPuzzleLifecycle(assembly.partIds, "tested", "fixture", "fixture_ram_ready");
    return {
      assemblyId: beam,
      ramId: beam,
      blockId: "block_2",
      partIds: [...assembly.partIds],
    };
  }

  debugDriveAttackFixture(
    ramId: string,
    blockId: string,
    effort = 1,
  ): void {
    const ram = this.entities.get(ramId);
    const block = this.entities.get(blockId);
    if (!ram?.body || !block?.body) throw new Error("Attack fixture is incomplete");
    const ramPosition = ram.body.translation();
    const blockPosition = block.body.translation();
    const direction = Math.sign(blockPosition.x - ramPosition.x) || -1;
    const assembly = this.puzzleAssembly(ramId);
    const driveImpulse = Math.min(
      5200,
      (assembly?.mass ?? ram.body.mass()) *
        (14 + Math.max(0, Math.min(1, effort)) * 26),
    );
    const drivenBodies = (assembly?.partIds ?? [ramId])
      .map((id) => this.entities.get(id)?.body)
      .filter((body): body is RAPIER.RigidBody => !!body);
    const drivenMass = drivenBodies.reduce(
      (sum, body) => sum + body.mass(),
      0,
    );
    for (const body of drivenBodies) {
      body.applyImpulse(
        {
          x: direction * driveImpulse * (body.mass() / drivenMass),
          y: 0,
        },
        true,
      );
    }
    this.wakeTower();
    this.setPuzzleLifecycle(
      this.assemblyPartIds(ramId),
      "operating",
      "queen_1",
      "fixture_ram_drive",
    );
  }

  debugBodyIsDynamic(id: string): boolean {
    return this.entities.get(id)?.body?.isDynamic() === true;
  }

  debugTowerTopology(): {
    blocks: Array<{
      id: string;
      layer: number;
      slot: number;
      yaw: number;
      mass: number;
    }>;
    constraintCount: number;
  } {
    const blocks = [...this.entities.values()]
      .filter((entity) => /^block_\d+$/.test(entity.id) && entity.body)
      .map((entity) => {
        const index = Number(entity.id.slice("block_".length));
        return {
          id: entity.id,
          layer: Math.floor(index / TOWER_BLOCKS_PER_LAYER),
          slot: index % TOWER_BLOCKS_PER_LAYER,
          yaw: entity.puzzleYaw ?? 0,
          mass: entity.body!.mass(),
        };
      })
      .sort((first, second) => first.layer - second.layer || first.slot - second.slot);
    const handles = new Set(
      [...this.entities.values()]
        .filter((entity) => /^block_\d+$/.test(entity.id) && entity.body)
        .map((entity) => entity.body!.handle),
    );
    const constraintCount = this.joints.filter(
      (joint) =>
        joint.isValid() &&
        handles.has(joint.body1().handle) &&
        handles.has(joint.body2().handle),
    ).length;
    return { blocks, constraintCount };
  }

  debugHumptySupport(): {
    humptySeatContacts: number;
    seatTowerContacts: number;
    humptySeatSeparation: number;
    seatTowerSeparation: number;
    centerInsideSeat: boolean;
    humptyVerticalSpeed: number;
  } {
    const humpty = this.entities.get("humpty");
    const seat = this.entities.get("humpty_seat");
    const topBlocks = [33, 34, 35]
      .map((index) => this.entities.get(`block_${index}`))
      .filter((entity): entity is PhysicsEntity => !!entity?.collider && !!entity.body);
    const contactCount = (
      first: RAPIER.Collider | undefined,
      second: RAPIER.Collider | undefined,
    ): number => {
      if (!first || !second) return 0;
      let contacts = 0;
      this.world.contactPair(first, second, (manifold) => {
        contacts += manifold.numContacts();
      });
      return contacts;
    };
    const seatTop = (seat?.body?.translation().y ?? 0) + TOWER_SEAT_HEIGHT / 2;
    const humptyBottom = (humpty?.body?.translation().y ?? 0) - 55;
    const towerTop = Math.max(
      -Infinity,
      ...topBlocks.map(
        (block) => block.body!.translation().y + TOWER_BLOCK_HEIGHT / 2,
      ),
    );
    const humptyX = humpty?.body?.translation().x ?? Infinity;
    const seatX = seat?.body?.translation().x ?? 0;
    return {
      humptySeatContacts: contactCount(humpty?.collider, seat?.collider),
      seatTowerContacts: topBlocks.reduce(
        (sum, block) => sum + contactCount(seat?.collider, block.collider),
        0,
      ),
      humptySeatSeparation: humptyBottom - seatTop,
      seatTowerSeparation:
        (seat?.body?.translation().y ?? 0) - TOWER_SEAT_HEIGHT / 2 - towerTop,
      centerInsideSeat:
        Math.abs(humptyX - seatX) <= TOWER_SEAT_WIDTH / 2,
      humptyVerticalSpeed: Math.abs(humpty?.body?.linvel().y ?? Infinity),
    };
  }

  debugRemoveRoyalSeat(): void {
    const seat = this.entities.get("humpty_seat");
    if (!seat?.body) return;
    if (seat.collider) this.colliderOwners.delete(seat.collider.handle);
    this.world.removeRigidBody(seat.body);
    this.entities.delete(seat.id);
    this.wakeTower();
  }

  debugRemoveTowerBlock(blockId: string): void {
    const block = this.entities.get(blockId);
    if (!block?.body || !/^block_\d+$/.test(blockId)) return;
    if (block.collider) this.colliderOwners.delete(block.collider.handle);
    this.world.removeRigidBody(block.body);
    this.entities.delete(blockId);
    this.wakeTower();
  }

  debugProbeTower(blockId = "block_1", effort = 0.18): TowerProbeResult {
    const target = this.entities.get(blockId);
    if (!target?.body || !/^block_\d+$/.test(blockId)) {
      throw new Error(`Unknown tower block ${blockId}`);
    }
    const safeEffort = Math.max(0.02, Math.min(0.32, effort));
    const before = this.towerObservation();
    if (
      before.signedSupportMargin < TOWER_BLOCK_WIDTH * 0.42 ||
      before.maximumTilt > 0.1
    ) {
      return {
        blockId,
        appliedImpulse: 0,
        reactionForce: 0,
        blockDisplacement: 0,
        neighboringMotion: 0,
        towerAngularMotion: 0,
        signedSupportMargin: before.signedSupportMargin,
        aborted: true,
      };
    }
    const startPosition = target.body.translation();
    const startX = startPosition.x;
    const startY = startPosition.y;
    const initialVelocity = target.body.linvel();
    const startVelocityX = initialVelocity.x;
    const startVelocityY = initialVelocity.y;
    const neighbors = [...this.entities.values()]
      .filter(
        (entity) =>
          entity.id !== blockId && /^block_\d+$/.test(entity.id) && entity.body,
      )
      .map((entity) => ({
        id: entity.id,
        x: entity.body!.translation().x,
        y: entity.body!.translation().y,
      }));
    const impulse = safeEffort * 420;
    this.wakeTower();
    target.body.applyImpulseAtPoint(
      { x: startX <= TOWER_X ? impulse : -impulse, y: 0 },
      { x: startX, y: startY + TOWER_BLOCK_HEIGHT * 0.24 },
      true,
    );
    this.debugStep(0.24);
    const end = target.body.translation();
    const endVelocity = target.body.linvel();
    const after = this.towerObservation();
    const blockDisplacement = Math.hypot(end.x - startX, end.y - startY);
    const neighboringMotion =
      neighbors.reduce((sum, neighbor) => {
        const body = this.entities.get(neighbor.id)?.body;
        if (!body) return sum;
        const position = body.translation();
        return sum + Math.hypot(position.x - neighbor.x, position.y - neighbor.y);
      }, 0) / Math.max(1, neighbors.length);
    const deltaSpeed = Math.hypot(
      endVelocity.x - startVelocityX,
      endVelocity.y - startVelocityY,
    );
    const freeAccelerationForce = target.body.mass() * deltaSpeed / 0.24;
    const appliedForce = impulse / 0.24;
    const aborted =
      after.signedSupportMargin < TOWER_BLOCK_WIDTH * 0.42 ||
      after.maximumTilt > 0.1 ||
      blockDisplacement > 12;
    if (aborted) {
      target.body.setLinvel({ x: 0, y: 0 }, true);
      target.body.setAngvel(0, true);
    }
    return {
      blockId,
      appliedImpulse: Math.round(impulse * 10) / 10,
      reactionForce: Math.round(Math.max(0, appliedForce - freeAccelerationForce)),
      blockDisplacement: Math.round(blockDisplacement * 100) / 100,
      neighboringMotion: Math.round(neighboringMotion * 100) / 100,
      towerAngularMotion:
        Math.round(Math.max(0, after.maximumTilt - before.maximumTilt) * 1000) /
        1000,
      signedSupportMargin: after.signedSupportMargin,
      aborted,
    };
  }

  debugStep(seconds: number): void {
    const steps = Math.max(0, Math.floor(seconds / FIXED_STEP));
    for (let index = 0; index < steps; index += 1) {
      this.stepPhysics();
      this.elapsed += FIXED_STEP;
      if (this.elapsed >= GAME_SECONDS && !this.winner) {
        this.finishTimeDraw();
      }
      if (this.winner) break;
    }
  }

  debugTeamState(team: WorkerTeam): TeamAgentState {
    return this.teamStateFor(team);
  }

  async debugRunTeamDecision(team: WorkerTeam): Promise<void> {
    await this.beginTeamDecision(team);
  }

  async debugRunTurn(): Promise<void> {
    if (this.winner || this.turn >= MAX_TURNS) return;
    await this.beginTurn(true);
    this.debugStep(TURN_SECONDS);
    this.lastTurnAt = this.elapsed;
    if (this.cracked && !this.winner) {
      this.pendingWinnerAt = 0;
      this.crackFreezeUntil = 0;
      this.finishFromCrack();
    }
    if (this.turn >= MAX_TURNS && !this.winner) this.finishStalemate();
  }

  debugWorkOperations(): WorkOperation[] {
    return [...this.operationHistory];
  }

  debugDropHumpty(y = 720): void {
    const humpty = this.entities.get("humpty");
    if (!humpty?.body) return;
    this.wakeTower();
    humpty.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    humpty.body.setTranslation({ x: 380, y }, true);
    humpty.body.setLinvel({ x: 0, y: -80 }, true);
    humpty.body.wakeUp();
  }

  debugPlaceHumptyOnFloor(angle = 0): void {
    const humpty = this.entities.get("humpty");
    if (!humpty?.body) return;
    humpty.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    humpty.body.setTranslation(
      { x: 380, y: GROUND_HEIGHT + 45 },
      true,
    );
    humpty.body.setRotation(angle, true);
    humpty.body.setLinvel({ x: 0, y: 0 }, true);
    humpty.body.setAngvel(0, true);
    humpty.body.wakeUp();
  }

  debugLaunchStoneAtHumpty(speed: number): void {
    const humpty = this.entities.get("humpty");
    const projectile =
      this.entities.get("kit_queen_wheel_01") ??
      [...this.entities.values()].find(
        (entity) => entity.team === "queen" && entity.puzzleDefinition && entity.body,
      );
    if (!humpty?.body || !projectile?.body) return;
    const target = humpty.body.translation();
    projectile.collider?.setCollisionGroups(PROJECTILE_IGNORE_TOWER_GROUPS);
    projectile.body.setTranslation({ x: target.x - 210, y: target.y }, true);
    projectile.body.setLinvel({ x: speed, y: 0 }, true);
    projectile.body.wakeUp();
  }

  debugMovePuzzleAssembly(
    partId: string,
    x: number,
    y: number,
    depth: number,
  ): { blocked: boolean; obstacleIds: string[] } {
    const ids = this.assemblyPartIds(partId);
    if (ids.length === 0) return { blocked: true, obstacleIds: [] };
    const result = this.translatePuzzleAssembly(ids, partId, x, y, depth);
    this.stepPhysics();
    return result;
  }

  debugLiftPuzzleAssembly(partId: string, amount: number): void {
    for (const id of this.assemblyPartIds(partId)) {
      const body = this.entities.get(id)?.body;
      if (!body) continue;
      const position = body.translation();
      body.setTranslation({ x: position.x, y: position.y + amount }, true);
    }
  }

  dispose(): void {
    this.events.free();
    this.world.free();
  }

  debugPlaceClimbablePlank(): string {
    const id = `plank_test_${this.plankSequence++}`;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(510, 100)
        .setRotation(0.86),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(75, 7).setFriction(1.25),
      body,
    );
    this.addEntity({
      id,
      kind: "plank",
      team: "king",
      body,
      collider,
      width: 150,
      height: 14,
      stress: 0,
    });
    return id;
  }
}
