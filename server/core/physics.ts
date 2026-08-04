import RAPIER from "@dimforge/rapier3d-compat";
import {
  CORE_FIXED_DT,
  CORE_STAGE,
  CONNECTION_CLASSES,
  type CoreBodyKind,
  type CoreBodyState,
  type CoreDiagnostics,
  type QueenAdvantageState,
  type CoreShape,
  type ConnectionClass,
  type PartFamily,
  type Quat,
  type Team,
  type TransformWriteRecord,
  type Vec3,
} from "../../shared/core-protocol.js";
import {
  INVENTORY_COUNT,
  INVENTORY_DEFINITIONS,
  TEAM_WORKERS,
  inventoryId,
} from "./catalog.js";
import { connectionClassSupportsFamilies } from "./connections.js";

let rapierInitialization: Promise<void> | undefined;

function initializeRapier(): Promise<void> {
  rapierInitialization ??= RAPIER.init();
  return rapierInitialization;
}

const TOWER_YAW = (14 * Math.PI) / 180;
const TOWER_BLOCK = { length: 1.54, width: 0.5, height: 0.26 } as const;
const TOWER_COURSES = 12;
const TOWER_BLOCKS_PER_COURSE = 3;
// The stage timbers are hollow oak props: heavy, but one worker can recover one slowly.
const TOWER_BLOCK_MASS = 36;
const TOWER_GAP = 0.02;
const CRADLE_CENTER_Y = TOWER_COURSES * TOWER_BLOCK.height + 0.21;
const HUMPTY_CENTER_Y = CRADLE_CENTER_Y + 1.01;
const RAM_SADDLE_PITCH = 0;
const RAM_SADDLE_FORWARD = .52;
const RAM_SADDLE_HEIGHT = .19;
const SUPPORT_EPSILON = 0.025;
const WORKER_COLLISION_GROUP = 0x0004;
const QUEEN_ENGINE_COLLISION_GROUP = 0x1000;
const QUEEN_PROJECTILE_COLLISION_GROUP = 0x2000;
const ALL_COLLISION_GROUPS = 0xffff;

export interface BodyRecord {
  id: string;
  kind: CoreBodyKind;
  shape: CoreShape;
  body: RAPIER.RigidBody;
  colliders: RAPIER.Collider[];
  size: Vec3;
  dynamic: boolean;
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

interface InventoryPlacement {
  position: Vec3;
  yaw: number;
  roll?: number;
}

export interface CharacterMoveResult {
  moved: Vec3;
  grounded: boolean;
  collisions: number;
}

interface CharacterRecord {
  controller: RAPIER.KinematicCharacterController;
  collider: RAPIER.Collider;
  facing: Vec3;
}

export class CorePhysicsWorld {
  readonly world: RAPIER.World;
  readonly records = new Map<string, BodyRecord>();
  readonly writes: TransformWriteRecord[] = [];
  readonly seed: number;

  private readonly characters = new Map<string, CharacterRecord>();
  private readonly colliderOwners = new Map<number, string>();
  private readonly assemblyJoints = new Map<string, RAPIER.ImpulseJoint>();
  private readonly assemblyJointClasses = new Map<string, ConnectionClass>();
  private readonly assemblyJointBodies = new Map<string, readonly [string, string]>();
  private readonly assemblyRopeLengths = new Map<string, number>();

  private initialized = false;
  private tickValue = 0;
  private lateCreatedInventory = 0;
  private renderPoseDivergence = 0;
  private workerPenetrations = 0;
  private deepBodyPenetrations = 0;
  private carriedPartPenetrations = 0;
  private readonly queenBoltImpactIds = new Set<string>();
  private penetrationEvidenceRecords: Array<{
    tick: number;
    firstId: string;
    secondId: string;
    depth: number;
    carried: boolean;
  }> = [];
  private initialInventoryIds = new Set<string>();

  private constructor(seed: number) {
    this.seed = seed;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.integrationParameters.dt = CORE_FIXED_DT;
    this.world.integrationParameters.maxCcdSubsteps = 8;
    this.world.integrationParameters.numSolverIterations = 20;
    this.world.integrationParameters.numAdditionalFrictionIterations = 4;
    this.world.integrationParameters.numInternalPgsIterations = 2;
    this.createStage();
    this.createLiteralTower();
    this.createCradle();
    this.createHumpty();
    this.createInventoryRacks();
    this.createOpeningInventory();
    this.createWorkers();
  }

  static async create(seed: number): Promise<CorePhysicsWorld> {
    await initializeRapier();
    const physics = new CorePhysicsWorld(seed);
    physics.settleInitialization(180);
    physics.initialized = true;
    physics.initialInventoryIds = new Set(
      [...physics.records.values()]
        .filter((record) => record.kind === "part")
        .map((record) => record.id),
    );
    physics.tickValue = 0;
    return physics;
  }

  get tick(): number {
    return this.tickValue;
  }

  step(): void {
    this.world.step();
    this.tickValue += 1;
    this.resolveQueenBoltImpacts();
    this.auditInventory();
    this.auditPenetrations();
  }

  free(): void {
    for (const character of this.characters.values()) character.controller.free();
    this.world.free();
  }

  moveCharacter(
    workerId: string,
    desired: Vec3,
    facing?: Vec3,
    allowBlockedRise = false,
  ): CharacterMoveResult | undefined {
    const worker = this.records.get(workerId);
    const character = this.characters.get(workerId);
    if (!worker || !character) return undefined;
    const collisionFilter = (candidate: RAPIER.Collider): boolean => {
      const ownerId = this.colliderOwners.get(candidate.handle);
      const candidateRecord = ownerId ? this.records.get(ownerId) : undefined;
      return !candidateRecord?.carriedBy?.includes(workerId);
    };
    character.controller.computeColliderMovement(
      character.collider,
      desired,
      undefined,
      undefined,
      collisionFilter,
    );
    let movement = toVec3(character.controller.computedMovement());
    const requestedHorizontal = Math.hypot(desired.x, desired.z);
    if (
      requestedHorizontal > .002 &&
      Math.hypot(movement.x, movement.z) > requestedHorizontal * 1.25 &&
      this.characterCollisionsAreFloorOnly(character.controller)
    ) {
      movement = { x: desired.x, y: movement.y, z: desired.z };
    }
    if (
      requestedHorizontal > .002 &&
      Math.hypot(movement.x, movement.z) < requestedHorizontal * .45 &&
      this.characterCollisionsAreFloorOnly(character.controller)
    ) {
      character.controller.computeColliderMovement(
        character.collider,
        { ...desired, y: 0 },
        undefined,
        undefined,
        collisionFilter,
      );
      movement = toVec3(character.controller.computedMovement());
      if (
        Math.hypot(movement.x, movement.z) < requestedHorizontal * .45 &&
        this.characterCollisionsAreFloorOnly(character.controller)
      ) {
        movement = { x: desired.x, y: movement.y, z: desired.z };
      }
    }
    if (
      requestedHorizontal > .002 &&
      Math.hypot(movement.x, movement.z) < requestedHorizontal * .45
    ) {
      movement = { x: 0, y: allowBlockedRise ? movement.y : Math.min(0, movement.y), z: 0 };
    }
    const current = worker.body.translation();
    worker.body.setNextKinematicTranslation({
      x: current.x + movement.x,
      y: current.y + movement.y,
      z: current.z + movement.z,
    });
    if (facing && Math.hypot(facing.x, facing.z) > 0.001) {
      const length = Math.hypot(facing.x, facing.z);
      character.facing = { x: facing.x / length, y: 0, z: facing.z / length };
      const yaw = Math.atan2(character.facing.x, character.facing.z);
      worker.body.setNextKinematicRotation(yawQuat(yaw));
    }
    return {
      moved: movement,
      grounded: character.controller.computedGrounded(),
      collisions: character.controller.numComputedCollisions(),
    };
  }

