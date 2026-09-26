import RAPIER from "@dimforge/rapier3d-compat";
import { AMMO, arcPoint, arcVelocity, solveLaunch } from "./ballistics.js";
import { CREW_SPECS, TRAP_TIME, callLunch, createCrewState, crownWithBucket, dropThroughTrap, formation, slotWorld, steerCrew, sting, type CrewState, type Threat } from "./crew.js";
import { eggHullPoints } from "./egg.js";
import {
  BUCKET_SIZE,
  CHEST_SIZE,
  HAY_SIZE,
  HUMPTY_BASE,
  KEG_HALF_HEIGHT,
  KEG_RADIUS,
  MAYPOLE_CROWN,
  MAYPOLE_WIDTH,
  SANDBAG_SIZE,
  SEESAW_FLOOR,
  TURNTABLE_SEAT,
  hopperBoards,
  hopperFrame,
  type FixtureDef,
  type ChestDef,
  type LevelDef,
  type SandbagDef,
  type SeesawDef,
  type SwingDef,
  type TrapDef,
  type TurntableDef,
  type VaneDef,
  type ChuteDef,
  type CarouselDef,
  type GateDef,
  type DresserDef,
  type PeelDef,
  PEEL_SIZE,
  type RevolveDef,
  REVOLVE_HEIGHT,
  type MousetrapDef,
  MOUSETRAP_SIZE,
  type ChinaKind,
  DRESSER,
  dresserChina,
} from "./level.js";
import { CHALLENGES } from "./challenges.js";
import { CURIOS } from "./curios.js";
import { add, axisAngle, closestBetweenSegments, closestOnSegment, distanceToSegment, rotate, scale, segmentDistance, troughFrame, yAxisTo } from "./geometry.js";
import { FALL_POINTS, MayhemTally, comboBonus, type MayhemKind } from "./mayhem.js";
import { catchRat, createRat, scareRat, stepRat, type RatState } from "./rat.js";
import {
  distance,
  lengthOf,
  yawQuat,
  type AmmoKind,
  type BodyKind,
  type BodyView,
  type CueKind,
  type CurioId,
  type FixtureLook,
  type GameEvent,
  type HumptyMood,
  type Phase,
  type Quat,
  type StockKind,
  type Vec3,
} from "./types.js";

const STOCK: StockKind[] = ["shot", "shell", "grape", "chain", "bomb"];

/** How long the bees are out once their hive is struck, how fast they fly, and how near stings. */
export const SWARM_TIME = 12;
const SWARM_SPEED = 4.4;
const SWARM_REACH = 1.7;
/** The swarm tires of one crew after this long and goes after the nearest other. */
const SWARM_SWITCH = 4;
/** The fastest a shot sends a banana skin skidding (m/s). */
const PEEL_KICK = 7.5;

export const STEP = 1 / 60;

/** The Queen's battery sits at the front of the stage, facing -z. */
export const CANNON_PIVOT: Vec3 = { x: -0.9, y: 1.02, z: 8.4 };
export const MORTAR_PIVOT: Vec3 = { x: 1.6, y: 0.78, z: 8.6 };
/** The Queen keeps a blunderbuss on her podium for vermin. */
export const QUEEN_GUN: Vec3 = { x: -4.15, y: 1.95, z: 7.15 };
export const BARREL_LENGTH = { cannon: 1.55, mortar: 0.55, queen: 0.5 };
const SHOT_RADIUS: Record<AmmoKind, number> = { shot: 0.2, shell: 0.26, grape: 0.085, chain: 0.17, bomb: 0.24, blunderbuss: 0.07 };
/** Seconds from a fizzing bomb's first landing until it goes off. */
export const BOMB_FUSE = 2.2;

export const STAGE = { minX: -16, maxX: 16, minZ: -10, maxZ: 11.5 };

/** Height of Humpty's centre lying on the boards: a fall is measured centre to centre. */
export const HUMPTY_REST = 0.55;
/** Minimum impact speed (m/s) that cracks Humpty against something hard. */
export const CRACK_SPEED = 6.6;
export const HUMPTY_MASS = 90;
/** How much faster the gun reloads while Humpty is in the air. */
const FALLING_RELOAD = 2.5;
/** Largest blow (N·s) the chain of a chain shot deals to one body in one pass. */
const CHAIN_BLOW = 420;
/**
 * Chain shot: two balls fired side by side, one kicked forward and one back, on a chain. They fly
 * apart until the chain goes taut, then whirl round their middle at a steady rate, in the plane
 * they were fired in (`chainOffset` predicts it to within a few centimetres of the physics).
 */
const CHAIN_LENGTH = 1.25;
const CHAIN_SPREAD = 0.45;
const CHAIN_SPIN = 6.5;
const SHOT_RADIUS_CHAIN = 0.17;
/** How far a chain scythes on after one of its balls first glances off something. */
const CHAIN_FOLLOW = 0.45;
/** Shared by every aim preview; made once Rapier has loaded. */
let chainBall: RAPIER.Ball | undefined;
const paddleProbes = new Map<number, RAPIER.Ball>();

/** Where the first chain ball sits from the pair's middle, t s after firing: across and forward. */
function chainOffset(t: number): { across: number; forward: number } {
  const taut = Math.sqrt(CHAIN_LENGTH ** 2 - (2 * CHAIN_SPREAD) ** 2) / (2 * CHAIN_SPIN);
  if (t < taut) return { across: CHAIN_SPREAD, forward: CHAIN_SPIN * t };
  const start = Math.atan2(CHAIN_SPIN * taut, CHAIN_SPREAD);
  const turn = start + ((2 * CHAIN_SPIN * Math.cos(start)) / CHAIN_LENGTH) * (t - taut);
  return { across: (CHAIN_LENGTH / 2) * Math.cos(turn), forward: (CHAIN_LENGTH / 2) * Math.sin(turn) };
}
/** How fast a struck weathercock swings round to its next setting (rad/s). */
const VANE_TURN = 3;
/** The carousel's paddles: thickness, and how cleanly shots glance off them. */
const PADDLE_THICK = 0.14;
const PADDLE_BOUNCE = 0.85;
/** The portcullis: up in `GATE_RISE`, held for `GATE_TIME`, then lowered over `GATE_FALL` seconds. */
export const GATE_RISE = 0.9;
export const GATE_TIME = 8;
export const GATE_FALL = 2.5;
/** A forced chest: one to replace the shot that opened it, and two more for the emptiest racks. */
const CHEST_EXTRA = 2;
/** Height of the rail round the music box's seat. */
const TURNTABLE_RAIL = 0.1;
/** Curios with a line of their own on the King's bill; the rest are "scenery disturbed". */
const CURIO_SCORE: Partial<Record<CurioId, MayhemKind>> = { king: "royal", duke: "duke", stagehands: "stagehand", tower: "tower", pie: "pie", mouse: "mouse" };
/** Structural bodies that are rides, not masonry. */
const RIDES = new Set(["seat", "seesaw", "cradle"]);
/** How tall the sides of the rock-a-bye basket are. */
const CRADLE_SIDE = 0.34;
/** How long the wind machine blows, how hard it pumps a swinging load, and when it stops pushing. */
const WIND_TIME = 9;
const WIND_PUSH = 2.4;
const WIND_TOP_SPEED = 6.5;
/** The push a cut maypole top gets: enough to topple it, gently, like a felled tree. */
const MAYPOLE_NUDGE = 110;
/** Lowest surface the stagehands will use as a perch. Above the "landed low" line (1.65 m centre). */
const PERCH_MIN = 1.05;
const SOFT = { hay: 0.3, bed: 0.25, man: 0.35, horse: 0.35 };
const REST_SPEED = 0.3;

let physicsReady: Promise<void> | undefined;
export function initPhysics(): Promise<void> {
  physicsReady ??= RAPIER.init();
  return physicsReady;
}

const G = { STATIC: 1, BLOCK: 2, HUMPTY: 4, PROJ: 8, CREW: 16, DEBRIS: 32, BED: 64 } as const;
const ALL = 0xffff;
const groups = (member: number, filter: number): number => (member << 16) | filter;
// The King's men and horses are kinematic, so they could shove Humpty with unlimited force.
// Only the straw beds they carry touch him; everything else passes by.
const GROUPS = {
  static: groups(G.STATIC, ALL & ~G.STATIC),
  block: groups(G.BLOCK, ALL),
  humpty: groups(G.HUMPTY, ALL & ~G.CREW),
  proj: groups(G.PROJ, ALL & ~G.PROJ),
  crew: groups(G.CREW, G.BLOCK | G.PROJ | G.DEBRIS),
  bed: groups(G.BED, G.BLOCK | G.HUMPTY | G.PROJ | G.DEBRIS),
  debris: groups(G.DEBRIS, G.STATIC | G.BLOCK | G.DEBRIS | G.CREW | G.BED),
};

const DENSITY: Record<string, number> = { domino: 520, maypole: 560, oak: 520, plank: 480, beam: 560, brick: 900, stone: 1250, post: 600, canopy: 150, anvil: 4500 };

/** A piece of the King's china: a sensor on the dresser, smashed by a shot or a blast (or its neighbour). */
interface ChinaPiece {
  kind: ChinaKind;
  row: number;
  at: Vec3;
  local: Vec3;
  broken: boolean;
  /** When a neighbour's smash rattles it off the shelf, and how far that shock carries on. */
  breakAt?: number;
  shock: number;
}

interface Entity {
  view: BodyView;
  body: RAPIER.RigidBody;
  colliders: RAPIER.Collider[];
  mass: number;
  /** Multiplier applied to Humpty's impact speed against this entity. */
  softness: number;
  ammo?: AmmoKind;
  born: number;
  restFor: number;
  fuseAt?: number;
  crew?: CrewState;
  role?: "man" | "horse" | "bed";
  structural: boolean;
  lastVelocity?: Vec3;
  /** Scenery fixtures: how they look and how hard shots bounce off them. */
  look?: FixtureLook;
  bounce?: number;
  /** Blunderbuss pellets are swept up quickly so they never tidy the castle for free. */
  expires?: number;
  /** Chain shot: when its chain last struck each body, so one pass is one blow. */
  struck?: Map<number, number>;
  /** A stage cue fixture, and when it was last called. */
  cue?: CueKind;
  cuedAt?: number;
  /** A springy bed's launch speed. */
  spring?: number;
  /** A barrel-ramp keg: its fuse lights (for this many seconds) once it starts rolling. */
  rollFuse?: number;
  /** A domino: falling onto a stage cue sets it off, just as a shot would. */
  domino?: boolean;
  /** Rocked by the wind machine. */
  windy?: boolean;
  /** A banana skin: whether the Queen has sent it skidding, and whether it's been trodden on. */
  peel?: { armed: boolean; spent: boolean; flickedBy?: number; ghostUntil?: number };
  /** A mousetrap: knocked out into the open (armed), and snapped shut (sprung). */
  mousetrap?: { armed: boolean; sprung: boolean; flickedBy?: number; ghostUntil?: number };
}

export interface RopeView {
  top: Vec3;
  bottom: Vec3;
}

export interface RatView {
  id: number;
  mode: RatState["mode"];
  stride: number;
  flip: number;
  carrying: boolean;
}

export interface Stars {
  cracked: boolean;
  /** Enough mayhem before he cracked. */
  mayhem: boolean;
  /** The verse's hidden star was knocked out of its figure before he cracked. */
  star: boolean;
  count: number;
}

export interface CrewView {
  id: string;
  kind: CrewState["kind"];
  x: number;
  z: number;
  heading: number;
  speed: number;
  mode: CrewState["mode"];
  stride: number;
  toppled: number;
  slots: number[];
  /** Somebody in this crew is wearing a bucket. */
  bucket: boolean;
}

