import RAPIER from "@dimforge/rapier3d-compat";
import { AMMO, arcPoint, arcVelocity, solveLaunch } from "./ballistics.js";
import { CREW_SPECS, createCrewState, formation, slotWorld, steerCrew, type CrewState, type Threat } from "./crew.js";
import { eggHullPoints } from "./egg.js";
import { HAY_SIZE, HUMPTY_BASE, KEG_HALF_HEIGHT, KEG_RADIUS, type LevelDef } from "./level.js";
import {
  distance,
  lengthOf,
  yawQuat,
  type AmmoKind,
  type BodyKind,
  type BodyView,
  type GameEvent,
  type HumptyMood,
  type Phase,
  type Quat,
  type Vec3,
} from "./types.js";

export const STEP = 1 / 60;

/** The Queen's battery sits at the front of the stage, facing -z. */
export const CANNON_PIVOT: Vec3 = { x: -0.9, y: 1.02, z: 8.4 };
export const MORTAR_PIVOT: Vec3 = { x: 1.6, y: 0.78, z: 8.6 };
export const BARREL_LENGTH = { cannon: 1.55, mortar: 0.55 };

export const STAGE = { minX: -16, maxX: 16, minZ: -10, maxZ: 11.5 };

/** Minimum impact speed (m/s) that cracks Humpty against something hard. */
export const CRACK_SPEED = 6.6;
export const HUMPTY_MASS = 90;
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

const DENSITY: Record<string, number> = { oak: 520, plank: 480, beam: 560, brick: 900, stone: 1250 };

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
}

export interface Stars {
  cracked: boolean;
  spare: boolean;
  great: boolean;
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
}

export interface AimPreview {
  points: Vec3[];
  hit: Vec3 | undefined;
  hitKind: BodyKind | undefined;
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
  readonly ammo: Record<AmmoKind, number>;
  selected: AmmoKind;
  phase: Phase = "aim";
  time = 0;
  reload = 0.4;
  cracked = false;
  won = false;
  resultAt: number | undefined;
  readonly stats = { shots: 0, bowled: 0, fall: 0, blocksMoved: 0, catches: 0 };
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
  private lastNearMiss = -10;
  private caughtAt = -10;
  private settledFor = 0;
  private lastShotAt = -10;
  private hoistRetryAt = 0;
  private hoist: { from: Vec3; to: Vec3; top: number; t: number; rotation: Quat; checked: boolean } | undefined;
  /** Where the stagehands last set him down; cleared by the next shot. */
  private releasedAt: Vec3 | undefined;
  private releaseTime = -10;
  /** Perches he slid off without being shot; the stagehands avoid them. */
  private readonly badPerches: Vec3[] = [];
  private pendingExplosions: Array<{ at: Vec3; radius: number; power: number; keg: boolean }> = [];
  private readonly startPositions = new Map<number, Vec3>();