  moveCharactersTogether(
    requests: Array<{ workerId: string; desired: Vec3; facing: Vec3 }>,
  ): Map<string, CharacterMoveResult> {
    const pending: Array<{
      workerId: string;
      worker: BodyRecord;
      character: CharacterRecord;
      desired: Vec3;
      facing: Vec3;
      movement: Vec3;
      grounded: boolean;
      collisions: number;
    }> = [];
    let blocked = false;
    for (const request of requests) {
      const worker = this.records.get(request.workerId);
      const character = this.characters.get(request.workerId);
      if (!worker || !character) continue;
      const collisionFilter = (candidate: RAPIER.Collider): boolean => {
        const ownerId = this.colliderOwners.get(candidate.handle);
        const candidateRecord = ownerId ? this.records.get(ownerId) : undefined;
        return !candidateRecord?.carriedBy?.includes(request.workerId);
      };
      character.controller.computeColliderMovement(
        character.collider,
        request.desired,
        undefined,
        undefined,
        collisionFilter,
      );
      let movement = toVec3(character.controller.computedMovement());
      const requestedHorizontal = Math.hypot(request.desired.x, request.desired.z);
      let movedHorizontal = Math.hypot(movement.x, movement.z);
      if (
        requestedHorizontal > .002 &&
        movedHorizontal > requestedHorizontal * 1.25 &&
        this.characterCollisionsAreFloorOnly(character.controller)
      ) {
        movement = { x: request.desired.x, y: movement.y, z: request.desired.z };
        movedHorizontal = requestedHorizontal;
      }
      if (
        requestedHorizontal > .002 &&
        movedHorizontal < requestedHorizontal * .45 &&
        this.characterCollisionsAreFloorOnly(character.controller)
      ) {
        character.controller.computeColliderMovement(
          character.collider,
          { ...request.desired, y: 0 },
          undefined,
          undefined,
          collisionFilter,
        );
        movement = toVec3(character.controller.computedMovement());
        movedHorizontal = Math.hypot(movement.x, movement.z);
        if (
          movedHorizontal < requestedHorizontal * .45 &&
          this.characterCollisionsAreFloorOnly(character.controller)
        ) {
          movement = { x: request.desired.x, y: movement.y, z: request.desired.z };
          movedHorizontal = requestedHorizontal;
        }
      }
      if (requestedHorizontal > .002 && movedHorizontal < requestedHorizontal * .45) blocked = true;
      pending.push({
        workerId: request.workerId,
        worker,
        character,
        desired: request.desired,
        facing: request.facing,
        movement,
        grounded: character.controller.computedGrounded(),
        collisions: character.controller.numComputedCollisions(),
      });
    }
    const results = new Map<string, CharacterMoveResult>();
    for (const item of pending) {
      const movement = blocked
        ? { x: 0, y: Math.min(0, item.movement.y), z: 0 }
        : item.movement;
      const current = item.worker.body.translation();
      item.worker.body.setNextKinematicTranslation({
        x: current.x + movement.x,
        y: current.y + movement.y,
        z: current.z + movement.z,
      });
      if (!blocked && Math.hypot(item.facing.x, item.facing.z) > .001) {
        const length = Math.hypot(item.facing.x, item.facing.z);
        item.character.facing = {
          x: item.facing.x / length,
          y: 0,
          z: item.facing.z / length,
        };
        const yaw = Math.atan2(item.character.facing.x, item.character.facing.z);
        item.worker.body.setNextKinematicRotation(yawQuat(yaw));
      }
      results.set(item.workerId, {
        moved: movement,
        grounded: item.grounded,
        collisions: item.collisions,
      });
    }
    return results;
  }

  private characterCollisionsAreFloorOnly(
    controller: RAPIER.KinematicCharacterController,
  ): boolean {
    if (controller.numComputedCollisions() === 0) return false;
    for (let index = 0; index < controller.numComputedCollisions(); index += 1) {
      const collision = controller.computedCollision(index);
      if (!collision?.collider) return false;
      const ownerId = this.colliderOwners.get(collision.collider.handle);
      if (!ownerId || this.records.get(ownerId)?.kind !== "floor") return false;
    }
    return true;
  }

  characterFacing(workerId: string): Vec3 | undefined {
    const facing = this.characters.get(workerId)?.facing;
    return facing ? { ...facing } : undefined;
  }

  setCharacterPushesBodies(workerId: string, enabled: boolean): void {
    this.characters.get(workerId)?.controller.setApplyImpulsesToDynamicBodies(enabled);
  }

  applyImpulseAtPoint(
    partId: string,
    impulse: Vec3,
    worldPoint: Vec3,
  ): boolean {
    const part = this.records.get(partId);
    if (!part?.dynamic) return false;
    part.body.applyImpulseAtPoint(impulse, worldPoint, true);
    return true;
  }

  bodyLinearVelocity(id: string): Vec3 | undefined {
    const record = this.records.get(id);
    return record ? toVec3(record.body.linvel()) : undefined;
  }

  applyDamage(id: string, amount: number): number | undefined {
    const record = this.records.get(id);
    if (record?.integrity === undefined || !Number.isFinite(amount) || amount <= 0) {
      return record?.integrity;
    }
    record.integrity = Math.max(0, record.integrity - amount);
    return record.integrity;
  }

  queenAdvantageState(): QueenAdvantageState {
    const device = this.records.get("queen-command-post");
    const boltIds = ["queen-crown-bolt-1", "queen-crown-bolt-2"];
    const firedBoltIds = boltIds.filter((id) => this.records.get(id)?.variant?.startsWith("spent"));
    const deviceIntegrity = device?.integrity ?? 0;
    const charges = Math.max(0, boltIds.length - firedBoltIds.length);
    return {
      deviceId: "queen-command-post",
      deviceIntegrity,
      charges,
      maxCharges: boltIds.length,
      armed: deviceIntegrity > 0 && charges > 0,
      disabled: deviceIntegrity <= 0,
      firedBoltIds,
    };
  }

  ensureQueenAdvantage(): void {
    if (!this.records.has("queen-command-post")) this.createQueenAdvantage();
  }

  fireQueenBolt(targetId = "humpty"): { ok: boolean; boltId?: string; message?: string } {
    const state = this.queenAdvantageState();
    if (state.disabled) return { ok: false, message: "The Queen's command post is broken." };
    if (state.charges <= 0) return { ok: false, message: "The Queen's crown bolts are spent." };
    const target = this.bodyPosition(targetId);
    if (!target) return { ok: false, message: "The crown bolt has no target." };
    const bolt = ["queen-crown-bolt-1", "queen-crown-bolt-2"]
      .map((id) => this.records.get(id))
      .find((record) => record && !record.variant?.startsWith("spent"));
    if (!bolt) return { ok: false, message: "No unfired crown bolt remains." };
    const origin = this.bodyPosition(bolt.id);
    if (!origin) return { ok: false, message: "The crown bolt has no physical origin." };
    const direction = normalizeVec(subtractVec({ ...target, y: target.y + .8 }, origin));
    bolt.body.setGravityScale(1, true);
    for (const collider of bolt.colliders) {
      collider.setSensor(false);
      collider.setCollisionGroups(interactionGroups(
        QUEEN_PROJECTILE_COLLISION_GROUP,
        ALL_COLLISION_GROUPS,
      ));
    }
    this.applyImpulse(bolt.id, scaleVec(direction, 75));
    this.applyTorqueImpulse(bolt.id, { x: 1.2, y: 2.1, z: .8 });
    bolt.variant = `spent crown bolt ${state.charges}`;
    return { ok: true, boltId: bolt.id };
  }