export interface AimPreview {
  points: Vec3[];
  hit: Vec3 | undefined;
  hitKind: BodyKind | undefined;
  /** Which way the struck surface faces, so the marker can lie flat on it. */
  hitNormal?: Vec3;
  /** A curio in the scenery the shot flies through on its way (shots pass through and set it off). */
  passes?: { at: Vec3; what: "curio" | "china" };
  /** Chain shot: where its chain will cut each rope it scythes through before it stops. */
  cuts?: Vec3[];
  reachable: boolean;
  from: Vec3;
  velocity: Vec3;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Game {
  static async create(level: LevelDef, seed = 7): Promise<Game> {
    await initPhysics();
    return new Game(level, seed);
  }

  readonly level: LevelDef;
  readonly world: RAPIER.World;
  readonly events: GameEvent[] = [];
  readonly ammo: Record<StockKind, number>;
  selected: AmmoKind;
  /** Seconds until the Queen can fire her blunderbuss again. */
  blunderReload = 0;
  phase: Phase = "aim";
  time = 0;
  reload = 0.4;
  cracked = false;
  won = false;
  resultAt: number | undefined;
  readonly stats = { shots: 0, bowled: 0, fall: 0, blocksMoved: 0, catches: 0 };
  /** Did he crack with the verse's side challenge done? (Judged at the crack.) */
  challengeMet = false;
  private vaneTurns = 0;
  private spins = 0;
  /** Everything the Queen has broken, up to the crack. */
  readonly mayhem = new MayhemTally();
  /** Every shot fired, by step, so a replay can fire them again at exactly the same moments. */
  readonly log: Array<{ step: number; ammo: AmmoKind; at: Vec3 }> = [];
  /** Fixed steps taken so far. */
  steps = 0;
  /** The verse's hidden star has been knocked loose. */
  starFound = false;
  /** Shot issued so far, per kind: the verse's stock plus whatever the chests held. */
  readonly issued: Record<StockKind, number>;
  /** Until when the wind machine is blowing. */
  windUntil = -1;
  humptyMood: HumptyMood = "calm";
  humptyAirborne = false;
  humptyDrop = 0;

  private readonly queue: RAPIER.EventQueue;
  private readonly entities = new Map<number, Entity>();
  private readonly byCollider = new Map<number, Entity>();
  private readonly crews: CrewState[] = [];
  private readonly rng: () => number;
  private nextId = 1;
  private humpty: Entity | undefined;
  private readonly perch: Vec3;
  private peakY: number;
  private restTimer = 0;
  /** Set when he leaves a surface; the next time he comes to rest counts as a landing. */
  private awaitingLanding = false;
  private humptyVelocity: Vec3 = { x: 0, y: 0, z: 0 };
  private freeSteps = 0;
  private contactSteps = 0;
  private lastWobble = -10;
  /** Which way he was last shoved along his perch, and when: a teeter needs a push toward a drop. */
  private stirDir: { x: number; z: number } | undefined;
  private stirredAt = -99;
  private teeter: { toward: { x: number; z: number }; since: number } | undefined;
  private lastTeeter = -99;
  /** The mayhem the latest shot has set off so far, for its trick-shot bonus. */
  private combo: { kinds: Set<MayhemKind>; at: Vec3; opened: number; last: number } | undefined;
  private lastNearMiss = -10;
  private caughtAt = -10;
  private settledFor = 0;
  private lastShotAt = -10;
  private hoistRetryAt = 0;
  private hoist: { from: Vec3; to: Vec3; top: number; t: number; rotation: Quat; checked: boolean; track: boolean } | undefined;
  /** Where the stagehands last set him down; cleared by the next shot. */
  private releasedAt: Vec3 | undefined;
  private releaseTime = -10;
  /** Perches he slid off without being shot; the stagehands avoid them. */
  private readonly badPerches: Vec3[] = [];
  private pendingExplosions: Array<{ at: Vec3; radius: number; power: number; keg: boolean; ammo?: StockKind }> = [];
  /** Set by a safe landing: the stagehands will fetch him once he is still. */
  private needsHoist = false;
  private lastStock: StockKind = "shot";
  private turntable: { entity: Entity; def: TurntableDef; angle: number; omega: number } | undefined;
  private readonly vanes: Array<{ entity: Entity; angle: number; target: number; step: number }> = [];
  private carousel: { entity: Entity; def: CarouselDef; angle: number } | undefined;
  /** The revolving stage: how far round it has been turned, and when its current turn began. */
  private revolve: { entity: Entity; def: RevolveDef; angle: number; startedAt: number | undefined; previous?: number } | undefined;
  private gate: { entity: Entity; def: GateDef; openedAt: number } | undefined;
  /** Sensors in the mouths of chute hoppers: a shot dropping in pays once. */
  private readonly hoppers = new Map<number, { scored: boolean }>();
  /** The King's china, piece by piece (sensors on the dresser): smashed, or about to be. */
  private readonly china = new Map<number, ChinaPiece>();
  private dishRan = false;
  /** The bees, once their hive is struck: where they are, whom they're after, whom they've stung. */
  private swarm: { at: Vec3; home: Vec3; until: number; target: string | undefined; since: number; stung: Set<string> } | undefined;
  private swing: { seat: Entity; def: SwingDef } | undefined;
  private seesaw: { plank: Entity; def: SeesawDef; restAngle: number } | undefined;
  private readonly ropes: Array<{ joint: RAPIER.ImpulseJoint; seat: Entity; local: Vec3; top: Vec3; cut: boolean }> = [];
  private readonly curios = new Map<number, { id: CurioId; at: Vec3; last: number; scored: boolean }>();
  /** Structural bodies already counted as toppled or scattered. */
  private readonly toppled = new Set<number>();
  private rat: { state: RatState; entity: Entity } | undefined;
  private readonly startPositions = new Map<number, Vec3>();
  private trap: { def: TrapDef; openedAt: number } | undefined;
  private lastBounce = -10;
  private bounceStreak = 0;

  private constructor(level: LevelDef, seed: number) {
    this.level = level;
    this.rng = mulberry32(seed);
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = STEP;
    this.world.numSolverIterations = 8;
    this.queue = new RAPIER.EventQueue(true);
    this.ammo = { shot: 0, shell: 0, grape: 0, chain: 0, bomb: 0, ...level.ammo };
    this.issued = { ...this.ammo };
    this.selected = STOCK.find((kind) => this.ammo[kind] > 0) ?? "shot";
    this.lastStock = this.selected;
    this.perch = { ...level.humpty };
    this.peakY = level.humpty.y;
    this.buildStage();
    const fixtures: Entity[] = [];
    for (const piece of level.pieces) {
      if (piece.kind === "block") this.addBlock(piece.material, piece.pos, piece.size, piece.yaw);
      else if (piece.kind === "keg") this.addKeg(piece.pos, piece.lie, piece.fuse);
      else if (piece.kind === "hay") this.addHay(piece.pos, piece.yaw);
      else if (piece.kind === "fixture") fixtures.push(this.addFixture(piece));
      else if (piece.kind === "bucket") this.addBucket(piece.pos);
      else if (piece.kind === "sandbag") this.addSandbag(piece);
      else if (piece.kind === "chest") this.addChest(piece);
      else if (piece.kind === "trap") this.trap = { def: piece, openedAt: -99 };
      else if (piece.kind === "vane") this.addVane(piece);
      else if (piece.kind === "chute") this.addChute(piece);
      else if (piece.kind === "carousel") this.addCarousel(piece);
      else if (piece.kind === "gate") this.addGate(piece);
      else if (piece.kind === "dresser") this.addDresser(piece);
      else if (piece.kind === "peel") this.addPeel(piece);
      else if (piece.kind === "revolve") this.addRevolve(piece);
      else if (piece.kind === "mousetrap") this.addMousetrap(piece);
    }
    // Contraptions attach to the fixtures laid down before them.
    for (const piece of level.pieces) {
      if (piece.kind === "turntable") this.addTurntable(piece);
      else if (piece.kind === "swing") this.addSwing(piece, fixtures);
      else if (piece.kind === "seesaw") this.addSeesaw(piece, fixtures);
    }
    this.addHumpty(level.humpty);
    for (const def of level.crews) this.addCrew(def);
    if (level.rat) this.addRat(level.rat);
    for (const entity of this.entities.values()) {
      if (entity.structural) this.startPositions.set(entity.view.id, { ...entity.view.position });
    }
  }

  // ---------------------------------------------------------------- queries

  get bodies(): BodyView[] {
    return [...this.entities.values()].map((entity) => entity.view);
  }

  get crewViews(): CrewView[] {
    return this.crews.map((crew) => ({
      id: crew.id,
      kind: crew.kind,
      x: crew.x,
      z: crew.z,
      heading: crew.heading,
      speed: crew.speed,
      mode: crew.mode,
      stride: crew.stride,
      toppled: crew.toppled,
      slots: crew.slots,
      bucket: this.time < crew.bucketUntil,
    }));
  }

  get humptyId(): number | undefined {
    return this.humpty?.view.id;
  }

  get humptyPosition(): Vec3 | undefined {
    return this.humpty ? { ...this.humpty.view.position } : undefined;
  }

  /** How far he would fall if he dropped straight down to the boards from where he sits. */
  get humptyHeight(): number {
    return this.humpty ? Math.max(0, this.humpty.view.position.y - HUMPTY_REST) : 0;
  }

  /** The trapdoor ring, and how far open its leaves are (0 shut, 1 hanging open). */
  get trapView(): { center: Vec3; inner: number; outer: number; open: number; pulled: boolean } | undefined {
    const trap = this.trap;
    if (!trap) return undefined;
    const since = this.time - trap.openedAt;
    // Open as they drop, shut while they're below, open again as they climb back out.
    const leaf = (t: number): number => (t < 0 ? 0 : t < 0.25 ? t / 0.25 : t < 1.2 ? 1 : t < 1.6 ? 1 - (t - 1.2) / 0.4 : 0);
    const open = Math.max(leaf(since), leaf(since - TRAP_TIME + 0.2));
    return { center: trap.def.pos, inner: trap.def.inner, outer: trap.def.outer, open, pulled: since >= 0 && since < TRAP_TIME + 1.6 };
  }

  /** Is the wind machine blowing? */
  get windy(): boolean {
    return this.time < this.windUntil;
  }

  /** Where the hidden star is right now (while still hidden), for a glint now and then. */
  get starAt(): Vec3 | undefined {
    if (this.starFound) return undefined;
    const holder = this.level.star;
    if ("crew" in holder) {
      const crew = this.crews.find((item) => item.id === holder.crew);
      const man = crew?.slots.map((id) => this.entities.get(id)).find((entity) => entity?.role === "man" || entity?.role === "horse");
      return man ? { x: man.view.position.x, y: man.view.position.y + 1.1, z: man.view.position.z } : undefined;
    }
    if ("curio" in holder) return CURIOS.find((curio) => curio.id === holder.curio)?.at;
    const rat = this.rat;
    return rat && rat.state.mode !== "off" ? { x: rat.state.x, y: 0.9, z: rat.state.z } : undefined;
  }

  /** Seconds until the King's men climb back up out of the trapdoor (0 if nobody is down there). */
  get trapLeft(): number {
    return Math.max(0, ...this.crews.filter((crew) => crew.mode === "trapped").map((crew) => crew.trapUntil - this.time));
  }

  /** Seconds until the King's men are back from lunch (0 if nobody is at lunch). */
  get lunchLeft(): number {
    return Math.max(0, ...this.crews.map((crew) => crew.lunchUntil - this.time));
  }

  get hoisting(): boolean {
    return this.hoist !== undefined;
  }

  get ammoLeft(): number {
    return STOCK.reduce((sum, kind) => sum + this.ammo[kind], 0);
  }

  /** Bombs that have landed: where they are and how long their fuses have left. */
  get fuses(): Array<{ at: Vec3; left: number }> {
    const fuses: Array<{ at: Vec3; left: number }> = [];
    for (const entity of this.entities.values()) {
      const lit = entity.view.kind === "bomb" || (entity.view.kind === "keg" && entity.rollFuse !== undefined);
      if (lit && entity.fuseAt !== undefined) fuses.push({ at: { ...entity.view.position }, left: Math.max(0, entity.fuseAt - this.time) });
    }
    return fuses;
  }

  /** Is the rat on stage, so the Queen may use her blunderbuss? */
  get vermin(): boolean {
    const mode = this.rat?.state.mode;
    return mode === "creep" || mode === "gnaw";
  }

  get ratView(): RatView | undefined {
    if (!this.rat || this.rat.state.mode === "off") return undefined;
    const { state, entity } = this.rat;
    return { id: entity.view.id, mode: state.mode, stride: state.stride, flip: state.flip, carrying: state.carrying };
  }

  get ropeViews(): RopeView[] {
    return this.ropes.filter((rope) => !rope.cut && !rope.seat.view.removed).map((rope) => ({ top: rope.top, bottom: this.ropeBottom(rope) }));
  }

  /** Spin rate of the clockwork turntable, for the music box. */
  get turntableSpeed(): number {
    return this.turntable?.omega ?? 0;
  }

  canFire(): boolean {
    if (this.selected === "blunderbuss") return this.vermin && this.blunderReload <= 0 && this.phase !== "won" && this.phase !== "lost";
    return this.phase === "aim" && this.reload <= 0 && this.ammo[this.selected] > 0;
  }

  select(kind: AmmoKind): boolean {
    if (kind === "blunderbuss") {
      if (!this.vermin) return false;
    } else {
      if (this.ammo[kind] <= 0) return false;
      this.lastStock = kind;
    }
    this.selected = kind;
    return true;
  }

  /** Stars count only once he cracks; until then they are only promises. */
  stars(): Stars {
    const cracked = this.cracked;
    const mayhem = cracked && this.mayhem.total >= this.level.mayhem;
    const star = cracked && this.starFound;
    return { cracked, mayhem, star, count: Number(cracked) + Number(mayhem) + Number(star) };
  }

  drainEvents(): GameEvent[] {
    return this.events.splice(0, this.events.length);
  }

  /**
   * First thing a ray from the camera touches, for aiming: solid things, the curios in the scenery,
   * and ropes (which are too thin to point at exactly, so the ray snaps to one it passes close by).
   */
  raycast(origin: Vec3, direction: Vec3, maxDistance = 200): Vec3 | undefined {
    const ray = new RAPIER.Ray(origin, direction);
    const hit = this.world.castRay(ray, maxDistance, true, undefined, undefined, undefined, undefined, (collider) => {
      const owner = this.byCollider.get(collider.handle);
      return !owner || owner.view.kind !== "shard";
    });
    let reach = hit ? hit.timeOfImpact : maxDistance;
    let point: Vec3 | undefined = hit ? add(origin, { x: direction.x * reach, y: direction.y * reach, z: direction.z * reach }) : undefined;
    const end = add(origin, { x: direction.x * maxDistance, y: direction.y * maxDistance, z: direction.z * maxDistance });
    for (const rope of this.ropeViews) {
      const near = closestBetweenSegments(origin, end, rope.bottom, rope.top);
      const along = near.s * maxDistance;
      // About a rope's thickness either side, at the distances the stage is seen from.
      if (near.distance > 0.02 * Math.sqrt(along) + 0.05 || along >= reach) continue;
      reach = along;
      point = {
        x: rope.bottom.x + (rope.top.x - rope.bottom.x) * near.t,
        y: rope.bottom.y + (rope.top.y - rope.bottom.y) * near.t,
        z: rope.bottom.z + (rope.top.z - rope.bottom.z) * near.t,
      };
    }
    return point;
  }

  /**
   * Ballistic path from the selected gun to `target`, cut where it first hits something.
   * Off a bumper the path carries on, bounced, so bank shots can be lined up.
   */
  aim(target: Vec3, kind: AmmoKind = this.selected): AimPreview {
    const spec = AMMO[kind];
    const pivot = spec.gun === "mortar" ? MORTAR_PIVOT : spec.gun === "queen" ? QUEEN_GUN : CANNON_PIVOT;
    const solution = solveLaunch(pivot, target, spec.speed, spec.lob);
    const t0 = BARREL_LENGTH[spec.gun] / spec.speed;
    const from = arcPoint(pivot, solution.velocity, t0);
    const velocity = arcVelocity(solution.velocity, t0);
    const points: Vec3[] = [from];
    let hit: Vec3 | undefined;
    let hitKind: BodyKind | undefined;
    let origin = from;
    let launch = velocity;
    let bounces = 0;
    let step = 0;
    const dt = 0.03;
    const range = kind === "blunderbuss" ? 40 : 220;
    let hitNormal: Vec3 | undefined;
    const flags = RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
    const filter = groups(G.PROJ, ALL & ~G.PROJ & ~G.DEBRIS);
    // Chain shot's balls whirl up to a chain's length apart: the arc must stop where either ball
    // strikes, not just where their middle would, or a shot skimming a wall "passes" and drops short.
    const forward = normalise(velocity);
    const across = normalise({ x: -forward.z, y: 0, z: forward.x });
    const ballAt = (centre: Vec3, t: number, sign: number): Vec3 => {
      const o = chainOffset(t);
      return {
        x: centre.x + sign * (across.x * o.across + forward.x * o.forward),
        y: centre.y + sign * (across.y * o.across + forward.y * o.forward),
        z: centre.z + sign * (across.z * o.across + forward.z * o.forward),
      };
    };
    const ball = kind === "chain" ? (chainBall ??= new RAPIER.Ball(SHOT_RADIUS_CHAIN)) : undefined;
    const spinner = this.carousel?.entity.body;
    // What the player is pointing at, if it's a curio shots fly through.
    const through = this.passThrough(target, kind);
    let passes: AimPreview["passes"];
    const ropes = kind === "chain" ? this.ropeViews : [];
    const cuts: Vec3[] = [];
    const cut = new Set<number>();
    // Aimed right at a rope, a chain that gets within reach of it cuts it, even past an egg or a post.
    const aimedRope = ropes.findIndex((rope) => distanceToSegment(target, rope.bottom, rope.top) < 0.05);
    let flown = 0;
    for (let index = 1; index < range; index += 1) {
      step += 1;
      flown += dt;
      const previous = points[points.length - 1]!;
      const next = arcPoint(origin, launch, step * dt);
      const segment = { x: next.x - previous.x, y: next.y - previous.y, z: next.z - previous.z };
      const length = lengthOf(segment);
      const direction = { x: segment.x / length, y: segment.y / length, z: segment.z / length };
      const ray = new RAPIER.Ray(previous, direction);
      // The carousel is left out of these casts: where its paddles are now is not where they'll be.
      const contact = this.world.castRayAndGetNormal(ray, length, true, flags, filter, undefined, spinner);
      // How far along this step the shot gets before it strikes something (1: all the way).
      let stop = contact ? contact.timeOfImpact / length : Infinity;
      let ballHit: { handle: number; normal: Vec3 } | undefined;
      if (ball && bounces === 0) {
        for (const sign of [1, -1]) {
          const a = ballAt(previous, flown - dt, sign);
          const b = ballAt(next, flown, sign);
          const swept = this.world.castShape(a, { x: 0, y: 0, z: 0, w: 1 }, { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }, ball, 0, 1, true, flags, filter, undefined, spinner);
          if (swept && swept.time_of_impact < stop) {
            stop = swept.time_of_impact;
            // Rapier reports the struck surface's normal first, in world space, facing the ball.
            ballHit = { handle: swept.collider.handle, normal: { x: swept.normal1.x, y: swept.normal1.y, z: swept.normal1.z } };
          }
        }
      }
      const paddle = this.paddleHit(previous, next, flown - dt, flown, SHOT_RADIUS[kind]);
      if (paddle && paddle.u < stop) {
        const at = { x: previous.x + segment.x * paddle.u, y: previous.y + segment.y * paddle.u, z: previous.z + segment.z * paddle.u };
        points.push(at);
        if (bounces < 3 && kind !== "shell" && kind !== "bomb") {
          // Glance off the paddle as it sweeps past: a mirror bounce, carried along by the paddle.
          const v = arcVelocity(launch, (step - 1 + paddle.u) * dt);
          const rel = { x: v.x - paddle.surface.x, y: v.y - paddle.surface.y, z: v.z - paddle.surface.z };
          const into = rel.x * paddle.normal.x + rel.y * paddle.normal.y + rel.z * paddle.normal.z;
          const k = into < 0 ? (1 + PADDLE_BOUNCE) * into : 0;
          launch = {
            x: rel.x - k * paddle.normal.x + paddle.surface.x,
            y: rel.y - k * paddle.normal.y + paddle.surface.y,
            z: rel.z - k * paddle.normal.z + paddle.surface.z,
          };
          // Start the rest of the flight just clear of the paddle's face.
          origin = { x: at.x + paddle.normal.x * 0.02, y: at.y + paddle.normal.y * 0.02, z: at.z + paddle.normal.z * 0.02 };
          step = 0;
          bounces += 1;
          continue;
        }
        hit = at;
        hitKind = "fixture";
        hitNormal = paddle.normal;
        break;
      }
      const reached = Math.min(1, stop);
      const along = (u: number): Vec3 => ({ x: previous.x + segment.x * u, y: previous.y + segment.y * u, z: previous.z + segment.z * u });
      if (ball && bounces === 0 && ropes.length) {
        // The chain between the balls cuts any rope it passes within a hand's breadth of (as cutRopes
        // does). A ball glancing off a post or an egg doesn't stop the chain dead: it scythes on a
        // little way, so look a short way past a ball's first touch too.
        const scythe = ballHit ? Math.min(1, reached + CHAIN_FOLLOW / Math.max(length, 1e-3)) : reached;
        for (let k = 1; k <= 6; k += 1) {
          const u = Math.min(scythe, k / 6);
          const centre = along(u);
          const when = flown - dt + dt * u;
          const a = ballAt(centre, when, 1);
          const b = ballAt(centre, when, -1);
          ropes.forEach((rope, index) => {
            if (cut.has(index)) return;
            const near = closestBetweenSegments(a, b, rope.bottom, rope.top);
            if (near.distance >= 0.25) return;
            cut.add(index);
            cuts.push({
              x: rope.bottom.x + (rope.top.x - rope.bottom.x) * near.t,
              y: rope.bottom.y + (rope.top.y - rope.bottom.y) * near.t,
              z: rope.bottom.z + (rope.top.z - rope.bottom.z) * near.t,
            });
          });
          if (u >= scythe) break;
        }
      }
      if (through && !passes && distance(closestOnSegment(through.at, previous, along(reached)).point, through.at) < 0.12) passes = through;
      if (ballHit) {
        const at = along(reached);
        points.push(at);
        hit = at;
        hitKind = this.byCollider.get(ballHit.handle)?.view.kind;
        hitNormal = ballHit.normal;
        break;
      }
      if (contact) {
        const at = {
          x: previous.x + direction.x * contact.timeOfImpact,
          y: previous.y + direction.y * contact.timeOfImpact,
          z: previous.z + direction.z * contact.timeOfImpact,
        };
        points.push(at);
        const owner = this.byCollider.get(contact.collider.handle);
        if (owner?.bounce && owner.bounce > 0.5 && bounces < 2 && kind !== "shell" && kind !== "bomb") {
          // Reflect off the bumper and keep drawing.
          const v = arcVelocity(launch, (step - 1 + contact.timeOfImpact / length) * dt);
          const n = contact.normal;
          const along = v.x * n.x + v.y * n.y + v.z * n.z;
          const e = owner.bounce;
          launch = { x: v.x - (1 + e) * along * n.x, y: v.y - (1 + e) * along * n.y, z: v.z - (1 + e) * along * n.z };
          // A real ball touches the plate one radius early: bounce from where its centre is then.
          const back = SHOT_RADIUS[kind] / Math.max(0.25, Math.abs(direction.x * n.x + direction.y * n.y + direction.z * n.z));
          origin = { x: at.x - direction.x * back, y: at.y - direction.y * back, z: at.z - direction.z * back };
          points.push(origin);
          step = 0;
          bounces += 1;
          continue;
        }
        hit = at;
        hitKind = owner?.view.kind;
        hitNormal = { x: contact.normal.x, y: contact.normal.y, z: contact.normal.z };
        break;
      }
      points.push(next);
      if (next.y < -1) break;
    }
    const last = points[points.length - 1]!;
    if (aimedRope >= 0 && !cut.has(aimedRope) && distance(last, target) < CHAIN_LENGTH) cuts.unshift({ ...target });
    return { points, hit, hitKind, ...(hitNormal ? { hitNormal } : {}), ...(passes ? { passes } : {}), ...(cuts.length ? { cuts } : {}), reachable: solution.reachable, from, velocity };
  }

  /**
   * Where a shot's path from a to b (flown t0 to t1 seconds after firing) first meets a carousel
   * paddle, with each paddle where it will be by then. The path is turned back by however far the
   * carousel will have turned, and swept, as the real ball, against the real paddles as they stand
   * now. `u` is how far along a-b; `normal` faces the shot; `surface` is the paddle's velocity there.
   */
  private paddleHit(a: Vec3, b: Vec3, t0: number, t1: number, radius: number): { u: number; normal: Vec3; surface: Vec3 } | undefined {
    const carousel = this.carousel;
    if (!carousel) return undefined;
    const { def } = carousel;
    const axis = { x: def.pos.x, y: 0, z: def.pos.z };
    const back = (point: Vec3, t: number): Vec3 => add(axis, rotate(yawQuat(-def.speed * t), { x: point.x - axis.x, y: point.y, z: point.z - axis.z }));
    const from = back(a, t0);
    const to = back(b, t1);
    let shape = paddleProbes.get(radius);
    if (!shape) {
      shape = new RAPIER.Ball(radius);
      paddleProbes.set(radius, shape);
    }
    const body = carousel.entity.body;
    const hit = this.world.castShape(from, { x: 0, y: 0, z: 0, w: 1 }, { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }, shape, 0, 1, false, undefined, undefined, undefined, undefined, (collider) => collider.parent()?.handle === body.handle);
    if (!hit) return undefined;
    const u = hit.time_of_impact;
    const at = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u };
    // Rapier gives the struck face's normal (world space, facing the shot): turn it forward again.
    const normal = rotate(yawQuat(def.speed * (t0 + (t1 - t0) * u)), { x: hit.normal1.x, y: hit.normal1.y, z: hit.normal1.z });
    const r = { x: at.x - axis.x, z: at.z - axis.z };
    return { u, normal, surface: { x: def.speed * r.z, y: 0, z: -def.speed * r.x } };
  }

  /** Is the aim point on a curio? Shots fly straight through them, setting them off. */
  private passThrough(target: Vec3, kind: AmmoKind): AimPreview["passes"] {
    if (kind === "blunderbuss") return undefined;
    for (const curio of CURIOS) {
      const inside = Math.abs(target.x - curio.at.x) <= curio.size.x / 2 + 0.05 && Math.abs(target.y - curio.at.y) <= curio.size.y / 2 + 0.05 && Math.abs(target.z - curio.at.z) <= curio.size.z / 2 + 0.05;
      if (inside) return { at: { ...target }, what: "curio" };
    }
    for (const piece of this.china.values()) {
      if (!piece.broken && distance(piece.at, target) < 0.25) return { at: { ...target }, what: "china" };
    }
    return undefined;
  }