  private constructor(level: LevelDef, seed: number) {
    this.level = level;
    this.rng = mulberry32(seed);
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = STEP;
    this.world.numSolverIterations = 8;
    this.queue = new RAPIER.EventQueue(true);
    this.ammo = { shot: 0, shell: 0, grape: 0, chain: 0, ...level.ammo };
    this.selected = (["shot", "shell", "grape", "chain"] as AmmoKind[]).find((kind) => this.ammo[kind] > 0) ?? "shot";
    this.perch = { ...level.humpty };
    this.peakY = level.humpty.y;
    this.buildStage();
    for (const piece of level.pieces) {
      if (piece.kind === "block") this.addBlock(piece.material, piece.pos, piece.size, piece.yaw);
      else if (piece.kind === "keg") this.addKeg(piece.pos);
      else this.addHay(piece.pos, piece.yaw);
    }
    this.addHumpty(level.humpty);
    for (const def of level.crews) this.addCrew(def);
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
    }));
  }

  get humptyId(): number | undefined {
    return this.humpty?.view.id;
  }

  get humptyPosition(): Vec3 | undefined {
    return this.humpty ? { ...this.humpty.view.position } : undefined;
  }

  get hoisting(): boolean {
    return this.hoist !== undefined;
  }

  get ammoLeft(): number {
    return this.ammo.shot + this.ammo.shell + this.ammo.grape + this.ammo.chain;
  }

  canFire(): boolean {
    return this.phase === "aim" && this.reload <= 0 && this.ammo[this.selected] > 0;
  }

  select(kind: AmmoKind): boolean {
    if (this.ammo[kind] <= 0) return false;
    this.selected = kind;
    return true;
  }

  stars(): Stars {
    const cracked = this.cracked;
    const spare = cracked && this.ammoLeft > 0;
    const great = cracked && this.stats.fall >= this.level.greatFall;
    return { cracked, spare, great, count: Number(cracked) + Number(spare) + Number(great) };
  }

  drainEvents(): GameEvent[] {
    return this.events.splice(0, this.events.length);
  }

  /** First thing a ray from the camera touches, for aiming. */
  raycast(origin: Vec3, direction: Vec3, maxDistance = 200): Vec3 | undefined {
    const ray = new RAPIER.Ray(origin, direction);
    const hit = this.world.castRay(ray, maxDistance, true, undefined, undefined, undefined, undefined, (collider) => {
      const owner = this.byCollider.get(collider.handle);
      return !owner || owner.view.kind !== "shard";
    });
    if (!hit) return undefined;
    return {
      x: origin.x + direction.x * hit.timeOfImpact,
      y: origin.y + direction.y * hit.timeOfImpact,
      z: origin.z + direction.z * hit.timeOfImpact,
    };
  }

  /** Ballistic path from the selected gun to `target`, cut where it first hits something. */
  aim(target: Vec3, kind: AmmoKind = this.selected): AimPreview {
    const spec = AMMO[kind];
    const pivot = spec.gun === "mortar" ? MORTAR_PIVOT : CANNON_PIVOT;
    const solution = solveLaunch(pivot, target, spec.speed, spec.lob);
    const t0 = BARREL_LENGTH[spec.gun] / spec.speed;
    const from = arcPoint(pivot, solution.velocity, t0);
    const velocity = arcVelocity(solution.velocity, t0);
    const points: Vec3[] = [from];
    let hit: Vec3 | undefined;
    let hitKind: BodyKind | undefined;
    const dt = 0.03;
    for (let step = 1; step < 220; step += 1) {
      const previous = points[points.length - 1]!;
      const next = arcPoint(from, velocity, step * dt);
      const segment = { x: next.x - previous.x, y: next.y - previous.y, z: next.z - previous.z };
      const length = lengthOf(segment);
      const direction = { x: segment.x / length, y: segment.y / length, z: segment.z / length };
      const ray = new RAPIER.Ray(previous, direction);
      const contact = this.world.castRay(ray, length, true, undefined, groups(G.PROJ, ALL & ~G.PROJ & ~G.DEBRIS));
      if (contact) {
        hit = {
          x: previous.x + direction.x * contact.timeOfImpact,
          y: previous.y + direction.y * contact.timeOfImpact,
          z: previous.z + direction.z * contact.timeOfImpact,
        };
        hitKind = this.byCollider.get(contact.collider.handle)?.view.kind;
        points.push(hit);
        break;
      }
      points.push(next);
      if (next.y < -1) break;
    }
    return { points, hit, hitKind, reachable: solution.reachable, from, velocity };
  }

  // ---------------------------------------------------------------- commands

  fire(target: Vec3): boolean {
    if (!this.canFire()) return false;
    const kind = this.selected;
    const preview = this.aim(target, kind);
    const { from, velocity } = preview;
    if (kind === "shot") {
      this.addProjectile("shot", from, velocity, 0.2, 28);
    } else if (kind === "shell") {
      this.addProjectile("shell", from, velocity, 0.26, 22);
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
      const spin = 6.5;
      const a = this.addProjectile(
        "chain",
        { x: from.x + side.x * 0.45, y: from.y, z: from.z + side.z * 0.45 },
        { x: velocity.x + forward.x * spin, y: velocity.y + forward.y * spin, z: velocity.z + forward.z * spin },
        0.17,
        14,
      );
      const b = this.addProjectile(
        "chain",
        { x: from.x - side.x * 0.45, y: from.y, z: from.z - side.z * 0.45 },
        { x: velocity.x - forward.x * spin, y: velocity.y - forward.y * spin, z: velocity.z - forward.z * spin },
        0.17,
        14,
      );
      this.world.createImpulseJoint(RAPIER.JointData.rope(1.25, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }), a.body, b.body, true);
      a.view.link = b.view.id;
      b.view.link = a.view.id;
    }
    this.ammo[kind] -= 1;
    this.stats.shots += 1;
    this.releasedAt = undefined;
    this.phase = "flight";
    this.reload = 1.25;
    this.lastShotAt = this.time;
    this.settledFor = 0;
    this.events.push({ type: "fire", ammo: kind, from, velocity });
    if (this.ammo[kind] <= 0) {
      const next = (["shot", "shell", "grape", "chain"] as AmmoKind[]).find((candidate) => this.ammo[candidate] > 0);
      if (next) this.selected = next;
    }
    return true;
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
    this.updateCrews();
    this.updateHoist();
    if (this.humpty) {
      const v = this.humpty.body.linvel();
      this.humptyVelocity = { x: v.x, y: v.y, z: v.z };
    }
    this.world.step(this.queue);
    this.time += STEP;
    this.handleCollisions();
    this.handleForces();
    this.handleExplosions();
    this.syncViews();
    this.updateHumpty();
    this.cleanUp();
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
    return this.register("block", material, size, body, [collider], { structural: true });
  }

  private addKeg(pos: Vec3): Entity {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setCcdEnabled(true).setSleeping(true),
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
    return this.register("keg", "powder", { x: KEG_RADIUS * 2, y: KEG_HALF_HEIGHT * 2, z: KEG_RADIUS * 2 }, body, [collider], { structural: true });
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
        .setSleeping(true),
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

  private addProjectile(kind: AmmoKind, from: Vec3, velocity: Vec3, radius: number, mass: number): Entity {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(from.x, from.y, from.z)
        .setLinvel(velocity.x, velocity.y, velocity.z)
        .setCcdEnabled(true)
        .setAngularDamping(0.4),
    );
    let desc = RAPIER.ColliderDesc.ball(radius)
      .setMass(mass)
      .setFriction(0.5)
      .setRestitution(kind === "grape" ? 0.3 : 0.12)
      .setCollisionGroups(GROUPS.proj);
    if (kind === "shell") desc = desc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    const collider = this.world.createCollider(desc, body);
    return this.register(kind, kind, { x: radius * 2, y: radius * 2, z: radius * 2 }, body, [collider], { ammo: kind });
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
    if (!humpty || this.cracked || this.hoist || !this.humptyAirborne) return undefined;
    const p = humpty.body.translation();
    const v = humpty.body.linvel();
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
        entity.body.setNextKinematicTranslation(at);
        entity.body.setNextKinematicRotation(rotation);
      });
    }
  }

  private stun(crew: CrewState, at: Vec3): void {
    if (crew.mode === "stunned" || this.won) return;
    crew.mode = "stunned";
    crew.modeUntil = this.time + (crew.kind === "cart" ? 3.2 : 3.8);
    crew.threatSince = -1;
    this.stats.bowled += 1;
    this.events.push({ type: "bowled", at: { ...at }, crewId: crew.id });
  }

  // Rapier invokes these callbacks while it holds borrows on the world, so they only
  // record what happened; bodies are removed after the drain completes.
  private handleCollisions(): void {
    const bursting = new Set<Entity>();
    this.queue.drainCollisionEvents((first, second, started) => {
      if (!started) return;
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
      this.pendingExplosions.push({ at: { x: at.x, y: at.y, z: at.z }, radius: 3.1, power: 620, keg: false });
      this.remove(shell);
    }
  }

  private handleForces(): void {
    const contacts: Array<{ a: Entity; b: Entity; force: number }> = [];
    this.queue.drainContactForceEvents((event) => {
      const a = this.byCollider.get(event.collider1());
      const b = this.byCollider.get(event.collider2());
      if (a && b) contacts.push({ a, b, force: event.totalForceMagnitude() });
    });
    for (const { a, b, force } of contacts) {
      for (const [me, other] of [[a, b], [b, a]] as const) {
        if (me.view.removed || other.view.removed) continue;
        if (me === this.humpty && !this.cracked && !this.hoist) this.humptyContact(other, force);
        if (me.crew && other.view.kind !== "ground") {
          const v = other.body.linvel();
          const crewSpeed = me.crew.speed;
          const relative = Math.hypot(
            v.x - Math.sin(me.crew.heading) * crewSpeed,
            v.y,
            v.z - Math.cos(me.crew.heading) * crewSpeed,
          );
          const hit = other.ammo ? relative > 2 : relative > 3.4;
          if (hit && other !== this.humpty) this.stun(me.crew, me.view.position);
        }
        if (me.view.kind === "keg" && me.fuseAt === undefined && (force * STEP) / me.mass > 25) {
          me.fuseAt = this.time + 0.02;
        }
      }
    }
  }

  private humptyContact(other: Entity, force: number): void {
    if (other.ammo) {
      this.lastNearMiss = this.time;
      return;
    }
    if (other.view.kind === "shard" || other.view.kind === "crown") return;
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
    for (const entity of this.entities.values()) {
      if (entity.view.kind === "keg" && entity.fuseAt !== undefined && this.time >= entity.fuseAt) {
        const at = entity.body.translation();
        this.pendingExplosions.push({ at: { x: at.x, y: at.y, z: at.z }, radius: 3.6, power: 900, keg: true });
        this.remove(entity);
      }
    }
    const blasts = this.pendingExplosions.splice(0, this.pendingExplosions.length);
    for (const blast of blasts) {
      this.events.push({ type: "explode", at: blast.at, radius: blast.radius, keg: blast.keg });
      for (const entity of this.entities.values()) {
        const p = entity.body.translation();
        const gap = distance(p, blast.at);
        if (gap > blast.radius) continue;
        const falloff = 1 - gap / blast.radius;
        if (entity.crew) {
          this.stun(entity.crew, entity.view.position);
          continue;
        }
        if (!entity.body.isDynamic()) continue;
        if (entity.view.kind === "keg" && entity.fuseAt === undefined) {
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

  private crackHumpty(speed: number): void {
    const humpty = this.humpty;
    if (!humpty || this.cracked || this.phase === "lost") return;
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

    const resting = speed < REST_SPEED && spin < 0.6;
    this.restTimer = resting ? this.restTimer + STEP : 0;
    if (resting && this.restTimer > 0.1) this.humptyAirborne = false;

    const surface = this.restTimer > 0.7 ? this.supportKind(humpty) : "ground";
    if (this.restTimer > 0.7 && surface !== "ground") this.holdCarriers(humpty);
    if (this.restTimer > 0.7 && (p.y < 1.65 || surface !== "ground")) {
      if (this.awaitingLanding) {
        this.awaitingLanding = false;
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
      if (this.restTimer > 1.3 && this.ammoLeft > 0 && this.time >= this.hoistRetryAt) this.startHoist();
    }

    if (this.humptyAirborne) this.humptyMood = "falling";
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
      const hit = this.world.castRayAndGetNormal(ray, 60, true, undefined, undefined, undefined, undefined, (collider) => {
        const owner = this.byCollider.get(collider.handle);
        return Boolean(owner?.structural && owner.view.kind === "block");
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

  private findPerch(): Vec3 | undefined {
    const humpty = this.humpty;
    if (!humpty) return undefined;
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
    this.hoist = { from, to, top, t: 0, rotation: { x: r.x, y: r.y, z: r.z, w: r.w }, checked: false };
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
      if (entity.ammo) {
        const speed = lengthOf(entity.body.linvel());
        entity.restFor = speed < 0.4 ? entity.restFor + STEP : 0;
        if (entity.view.kind === "grape" && entity.restFor > 2.5) this.remove(entity);
      }
    }
  }

  private isSettled(): boolean {
    for (const entity of this.entities.values()) {
      if (!entity.body.isDynamic() || entity.body.isSleeping()) continue;
      if (lengthOf(entity.body.linvel()) > 0.35) return false;
    }
    return this.pendingExplosions.length === 0;
  }

  private updatePhase(): void {
    if (this.reload > 0) this.reload = Math.max(0, this.reload - STEP);
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
      if (this.settledFor > 1.2 || this.time - this.lastShotAt > 14) {
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