  strikeQueenDevice(actorIds: readonly string[]): { ok: boolean; integrity?: number; message?: string } {
    const device = this.records.get("queen-command-post");
    const devicePosition = this.bodyPosition("queen-command-post");
    if (!device || !devicePosition || device.kind !== "queen-device") {
      return { ok: false, message: "The Queen's command post is missing." };
    }
    if ((device.integrity ?? 0) <= 0) return { ok: false, message: "The command post is already broken." };
    const positions = actorIds
      .map((id) => this.bodyPosition(id))
      .filter((position): position is Vec3 => Boolean(position));
    if (positions.length !== actorIds.length || positions.length === 0) {
      return { ok: false, message: "The striking crew has no physical formation." };
    }
    const center = positions.reduce((sum, position) => addVec(sum, position), { x: 0, y: 0, z: 0 });
    center.x /= positions.length;
    center.y /= positions.length;
    center.z /= positions.length;
    if (Math.hypot(devicePosition.x - center.x, devicePosition.z - center.z) > 1.85) {
      return { ok: false, message: "The striking crew is out of reach." };
    }
    const direction = normalizeVec({
      x: devicePosition.x - center.x,
      y: .18,
      z: devicePosition.z - center.z,
    });
    this.applyImpulse("queen-command-post", scaleVec(direction, 3.6 * positions.length));
    const integrity = this.applyDamage("queen-command-post", 28 * positions.length) ?? 0;
    if (integrity <= 0) device.variant = "broken queen command post";
    return { ok: true, integrity };
  }

  settleBody(id: string): boolean {
    const record = this.records.get(id);
    if (!record?.dynamic) return false;
    record.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
    record.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
    record.body.sleep();
    return true;
  }

  bodyAngularVelocity(id: string): Vec3 | undefined {
    const record = this.records.get(id);
    return record ? toVec3(record.body.angvel()) : undefined;
  }

  setCarried(partId: string, workerIds: string[], removeFromStorage = true): void {
    const part = this.records.get(partId);
    if (!part || part.kind !== "part") return;
    part.carriedBy = [...workerIds];
    if (removeFromStorage) part.stored = false;
    this.setPartWorkerCollisions(partId, false);
    part.body.wakeUp();
  }

  clearCarried(partId: string): void {
    const part = this.records.get(partId);
    if (!part || part.kind !== "part") return;
    delete part.carriedBy;
    const attachedRope = part.family === "rope" && [...this.assemblyJointBodies].some(
      ([connectionId, bodyIds]) =>
        this.assemblyJointClasses.get(connectionId) === "ROPE_ATTACH" && bodyIds.includes(partId),
    );
    this.setPartWorkerCollisions(partId, !attachedRope);
  }

  setPartWorkerCollisions(partId: string, enabled: boolean): void {
    const part = this.records.get(partId);
    if (!part || part.kind !== "part") return;
    for (const collider of part.colliders) {
      collider.setCollisionGroups(interactionGroups(
        ALL_COLLISION_GROUPS,
        enabled ? ALL_COLLISION_GROUPS : ALL_COLLISION_GROUPS & ~WORKER_COLLISION_GROUP,
      ));
    }
  }

  private setPartSensors(partId: string, enabled: boolean): void {
    const part = this.records.get(partId);
    if (!part || part.kind !== "part") return;
    for (const collider of part.colliders) collider.setSensor(enabled);
  }

  applyImpulse(bodyId: string, impulse: Vec3, torque?: Vec3): boolean {
    const record = this.records.get(bodyId);
    if (!record?.dynamic) return false;
    record.body.applyImpulse(impulse, true);
    if (torque) record.body.applyTorqueImpulse(torque, true);
    return true;
  }

  applyTorqueImpulse(bodyId: string, impulse: Vec3): boolean {
    const record = this.records.get(bodyId);
    if (!record?.dynamic) return false;
    record.body.applyTorqueImpulse(impulse, true);
    return true;
  }

  createAssemblyJoint(
    connectionId: string,
    connectionClass: ConnectionClass,
    firstId: string,
    secondId: string,
  ): boolean {
    if (this.assemblyJoints.has(connectionId)) return false;
    const first = this.records.get(firstId);
    const second = this.records.get(secondId);
    if (!first?.dynamic || !second?.dynamic) return false;
    if (!connectionClassSupportsFamilies(connectionClass, first.family, second.family)) return false;
    const firstPosition = toVec3(first.body.translation());
    const secondPosition = toVec3(second.body.translation());
    const firstRotation = toQuat(first.body.rotation());
    const secondRotation = toQuat(second.body.rotation());
    const axle = first.family === "axle" ? first : second.family === "axle" ? second : undefined;
    const plank = first.family === "plank" ? first : second.family === "plank" ? second : undefined;
    const coaxialPosition = first.family === "wheel" || first.family === "hub" ||
        first.family === "sheave" || first.family === "drum"
      ? firstPosition
      : second.family === "wheel" || second.family === "hub" ||
          second.family === "sheave" || second.family === "drum"
        ? secondPosition
        : undefined;
    const hub = first.family === "hub" ? first : second.family === "hub" ? second : undefined;
    const joinedPart = hub?.id === first.id ? second : first;
    const joinedPosition = hub?.id === first.id ? secondPosition : firstPosition;
    const towardJoinedPart = hub ? normalizeVec(subtractVec(joinedPosition, toVec3(hub.body.translation()))) : undefined;
    const beam = first.family === "beam" ? first : second.family === "beam" ? second : undefined;
    const beamPlankAnchor = beam && plank
      ? (() => {
        const plankPosition = toVec3(plank.body.translation());
        const plankRotation = toQuat(plank.body.rotation());
        const plankAxis = normalizeVec(rotateVector3({ x: 0, y: 0, z: 1 }, plankRotation));
        const plankUp = normalizeVec(rotateVector3({ x: 0, y: 1, z: 0 }, plankRotation));
        const beamPosition = toVec3(beam.body.translation());
        const beamRotation = toQuat(beam.body.rotation());
        const beamAxis = normalizeVec(rotateVector3({ x: 0, y: 0, z: 1 }, beamRotation));
        const deckHeight = plank.size.y / 2 + .09;
        const isDeckJoint = dotVec(subtractVec(beamPosition, plankPosition), plankUp) > deckHeight;
        if (isDeckJoint) {
          const isAngledRam = Math.abs(dotVec(beamAxis, plankAxis)) < Math.cos(10 * Math.PI / 180);
          return addVec(
            plankPosition,
            addVec(
              scaleVec(plankAxis, isAngledRam ? RAM_SADDLE_FORWARD : .35),
              scaleVec(plankUp, isAngledRam ? RAM_SADDLE_HEIGHT : deckHeight),
            ),
          );
        }
        const sign = dotVec(subtractVec(beamPosition, plankPosition), plankAxis) >= 0 ? 1 : -1;
        return addVec(plankPosition, scaleVec(plankAxis, sign * plank.size.z / 2));
      })()
      : undefined;
    const worldAnchor = connectionClass === "AXLE_BEARING" && axle && plank
      ? toVec3(axle.body.translation())
      : (connectionClass === "AXLE_BEARING" || connectionClass === "KEYED_COAXIAL") &&
          coaxialPosition
      ? coaxialPosition
      : hub && joinedPart.family === "beam" && towardJoinedPart
        ? addVec(toVec3(hub.body.translation()), scaleVec(towardJoinedPart, hub.size.x / 2))
      : beamPlankAnchor
        ? beamPlankAnchor
      : {
        x: (firstPosition.x + secondPosition.x) / 2,
        y: (firstPosition.y + secondPosition.y) / 2,
        z: (firstPosition.z + secondPosition.z) / 2,
      };
    const firstAnchor = inverseRotateVector(subtractVec(worldAnchor, firstPosition), firstRotation);
    const secondAnchor = inverseRotateVector(subtractVec(worldAnchor, secondPosition), secondRotation);
    const data = connectionClass === "ROPE_ATTACH"
      ? RAPIER.JointData.rope(3.5, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })
      : connectionClass === "AXLE_BEARING"
        ? RAPIER.JointData.spherical(firstAnchor, secondAnchor)
        : RAPIER.JointData.fixed(
        firstAnchor,
        { x: 0, y: 0, z: 0, w: 1 },
        secondAnchor,
        multiplyQuat(inverseQuat(secondRotation), firstRotation),
      );
    const joint = this.world.createImpulseJoint(data, first.body, second.body, true);
    joint.setContactsEnabled(connectionClass === "ROPE_ATTACH");
    this.assemblyJoints.set(connectionId, joint);
    this.assemblyJointClasses.set(connectionId, connectionClass);
    this.assemblyJointBodies.set(connectionId, [firstId, secondId]);
    if (connectionClass === "ROPE_ATTACH") {
      this.assemblyRopeLengths.set(connectionId, 3.5);
      const ropeId = first.family === "rope" ? firstId : secondId;
      this.setPartWorkerCollisions(ropeId, false);
      this.setPartSensors(ropeId, true);
    }
    return true;
  }