  // ---------------------------------------------------------------- commands

  fire(target: Vec3): boolean {
    if (!this.canFire()) return false;
    const kind = this.selected;
    // A new shot settles the last one's account; the Queen's blunderbuss is for vermin, not tricks.
    if (kind !== "blunderbuss") {
      this.closeCombo();
      this.combo = { kinds: new Set(), at: { ...target }, opened: this.time, last: this.time };
    }
    this.log.push({ step: this.steps, ammo: kind, at: { ...target } });
    const preview = this.aim(target, kind);
    const { from, velocity } = preview;
    if (kind === "blunderbuss") {
      this.fireBlunderbuss(from, velocity);
      return true;
    }
    if (kind === "shot") {
      this.addProjectile("shot", from, velocity, 0.2, 28);
    } else if (kind === "shell") {
      this.addProjectile("shell", from, velocity, 0.26, 22);
    } else if (kind === "bomb") {
      // The fuse is lit when it first lands (see handleCollisions).
      this.addProjectile("bomb", from, velocity, SHOT_RADIUS.bomb, 20).view.fuse = BOMB_FUSE;
    } else if (kind === "grape") {
      const forward = normalise(velocity);
      const side = normalise({ x: -forward.z, y: 0, z: forward.x });
      const up = cross(side, forward);
      for (let index = 0; index < 9; index += 1) {
        const angle = (index / 9) * Math.PI * 2 + this.rng() * 0.6;
        const spread = index === 0 ? 0 : 0.035 + this.rng() * 0.035;
        const speed = lengthOf(velocity) * (0.94 + this.rng() * 0.1);
        const dir = normalise({
          x: forward.x + (side.x * Math.cos(angle) + up.x * Math.sin(angle)) * spread,
          y: forward.y + (side.y * Math.cos(angle) + up.y * Math.sin(angle)) * spread,
          z: forward.z + (side.z * Math.cos(angle) + up.z * Math.sin(angle)) * spread,
        });
        const offset = 0.12 * (index === 0 ? 0 : 1);
        this.addProjectile(
          "grape",
          {
            x: from.x + (side.x * Math.cos(angle) + up.x * Math.sin(angle)) * offset,
            y: from.y + (side.y * Math.cos(angle) + up.y * Math.sin(angle)) * offset,
            z: from.z + (side.z * Math.cos(angle) + up.z * Math.sin(angle)) * offset,
          },
          { x: dir.x * speed, y: dir.y * speed, z: dir.z * speed },
          0.085,
          2.6,
        );
      }
    } else {
      const forward = normalise(velocity);
      const side = normalise({ x: -forward.z, y: 0, z: forward.x });
      const spin = CHAIN_SPIN;
      const a = this.addProjectile(
        "chain",
        { x: from.x + side.x * CHAIN_SPREAD, y: from.y, z: from.z + side.z * CHAIN_SPREAD },
        { x: velocity.x + forward.x * spin, y: velocity.y + forward.y * spin, z: velocity.z + forward.z * spin },
        0.17,
        14,
      );
      const b = this.addProjectile(
        "chain",
        { x: from.x - side.x * CHAIN_SPREAD, y: from.y, z: from.z - side.z * CHAIN_SPREAD },
        { x: velocity.x - forward.x * spin, y: velocity.y - forward.y * spin, z: velocity.z - forward.z * spin },
        0.17,
        14,
      );
      this.world.createImpulseJoint(RAPIER.JointData.rope(CHAIN_LENGTH, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }), a.body, b.body, true);
      a.view.link = b.view.id;
      b.view.link = a.view.id;
    }
    this.ammo[kind as StockKind] -= 1;
    this.stats.shots += 1;
    this.releasedAt = undefined;
    this.phase = "flight";
    this.reload = 1.25;
    this.lastShotAt = this.time;
    this.settledFor = 0;
    this.events.push({ type: "fire", ammo: kind, from, velocity });
    // That rack's empty: on to the next one along the tray with shot in it (nothing left, stay put).
    if (this.ammo[kind as StockKind] <= 0) {
      const next = this.nextStocked(kind as StockKind);
      if (next) {
        this.selected = next;
        this.lastStock = next;
      }
    }
    return true;
  }

  /** The next rack along the tray (to the right, then round to the first again) with shot in it. */
  private nextStocked(from: StockKind): StockKind | undefined {
    const start = STOCK.indexOf(from);
    for (let step = 1; step <= STOCK.length; step += 1) {
      const kind = STOCK[(start + step) % STOCK.length]!;
      if (this.ammo[kind] > 0) return kind;
    }
    return undefined;
  }

  private fireBlunderbuss(from: Vec3, velocity: Vec3): void {
    const forward = normalise(velocity);
    const side = normalise({ x: -forward.z, y: 0, z: forward.x });
    const up = cross(side, forward);
    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2 + this.rng() * 0.8;
      const spread = index === 0 ? 0 : 0.05 + this.rng() * 0.05;
      const speed = lengthOf(velocity) * (0.92 + this.rng() * 0.12);
      const dir = normalise({
        x: forward.x + (side.x * Math.cos(angle) + up.x * Math.sin(angle)) * spread,
        y: forward.y + (side.y * Math.cos(angle) + up.y * Math.sin(angle)) * spread,
        z: forward.z + (side.z * Math.cos(angle) + up.z * Math.sin(angle)) * spread,
      });
      const pellet = this.addProjectile("pellet", from, { x: dir.x * speed, y: dir.y * speed, z: dir.z * speed }, 0.07, 1.2, "blunderbuss");
      pellet.expires = this.time + 0.9;
    }
    this.blunderReload = 0.8;
    this.events.push({ type: "fire", ammo: "blunderbuss", from, velocity });
  }

  // ---------------------------------------------------------------- stepping

  step(): void {
    for (const entity of this.entities.values()) {
      const view = entity.view;
      view.prevPosition.x = view.position.x;
      view.prevPosition.y = view.position.y;
      view.prevPosition.z = view.position.z;
      view.prevRotation.x = view.rotation.x;
      view.prevRotation.y = view.rotation.y;
      view.prevRotation.z = view.rotation.z;
      view.prevRotation.w = view.rotation.w;
    }
    this.updateSwarm();
    this.updateCrews();
    this.updateTurntable();
    this.updateMachines();
    this.updateRat();
    this.updateHoist();
    this.blow();
    if (this.humpty) {
      const v = this.humpty.body.linvel();
      this.humptyVelocity = { x: v.x, y: v.y, z: v.z };
    }
    this.world.step(this.queue);
    this.time += STEP;
    this.steps += 1;
    this.handleCollisions();
    this.wakeSupported();
    this.handleForces();
    this.handleExplosions();
    this.cutRopes();
    this.sweepChains();
    this.dropBuckets();
    this.syncViews();
    this.checkPeels();
    this.updateHumpty();
    this.cleanUp();
    if (Math.round(this.time / STEP) % 6 === 0) this.tallyWreckage();
    this.updatePhase();
  }

  // ---------------------------------------------------------------- building

  private register(kind: BodyKind, material: string, size: Vec3, body: RAPIER.RigidBody, colliders: RAPIER.Collider[], extra: Partial<Entity> = {}): Entity {
    const translation = body.translation();
    const rotation = body.rotation();
    const view: BodyView = {
      id: this.nextId++,
      kind,
      material,
      size,
      position: { x: translation.x, y: translation.y, z: translation.z },
      rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
      prevPosition: { x: translation.x, y: translation.y, z: translation.z },
      prevRotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
      removed: false,
    };
    const entity: Entity = {
      view,
      body,
      colliders,
      mass: body.mass(),
      softness: 1,
      born: this.time,
      restFor: 0,
      structural: false,
      ...extra,
    };
    this.entities.set(view.id, entity);
    for (const collider of colliders) this.byCollider.set(collider.handle, entity);
    return entity;
  }

  private remove(entity: Entity): void {
    if (entity.view.removed) return;
    entity.view.removed = true;
    for (const collider of entity.colliders) this.byCollider.delete(collider.handle);
    this.world.removeRigidBody(entity.body);
    this.entities.delete(entity.view.id);
  }

  private buildStage(): void {
    const fixed = (x: number, y: number, z: number, hx: number, hy: number, hz: number, kind: BodyKind = "ground"): void => {
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, hy, hz).setFriction(0.9).setRestitution(0.05).setCollisionGroups(GROUPS.static),
        body,
      );
      this.byCollider.set(collider.handle, {
        view: {
          id: 0,
          kind,
          material: "stage",
          size: { x: hx * 2, y: hy * 2, z: hz * 2 },
          position: { x, y, z },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          prevPosition: { x, y, z },
          prevRotation: { x: 0, y: 0, z: 0, w: 1 },
          removed: false,
        },
        body,
        colliders: [collider],
        mass: Infinity,
        softness: 1,
        born: 0,
        restFor: 0,
        structural: false,
      });
    };
    const width = STAGE.maxX - STAGE.minX;
    const depth = STAGE.maxZ - STAGE.minZ;
    const cx = (STAGE.maxX + STAGE.minX) / 2;
    const cz = (STAGE.maxZ + STAGE.minZ) / 2;
    fixed(cx, -0.5, cz, width / 2 + 1, 0.5, depth / 2 + 1);
    fixed(cx, 6, STAGE.minZ - 0.25, width / 2 + 1, 6, 0.25);
    fixed(STAGE.minX - 0.25, 6, cz, 0.25, 6, depth / 2 + 1);
    fixed(STAGE.maxX + 0.25, 6, cz, 0.25, 6, depth / 2 + 1);
    fixed(cx, 0.22, STAGE.maxZ + 0.2, width / 2 + 1, 0.22, 0.2);
    for (const curio of CURIOS) this.addCurio(curio.id, curio.at, curio.size);
  }

  /** Nursery-rhyme curios in the scenery: sensors that only projectiles can trigger. */
  private addCurio(id: CurioId, at: Vec3, size: Vec3): void {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(at.x, at.y, at.z));
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
        .setSensor(true)
        .setCollisionGroups(groups(G.STATIC, G.PROJ))
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    this.curios.set(collider.handle, { id, at, last: -10, scored: false });
  }

  private addFixture(def: FixtureDef): Entity {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(def.pos.x, def.pos.y, def.pos.z).setRotation(yawQuat(def.yaw)),
    );
    if (def.look === "maypole") return this.register("fixture", def.look, { ...def.size }, body, this.maypoleColliders(body, def.size.y), { look: def.look });
    const round = def.look === "drum" || def.look === "column" || def.look === "stump";
    let desc = round
      ? RAPIER.ColliderDesc.cylinder(def.size.y / 2, def.size.x / 2)
      : RAPIER.ColliderDesc.cuboid(def.size.x / 2, def.size.y / 2, def.size.z / 2);
    desc = desc
      .setFriction(def.look === "hedge" ? 1.1 : 0.7)
      .setRestitution(def.bounce ?? 0.05)
      .setCollisionGroups(GROUPS.static);
    if (def.cue !== undefined || def.spring !== undefined) desc = desc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    if (def.bounce !== undefined) {
      // Polished bronze: a clean mirror bounce, so the preview arc tells the truth.
      desc = desc
        .setFriction(0)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    }
    const collider = this.world.createCollider(desc, body);
    return this.register("fixture", def.look, { ...def.size }, body, [collider], {
      look: def.look,
      ...(def.bounce !== undefined ? { bounce: def.bounce } : {}),
      ...(def.cue !== undefined ? { cue: def.cue } : {}),
      ...(def.spring !== undefined ? { spring: def.spring } : {}),
      softness: def.soft ?? 1,
    });
  }

  // ---------------------------------------------------------------- machines

  private addVane(def: VaneDef): void {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(def.pos.x, def.pos.y, def.pos.z).setRotation(yawQuat(def.angle)),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(def.width / 2, def.height / 2, 0.08)
        .setFriction(0)
        .setRestitution(0.92)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
        .setCollisionGroups(GROUPS.static)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    const entity = this.register("fixture", "vane", { x: def.width, y: def.height, z: 0.16 }, body, [collider], { look: "vane", bounce: 0.92 });
    this.vanes.push({ entity, angle: def.angle, target: def.angle, step: def.step });
  }

  /** Struck: the weathercock swings a step further round (unless it is already swinging). */
  private turnVane(entity: Entity): void {
    const vane = this.vanes.find((item) => item.entity === entity);
    if (!vane || vane.angle !== vane.target) return;
    vane.target += vane.step;
    this.vaneTurns += 1;
    this.events.push({ type: "turn", at: { ...entity.view.position } });
  }

  /** A trough of boards on a fixed frame, and a three-sided hopper over its top end. */
  private addChute(def: ChuteDef): void {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const board = (desc: RAPIER.ColliderDesc, at: Vec3, rotation: Quat): void => {
      this.world.createCollider(
        desc
          .setTranslation(at.x, at.y, at.z)
          .setRotation(rotation)
          // Slick and dead: a bomb drops in without bouncing out, and slides down smartly. A barrel
          // ramp keeps some grip, so its barrel rolls.
          .setFriction(def.slick === false ? 0.6 : 0)
          .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
          .setRestitution(0)
          .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
          .setCollisionGroups(GROUPS.static),
        body,
      );
    };
    const half = def.width / 2;
    for (let index = 0; index + 1 < def.path.length; index += 1) {
      const a = def.path[index]!;
      const b = def.path[index + 1]!;
      const frame = troughFrame(a, b);
      const long = frame.length / 2 + 0.06;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
      board(RAPIER.ColliderDesc.cuboid(half, 0.04, long), add(mid, scale(frame.up, -0.04)), frame.rotation);
      for (const side of [-1, 1]) {
        board(RAPIER.ColliderDesc.cuboid(0.04, 0.2, long), add(add(mid, scale(frame.across, side * (half + 0.04))), scale(frame.up, 0.16)), frame.rotation);
      }
    }
    if (def.hopper === false) return;
    // The hopper: a low near side, a tall far side and a back, the downhill end left open.
    for (const plank of hopperBoards(def.path, def.width)) board(RAPIER.ColliderDesc.cuboid(plank.size.x / 2, plank.size.y / 2, plank.size.z / 2), plank.center, plank.rotation);
    const lift = hopperFrame(def.path).mouth;
    const mouth = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(half + 0.3, 0.3, half + 0.3)
        .setTranslation(lift.x, lift.y, lift.z)
        .setSensor(true)
        .setCollisionGroups(groups(G.STATIC, G.PROJ))
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    this.hoppers.set(mouth.handle, { scored: false });
  }

  private addCarousel(def: CarouselDef): void {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(def.pos.x, def.y, def.pos.z).setRotation(yawQuat(def.angle)),
    );
    const reach = (def.inner + def.outer) / 2;
    const colliders: RAPIER.Collider[] = [];
    for (let index = 0; index < def.paddles; index += 1) {
      const turn = (index / def.paddles) * Math.PI * 2;
      colliders.push(this.world.createCollider(
        // Rounded edges: a shot catching a paddle's tip glances off predictably, not at random.
        RAPIER.ColliderDesc.roundCuboid((def.outer - def.inner) / 2 - PADDLE_THICK / 2, def.height / 2 - PADDLE_THICK / 2, 0.005, PADDLE_THICK / 2 - 0.005)
          .setTranslation(Math.cos(turn) * reach, 0, -Math.sin(turn) * reach)
          .setRotation(yawQuat(turn))
          .setFriction(0)
          .setRestitution(PADDLE_BOUNCE)
          .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
          .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
          .setCollisionGroups(GROUPS.static)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        body,
      ));
    }
    const entity = this.register("fixture", "carousel", { x: def.outer * 2, y: def.height, z: def.outer * 2 }, body, colliders, { look: "carousel", bounce: PADDLE_BOUNCE });
    this.carousel = { entity, def, angle: def.angle };
  }

  /**
   * A ring of floorboards (convex sectors round a hole) on a kinematic body. It turns about its
   * middle; whatever stands on it is carried round by friction, and the middle stays put.
   */
  private addRevolve(def: RevolveDef): void {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(def.pos.x, 0, def.pos.z));
    const sectors = 24;
    const colliders: RAPIER.Collider[] = [];
    for (let index = 0; index < sectors; index += 1) {
      const points: number[] = [];
      for (const a of [index / sectors, (index + 1) / sectors].map((k) => k * Math.PI * 2)) {
        for (const r of [def.inner, def.outer]) {
          // Deep below the boards (the ring never touches the fixed floor): a thin ring lets a falling
          // egg sink into it for a step or two, which softens the landing enough to save him.
          for (const y of [-0.6, REVOLVE_HEIGHT]) points.push(Math.cos(a) * r, y, -Math.sin(a) * r);
        }
      }
      const hull = RAPIER.ColliderDesc.convexHull(new Float32Array(points));
      if (!hull) throw new Error("A sector of the revolve failed to form a convex hull.");
      colliders.push(this.world.createCollider(hull.setFriction(1).setRestitution(0.05).setCollisionGroups(GROUPS.static), body));
    }
    const entity = this.register("fixture", "revolve", { x: def.outer * 2, y: REVOLVE_HEIGHT, z: def.outer * 2 }, body, colliders, { look: "revolve" });
    this.revolve = { entity, def, angle: 0, startedAt: undefined };
  }

  /** The capstan is struck: the revolve begins another half turn, unless it's turning already. */
  private startRevolve(): boolean {
    const revolve = this.revolve;
    if (!revolve || revolve.startedAt !== undefined) return false;
    revolve.startedAt = this.time;
    // Everything asleep on the boards must be awake to ride round (or it's left hanging in the air).
    for (const body of this.world.bodies.getAll()) if (body.isDynamic()) body.wakeUp();
    return true;
  }

  /**
   * Hay and masonry riding the ring go round with it: turn the places they started from by as
   * much, so a ride isn't billed as wreckage. Only a shot or a blast that moves them counts.
   */
  private carryRound(def: RevolveDef, turn: number): void {
    if (turn === 0) return;
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    for (const start of this.startPositions.values()) {
      const dx = start.x - def.pos.x;
      const dz = start.z - def.pos.z;
      const r = Math.hypot(dx, dz);
      if (r < def.inner || r > def.outer || start.y > 3) continue;
      // Turning by `turn` about +y: x' = x cos + z sin, z' = -x sin + z cos.
      start.x = def.pos.x + dx * c + dz * s;
      start.z = def.pos.z - dx * s + dz * c;
    }
  }

  /** Is the revolve turning? */
  get revolving(): boolean {
    return this.revolve?.startedAt !== undefined;
  }

  private addGate(def: GateDef): void {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(def.pos.x, def.height / 2, def.pos.z).setRotation(yawQuat(def.yaw)),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(def.width / 2, def.height / 2, 0.1).setFriction(0.6).setRestitution(0.1).setCollisionGroups(GROUPS.static),
      body,
    );
    const entity = this.register("fixture", "portcullis", { x: def.width, y: def.height, z: 0.2 }, body, [collider], { look: "portcullis" });
    this.gate = { entity, def, openedAt: -99 };
  }

  /** How far the portcullis is wound up, 0 (down) to 1 (right up). */
  private gateLift(): number {
    const gate = this.gate;
    if (!gate) return 0;
    const t = this.time - gate.openedAt;
    if (t < 0 || t > GATE_RISE + GATE_TIME + GATE_FALL) return 0;
    if (t < GATE_RISE) return 1 - (1 - t / GATE_RISE) ** 2;
    if (t < GATE_RISE + GATE_TIME) return 1;
    return 1 - (t - GATE_RISE - GATE_TIME) / GATE_FALL;
  }

  /** A painted dresser (fixed), with each piece of china on it a sensor a shot can smash. */
  private addDresser(def: DresserDef): void {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(def.pos.x, def.pos.y, def.pos.z).setRotation(yawQuat(def.yaw)),
    );
    const { width, height, base, depth, rack } = DRESSER;
    const wood = (hx: number, hy: number, hz: number, x: number, y: number, z: number): RAPIER.Collider =>
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(0.6).setCollisionGroups(GROUPS.static), body);
    const colliders = [
      wood(width / 2, base / 2, depth / 2, 0, base / 2, 0),
      wood(width / 2, (height - base) / 2, 0.03, 0, (base + height) / 2, -depth / 2 + 0.03),
      wood(0.03, (height - base) / 2, rack / 2, -width / 2 + 0.03, (base + height) / 2, -depth / 2 + rack / 2),
      wood(0.03, (height - base) / 2, rack / 2, width / 2 - 0.03, (base + height) / 2, -depth / 2 + rack / 2),
      ...DRESSER.shelves.map((y) => wood(width / 2, 0.02, rack / 2, 0, y, -depth / 2 + rack / 2)),
      wood(width / 2 + 0.05, 0.06, rack / 2 + 0.03, 0, height - 0.06, -depth / 2 + rack / 2),
    ];
    this.register("fixture", "dresser", { x: width, y: height, z: depth }, body, colliders, { look: "dresser" });
    for (const china of dresserChina()) {
      const sensor = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(china.size.x / 2, china.size.y / 2, china.size.z / 2)
          .setTranslation(china.local.x, china.local.y, china.local.z)
          .setSensor(true)
          .setCollisionGroups(groups(G.STATIC, G.PROJ))
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        body,
      );
      const at = add(def.pos, rotate(yawQuat(def.yaw), china.local));
      this.china.set(sensor.handle, { kind: china.kind, row: china.row, at, local: china.local, broken: false, shock: 0 });
    }
  }

  /** Smash! A piece struck square rattles the ones either side of it off the shelf after it. */
  private smashChina(piece: ChinaPiece, shock = 1): void {
    if (piece.broken) return;
    piece.broken = true;
    this.events.push({ type: "smash", at: { ...piece.at }, piece: piece.kind });
    this.score("china", piece.at);
    if (shock > 0) {
      for (const other of this.china.values()) {
        if (other.broken || other.breakAt !== undefined || other.row !== piece.row) continue;
        const gap = Math.abs(other.local.x - piece.local.x);
        if (gap < 0.6) {
          other.breakAt = this.time + 0.12 + gap * 0.2;
          other.shock = shock - 1;
        }
      }
    }
    if (!this.dishRan && this.log.length) {
      // Hey diddle diddle: and the dish ran away with the spoon.
      this.dishRan = true;
      this.events.push({ type: "dish", at: { ...piece.at }, toward: piece.at.x < 0 ? -1 : 1 });
    }
  }

  /** The King's china, in the order `dresserChina` lays it out: where each piece is, and whether it's whole. */
  get chinaView(): Array<{ at: Vec3; whole: boolean }> {
    return [...this.china.values()].map((piece) => ({ at: piece.at, whole: !piece.broken }));
  }

  /** The chock is knocked out from under a barrel: away it goes, and the barrel with it. */
  private knockChock(chock: Entity): void {
    const at = { ...chock.view.position };
    this.remove(chock);
    for (const entity of this.entities.values()) {
      if (entity.rollFuse !== undefined && distance(entity.view.position, at) < 2) entity.body.wakeUp();
    }
  }

  /** The counterweight is struck: up goes the portcullis. Not while it is still up or coming down. */
  private raiseGate(): boolean {
    if (!this.gate || this.gateLift() > 0) return false;
    this.gate.openedAt = this.time;
    return true;
  }

  get gateView(): { lift: number; left: number } | undefined {
    if (!this.gate) return undefined;
    return { lift: this.gateLift(), left: Math.max(0, this.gate.openedAt + GATE_RISE + GATE_TIME - this.time) };
  }

  /** The machines that turn on their own: struck weathercocks, the carousel, the portcullis. */
  private updateMachines(): void {
    // The revolve: eased in and out, so what rides on it isn't flung off.
    const revolve = this.revolve;
    if (revolve && revolve.startedAt !== undefined) {
      const u = Math.min(1, (this.time + STEP - revolve.startedAt) / revolve.def.time);
      const angle = revolve.angle + revolve.def.turn * u * u * (3 - 2 * u);
      this.carryRound(revolve.def, angle - (revolve.previous ?? revolve.angle));
      revolve.previous = angle;
      revolve.entity.body.setNextKinematicRotation(yawQuat(angle));
      if (u >= 1) {
        revolve.angle += revolve.def.turn;
        revolve.previous = undefined;
        revolve.startedAt = undefined;
        this.events.push({ type: "revolved", at: { ...revolve.def.pos } });
      }
    }
    // China rattled off its shelf by a neighbour's smash.
    for (const piece of this.china.values()) if (!piece.broken && piece.breakAt !== undefined && this.time >= piece.breakAt) this.smashChina(piece, piece.shock);
    // A barrel off its chock: once it's rolling, its fuse is lit.
    for (const entity of this.entities.values()) {
      if (entity.rollFuse === undefined || entity.fuseAt !== undefined || entity.body.isSleeping()) continue;
      if (lengthOf(entity.body.linvel()) > 1) entity.fuseAt = this.time + entity.rollFuse;
    }
    for (const entity of this.entities.values()) {
      if (entity.rollFuse !== undefined && entity.fuseAt !== undefined) entity.view.fuse = Math.max(0, entity.fuseAt - this.time);
    }
    for (const vane of this.vanes) {
      if (vane.angle === vane.target) continue;
      const left = vane.target - vane.angle;
      vane.angle = Math.abs(left) <= VANE_TURN * STEP ? vane.target : vane.angle + Math.sign(left) * VANE_TURN * STEP;
      vane.entity.body.setNextKinematicRotation(yawQuat(vane.angle));
    }
    const carousel = this.carousel;
    if (carousel) {
      carousel.angle += carousel.def.speed * STEP;
      carousel.entity.body.setNextKinematicRotation(yawQuat(carousel.angle));
    }
    const gate = this.gate;
    if (gate) {
      const y = gate.def.height / 2 + this.gateLift() * (gate.def.height - 0.3);
      gate.entity.body.setNextKinematicTranslation({ x: gate.def.pos.x, y, z: gate.def.pos.z });
    }
  }

  private addTurntable(def: TurntableDef): void {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(def.pos.x, def.pos.y, def.pos.z).setRotation(yawQuat(def.angle)),
    );
    const colliders = [
      RAPIER.ColliderDesc.cylinder(0.08, def.radius).setTranslation(0, -0.08, 0),
      RAPIER.ColliderDesc.cuboid(def.arm / 2, 0.06, 0.13).setTranslation(def.arm / 2, 0.06, 0),
      RAPIER.ColliderDesc.cuboid(0.46, 0.05, 0.46).setTranslation(def.arm, TURNTABLE_SEAT - 0.05, 0),
      // A low gilt rail round the outside of the seat stops him creeping off as it turns;
      // any shot still knocks him clean over it.
      RAPIER.ColliderDesc.cuboid(0.03, TURNTABLE_RAIL / 2, 0.46).setTranslation(def.arm + 0.43, TURNTABLE_SEAT + TURNTABLE_RAIL / 2, 0),
      RAPIER.ColliderDesc.cuboid(0.46, TURNTABLE_RAIL / 2, 0.03).setTranslation(def.arm, TURNTABLE_SEAT + TURNTABLE_RAIL / 2, 0.43),
      RAPIER.ColliderDesc.cuboid(0.46, TURNTABLE_RAIL / 2, 0.03).setTranslation(def.arm, TURNTABLE_SEAT + TURNTABLE_RAIL / 2, -0.43),
      RAPIER.ColliderDesc.cuboid(0.3, 0.14, 0.3).setTranslation(-def.arm * 0.55, 0.14, 0),
    ].map((desc) => this.world.createCollider(
      desc.setFriction(0.95).setCollisionGroups(GROUPS.block).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    ));
    const entity = this.register("turntable", "clockwork", { x: def.radius * 2, y: 0.16, z: def.radius * 2 }, body, colliders);
    this.turntable = { entity, def, angle: def.angle, omega: def.speed };
  }

  private updateTurntable(): void {
    const turntable = this.turntable;
    if (!turntable) return;
    // Clockwork: shots can spin it, but the spring always pulls it back to its own pace.
    turntable.omega += (turntable.def.speed - turntable.omega) * Math.min(1, STEP * 0.6);
    turntable.angle += turntable.omega * STEP;
    turntable.entity.body.setNextKinematicRotation(yawQuat(turntable.angle));
  }

  /** Where the turntable seat's top is right now. */
  private turntableSeat(): Vec3 | undefined {
    const turntable = this.turntable;
    if (!turntable) return undefined;
    const { def, angle } = turntable;
    return {
      x: def.pos.x + Math.cos(angle) * def.arm,
      y: def.pos.y + TURNTABLE_SEAT,
      z: def.pos.z - Math.sin(angle) * def.arm,
    };
  }

  private kickTurntable(projectile: Entity): void {
    const turntable = this.turntable;
    const v = projectile.lastVelocity;
    if (!turntable || !v) return;
    if (projectile.ammo !== "blunderbuss") this.spins += 1;
    const p = projectile.body.translation();
    const rx = p.x - turntable.def.pos.x;
    const rz = p.z - turntable.def.pos.z;
    // Angular momentum about +y handed to the disc (yaw grows counter-clockwise seen from above).
    const torque = (rz * v.x - rx * v.z) * projectile.mass * 0.6;
    turntable.omega = Math.max(-3.5, Math.min(3.5, turntable.omega + torque / 140));
    this.events.push({ type: "spin", at: { x: p.x, y: p.y, z: p.z }, speed: turntable.omega });
  }

  /** Rock-a-bye: a deep wooden cradle on two lines from a bough, free to swing side to side. */
  private addCradle(def: SwingDef, fixtures: Entity[]): void {
    const bough = fixtures.find((fixture) => fixture.look === "bough" && Math.abs(fixture.view.position.x - def.pos.x) < fixture.view.size.x / 2 + 0.1 && Math.abs(fixture.view.position.z - def.pos.z) < 0.5);
    if (!bough) throw new Error("A cradle needs a bough fixture above it.");
    // Roomy enough for an egg a metre across, so he sits in it rather than being wedged.
    const depth = 1.3;
    const width = Math.max(def.width, 1.3);
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(def.pos.x, def.pos.y, def.pos.z)
        .setLinearDamping(0.12)
        .setAngularDamping(0.9)
        .setCcdEnabled(true),
    );
    const wood = (desc: RAPIER.ColliderDesc): RAPIER.Collider =>
      this.world.createCollider(desc.setDensity(500).setFriction(0.9).setCollisionGroups(GROUPS.block), body);
    // A blanket-lined basket with low sides: soft to land in, but a big enough swing throws him out.
    const side = CRADLE_SIDE;
    const colliders = [
      wood(RAPIER.ColliderDesc.cuboid(width / 2, 0.06, depth / 2).setTranslation(0, -0.06, 0)),
      wood(RAPIER.ColliderDesc.cuboid(width / 2, side / 2, 0.05).setTranslation(0, side / 2, -depth / 2 + 0.05)),
      wood(RAPIER.ColliderDesc.cuboid(width / 2, side / 2, 0.05).setTranslation(0, side / 2, depth / 2 - 0.05)),
      wood(RAPIER.ColliderDesc.cuboid(0.05, side / 2, depth / 2).setTranslation(-width / 2 + 0.05, side / 2, 0)),
      wood(RAPIER.ColliderDesc.cuboid(0.05, side / 2, depth / 2).setTranslation(width / 2 - 0.05, side / 2, 0)),
    ];
    const seat = this.register("block", "cradle", { x: width, y: 0.12, z: depth }, body, colliders, { structural: true, windy: true, softness: 0.7 });
    this.swing = { seat, def };
    const boughAt = bough.view.position;
    for (const lz of [-depth / 2 + 0.08, depth / 2 - 0.08]) {
      const top = { x: def.pos.x, y: def.beam - bough.view.size.y / 2, z: def.pos.z + lz };
      const local = { x: 0, y: CRADLE_SIDE + 0.3, z: lz };
      const joint = this.world.createImpulseJoint(
        RAPIER.JointData.rope(top.y - def.pos.y - local.y, { x: top.x - boughAt.x, y: top.y - boughAt.y, z: top.z - boughAt.z }, local),
        bough.body,
        body,
        true,
      );
      this.ropes.push({ joint, seat, local, top, cut: false });
    }
  }

  private addSwing(def: SwingDef, fixtures: Entity[]): void {
    if (def.cradle) {
      this.addCradle(def, fixtures);
      return;
    }
    const beam = fixtures.find((fixture) => fixture.look === "beam" && Math.abs(fixture.view.position.x - def.pos.x) < 0.5 && Math.abs(fixture.view.position.z - def.pos.z) < 0.5);
    if (!beam) throw new Error("A swing needs a beam fixture above it.");
    const depth = 0.85;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(def.pos.x, def.pos.y, def.pos.z)
        .setLinearDamping(0.7)
        .setAngularDamping(1.5)
        .setCcdEnabled(true),
    );
    // A heavy, iron-shod royal seat: round shot rocks it; only cutting rope really gets him out.
    const wood = (desc: RAPIER.ColliderDesc): RAPIER.Collider =>
      this.world.createCollider(desc.setDensity(1500).setFriction(0.9).setCollisionGroups(GROUPS.block), body);
    const colliders = [
      wood(RAPIER.ColliderDesc.cuboid(def.width / 2, 0.06, depth / 2).setTranslation(0, -0.06, 0)),
      wood(RAPIER.ColliderDesc.cuboid(def.width / 2, 0.42, 0.05).setTranslation(0, 0.42, -depth / 2 + 0.05)),
      wood(RAPIER.ColliderDesc.cuboid(0.05, 0.3, depth / 2).setTranslation(-def.width / 2 + 0.05, 0.3, 0)),
      wood(RAPIER.ColliderDesc.cuboid(0.05, 0.3, depth / 2).setTranslation(def.width / 2 - 0.05, 0.3, 0)),
    ];
    const seat = this.register("block", "seat", { x: def.width, y: 0.12, z: depth }, body, colliders, { structural: true });
    this.swing = { seat, def };
    const beamAt = beam.view.position;
    for (const lx of [-def.width / 2 + 0.05, def.width / 2 - 0.05]) {
      for (const lz of [-depth / 2 + 0.05, depth / 2 - 0.05]) {
        const top = { x: def.pos.x + lx, y: def.beam - beam.view.size.y / 2, z: def.pos.z + lz };
        const local = { x: lx, y: 0, z: lz };
        const joint = this.world.createImpulseJoint(
          RAPIER.JointData.rope(top.y - def.pos.y, { x: top.x - beamAt.x, y: top.y - beamAt.y, z: top.z - beamAt.z }, local),
          beam.body,
          body,
          true,
        );
        this.ropes.push({ joint, seat, local, top, cut: false });
      }
    }
  }

  private ropeBottom(rope: { seat: Entity; local: Vec3 }): Vec3 {
    const t = rope.seat.body.translation();
    return add(t, rotate(rope.seat.body.rotation(), rope.local));
  }

  /** Rope is tough: only chain shot, balls and links scything round, cuts it. */
  private cutRopes(): void {
    if (!this.ropes.length) return;
    const shots = [...this.entities.values()].filter((entity) => entity.ammo === "chain");
    for (const rope of this.ropes) {
      // Whatever hung on it may have been swept off the stage entirely.
      if (rope.seat.view.removed) rope.cut = true;
      if (rope.cut) continue;
      const bottom = this.ropeBottom(rope);
      let cutter: Entity | undefined;
      for (const shot of shots) {
        const p = shot.body.translation();
        if (distanceToSegment(p, rope.top, bottom) < shot.view.size.x / 2 + 0.12) cutter = shot;
        const partner = shot.view.link !== undefined ? this.entities.get(shot.view.link) : undefined;
        if (partner && segmentDistance(p, partner.body.translation(), rope.top, bottom) < 0.25) cutter = shot;
        if (cutter) break;
      }
      if (!cutter) continue;
      rope.cut = true;
      this.world.removeImpulseJoint(rope.joint, true);
      rope.seat.body.wakeUp();
      const p = cutter.body.translation();
      this.events.push({ type: "rope-cut", at: { x: p.x, y: p.y, z: p.z }, by: cutter.ammo ?? "shot" });
      this.score("rope", { x: p.x, y: p.y, z: p.z });
    }
  }

  /**
   * The chain between two balls is a blade. Whatever it sweeps through takes a blow across
   * its path; a thin column loses a block and the chain flies on. Heavy stone stops it.
   */
  private sweepChains(): void {
    const blows: Array<{ chain: [Entity, Entity]; target: Entity; at: Vec3; impulse: Vec3; spent: number }> = [];
    for (const a of [...this.entities.values()]) {
      if (a.ammo !== "chain" || a.view.link === undefined || a.view.id > a.view.link) continue;
      const b = this.entities.get(a.view.link);
      if (!b) continue;
      const pa = a.body.translation();
      const pb = b.body.translation();
      const gap = distance(pa, pb);
      const va = a.body.linvel();
      const vb = b.body.linvel();
      const along = { x: (pb.x - pa.x) / gap, y: (pb.y - pa.y) / gap, z: (pb.z - pa.z) / gap };
      const half = gap / 2 - a.view.size.x / 2 - 0.06;
      if (half < 0.1 || Math.hypot((va.x + vb.x) / 2, (va.y + vb.y) / 2, (va.z + vb.z) / 2) < 5) continue;
      const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2, z: (pa.z + pb.z) / 2 };
      const found: Entity[] = [];
      this.world.intersectionsWithShape(mid, yAxisTo(along), new RAPIER.Capsule(half, 0.08), (collider) => {
        const owner = this.byCollider.get(collider.handle);
        const cuttable = owner?.look === "maypole";
        if (owner && !owner.ammo && (owner.body.isDynamic() || cuttable) && !found.includes(owner)) found.push(owner);
        return true;
      }, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(G.PROJ, G.BLOCK | G.HUMPTY | G.STATIC));
      a.struck ??= new Map();
      for (let target of found) {
        if (this.time - (a.struck.get(target.view.id) ?? -10) < 0.35) continue;
        let loose = false;
        if (target.look === "maypole") {
          // Chain shot cuts a maypole: the top comes loose and takes the blow.
          const { point } = closestOnSegment(target.body.translation(), pa, pb);
          const top = this.cutMaypole(target, point.y);
          a.struck.set(target.view.id, this.time);
          if (!top) continue;
          target = top;
          loose = true;
          a.struck.set(target.view.id, this.time);
        }
        const centre = target.body.translation();
        const { point, t } = closestOnSegment(centre, pa, pb);
        const v = { x: va.x + (vb.x - va.x) * t, y: va.y + (vb.y - va.y) * t, z: va.z + (vb.z - va.z) * t };
        const tv = target.body.linvel();
        const rel = { x: v.x - tv.x, y: v.y - tv.y, z: v.z - tv.z };
        // A chain can only push across itself; sliding along it does nothing.
        const slide = rel.x * along.x + rel.y * along.y + rel.z * along.z;
        const push = { x: rel.x - along.x * slide, y: rel.y - along.y * slide, z: rel.z - along.z * slide };
        const speed = lengthOf(push);
        if (speed < 3) continue;
        // A felled maypole only needs a nudge to topple; it takes little from the chain.
        const strength = loose ? MAYPOLE_NUDGE : Math.min(target.mass * 0.45 * speed, CHAIN_BLOW);
        const scale = strength / speed;
        // A cut top falls like a felled tree: pushed back at its crown, it topples over its stump.
        const at = loose ? { x: centre.x, y: centre.y + target.view.size.y / 2, z: centre.z } : point;
        blows.push({ chain: [a, b], target, at, impulse: { x: push.x * scale, y: push.y * scale, z: push.z * scale }, spent: strength });
        a.struck.set(target.view.id, this.time);
      }
    }
    for (const { chain, target, at, impulse, spent } of blows) {
      if (target.view.removed) continue;
      target.body.applyImpulseAtPoint(impulse, at, true);
      if (target === this.humpty) this.lastNearMiss = this.time;
      // Heavy things cost the chain its momentum: stone stops it, oak barely slows it.
      const mass = chain[0].mass + chain[1].mass;
      for (const ball of chain) {
        const v = ball.body.linvel();
        const keep = Math.max(0.15, 1 - (spent / Math.max(1, mass * lengthOf(v))) * (target.mass > 400 ? 1.4 : 0.55));
        ball.body.setLinvel({ x: v.x * keep, y: v.y * keep, z: v.z * keep }, true);
      }
      this.events.push({ type: "impact", at, strength: Math.min(1, spent / CHAIN_BLOW), material: target.view.material });
    }
  }

  private addBucket(pos: Vec3): void {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setCcdEnabled(true).setSleeping(true),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cylinder(BUCKET_SIZE.height / 2, BUCKET_SIZE.radius).setMass(4).setFriction(0.6).setRestitution(0.1).setCollisionGroups(GROUPS.block),
      body,
    );
    this.register("bucket", "paint", { x: BUCKET_SIZE.radius * 2, y: BUCKET_SIZE.height, z: BUCKET_SIZE.radius * 2 }, body, [collider]);
  }

  private addPeel(def: PeelDef): void {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(def.pos.x, def.pos.y, def.pos.z)
        .setRotation(yawQuat(def.yaw))
        .setLinearDamping(0.4)
        .setAngularDamping(1.5)
        .setCcdEnabled(true)
        .setSleeping(true),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(PEEL_SIZE.x / 2, PEEL_SIZE.y / 2, PEEL_SIZE.z / 2).setMass(0.6).setFriction(0.12).setRestitution(0.05).setCollisionGroups(GROUPS.block),
      body,
    );
    this.register("peel", "banana", { ...PEEL_SIZE }, body, [collider], { peel: { armed: false, spent: false } });
  }

  /**
   * A shot that catches a banana skin flicks it skidding along the boards the way the shot was
   * going, faster for a faster shot: far more predictable than a cannonball's real blow to
   * something so light, which would send it clean off the stage.
   */
  private flickPeel(peel: Entity, shot: Entity): void {
    peel.peel!.armed = true;
    this.flick(peel, peel.peel!, shot, PEEL_KICK, 0.35);
  }

  /**
   * Flick something light along the boards the way the shot was going, at a speed set by the
   * shot's (once per shot, however it tumbles after); the ball rolls on past it for a moment
   * rather than catching it up and shoving it again.
   */
  private flick(entity: Entity, state: { flickedBy?: number; ghostUntil?: number }, shot: Entity, most: number, share: number): void {
    if (state.flickedBy === shot.view.id) return;
    state.flickedBy = shot.view.id;
    const v = shot.lastVelocity ?? shot.body.linvel();
    const flat = Math.hypot(v.x, v.z);
    if (flat < 1) return;
    const kick = Math.min(most, flat * share);
    entity.body.setLinvel({ x: (v.x / flat) * kick, y: 1.2, z: (v.z / flat) * kick }, true);
    entity.body.setAngvel({ x: 0, y: 5, z: 0 }, true);
    for (const collider of entity.colliders) collider.setCollisionGroups(groups(G.BLOCK, ALL & ~G.PROJ));
    state.ghostUntil = this.time + 0.6;
  }

  private addMousetrap(def: MousetrapDef): void {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(def.pos.x, def.pos.y, def.pos.z)
        .setRotation(yawQuat(def.yaw))
        .setLinearDamping(1.2)
        .setAngularDamping(2)
        .setCcdEnabled(true)
        .setSleeping(true),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(MOUSETRAP_SIZE.x / 2, MOUSETRAP_SIZE.y / 2, MOUSETRAP_SIZE.z / 2).setMass(1.2).setFriction(0.5).setRestitution(0.05).setCollisionGroups(GROUPS.block),
      body,
    );
    this.register("mousetrap", "trap", { ...MOUSETRAP_SIZE }, body, [collider], { mousetrap: { armed: false, sprung: false } });
  }

  /** The cheese on a mousetrap the Queen has knocked out into the open, while it's still set. */
  private bait(): Entity | undefined {
    for (const entity of this.entities.values()) {
      if (entity.mousetrap?.armed && !entity.mousetrap.sprung && !entity.view.removed && entity.view.position.y < 0.4) return entity;
    }
    return undefined;
  }

  /**
   * A crew on the move that treads on a banana skin goes flat on its back. Only a skin the Queen
   * has sent skidding counts (one left where it lay never trips a patrol), and each trips once.
   */
  private checkPeels(): void {
    if (!this.log.length) return;
    for (const peel of this.entities.values()) {
      const flicked = peel.peel ?? peel.mousetrap;
      if (flicked?.ghostUntil !== undefined && this.time >= flicked.ghostUntil) {
        flicked.ghostUntil = undefined;
        for (const collider of peel.colliders) collider.setCollisionGroups(GROUPS.block);
      }
      const state = peel.peel;
      if (!state?.armed || state.spent || peel.view.removed || this.cracked) continue;
      const p = peel.view.position;
      // Still in the air: it has to land first.
      if (p.y > 0.25) continue;
      for (const crew of this.crews) {
        if (crew.speed < 0.6 || crew.mode === "stunned" || crew.mode === "recover" || crew.mode === "trapped") continue;
        // Anywhere underfoot: from the leading man (or horse) to the one at the back.
        const feet = crew.slots.flatMap((id) => {
          const foot = this.entities.get(id);
          return foot ? [foot.view.position] : [];
        });
        let trodden = false;
        for (const a of feet) {
          for (const b of feet) {
            const flatA = { x: a.x, y: 0, z: a.z };
            const flatB = { x: b.x, y: 0, z: b.z };
            if (distanceToSegment({ x: p.x, y: 0, z: p.z }, flatA, flatB) < 0.7) trodden = true;
          }
        }
        if (!trodden) continue;
        state.spent = true;
        this.stun(crew, { x: p.x, y: 0.3, z: p.z }, "slip");
        // Up goes the skin, end over end.
        peel.body.setLinvel({ x: Math.sin(crew.heading) * 1.2, y: 4.5, z: Math.cos(crew.heading) * 1.2 }, true);
        peel.body.setAngvel({ x: 9, y: 2, z: 4 }, true);
        break;
      }
    }
  }

  /** The hive is struck: out come the bees, unless they're out already. */
  private releaseSwarm(hive: Entity): boolean {
    if (this.swarm) return false;
    const home = { ...hive.view.position };
    this.swarm = { at: { ...home }, home, until: this.time + SWARM_TIME, target: undefined, since: this.time, stung: new Set() };
    return true;
  }

  /**
   * The swarm goes after the nearest crew that could catch him, and a fresh one every few seconds;
   * anyone it gets near is stung and runs for it. When their time is up the bees go home.
   */
  private updateSwarm(): void {
    const swarm = this.swarm;
    if (!swarm) return;
    const out = this.time < swarm.until && !this.cracked;
    let goal = swarm.home;
    if (out) {
      const quarry = (crew: CrewState): boolean =>
        CREW_SPECS[crew.kind].run > 0 && crew.mode !== "stunned" && crew.mode !== "recover" && crew.mode !== "trapped" && crew.mode !== "lunch";
      const current = this.crews.find((crew) => crew.id === swarm.target);
      if (!current || !quarry(current) || this.time - swarm.since > SWARM_SWITCH) {
        const others = this.crews.filter((crew) => quarry(crew) && (crew.id !== swarm.target || !current));
        const pool = others.length ? others : this.crews.filter(quarry);
        let best: CrewState | undefined;
        for (const crew of pool) {
          if (!best || Math.hypot(crew.x - swarm.at.x, crew.z - swarm.at.z) < Math.hypot(best.x - swarm.at.x, best.z - swarm.at.z)) best = crew;
        }
        swarm.target = best?.id;
        swarm.since = this.time;
      }
      const target = this.crews.find((crew) => crew.id === swarm.target);
      if (target) goal = { x: target.x, y: 1.7, z: target.z };
    }
    const dx = goal.x - swarm.at.x;
    const dy = goal.y - swarm.at.y;
    const dz = goal.z - swarm.at.z;
    const gap = Math.hypot(dx, dy, dz);
    if (gap > 1e-6) {
      const travel = Math.min(gap, SWARM_SPEED * STEP) / gap;
      swarm.at = { x: swarm.at.x + dx * travel, y: swarm.at.y + dy * travel, z: swarm.at.z + dz * travel };
    }
    if (!out) {
      if (gap < 0.2) this.swarm = undefined;
      return;
    }
    for (const crew of this.crews) {
      if (Math.hypot(crew.x - swarm.at.x, crew.z - swarm.at.z) > SWARM_REACH) continue;
      if (!sting(crew, this.time, swarm.at)) continue;
      const at = { x: crew.x, y: 1.6, z: crew.z };
      this.events.push({ type: "stung", at, crewId: crew.id });
      // Each crew goes on the bill once per swarm.
      if (!swarm.stung.has(crew.id)) {
        swarm.stung.add(crew.id);
        this.score("stung", at);
      }
    }
  }

  /** Where the bees are, while they're out (and on their way home). */
  get swarmView(): { at: Vec3; home: boolean } | undefined {
    const swarm = this.swarm;
    return swarm ? { at: { ...swarm.at }, home: this.time >= swarm.until || this.cracked } : undefined;
  }

  /** A flying paint pot that passes over a man's head ends up on it. */
  private dropBuckets(): void {
    const crowned: Array<{ bucket: Entity; crew: CrewState }> = [];
    for (const bucket of this.entities.values()) {
      if (bucket.view.kind !== "bucket" || bucket.body.isSleeping() || lengthOf(bucket.body.linvel()) < 1) continue;
      const p = bucket.view.position;
      for (const man of this.entities.values()) {
        const crew = man.crew;
        if (man.role !== "man" || !crew || crew.mode === "lunch" || this.time < crew.bucketUntil) continue;
        const head = man.view.position;
        if (Math.hypot(p.x - head.x, p.z - head.z) < 0.55 && p.y > head.y + 0.35 && p.y < head.y + 1.6) {
          crowned.push({ bucket, crew });
          break;
        }
      }
    }
    for (const { bucket, crew } of crowned) {
      if (bucket.view.removed) continue;
      crownWithBucket(crew, this.time);
      this.score("bucket", { ...bucket.view.position });
      this.remove(bucket);
    }
  }

  private addSandbag(def: SandbagDef): void {
    const anchor = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(def.pos.x, def.top, def.pos.z));
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(def.pos.x, def.pos.y, def.pos.z)
        .setLinearDamping(0.02)
        .setAngularDamping(0.4)
        .setCcdEnabled(true)
        .setSleeping(true),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cylinder(SANDBAG_SIZE.height / 2, SANDBAG_SIZE.radius).setMass(110).setFriction(0.7).setRestitution(0.05).setCollisionGroups(GROUPS.block),
      body,
    );
    const bag = this.register("sandbag", "canvas", { x: SANDBAG_SIZE.radius * 2, y: SANDBAG_SIZE.height, z: SANDBAG_SIZE.radius * 2 }, body, [collider]);
    const local = { x: 0, y: SANDBAG_SIZE.height / 2, z: 0 };
    const top = { x: def.pos.x, y: def.top, z: def.pos.z };
    const joint = this.world.createImpulseJoint(RAPIER.JointData.rope(def.top - def.pos.y - local.y, { x: 0, y: 0, z: 0 }, local), anchor, body, true);
    this.ropes.push({ joint, seat: bag, local, top, cut: false });
  }

  /** A maypole's shaft and crown, on a body centred at half its height. */
  private maypoleColliders(body: RAPIER.RigidBody, height: number): RAPIER.Collider[] {
    const shaft = height - MAYPOLE_CROWN.height;
    const dynamic = body.isDynamic();
    const make = (desc: RAPIER.ColliderDesc): RAPIER.Collider =>
      this.world.createCollider(
        (dynamic ? desc.setDensity(DENSITY.maypole!) : desc).setFriction(0.9).setRestitution(0.04).setCollisionGroups(dynamic ? GROUPS.block : GROUPS.static),
        body,
      );
    return [
      make(RAPIER.ColliderDesc.cylinder(shaft / 2, MAYPOLE_WIDTH / 2).setTranslation(0, -MAYPOLE_CROWN.height / 2, 0)),
      make(RAPIER.ColliderDesc.cylinder(MAYPOLE_CROWN.height / 2, MAYPOLE_CROWN.radius).setTranslation(0, height / 2 - MAYPOLE_CROWN.height / 2, 0)),
    ];
  }

  private addChest(def: ChestDef): void {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(def.pos.x, def.pos.y, def.pos.z).setRotation(yawQuat(def.yaw)),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(CHEST_SIZE.x / 2, CHEST_SIZE.y / 2, CHEST_SIZE.z / 2)
        .setFriction(0.8)
        .setRestitution(0.1)
        .setCollisionGroups(GROUPS.static)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    this.register("chest", "chest", { ...CHEST_SIZE }, body, [collider]);
  }

  /**
   * Forced open: three rounds go straight to the Queen's battery. The first replaces the shot that
   * opened it (a keg's blast counts as the last shot fired); the others go, one at a time, to
   * whichever rack is emptiest against what the verse started with, left to right on a tie.
   */
  private openChest(chest: Entity, spent?: StockKind): void {
    if (chest.view.open || this.cracked || this.phase === "lost") return;
    chest.view.open = true;
    const stocked = STOCK.filter((kind) => (this.level.ammo[kind] ?? 0) > 0);
    if (!stocked.length) return;
    const gained: Partial<Record<StockKind, number>> = {};
    const give = (kind: StockKind): void => {
      this.ammo[kind] += 1;
      this.issued[kind] += 1;
      gained[kind] = (gained[kind] ?? 0) + 1;
    };
    const lastFired = [...this.log].reverse().find((entry) => entry.ammo !== "blunderbuss")?.ammo as StockKind | undefined;
    const refund = [spent, lastFired].find((kind): kind is StockKind => kind !== undefined && stocked.includes(kind)) ?? stocked[0]!;
    give(refund);
    for (let extra = 0; extra < CHEST_EXTRA; extra += 1) {
      const fill = (kind: StockKind): number => this.ammo[kind] / (this.level.ammo[kind] ?? 1);
      give(stocked.reduce((emptiest, kind) => (fill(kind) < fill(emptiest) - 1e-9 ? kind : emptiest)));
    }
    const at = { ...chest.view.position };
    this.events.push({ type: "chest", at, gained });
    this.score("chest", { x: at.x, y: at.y + 0.5, z: at.z });
  }

  /** The lever is pulled: everyone dancing on the trapdoors drops below the stage. */
  private springTrap(): boolean {
    const trap = this.trap;
    // The leaves are still open, or the men still climbing out: the lever won't budge yet.
    if (!trap || this.time - trap.openedAt < TRAP_TIME + 1.6) return false;
    trap.openedAt = this.time;
    for (const crew of this.crews) {
      const r = Math.hypot(crew.x - trap.def.pos.x, crew.z - trap.def.pos.z);
      if (r < trap.def.inner - 0.4 || r > trap.def.outer + 0.4 || crew.mode === "trapped") continue;
      dropThroughTrap(crew, this.time);
      this.score("trap", { x: crew.x, y: 1.4, z: crew.z });
    }
    return true;
  }

  /** Humpty lands on the royal bed: back up he goes, a little less each time in a row. */
  private bounceHumpty(bed: Entity): void {
    const humpty = this.humpty;
    if (!humpty || this.cracked || this.hoist) return;
    // The contact has already stopped him this step: judge the landing by how he arrived.
    const v = this.humptyVelocity;
    if (v.y > -0.3) return;
    this.bounceStreak = this.time - this.lastBounce < 3 ? this.bounceStreak + 1 : 0;
    this.lastBounce = this.time;
    const launch = (bed.spring ?? 10) * Math.pow(0.78, this.bounceStreak);
    humpty.body.setLinvel({ x: v.x * 0.85, y: launch, z: v.z * 0.85 }, true);
    const p = humpty.body.translation();
    this.events.push({ type: "bounce", at: { x: p.x, y: p.y, z: p.z }, speed: launch });
    if (this.bounceStreak < 3) this.score("bounce", { x: p.x, y: p.y, z: p.z });
  }

  /** The wind machine: while it blows, anything that swings on a line is rocked harder and harder. */
  private blow(): void {
    if (!this.windy) return;
    for (const entity of this.entities.values()) {
      if (!entity.windy || entity.view.removed || !entity.body.isDynamic()) continue;
      const v = entity.body.linvel();
      // Push with the swing, like a child pumping on a swing, until it is going like the clappers.
      if (Math.abs(v.x) > WIND_TOP_SPEED) continue;
      const push = Math.abs(v.x) < 0.3 ? 1 : Math.sign(v.x);
      entity.body.applyImpulse({ x: push * entity.mass * WIND_PUSH * STEP, y: 0, z: 0 }, true);
    }
  }

  /** Split a maypole at height y: a fixed stump stays; the top, crown and all, comes loose. */
  private cutMaypole(pole: Entity, y: number): Entity | undefined {
    const base = pole.view.position.y - pole.view.size.y / 2;
    const top = pole.view.position.y + pole.view.size.y / 2;
    const cut = Math.max(base + 0.35, Math.min(top - MAYPOLE_CROWN.height - 0.25, y));
    if (cut <= base + 0.3) return undefined;
    const { x, z } = pole.view.position;
    this.remove(pole);
    this.addFixture({ kind: "fixture", look: "stump", pos: { x, y: (base + cut) / 2, z }, size: { x: MAYPOLE_WIDTH, y: cut - base, z: MAYPOLE_WIDTH }, yaw: 0 });
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, (cut + 0.004 + top) / 2, z).setAngularDamping(0.12).setCcdEnabled(true),
    );
    const loose = this.register("block", "maypole", { x: MAYPOLE_WIDTH, y: top - cut - 0.004, z: MAYPOLE_WIDTH }, body, this.maypoleColliders(body, top - cut - 0.004), { structural: true });
    this.events.push({ type: "cut", at: { x, y: cut, z } });
    this.score("maypole", { x, y: cut, z });
    return loose;
  }

  private addSeesaw(def: SeesawDef, fixtures: Entity[]): void {
    const fulcrum = fixtures.find((fixture) => fixture.look === "fulcrum" && Math.abs(fixture.view.position.x - def.pos.x) < 0.2 && Math.abs(fixture.view.position.z - def.pos.z) < 0.3);
    if (!fulcrum) throw new Error("A see-saw needs a fulcrum fixture under it.");
    const rotation = { x: 0, y: 0, z: Math.sin(def.tilt / 2), w: Math.cos(def.tilt / 2) };
    // The pivot sits `offset` toward the +x end of the plank.
    const centre = add(def.pos, rotate(rotation, { x: -def.offset, y: 0, z: 0 }));
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(centre.x, centre.y, centre.z)
        .setRotation(rotation)
        .setAngularDamping(0.2)
        .setCcdEnabled(true),
    );
    const half = def.length / 2;
    const wood = (desc: RAPIER.ColliderDesc): RAPIER.Collider =>
      this.world.createCollider(desc.setDensity(480).setFriction(0.9).setCollisionGroups(GROUPS.block), body);
    // The plank, and a bucket at the -x end for Humpty to sit in.
    const bucket = -half + 0.62;
    const colliders = [
      wood(RAPIER.ColliderDesc.cuboid(half, 0.08, 0.45)),
      // A lipped tray at the high end catches a falling anvil and keeps it driving the plank down.
      wood(RAPIER.ColliderDesc.cuboid(0.65, 0.06, 0.8).setTranslation(half - 0.65, 0.1, 0)),
      wood(RAPIER.ColliderDesc.cuboid(0.65, 0.14, 0.04).setTranslation(half - 0.65, 0.3, 0.78)),
      wood(RAPIER.ColliderDesc.cuboid(0.65, 0.14, 0.04).setTranslation(half - 0.65, 0.3, -0.78)),
      wood(RAPIER.ColliderDesc.cuboid(0.04, 0.14, 0.8).setTranslation(half - 0.02, 0.3, 0)),
      wood(RAPIER.ColliderDesc.cuboid(0.05, 0.28, 0.62).setTranslation(-half + 0.05, 0.36, 0)),
      wood(RAPIER.ColliderDesc.cuboid(0.05, 0.28, 0.62).setTranslation(bucket + 0.62, 0.36, 0)),
      wood(RAPIER.ColliderDesc.cuboid(0.62, 0.28, 0.05).setTranslation(bucket, 0.36, 0.6)),
      wood(RAPIER.ColliderDesc.cuboid(0.62, 0.28, 0.05).setTranslation(bucket, 0.36, -0.6)),
    ];
    const plank = this.register("block", "seesaw", { x: def.length, y: 0.16, z: 0.9 }, body, colliders, { structural: true });
    const top = fulcrum.view.position;
    this.world.createImpulseJoint(
      RAPIER.JointData.revolute({ x: def.pos.x - top.x, y: def.pos.y - top.y, z: def.pos.z - top.z }, { x: def.offset, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }),
      fulcrum.body,
      body,
      true,
    );
    this.seesaw = { plank, def, restAngle: def.tilt };
  }

  /** The see-saw bucket floor, if the plank is back near where it started. */
  private seesawBucket(): Vec3 | undefined {
    const seesaw = this.seesaw;
    if (!seesaw) return undefined;
    if (seesaw.plank.view.removed) return undefined;
    const r = seesaw.plank.body.rotation();
    const angle = 2 * Math.atan2(r.z, r.w);
    if (Math.abs(angle - seesaw.restAngle) > 0.06 || lengthOf(seesaw.plank.body.angvel()) > 0.1) return undefined;
    return add(seesaw.plank.body.translation(), rotate(r, { x: -seesaw.def.length / 2 + 0.62, y: SEESAW_FLOOR, z: 0 }));
  }

  private addRat(def: NonNullable<LevelDef["rat"]>): void {
    const state = createRat(def);
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(state.x, -4, state.z));
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.32, 0.3, 0.7)
        .setTranslation(0, 0.32, 0)
        // Only shot can touch the rat: he never shoves the King's masonry about on his way in.
        .setCollisionGroups(groups(G.CREW, G.PROJ))
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    collider.setEnabled(false);
    const entity = this.register("rat", "rat", { x: 0.64, y: 0.6, z: 1.4 }, body, [collider]);
    this.rat = { state, entity };
  }

  private updateRat(): void {
    const rat = this.rat;
    if (!rat) return;
    if (this.blunderReload > 0) this.blunderReload = Math.max(0, this.blunderReload - STEP);
    const { state, entity } = rat;
    const active = this.phase !== "won" && this.phase !== "lost";
    if (!active && state.mode !== "off" && state.mode !== "flee") state.mode = "flee";
    const trap = this.bait();
    const action = stepRat(state, STEP, this.time, active, trap ? { x: trap.view.position.x, z: trap.view.position.z } : undefined);
    const at = { x: state.x, y: 0, z: state.z };
    if (action === "enter") {
      entity.colliders[0]?.setEnabled(true);
      entity.body.setTranslation({ x: state.x, y: 0, z: state.z }, true);
      this.events.push({ type: "rat", action: "enter", at });
    } else if (action === "arrived") {
      // He has been gnawing at the powder: make off with a charge, but never the last one.
      if (this.ammoLeft >= 2) {
        const stole = [...STOCK].sort((a, b) => this.ammo[b] - this.ammo[a])[0]!;
        this.ammo[stole] -= 1;
        state.carrying = true;
        if (this.selected !== "blunderbuss" && this.ammo[this.selected as StockKind] <= 0) {
          this.selected = this.nextStocked(this.selected as StockKind) ?? this.selected;
        }
        this.events.push({ type: "rat", action: "steal", at, stole });
      } else {
        this.events.push({ type: "rat", action: "gnaw", at });
      }
    } else if (action === "baited" && trap?.mousetrap) {
      // Snap! He's caught by the tail, and there's no powder for him this visit.
      trap.mousetrap.sprung = true;
      trap.view.sprung = true;
      catchRat(state, this.time);
      this.events.push({ type: "rat", action: "trapped", at });
      this.score("mousetrap", { x: at.x, y: 0.8, z: at.z });
      if ("rat" in this.level.star) this.releaseStar({ x: at.x, y: 1.2, z: at.z });
    } else if (action === "gone") {
      entity.colliders[0]?.setEnabled(false);
      this.events.push({ type: "rat", action: "gone", at });
    }
    if (state.mode === "off") {
      entity.body.setNextKinematicTranslation({ x: state.x, y: -4, z: state.z });
    } else {
      entity.body.setNextKinematicTranslation({ x: state.x, y: 0, z: state.z });
      entity.body.setNextKinematicRotation(yawQuat(state.heading));
    }
    if (this.selected === "blunderbuss" && !this.vermin) this.selected = this.ammo[this.lastStock] > 0 ? this.lastStock : this.nextStocked(this.lastStock) ?? this.lastStock;
  }

  private startleRat(): void {
    const rat = this.rat;
    if (!rat || !scareRat(rat.state, this.time)) return;
    this.events.push({ type: "rat", action: "scared", at: { x: rat.state.x, y: 0.4, z: rat.state.z } });
    this.score("rat", { x: rat.state.x, y: 1, z: rat.state.z });
    if ("rat" in this.level.star) this.releaseStar({ x: rat.state.x, y: 1.2, z: rat.state.z });
  }

  private addBlock(material: string, pos: Vec3, size: Vec3, yaw: number): Entity {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation(yawQuat(yaw))
        .setLinearDamping(0.05)
        .setAngularDamping(0.12)
        .setCcdEnabled(true)
        .setSleeping(true),
    );
    const density = DENSITY[material] ?? 600;
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
        .setDensity(density)
        .setFriction(material === "stone" ? 0.8 : 0.65)
        .setRestitution(0.04)
        .setCollisionGroups(GROUPS.block),
      body,
    );
    return this.register("block", material, size, body, [collider], { structural: true, ...(material === "domino" ? { domino: true } : {}) });
  }

  private addKeg(pos: Vec3, lie?: number, fuse?: number): Entity {
    // A keg on a barrel ramp lies on its side, its staves across the way it will roll.
    const rotation = lie === undefined ? { x: 0, y: 0, z: 0, w: 1 } : yAxisTo({ x: Math.cos(lie), y: 0, z: -Math.sin(lie) });
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setRotation(rotation).setCcdEnabled(true).setSleeping(true),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cylinder(KEG_HALF_HEIGHT, KEG_RADIUS)
        .setMass(55)
        .setFriction(0.7)
        .setRestitution(0.05)
        .setCollisionGroups(GROUPS.block)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(55 * 20 / STEP),
      body,
    );
    return this.register("keg", "powder", { x: KEG_RADIUS * 2, y: KEG_HALF_HEIGHT * 2, z: KEG_RADIUS * 2 }, body, [collider], { structural: true, ...(fuse !== undefined ? { rollFuse: fuse } : {}) });
  }

  private addHay(pos: Vec3, yaw: number): Entity {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation(yawQuat(yaw))
        .setLinearDamping(0.6)
        .setAngularDamping(0.8)
        .setSleeping(true),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.roundCuboid(HAY_SIZE.x / 2 - 0.06, HAY_SIZE.y / 2 - 0.06, HAY_SIZE.z / 2 - 0.06, 0.06)
        .setMass(90)
        .setFriction(1.1)
        .setRestitution(0)
        .setCollisionGroups(GROUPS.block),
      body,
    );
    return this.register("hay", "straw", { ...HAY_SIZE }, body, [collider], { softness: SOFT.hay, structural: true });
  }

  private addHumpty(pos: Vec3): void {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setLinearDamping(0.04)
        .setAngularDamping(1.2)
        .setCcdEnabled(true)
        // On a moving ride he must be awake, or the seat slides out from under a sleeping egg.
        .setSleeping((this.level.perch ?? "highest") === "highest"),
    );
    const hull = RAPIER.ColliderDesc.convexHull(eggHullPoints());
    if (!hull) throw new Error("Humpty's shell failed to form a convex hull.");
    const collider = this.world.createCollider(
      hull
        .setMass(HUMPTY_MASS)
        .setFriction(0.75)
        .setRestitution(0.08)
        .setCollisionGroups(GROUPS.humpty)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(HUMPTY_MASS * 1.2 / STEP),
      body,
    );
    this.humpty = this.register("humpty", "egg", { x: 1, y: 1.4, z: 1 }, body, [collider]);
    this.peakY = pos.y;
  }

  private addProjectile(kind: BodyKind, from: Vec3, velocity: Vec3, radius: number, mass: number, ammo: AmmoKind = kind as AmmoKind): Entity {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(from.x, from.y, from.z)
        .setLinvel(velocity.x, velocity.y, velocity.z)
        .setCcdEnabled(true)
        .setAngularDamping(0.4),
    );
    let desc = RAPIER.ColliderDesc.ball(radius)
      .setMass(mass)
      .setFriction(kind === "bomb" ? 0.6 : 0.5)
      .setRestitution(kind === "grape" || kind === "pellet" ? 0.3 : kind === "bomb" ? 0.38 : 0.12)
      .setCollisionGroups(GROUPS.proj)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    const collider = this.world.createCollider(desc, body);
    return this.register(kind, kind, { x: radius * 2, y: radius * 2, z: radius * 2 }, body, [collider], { ammo });
  }

  private addCrew(def: LevelDef["crews"][number]): void {
    const crew = createCrewState(def);
    for (const slot of formation(def.kind)) {
      const at = slotWorld(crew, slot);
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(at.x, at.y, at.z).setRotation(yawQuat(crew.heading)),
      );
      const desc = slot.role === "man"
        ? RAPIER.ColliderDesc.capsule(slot.size.y / 2 - 0.25, 0.25)
        : RAPIER.ColliderDesc.cuboid(slot.size.x / 2, slot.size.y / 2, slot.size.z / 2);
      const collider = this.world.createCollider(
        desc
          .setFriction(slot.role === "bed" ? 1.2 : 0.6)
          .setCollisionGroups(slot.role === "bed" ? GROUPS.bed : GROUPS.crew)
          .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
          .setContactForceEventThreshold(400),
        body,
      );
      const softness = slot.role === "bed" ? SOFT.bed : slot.role === "horse" ? SOFT.horse : SOFT.man;
      const kind: BodyKind = slot.role === "bed" ? "litter" : slot.role === "horse" ? "horse" : "man";
      const material = slot.role === "bed" ? (def.kind === "cart" ? "cart" : "litter") : def.kind === "guard" ? "guard" : "bearer";
      const entity = this.register(kind, material, { ...slot.size }, body, [collider], { softness, crew, role: slot.role });
      crew.slots.push(entity.view.id);
    }
    this.crews.push(crew);
  }

  // ---------------------------------------------------------------- rules

  private threat(): Threat | undefined {
    const humpty = this.humpty;
    if (!humpty || this.cracked || this.hoist) return undefined;
    const p = humpty.body.translation();
    const v = humpty.body.linvel();
    // Airborne, or riding something down (a felled maypole, a toppling tower): run for him.
    const riding = v.y < -1 && lengthOf(v) > 1.5 && p.y > 1.6;
    if (!this.humptyAirborne && !riding) return undefined;
    return { position: { x: p.x, y: p.y, z: p.z }, velocity: { x: v.x, y: v.y, z: v.z } };
  }

  private updateCrews(): void {
    const threat = this.threat();
    for (const crew of this.crews) {
      steerCrew(crew, STEP, this.time, threat, HUMPTY_BASE * 0.85);
      const slots = formation(crew.kind);
      crew.slots.forEach((id, index) => {
        const entity = this.entities.get(id);
        const slot = slots[index];
        if (!entity || !slot) return;
        const at = slotWorld(crew, slot);
        let rotation = yawQuat(crew.heading);
        if (slot.role !== "bed" && crew.toppled > 0) {
          // Knocked flat: lie down along the direction of travel.
          const tilt = crew.toppled * (Math.PI / 2) * (slot.local.z >= 0 ? 1 : -1);
          rotation = multiply(rotation, { x: Math.sin(tilt / 2), y: 0, z: 0, w: Math.cos(tilt / 2) });
          at.y = slot.local.y - (slot.local.y - (slot.role === "horse" ? 0.45 : 0.26)) * crew.toppled;
        }
        at.y -= crew.sink;
        entity.body.setNextKinematicTranslation(at);
        entity.body.setNextKinematicRotation(rotation);
      });
    }
  }

  private stun(crew: CrewState, at: Vec3, how: "bowled" | "slip" = "bowled"): void {
    // Nobody can bowl over a man who is already down, or down the trapdoor.
    if (crew.mode === "stunned" || crew.mode === "trapped" || this.won) return;
    crew.mode = "stunned";
    crew.modeUntil = this.time + (crew.kind === "cart" ? 3.2 : 3.8);
    crew.threatSince = -1;
    this.stats.bowled += 1;
    this.events.push({ type: how, at: { ...at }, crewId: crew.id });
    this.score(how, { x: at.x, y: 1.6, z: at.z });
    const holder = this.level.star;
    if ("crew" in holder && holder.crew === crew.id) this.releaseStar({ x: at.x, y: 2, z: at.z });
  }

  /** The hidden star pops out of whatever it was hiding in. It counts if he cracks later. */
  private releaseStar(at: Vec3): void {
    if (this.starFound || this.cracked || !this.log.length) return;
    this.starFound = true;
    this.events.push({ type: "star", at: { ...at } });
    this.score("star", at);
  }

  /** Put something on the King's bill, unless the curtain is already down. */
  private score(kind: MayhemKind, at: Vec3, points?: number): void {
    // The crack and its great-fall bonus are the last things on the bill.
    if (this.cracked && kind !== "crack" && kind !== "great") return;
    // The bill starts with the Queen's first shot: nothing that happens on its own counts.
    if (!this.log.length) return;
    const earned = this.mayhem.add(kind, points);
    this.events.push({ type: "mayhem", kind, points: earned, at: { ...at } });
    const combo = this.combo;
    if (combo && kind !== "crack" && kind !== "great" && kind !== "combo") {
      combo.kinds.add(kind);
      combo.at = { ...at };
      combo.last = this.time;
    }
  }

  /** He's cracking: was the verse's side challenge done first? */
  private judgeChallenge(): void {
    const challenge = CHALLENGES[this.level.id];
    if (!challenge || !this.log.length) return;
    const fired = new Set<StockKind>();
    for (const shot of this.log) if (shot.ammo !== "blunderbuss") fired.add(shot.ammo);
    this.challengeMet = challenge.met(
      {
        count: (kind) => this.mayhem.entries.get(kind)?.count ?? 0,
        shots: this.log.filter((shot) => shot.ammo !== "blunderbuss").length,
        fired,
        windy: this.windy,
        vaneTurns: this.vaneTurns,
        spins: this.spins,
      },
      this.level,
    );
    const humpty = this.humpty?.view.position;
    if (this.challengeMet && humpty) this.events.push({ type: "challenge", at: { ...humpty } });
  }

  /** The shot's account is settled: three or more kinds of mischief make it a trick shot. */
  private closeCombo(): void {
    const combo = this.combo;
    this.combo = undefined;
    if (!combo || this.cracked) return;
    const bonus = comboBonus(combo.kinds.size);
    if (!bonus) return;
    const earned = this.mayhem.add("combo", bonus);
    this.events.push({ type: "mayhem", kind: "combo", points: earned, at: combo.at, label: `Combo ×${combo.kinds.size}!` });
  }

  /** Count masonry that has come down and hay that has been scattered, once each. */
  private tallyWreckage(): void {
    for (const [id, start] of this.startPositions) {
      if (this.toppled.has(id)) continue;
      const entity = this.entities.get(id);
      if (!entity) continue;
      const p = entity.view.position;
      const r = entity.view.rotation;
      const moved = distance(p, start);
      const upright = 1 - 2 * (r.x * r.x + r.z * r.z);
      const kind = entity.view.kind;
      // Rides (swing seats, see-saws, cradles) are meant to move; they aren't wreckage.
      if (RIDES.has(entity.view.material)) continue;
      if (kind === "hay" ? moved > 0.8 : kind === "block" && (moved > 0.5 || upright < 0.82)) {
        this.toppled.add(id);
        this.score(kind === "hay" ? "hay" : "masonry", { ...p });
      }
    }
  }

  // Rapier invokes these callbacks while it holds borrows on the world, so they only
  // record what happened; bodies are removed after the drain completes.
  private handleCollisions(): void {
    const bursting = new Set<Entity>();
    const touches: Array<[number, number]> = [];
    this.queue.drainCollisionEvents((first, second, started) => {
      if (!started) return;
      touches.push([first, second]);
      for (const [mine, other] of [[first, second], [second, first]] as const) {
        const shell = this.byCollider.get(mine);
        if (!shell || shell.view.kind !== "shell") continue;
        const otherEntity = this.byCollider.get(other);
        if (otherEntity?.ammo && otherEntity.view.kind !== "shell") continue;
        bursting.add(shell);
      }
    });
    for (const shell of bursting) {
      if (shell.view.removed) continue;
      const at = shell.body.translation();
      this.pendingExplosions.push({ at: { x: at.x, y: at.y, z: at.z }, radius: 3.1, power: 620, keg: false, ammo: "shell" });
      this.remove(shell);
    }
    for (const [first, second] of touches) {
      for (const [mine, other] of [[first, second], [second, first]] as const) {
        const shot = this.byCollider.get(mine);
        if (shot?.spring && this.humpty && this.byCollider.get(other) === this.humpty) this.bounceHumpty(shot);
        // A toppling domino that lands on a stage cue (the chock under a barrel, say) calls it.
        if (shot?.domino && this.log.length) {
          const cueFixture = this.byCollider.get(other);
          const v = shot.body.angvel();
          if (cueFixture?.cue && Math.hypot(v.x, v.y, v.z) > 0.5) this.callCue(cueFixture, shot);
          continue;
        }
        if (!shot?.ammo || shot.view.removed) continue;
        if (shot.view.kind === "bomb" && shot.fuseAt === undefined && !this.curios.has(other) && !this.hoppers.has(other) && !this.china.has(other)) shot.fuseAt = this.time + BOMB_FUSE;
        const plate = this.china.get(other);
        if (plate) {
          if (shot.ammo !== "blunderbuss") this.smashChina(plate);
          continue;
        }
        const hopper = this.hoppers.get(other);
        if (hopper) {
          if (!hopper.scored && shot.ammo !== "blunderbuss") {
            hopper.scored = true;
            const p = shot.body.translation();
            this.events.push({ type: "chute", at: { x: p.x, y: p.y, z: p.z } });
            this.score("chute", { x: p.x, y: p.y, z: p.z });
          }
          continue;
        }
        const curio = this.curios.get(other);
        // The Queen's blunderbuss is free and for vermin only: it earns nothing but a scared rat.
        const free = shot.ammo === "blunderbuss";
        if (curio && this.time - curio.last > 1.2) {
          curio.last = this.time;
          this.events.push({ type: "curio", id: curio.id, at: curio.at });
          if (free) continue;
          // Each piece of scenery pays out once: explore, don't farm.
          if (!curio.scored) {
            curio.scored = true;
            this.score(CURIO_SCORE[curio.id] ?? "curio", curio.at);
          }
          const holder = this.level.star;
          if ("curio" in holder && holder.curio === curio.id) this.releaseStar(curio.at);
          continue;
        }
        const owner = this.byCollider.get(other);
        if (!owner) continue;
        if (owner.view.kind === "chest" && !free) this.openChest(owner, shot.ammo === "blunderbuss" ? undefined : shot.ammo);
        if (owner.peel && !owner.peel.spent && !free) this.flickPeel(owner, shot);
        // A shot knocks the mousetrap a little way out into the open, where the rat will smell it.
        if (owner.mousetrap && !owner.mousetrap.sprung && !free) {
          owner.mousetrap.armed = true;
          this.flick(owner, owner.mousetrap, shot, 2.6, 0.12);
        }
        // A shot that strikes one of the King's men fair and square bowls his crew over.
        if (owner.crew && owner.role !== "bed" && !free && lengthOf(shot.lastVelocity ?? shot.body.linvel()) > 4) this.stun(owner.crew, owner.view.position);
        if (owner.bounce && owner.look) {
          const v = shot.lastVelocity ?? shot.body.linvel();
          const p = shot.body.translation();
          if (owner.look === "vane" && !free) this.turnVane(owner);
          this.events.push({ type: "ricochet", at: { x: p.x, y: p.y, z: p.z }, look: owner.look, strength: Math.min(1, lengthOf(v) / 20) });
          if (shot.ammo !== "blunderbuss") this.score("ricochet", { x: p.x, y: p.y, z: p.z });
        } else if (owner.cue && shot.ammo !== "blunderbuss") {
          this.callCue(owner, shot);
        } else if (owner.view.kind === "turntable") {
          this.kickTurntable(shot);
        } else if (owner.view.kind === "rat") {
          this.startleRat();
        }
      }
    }
  }

  /** A shot has struck a stage cue: the theatre obliges. */
  private callCue(fixture: Entity, shot: Entity): void {
    const cue = fixture.cue;
    if (!cue || this.time - (fixture.cuedAt ?? -10) < 2) return;
    if (cue === "trap" && !this.springTrap()) return;
    if (cue === "gate" && !this.raiseGate()) return;
    if (cue === "release") this.knockChock(fixture);
    if (cue === "hive" && !this.releaseSwarm(fixture)) return;
    if (cue === "revolve" && !this.startRevolve()) return;
    fixture.cuedAt = this.time;
    if (cue === "lunch") for (const crew of this.crews) callLunch(crew, this.time);
    if (cue === "wind") this.windUntil = this.time + WIND_TIME;
    const p = shot.body.translation();
    this.events.push({ type: "cue", cue, at: { x: p.x, y: p.y, z: p.z } });
    if (cue !== "trap") this.score(cue === "wind" ? "wind" : cue === "gate" ? "gate" : cue === "release" ? "barrel" : cue === "hive" ? "hive" : cue === "revolve" ? "revolve" : "gong", { x: p.x, y: p.y, z: p.z });
  }

  private handleForces(): void {
    const contacts: Array<{ a: Entity; b: Entity; force: number }> = [];
    this.queue.drainContactForceEvents((event) => {
      const a = this.byCollider.get(event.collider1());
      const b = this.byCollider.get(event.collider2());
      if (a && b) contacts.push({ a, b, force: event.totalForceMagnitude() });
    });
    // Humpty's landings are judged per thing he lands on: an egg that comes down across two boards
    // of the revolve (two colliders, one body) takes the whole blow, not two halves of it.
    const landings = new Map<Entity, number>();
    for (const { a, b, force } of contacts) {
      for (const [me, other] of [[a, b], [b, a]] as const) {
        if (me.view.removed || other.view.removed) continue;
        if (me === this.humpty) landings.set(other, (landings.get(other) ?? 0) + force);
        if (me.crew && other.view.kind !== "ground") {
          const v = other.body.linvel();
          const crewSpeed = me.crew.speed;
          const relative = Math.hypot(
            v.x - Math.sin(me.crew.heading) * crewSpeed,
            v.y,
            v.z - Math.cos(me.crew.heading) * crewSpeed,
          );
          const hit = other.ammo ? relative > 2 && other.ammo !== "blunderbuss" : relative > 3.4;
          if (hit && other !== this.humpty) this.stun(me.crew, me.view.position);
        }
        if (me.view.kind === "keg" && me.fuseAt === undefined && (force * STEP) / me.mass > 25) {
          me.fuseAt = this.time + 0.02;
        }
      }
    }
    for (const [other, force] of landings) {
      if (this.humpty && !this.cracked && !this.hoist && !this.humpty.view.removed) this.humptyContact(other, force);
    }
  }

  private humptyContact(other: Entity, force: number): void {
    if (other.ammo) {
      this.lastNearMiss = this.time;
      return;
    }
    if (other.view.kind === "shard" || other.view.kind === "crown") return;
    // The royal bed is all springs: it throws him back up and never breaks him.
    if (other.spring) return;
    const humpty = this.humpty!;
    const speed = ((force * STEP) / humpty.mass) * other.softness;
    // A fall is a sudden change in his own velocity; being squeezed or pinned is not.
    const v = humpty.body.linvel();
    const jolt = Math.hypot(v.x - this.humptyVelocity.x, v.y - this.humptyVelocity.y + 9.81 * STEP, v.z - this.humptyVelocity.z);
    if (other.softness < 1 && speed < CRACK_SPEED) {
      // Straw, stretchers and arms swallow the bounce: Humpty is carried with what caught him.
      const arms = other.view.kind === "man" || other.view.kind === "horse";
      const carrier = arms
        ? { x: 0, y: 0, z: 0 }
        : other.crew
          ? { x: Math.sin(other.crew.heading) * other.crew.speed, y: 0, z: Math.cos(other.crew.heading) * other.crew.speed }
          : other.body.linvel();
      const keep = arms ? 0.5 : 0.2;
      humpty.body.setLinvel({
        x: carrier.x + (v.x - carrier.x) * keep,
        y: carrier.y + (v.y - carrier.y) * keep,
        z: carrier.z + (v.z - carrier.z) * keep,
      }, true);
      const w = humpty.body.angvel();
      humpty.body.setAngvel({ x: w.x * 0.3, y: w.y * 0.3, z: w.z * 0.3 }, true);
    }
    if (other.crew) return;
    // Settling onto a fresh perch is never a fall.
    if (this.time - this.releaseTime < 0.4) return;
    if (speed >= CRACK_SPEED && jolt >= CRACK_SPEED * 0.6) {
      this.crackHumpty(speed);
    } else if (speed > 2.5) {
      this.events.push({ type: "impact", at: { ...humpty.view.position }, strength: Math.min(1, speed / CRACK_SPEED), material: "egg" });
    }
  }

  private handleExplosions(): void {
    for (const entity of [...this.entities.values()]) {
      if (entity.fuseAt === undefined) continue;
      if (entity.view.kind === "bomb") entity.view.fuse = Math.max(0, entity.fuseAt - this.time);
      if (this.time < entity.fuseAt) continue;
      const at = entity.body.translation();
      if (entity.view.kind === "keg") {
        this.pendingExplosions.push({ at: { x: at.x, y: at.y, z: at.z }, radius: 3.6, power: 900, keg: true });
        this.score("keg", { x: at.x, y: at.y, z: at.z });
        this.startPositions.delete(entity.view.id);
        this.remove(entity);
      } else if (entity.view.kind === "bomb") {
        this.pendingExplosions.push({ at: { x: at.x, y: at.y, z: at.z }, radius: 3.4, power: 820, keg: false, ammo: "bomb" });
        this.remove(entity);
      }
    }
    const blasts = this.pendingExplosions.splice(0, this.pendingExplosions.length);
    for (const blast of blasts) {
      for (const piece of this.china.values()) if (!piece.broken && distance(piece.at, blast.at) < blast.radius * 0.8) this.smashChina(piece, 0);
      this.events.push({ type: "explode", at: blast.at, radius: blast.radius, keg: blast.keg });
      if (this.rat && this.rat.state.mode !== "off" && distance({ x: this.rat.state.x, y: 0.3, z: this.rat.state.z }, blast.at) < blast.radius + 1) this.startleRat();
      for (const entity of this.entities.values()) {
        const p = entity.body.translation();
        const gap = distance(p, blast.at);
        if (gap > blast.radius) continue;
        const falloff = 1 - gap / blast.radius;
        if (entity.crew) {
          this.stun(entity.crew, entity.view.position);
          continue;
        }
        // A blast sends a banana skin flying: wherever it comes down, it's live. So is a mousetrap.
        if (entity.peel) entity.peel.armed = true;
        if (entity.mousetrap) entity.mousetrap.armed = true;
        if (entity.view.kind === "rat" || entity.view.kind === "turntable") continue;
        if (entity.view.kind === "chest" && gap < 2) this.openChest(entity, blast.ammo);
        if (!entity.body.isDynamic()) continue;
        if (this.shielded(blast.at, entity)) continue;
        if (entity.view.kind === "keg" && entity.fuseAt === undefined) {
          // The flash has to reach the powder: stone and brick keep it out.
          if (this.walled(blast.at, entity)) continue;
          entity.fuseAt = this.time + 0.12 + falloff * 0.05;
          continue;
        }
        const direction = normalise({ x: p.x - blast.at.x, y: p.y - blast.at.y + 0.6, z: p.z - blast.at.z });
        const scale = Math.min(1.5, Math.max(0.35, Math.sqrt(120 / Math.max(entity.mass, 1))));
        const impulse = blast.power * falloff * scale;
        entity.body.applyImpulse({ x: direction.x * impulse, y: direction.y * impulse, z: direction.z * impulse }, true);
        entity.body.applyTorqueImpulse(
          { x: (this.rng() - 0.5) * impulse * 0.3, y: (this.rng() - 0.5) * impulse * 0.3, z: (this.rng() - 0.5) * impulse * 0.3 },
          true,
        );
        if (entity === this.humpty) this.lastNearMiss = this.time;
      }
    }
  }

  /** Is there masonry between a blast and this body? */
  private walled(at: Vec3, entity: Entity): boolean {
    const p = entity.body.translation();
    const gap = distance(p, at);
    if (gap < 1e-3) return false;
    const direction = { x: (p.x - at.x) / gap, y: (p.y - at.y) / gap, z: (p.z - at.z) / gap };
    const hit = this.world.castRay(new RAPIER.Ray(at, direction), gap, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, entity.body, (collider) => {
      const owner = this.byCollider.get(collider.handle);
      return owner?.view.kind === "block" && (owner.view.material === "stone" || owner.view.material === "brick");
    });
    return hit !== null;
  }

  /** A canopy roof between a blast and a body takes the blast for it. */
  private shielded(at: Vec3, entity: Entity): boolean {
    const p = entity.body.translation();
    const gap = distance(p, at);
    if (gap < 1e-3) return false;
    const direction = { x: (p.x - at.x) / gap, y: (p.y - at.y) / gap, z: (p.z - at.z) / gap };
    const hit = this.world.castRay(new RAPIER.Ray(at, direction), gap, true, undefined, undefined, undefined, entity.body, (collider) => {
      const owner = this.byCollider.get(collider.handle);
      return owner?.view.material === "canopy";
    });
    return hit !== null;
  }

  private crackHumpty(speed: number): void {
    const humpty = this.humpty;
    if (!humpty || this.cracked || this.phase === "lost") return;
    // The shot that did it is a trick shot too, if it earned it: that goes on the bill first.
    this.closeCombo();
    this.judgeChallenge();
    this.cracked = true;
    this.won = true;
    this.phase = "won";
    this.resultAt = this.time + 2.4;
    const p = humpty.body.translation();
    const v = humpty.body.linvel();
    const at = { x: p.x, y: p.y, z: p.z };
    const fall = Math.max(0, this.peakY - p.y);
    this.stats.fall = Math.round(fall * 10) / 10;
    this.humptyMood = "cracked";
    this.events.push({ type: "crack", at, fall: this.stats.fall, speed });
    this.score("crack", at, 300 + Math.round(this.stats.fall * FALL_POINTS));
    if (this.stats.fall >= this.level.greatFall) this.score("great", at);
    const rotation = humpty.body.rotation();
    this.remove(humpty);
    this.humpty = undefined;
    this.humptyAirborne = false;

    const spawnDebris = (kind: BodyKind, material: string, offset: Vec3, size: Vec3, velocity: Vec3, mass: number): void => {
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(at.x + offset.x, Math.max(at.y + offset.y, size.y / 2 + 0.02), at.z + offset.z)
          .setRotation(rotation)
          .setLinvel(velocity.x, velocity.y, velocity.z)
          .setAngvel({ x: (this.rng() - 0.5) * 10, y: (this.rng() - 0.5) * 10, z: (this.rng() - 0.5) * 10 })
          .setLinearDamping(0.3)
          .setAngularDamping(0.6),
      );
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
          .setMass(mass)
          .setFriction(0.9)
          .setRestitution(0.1)
          .setCollisionGroups(GROUPS.debris),
        body,
      );
      this.register(kind, material, size, body, [collider]);
    };
    const bounce = Math.min(4, 1.2 + speed * 0.18);
    spawnDebris("shard", "egg-bottom", { x: 0, y: -0.2, z: 0 }, { x: 0.9, y: 0.62, z: 0.9 }, { x: v.x * 0.1, y: 0.4, z: v.z * 0.1 }, 12);
    spawnDebris("shard", "egg-top", { x: 0, y: 0.45, z: 0 }, { x: 0.8, y: 0.5, z: 0.8 }, { x: v.x * 0.2 + (this.rng() - 0.5) * 2, y: bounce, z: v.z * 0.2 + (this.rng() - 0.5) * 2 }, 8);
    for (let index = 0; index < 7; index += 1) {
      const angle = (index / 7) * Math.PI * 2 + this.rng();
      const reach = 1.4 + this.rng() * 2.2;
      spawnDebris(
        "shard",
        "egg-chip",
        { x: Math.cos(angle) * 0.35, y: 0.1, z: Math.sin(angle) * 0.35 },
        { x: 0.18 + this.rng() * 0.12, y: 0.04, z: 0.14 + this.rng() * 0.1 },
        { x: Math.cos(angle) * reach, y: bounce * (0.8 + this.rng() * 0.6), z: Math.sin(angle) * reach },
        0.4,
      );
    }
    spawnDebris("crown", "gold", { x: 0, y: 0.75, z: 0 }, { x: 0.46, y: 0.3, z: 0.46 }, { x: (this.rng() - 0.5) * 3, y: bounce + 2.2, z: (this.rng() - 0.5) * 3 }, 2);
    for (const crew of this.crews) {
      if (crew.mode !== "stunned") {
        crew.mode = "cheer";
        crew.modeUntil = this.time + 99;
      }
    }
  }

  private updateHumpty(): void {
    const humpty = this.humpty;
    if (!humpty || this.cracked || this.hoist) return;
    const p = humpty.body.translation();
    const v = humpty.body.linvel();
    const w = humpty.body.angvel();
    const speed = lengthOf(v);
    const spin = lengthOf(w);

    if (p.y < -2) {
      this.crackHumpty(CRACK_SPEED);
      return;
    }
    if (speed < 0.9) this.peakY = p.y;
    else this.peakY = Math.max(this.peakY, p.y);
    this.humptyDrop = Math.max(0, this.peakY - p.y);

    if (this.releasedAt && distance(p, this.releasedAt) > 0.6) {
      // He came off the perch before anyone fired: remember it as a bad spot.
      this.badPerches.push(this.releasedAt);
      this.releasedAt = undefined;
    }

    const touching = this.touching(humpty);
    this.freeSteps = touching ? 0 : this.freeSteps + 1;
    this.contactSteps = touching ? this.contactSteps + 1 : 0;
    if (!this.humptyAirborne && this.freeSteps >= 3 && speed > 1.5 && this.peakY - p.y > 0.3) {
      this.humptyAirborne = true;
      this.awaitingLanding = true;
      this.events.push({ type: "airborne", at: { x: p.x, y: p.y, z: p.z } });
    } else if (this.humptyAirborne && this.contactSteps >= 5) {
      this.humptyAirborne = false;
    }
    // Eggs rock like weebles; settle him quickly once he is in slow contact with something.
    const grounded = touching && p.y < 1.2;
    const settling = touching && speed < 2.5;
    humpty.body.setAngularDamping(grounded ? 3 : settling ? 2.4 : touching ? 1.2 : 0.4);
    humpty.body.setLinearDamping(grounded ? 1.4 : settling ? 0.6 : 0.04);

    if (!this.humptyAirborne && spin > 1.4 && this.time - this.lastWobble > 2.5) {
      this.lastWobble = this.time;
      this.events.push({ type: "wobble", at: { x: p.x, y: p.y, z: p.z } });
    }
    this.checkTeeter(humpty, p, v, touching);

    const resting = speed < REST_SPEED && spin < 0.6;
    this.restTimer = resting ? this.restTimer + STEP : 0;
    if (resting && this.restTimer > 0.1) this.humptyAirborne = false;

    const surface = this.restTimer > 0.7 ? this.supportKind(humpty) : "ground";
    if (this.restTimer > 0.7 && surface !== "ground") this.holdCarriers(humpty);
    if (this.restTimer > 0.7 && (p.y < 1.65 || surface !== "ground")) {
      if (this.awaitingLanding) {
        this.awaitingLanding = false;
        this.needsHoist = true;
        this.stats.catches += surface === "ground" ? 0 : 1;
        this.caughtAt = this.time;
        this.events.push({ type: "caught", at: { x: p.x, y: p.y, z: p.z }, by: surface });
        for (const crew of this.crews) {
          if (crew.mode === "run" || crew.mode === "idle" || crew.mode === "patrol") {
            crew.mode = "cheer";
            crew.modeUntil = this.time + 1.6;
          }
        }
      }
      if (this.needsHoist && this.restTimer > 1.3 && this.ammoLeft > 0 && this.time >= this.hoistRetryAt) this.startHoist();
    }

    if (this.humptyAirborne) this.humptyMood = "falling";
    else if (this.teeter) this.humptyMood = "nervous";
    else if (this.time - this.caughtAt < 3) this.humptyMood = "smug";
    else if (this.time - this.lastNearMiss < 1.6 || spin > 0.8) this.humptyMood = "nervous";
    else this.humptyMood = "calm";
  }

  /** Crews whose bed he is lying on stand still rather than carry him off on patrol. */
  private holdCarriers(humpty: Entity): void {
    const collider = humpty.colliders[0];
    if (!collider) return;
    this.world.contactPairsWith(collider, (other) => {
      if (!other) return;
      const owner = this.byCollider.get(other.handle);
      const crew = owner?.role === "bed" ? owner.crew : undefined;
      if (crew && crew.mode !== "stunned" && crew.mode !== "recover") {
        crew.mode = "cheer";
        crew.modeUntil = Math.max(crew.modeUntil, this.time + 0.5);
      }
    });
  }

  private touching(humpty: Entity): boolean {
    const collider = humpty.colliders[0];
    if (!collider) return false;
    const others: RAPIER.Collider[] = [];
    // A collider removed this step can still appear in the pair list as null.
    this.world.contactPairsWith(collider, (other) => {
      if (other) others.push(other);
    });
    for (const other of others) {
      let count = 0;
      this.world.contactPair(collider, other, (manifold) => {
        count += manifold.numContacts();
      });
      if (count > 0) return true;
    }
    return false;
  }

  private supportKind(humpty: Entity): "litter" | "hay" | "cart" | "ground" {
    let result: "litter" | "hay" | "cart" | "ground" = "ground";
    for (const collider of humpty.colliders) {
      this.world.contactPairsWith(collider, (other) => {
        if (!other) return;
        const owner = this.byCollider.get(other.handle);
        if (!owner) return;
        if (owner.view.kind === "litter") result = owner.view.material === "cart" ? "cart" : "litter";
        else if ((owner.view.kind === "man" || owner.view.kind === "horse") && result === "ground") result = "litter";
        else if (owner.view.kind === "hay" && result === "ground") result = "hay";
      });
    }
    return result;
  }

  /** Height of settled, level masonry under every part of Humpty's base at (x, z), if any. */
  private perchSupport(x: number, z: number): number | undefined {
    const samples: Array<[number, number]> = [[0, 0]];
    for (let index = 0; index < 6; index += 1) {
      const angle = (index / 6) * Math.PI * 2;
      samples.push([Math.cos(angle) * 0.26, Math.sin(angle) * 0.26]);
    }
    let high = -Infinity;
    let low = Infinity;
    for (const [dx, dz] of samples) {
      const ray = new RAPIER.Ray({ x: x + dx, y: 40, z: z + dz }, { x: 0, y: -1, z: 0 });
      // Rays pass through canopies: the stagehands seat him under one, never on top of it.
      const hit = this.world.castRayAndGetNormal(ray, 60, true, undefined, undefined, undefined, undefined, (collider) => {
        const owner = this.byCollider.get(collider.handle);
        return Boolean(owner?.structural && owner.view.kind === "block" && owner.view.material !== "canopy" && owner.view.material !== "post");
      });
      if (!hit || hit.normal.y < 0.95) return undefined;
      const owner = this.byCollider.get(hit.collider.handle);
      if (!owner || lengthOf(owner.body.linvel()) > 0.08 || lengthOf(owner.body.angvel()) > 0.08) return undefined;
      const y = 40 - hit.timeOfImpact;
      high = Math.max(high, y);
      low = Math.min(low, y);
    }
    if (high - low > 0.04 || high < PERCH_MIN) return undefined;
    return high;
  }

  /** Would Humpty's shell overlap anything if he were placed at `at`? */
  private perchClear(at: Vec3): boolean {
    const collider = this.humpty?.colliders[0];
    if (!collider) return false;
    let clear = true;
    this.world.intersectionsWithShape(at, { x: 0, y: 0, z: 0, w: 1 }, collider.shape, () => {
      clear = false;
      return false;
    }, undefined, undefined, collider, this.humpty?.body);
    return clear;
  }

  /** His ride, if the verse gives him one and it is fit to sit in. */
  private ridePerch(): Vec3 | undefined {
    const mode = this.level.perch;
    let seat: Vec3 | undefined;
    if (mode === "turntable") seat = this.turntableSeat();
    else if (mode === "seesaw") seat = this.seesawBucket();
    else if (mode === "swing" && this.swing && !this.swing.seat.view.removed) {
      const seatRopes = this.ropes.filter((rope) => rope.seat === this.swing?.seat);
      const r = this.swing.seat.body.rotation();
      const level = Math.abs(r.w) > Math.cos(0.08);
      if (seatRopes.every((rope) => !rope.cut) && level) {
        const t = this.swing.seat.body.translation();
        seat = { x: t.x, y: t.y, z: t.z };
      }
    }
    return seat && { x: seat.x, y: seat.y + HUMPTY_BASE + 0.02, z: seat.z };
  }

  private findPerch(): Vec3 | undefined {
    const humpty = this.humpty;
    if (!humpty) return undefined;
    const mode = this.level.perch ?? "highest";
    // His ride first; if it is spent or broken, the highest perch nearby will do.
    if (mode !== "highest") {
      const ride = this.ridePerch();
      if (ride) return ride;
    }
    const candidates: Array<{ x: number; z: number }> = [{ x: this.perch.x, z: this.perch.z }];
    for (const radius of [0.5, 1, 1.6, 2.3, 3]) {
      for (let index = 0; index < 10; index += 1) {
        const angle = (index / 10) * Math.PI * 2;
        candidates.push({ x: this.perch.x + Math.cos(angle) * radius, z: this.perch.z + Math.sin(angle) * radius });
      }
    }
    let best: { at: Vec3; score: number } | undefined;
    for (const candidate of candidates) {
      if (this.badPerches.some((bad) => Math.hypot(bad.x - candidate.x, bad.z - candidate.z) < 0.6)) continue;
      const surface = this.perchSupport(candidate.x, candidate.z);
      if (surface === undefined) continue;
      const at = { x: candidate.x, y: surface + HUMPTY_BASE + 0.02, z: candidate.z };
      const score = surface - Math.hypot(candidate.x - this.perch.x, candidate.z - this.perch.z) * 0.15;
      if (best && score <= best.score) continue;
      if (!this.perchClear(at)) continue;
      best = { at, score };
    }
    return best?.at;
  }

  private startHoist(): void {
    const humpty = this.humpty;
    if (!humpty || this.hoist) return;
    const to = this.findPerch();
    if (!to) {
      this.hoistRetryAt = this.time + 3;
      return;
    }
    const p = humpty.body.translation();
    const r = humpty.body.rotation();
    const from = { x: p.x, y: p.y, z: p.z };
    // Lift clear of the masonry, but stay low enough to remain in the audience's view.
    let top = Math.max(from.y, to.y) + 1.3;
    for (const entity of this.entities.values()) {
      if (entity.structural) top = Math.max(top, entity.view.position.y + entity.view.size.y / 2 + 1.5);
    }
    // A sleeping body loses its mass properties across a kinematic round trip; wake him first.
    humpty.body.wakeUp();
    humpty.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    for (const collider of humpty.colliders) collider.setEnabled(false);
    this.needsHoist = false;
    const track = (this.level.perch ?? "highest") !== "highest" && this.ridePerch() !== undefined;
    this.hoist = { from, to, top, t: 0, rotation: { x: r.x, y: r.y, z: r.z, w: r.w }, checked: track, track };
    this.phase = "hoist";
    this.humptyAirborne = false;
    this.events.push({ type: "hoist-start", from, to });
  }

  private updateHoist(): void {
    const hoist = this.hoist;
    const humpty = this.humpty;
    if (!hoist || !humpty) return;
    hoist.t += STEP;
    const rise = 1.0;
    const cross = 1.0;
    const lower = 0.8;
    // The masonry may have settled while he was in the air: re-check the perch before lowering.
    if (!hoist.checked && hoist.t >= rise + cross) {
      hoist.checked = true;
      const surface = this.perchSupport(hoist.to.x, hoist.to.z);
      const valid = surface !== undefined && Math.abs(surface + HUMPTY_BASE + 0.02 - hoist.to.y) < 0.05 && this.perchClear(hoist.to);
      if (!valid) {
        const next = this.findPerch() ?? hoist.from;
        hoist.from = { x: hoist.to.x, y: hoist.from.y, z: hoist.to.z };
        hoist.to = next;
        hoist.t = rise;
        hoist.top = Math.max(hoist.top, next.y + 1.3);
      }
    }
    // A moving ride (turntable, swing) is followed all the way down.
    if (hoist.track && hoist.t >= rise) {
      const live = this.ridePerch();
      if (live) hoist.to = live;
    }
    const t = hoist.t;
    let position: Vec3;
    if (t < rise) {
      const k = smooth(t / rise);
      position = { x: hoist.from.x, y: hoist.from.y + (hoist.top - hoist.from.y) * k, z: hoist.from.z };
    } else if (t < rise + cross) {
      const k = smooth((t - rise) / cross);
      position = {
        x: hoist.from.x + (hoist.to.x - hoist.from.x) * k,
        y: hoist.top,
        z: hoist.from.z + (hoist.to.z - hoist.from.z) * k,
      };
    } else {
      const k = smooth(Math.min(1, (t - rise - cross) / lower));
      position = { x: hoist.to.x, y: hoist.top + (hoist.to.y - hoist.top) * k, z: hoist.to.z };
    }
    const upright = slerpToUpright(hoist.rotation, smooth(Math.min(1, t / rise)));
    humpty.body.setNextKinematicTranslation(position);
    humpty.body.setNextKinematicRotation(upright);
    if (t >= rise + cross + lower) {
      // Never release him inside something: nudge up out of any overlap (a short drop is harmless).
      const release = { ...hoist.to };
      for (let lift = 0; lift < 12 && !this.perchClear(release); lift += 1) release.y += 0.05;
      humpty.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      humpty.body.setTranslation(release, true);
      humpty.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      humpty.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      humpty.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      const turntable = this.turntable;
      if (turntable && this.level.perch === "turntable") {
        // Match the turntable's motion so he doesn't skid when set down.
        const rx = release.x - turntable.def.pos.x;
        const rz = release.z - turntable.def.pos.z;
        humpty.body.setLinvel({ x: turntable.omega * rz, y: 0, z: -turntable.omega * rx }, true);
        humpty.body.setAngvel({ x: 0, y: turntable.omega, z: 0 }, true);
      }
      for (const collider of humpty.colliders) collider.setEnabled(true);
      humpty.body.recomputeMassPropertiesFromColliders();
      this.hoist = undefined;
      this.releasedAt = release;
      this.releaseTime = this.time;
      this.peakY = release.y;
      this.restTimer = 0;
      this.phase = this.ammoLeft > 0 ? "aim" : "flight";
      this.reload = Math.min(this.reload, 0.3);
      this.events.push({ type: "hoist-end", at: release });
    }
  }

  private syncViews(): void {
    let impacts = 0;
    const humptyAt = this.humpty?.view.position;
    for (const entity of this.entities.values()) {
      const t = entity.body.translation();
      const r = entity.body.rotation();
      const view = entity.view;
      if (entity.body.isDynamic() && entity !== this.humpty) {
        const v = entity.body.linvel();
        const last = entity.lastVelocity;
        if (last && !entity.body.isSleeping()) {
          const dv = Math.hypot(v.x - last.x, v.y - last.y + 9.81 * STEP, v.z - last.z);
          if (entity.view.kind === "keg" && dv > 5 && entity.fuseAt === undefined) entity.fuseAt = this.time + 0.02;
          if (dv > 2.4 && impacts < 8 && entity.view.kind !== "grape") {
            impacts += 1;
            this.events.push({ type: "impact", at: { x: t.x, y: t.y, z: t.z }, strength: Math.min(1, dv / 12), material: view.material });
            if (humptyAt && distance(humptyAt, t) < 2.4) this.lastNearMiss = this.time;
          }
        }
        entity.lastVelocity = { x: v.x, y: v.y, z: v.z };
      }
      view.position.x = t.x;
      view.position.y = t.y;
      view.position.z = t.z;
      view.rotation.x = r.x;
      view.rotation.y = r.y;
      view.rotation.z = r.z;
      view.rotation.w = r.w;
    }
  }

  private cleanUp(): void {
    for (const entity of [...this.entities.values()]) {
      const p = entity.view.position;
      if (p.y < -6 || p.x < STAGE.minX - 4 || p.x > STAGE.maxX + 4 || p.z < STAGE.minZ - 4 || p.z > STAGE.maxZ + 6) {
        if (entity !== this.humpty) this.remove(entity);
        continue;
      }
      if (entity.expires !== undefined && this.time > entity.expires) {
        this.remove(entity);
        continue;
      }
      if (entity.ammo) {
        const speed = lengthOf(entity.body.linvel());
        entity.restFor = speed < 0.4 ? entity.restFor + STEP : 0;
        if (entity.view.kind === "grape" && entity.restFor > 2.5) this.remove(entity);
      }
    }
  }

  /**
   * Bodies start asleep so a verse stands still, which means they never joined Rapier's contact
   * islands: knock a post out from under a sleeping deck and the deck would hang in the air. So
   * anything moving briskly wakes whatever it is still touching (collected first, woken after the
   * query, since Rapier holds the world during its callbacks).
   */
  private wakeSupported(): void {
    const sleepers = new Set<RAPIER.RigidBody>();
    for (const entity of this.entities.values()) {
      const body = entity.body;
      if (!body.isDynamic() || body.isSleeping()) continue;
      const v = body.linvel();
      const w = body.angvel();
      if (v.x * v.x + v.y * v.y + v.z * v.z < 0.36 && w.x * w.x + w.y * w.y + w.z * w.z < 1) continue;
      for (const collider of entity.colliders) {
        this.world.contactPairsWith(collider, (other) => {
          const parent = other.parent();
          if (parent && parent.isDynamic() && parent.isSleeping()) sleepers.add(parent);
        });
      }
    }
    for (const body of sleepers) body.wakeUp();
  }

  /**
   * Teetering: shoved along his perch toward a drop and pulled up just short of it. We look a hand's
   * breadth past him the way he was last moving; if there's nothing under that but a long way
   * down, he's on the brink. (Rides move him all the time, so they don't count.)
   */
  private checkTeeter(humpty: Entity, p: Vec3, v: Vec3, touching: boolean): void {
    const onRide = (this.level.perch ?? "highest") !== "highest";
    const flat = Math.hypot(v.x, v.z);
    if (touching && !this.humptyAirborne && flat > 0.3 && this.log.length) {
      this.stirDir = { x: v.x / flat, z: v.z / flat };
      this.stirredAt = this.time;
    }
    const dir = this.stirDir;
    let brink = false;
    if (dir && !onRide && touching && !this.humptyAirborne && this.time - this.stirredAt < 2.5 && lengthOf(v) < 1.2 && p.y - HUMPTY_REST > 1) {
      const ray = new RAPIER.Ray({ x: p.x + dir.x * 0.5, y: p.y - 0.1, z: p.z + dir.z * 0.5 }, { x: 0, y: -1, z: 0 });
      brink = this.world.castRay(ray, 1.2, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, humpty.body) === null;
    }
    if (!brink) {
      this.teeter = undefined;
      return;
    }
    if (!this.teeter) {
      this.teeter = { toward: { ...dir! }, since: this.time };
      if (this.time - this.lastTeeter > 4) {
        this.lastTeeter = this.time;
        this.events.push({ type: "teeter", at: { x: p.x, y: p.y, z: p.z }, toward: { ...dir! } });
      }
    }
  }

  /** Which way he's teetering, if he's on the brink. */
  get teeterView(): { x: number; z: number } | undefined {
    return this.teeter?.toward;
  }

  /** No shot still in the air or rolling fast, no lit fuse and no blast waiting to go off. */
  private nothingPending(): boolean {
    if (this.pendingExplosions.length) return false;
    for (const entity of this.entities.values()) {
      if (entity.fuseAt !== undefined) return false;
      if (entity.ammo && entity.ammo !== "blunderbuss" && !entity.view.removed && lengthOf(entity.body.linvel()) > 1.5) return false;
    }
    return true;
  }

  private isSettled(): boolean {
    for (const entity of this.entities.values()) {
      // A lit fuse is unfinished business, however still the bomb sits.
      if (entity.fuseAt !== undefined) return false;
      if (!entity.body.isDynamic() || entity.body.isSleeping()) continue;
      if (lengthOf(entity.body.linvel()) > 0.35) return false;
    }
    return this.pendingExplosions.length === 0;
  }

  private updatePhase(): void {
    // A shot's account closes once things have gone quiet for a while.
    const combo = this.combo;
    if (combo && this.time - combo.last > 2 && this.time - combo.opened > 3) this.closeCombo();
    // While he falls the gun crew works double-quick: time for a parting shot or two, never a volley.
    if (this.reload > 0) this.reload = Math.max(0, this.reload - STEP * (this.humptyAirborne ? FALLING_RELOAD : 1));
    if (this.phase === "won") {
      if (this.resultAt !== undefined && this.time >= this.resultAt) {
        this.resultAt = undefined;
        this.finishStats();
        this.events.push({ type: "result", won: true });
      }
      return;
    }
    if (this.phase === "lost" || this.phase === "hoist") return;
    if (this.phase === "flight" && this.reload <= 0 && this.ammoLeft > 0) {
      this.phase = "aim";
      this.events.push({ type: "reload", ammo: this.selected });
    }
    if (this.ammoLeft === 0) {
      this.settledFor = this.isSettled() && !this.humptyAirborne ? this.settledFor + STEP : 0;
      // He came down safe, the battery is empty and nothing is flying or fizzing: no need to wait
      // for every swinging sandbag and rolling keg to stop before the curtain comes down.
      const safeDown = this.needsHoist && !this.humptyAirborne && this.restTimer > 1.3 && this.nothingPending();
      if (safeDown || this.settledFor > 1.2 || this.time - this.lastShotAt > 14) {
        this.phase = "lost";
        this.finishStats();
        this.events.push({ type: "result", won: false });
      }
    }
  }

  private finishStats(): void {
    let moved = 0;
    for (const [id, start] of this.startPositions) {
      const entity = this.entities.get(id);
      if (!entity || distance(entity.view.position, start) > 0.5) moved += 1;
    }
    this.stats.blocksMoved = moved;
  }

  destroy(): void {
    this.world.free();
    this.queue.free();
  }
}

function normalise(v: Vec3): Vec3 {
  const length = lengthOf(v) || 1;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function multiply(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

function smooth(t: number): number {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
}

function slerpToUpright(from: Quat, t: number): Quat {
  let { x, y, z, w } = from;
  if (w < 0) {
    x = -x;
    y = -y;
    z = -z;
    w = -w;
  }
  const dot = w;
  if (dot > 0.9995) return from;
  const theta = Math.acos(Math.min(1, dot));
  const sin = Math.sin(theta);
  const a = Math.sin((1 - t) * theta) / sin;
  const b = Math.sin(t * theta) / sin;
  return { x: x * a, y: y * a, z: z * a, w: w * a + b };
}

export { CREW_SPECS };