  ropeJointLength(connectionId: string): number | undefined {
    return this.assemblyRopeLengths.get(connectionId);
  }

  setRopeJointLength(connectionId: string, requestedLength: number): boolean {
    if (this.assemblyJointClasses.get(connectionId) !== "ROPE_ATTACH") return false;
    const bodyIds = this.assemblyJointBodies.get(connectionId);
    const oldJoint = this.assemblyJoints.get(connectionId);
    if (!bodyIds || !oldJoint) return false;
    const first = this.records.get(bodyIds[0]);
    const second = this.records.get(bodyIds[1]);
    if (!first?.dynamic || !second?.dynamic) return false;
    const length = Math.max(.12, Math.min(3.5, requestedLength));
    this.world.removeImpulseJoint(oldJoint, true);
    const joint = this.world.createImpulseJoint(
      RAPIER.JointData.rope(length, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }),
      first.body,
      second.body,
      true,
    );
    joint.setContactsEnabled(true);
    this.assemblyJoints.set(connectionId, joint);
    this.assemblyRopeLengths.set(connectionId, length);
    return true;
  }

  removeAssemblyJoint(connectionId: string): boolean {
    const joint = this.assemblyJoints.get(connectionId);
    if (!joint) return false;
    const connectionClass = this.assemblyJointClasses.get(connectionId);
    const bodyIds = this.assemblyJointBodies.get(connectionId);
    this.world.removeImpulseJoint(joint, true);
    this.assemblyJoints.delete(connectionId);
    this.assemblyJointClasses.delete(connectionId);
    this.assemblyJointBodies.delete(connectionId);
    this.assemblyRopeLengths.delete(connectionId);
    if (connectionClass === "ROPE_ATTACH" && bodyIds) {
      const ropeId = bodyIds.find((id) => this.records.get(id)?.family === "rope");
      const rope = ropeId ? this.records.get(ropeId) : undefined;
      const stillAttached = ropeId && [...this.assemblyJointBodies].some(
        ([remainingId, remainingBodies]) =>
          this.assemblyJointClasses.get(remainingId) === "ROPE_ATTACH" &&
          remainingBodies.includes(ropeId),
      );
      if (ropeId && !rope?.carriedBy && !stillAttached) {
        this.setPartWorkerCollisions(ropeId, true);
        this.setPartSensors(ropeId, false);
      }
    }
    return true;
  }

  recordRenderDivergence(distance: number): void {
    this.renderPoseDivergence = Math.max(0, distance);
  }

  forcePoseForTest(
    bodyId: string,
    position: Vec3,
    callSite: string,
  ): boolean {
    const record = this.records.get(bodyId);
    if (!record) return false;
    this.writePose(record, position, toQuat(record.body.rotation()), callSite);
    return true;
  }

  snapshotBodies(): CoreBodyState[] {
    return [...this.records.values()].map((record) => {
      const body: CoreBodyState = {
        id: record.id,
        kind: record.kind,
        shape: record.shape,
        position: toVec3(record.body.translation()),
        rotation: toQuat(record.body.rotation()),
        size: { ...record.size },
        dynamic: record.dynamic,
        sleeping: record.body.isSleeping(),
      };
      if (record.team) body.team = record.team;
      if (record.family) body.family = record.family;
      if (record.variant) body.variant = record.variant;
      if (record.course !== undefined) body.course = record.course;
      if (record.lane !== undefined) body.lane = record.lane;
      if (record.axis) body.axis = record.axis;
      if (record.stored !== undefined) body.stored = record.stored;
      if (record.carriedBy) body.carriedBy = [...record.carriedBy];
      if (record.integrity !== undefined) body.integrity = record.integrity;
      return body;
    });
  }

  diagnostics(): CoreDiagnostics {
    const towerBodies = [...this.records.values()].filter(
      (record) => record.kind === "tower-block",
    ).length;
    const inventoryByTeam = { king: 0, queen: 0 };
    for (const record of this.records.values()) {
      if (record.kind === "part" && record.team) inventoryByTeam[record.team] += 1;
    }
    const jointsByClass = Object.fromEntries(
      CONNECTION_CLASSES.map((connectionClass) => [connectionClass, 0]),
    ) as Record<ConnectionClass, number>;
    for (const connectionClass of this.assemblyJointClasses.values()) {
      jointsByClass[connectionClass] += 1;
    }
    const diagnostics: CoreDiagnostics = {
      physicsAdapter: "rapier3d",
      physicsWorlds: 1,
      units: "m-kg-s-N-Nm",
      fixedHz: 60,
      dynamicBodies: [...this.records.values()].filter((record) => record.dynamic)
        .length,
      activeJoints: this.world.impulseJoints.len(),
      jointsByClass,
      towerBodies,
      inventoryByTeam,
      illegalTransformWrites: this.writes.filter(
        (write) => write.classification === "illegal-gameplay",
      ).length,
      workerPenetrations: this.workerPenetrations,
      deepBodyPenetrations: this.deepBodyPenetrations,
      carriedPartPenetrations: this.carriedPartPenetrations,
      lateCreatedInventory: this.lateCreatedInventory,
      renderPoseDivergence: this.renderPoseDivergence,
      humptyCradleContacts: this.contactCount("humpty", "central-cradle"),
      cradleTowerContacts: this.cradleTowerContactCount(),
      humptyVisibleSupportGap: this.humptySupportGap(),
      llmEnabled: false,
    };
    const lastWrite = this.writes.at(-1);
    if (lastWrite) diagnostics.lastWrite = lastWrite;
    return diagnostics;
  }

  contactCount(firstId: string, secondId: string): number {
    const first = this.records.get(firstId);
    const second = this.records.get(secondId);
    if (!first || !second) return 0;
    let contacts = 0;
    for (const colliderA of first.colliders) {
      for (const colliderB of second.colliders) {
        this.world.contactPair(colliderA, colliderB, (manifold) => {
          for (let index = 0; index < manifold.numSolverContacts(); index += 1) {
            if (manifold.solverContactDist(index) <= SUPPORT_EPSILON) contacts += 1;
          }
        });
      }
    }
    return contacts;
  }

  supportForce(bodyId: string): number {
    const record = this.records.get(bodyId);
    if (!record) return 0;
    let impulse = 0;
    for (const collider of record.colliders) {
      this.world.contactPairsWith(collider, (other) => {
        this.world.contactPair(collider, other, (manifold) => {
          for (let index = 0; index < manifold.numContacts(); index += 1) {
            impulse += Math.abs(manifold.contactImpulse(index));
          }
        });
      });
    }
    return impulse / CORE_FIXED_DT;
  }

  bodyPosition(id: string): Vec3 | undefined {
    const record = this.records.get(id);
    return record ? toVec3(record.body.translation()) : undefined;
  }

  bodyRotation(id: string): Quat | undefined {
    const record = this.records.get(id);
    return record ? toQuat(record.body.rotation()) : undefined;
  }

  deepestContactDistance(firstId: string, secondId: string): number | undefined {
    const first = this.records.get(firstId);
    const second = this.records.get(secondId);
    if (!first || !second) return undefined;
    let deepest: number | undefined;
    for (const colliderA of first.colliders) {
      for (const colliderB of second.colliders) {
        this.world.contactPair(colliderA, colliderB, (manifold) => {
          for (let index = 0; index < manifold.numSolverContacts(); index += 1) {
            const distance = manifold.solverContactDist(index);
            deepest = deepest === undefined ? distance : Math.min(deepest, distance);
          }
        });
      }
    }
    return deepest;
  }

  towerBlockIds(): string[] {
    return [...this.records.values()]
      .filter((record) => record.kind === "tower-block")
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((record) => record.id);
  }

  inventoryIds(team?: Team): string[] {
    return [...this.records.values()]
      .filter(
        (record) =>
          record.kind === "part" && (team === undefined || record.team === team),
      )
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((record) => record.id);
  }

  workerIds(team?: Team): string[] {
    return [...this.records.values()]
      .filter(
        (record) =>
          record.kind === "worker" && (team === undefined || record.team === team),
      )
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((record) => record.id);
  }

  penetrationEvidence(): ReadonlyArray<{
    tick: number;
    firstId: string;
    secondId: string;
    depth: number;
    carried: boolean;
  }> {
    return this.penetrationEvidenceRecords;
  }

  private createStage(): void {
    this.createFixedBox(
      "stage-floor",
      "floor",
      {
        x: 0,
        y: -CORE_STAGE.floorThickness / 2,
        z: 0,
      },
      {
        x: CORE_STAGE.width,
        y: CORE_STAGE.floorThickness,
        z: CORE_STAGE.depth,
      },
      1.05,
    );
    this.createFixedBox(
      "fortress-wall",
      "wall",
      { x: 0, y: 4.2, z: CORE_STAGE.backWallZ },
      { x: CORE_STAGE.width, y: 8.4, z: 0.5 },
      0.9,
    );
    this.createFixedBox(
      "stage-left-boundary",
      "wall",
      { x: -CORE_STAGE.width / 2 - 0.15, y: 1.3, z: 0 },
      { x: 0.3, y: 2.6, z: CORE_STAGE.depth },
      0.8,
    );
    this.createFixedBox(
      "stage-right-boundary",
      "wall",
      { x: CORE_STAGE.width / 2 + 0.15, y: 1.3, z: 0 },
      { x: 0.3, y: 2.6, z: CORE_STAGE.depth },
      0.8,
    );
  }

  private createLiteralTower(): void {
    const laneSpacing = TOWER_BLOCK.width + TOWER_GAP;
    for (let course = 0; course < TOWER_COURSES; course += 1) {
      const axis = course % 2 === 0 ? "x" : "z";
      const yaw = TOWER_YAW + (axis === "z" ? Math.PI / 2 : 0);
      for (let lane = 0; lane < 3; lane += 1) {
        const offset = (lane - 1) * laneSpacing;
        const localX = axis === "z" ? offset : 0;
        const localZ = axis === "x" ? offset : 0;
        const rotated = rotateXZ(localX, localZ, TOWER_YAW);
        const id = `tower-${String(course + 1).padStart(2, "0")}-${lane + 1}`;
        const body = this.world.createRigidBody(
          RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(rotated.x, course * TOWER_BLOCK.height + 0.13, rotated.z)
            .setRotation(yawQuat(-yaw))
            .setLinearDamping(0.08)
            .setAngularDamping(0.18)
            .setCcdEnabled(true),
        );
        const collider = this.world.createCollider(
          RAPIER.ColliderDesc.cuboid(
            TOWER_BLOCK.length / 2,
            TOWER_BLOCK.height / 2,
            TOWER_BLOCK.width / 2,
          )
            .setMass(TOWER_BLOCK_MASS)
            .setFriction(0.26)
            .setRestitution(0.02)
            .setContactSkin(0.001),
          body,
        );
        this.addRecord({
          id,
          kind: "tower-block",
          shape: "round-box",
          body,
          colliders: [collider],
          size: {
            x: TOWER_BLOCK.length,
            y: TOWER_BLOCK.height,
            z: TOWER_BLOCK.width,
          },
          dynamic: true,
          course,
          lane,
          axis,
          variant: "oak-1.54x0.50x0.26m",
        });
      }
    }
  }

  private createCradle(): void {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0, CRADLE_CENTER_Y, 0)
        .setRotation(yawQuat(TOWER_YAW))
        .setLinearDamping(0.18)
        .setAngularDamping(0.32)
        .setCcdEnabled(true),
    );
    const colliders: RAPIER.Collider[] = [];
    colliders.push(
      this.world.createCollider(
        RAPIER.ColliderDesc.roundCuboid(0.7, 0.07, 0.7, 0.035)
          .setTranslation(0, 0.02, 0)
          .setMass(28)
          .setFriction(0.72),
        body,
      ),
    );
    for (const x of [-0.52, 0.52]) {
      for (const z of [-0.52, 0.52]) {
        colliders.push(
          this.world.createCollider(
            RAPIER.ColliderDesc.roundCuboid(0.1, 0.1, 0.1, 0.015)
              .setTranslation(x, -0.11, z)
              .setMass(2)
              .setFriction(0.82),
            body,
          ),
        );
      }
    }
    colliders.push(
      this.world.createCollider(
        RAPIER.ColliderDesc.cylinder(0.05, 0.48)
          .setTranslation(0, 0.145, 0)
          .setMass(8)
          .setFriction(0.78),
        body,
      ),
    );
    this.addRecord({
      id: "central-cradle",
      kind: "cradle",
      shape: "cradle",
      body,
      colliders,
      size: { x: 1.55, y: 0.38, z: 1.55 },
      dynamic: true,
      variant: "four-foot-ring-seat",
    });
  }

  private createHumpty(): void {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0, HUMPTY_CENTER_Y, 0)
        .setRotation(yawQuat(TOWER_YAW))
        .setLinearDamping(0.12)
        .setAngularDamping(0.36)
        .setSoftCcdPrediction(.25)
        .setCcdEnabled(true),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(0.23, 0.62)
        .setMass(58)
        .setFriction(0.72)
        .setRestitution(0.015)
        .setContactSkin(0.001),
      body,
    );
    this.addRecord({
      id: "humpty",
      kind: "humpty",
      shape: "humpty",
      body,
      colliders: [collider],
      size: { x: 1.24, y: 1.7, z: 1.18 },
      dynamic: true,
      variant: "compound-egg-king",
      integrity: 100,
    });
  }

  private createInventoryRacks(): void {
    for (const team of ["king", "queen"] as const) {
      const side = team === "king" ? -1 : 1;
      const x = side * 7.65;
      this.createFixedBox(
        `${team}-rack-backstop`,
        "rack",
        { x, y: 0.72, z: -4.7 },
        { x: 1.8, y: 1.44, z: 0.16 },
        0.8,
      );
      for (const z of [-3.65, -1.85, -0.05, 1.75, 3.55]) {
        this.createFixedBox(
          `${team}-rack-rail-${z}`,
          "rack",
          { x: side * 8.48, y: 0.16, z },
          { x: 0.12, y: 0.32, z: 1.25 },
          0.82,
        );
      }
    }
  }

  private createOpeningInventory(): void {
    for (const team of ["king", "queen"] as const) {
      const placements = this.inventoryPlacements(team);
      let placementIndex = 0;
      for (const definition of INVENTORY_DEFINITIONS) {
        for (let index = 0; index < definition.quantity; index += 1) {
          const placement = placements[placementIndex];
          if (!placement) throw new Error(`Missing ${team} inventory placement`);
          placementIndex += 1;
          this.createInventoryPart(
            team,
            definition.family,
            definition.variant,
            index,
            definition.size,
            definition.mass,
            placement,
          );
        }
      }
      if (placementIndex !== INVENTORY_COUNT) {
        throw new Error(`Expected ${INVENTORY_COUNT} ${team} parts`);
      }
    }
  }

  private createQueenAdvantage(): void {
    const deviceBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(3.8, .78, -2.42)
        .setGravityScale(0)
        .setLinearDamping(.3)
        .setAngularDamping(.45)
        .setCcdEnabled(true),
    );
    const deviceCollider = this.world.createCollider(
      RAPIER.ColliderDesc.roundCuboid(.44, .7, .44, .07)
        .setMass(32)
        .setFriction(.78)
        .setRestitution(.12)
        .setContactSkin(.001)
        .setSensor(true),
      deviceBody,
    );
    deviceCollider.setCollisionGroups(interactionGroups(
      QUEEN_ENGINE_COLLISION_GROUP,
      QUEEN_ENGINE_COLLISION_GROUP,
    ));
    this.addRecord({
      id: "queen-command-post",
      kind: "queen-device",
      shape: "round-box",
      body: deviceBody,
      colliders: [deviceCollider],
      size: { x: .88, y: 1.4, z: .88 },
      dynamic: true,
      team: "queen",
      variant: "mad queen command post",
      integrity: 100,
    });
    for (const [index, x] of [2.98, 3.36].entries()) {
      const boltBody = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(x, .18, -2.42)
          .setGravityScale(0)
          .setLinearDamping(.12)
          .setAngularDamping(.2)
          .setCcdEnabled(true),
      );
      const boltCollider = this.world.createCollider(
        RAPIER.ColliderDesc.ball(.14)
          .setMass(4.5)
          .setFriction(.38)
          .setRestitution(.32)
          .setContactSkin(.001)
          .setSensor(true),
        boltBody,
      );
      boltCollider.setCollisionGroups(interactionGroups(
        QUEEN_ENGINE_COLLISION_GROUP,
        QUEEN_ENGINE_COLLISION_GROUP,
      ));
      this.addRecord({
        id: `queen-crown-bolt-${index + 1}`,
        kind: "queen-bolt",
        shape: "sphere",
        body: boltBody,
        colliders: [boltCollider],
        size: { x: .28, y: .28, z: .28 },
        dynamic: true,
        team: "queen",
        variant: "loaded crown bolt",
      });
    }
  }

  private createWorkers(): void {
    for (const team of ["king", "queen"] as const) {
      const side = team === "king" ? -1 : 1;
      TEAM_WORKERS[team].forEach((name, index) => {
        const id = `${team}-worker-${index + 1}`;
        const body = this.world.createRigidBody(
          RAPIER.RigidBodyDesc.kinematicPositionBased()
            .setTranslation(side * (4.55 + index * 0.16), 0.775, (index - 1) * 1.35)
            .setRotation(yawQuat(team === "king" ? Math.PI / 2 : -Math.PI / 2)),
        );
        const collider = this.world.createCollider(
          RAPIER.ColliderDesc.capsule(0.515, 0.26)
            .setFriction(0.86)
            .setRestitution(0)
            .setMass(76)
            .setContactSkin(0.002),
          body,
        );
        collider.setCollisionGroups(interactionGroups(WORKER_COLLISION_GROUP, ALL_COLLISION_GROUPS));
        const controller = this.world.createCharacterController(0.015);
        controller.setSlideEnabled(true);
        controller.enableAutostep(0.22, 0.16, false);
        controller.enableSnapToGround(0.12);
        controller.setMaxSlopeClimbAngle((48 * Math.PI) / 180);
        controller.setMinSlopeSlideAngle((58 * Math.PI) / 180);
        controller.setApplyImpulsesToDynamicBodies(false);
        controller.setCharacterMass(76);
        this.addRecord({
          id,
          kind: "worker",
          shape: "capsule",
          body,
          colliders: [collider],
          size: { x: 0.52, y: 1.55, z: 0.52 },
          dynamic: false,
          team,
          variant: name,
        });
        this.characters.set(id, {
          controller,
          collider,
          facing: { x: team === "king" ? 1 : -1, y: 0, z: 0 },
        });
      });
    }
  }

  private inventoryPlacements(team: Team): InventoryPlacement[] {
    const side = team === "king" ? -1 : 1;
    const innerX = side * 6.75;
    const outerX = side * 8.05;
    return [
      { position: { x: outerX, y: 0.1, z: -1.1 }, yaw: Math.PI / 2 },
      { position: { x: innerX, y: 0.1, z: -1.1 }, yaw: Math.PI / 2 },
      { position: { x: side * 7.75, y: 0.1, z: -1.55 }, yaw: Math.PI / 2 },
      { position: { x: side * 6.35, y: 0.1, z: -1.55 }, yaw: Math.PI / 2 },
      { position: { x: outerX, y: 0.1, z: -3.4 }, yaw: 0 },
      { position: { x: innerX, y: 0.1, z: -3.4 }, yaw: 0 },
      { position: { x: side * 6.15, y: 0.29, z: 1.45 }, yaw: 0 },
      { position: { x: side * 7, y: 0.29, z: 1.45 }, yaw: 0 },
      { position: { x: side * 7.85, y: 0.29, z: 1.45 }, yaw: 0 },
      { position: { x: side * 8.7, y: 0.29, z: 1.45 }, yaw: 0 },
      { position: { x: outerX, y: 0.08, z: 2.2 }, yaw: 0 },
      { position: { x: innerX, y: 0.08, z: 2.2 }, yaw: 0 },
      { position: { x: outerX, y: 0.36, z: 3.15 }, yaw: 0 },
      { position: { x: innerX, y: 0.36, z: 3.15 }, yaw: 0 },
      { position: { x: side * 6.45, y: 0.25, z: 3.82 }, yaw: 0 },
      { position: { x: side * 7.55, y: 0.25, z: 3.82 }, yaw: 0 },
      { position: { x: side * 8.65, y: 0.22, z: 3.82 }, yaw: 0 },
      { position: { x: outerX, y: 0.08, z: 0.15 }, yaw: 0 },
      { position: { x: innerX, y: 0.08, z: 0.15 }, yaw: 0 },
      { position: { x: outerX, y: 0.09, z: 4.42 }, yaw: 0 },
      { position: { x: innerX, y: 0.09, z: 4.42 }, yaw: 0 },
      { position: { x: side * 6.25, y: 0.13, z: 4.75 }, yaw: 0 },
      { position: { x: side * 7.4, y: 0.13, z: 4.75 }, yaw: 0 },
      { position: { x: side * 8.55, y: 0.13, z: 4.75 }, yaw: 0 },
    ];
  }

  private createInventoryPart(
    team: Team,
    family: PartFamily,
    variant: string,
    index: number,
    size: Vec3,
    mass: number,
    placement: InventoryPlacement,
  ): void {
    const id = inventoryId(team, family, variant, index);
    if (this.initialized) this.lateCreatedInventory += 1;
    const rotation = multiplyQuat(
      yawQuat(placement.yaw),
      rollQuat(placement.roll ?? 0),
    );
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(
          placement.position.x,
          placement.position.y,
          placement.position.z,
        )
        .setRotation(rotation)
        .setLinearDamping(0.28)
        .setAngularDamping(0.42)
        .setCcdEnabled(true),
    );
    let colliderDescs: RAPIER.ColliderDesc[];
    let shape: CoreShape = "round-box";
    if (family === "wheel" || family === "sheave") {
      const segmentCount = 12;
      const outerRadius = size.x / 2;
      const innerRadius = family === "sheave" ? outerRadius * .55 : 0.095;
      const ringRadius = (outerRadius + innerRadius) / 2;
      const radialHalfExtent = (outerRadius - innerRadius) / 2;
      const tangentHalfExtent = ringRadius * Math.tan(Math.PI / segmentCount) * 1.08;
      colliderDescs = Array.from({ length: segmentCount }, (_, segment) => {
        const angle = segment / segmentCount * Math.PI * 2;
        return RAPIER.ColliderDesc.roundCuboid(
          radialHalfExtent,
          tangentHalfExtent,
          size.y / 2,
          0.008,
        )
          .setTranslation(
            Math.cos(angle) * ringRadius,
            Math.sin(angle) * ringRadius,
            0,
          )
          .setRotation(rollQuat(angle));
      });
      shape = "cylinder";
    } else if (family === "drum") {
      colliderDescs = [RAPIER.ColliderDesc.cylinder(size.y / 2, size.x / 2).setRotation({
        x: Math.sin(Math.PI / 4),
        y: 0,
        z: 0,
        w: Math.cos(Math.PI / 4),
      })];
      shape = "cylinder";
    } else if (family === "hub") {
      const segmentCount = 8;
      const outerRadius = size.x / 2;
      const innerRadius = 0.1;
      const ringRadius = (outerRadius + innerRadius) / 2;
      const radialHalfExtent = (outerRadius - innerRadius) / 2;
      const tangentHalfExtent = ringRadius * Math.tan(Math.PI / segmentCount) * 1.08;
      colliderDescs = Array.from({ length: segmentCount }, (_, segment) => {
        const angle = segment / segmentCount * Math.PI * 2;
        return RAPIER.ColliderDesc.roundCuboid(
          radialHalfExtent,
          tangentHalfExtent,
          size.z / 2,
          0.006,
        )
          .setTranslation(
            Math.cos(angle) * ringRadius,
            Math.sin(angle) * ringRadius,
            0,
          )
          .setRotation(rollQuat(angle));
      });
      shape = "cylinder";
    } else if (family === "axle") {
      colliderDescs = [RAPIER.ColliderDesc.cylinder(
        size.z / 2,
        size.x / 2,
      ).setRotation({
        x: Math.sin(Math.PI / 4),
        y: 0,
        z: 0,
        w: Math.cos(Math.PI / 4),
      })];
      shape = "cylinder";
    } else if (family === "rope") {
      colliderDescs = [RAPIER.ColliderDesc.cylinder(size.y / 2, size.x / 2)];
      shape = "rope-coil";
    } else if (family === "wedge") {
      const wedge = RAPIER.ColliderDesc.convexHull(
        new Float32Array([
          -size.x / 2, -size.y / 2, -size.z / 2,
          size.x / 2, -size.y / 2, -size.z / 2,
          -size.x / 2, -size.y / 2, size.z / 2,
          size.x / 2, -size.y / 2, size.z / 2,
          -size.x / 2, size.y / 2, size.z / 2,
          size.x / 2, size.y / 2, size.z / 2,
        ]),
      );
      if (!wedge) throw new Error("Unable to create wedge collider");
      colliderDescs = [wedge];
      shape = "wedge";
    } else if (family === "plank") {
      const baseRadius = 0.015;
      const socketRadius = 0.006;
      colliderDescs = [
        RAPIER.ColliderDesc.roundCuboid(
          size.x / 2 - baseRadius,
          size.y / 2 - baseRadius,
          size.z / 2 - baseRadius,
          baseRadius,
        ),
        RAPIER.ColliderDesc.roundCuboid(
          .11 - socketRadius,
          .035 - socketRadius,
          .11 - socketRadius,
          socketRadius,
        )
          .setTranslation(0, .085, RAM_SADDLE_FORWARD)
          .setRotation(xQuat(RAM_SADDLE_PITCH)),
      ];
    } else {
      const borderRadius = 0.015;
      colliderDescs = [RAPIER.ColliderDesc.roundCuboid(
        size.x / 2 - borderRadius,
        size.y / 2 - borderRadius,
        size.z / 2 - borderRadius,
        borderRadius,
      )];
    }
    const colliders = colliderDescs.map((colliderDesc, colliderIndex) => {
      const colliderMass = family === "plank" && colliderDescs.length === 2
        ? mass * (colliderIndex === 0 ? .94 : .06)
        : mass / colliderDescs.length;
      return this.world.createCollider(
      colliderDesc
        .setMass(colliderMass)
        .setFriction(family === "wheel" ? 0.82 : 0.72)
        .setRestitution(0.025)
        .setContactSkin(0.001),
      body,
      );
    });
    this.addRecord({
      id,
      kind: "part",
      shape,
      body,
      colliders,
      size: { ...size },
      dynamic: true,
      team,
      family,
      variant,
      stored: true,
    });
  }

  private createFixedBox(
    id: string,
    kind: "floor" | "wall" | "rack",
    position: Vec3,
    size: Vec3,
    friction: number,
  ): BodyRecord {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2).setFriction(
        friction,
      ),
      body,
    );
    const record: BodyRecord = {
      id,
      kind,
      shape: "box",
      body,
      colliders: [collider],
      size: { ...size },
      dynamic: false,
    };
    this.addRecord(record);
    return record;
  }

  private addRecord(record: BodyRecord): void {
    if (this.records.has(record.id)) throw new Error(`Duplicate body ID ${record.id}`);
    this.records.set(record.id, record);
    for (const collider of record.colliders) this.colliderOwners.set(collider.handle, record.id);
  }

  private settleInitialization(steps: number): void {
    for (let index = 0; index < steps; index += 1) this.world.step();
  }

  private writePose(
    record: BodyRecord,
    position: Vec3,
    rotation: Quat,
    callSite: string,
  ): void {
    const classification = this.initialized ? "illegal-gameplay" : "initialization";
    this.writes.push({
      bodyId: record.id,
      callSite,
      tick: this.tickValue,
      oldPosition: toVec3(record.body.translation()),
      requestedPosition: { ...position },
      classification,
    });
    record.body.setTranslation(position, true);
    record.body.setRotation(rotation, true);
  }

  private auditInventory(): void {
    const current = new Set(this.inventoryIds());
    for (const id of current) {
      if (!this.initialInventoryIds.has(id)) this.lateCreatedInventory += 1;
    }
  }

  private resolveQueenBoltImpacts(): void {
    for (const boltId of ["queen-crown-bolt-1", "queen-crown-bolt-2"]) {
      if (this.queenBoltImpactIds.has(boltId)) continue;
      const bolt = this.records.get(boltId);
      if (!bolt?.variant?.startsWith("spent")) continue;
      if (this.contactCount(boltId, "humpty") <= 0) continue;
      this.queenBoltImpactIds.add(boltId);
      bolt.variant = "spent crown bolt impact";
      this.applyDamage("humpty", 62);
    }
  }

  private auditPenetrations(): void {
    if (this.tickValue % 6 !== 0) return;
    const seen = new Set<string>();
    for (const record of this.records.values()) {
      if (!record.dynamic && record.kind !== "worker") continue;
      for (const collider of record.colliders) {
        this.world.contactPairsWith(collider, (other) => {
          const otherId = this.colliderOwners.get(other.handle);
          if (!otherId || otherId === record.id) return;
          if (this.bodiesShareAssemblyJoint(record.id, otherId)) return;
          const key = [record.id, otherId].sort().join("|");
          if (seen.has(key)) return;
          seen.add(key);
          let deepest = 0;
          this.world.contactPair(collider, other, (manifold) => {
            for (let index = 0; index < manifold.numSolverContacts(); index += 1) {
              deepest = Math.min(deepest, manifold.solverContactDist(index));
            }
          });
          if (deepest >= -0.02) return;
          const otherRecord = this.records.get(otherId);
          const carried = Boolean(
            (record.kind === "part" && record.carriedBy) ||
            (otherRecord?.kind === "part" && otherRecord.carriedBy),
          );
          if (this.penetrationEvidenceRecords.length < 50) {
            this.penetrationEvidenceRecords.push({
              tick: this.tickValue,
              firstId: record.id,
              secondId: otherId,
              depth: deepest,
              carried,
            });
          }
          if (record.kind === "worker" || otherRecord?.kind === "worker") {
            this.workerPenetrations += 1;
          } else {
            this.deepBodyPenetrations += 1;
          }
          if (carried) {
            this.carriedPartPenetrations += 1;
          }
        });
      }
    }
  }

  private bodiesShareAssemblyJoint(firstId: string, secondId: string): boolean {
    return [...this.assemblyJointBodies.values()].some(
      ([bodyA, bodyB]) =>
        (bodyA === firstId && bodyB === secondId) ||
        (bodyA === secondId && bodyB === firstId),
    );
  }

  private cradleTowerContactCount(): number {
    let total = 0;
    for (const id of this.towerBlockIds().slice(-3)) {
      total += this.contactCount("central-cradle", id);
    }
    return total;
  }

  private humptySupportGap(): number {
    const humpty = this.records.get("humpty");
    const cradle = this.records.get("central-cradle");
    if (!humpty || !cradle) return Number.POSITIVE_INFINITY;
    const humptyBottom = humpty.body.translation().y - humpty.size.y / 2;
    const seatTop = cradle.body.translation().y + 0.195;
    return Math.max(0, humptyBottom - seatTop);
  }
}

function interactionGroups(membership: number, filter: number): number {
  return (((membership & 0xffff) << 16) | (filter & 0xffff)) >>> 0;
}

function rotateXZ(x: number, z: number, angle: number): { x: number; z: number } {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: x * cosine - z * sine,
    z: x * sine + z * cosine,
  };
}

function yawQuat(angle: number): Quat {
  return { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) };
}

function xQuat(angle: number): Quat {
  return { x: Math.sin(angle / 2), y: 0, z: 0, w: Math.cos(angle / 2) };
}

function rollQuat(angle: number): Quat {
  return { x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) };
}

function multiplyQuat(left: Quat, right: Quat): Quat {
  return {
    w: left.w * right.w - left.x * right.x - left.y * right.y - left.z * right.z,
    x: left.w * right.x + left.x * right.w + left.y * right.z - left.z * right.y,
    y: left.w * right.y - left.x * right.z + left.y * right.w + left.z * right.x,
    z: left.w * right.z + left.x * right.y - left.y * right.x + left.z * right.w,
  };
}

function inverseQuat(rotation: Quat): Quat {
  return { x: -rotation.x, y: -rotation.y, z: -rotation.z, w: rotation.w };
}

function inverseRotateVector(vector: Vec3, rotation: Quat): Vec3 {
  return rotateVector3(vector, inverseQuat(rotation));
}

function rotateVector3(vector: Vec3, rotation: Quat): Vec3 {
  const tx = 2 * (rotation.y * vector.z - rotation.z * vector.y);
  const ty = 2 * (rotation.z * vector.x - rotation.x * vector.z);
  const tz = 2 * (rotation.x * vector.y - rotation.y * vector.x);
  return {
    x: vector.x + rotation.w * tx + (rotation.y * tz - rotation.z * ty),
    y: vector.y + rotation.w * ty + (rotation.z * tx - rotation.x * tz),
    z: vector.z + rotation.w * tz + (rotation.x * ty - rotation.y * tx),
  };
}

function subtractVec(first: Vec3, second: Vec3): Vec3 {
  return { x: first.x - second.x, y: first.y - second.y, z: first.z - second.z };
}

function addVec(first: Vec3, second: Vec3): Vec3 {
  return { x: first.x + second.x, y: first.y + second.y, z: first.z + second.z };
}

function scaleVec(vector: Vec3, scalar: number): Vec3 {
  return { x: vector.x * scalar, y: vector.y * scalar, z: vector.z * scalar };
}

function normalizeVec(vector: Vec3): Vec3 {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return length > 0.0001 ? scaleVec(vector, 1 / length) : { x: 1, y: 0, z: 0 };
}

function dotVec(first: Vec3, second: Vec3): number {
  return first.x * second.x + first.y * second.y + first.z * second.z;
}

function toVec3(vector: RAPIER.Vector): Vec3 {
  return { x: vector.x, y: vector.y, z: vector.z };
}

function toQuat(rotation: RAPIER.Rotation): Quat {
  return { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w };
}

export const TOWER_SPEC = {
  courses: TOWER_COURSES,
  blocksPerCourse: TOWER_BLOCKS_PER_COURSE,
  totalBlocks: TOWER_COURSES * TOWER_BLOCKS_PER_COURSE,
  dimensions: TOWER_BLOCK,
  gap: TOWER_GAP,
  yawRadians: TOWER_YAW,
} as const;
