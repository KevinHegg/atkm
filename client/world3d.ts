import * as pc from "playcanvas";
// sync-ammo documents a default ESM export, but its declaration file omits it.
// @ts-expect-error The runtime default is the synchronous Ammo namespace.
import Ammo from "sync-ammo";
import type {
  BlueprintPlan,
  ComponentPlan,
  MechanismStage,
} from "../server/construction.js";
// Keep the runtime construction catalog on the same cache version as this world.
// @ts-expect-error TypeScript does not resolve Vite query-suffixed modules.
import { createBlueprint as versionedCreateBlueprint } from "../server/construction.js?build=20260801-repair-4";
const createBlueprint: typeof import("../server/construction.js").createBlueprint =
  versionedCreateBlueprint;
import type {
  AgentActivity,
  AssemblyState,
  ServerSnapshot,
  SoundCue,
  Team,
  TransformState,
  WeaponType,
  WorkOperation,
} from "../shared/protocol.js";

declare global {
  interface Window {
    Ammo: typeof Ammo;
    __HUMPTY_WORLD__?: {
      engine: string;
      physics: string;
      dynamicBodies: number;
      joints: number;
      installedParts: number;
      carriedParts: number;
      groundedAgents: number;
      commissionedSubsystems: number;
      activeCommissioningTests: number;
    };
  }
}

window.Ammo = Ammo;

const DEG = 180 / Math.PI;
const KING_X = -8.4;
const QUEEN_X = 8.4;
const WORLD_TO_STAGE_X = 34;
const WORLD_TO_STAGE_Y = 57;
const SERVER_GROUND_Y = 30;
const SERVER_TOWER_X = 600;
const SERVER_TOWER_BLOCK_WIDTH = 58;
const SERVER_TOWER_BLOCKS_PER_LAYER = 3;
const GROUND_Y = 0;
const WALL_TOP = 9.2;
const HUMPTY_FLOOR_Y = 1.28;
const SERVER_HUMPTY_HALF_HEIGHT = 55;
const HUMPTY_VISUAL_BOTTOM_OFFSET = 1.31;
const WORKER_FORCE = 780;
const MAX_WORKER_SPEED = 3.3;
const PART_SPRING = 420;
const PART_DAMPING = 55;
const INSTALL_DISTANCE = 0.26;
const KING_COMPOUND_PROJECTS = new Set([
  "machine_skid",
  "machine_cart",
  "machine_screw_jack",
  "machine_mast",
  "machine_lever",
  "machine_brace",
  "machine_ladder",
  "machine_winch",
  "machine_pulley",
  "rescue_sling",
]);
const QUEEN_COMPOUND_PROJECTS = new Set([
  "queen_machine_cart",
  "queen_machine_lever",
  "queen_machine_spring_trap",
]);

function scatterUnit(value: string, salt: number): number {
  let hash = 2166136261 ^ salt;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

const palette = {
  sky: new pc.Color(0.075, 0.105, 0.125),
  haze: new pc.Color(0.32, 0.36, 0.37),
  ground: new pc.Color(0.29, 0.265, 0.215),
  stone: new pc.Color(0.45, 0.44, 0.39),
  stoneDark: new pc.Color(0.28, 0.285, 0.27),
  timber: new pc.Color(0.42, 0.225, 0.095),
  timberCut: new pc.Color(0.68, 0.46, 0.245),
  iron: new pc.Color(0.12, 0.135, 0.14),
  brass: new pc.Color(0.58, 0.42, 0.13),
  canvas: new pc.Color(0.61, 0.565, 0.44),
  rope: new pc.Color(0.49, 0.38, 0.21),
  king: new pc.Color(0.62, 0.075, 0.055),
  queen: new pc.Color(0.08, 0.41, 0.34),
  ochre: new pc.Color(0.93, 0.63, 0.08),
  egg: new pc.Color(0.91, 0.84, 0.68),
  ink: new pc.Color(0.035, 0.028, 0.023),
  cream: new pc.Color(0.78, 0.735, 0.625),
};

type JobPhase =
  | "walk-stock"
  | "grip"
  | "carry"
  | "measure"
  | "cut"
  | "bore"
  | "forge"
  | "thread"
  | "tension"
  | "align"
  | "fasten"
  | "commission";

interface PartRuntime {
  id: string;
  plan: ComponentPlan;
  blueprint: BlueprintPlan;
  body: pc.Entity;
  detail?: pc.Entity;
  connectionDetail?: pc.Entity;
  targetPosition: pc.Vec3;
  targetRotation: pc.Quat;
  finalPosition: pc.Vec3;
  finalRotation: pc.Quat;
  finalizing: boolean;
  desiredState: AssemblyState;
  localState: AssemblyState;
  assignedTo?: string;
  installedJoint?: pc.Entity;
  active: boolean;
  operationIndex: number;
  stageIndex: number;
}

interface PuzzleVisual {
  id: string;
  body: pc.Entity;
  plan: ComponentPlan;
  targetPosition: pc.Vec3;
  targetAngle: number;
  targetYaw: number;
  portMarkers: Map<string, PuzzlePortVisual>;
}

interface TowerVisual {
  body: pc.Entity;
  targetPosition: pc.Vec3;
  targetAngle: number;
  targetYaw: number;
}

interface PuzzlePortVisual {
  root: pc.Entity;
  face: pc.Entity;
}

interface WorkerRuntime {
  id: string;
  name: string;
  team: "king" | "queen";
  body: pc.Entity;
  rig: pc.Entity;
  leftArm: pc.Entity;
  rightArm: pc.Entity;
  tool: pc.Entity;
  pike: pc.Entity;
  crossbow: pc.Entity;
  activeWeapon?: WeaponType;
  goal: pc.Vec3;
  lastPosition: pc.Vec3;
  lastGoalDistance: number;
  job?: PartRuntime;
  phase?: JobPhase;
  phaseUntil: number;
  carryJoint?: pc.Entity;
  facing: number;
  grounded: boolean;
  stalledFor: number;
  activity: AgentActivity;
  operation?: WorkOperation;
  preferredProjectId?: string;
  commissioning?: {
    blueprint: BlueprintPlan;
    stage: MechanismStage;
  };
}

interface BubbleAnchor {
  id: string;
  entity: pc.Entity;
}

interface ProjectileRuntime {
  body: pc.Entity;
  team: "king" | "queen";
  used: boolean;
}

interface BoltRuntime {
  body: pc.Entity;
  team: "king" | "queen";
  used: boolean;
}

export interface PhysicalWorldCallbacks {
  onImpact?: (strength: number) => void;
  onHumptyFall?: () => void;
}

export class PhysicalWorld {
  readonly app: pc.Application;
  readonly canvas: HTMLCanvasElement;

  private readonly stage: HTMLElement;
  private readonly callbacks: PhysicalWorldCallbacks;
  private readonly materials = new Map<string, pc.StandardMaterial>();
  private readonly bodyVisuals = new WeakMap<pc.Entity, pc.Entity>();
  private readonly parts = new Map<string, PartRuntime>();
  private readonly puzzleVisuals = new Map<string, PuzzleVisual>();
  private readonly towerVisuals = new Map<string, TowerVisual>();
  private readonly snapGhosts = new Map<string, pc.Entity>();
  private readonly workers = new Map<string, WorkerRuntime>();
  private readonly bubbles = new Map<string, BubbleAnchor>();
  private readonly projectiles: ProjectileRuntime[] = [];
  private readonly bolts: BoltRuntime[] = [];
  private readonly mechanismLines = new Map<string, pc.Entity>();
  private readonly commissionedStages = new Set<string>();
  private readonly commissioningStages = new Set<string>();
  private readonly mechanismTestUntil = new Map<string, number>();
  private readonly joints = new Set<pc.Entity>();
  private readonly dynamicBodies = new Set<pc.Entity>();
  private readonly temp = new pc.Vec3();
  private readonly tempB = new pc.Vec3();
  private readonly tempQ = new pc.Quat();
  private readonly camera: pc.Entity;
  private readonly humpty: pc.Entity;
  private readonly humptyRig: pc.Entity;
  private readonly humptyFace: pc.Entity;
  private readonly humptyMouth: pc.Entity;
  private readonly humptyBrows: pc.Entity[] = [];
  private readonly wall: pc.Entity;
  private latest?: ServerSnapshot;
  private elapsed = 0;
  private paused = false;
  private engineeringOverlay = false;
  private orbitYaw = -16;
  private orbitPitch = -7;
  private orbitDistance = 29;
  private cameraTarget = new pc.Vec3(0, 5.4, 0);
  private dragging = false;
  private dragX = 0;
  private dragY = 0;
  private follow = true;
  private visualIntegrity = 100;
  private humptyFalling = false;
  private humptyAuthoritative = false;
  private humptyRighting = false;
  private humptyCrackReleased = false;
  private readonly shellFragments: pc.Entity[] = [];
  private humptyTargetPosition = new pc.Vec3(0, WALL_TOP + 1.25, 0);
  private humptyTargetAngle = 0;
  private installedCount = 0;
  private springTrapArm?: pc.Entity;
  private springTrapKickUntil = 0;
  private queenLeverArm?: pc.Entity;
  private kingLeverArm?: pc.Entity;
  private queenLeverKickUntil = 0;
  private kingLeverWorkUntil = 0;
  private kingScrewHandle?: pc.Entity;
  private kingTreadwheel?: pc.Entity;
  private kingWinchDrum?: pc.Entity;
  private kingWinchRatchet?: pc.Entity;
  private queenWindlassDrum?: pc.Entity;
  private queenWindlassRatchet?: pc.Entity;
  private queenPortrait?: pc.Entity;
  private queenPortraitHead?: pc.Entity;
  private queenPortraitMouth?: pc.Entity;
  private kingDriveAngle = 0;
  private queenDriveAngle = 0;
  private resizeObserver: ResizeObserver;
  private destroyed = false;
  private lastSoundCue = 0;
  private resetToken = "";
  private puzzleMode = false;

  constructor(stage: HTMLElement, callbacks: PhysicalWorldCallbacks = {}) {
    this.stage = stage;
    this.callbacks = callbacks;
    this.canvas = document.createElement("canvas");
    this.canvas.setAttribute("aria-label", "Three-dimensional physical theatre");
    stage.replaceChildren(this.canvas);

    this.app = new pc.Application(this.canvas, {
      mouse: new pc.Mouse(this.canvas),
      touch: new pc.TouchDevice(this.canvas),
      keyboard: new pc.Keyboard(window),
      graphicsDeviceOptions: {
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      },
    });
    this.app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    this.app.setCanvasResolution(pc.RESOLUTION_AUTO);
    this.app.scene.ambientLight = new pc.Color(0.24, 0.25, 0.24);
    this.app.scene.exposure = 1.14;
    this.app.scene.skyboxMip = 1;
    this.app.start();
    this.app.systems.rigidbody!.gravity.set(0, -9.81, 0);

    this.camera = this.createCamera();
    this.createLights();
    this.createScenery();
    this.wall = this.createWall();
    const humpty = this.createHumpty();
    this.humpty = humpty.body;
    this.humptyRig = humpty.rig;
    this.humptyFace = humpty.face;
    this.humptyMouth = humpty.mouth;
    this.createQueenGallery();
    this.createWorkers();
    this.bindInput();

    this.app.on("update", (dt: number) => this.update(Math.min(dt, 1 / 20)));
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(stage);
    this.resize();
    this.publishDebug();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.resizeObserver.disconnect();
    if (this.app.graphicsDevice?.canvas) this.app.destroy();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.app.timeScale = paused ? 0 : 1;
  }

  setEngineeringOverlay(enabled: boolean): void {
    this.engineeringOverlay = enabled;
  }

  setFollow(follow: boolean): void {
    this.follow = follow;
  }

  getFollow(): boolean {
    return this.follow;
  }

  fit(): void {
    this.follow = false;
    this.orbitYaw = -16;
    this.orbitPitch = -7;
    this.orbitDistance = 29;
    this.cameraTarget.set(0, 5.1, 0);
  }

  poke(): void {
    const loose = [...this.dynamicBodies].find((body) =>
      body.name.startsWith("stock:king"),
    );
    loose?.rigidbody?.applyImpulse(4.5, 2.2, 0.8);
  }

  projectToStage(entity: pc.Entity, lift = 1.5): { x: number; y: number; visible: boolean } {
    const position = entity.getPosition().clone();
    position.y += lift;
    const screen = this.camera.camera?.worldToScreen(position);
    if (!screen) return { x: 0, y: 0, visible: false };
    return {
      x: screen.x,
      y: screen.y,
      visible:
        screen.z > 0 &&
        screen.x > -100 &&
        screen.x < this.canvas.clientWidth + 100 &&
        screen.y > -100 &&
        screen.y < this.canvas.clientHeight + 100,
    };
  }

  bubbleAnchor(agentId: string): pc.Entity | undefined {
    return this.bubbles.get(agentId)?.entity;
  }

  puzzleAnchor(partId: string): pc.Entity | undefined {
    return this.puzzleVisuals.get(partId)?.body;
  }

  acceptSnapshot(snapshot: ServerSnapshot): void {
    if (this.resetToken && this.resetToken !== snapshot.runId) {
      location.reload();
      return;
    }
    this.resetToken = snapshot.runId;
    this.latest = snapshot;
    this.elapsed = snapshot.elapsed;
    this.visualIntegrity = snapshot.humptyIntegrity;
    this.puzzleMode = snapshot.puzzleMode;

    const entities = new Map(snapshot.entities.map((entity) => [entity.id, entity]));
    this.syncTower(snapshot.entities);
    const humptyState = entities.get("humpty");
    for (const part of this.parts.values()) {
      const state = entities.get(part.id);
      part.body.enabled = !this.puzzleMode && !!state;
      if (!state || this.puzzleMode) continue;
      part.active = true;
      part.desiredState = state.assemblyState ?? "stock";
    }
    this.syncPuzzleParts(snapshot.entities, snapshot.snapPreviews ?? []);

    for (const worker of this.workers.values()) {
      const state = entities.get(worker.id);
      if (!state) continue;
      worker.activity = state.activity ?? "idle";
      if (this.puzzleMode) {
        const taskDepth = state.taskTargetId
          ? entities.get(state.taskTargetId)?.puzzleDepth
          : undefined;
        worker.goal.set(
          (state.x - 600) / WORLD_TO_STAGE_X,
          1.05,
          taskDepth ?? state.puzzleDepth ?? worker.body.getPosition().z,
        );
        delete worker.job;
        delete worker.commissioning;
        delete worker.phase;
      }
      if (state.weapon) worker.activeWeapon = state.weapon;
      if (state.taskOperation) {
        worker.operation = state.taskOperation;
      } else {
        delete worker.operation;
      }
      if (state.taskTargetId && !this.puzzleMode) {
        const target = this.parts.get(state.taskTargetId);
        if (target) {
          target.active = true;
          worker.preferredProjectId = target.blueprint.machineId;
          target.desiredState =
            state.carryingId === target.id ? "carried" : target.desiredState;
        }
      }
    }
    if (!this.puzzleMode) this.syncAssemblyFinalization(entities);

    for (const cue of snapshot.soundCues) {
      if (cue.id <= this.lastSoundCue) continue;
      this.lastSoundCue = cue.id;
      this.reactToCue(cue);
    }
    if (!this.puzzleMode) this.syncMechanismLines(snapshot.entities);

    if (humptyState) {
      this.updateHumptyTarget(humptyState);
      const cracked =
        snapshot.humptyIntegrity <= 0 || snapshot.winner === "queen";
      if (cracked) {
        this.humptyAuthoritative = true;
        if (!this.humptyCrackReleased) {
          this.humptyCrackReleased = true;
          this.humpty.setPosition(this.humptyTargetPosition);
          this.humpty.setEulerAngles(0, 0, this.humptyTargetAngle * DEG);
          this.releaseHumpty(false);
          this.splat();
        }
      } else {
        if (this.humptyCrackReleased) this.restoreHumpty();
        this.humptyAuthoritative = true;
        this.humptyRighting = humptyState.righting === true;
        this.releaseHumpty(true);
      }
    }
  }

  private updateHumptyTarget(state: TransformState): void {
    const contactY =
      (state.y - SERVER_GROUND_Y - SERVER_HUMPTY_HALF_HEIGHT) /
      WORLD_TO_STAGE_Y;
    this.humptyTargetPosition.set(
      (state.x - SERVER_TOWER_X) / WORLD_TO_STAGE_X,
      Math.max(HUMPTY_FLOOR_Y, contactY + HUMPTY_VISUAL_BOTTOM_OFFSET),
      0,
    );
    this.humptyTargetAngle = state.angle;
  }

  private resize(): void {
    this.app.resizeCanvas(this.stage.clientWidth, this.stage.clientHeight);
  }

  private material(
    name: string,
    color: pc.Color,
    options: { metalness?: number; gloss?: number; emissive?: pc.Color } = {},
  ): pc.StandardMaterial {
    const existing = this.materials.get(name);
    if (existing) return existing;
    const material = new pc.StandardMaterial();
    material.name = name;
    material.diffuse = color;
    material.metalness = options.metalness ?? 0;
    material.gloss = options.gloss ?? 0.32;
    if (options.emissive) {
      material.emissive = options.emissive;
      material.emissiveIntensity = 0.4;
    }
    material.update();
    this.materials.set(name, material);
    return material;
  }

  private primitive(
    name: string,
    type: "box" | "sphere" | "cylinder" | "capsule" | "cone",
    parent: pc.Entity,
    position: pc.Vec3,
    scale: pc.Vec3,
    material: pc.StandardMaterial,
    euler = new pc.Vec3(),
  ): pc.Entity {
    const entity = new pc.Entity(name);
    entity.setLocalPosition(position);
    entity.setLocalScale(scale);
    entity.setLocalEulerAngles(euler);
    entity.addComponent("render", {
      type,
      material,
      castShadows: true,
      receiveShadows: true,
    });
    parent.addChild(entity);
    return entity;
  }

  private rigidPrimitive(
    name: string,
    type: "box" | "sphere" | "cylinder" | "capsule",
    position: pc.Vec3,
    scale: pc.Vec3,
    material: pc.StandardMaterial,
    options: {
      bodyType?: "dynamic" | "static" | "kinematic";
      mass?: number;
      friction?: number;
      restitution?: number;
      euler?: pc.Vec3;
      collisionScale?: pc.Vec3;
    } = {},
  ): pc.Entity {
    const entity = new pc.Entity(name);
    entity.setPosition(position);
    entity.setEulerAngles(options.euler ?? pc.Vec3.ZERO);
    const visual = new pc.Entity(`${name}:visual`);
    visual.setLocalScale(scale);
    visual.addComponent("render", {
      type,
      material,
      castShadows: true,
      receiveShadows: true,
    });
    entity.addChild(visual);
    this.bodyVisuals.set(entity, visual);
    const collisionScale = options.collisionScale ?? scale;
    if (type === "box") {
      entity.addComponent("collision", {
        type: "box",
        halfExtents: new pc.Vec3(
          collisionScale.x / 2,
          collisionScale.y / 2,
          collisionScale.z / 2,
        ),
      });
    } else if (type === "sphere") {
      entity.addComponent("collision", {
        type: "sphere",
        radius: Math.max(collisionScale.x, collisionScale.y, collisionScale.z) / 2,
      });
    } else if (type === "capsule") {
      entity.addComponent("collision", {
        type: "capsule",
        radius: collisionScale.x / 2,
        height: collisionScale.y,
      });
    } else {
      entity.addComponent("collision", {
        type: "cylinder",
        radius: collisionScale.x / 2,
        height: collisionScale.y,
      });
    }
    entity.addComponent("rigidbody", {
      type: options.bodyType ?? "dynamic",
      mass: options.mass ?? 1,
      friction: options.friction ?? 0.75,
      restitution: options.restitution ?? 0.04,
      linearDamping: options.bodyType === "static" ? 0 : 0.24,
      angularDamping: options.bodyType === "static" ? 0 : 0.34,
    });
    this.app.root.addChild(entity);
    if ((options.bodyType ?? "dynamic") === "dynamic") {
      this.dynamicBodies.add(entity);
    }
    return entity;
  }

  private createCamera(): pc.Entity {
    const camera = new pc.Entity("spectator-camera");
    camera.addComponent("camera", {
      clearColor: palette.sky,
      farClip: 90,
      nearClip: 0.08,
      fov: 47,
    });
    this.app.root.addChild(camera);
    return camera;
  }

  private createLights(): void {
    const key = new pc.Entity("late-afternoon-key");
    key.setEulerAngles(42, -38, 0);
    key.addComponent("light", {
      type: "directional",
      color: new pc.Color(1, 0.84, 0.61),
      intensity: 1.65,
      castShadows: true,
      shadowDistance: 42,
      shadowResolution: 2048,
      shadowBias: 0.18,
      normalOffsetBias: 0.04,
    });
    this.app.root.addChild(key);

    const fill = new pc.Entity("cool-fill");
    fill.setPosition(-8, 11, 7);
    fill.addComponent("light", {
      type: "omni",
      color: new pc.Color(0.42, 0.58, 0.68),
      intensity: 0.7,
      range: 34,
      castShadows: false,
    });
    this.app.root.addChild(fill);
  }

  private createScenery(): void {
    const ground = this.rigidPrimitive(
      "ground",
      "box",
      new pc.Vec3(0, -0.45, 0),
      new pc.Vec3(38, 0.9, 16),
      this.material("ground", palette.ground, { gloss: 0.12 }),
      { bodyType: "static", friction: 1 },
    );
    ground.tags.add("ground");

    const backdrop = this.rigidPrimitive(
      "back-wall",
      "box",
      new pc.Vec3(0, 5.7, -7.2),
      new pc.Vec3(38, 11.4, 0.7),
      this.material("backdrop", palette.haze, { gloss: 0.08 }),
      { bodyType: "static" },
    );
    this.createFortressDetails(backdrop);

    for (let x = -18; x <= 18; x += 2.4) {
      const seam = new pc.Entity(`ground-seam-${x}`);
      seam.setPosition(x, 0.015, 0);
      seam.setLocalScale(0.022, 0.022, 16);
      seam.addComponent("render", {
        type: "box",
        material: this.material("ground-seam", palette.ink),
        castShadows: false,
      });
      this.app.root.addChild(seam);
    }

    this.createRack("king-rack", new pc.Vec3(-16, 2, -4.7), "king");
    this.createRack("queen-rack", new pc.Vec3(16, 2, -4.7), "queen");
  }

  private createFortressDetails(backdrop: pc.Entity): void {
    const mortar = this.material("fortress-mortar", new pc.Color(0.205, 0.215, 0.205), {
      gloss: 0.04,
    });
    const stoneA = this.material("fortress-stone-a", new pc.Color(0.35, 0.355, 0.335), {
      gloss: 0.06,
    });
    const stoneB = this.material("fortress-stone-b", new pc.Color(0.39, 0.375, 0.34), {
      gloss: 0.06,
    });
    for (let row = 0; row < 8; row += 1) {
      const y = -4.8 + row * 1.38;
      const offset = row % 2 === 0 ? 0 : 0.75;
      for (let col = -12; col <= 12; col += 1) {
        const x = col * 1.5 + offset;
        this.primitive(
          `fortress-block-${row}-${col}`,
          "box",
          backdrop,
          new pc.Vec3(x, y, 0.39),
          new pc.Vec3(1.42, 1.28, 0.08),
          (row + col) % 3 === 0 ? stoneB : stoneA,
        );
      }
    }
    for (const x of [-15.5, -7.7, 7.7, 15.5]) {
      this.primitive(
        "fortress-buttress",
        "box",
        backdrop,
        new pc.Vec3(x, -0.2, 0.55),
        new pc.Vec3(0.72, 10.9, 0.7),
        mortar,
      );
      this.primitive(
        "fortress-capital",
        "box",
        backdrop,
        new pc.Vec3(x, 4.82, 0.62),
        new pc.Vec3(1.15, 0.34, 0.86),
        stoneB,
      );
    }
    for (const x of [-5.6, 5.6]) {
      this.primitive(
        "wall-torch-bracket",
        "box",
        backdrop,
        new pc.Vec3(x, 1.65, 0.72),
        new pc.Vec3(0.1, 0.78, 0.12),
        this.material("torch-iron", palette.iron, { metalness: 0.7 }),
        new pc.Vec3(0, 0, x < 0 ? -28 : 28),
      );
      this.primitive(
        "wall-torch-flame",
        "cone",
        backdrop,
        new pc.Vec3(x + (x < 0 ? -0.17 : 0.17), 2.12, 0.84),
        new pc.Vec3(0.23, 0.58, 0.23),
        this.material("torch-flame", new pc.Color(0.95, 0.43, 0.06), {
          emissive: new pc.Color(1, 0.28, 0.02),
        }),
      );
    }
    this.primitive(
      "fortress-string-course",
      "box",
      backdrop,
      new pc.Vec3(0, 4.55, 0.58),
      new pc.Vec3(37.5, 0.28, 0.55),
      stoneB,
    );
  }

  private createRack(name: string, position: pc.Vec3, team: "king" | "queen"): void {
    const root = new pc.Entity(name);
    root.setPosition(position);
    this.app.root.addChild(root);
    const timber = this.material("rack-timber", palette.timber);
    for (const x of [-1.7, 1.7]) {
      this.primitive(
        `${name}-post`,
        "box",
        root,
        new pc.Vec3(x, 0, 0),
        new pc.Vec3(0.24, 4, 0.3),
        timber,
      );
      for (const y of [-1.3, 0, 1.3]) {
        this.primitive(
          `${name}-arm`,
          "box",
          root,
          new pc.Vec3(x, y, 0.65),
          new pc.Vec3(0.22, 0.2, 1.5),
          timber,
        );
      }
    }
    const flag = this.material(`${team}-flag`, team === "king" ? palette.king : palette.queen);
    this.primitive(
      `${name}-flag`,
      "box",
      root,
      new pc.Vec3(0, 2.15, 0),
      new pc.Vec3(2.7, 0.62, 0.035),
      flag,
    );
  }

  private createBrokenTrebuchet(): void {
    const root = new pc.Entity("repairable-trebuchet");
    root.setPosition(11.7, 0.22, -5.6);
    root.setEulerAngles(0, -12, 0);
    this.app.root.addChild(root);
    const timber = this.material("weathered-timber", new pc.Color(0.28, 0.16, 0.075));
    this.primitive("trebuchet-bed", "box", root, new pc.Vec3(0, 0.45, 0), new pc.Vec3(4.4, 0.3, 1.7), timber);
    this.primitive("trebuchet-upright-a", "box", root, new pc.Vec3(-0.6, 1.4, -0.6), new pc.Vec3(0.26, 2.8, 0.25), timber, new pc.Vec3(0, 0, -12));
    this.primitive("trebuchet-upright-b", "box", root, new pc.Vec3(-0.6, 1.4, 0.6), new pc.Vec3(0.26, 2.8, 0.25), timber, new pc.Vec3(0, 0, -12));
    this.primitive("trebuchet-arm", "box", root, new pc.Vec3(0.65, 2.25, 0), new pc.Vec3(4.8, 0.28, 0.28), timber, new pc.Vec3(0, 0, 18));
    this.primitive("counterweight", "box", root, new pc.Vec3(-1.45, 1.72, 0), new pc.Vec3(0.85, 0.9, 0.9), this.material("iron", palette.iron, { metalness: 0.7 }));
  }

  private createWall(): pc.Entity {
    const root = new pc.Entity("authoritative-tower");
    this.app.root.addChild(root);
    return root;
  }

  private syncTower(entities: TransformState[]): void {
    const seen = new Set<string>();
    for (const state of entities) {
      if (
        state.kind !== "block" &&
        state.kind !== "seat" &&
        state.kind !== "plinth"
      ) continue;
      seen.add(state.id);
      let visual = this.towerVisuals.get(state.id);
      if (!visual) {
        visual = this.createTowerVisual(state);
        this.towerVisuals.set(state.id, visual);
      }
      visual.body.enabled = true;
      visual.targetPosition.copy(this.towerVisualPosition(state));
      visual.targetAngle = state.angle * DEG;
      visual.targetYaw = (state.puzzleYaw ?? 0) * DEG;
    }
    for (const [id, visual] of this.towerVisuals) {
      visual.body.enabled = seen.has(id);
    }
  }

  private createTowerVisual(state: TransformState): TowerVisual {
    const isSeat = state.id === "humpty_seat";
    const isPlinth = state.kind === "plinth";
    const root = new pc.Entity(state.id);
    root.setPosition(this.towerVisualPosition(state));
    root.setEulerAngles(0, (state.puzzleYaw ?? 0) * DEG, state.angle * DEG);
    this.wall.addChild(root);

    const oak = this.material(
      isSeat ? "royal-seat-oak" : isPlinth ? "tower-plinth-stone" : "tower-block-oak",
      isSeat
        ? new pc.Color(0.34, 0.17, 0.06)
        : isPlinth
          ? new pc.Color(0.39, 0.385, 0.34)
          : new pc.Color(0.43, 0.245, 0.095),
      { gloss: 0.16 },
    );
    const iron = this.material("tower-block-iron", palette.iron, {
      metalness: 0.72,
      gloss: 0.38,
    });
    const length = (state.width ?? 180) / WORLD_TO_STAGE_X;
    const height = (state.height ?? 52) / 57;
    const depth = isSeat || isPlinth ? length : length / 3;
    if (isPlinth) {
      this.primitive(
        `${state.id}:stone`,
        "box",
        root,
        pc.Vec3.ZERO,
        new pc.Vec3(length, height, depth),
        oak,
      );
    } else if (isSeat) {
      this.primitive(
        `${state.id}:base`,
        "cylinder",
        root,
        pc.Vec3.ZERO,
        new pc.Vec3(length * 0.82, height, length * 0.82),
        oak,
      );
      const rimRadius = length * 0.39;
      for (let index = 0; index < 8; index += 1) {
        const angle = (index / 8) * Math.PI * 2;
        this.primitive(
          `${state.id}:rim`,
          "box",
          root,
          new pc.Vec3(
            Math.cos(angle) * rimRadius,
            height * 0.72,
            Math.sin(angle) * rimRadius,
          ),
          new pc.Vec3(length * 0.3, Math.max(0.2, height * 1.45), 0.22),
          iron,
          new pc.Vec3(0, -angle * DEG + 90, 0),
        );
      }
    } else {
      // A small reveal between otherwise identical oak blocks keeps the square
      // basket-weave legible without falsifying the solver contact geometry.
      this.primitive(
        `${state.id}:timber`,
        "box",
        root,
        pc.Vec3.ZERO,
        new pc.Vec3(length * 0.965, height * 0.94, depth * 0.93),
        oak,
      );
    }
    return {
      body: root,
      targetPosition: root.getPosition().clone(),
      targetAngle: state.angle * DEG,
      targetYaw: (state.puzzleYaw ?? 0) * DEG,
    };
  }

  private towerVisualPosition(state: TransformState): pc.Vec3 {
    const height = Math.max(
      (state.height ?? 52) / (WORLD_TO_STAGE_Y * 2),
      (state.y - SERVER_GROUND_Y) / WORLD_TO_STAGE_Y,
    );
    const match = /^block_(\d+)$/.exec(state.id);
    if (!match) {
      return new pc.Vec3(
        (state.x - SERVER_TOWER_X) / WORLD_TO_STAGE_X,
        height,
        state.puzzleDepth ?? 0,
      );
    }

    const index = Number(match[1]);
    const lane = (index % SERVER_TOWER_BLOCKS_PER_LAYER) - 1;
    const alongDepth = Math.abs(Math.sin(state.puzzleYaw ?? 0)) > 0.5;
    const blockDepth =
      (state.width ?? 180) /
      WORLD_TO_STAGE_X /
      SERVER_TOWER_BLOCKS_PER_LAYER;
    const solverRestX =
      SERVER_TOWER_X + lane * SERVER_TOWER_BLOCK_WIDTH;
    const solverDisplacementX =
      (state.x - solverRestX) / WORLD_TO_STAGE_X;

    return new pc.Vec3(
      solverDisplacementX + (alongDepth ? lane * blockDepth : 0),
      height,
      alongDepth ? 0 : lane * blockDepth,
    );
  }

  private createHumpty(): {
    body: pc.Entity;
    rig: pc.Entity;
    face: pc.Entity;
    mouth: pc.Entity;
  } {
    const body = this.rigidPrimitive(
      "humpty",
      "sphere",
      new pc.Vec3(0, WALL_TOP + 1.25, 0),
      new pc.Vec3(2.05, 2.55, 1.85),
      this.material("egg-shell", palette.egg, { gloss: 0.38 }),
      {
        bodyType: "kinematic",
        mass: 42,
        friction: 0.72,
        restitution: 0.02,
        collisionScale: new pc.Vec3(1.9, 1.9, 1.9),
      },
    );
    body.rigidbody!.linearDamping = 0.16;
    body.rigidbody!.angularDamping = 0.42;
    const rig = new pc.Entity("humpty-rig");
    body.addChild(rig);
    const face = new pc.Entity("humpty-face");
    rig.addChild(face);
    face.setLocalPosition(0, 0.08, 0.86);
    const eyeMat = this.material("humpty-eyes", new pc.Color(0.96, 0.94, 0.83), { gloss: 0.55 });
    const pupilMat = this.material("humpty-pupils", palette.ink, { gloss: 0.5 });
    for (const x of [-0.38, 0.38]) {
      this.primitive("eye", "sphere", face, new pc.Vec3(x, 0.25, 0), new pc.Vec3(0.38, 0.48, 0.18), eyeMat);
      this.primitive("pupil", "sphere", face, new pc.Vec3(x, 0.23, 0.11), new pc.Vec3(0.14, 0.2, 0.08), pupilMat);
      const brow = this.primitive("brow", "box", face, new pc.Vec3(x, 0.62, 0.09), new pc.Vec3(0.44, 0.07, 0.06), pupilMat, new pc.Vec3(0, 0, x < 0 ? -8 : 8));
      this.humptyBrows.push(brow);
    }
    this.primitive("nose", "cone", face, new pc.Vec3(0, 0.03, 0.15), new pc.Vec3(0.16, 0.34, 0.16), this.material("nose", palette.ochre), new pc.Vec3(90, 0, 0));
    const mouth = this.primitive("mouth", "box", face, new pc.Vec3(0, -0.33, 0.11), new pc.Vec3(0.52, 0.08, 0.06), pupilMat);
    const crown = new pc.Entity("humpty-crown");
    crown.setLocalPosition(0, 1.32, 0);
    rig.addChild(crown);
    const gold = this.material("crown-gold", palette.ochre, { metalness: 0.45, gloss: 0.7 });
    this.primitive("crown-band", "cylinder", crown, pc.Vec3.ZERO, new pc.Vec3(0.82, 0.22, 0.82), gold);
    for (let index = 0; index < 5; index += 1) {
      const angle = (index / 5) * Math.PI * 2;
      this.primitive(
        "crown-point",
        "cone",
        crown,
        new pc.Vec3(Math.cos(angle) * 0.3, 0.28, Math.sin(angle) * 0.3),
        new pc.Vec3(0.16, 0.5, 0.16),
        gold,
      );
    }
    this.createHumptyArm(rig, -1);
    this.createHumptyArm(rig, 1);
    this.primitive("left-boot", "box", rig, new pc.Vec3(-0.55, -1.16, 0.18), new pc.Vec3(0.55, 0.3, 0.8), this.material("boot", palette.ink), new pc.Vec3(0, 0, -8));
    this.primitive("right-boot", "box", rig, new pc.Vec3(0.55, -1.16, 0.18), new pc.Vec3(0.55, 0.3, 0.8), this.material("boot", palette.ink), new pc.Vec3(0, 0, 8));

    this.bubbles.set("humpty", { id: "humpty", entity: body });
    return { body, rig, face, mouth };
  }

  private createHumptyArm(parent: pc.Entity, direction: -1 | 1): void {
    const arm = new pc.Entity(direction < 0 ? "left-arm" : "right-arm");
    arm.setLocalPosition(direction * 1.0, 0.05, 0);
    arm.setLocalEulerAngles(0, 0, direction * -22);
    parent.addChild(arm);
    this.primitive("sleeve", "cylinder", arm, new pc.Vec3(direction * 0.35, 0, 0), new pc.Vec3(0.22, 0.75, 0.22), this.material("humpty-coat", palette.king), new pc.Vec3(0, 0, 90));
    this.primitive("glove", "sphere", arm, new pc.Vec3(direction * 0.78, 0, 0), new pc.Vec3(0.32, 0.29, 0.22), this.material("glove", palette.cream));
  }

  private createKingGallery(): void {
    const root = new pc.Entity("king-command-gallery");
    root.setPosition(-11.4, 6.35, -6.42);
    this.app.root.addChild(root);
    const recess = this.material("gallery-recess", new pc.Color(0.095, 0.085, 0.07), {
      gloss: 0.04,
    });
    const cutStone = this.material("gallery-cut-stone", new pc.Color(0.48, 0.455, 0.4), {
      gloss: 0.1,
    });
    this.primitive("gallery-shadow", "box", root, new pc.Vec3(0, 0, 0), new pc.Vec3(4.2, 5.2, 0.24), recess);
    for (const x of [-2.05, 2.05]) {
      this.primitive("gallery-jamb", "box", root, new pc.Vec3(x, -0.2, 0.24), new pc.Vec3(0.48, 4.8, 0.55), cutStone);
    }
    this.primitive("gallery-lintel", "box", root, new pc.Vec3(0, 2.25, 0.25), new pc.Vec3(4.5, 0.52, 0.62), cutStone);
    this.primitive("gallery-parapet", "box", root, new pc.Vec3(0, -1.75, 0.72), new pc.Vec3(4.4, 1.0, 1.0), cutStone);
    for (const x of [-1.6, -0.55, 0.55, 1.6]) {
      this.primitive("gallery-crenel", "box", root, new pc.Vec3(x, -1.0, 0.72), new pc.Vec3(0.62, 0.58, 0.9), cutStone);
    }
    const kingCoat = this.material("king-royal-coat", palette.king, { gloss: 0.2 });
    const gold = this.material("king-crown-gold", palette.ochre, {
      metalness: 0.45,
      gloss: 0.68,
    });
    this.primitive("king-body", "capsule", root, new pc.Vec3(0, -0.15, 0.76), new pc.Vec3(1.18, 2.25, 0.86), kingCoat);
    const head = this.primitive(
      "king-head",
      "sphere",
      root,
      new pc.Vec3(0, 1.25, 0.8),
      new pc.Vec3(0.84, 0.9, 0.72),
      this.material("king-skin", new pc.Color(0.61, 0.43, 0.31)),
    );
    this.primitive("king-beard", "cone", head, new pc.Vec3(0, -0.55, 0.15), new pc.Vec3(0.58, 0.92, 0.44), this.material("king-beard", new pc.Color(0.22, 0.12, 0.065)));
    this.primitive("king-crown", "cone", head, new pc.Vec3(0, 0.72, 0), new pc.Vec3(0.72, 0.82, 0.68), gold);
    this.bubbles.set("king", { id: "king", entity: head });
  }

  private createQueenGallery(): void {
    const gallery = new pc.Entity("queen-wall-gallery");
    gallery.setPosition(5.0, 6.55, -5.55);
    this.app.root.addChild(gallery);
    const stone = this.material("queen-gallery-stone", palette.stoneDark, {
      gloss: 0.08,
    });
    const timber = this.material("queen-gallery-timber", palette.timber, {
      gloss: 0.12,
    });
    const iron = this.material("queen-gallery-iron", palette.iron, {
      metalness: 0.66,
      gloss: 0.32,
    });
    this.primitive(
      "queen-gallery-floor",
      "box",
      gallery,
      new pc.Vec3(0, 0, 0),
      new pc.Vec3(5.5, 0.34, 1.18),
      timber,
    );
    for (const x of [-2.35, -1.18, 0, 1.18, 2.35]) {
      this.primitive(
        "queen-gallery-corbels",
        "box",
        gallery,
        new pc.Vec3(x, -0.5, -0.12),
        new pc.Vec3(0.34, 0.92, 0.72),
        stone,
        new pc.Vec3(0, 0, x < 0 ? -8 : 8),
      );
      this.primitive(
        "queen-gallery-post",
        "cylinder",
        gallery,
        new pc.Vec3(x, 0.66, 0.54),
        new pc.Vec3(0.12, 1.12, 0.12),
        iron,
      );
    }
    this.primitive(
      "queen-gallery-rail",
      "box",
      gallery,
      new pc.Vec3(0, 1.14, 0.54),
      new pc.Vec3(5.35, 0.13, 0.13),
      iron,
    );

    const queen = new pc.Entity("queen-pacing");
    queen.setLocalPosition(0, 1.36, 0.34);
    queen.setLocalScale(0.7, 0.7, 0.7);
    gallery.addChild(queen);
    this.queenPortrait = queen;
    const gold = this.material("queen-gallery-gold", palette.ochre, {
      metalness: 0.58,
      gloss: 0.62,
    });
    const dress = this.material(
      "queen-gallery-dress",
      new pc.Color(0.045, 0.38, 0.29),
      { gloss: 0.24 },
    );
    const skin = this.material(
      "queen-gallery-skin",
      new pc.Color(0.67, 0.49, 0.35),
      { gloss: 0.28 },
    );
    const hair = this.material(
      "queen-gallery-hair",
      new pc.Color(0.07, 0.035, 0.025),
      { gloss: 0.14 },
    );
    this.primitive(
      "queen-body",
      "capsule",
      queen,
      new pc.Vec3(0, -0.15, 0),
      new pc.Vec3(1.2, 2.05, 0.72),
      dress,
    );
    const head = this.primitive(
      "queen-head",
      "sphere",
      queen,
      new pc.Vec3(0, 1.16, 0.08),
      new pc.Vec3(0.96, 1.04, 0.82),
      skin,
    );
    this.queenPortraitHead = head;
    this.primitive(
      "queen-hair",
      "sphere",
      head,
      new pc.Vec3(0, 0.12, -0.23),
      new pc.Vec3(1.12, 1.2, 0.62),
      hair,
    );
    for (const x of [-0.2, 0.2]) {
      this.primitive(
        "queen-eye",
        "sphere",
        head,
        new pc.Vec3(x, 0.12, 0.43),
        new pc.Vec3(0.09, 0.11, 0.07),
        hair,
      );
      this.primitive(
        "queen-brow",
        "box",
        head,
        new pc.Vec3(x, 0.3, 0.43),
        new pc.Vec3(0.28, 0.06, 0.05),
        hair,
        new pc.Vec3(0, 0, x < 0 ? -14 : 14),
      );
    }
    this.queenPortraitMouth = this.primitive(
      "queen-mouth",
      "box",
      head,
      new pc.Vec3(0, -0.3, 0.45),
      new pc.Vec3(0.35, 0.08, 0.06),
      hair,
      new pc.Vec3(0, 0, -7),
    );
    this.primitive(
      "queen-crown",
      "cone",
      head,
      new pc.Vec3(0, 0.9, -0.02),
      new pc.Vec3(0.88, 0.92, 0.58),
      gold,
    );
    for (let index = -3; index <= 3; index += 1) {
      this.primitive(
        "queen-ruff",
        "sphere",
        queen,
        new pc.Vec3(index * 0.21, 0.55 - Math.abs(index) * 0.035, 0.45),
        new pc.Vec3(0.28, 0.28, 0.18),
        this.material("queen-gallery-ruff", palette.cream, { gloss: 0.3 }),
      );
    }
    this.primitive(
      "queen-scepter",
      "box",
      queen,
      new pc.Vec3(0.78, -0.24, 0.42),
      new pc.Vec3(0.1, 1.82, 0.1),
      gold,
      new pc.Vec3(0, 0, -16),
    );
    this.primitive(
      "queen-left-foot",
      "box",
      queen,
      new pc.Vec3(-0.26, -1.18, 0.14),
      new pc.Vec3(0.3, 0.34, 0.48),
      hair,
    );
    this.primitive(
      "queen-right-foot",
      "box",
      queen,
      new pc.Vec3(0.26, -1.18, 0.14),
      new pc.Vec3(0.3, 0.34, 0.48),
      hair,
    );
    this.bubbles.set("queen", { id: "queen", entity: head });
  }

  private createPikeModel(name: string, parent: pc.Entity): pc.Entity {
    const pike = new pc.Entity(name);
    parent.addChild(pike);
    this.primitive(
      `${name}-shaft`,
      "cylinder",
      pike,
      pc.Vec3.ZERO,
      new pc.Vec3(0.075, 2.8, 0.075),
      this.material("pike-ash", new pc.Color(0.42, 0.24, 0.1), {
        gloss: 0.18,
      }),
    );
    this.primitive(
      `${name}-head`,
      "cone",
      pike,
      new pc.Vec3(0, 1.58, 0),
      new pc.Vec3(0.19, 0.42, 0.19),
      this.material("pike-head", palette.iron, {
        metalness: 0.82,
        gloss: 0.42,
      }),
    );
    this.primitive(
      `${name}-socket`,
      "cylinder",
      pike,
      new pc.Vec3(0, 1.37, 0),
      new pc.Vec3(0.12, 0.28, 0.12),
      this.material("pike-socket", palette.iron, {
        metalness: 0.76,
      }),
    );
    this.primitive(
      `${name}-butt`,
      "cylinder",
      pike,
      new pc.Vec3(0, -1.47, 0),
      new pc.Vec3(0.11, 0.18, 0.11),
      this.material("pike-butt", palette.iron, {
        metalness: 0.72,
      }),
    );
    return pike;
  }

  private createCrossbowModel(name: string, parent: pc.Entity): pc.Entity {
    const crossbow = new pc.Entity(name);
    parent.addChild(crossbow);
    const stock = this.material("crossbow-stock", new pc.Color(0.34, 0.17, 0.065), {
      gloss: 0.2,
    });
    const horn = this.material("crossbow-prod", new pc.Color(0.22, 0.19, 0.14), {
      gloss: 0.3,
    });
    this.primitive(
      `${name}-tiller`,
      "box",
      crossbow,
      new pc.Vec3(0, 0, 0.16),
      new pc.Vec3(0.15, 0.15, 1.35),
      stock,
    );
    this.primitive(
      `${name}-left-prod`,
      "box",
      crossbow,
      new pc.Vec3(-0.39, 0, -0.18),
      new pc.Vec3(0.82, 0.09, 0.11),
      horn,
      new pc.Vec3(0, -8, 0),
    );
    this.primitive(
      `${name}-right-prod`,
      "box",
      crossbow,
      new pc.Vec3(0.39, 0, -0.18),
      new pc.Vec3(0.82, 0.09, 0.11),
      horn,
      new pc.Vec3(0, 8, 0),
    );
    const string = this.material("crossbow-string", palette.rope, {
      gloss: 0.08,
    });
    this.primitive(
      `${name}-left-string`,
      "box",
      crossbow,
      new pc.Vec3(-0.38, 0.035, 0.08),
      new pc.Vec3(0.86, 0.022, 0.022),
      string,
      new pc.Vec3(0, -31, 0),
    );
    this.primitive(
      `${name}-right-string`,
      "box",
      crossbow,
      new pc.Vec3(0.38, 0.035, 0.08),
      new pc.Vec3(0.86, 0.022, 0.022),
      string,
      new pc.Vec3(0, 31, 0),
    );
    this.primitive(
      `${name}-nut`,
      "cylinder",
      crossbow,
      new pc.Vec3(0, 0.09, 0.31),
      new pc.Vec3(0.18, 0.13, 0.18),
      this.material("crossbow-iron", palette.iron, {
        metalness: 0.74,
      }),
      new pc.Vec3(90, 0, 0),
    );
    this.primitive(
      `${name}-trigger`,
      "box",
      crossbow,
      new pc.Vec3(0, -0.13, 0.38),
      new pc.Vec3(0.08, 0.24, 0.08),
      this.material("crossbow-trigger", palette.iron, {
        metalness: 0.7,
      }),
      new pc.Vec3(-18, 0, 0),
    );
    return crossbow;
  }

  private createWorkers(): void {
    const definitions: Array<[string, string, "king" | "queen", number, number]> = [
      ["king_1", "Bell", "king", -6.7, -1.2],
      ["king_2", "March", "king", -5.8, 0.2],
      ["king_3", "Pike", "king", -4.9, 1.5],
      ["queen_1", "Vex", "queen", 6.7, -1.2],
      ["queen_2", "Moth", "queen", 5.8, 0.2],
      ["queen_3", "Knell", "queen", 4.9, 1.5],
    ];
    for (const [id, name, team, x, z] of definitions) {
      const worker = this.createWorker(id, name, team, new pc.Vec3(x, 1.05, z));
      this.workers.set(id, worker);
      this.bubbles.set(id, { id, entity: worker.body });
    }
  }

  private createWorker(
    id: string,
    name: string,
    team: "king" | "queen",
    position: pc.Vec3,
  ): WorkerRuntime {
    const body = this.rigidPrimitive(
      id,
      "capsule",
      position,
      new pc.Vec3(0.62, 1.82, 0.62),
      this.material(`${team}-uniform`, team === "king" ? palette.king : palette.queen, { gloss: 0.18 }),
      {
        bodyType: "kinematic",
        mass: 76,
        friction: 0.85,
        restitution: 0,
        collisionScale: new pc.Vec3(0.62, 1.82, 0.62),
      },
    );
    this.bodyVisuals.get(body)!.enabled = false;
    body.rigidbody!.angularFactor = new pc.Vec3(0, 0, 0);
    body.rigidbody!.linearDamping = 0.66;
    const teamGroup =
      team === "king" ? pc.BODYGROUP_USER_2 : pc.BODYGROUP_USER_3;
    body.rigidbody!.group = teamGroup;
    body.rigidbody!.mask =
      pc.BODYMASK_ALL ^ pc.BODYGROUP_USER_1 ^ teamGroup;
    const rig = new pc.Entity(`${id}-rig`);
    body.addChild(rig);
    this.primitive("torso", "box", rig, new pc.Vec3(0, 0.1, 0), new pc.Vec3(0.72, 0.9, 0.42), this.material(`${team}-coat`, team === "king" ? palette.king : palette.queen));
    const head = this.primitive("head", "sphere", rig, new pc.Vec3(0, 0.78, 0), new pc.Vec3(0.5, 0.55, 0.48), this.material("worker-skin", new pc.Color(0.66, 0.48, 0.34)));
    this.primitive("helmet", "sphere", head, new pc.Vec3(0, 0.2, 0), new pc.Vec3(0.56, 0.3, 0.54), this.material(`${team}-helmet`, team === "king" ? palette.iron : palette.brass, { metalness: 0.55 }));
    const leftArm = this.primitive("left-arm", "cylinder", rig, new pc.Vec3(-0.47, 0.06, 0), new pc.Vec3(0.16, 0.76, 0.16), this.material(`${team}-sleeve`, team === "king" ? palette.king : palette.queen), new pc.Vec3(0, 0, -14));
    const rightArm = this.primitive("right-arm", "cylinder", rig, new pc.Vec3(0.47, 0.06, 0), new pc.Vec3(0.16, 0.76, 0.16), this.material(`${team}-sleeve`, team === "king" ? palette.king : palette.queen), new pc.Vec3(0, 0, 14));
    this.primitive("left-leg", "cylinder", rig, new pc.Vec3(-0.22, -0.68, 0), new pc.Vec3(0.18, 0.72, 0.18), this.material("worker-boot", palette.ink));
    this.primitive("right-leg", "cylinder", rig, new pc.Vec3(0.22, -0.68, 0), new pc.Vec3(0.18, 0.72, 0.18), this.material("worker-boot", palette.ink));
    const tool = this.primitive("hand-tool", "box", rightArm, new pc.Vec3(0, -0.46, 0.12), new pc.Vec3(0.12, 0.62, 0.1), this.material("tool-iron", palette.iron, { metalness: 0.72 }));
    tool.enabled = false;
    const pike = this.createPikeModel(`${id}-pike`, rig);
    pike.setLocalPosition(0.38, 0.05, 0.22);
    pike.setLocalEulerAngles(90, 0, 0);
    pike.enabled = false;
    const crossbow = this.createCrossbowModel(`${id}-crossbow`, rig);
    crossbow.setLocalPosition(0, 0.12, 0.48);
    crossbow.enabled = false;
    return {
      id,
      name,
      team,
      body,
      rig,
      leftArm,
      rightArm,
      tool,
      pike,
      crossbow,
      goal: position.clone(),
      lastPosition: position.clone(),
      lastGoalDistance: Number.POSITIVE_INFINITY,
      phaseUntil: 0,
      facing: team === "king" ? 1 : -1,
      grounded: false,
      stalledFor: 0,
      activity: "idle",
    };
  }

  private createStockAndPlans(): void {
    const blueprints: BlueprintPlan[] = [
      createBlueprint("skid", "king"),
      createBlueprint("cart", "king"),
      createBlueprint("screw_jack", "king"),
      createBlueprint("mast", "king"),
      createBlueprint("lever", "king"),
      createBlueprint("brace", "king"),
      createBlueprint("ladder", "king"),
      createBlueprint("winch", "king"),
      createBlueprint("pulley", "king"),
      createBlueprint("sling", "king"),
      createBlueprint("cart", "queen"),
      createBlueprint("lever", "queen"),
      createBlueprint("spring_trap", "queen"),
    ];
    for (let sequence = 0; sequence < 16; sequence += 1) {
      const laneX = 6.8 + (sequence % 4) * 1.45;
      blueprints.push(
        createBlueprint(
          "barricade",
          "queen",
          sequence,
          laneX * WORLD_TO_STAGE_X + 600,
        ),
      );
    }
    const teamIndex = { king: 0, queen: 0 };
    for (const blueprint of blueprints) {
      for (const plan of blueprint.components) {
        const index = teamIndex[blueprint.team]++;
        const runtime = this.createStockPart(plan, blueprint, index);
        this.parts.set(plan.id, runtime);
      }
    }
  }

  private syncPuzzleParts(
    entities: TransformState[],
    previews: ServerSnapshot["snapPreviews"],
  ): void {
    const seen = new Set<string>();
    const activePorts = new Set(
      previews
        .filter((preview) => preview.phase === "snap")
        .flatMap((preview) => [
          `${preview.movingId}:${preview.movingPort}`,
          `${preview.targetId}:${preview.targetPort}`,
        ]),
    );
    for (const state of entities) {
      if (!state.puzzleKind || !state.componentType) continue;
      seen.add(state.id);
      let visual = this.puzzleVisuals.get(state.id);
      if (!visual) {
        visual = this.createPuzzleVisual(state);
        this.puzzleVisuals.set(state.id, visual);
      }
      visual.body.enabled = this.puzzleMode;
      const size = this.partScale(visual.plan);
      const euler = this.partEuler(visual.plan, state.angle * DEG);
      euler.y += (state.puzzleYaw ?? 0) * DEG;
      visual.targetPosition.set(
        (state.x - 600) / WORLD_TO_STAGE_X,
        Math.max(
          this.partVerticalHalf(visual.plan, size, euler.z),
          (state.y - 30) / 57,
        ),
        state.puzzleDepth ?? 0,
      );
      visual.targetAngle = state.angle * DEG;
      visual.targetYaw = (state.puzzleYaw ?? 0) * DEG;
      const portMaterial = this.material(
        `${state.team ?? "neutral"}-free-snap`,
        state.team === "king" ? palette.king : palette.queen,
        { metalness: 0.42, gloss: 0.62 },
      );
      const joinedMaterial = this.material(
        "joined-snap",
        palette.brass,
        { metalness: 0.72, gloss: 0.7 },
      );
      const engineeringMaterial = this.material(
        "engineering-snap",
        new pc.Color(0.96, 0.72, 0.16),
        { metalness: 0.55, gloss: 0.76, emissive: new pc.Color(0.3, 0.16, 0.01) },
      );
      visual.portMarkers.forEach((marker, portId) => {
        const port = state.snapPorts?.find((candidate) => candidate.id === portId);
        const occupied = port?.occupiedBy;
        const active = activePorts.has(`${state.id}:${portId}`);
        marker.root.enabled = active || this.engineeringOverlay;
        if (marker.face.render) {
          marker.face.render.material = occupied
            ? joinedMaterial
            : active
              ? this.material("active-snap", palette.ochre, {
                  metalness: 0.48,
                  gloss: 0.72,
                  emissive: new pc.Color(0.55, 0.28, 0.02),
                })
              : this.engineeringOverlay
                ? engineeringMaterial
                : portMaterial;
        }
        const markerScale = active ? 1.9 : occupied ? 0.82 : 1.35;
        marker.root.setLocalScale(markerScale, markerScale, markerScale);
      });
    }
    for (const [id, visual] of this.puzzleVisuals) {
      visual.body.enabled = this.puzzleMode && seen.has(id);
    }
    this.syncPuzzleConnections(entities);
    this.syncPuzzlePreviews(previews, entities);
  }

  private syncPuzzleConnections(entities: TransformState[]): void {
    const byId = new Map(entities.map((entity) => [entity.id, entity]));
    const active = new Set<string>();
    for (const state of entities) {
      if (!state.puzzleKind) continue;
      for (const port of state.snapPorts ?? []) {
        const otherId = port.occupiedBy;
        if (!otherId) continue;
        const key = `puzzle:${[state.id, otherId].sort().join(":")}`;
        if (active.has(key)) continue;
        const from = this.puzzleVisuals
          .get(state.id)
          ?.portMarkers.get(port.id)?.root.getPosition();
        const mateState = byId.get(otherId);
        const matePort = mateState?.snapPorts?.find(
          (candidate) => candidate.occupiedBy === state.id,
        );
        const to = matePort
          ? this.puzzleVisuals
              .get(otherId)
              ?.portMarkers.get(matePort.id)?.root.getPosition()
          : undefined;
        if (!from || !to) continue;
        active.add(key);
        let lock = this.mechanismLines.get(key);
        if (!lock) {
          lock = new pc.Entity(`snap-lock:${key}`);
          lock.addComponent("render", {
            type: "cylinder",
            material: this.material("snap-lock", palette.brass, {
              metalness: 0.74,
              gloss: 0.62,
            }),
            castShadows: true,
          });
          this.app.root.addChild(lock);
          this.mechanismLines.set(key, lock);
        }
        lock.setPosition(from.clone().add(to).mulScalar(0.5));
        lock.setLocalScale(0.2, 0.1, 0.2);
        lock.setEulerAngles(90, 0, 0);
      }
    }
    const humpty = byId.get("humpty");
    if (humpty?.harnessed) {
      const loadedPart = entities
        .filter(
          (entity) =>
            entity.team === "king" &&
            entity.puzzleKind &&
            (entity.stress ?? 0) > 0.45,
        )
        .sort((a, b) => (b.stress ?? 0) - (a.stress ?? 0))[0];
      const from = loadedPart
        ? this.puzzleVisuals.get(loadedPart.id)?.targetPosition
        : undefined;
      if (from) {
        const key = "puzzle:rescue-line";
        active.add(key);
        const to = this.humptyTargetPosition;
        const delta = to.clone().sub(from);
        const length = Math.max(0.12, Math.hypot(delta.x, delta.y));
        let line = this.mechanismLines.get(key);
        if (!line) {
          line = new pc.Entity("puzzle-rescue-line");
          line.addComponent("render", {
            type: "box",
            material: this.material("rescue-line", palette.rope, {
              gloss: 0.1,
            }),
            castShadows: true,
          });
          this.app.root.addChild(line);
          this.mechanismLines.set(key, line);
        }
        line.setPosition(from.clone().add(to).mulScalar(0.5));
        line.setLocalScale(length, 0.09, 0.09);
        line.setEulerAngles(0, 0, Math.atan2(delta.y, delta.x) * DEG);
      }
    }
    for (const [id, line] of this.mechanismLines) {
      if (!id.startsWith("puzzle:") || active.has(id)) continue;
      line.destroy();
      this.mechanismLines.delete(id);
    }
  }

  private puzzleShape(
    plan: ComponentPlan,
  ): "box" | "sphere" | "cylinder" {
    if (
      plan.componentType === "counterweight" ||
      plan.componentType === "fastener"
    ) {
      return "sphere";
    }
    if (
      [
        "drum",
        "sheave",
        "wheel",
        "gear",
        "spring",
        "screw",
        "axle",
        "pin",
        "lashing",
      ].includes(plan.componentType)
    ) {
      return "cylinder";
    }
    return "box";
  }

  private ghostMaterial(team: "king" | "queen"): pc.StandardMaterial {
    const key = `${team}-snap-ghost`;
    const existing = this.materials.get(key);
    if (existing) return existing;
    const material = new pc.StandardMaterial();
    material.name = key;
    material.diffuse = team === "king" ? palette.king : palette.queen;
    material.emissive = team === "king" ? palette.king : palette.queen;
    material.emissiveIntensity = 0.42;
    material.opacity = 0.24;
    material.blendType = pc.BLEND_NORMAL;
    material.depthWrite = false;
    material.update();
    this.materials.set(key, material);
    return material;
  }

  private syncPuzzlePreviews(
    previews: ServerSnapshot["snapPreviews"],
    entities: TransformState[],
  ): void {
    const byId = new Map(entities.map((entity) => [entity.id, entity]));
    const active = new Set<string>();
    for (const preview of previews.filter(
      (candidate) => candidate.phase === "snap",
    )) {
      const visual = this.puzzleVisuals.get(preview.movingId);
      if (!visual) continue;
      const key = `preview:${preview.workerId}`;
      active.add(key);
      let ghost = this.snapGhosts.get(key);
      if (!ghost) {
        ghost = new pc.Entity(`snap-ghost:${preview.workerId}`);
        ghost.setLocalScale(this.partScale(visual.plan));
        ghost.addComponent("render", {
          type: this.puzzleShape(visual.plan),
          material: this.ghostMaterial(preview.team),
          castShadows: false,
          receiveShadows: false,
        });
        this.app.root.addChild(ghost);
        this.snapGhosts.set(key, ghost);
      }
      const size = this.partScale(visual.plan);
      const euler = this.partEuler(visual.plan, preview.targetAngle * DEG);
      ghost.setPosition(
        (preview.targetX - 600) / WORLD_TO_STAGE_X,
        Math.max(
          this.partVerticalHalf(visual.plan, size, euler.z),
          (preview.targetY - 30) / 57,
        ),
        preview.targetDepth - 0.06,
      );
      ghost.setEulerAngles(euler);
      ghost.enabled = true;

      const movingPort = visual.portMarkers.get(preview.movingPort)?.root;
      const targetPort = this.puzzleVisuals
        .get(preview.targetId)
        ?.portMarkers.get(preview.targetPort)?.root;
      if (!movingPort || !targetPort) continue;
      const from = movingPort.getPosition();
      const to = targetPort.getPosition();
      const delta = to.clone().sub(from);
      const length = Math.max(0.08, Math.hypot(delta.x, delta.y));
      let guide = this.mechanismLines.get(key);
      if (!guide) {
        guide = new pc.Entity(`snap-guide:${preview.workerId}`);
        guide.addComponent("render", {
          type: "box",
          material: this.material("snap-guide", palette.ochre, {
            metalness: 0.28,
            gloss: 0.58,
            emissive: new pc.Color(0.42, 0.2, 0.01),
          }),
          castShadows: false,
        });
        this.app.root.addChild(guide);
        this.mechanismLines.set(key, guide);
      }
      guide.setPosition(from.clone().add(to).mulScalar(0.5));
      guide.setLocalScale(length, 0.035, 0.035);
      guide.setEulerAngles(0, 0, Math.atan2(delta.y, delta.x) * DEG);
      guide.enabled = length > 0.11;

      const targetState = byId.get(preview.targetId);
      if (targetState?.team !== preview.team) ghost.enabled = false;
    }
    for (const [key, ghost] of this.snapGhosts) {
      if (active.has(key)) continue;
      ghost.destroy();
      this.snapGhosts.delete(key);
    }
    for (const [key, guide] of this.mechanismLines) {
      if (!key.startsWith("preview:") || active.has(key)) continue;
      guide.destroy();
      this.mechanismLines.delete(key);
    }
  }

  private createPuzzleVisual(state: TransformState): PuzzleVisual {
    const zero = { x: 0, y: 0, angle: 0 };
    const plan: ComponentPlan = {
      id: state.id,
      label: state.puzzleLabel ?? state.puzzleKind ?? "machine part",
      componentType: state.componentType!,
      material: state.material ?? "mixed machine material",
      ...(state.width !== undefined ? { width: state.width } : {}),
      ...(state.height !== undefined ? { height: state.height } : {}),
      ...(state.radius !== undefined ? { radius: state.radius } : {}),
      source: zero,
      staging: zero,
      final: zero,
      operations: ["snap"],
    };
    const size = this.partScale(plan);
    const body = new pc.Entity(`puzzle:${state.id}`);
    const visual = new pc.Entity(`puzzle:${state.id}:visual`);
    visual.setLocalScale(size);
    visual.addComponent("render", {
      type: this.puzzleShape(plan),
      material: this.partMaterial(plan),
      castShadows: true,
      receiveShadows: true,
    });
    body.addChild(visual);
    this.bodyVisuals.set(body, visual);
    this.app.root.addChild(body);
    body.tags.add("puzzle-part", state.team ?? "neutral", plan.componentType);
    this.decorateMechanicalPart(body, plan);

    const portMarkers = new Map<string, PuzzlePortVisual>();
    const markerMaterial = this.material(
      `${state.team ?? "neutral"}-snap-port`,
      state.team === "king" ? palette.king : palette.queen,
      { metalness: 0.42, gloss: 0.62 },
    );
    const femaleKinds = new Set([
      "rigid_socket",
      "bearing_bore",
      "load_eye",
      "cleat",
      "sheave_groove",
      "keyway",
    ]);
    for (const port of state.snapPorts ?? []) {
      const root = new pc.Entity(`snap-port:${state.id}:${port.id}`);
      root.setLocalPosition(
        port.x / WORLD_TO_STAGE_X,
        port.y / 57,
        size.z * 0.56 + port.depth,
      );
      root.setLocalEulerAngles(0, 0, port.normal * DEG);
      body.addChild(root);
      const female = femaleKinds.has(port.kind);
      const face = this.primitive(
        `snap-port-face:${state.id}:${port.id}`,
        female ? "cylinder" : "sphere",
        root,
        pc.Vec3.ZERO,
        female
          ? new pc.Vec3(0.19, 0.07, 0.19)
          : new pc.Vec3(0.13, 0.13, 0.13),
        markerMaterial,
        female ? new pc.Vec3(90, 0, 0) : pc.Vec3.ZERO,
      );
      if (female) {
        this.primitive(
          `snap-port-mouth:${state.id}:${port.id}`,
          "cylinder",
          root,
          new pc.Vec3(0, 0, 0.075),
          new pc.Vec3(0.09, 0.035, 0.09),
          this.material("snap-port-mouth", palette.ink, {
            metalness: 0.3,
            gloss: 0.24,
          }),
          new pc.Vec3(90, 0, 0),
        );
      } else {
        this.primitive(
          `snap-port-stud:${state.id}:${port.id}`,
          "cylinder",
          root,
          new pc.Vec3(0, 0, -0.08),
          new pc.Vec3(0.085, 0.14, 0.085),
          markerMaterial,
          new pc.Vec3(90, 0, 0),
        );
      }
      this.primitive(
        `snap-port-direction:${state.id}:${port.id}`,
        "box",
        root,
        new pc.Vec3(0.14, 0, -0.015),
        new pc.Vec3(0.22, 0.045, 0.045),
        markerMaterial,
      );
      portMarkers.set(port.id, { root, face });
      root.enabled = false;
    }
    const targetPosition = new pc.Vec3(
      (state.x - 600) / WORLD_TO_STAGE_X,
      Math.max(
        this.partVerticalHalf(plan, size, state.angle * DEG),
        (state.y - 30) / 57,
      ),
      state.puzzleDepth ?? 0,
    );
    body.setPosition(targetPosition);
    const initialEuler = this.partEuler(plan, state.angle * DEG);
    initialEuler.y += (state.puzzleYaw ?? 0) * DEG;
    body.setEulerAngles(initialEuler);
    return {
      id: state.id,
      body,
      plan,
      targetPosition,
      targetAngle: state.angle * DEG,
      targetYaw: (state.puzzleYaw ?? 0) * DEG,
      portMarkers,
    };
  }

  private updatePuzzleVisuals(dt: number): void {
    const blend = 1 - Math.exp(-dt * 9);
    for (const visual of this.puzzleVisuals.values()) {
      if (!visual.body.enabled) continue;
      const position = visual.body.getPosition().clone();
      position.lerp(position, visual.targetPosition, blend);
      visual.body.setPosition(position);
      const current = visual.body.getEulerAngles();
      const target = this.partEuler(visual.plan, visual.targetAngle);
      target.y += visual.targetYaw;
      visual.body.setEulerAngles(
        pc.math.lerp(current.x, target.x, blend),
        pc.math.lerp(current.y, target.y, blend),
        pc.math.lerpAngle(current.z, target.z, blend),
      );
    }
  }

  private createStockPart(
    plan: ComponentPlan,
    blueprint: BlueprintPlan,
    index: number,
  ): PartRuntime {
    const long =
      plan.componentType === "timber" ||
      plan.componentType === "rail" ||
      plan.componentType === "rung" ||
      plan.componentType === "brace" ||
      plan.componentType === "crossbeam" ||
      plan.componentType === "bar" ||
      plan.componentType === "platform";
    const xBase = blueprint.team === "king" ? -15.4 : 15.4;
    const direction = blueprint.team === "king" ? 1 : -1;
    const x =
      xBase +
      direction *
        (0.25 + scatterUnit(plan.id, index + 11) * 3.8);
    const y =
      0.18 +
      (index % 5) * 0.13 +
      scatterUnit(plan.id, index + 29) * 0.16;
    const z = -5.6 + scatterUnit(plan.id, index + 47) * 11.2;
    const size = this.partScale(plan);
    const material = this.partMaterial(plan);
    const cylindrical = [
      "drum",
      "sheave",
      "wheel",
      "gear",
      "spring",
      "screw",
      "axle",
      "pin",
      "lashing",
    ].includes(plan.componentType);
    const shape =
      plan.componentType === "counterweight" || plan.componentType === "fastener"
        ? "sphere"
        : cylindrical
          ? "cylinder"
          : "box";
    const axial =
      plan.componentType === "axle" || plan.componentType === "pin";
    const stockAngle =
      axial || plan.componentType === "lashing"
        ? (scatterUnit(plan.id, 71) - 0.5) * 18
        : size.y > size.x * 1.4
        ? 90 + (scatterUnit(plan.id, 71) - 0.5) * 18
        : long
          ? (scatterUnit(plan.id, 71) - 0.5) * 22
          : (scatterUnit(plan.id, 83) - 0.5) * 36;
    const euler = this.partEuler(plan, stockAngle);
    const body = this.rigidPrimitive(
      `stock:${blueprint.team}:${plan.id}`,
      shape,
      new pc.Vec3(
        x,
        y + this.partVerticalHalf(plan, size, euler.z),
        z,
      ),
      size,
      material,
      {
        bodyType: "static",
        mass: this.partMass(plan, size),
        friction: long ? 0.9 : 0.68,
        restitution: 0.02,
        euler,
      },
    );
    body.tags.add("material", blueprint.team, plan.componentType);
    body.enabled = false;
    const detail = this.decorateMechanicalPart(body, plan);
    body.rigidbody!.group = pc.BODYGROUP_USER_1;
    body.rigidbody!.mask =
      pc.BODYMASK_ALL ^
      pc.BODYGROUP_USER_1 ^
      pc.BODYGROUP_USER_2 ^
      pc.BODYGROUP_USER_3;
    const assemblyPose =
      blueprint.finalization === "inspect" ? plan.final : plan.staging;
    const targetPosition = this.poseToWorld(
      assemblyPose,
      blueprint.team,
      blueprint.machineId,
    );
    const assemblyEuler = this.partEuler(plan, assemblyPose.angle * DEG);
    targetPosition.y += this.partVerticalHalf(
      plan,
      size,
      assemblyEuler.z,
    );
    const targetRotation = new pc.Quat().setFromEulerAngles(
      assemblyEuler.x,
      assemblyEuler.y,
      assemblyEuler.z,
    );
    const finalPosition = this.poseToWorld(
      plan.final,
      blueprint.team,
      blueprint.machineId,
    );
    const finalEuler = this.partEuler(plan, plan.final.angle * DEG);
    finalPosition.y += this.partVerticalHalf(plan, size, finalEuler.z);
    const finalRotation = new pc.Quat().setFromEulerAngles(
      finalEuler.x,
      finalEuler.y,
      finalEuler.z,
    );
    const runtime: PartRuntime = {
      id: plan.id,
      plan,
      blueprint,
      body,
      ...(detail ? { detail } : {}),
      targetPosition,
      targetRotation,
      finalPosition,
      finalRotation,
      finalizing: false,
      desiredState: "stock",
      localState: "stock",
      active: false,
      operationIndex: 0,
      stageIndex: Math.max(
        0,
        blueprint.mechanisms.findIndex((stage) =>
          stage.requires.includes(plan.id),
        ),
      ),
    };
    body.rigidbody!.on("collisionstart", (result: pc.ContactResult) => {
      const impactSpeed = result.other.rigidbody?.linearVelocity.length() ?? 0;
      if (
        result.other.tags.has("projectile") &&
        impactSpeed > 8.5 &&
        runtime.localState === "installed"
      ) {
        if (runtime.installedJoint) {
          this.joints.delete(runtime.installedJoint);
          runtime.installedJoint.destroy();
          delete runtime.installedJoint;
        }
        runtime.body.rigidbody!.type = pc.BODYTYPE_DYNAMIC;
        runtime.body.rigidbody!.angularFactor = pc.Vec3.ONE;
        runtime.body.rigidbody!.linearFactor = pc.Vec3.ONE;
        runtime.body.rigidbody!.activate();
        this.dynamicBodies.add(runtime.body);
        runtime.localState = "staged";
        runtime.desiredState = "staged";
        this.installedCount = Math.max(0, this.installedCount - 1);
      }
    });
    return runtime;
  }

  private partScale(plan: ComponentPlan): pc.Vec3 {
    if (
      plan.componentType === "axle" ||
      plan.componentType === "pin" ||
      plan.componentType === "lashing"
    ) {
      const length = Math.max(0.32, (plan.width ?? 18) / WORLD_TO_STAGE_X);
      const diameter = Math.max(
        plan.componentType === "lashing" ? 0.11 : 0.13,
        (plan.height ?? 7) / 55,
      );
      return new pc.Vec3(length, diameter, diameter);
    }
    if (plan.radius) {
      const diameter = Math.max(
        0.28,
        plan.radius / (WORLD_TO_STAGE_X / 2),
      );
      return new pc.Vec3(diameter, Math.max(0.24, diameter * 0.7), diameter);
    }
    const width = Math.max(0.24, (plan.width ?? 18) / WORLD_TO_STAGE_X);
    const height = Math.max(0.22, (plan.height ?? 14) / 57);
    const depth =
      plan.componentType === "canvas"
        ? 0.13
        : plan.componentType === "timber" || plan.componentType === "rail"
          ? Math.max(0.28, Math.min(0.64, Math.min(width, height) * 1.12))
          : plan.componentType === "brace" ||
              plan.componentType === "cheek" ||
              plan.componentType === "crossbeam" ||
              plan.componentType === "platform"
            ? Math.max(0.26, Math.min(0.5, Math.min(width, height)))
            : 0.34;
    return new pc.Vec3(width, height, depth);
  }

  private partEuler(plan: ComponentPlan, angle: number): pc.Vec3 {
    if (
      ["wheel", "gear", "spring", "drum", "sheave"].includes(plan.componentType)
    ) {
      return new pc.Vec3(90, 0, angle);
    }
    if (
      plan.componentType === "axle" ||
      plan.componentType === "pin" ||
      plan.componentType === "lashing"
    ) {
      return new pc.Vec3(0, 0, angle);
    }
    return new pc.Vec3(0, 0, angle);
  }

  private partVerticalHalf(
    plan: ComponentPlan,
    size: pc.Vec3,
    angleDegrees: number,
  ): number {
    if (plan.radius) return Math.max(0.12, size.x / 2);
    const angle = angleDegrees / DEG;
    return Math.max(
      0.12,
      Math.abs(Math.sin(angle)) * (size.x / 2) +
        Math.abs(Math.cos(angle)) * (size.y / 2),
    );
  }

  private partMaterial(plan: ComponentPlan): pc.StandardMaterial {
    if (plan.componentType === "canvas") return this.material("canvas", palette.canvas, { gloss: 0.08 });
    if (plan.componentType === "lashing") return this.material("rope", palette.rope, { gloss: 0.08 });
    if (
      ["axle", "pin", "fastener", "pawl", "hook", "trigger", "gear", "screw", "nut", "saddle"].includes(
        plan.componentType,
      )
    ) {
      return this.material("part-iron", palette.iron, { metalness: 0.68, gloss: 0.52 });
    }
    if (["drum", "sheave", "wheel"].includes(plan.componentType)) {
      return this.material("part-brass", palette.brass, { metalness: 0.35, gloss: 0.48 });
    }
    if (plan.componentType === "spring") {
      return this.material("spring-sinew", new pc.Color(0.29, 0.17, 0.08), {
        gloss: 0.18,
      });
    }
    if (plan.componentType === "counterweight") {
      return this.material("counterweight-stone", palette.stoneDark, { gloss: 0.08 });
    }
    return this.material("part-timber", palette.timber, { gloss: 0.14 });
  }

  private partMass(plan: ComponentPlan, scale: pc.Vec3): number {
    const volume = scale.x * scale.y * scale.z;
    const density = [
      "axle",
      "pin",
      "fastener",
      "pawl",
      "hook",
      "trigger",
      "gear",
      "screw",
      "nut",
      "saddle",
    ].includes(plan.componentType)
      ? 620
      : plan.componentType === "counterweight"
        ? 760
        : 145;
    return pc.math.clamp(volume * density, 0.8, 22);
  }

  private decorateMechanicalPart(
    body: pc.Entity,
    plan: ComponentPlan,
  ): pc.Entity | undefined {
    const detail = new pc.Entity(`${plan.id}:mechanism-detail`);
    const size = this.partScale(plan);
    if (plan.componentType === "bar") {
      body.addChild(detail);
      const iron = this.material("beam-banding", palette.iron, {
        metalness: 0.68,
        gloss: 0.38,
      });
      const teamColor = plan.id.includes("_king_") ? palette.king : palette.queen;
      const wrap = this.material(
        plan.id.includes("_king_") ? "king-beam-wrap" : "queen-beam-wrap",
        teamColor,
        { gloss: 0.12 },
      );
      for (const direction of [-1, 1]) {
        this.primitive(
          "beam-iron-band",
          "box",
          detail,
          new pc.Vec3(direction * size.x * 0.43, 0, 0),
          new pc.Vec3(0.13, size.y * 1.16, size.z * 1.16),
          iron,
        );
        this.primitive(
          "beam-tenon",
          "cylinder",
          detail,
          new pc.Vec3(direction * size.x * 0.54, 0, 0),
          new pc.Vec3(size.y * 0.33, 0.2, size.y * 0.33),
          iron,
          new pc.Vec3(0, 0, 90),
        );
      }
      this.primitive(
        "beam-team-wrap",
        "box",
        detail,
        new pc.Vec3(-size.x * 0.28, 0, 0),
        new pc.Vec3(0.12, size.y * 1.08, size.z * 1.08),
        wrap,
      );
      return detail;
    } else if (plan.componentType === "wheel") {
      body.addChild(detail);
      detail.setLocalEulerAngles(-90, 0, 0);
      const radius = size.x / 2;
      this.bodyVisuals.get(body)!.enabled = false;
      const rim = this.material("wheel-rim", palette.iron, {
        metalness: 0.62,
        gloss: 0.42,
      });
      const hub = this.material("wheel-hub", palette.timberCut, { gloss: 0.16 });
      this.primitive("wheel-hub", "cylinder", detail, pc.Vec3.ZERO, new pc.Vec3(radius * 0.24, 0.22, radius * 0.24), hub, new pc.Vec3(90, 0, 0));
      const spokeCount = radius > 0.85 ? 12 : 8;
      for (let index = 0; index < spokeCount; index += 1) {
        this.primitive(
          "wheel-spoke",
          "box",
          detail,
          pc.Vec3.ZERO,
          new pc.Vec3(Math.max(0.045, radius * 0.065), radius * 1.62, 0.06),
          hub,
          new pc.Vec3(0, 0, index * (180 / spokeCount)),
        );
      }
      const segmentCount = radius > 0.85 ? 20 : 14;
      for (let index = 0; index < segmentCount; index += 1) {
        const angle = (index / segmentCount) * Math.PI * 2;
        this.primitive(
          "wheel-tyre",
          "box",
          detail,
          new pc.Vec3(Math.cos(angle) * radius * 0.88, Math.sin(angle) * radius * 0.88, 0),
          new pc.Vec3(radius * 0.34, Math.max(0.065, radius * 0.12), 0.1),
          rim,
          new pc.Vec3(0, 0, -angle * DEG),
        );
      }
      return detail;
    } else if (plan.componentType === "gear") {
      body.addChild(detail);
      detail.setLocalEulerAngles(-90, 0, 0);
      const radius = size.x / 2;
      const tooth = this.material("ratchet-teeth", palette.iron, {
        metalness: 0.78,
        gloss: 0.46,
      });
      for (let index = 0; index < 16; index += 1) {
        const angle = (index / 16) * Math.PI * 2;
        this.primitive(
          "ratchet-tooth",
          "box",
          detail,
          new pc.Vec3(Math.cos(angle) * radius * 0.98, Math.sin(angle) * radius * 0.98, 0),
          new pc.Vec3(radius * 0.3, radius * 0.13, 0.11),
          tooth,
          new pc.Vec3(0, 0, -angle * DEG + 11),
        );
      }
      this.primitive(
        "ratchet-hub",
        "cylinder",
        detail,
        pc.Vec3.ZERO,
        new pc.Vec3(radius * 0.24, 0.22, radius * 0.24),
        tooth,
        new pc.Vec3(90, 0, 0),
      );
      return detail;
    } else if (plan.componentType === "spring") {
      body.addChild(detail);
      detail.setLocalEulerAngles(-90, 0, 0);
      const radius = size.x / 2;
      const sinew = this.material("spring-wrap", palette.rope, { gloss: 0.12 });
      for (let index = -6; index <= 6; index += 1) {
        this.primitive(
          "spring-winding",
          "cylinder",
          detail,
          new pc.Vec3(0, 0, index * 0.055),
          new pc.Vec3(
            radius * 0.92 - Math.abs(index) * 0.018,
            0.05,
            radius * 0.92 - Math.abs(index) * 0.018,
          ),
          sinew,
          new pc.Vec3(90, 0, 0),
        );
      }
      return detail;
    } else if (plan.componentType === "screw") {
      body.addChild(detail);
      const thread = this.material("screw-thread", palette.brass, {
        metalness: 0.28,
        gloss: 0.35,
      });
      for (let index = -4; index <= 4; index += 1) {
        this.primitive(
          "screw-thread",
          "cylinder",
          detail,
          new pc.Vec3(0, index * 0.23, 0),
          new pc.Vec3(0.48, 0.055, 0.48),
          thread,
        );
      }
      return detail;
    } else if (
      plan.componentType === "drum" ||
      plan.componentType === "sheave"
    ) {
      body.addChild(detail);
      detail.setLocalEulerAngles(-90, 0, 0);
      const radius = size.x / 2;
      const band = this.material(
        plan.componentType === "drum" ? "drum-band" : "sheave-groove",
        plan.componentType === "drum" ? palette.rope : palette.iron,
        { metalness: plan.componentType === "drum" ? 0 : 0.58, gloss: 0.34 },
      );
      for (let index = 0; index < 14; index += 1) {
        const angle = (index / 14) * Math.PI * 2;
        this.primitive(
          `${plan.componentType}-rim`,
          "box",
          detail,
          new pc.Vec3(Math.cos(angle) * radius * 0.88, Math.sin(angle) * radius * 0.88, 0),
          new pc.Vec3(radius * 0.31, Math.max(0.05, radius * 0.1), 0.08),
          band,
          new pc.Vec3(0, 0, -angle * DEG),
        );
      }
      this.primitive(
        `${plan.componentType}-hub`,
        "cylinder",
        detail,
        pc.Vec3.ZERO,
        new pc.Vec3(radius * 0.28, 0.28, radius * 0.28),
        this.material("mechanism-hub", palette.timberCut, { gloss: 0.16 }),
        new pc.Vec3(90, 0, 0),
      );
      for (const z of [-0.18, 0.18]) {
        this.primitive(
          `${plan.componentType}-flange`,
          "cylinder",
          detail,
          new pc.Vec3(0, 0, z),
          new pc.Vec3(radius * 1.04, 0.075, radius * 1.04),
          this.material("mechanism-flange", palette.iron, {
            metalness: 0.62,
            gloss: 0.38,
          }),
          new pc.Vec3(90, 0, 0),
        );
      }
      if (plan.componentType === "drum") {
        const rope = this.material("drum-rope-wrap", palette.rope, { gloss: 0.08 });
        for (let index = -4; index <= 4; index += 1) {
          this.primitive(
            "drum-rope-turn",
            "cylinder",
            detail,
            new pc.Vec3(0, 0, index * 0.045),
            new pc.Vec3(radius * 0.92, 0.025, radius * 0.92),
            rope,
            new pc.Vec3(90, 0, 0),
          );
        }
        this.primitive(
          "drum-crank",
          "box",
          detail,
          new pc.Vec3(radius * 0.72, 0, -0.3),
          new pc.Vec3(radius * 0.12, radius * 0.95, 0.1),
          this.material("drum-crank-iron", palette.iron, {
            metalness: 0.7,
            gloss: 0.4,
          }),
        );
      } else {
        const fork = this.material("sheave-fork", palette.iron, {
          metalness: 0.7,
          gloss: 0.36,
        });
        for (const z of [-0.31, 0.31]) {
          this.primitive(
            "sheave-fork-cheek",
            "box",
            detail,
            new pc.Vec3(0, radius * 0.38, z),
            new pc.Vec3(radius * 0.34, radius * 1.45, 0.08),
            fork,
          );
        }
      }
      return detail;
    } else if (
      plan.componentType === "axle" ||
      plan.componentType === "pin"
    ) {
      body.addChild(detail);
      const collar = this.material("axle-collar", palette.brass, {
        metalness: 0.56,
        gloss: 0.48,
      });
      const radius = size.y * 0.72;
      for (const x of [-size.x * 0.39, size.x * 0.39]) {
        this.primitive(
          "axle-collar",
          "cylinder",
          detail,
          new pc.Vec3(x, 0, 0),
          new pc.Vec3(radius, 0.08, radius),
          collar,
          new pc.Vec3(0, 0, 90),
        );
      }
      return detail;
    } else if (plan.componentType === "cheek") {
      body.addChild(detail);
      this.bodyVisuals.get(body)!.enabled = false;
      const timber = this.material("hub-oak", palette.timber, { gloss: 0.12 });
      const boss = this.material("bearing-block-boss", palette.iron, {
        metalness: 0.66,
        gloss: 0.4,
      });
      this.primitive(
        "hub-octagonal-body",
        "cylinder",
        detail,
        pc.Vec3.ZERO,
        new pc.Vec3(size.x * 0.5, size.z * 0.72, size.x * 0.5),
        timber,
        new pc.Vec3(90, 0, 0),
      );
      for (let index = 0; index < 8; index += 1) {
        const angle = (index / 8) * Math.PI * 2;
        const x = Math.cos(angle) * size.x * 0.4;
        const y = Math.sin(angle) * size.y * 0.4;
        this.primitive(
          "hub-socket-band",
          "cylinder",
          detail,
          new pc.Vec3(x, y, size.z * 0.38),
          new pc.Vec3(size.x * 0.12, 0.075, size.x * 0.12),
          boss,
          new pc.Vec3(90, 0, 0),
        );
        this.primitive(
          "hub-socket-mouth",
          "cylinder",
          detail,
          new pc.Vec3(x, y, size.z * 0.46),
          new pc.Vec3(size.x * 0.055, 0.035, size.x * 0.055),
          this.material("hub-socket-dark", palette.ink, {
            metalness: 0.32,
            gloss: 0.2,
          }),
          new pc.Vec3(90, 0, 0),
        );
      }
      this.primitive(
        "bearing-block-boss",
        "cylinder",
        detail,
        new pc.Vec3(0, size.y * 0.16, size.z * 0.56),
        new pc.Vec3(
          Math.max(0.22, size.x * 0.72),
          0.1,
          Math.max(0.22, size.x * 0.72),
        ),
        boss,
        new pc.Vec3(90, 0, 0),
      );
      this.primitive(
        "bearing-block-bushing",
        "cylinder",
        detail,
        new pc.Vec3(0, size.y * 0.16, size.z * 0.68),
        new pc.Vec3(
          Math.max(0.1, size.x * 0.28),
          0.05,
          Math.max(0.1, size.x * 0.28),
        ),
        this.material("bearing-bushing", palette.brass, {
          metalness: 0.48,
          gloss: 0.5,
        }),
        new pc.Vec3(90, 0, 0),
      );
      return detail;
    } else if (plan.componentType === "brace") {
      body.addChild(detail);
      this.bodyVisuals.get(body)!.enabled = false;
      const timber = this.material("wedge-oak", palette.timber, { gloss: 0.1 });
      const stepWidth = size.x / 4;
      for (let index = 0; index < 4; index += 1) {
        const height = size.y * ((index + 1) / 4);
        this.primitive(
          "wedge-step",
          "box",
          detail,
          new pc.Vec3(-size.x * 0.375 + index * stepWidth, -size.y * 0.5 + height * 0.5, 0),
          new pc.Vec3(stepWidth * 1.04, height, size.z),
          timber,
        );
      }
      this.primitive(
        "wedge-striking-face",
        "box",
        detail,
        new pc.Vec3(size.x * 0.48, 0, 0),
        new pc.Vec3(0.09, size.y * 1.08, size.z * 1.05),
        this.material("wedge-iron-face", palette.iron, {
          metalness: 0.7,
          gloss: 0.34,
        }),
      );
      return detail;
    } else if (plan.componentType === "lashing") {
      body.addChild(detail);
      this.bodyVisuals.get(body)!.enabled = false;
      const rope = this.material("coiled-hemp", palette.rope, { gloss: 0.06 });
      const iron = this.material("captive-hook-iron", palette.iron, {
        metalness: 0.72,
        gloss: 0.36,
      });
      const loopRadius = Math.max(0.24, size.y * 1.65);
      for (const z of [-0.1, 0, 0.1]) {
        for (let index = 0; index < 14; index += 1) {
          const angle = (index / 14) * Math.PI * 2;
          this.primitive(
            "rope-coil-segment",
            "cylinder",
            detail,
            new pc.Vec3(
              Math.cos(angle) * loopRadius,
              Math.sin(angle) * loopRadius,
              z,
            ),
            new pc.Vec3(size.y * 0.33, loopRadius * 0.31, size.y * 0.33),
            rope,
            new pc.Vec3(0, 0, -angle * DEG),
          );
        }
      }
      this.primitive(
        "rope-tail",
        "cylinder",
        detail,
        new pc.Vec3(size.x * 0.29, -loopRadius * 0.22, 0),
        new pc.Vec3(size.y * 0.33, size.x * 0.28, size.y * 0.33),
        rope,
        new pc.Vec3(0, 0, 90),
      );
      const hookX = -size.x * 0.42;
      this.primitive(
        "captive-hook-shank",
        "cylinder",
        detail,
        new pc.Vec3(hookX, 0.08, 0),
        new pc.Vec3(0.07, 0.24, 0.07),
        iron,
      );
      for (let index = 0; index < 6; index += 1) {
        const angle = -0.45 + index * 0.45;
        this.primitive(
          "captive-hook-curve",
          "cylinder",
          detail,
          new pc.Vec3(
            hookX + Math.cos(angle) * 0.18 - 0.18,
            -0.16 + Math.sin(angle) * 0.18,
            0,
          ),
          new pc.Vec3(0.065, 0.12, 0.065),
          iron,
          new pc.Vec3(0, 0, -angle * DEG),
        );
      }
      return detail;
    } else if (plan.componentType === "fulcrum") {
      body.addChild(detail);
      this.bodyVisuals.get(body)!.enabled = false;
      const timber = this.material("fulcrum-timber", palette.timber, {
        gloss: 0.12,
      });
      for (const direction of [-1, 1]) {
        this.primitive(
          "fulcrum-leg",
          "box",
          detail,
          new pc.Vec3(direction * size.x * 0.2, 0, 0),
          new pc.Vec3(size.x * 0.3, size.y * 0.94, size.z),
          timber,
          new pc.Vec3(0, 0, direction * -18),
        );
      }
      this.primitive(
        "fulcrum-cap",
        "cylinder",
        detail,
        new pc.Vec3(0, size.y * 0.42, 0),
        new pc.Vec3(size.x * 0.22, size.z * 1.35, size.x * 0.22),
        this.material("fulcrum-cap-iron", palette.iron, {
          metalness: 0.7,
          gloss: 0.42,
        }),
        new pc.Vec3(90, 0, 0),
      );
      return detail;
    } else if (plan.componentType === "platform") {
      body.addChild(detail);
      this.bodyVisuals.get(body)!.enabled = false;
      const plank = this.material("platform-plank", palette.timber, {
        gloss: 0.1,
      });
      for (let index = -2; index <= 2; index += 1) {
        this.primitive(
          "platform-slat",
          "box",
          detail,
          new pc.Vec3(0, 0, index * size.z * 0.2),
          new pc.Vec3(size.x * 0.94, size.y * 0.82, size.z * 0.16),
          plank,
        );
      }
      const eye = this.material("plank-load-eye", palette.iron, {
        metalness: 0.7,
        gloss: 0.36,
      });
      for (let index = 0; index < 8; index += 1) {
        const angle = (index / 8) * Math.PI * 2;
        this.primitive(
          "plank-eye-segment",
          "cylinder",
          detail,
          new pc.Vec3(
            size.x * 0.48 + Math.cos(angle) * 0.14,
            Math.sin(angle) * 0.14,
            size.z * 0.48,
          ),
          new pc.Vec3(0.045, 0.11, 0.045),
          eye,
          new pc.Vec3(0, 0, -angle * DEG),
        );
      }
      return detail;
    } else if (
      plan.componentType === "pawl" ||
      plan.componentType === "trigger"
    ) {
      body.addChild(detail);
      const pivot = this.material("control-pivot", palette.brass, {
        metalness: 0.58,
        gloss: 0.5,
      });
      this.primitive(
        "control-pivot",
        "cylinder",
        detail,
        new pc.Vec3(-size.x * 0.32, 0, size.z * 0.56),
        new pc.Vec3(size.y * 0.82, 0.08, size.y * 0.82),
        pivot,
        new pc.Vec3(90, 0, 0),
      );
      this.primitive(
        "control-stop",
        "box",
        detail,
        new pc.Vec3(size.x * 0.38, -size.y * 0.42, 0),
        new pc.Vec3(size.y * 0.76, size.y * 0.62, size.z * 1.15),
        this.material("control-stop-iron", palette.iron, {
          metalness: 0.7,
          gloss: 0.4,
        }),
      );
      return detail;
    } else if (plan.componentType === "counterweight") {
      body.addChild(detail);
      this.primitive(
        "counterweight-eye",
        "cylinder",
        detail,
        new pc.Vec3(0, size.x * 0.42, 0),
        new pc.Vec3(size.x * 0.18, 0.11, size.x * 0.18),
        this.material("counterweight-eye-iron", palette.iron, {
          metalness: 0.72,
          gloss: 0.36,
        }),
      );
      return detail;
    } else if (plan.componentType === "nut") {
      body.addChild(detail);
      this.primitive(
        "nut-thread-mouth",
        "cylinder",
        detail,
        new pc.Vec3(0, 0, size.z * 0.56),
        new pc.Vec3(size.x * 0.28, 0.07, size.x * 0.28),
        this.material("nut-thread-mouth", palette.ink, {
          metalness: 0.3,
          gloss: 0.28,
        }),
        new pc.Vec3(90, 0, 0),
      );
      return detail;
    } else if (plan.componentType === "hook") {
      body.addChild(detail);
      this.bodyVisuals.get(body)!.enabled = false;
      const iron = this.material("forged-hook", palette.iron, {
        metalness: 0.74,
        gloss: 0.38,
      });
      const radius = Math.max(0.18, Math.min(size.x, size.y) * 0.42);
      const thickness = Math.max(0.08, radius * 0.24);
      this.primitive(
        "hook-shank",
        "cylinder",
        detail,
        new pc.Vec3(0, size.y * 0.2, 0),
        new pc.Vec3(thickness, size.y * 0.62, thickness),
        iron,
      );
      for (let index = 0; index < 7; index += 1) {
        const angle = -0.28 + index * 0.43;
        this.primitive(
          "hook-curve",
          "cylinder",
          detail,
          new pc.Vec3(
            Math.cos(angle) * radius - radius,
            Math.sin(angle) * radius - size.y * 0.14,
            0,
          ),
          new pc.Vec3(thickness, radius * 0.48, thickness),
          iron,
          new pc.Vec3(0, 0, -angle * DEG),
        );
      }
      return detail;
    } else if (plan.componentType === "saddle") {
      body.addChild(detail);
      const iron = this.material("lifting-saddle", palette.iron, {
        metalness: 0.7,
        gloss: 0.34,
      });
      for (const x of [-size.x * 0.42, size.x * 0.42]) {
        this.primitive(
          "saddle-lip",
          "box",
          detail,
          new pc.Vec3(x, size.y * 0.24, 0),
          new pc.Vec3(size.x * 0.14, size.y * 0.72, size.z * 1.08),
          iron,
          new pc.Vec3(0, 0, x < 0 ? -12 : 12),
        );
      }
      return detail;
    }
    return undefined;
  }

  private decorateInstalledConnection(part: PartRuntime): void {
    if (part.connectionDetail || !part.plan.connection) return;
    const root = new pc.Entity(`${part.id}:fitted-connection`);
    part.body.addChild(root);
    part.connectionDetail = root;
    const size = this.partScale(part.plan);
    const metal = this.material("fitted-ironwork", palette.iron, {
      metalness: 0.74,
      gloss: 0.48,
    });
    const rope = this.material("fitted-lashing", palette.rope, {
      gloss: 0.08,
    });
    const connection = part.plan.connection;
    if (
      connection === "lash" ||
      connection === "stitch" ||
      connection === "scarf"
    ) {
      const horizontal = size.x >= size.y;
      const long = horizontal ? size.x : size.y;
      const radius = Math.max(0.13, Math.max(size.z, Math.min(size.x, size.y)) * 0.62);
      for (const offset of [-0.22, 0, 0.22]) {
        this.primitive(
          "binding-turn",
          "cylinder",
          root,
          horizontal
            ? new pc.Vec3(offset * long, 0, 0)
            : new pc.Vec3(0, offset * long, 0),
          new pc.Vec3(radius, 0.075, radius),
          connection === "scarf" ? metal : rope,
          horizontal ? new pc.Vec3(0, 0, 90) : pc.Vec3.ZERO,
        );
      }
      return;
    }
    if (
      connection === "bearing" ||
      connection === "pin" ||
      connection === "socket" ||
      connection === "thread"
    ) {
      const radius = Math.max(0.15, Math.min(size.x, size.y) * 0.62);
      for (const z of [-size.z * 0.58, size.z * 0.58]) {
        this.primitive(
          "bearing-collar",
          "cylinder",
          root,
          new pc.Vec3(0, 0, z),
          new pc.Vec3(radius, 0.085, radius),
          metal,
          new pc.Vec3(90, 0, 0),
        );
      }
      return;
    }
    const horizontal = size.x >= size.y;
    const span = (horizontal ? size.x : size.y) * 0.3;
    for (const offset of [-span, span]) {
      this.primitive(
        "fastener-head",
        "sphere",
        root,
        horizontal ? new pc.Vec3(offset, 0, size.z * 0.56) : new pc.Vec3(0, offset, size.z * 0.56),
        new pc.Vec3(0.17, 0.17, 0.11),
        metal,
      );
    }
  }

  private poseToWorld(
    pose: { x: number; y: number; z?: number },
    team: "king" | "queen",
    projectId: string,
  ): pc.Vec3 {
    const x = (pose.x - 600) / WORLD_TO_STAGE_X;
    const y = Math.max(0, (pose.y - 35) / 57);
    let hash = 0;
    for (const char of projectId) hash = (hash * 31 + char.charCodeAt(0)) | 0;
    const kingCompound = KING_COMPOUND_PROJECTS.has(projectId);
    const queenCompound = QUEEN_COMPOUND_PROJECTS.has(projectId);
    const lane = kingCompound
      ? 0.42
      : queenCompound
        ? -0.34
        : ((Math.abs(hash) % 5) - 2) * 0.62;
    return new pc.Vec3(
      x,
      y,
      lane + (pose.z ?? 0),
    );
  }

  private createWeaponStock(): void {
    for (const team of ["king", "queen"] as const) {
      const direction = team === "king" ? 1 : -1;
      const baseX = team === "king" ? -16.5 : 16.5;
      const rack = new pc.Entity(`${team}-weapon-stock`);
      rack.setPosition(baseX, 0.38, 4.05);
      this.app.root.addChild(rack);

      const pike = this.createPikeModel(`${team}-stock-pike`, rack);
      pike.setLocalPosition(direction * 0.34, 0.9, -0.18);
      pike.setLocalEulerAngles(0, 0, direction * -18);
      this.primitive(
        `${team}-stock-pennon`,
        "box",
        pike,
        new pc.Vec3(direction * 0.2, 1.08, 0),
        new pc.Vec3(0.4, 0.24, 0.025),
        this.material(
          `${team}-weapon-cloth`,
          team === "king" ? palette.king : palette.queen,
          { gloss: 0.08 },
        ),
      );

      const crossbow = this.createCrossbowModel(
        `${team}-stock-crossbow`,
        rack,
      );
      crossbow.setLocalPosition(direction * 0.15, 0.68, 0.48);
      crossbow.setLocalEulerAngles(0, team === "king" ? -16 : 196, 0);
      crossbow.setLocalScale(1.12, 1.12, 1.12);

      for (let index = 0; index < 2; index += 1) {
        const bolt = this.rigidPrimitive(
          `crossbow-bolt:${team}:${index}`,
          "box",
          new pc.Vec3(
            baseX + direction * (0.32 + index * 0.19),
            0.17 + index * 0.055,
            4.72 + index * 0.13,
          ),
          new pc.Vec3(1.0, 0.045, 0.045),
          this.material("bolt-shaft", new pc.Color(0.48, 0.29, 0.12), {
            gloss: 0.14,
          }),
          {
            bodyType: "static",
            mass: 0.18,
            friction: 0.5,
            restitution: 0.02,
            euler: new pc.Vec3(0, direction * (5 + index * 3), 0),
          },
        );
        this.primitive(
          `${team}-bolt-point-${index}`,
          "cone",
          bolt,
          new pc.Vec3(direction * 0.56, 0, 0),
          new pc.Vec3(0.11, 0.24, 0.11),
          this.material("bolt-point", palette.iron, {
            metalness: 0.78,
          }),
          new pc.Vec3(0, 0, direction * -90),
        );
        this.primitive(
          `${team}-bolt-vane-${index}`,
          "box",
          bolt,
          new pc.Vec3(direction * -0.46, 0.065, 0),
          new pc.Vec3(0.18, 0.12, 0.018),
          this.material("bolt-vane", palette.cream, {
            gloss: 0.08,
          }),
        );
        bolt.tags.add("crossbow-bolt", team);
        this.bolts.push({ body: bolt, team, used: false });
      }
    }
  }

  private createProjectileStock(): void {
    for (const team of ["king", "queen"] as const) {
      for (let index = 0; index < 9; index += 1) {
        const x =
          (team === "king" ? -16.35 : 16.35) +
          (index % 3) * 0.48 * (team === "king" ? 1 : -1);
        const z = 2.8 + Math.floor(index / 3) * 0.47;
        const radius = 0.28 + (index % 2) * 0.07;
        const stone = this.rigidPrimitive(
          `projectile-stock:${team}:${index}`,
          "sphere",
          new pc.Vec3(x, radius + Math.floor(index / 3) * radius * 0.7, z),
          new pc.Vec3(radius * 2, radius * 2, radius * 2),
          this.material(`projectile-${index % 3}`, new pc.Color(0.31 + (index % 3) * 0.035, 0.31, 0.285)),
          {
            bodyType: "static",
            mass: 4.5 + index * 0.4,
            friction: 0.74,
            restitution: 0.16,
          },
        );
        stone.tags.add("projectile", team);
        stone.rigidbody!.group = pc.BODYGROUP_USER_1;
        stone.rigidbody!.mask = pc.BODYMASK_ALL ^ pc.BODYGROUP_DYNAMIC;
        this.projectiles.push({ body: stone, team, used: false });
      }
    }
  }

  private syncMechanismLines(entities: TransformState[]): void {
    const active = new Set<string>();
    for (const rope of entities.filter(
      (entity) =>
        entity.kind === "rope" &&
        entity.fromX !== undefined &&
        entity.fromY !== undefined &&
        entity.toX !== undefined &&
        entity.toY !== undefined,
    )) {
      active.add(rope.id);
      const from = new pc.Vec3(
        ((rope.fromX ?? 600) - 600) / WORLD_TO_STAGE_X,
        Math.max(0.08, ((rope.fromY ?? 35) - 35) / 57),
        0.72,
      );
      const to = new pc.Vec3(
        ((rope.toX ?? 600) - 600) / WORLD_TO_STAGE_X,
        Math.max(0.08, ((rope.toY ?? 35) - 35) / 57),
        0.72,
      );
      const delta = to.clone().sub(from);
      const length = Math.max(0.08, Math.hypot(delta.x, delta.y));
      let line = this.mechanismLines.get(rope.id);
      if (!line) {
        line = new pc.Entity(`mechanism-line:${rope.id}`);
        line.addComponent("render", {
          type: "box",
          material: this.material("working-rope", palette.rope, {
            gloss: 0.12,
          }),
          castShadows: true,
        });
        this.app.root.addChild(line);
        this.mechanismLines.set(rope.id, line);
      }
      line.setPosition(from.clone().add(to).mulScalar(0.5));
      line.setLocalScale(length, 0.055, 0.055);
      line.setEulerAngles(0, 0, Math.atan2(delta.y, delta.x) * DEG);
    }
    for (const [id, line] of this.mechanismLines) {
      if (active.has(id)) continue;
      line.destroy();
      this.mechanismLines.delete(id);
    }
  }

  private createJoint(
    name: string,
    type: "fixed" | "ball" | "hinge" | "slider" | "6dof",
    entityA: pc.Entity,
    entityB: pc.Entity | null,
    position: pc.Vec3,
    breakImpulse = Infinity,
    motor?: { speed: number; force: number },
  ): pc.Entity {
    const joint = new pc.Entity(name);
    joint.setPosition(position);
    this.app.root.addChild(joint);
    const component = joint.addComponent("joint", {
      type,
      entityA,
      entityB,
      enableCollision: false,
      breakImpulse,
      ...(motor
        ? {
            motorSpeed: motor.speed,
            maxMotorForce: motor.force,
          }
        : {}),
    });
    this.joints.add(joint);
    (component as pc.JointComponent | null)?.on("break", () =>
      this.joints.delete(joint),
    );
    return joint;
  }

  private update(dt: number): void {
    if (this.paused) return;
    if (!this.puzzleMode) this.assignJobs();
    for (const worker of this.workers.values()) this.updateWorker(worker, dt);
    if (this.puzzleMode) {
      this.updatePuzzleVisuals(dt);
    } else {
      this.updateLooseInstallations(dt);
    }
    this.updateMechanicalMotion(dt);
    this.updateHumpty(dt);
    this.updateCamera(dt);
    this.publishDebug();
  }

  private assignJobs(): void {
    const stateOrder = (state: AssemblyState) =>
      state === "installed" ? 0 : state === "staged" ? 1 : state === "carried" ? 2 : 3;
    for (const team of ["king", "queen"] as const) {
      const projectOrder = team === "king"
        ? [
              "machine_skid",
              "machine_cart",
              "machine_screw_jack",
              "machine_ladder",
              "machine_mast",
              "machine_lever",
              "machine_brace",
              "machine_winch",
              "machine_pulley",
              "rescue_sling",
            ]
        : [
            "queen_machine_cart",
            "queen_machine_lever",
            "queen_machine_spring_trap",
            ...new Set(
              [...this.parts.values()]
                .filter(
                  (part) =>
                    part.blueprint.team === "queen" &&
                    part.blueprint.id === "barricade",
                )
                .map((part) => part.blueprint.machineId),
            ),
          ];
      const availableProjects = projectOrder.filter((projectId) =>
        [...this.parts.values()].some(
          (part) =>
            part.blueprint.machineId === projectId &&
            part.active,
        ),
      );
      for (const worker of this.workers.values()) {
        if (worker.team !== team || worker.job || worker.commissioning) continue;
        const priorities = [
          ...(worker.preferredProjectId &&
          availableProjects.includes(worker.preferredProjectId)
            ? [worker.preferredProjectId]
            : []),
          ...availableProjects.filter(
            (projectId) => projectId !== worker.preferredProjectId,
          ),
        ];
        let part: PartRuntime | undefined;
        let commissioning:
          | { blueprint: BlueprintPlan; stage: MechanismStage }
          | undefined;
        for (const projectId of priorities) {
          const blueprint = [...this.parts.values()].find(
            (candidate) =>
              candidate.blueprint.machineId === projectId &&
              candidate.active,
          )?.blueprint;
          if (!blueprint) continue;
          const stage = this.currentMechanismStage(blueprint);
          if (!stage) continue;
          const stageKey = this.mechanismStageKey(blueprint, stage);
          const stageParts = stage.requires
            .map((id) => this.parts.get(id))
            .filter((candidate): candidate is PartRuntime => !!candidate);
          part = stageParts
            .filter(
              (candidate) =>
                candidate.active &&
                candidate.localState !== "installed" &&
                !candidate.assignedTo,
            )
            .sort(
              (a, b) =>
                stateOrder(a.desiredState) - stateOrder(b.desiredState),
            )[0];
          if (part) break;
          if (
            stageParts.length > 0 &&
            stageParts.every((candidate) => candidate.localState === "installed") &&
            !this.commissioningStages.has(stageKey)
          ) {
            commissioning = { blueprint, stage };
            break;
          }
        }
        if (commissioning) {
          this.beginCommissioning(worker, commissioning);
          continue;
        }
        if (!part) {
          const contesting = ["fight", "aim", "guard"].includes(worker.activity);
          const patrolX = contesting
            ? team === "king"
              ? -1.3
              : 1.3
            : team === "king"
              ? -5.8
              : 5.8;
          worker.goal.set(
            patrolX + Math.sin(this.elapsed * 0.08 + worker.id.length) * 0.65,
            1.05,
            Number(worker.id.at(-1))! - 2,
          );
          continue;
        }
        part.assignedTo = worker.id;
        worker.job = part;
        worker.phase = "walk-stock";
        worker.phaseUntil = 0;
        worker.goal.copy(part.body.getPosition());
      }
    }
  }

  private mechanismStageKey(
    blueprint: BlueprintPlan,
    stage: MechanismStage,
  ): string {
    return `${blueprint.machineId}::${stage.id}`;
  }

  private currentMechanismStage(
    blueprint: BlueprintPlan,
  ): MechanismStage | undefined {
    return blueprint.mechanisms.find((stage) => {
      const key = this.mechanismStageKey(blueprint, stage);
      return (
        !this.commissionedStages.has(key) &&
        stage.dependsOn.every((dependency) =>
          this.commissionedStages.has(
            `${blueprint.machineId}::${dependency}`,
          ),
        )
      );
    });
  }

  private beginCommissioning(
    worker: WorkerRuntime,
    commissioning: { blueprint: BlueprintPlan; stage: MechanismStage },
  ): void {
    const { blueprint, stage } = commissioning;
    const key = this.mechanismStageKey(blueprint, stage);
    this.commissioningStages.add(key);
    worker.commissioning = commissioning;
    worker.phase = "commission";
    worker.phaseUntil = 0;
    worker.activity = "inspect";
    const positions = stage.requires
      .map((id) => this.parts.get(id)?.targetPosition)
      .filter((position): position is pc.Vec3 => !!position);
    const center = positions
      .reduce((sum, position) => sum.add(position), new pc.Vec3())
      .mulScalar(1 / Math.max(1, positions.length));
    worker.goal.copy(center);
    worker.goal.x += blueprint.team === "king" ? -0.9 : 0.9;
    worker.goal.y = 1.05;
    worker.goal.z += Number(worker.id.at(-1))! % 2 === 0 ? -0.65 : 0.65;
  }

  private advanceCommissioning(worker: WorkerRuntime): void {
    const commissioning = worker.commissioning;
    if (!commissioning) return;
    const { blueprint, stage } = commissioning;
    const key = this.mechanismStageKey(blueprint, stage);
    const distance = Math.hypot(
      worker.body.getPosition().x - worker.goal.x,
      worker.body.getPosition().z - worker.goal.z,
    );
    if (distance > 0.78) {
      worker.activity = "march";
      return;
    }
    if (worker.phaseUntil === 0) {
      worker.phaseUntil = this.elapsed + stage.testDuration;
      this.mechanismTestUntil.set(key, worker.phaseUntil);
    }
    worker.activity =
      stage.commissioning === "reeve_line"
        ? "lash"
        : stage.commissioning === "square_frame" ||
            stage.commissioning === "fit_load"
          ? "inspect"
          : "build";
    if (this.elapsed < worker.phaseUntil) return;

    this.commissionedStages.add(key);
    this.commissioningStages.delete(key);
    delete worker.commissioning;
    delete worker.phase;
    delete worker.operation;
    worker.phaseUntil = this.elapsed + 0.9;
    worker.activity = "inspect";
  }

  private updateWorker(worker: WorkerRuntime, dt: number): void {
    const body = worker.body;
    const position = body.getPosition();
    if (this.puzzleMode) {
      const blend = 1 - Math.exp(-dt * 16);
      body.setPosition(
        position.x + (worker.goal.x - position.x) * blend,
        1.05,
        position.z + (worker.goal.z - position.z) * blend,
      );
      worker.grounded = true;
      worker.lastPosition.copy(body.getPosition());
      worker.lastGoalDistance = body.getPosition().distance(worker.goal);
      worker.stalledFor = 0;
      this.animateWorker(worker);
      return;
    }
    worker.grounded = position.y < 1.24 && Math.abs(body.rigidbody?.linearVelocity.y ?? 0) < 1.2;
    if (worker.commissioning) {
      this.advanceCommissioning(worker);
    } else if (worker.job) {
      this.advanceJob(worker, worker.job);
    }
    this.driveWorker(worker, dt);
    this.animateWorker(worker);
  }

  private advanceJob(worker: WorkerRuntime, part: PartRuntime): void {
    const now = this.elapsed;
    const workerPosition = worker.body.getPosition();
    const partPosition = part.body.getPosition();
    const toPart = workerPosition.distance(partPosition);
    const horizontalToTarget = Math.hypot(
      workerPosition.x - part.targetPosition.x,
      workerPosition.z - part.targetPosition.z,
    );
    switch (worker.phase) {
      case "walk-stock":
        this.setStockApproach(worker, part);
        if (
          workerPosition.distance(worker.goal) < 0.72 ||
          toPart < 0.95 + this.partScale(part.plan).x / 2
        ) {
          worker.phase = "grip";
          worker.phaseUntil = now + 1.2;
          worker.activity = "lift";
        }
        break;
      case "grip":
        this.setStockApproach(worker, part);
        if (now >= worker.phaseUntil) {
          this.attachCarry(worker, part);
          worker.phase = "carry";
          worker.activity = "carry";
          part.localState = "carried";
        }
        break;
      case "carry": {
        this.pullCarriedPart(worker, part);
        worker.goal.copy(part.targetPosition);
        worker.goal.x += worker.team === "king" ? -0.7 : 0.7;
        worker.goal.z += 0.45;
        if (
          horizontalToTarget < 1.1 ||
          Math.hypot(
            workerPosition.x - worker.goal.x,
            workerPosition.z - worker.goal.z,
          ) < 0.78
        ) {
          this.detachCarry(worker);
          part.localState = "staged";
          const operation = part.plan.operations[part.operationIndex] ?? "position";
          worker.phase = this.phaseForOperation(operation);
          worker.phaseUntil = now + this.operationDuration(operation);
          worker.activity = this.activityForOperation(operation);
        }
        break;
      }
      case "measure":
      case "cut":
      case "bore":
      case "forge":
      case "thread":
      case "tension":
        worker.goal.copy(partPosition);
        if (now >= worker.phaseUntil) {
          part.operationIndex += 1;
          const next = part.plan.operations[part.operationIndex];
          if (
            next &&
            ![
              "position",
              "peg",
              "lash",
              "wedge",
              "mount",
              "raise",
              "inspect",
            ].includes(next)
          ) {
            worker.phase = this.phaseForOperation(next);
            worker.phaseUntil = now + this.operationDuration(next);
            worker.activity = this.activityForOperation(next);
          } else {
            worker.phase = "align";
            worker.phaseUntil = now + 1.4;
            worker.activity = "lift";
          }
        }
        break;
      case "align":
        worker.goal.copy(part.targetPosition);
        worker.goal.x += worker.team === "king" ? -0.75 : 0.75;
        this.springPart(part, 1 / 60);
        if (
          part.body.getPosition().distance(part.targetPosition) < INSTALL_DISTANCE ||
          now >= worker.phaseUntil + 7
        ) {
          worker.phase = "fasten";
          worker.phaseUntil = now + this.operationDuration(
            part.plan.connection === "lash" ? "lash" : "peg",
          );
          worker.activity = part.plan.connection === "lash" ? "lash" : "hammer";
        }
        break;
      case "fasten":
        this.springPart(part, 1 / 60);
        worker.goal.copy(part.targetPosition);
        if (now >= worker.phaseUntil) {
          this.placePartAtTarget(part);
          this.installPart(part);
          delete worker.job;
          delete worker.phase;
          delete worker.operation;
          worker.activity = "inspect";
          worker.phaseUntil = now + 1;
        }
        break;
    }
  }

  private setStockApproach(
    worker: WorkerRuntime,
    part: PartRuntime,
  ): void {
    worker.goal.copy(part.body.getPosition());
    const reach = this.partScale(part.plan).x / 2 + 0.48;
    worker.goal.x += worker.team === "king" ? reach : -reach;
    worker.goal.y = 1.05;
  }

  private phaseForOperation(operation: WorkOperation): JobPhase {
    if (operation === "measure") return "measure";
    if (
      operation === "saw" ||
      operation === "shape" ||
      operation === "stitch"
    ) {
      return "cut";
    }
    if (operation === "bore") return "bore";
    if (operation === "forge" || operation === "temper") return "forge";
    if (operation === "thread") return "thread";
    if (operation === "tension") return "tension";
    return "align";
  }

  private operationDuration(operation: WorkOperation): number {
    const durations: Partial<Record<WorkOperation, number>> = {
      measure: 2.2,
      saw: 3.6,
      stitch: 7.2,
      shape: 4.2,
      bore: 3,
      forge: 5,
      temper: 4.6,
      thread: 5.4,
      tension: 5.2,
      peg: 2.6,
      lash: 3.4,
      wedge: 2.5,
      mount: 3.5,
    };
    return durations[operation] ?? 2.4;
  }

  private activityForOperation(operation: WorkOperation): AgentActivity {
    if (operation === "measure") return "measure";
    if (operation === "saw" || operation === "shape" || operation === "stitch") return "saw";
    if (operation === "bore" || operation === "thread") return "bore";
    if (operation === "forge" || operation === "temper") return "forge";
    if (operation === "tension") return "tension";
    if (operation === "lash") return "lash";
    return "build";
  }

  private attachCarry(worker: WorkerRuntime, part: PartRuntime): void {
    if (worker.carryJoint) return;
    const scale = this.partScale(part.plan);
    part.body.rigidbody!.type = pc.BODYTYPE_DYNAMIC;
    part.body.rigidbody!.linearFactor = pc.Vec3.ONE;
    part.body.rigidbody!.mass = this.partMass(
      part.plan,
      scale,
    );
    part.body.rigidbody!.group = pc.BODYGROUP_USER_1;
    part.body.rigidbody!.mask =
      pc.BODYMASK_ALL ^
      pc.BODYGROUP_USER_1 ^
      pc.BODYGROUP_USER_2 ^
      pc.BODYGROUP_USER_3;
    const shoulderLongAxis = scale.y > scale.x * 1.4 ? 90 : 0;
    part.body.setEulerAngles(0, 0, shoulderLongAxis);
    part.body.rigidbody!.angularVelocity = pc.Vec3.ZERO;
    part.body.rigidbody!.angularFactor = pc.Vec3.ZERO;
    this.dynamicBodies.add(part.body);
    part.body.rigidbody!.activate();
  }

  private pullCarriedPart(
    worker: WorkerRuntime,
    part: PartRuntime,
  ): void {
    const rigidbody = part.body.rigidbody;
    if (!rigidbody) return;
    const shoulder = worker.body.getPosition().clone();
    shoulder.x += worker.team === "king" ? 0.42 : -0.42;
    shoulder.y += 0.72;
    const delta = shoulder.sub(part.body.getPosition());
    const velocity = rigidbody.linearVelocity;
    rigidbody.activate();
    rigidbody.applyForce(
      (delta.x * 46 - velocity.x * 9) * rigidbody.mass,
      (delta.y * 46 - velocity.y * 9 + 9.81) * rigidbody.mass,
      (delta.z * 46 - velocity.z * 9) * rigidbody.mass,
    );
    const speed = velocity.length();
    if (speed > 5.4) {
      rigidbody.linearVelocity = velocity.clone().mulScalar(5.4 / speed);
    }
  }

  private detachCarry(worker: WorkerRuntime): void {
    if (worker.carryJoint) {
      this.joints.delete(worker.carryJoint);
      worker.carryJoint.destroy();
      delete worker.carryJoint;
    }
    if (worker.job?.body.rigidbody) {
      worker.job.body.rigidbody.angularFactor = pc.Vec3.ONE;
      worker.job.body.rigidbody.group = pc.BODYGROUP_USER_1;
      worker.job.body.rigidbody.mask =
        pc.BODYMASK_ALL ^
        pc.BODYGROUP_USER_1 ^
        pc.BODYGROUP_USER_2 ^
        pc.BODYGROUP_USER_3;
    }
  }

  private driveWorker(worker: WorkerRuntime, dt: number): void {
    const position = worker.body.getPosition();
    const delta = this.temp.sub2(worker.goal, position);
    const goalSide = Math.sign(worker.goal.x);
    const crossingTower =
      goalSide !== 0 &&
      Math.sign(position.x) !== goalSide &&
      Math.abs(position.x) < 3.4 &&
      Math.abs(worker.goal.x) < 3.4;
    if (crossingTower) {
      const bypassZ =
        (Number(worker.id.at(-1))! % 2 === 0 ? -1 : 1) * 2.5;
      if (Math.abs(position.z - bypassZ) > 0.28) {
        delta.set(0, worker.goal.y - position.y, bypassZ - position.z);
      } else {
        delta.set(worker.goal.x - position.x, worker.goal.y - position.y, 0);
      }
    }
    const verticalGoal = false;
    const verticalDelta = delta.y;
    delta.y = 0;
    const distance = delta.length();
    const velocity = worker.body.rigidbody!.linearVelocity;
    const desiredSpeed = Math.min(MAX_WORKER_SPEED, distance * 1.8);
    const speed = Math.hypot(velocity.x, velocity.z);
    const moved = position.distance(worker.lastPosition);
    worker.lastPosition.copy(position);
    const goalChanged =
      !Number.isFinite(worker.lastGoalDistance) ||
      Math.abs(distance - worker.lastGoalDistance) > 1.5;
    const makingProgress =
      goalChanged || worker.lastGoalDistance - distance > dt * 0.05;
    worker.lastGoalDistance = distance;
    worker.stalledFor =
      distance > 0.08 &&
      (speed < 0.22 ||
        moved < Math.max(0.003, dt * 0.08) ||
        !makingProgress) &&
      worker.grounded
        ? worker.stalledFor + dt
        : Math.max(0, worker.stalledFor - dt * 2);
    if (distance > 0.08) {
      worker.body.rigidbody!.activate();
      delta.mulScalar(1 / Math.max(distance, 0.001));
      const desiredX = delta.x * desiredSpeed;
      const desiredZ = delta.z * desiredSpeed;
      const sidestep =
        worker.stalledFor > 0.7
          ? (Number(worker.id.at(-1))! % 2 === 0 ? -1 : 1) * 0.72
          : 0;
      worker.body.rigidbody!.applyForce(
        (desiredX - velocity.x - delta.z * sidestep) * WORKER_FORCE,
        verticalGoal && distance < 1.8
          ? worker.body.rigidbody!.mass * 9.81 +
              verticalDelta * 620 -
              velocity.y * 210
          : 0,
        (desiredZ - velocity.z + delta.x * sidestep) * WORKER_FORCE,
      );
      if (Math.abs(delta.x) > 0.05) worker.facing = delta.x > 0 ? 1 : -1;
    } else {
      worker.body.rigidbody!.applyForce(-velocity.x * WORKER_FORCE, 0, -velocity.z * WORKER_FORCE);
    }
    if (speed > MAX_WORKER_SPEED * 1.15) {
      worker.body.rigidbody!.linearVelocity = new pc.Vec3(
        (velocity.x / speed) * MAX_WORKER_SPEED,
        velocity.y,
        (velocity.z / speed) * MAX_WORKER_SPEED,
      );
    }
    worker.rig.setLocalEulerAngles(0, worker.facing > 0 ? 90 : -90, 0);
    if (verticalGoal && distance < 1.8) {
      worker.activity = "climb";
    }
    if (!worker.grounded && velocity.y < -4.5) {
      worker.activity = "climb";
    }
  }

  private animateWorker(worker: WorkerRuntime): void {
    const time = this.elapsed;
    const speed = Math.hypot(
      worker.body.rigidbody?.linearVelocity.x ?? 0,
      worker.body.rigidbody?.linearVelocity.z ?? 0,
    );
    const working =
      !!worker.phase &&
      [
        "measure",
        "cut",
        "bore",
        "forge",
        "thread",
        "tension",
        "align",
        "fasten",
        "commission",
      ].includes(worker.phase);
    const puzzleHandling =
      this.puzzleMode &&
      (worker.operation === "carry" || worker.operation === "snap");
    const gait = Math.sin(time * 8 + worker.id.length) * Math.min(1, speed / 1.5);
    worker.rig.setLocalPosition(0, Math.abs(gait) * 0.035, 0);
    const weaponActivity =
      worker.activity === "fight" ||
      worker.activity === "aim" ||
      worker.activity === "guard" ||
      worker.activity === "march";
    const weaponCanBeHeld =
      !puzzleHandling &&
      (weaponActivity ||
        (!working && worker.phase !== "carry" && worker.phase !== "grip"));
    worker.pike.enabled =
      weaponCanBeHeld && worker.activeWeapon === "pike";
    worker.crossbow.enabled =
      weaponCanBeHeld && worker.activeWeapon === "crossbow";
    if (worker.pike.enabled) {
      const thrust =
        worker.activity === "fight"
          ? Math.max(0, Math.sin(time * 7.5 + worker.id.length)) * 0.42
          : 0;
      worker.pike.setLocalPosition(0.37, 0.04, 0.18 + thrust);
      worker.pike.setLocalEulerAngles(90, 0, -4 + gait * 2);
      worker.leftArm.setLocalEulerAngles(54, 0, -54);
      worker.rightArm.setLocalEulerAngles(70, 0, 48);
      worker.tool.enabled = false;
    } else if (worker.crossbow.enabled) {
      const recoil =
        worker.activity === "aim"
          ? Math.max(0, Math.sin(time * 10 + worker.id.length)) * 0.08
          : 0;
      worker.crossbow.setLocalPosition(0, 0.18, 0.48 - recoil);
      worker.crossbow.setLocalEulerAngles(-2, 0, 0);
      worker.leftArm.setLocalEulerAngles(72, 0, -68);
      worker.rightArm.setLocalEulerAngles(72, 0, 68);
      worker.tool.enabled = false;
    } else if (puzzleHandling) {
      const stroke =
        worker.operation === "snap"
          ? Math.sin(time * 5.4 + worker.id.length) * 18
          : 0;
      worker.leftArm.setLocalEulerAngles(44, 0, -54 - stroke);
      worker.rightArm.setLocalEulerAngles(44, 0, 54 + stroke);
      worker.tool.enabled = false;
    } else if (working) {
      const commissioning = worker.commissioning?.stage.commissioning;
      const stroke = Math.sin(
        time *
          (worker.phase === "cut"
            ? 9
            : worker.phase === "forge"
              ? 7.5
              : worker.phase === "tension"
                ? 4.5
                : worker.phase === "commission" &&
                    commissioning === "spin_free"
                  ? 3.6
                : 6),
      );
      worker.rightArm.setLocalEulerAngles(0, 0, 20 + stroke * 42);
      worker.leftArm.setLocalEulerAngles(0, 0, -20 - stroke * 22);
      worker.tool.enabled = true;
      worker.tool.setLocalScale(
        worker.phase === "cut"
          ? 0.1
          : worker.phase === "forge"
            ? 0.22
            : worker.phase === "commission"
              ? 0.18
              : 0.14,
        worker.phase === "cut"
          ? 1.05
          : worker.phase === "tension"
            ? 0.9
            : worker.phase === "commission"
              ? 0.82
              : 0.62,
        worker.phase === "bore" || worker.phase === "thread" ? 0.32 : 0.1,
      );
    } else if (worker.phase === "carry" || worker.phase === "grip") {
      worker.leftArm.setLocalEulerAngles(0, 0, -72);
      worker.rightArm.setLocalEulerAngles(0, 0, 72);
      worker.tool.enabled = false;
    } else {
      worker.leftArm.setLocalEulerAngles(0, 0, -14 + gait * 25);
      worker.rightArm.setLocalEulerAngles(0, 0, 14 - gait * 25);
      worker.tool.enabled = false;
    }
  }

  private springPart(part: PartRuntime, dt: number): void {
    if (part.localState === "installed" && !part.finalizing) return;
    const position = part.body.getPosition();
    const velocity = part.body.rigidbody!.linearVelocity;
    const delta = this.tempB.sub2(part.targetPosition, position);
    part.body.rigidbody!.applyForce(
      delta.x * PART_SPRING - velocity.x * PART_DAMPING,
      delta.y * PART_SPRING - velocity.y * PART_DAMPING + part.body.rigidbody!.mass * 9.81,
      delta.z * PART_SPRING - velocity.z * PART_DAMPING,
    );
    const current = part.body.getRotation();
    this.tempQ.mul2(part.targetRotation, current.clone().invert());
    const euler = this.tempQ.getEulerAngles();
    part.body.rigidbody!.applyTorque(euler.x * 0.12, euler.y * 0.12, euler.z * 0.12);
    part.body.rigidbody!.activate();
    void dt;
  }

  private placePartAtTarget(part: PartRuntime): void {
    const targetEuler = part.targetRotation.getEulerAngles();
    part.body.rigidbody!.teleport(
      part.targetPosition.x,
      part.targetPosition.y,
      part.targetPosition.z,
      targetEuler.x,
      targetEuler.y,
      targetEuler.z,
    );
    part.body.setRotation(part.targetRotation);
  }

  private attachFunctionalJoint(part: PartRuntime): void {
    if (
      part.installedJoint ||
      !["axle", "wheel", "gear", "drum", "sheave"].includes(
        part.plan.componentType,
      )
    ) {
      return;
    }
    part.body.rigidbody!.type = pc.BODYTYPE_DYNAMIC;
    part.body.rigidbody!.linearFactor = pc.Vec3.ZERO;
    part.body.rigidbody!.angularFactor = new pc.Vec3(0, 0, 1);
    part.body.rigidbody!.linearDamping = 0.9;
    part.body.rigidbody!.angularDamping = 0.42;
    part.body.rigidbody!.activate();
    this.dynamicBodies.add(part.body);
    part.installedJoint = this.createJoint(
      `bearing:${part.id}`,
      "hinge",
      part.body,
      null,
      part.targetPosition,
      Math.max(38, this.partMass(part.plan, this.partScale(part.plan)) * 12),
    );
  }

  private updateLooseInstallations(dt: number): void {
    for (const part of this.parts.values()) {
      if (part.finalizing) {
        this.springPart(part, dt);
        if (part.body.getPosition().distance(part.targetPosition) < 0.22) {
          part.body.rigidbody!.linearVelocity = pc.Vec3.ZERO;
          part.body.rigidbody!.angularVelocity = pc.Vec3.ZERO;
          this.placePartAtTarget(part);
          part.body.rigidbody!.type = pc.BODYTYPE_KINEMATIC;
          part.body.rigidbody!.angularFactor = pc.Vec3.ZERO;
          part.body.rigidbody!.linearFactor = pc.Vec3.ZERO;
          this.dynamicBodies.delete(part.body);
          part.finalizing = false;
          this.attachFunctionalJoint(part);
        }
        continue;
      }
      if (
        part.assignedTo &&
        part.localState === "staged" &&
        !part.installedJoint
      ) {
        this.springPart(part, dt);
      }
    }
  }

  private syncAssemblyFinalization(
    entities: Map<string, TransformState>,
  ): void {
    const plans = new Map<string, BlueprintPlan>();
    for (const part of this.parts.values()) {
      if (part.blueprint.finalization !== "inspect") {
        plans.set(part.blueprint.machineId, part.blueprint);
      }
    }
    for (const [machineId, blueprint] of plans) {
      const machine = entities.get(machineId);
      if ((machine?.buildProgress ?? 0) < 0.9) continue;
      const assembly = [...this.parts.values()].filter(
        (part) => part.blueprint.machineId === machineId,
      );
      if (
        assembly.length === 0 ||
        assembly.some((part) => part.localState !== "installed")
      ) {
        continue;
      }
      for (const part of assembly) {
        if (
          part.finalizing ||
          part.body.getPosition().distance(part.finalPosition) < 0.28
        ) {
          continue;
        }
        if (part.installedJoint) {
          this.joints.delete(part.installedJoint);
          part.installedJoint.destroy();
          delete part.installedJoint;
        }
        part.targetPosition.copy(part.finalPosition);
        part.targetRotation.copy(part.finalRotation);
        part.body.rigidbody!.type = pc.BODYTYPE_DYNAMIC;
        part.body.rigidbody!.angularFactor = pc.Vec3.ONE;
        part.body.rigidbody!.linearFactor = pc.Vec3.ONE;
        part.body.rigidbody!.activate();
        this.dynamicBodies.add(part.body);
        part.finalizing = true;
      }
      void blueprint;
    }
  }

  private installPart(part: PartRuntime): void {
    part.body.rigidbody!.type = pc.BODYTYPE_KINEMATIC;
    this.placePartAtTarget(part);
    part.body.rigidbody!.linearVelocity = pc.Vec3.ZERO;
    part.body.rigidbody!.angularVelocity = pc.Vec3.ZERO;
    part.body.rigidbody!.angularFactor = pc.Vec3.ZERO;
    part.body.rigidbody!.linearFactor = pc.Vec3.ZERO;
    part.body.rigidbody!.group = pc.BODYGROUP_USER_1;
    part.body.rigidbody!.mask =
      pc.BODYMASK_ALL ^
      pc.BODYGROUP_USER_1 ^
      pc.BODYGROUP_USER_2 ^
      pc.BODYGROUP_USER_3;
    this.dynamicBodies.delete(part.body);
    this.decorateInstalledConnection(part);
    this.attachFunctionalJoint(part);
    if (
      part.blueprint.id === "spring_trap" &&
      part.id.endsWith("_arm")
    ) {
      const armVisual = this.bodyVisuals.get(part.body);
      if (armVisual) this.springTrapArm = armVisual;
    }
    if (part.blueprint.id === "lever" && part.id.endsWith("_arm")) {
      const armVisual = this.bodyVisuals.get(part.body);
      if (armVisual) {
        if (part.blueprint.team === "queen") {
          this.queenLeverArm = armVisual;
        } else {
          this.kingLeverArm = armVisual;
        }
      }
    }
    if (
      part.blueprint.id === "screw_jack" &&
      part.id.endsWith("_handle_b")
    ) {
      const handleVisual = this.bodyVisuals.get(part.body);
      if (handleVisual) this.kingScrewHandle = handleVisual;
    }
    if (part.blueprint.id === "winch" && part.detail) {
      if (part.id.endsWith("_treadwheel")) this.kingTreadwheel = part.detail;
      if (part.id.endsWith("_drum")) this.kingWinchDrum = part.detail;
      if (part.id.endsWith("_ratchet")) this.kingWinchRatchet = part.detail;
    }
    if (part.blueprint.id === "spring_trap" && part.detail) {
      if (part.id.endsWith("_windlass_drum")) {
        this.queenWindlassDrum = part.detail;
      }
      if (part.id.endsWith("_ratchet")) {
        this.queenWindlassRatchet = part.detail;
      }
    }
    part.localState = "installed";
    delete part.assignedTo;
    this.installedCount += 1;
  }

  private reactToCue(cue: SoundCue): void {
    if (cue.type === "throw") {
      const team = cue.team === "king" ? "king" : "queen";
      if (cue.weapon === "crossbow") {
        this.fireCrossbowBolt(
          team,
          cue.targetId,
          (cue.x - 600) / WORLD_TO_STAGE_X,
        );
      } else {
        if (team === "queen" && this.springTrapArm) {
          this.springTrapKickUntil = this.elapsed + 1.05;
          this.queenLeverKickUntil = this.elapsed + 1.05;
        }
        this.throwProjectile(team, cue.intensity);
      }
    }
    if (cue.type === "winch" && cue.team === "king") {
      this.kingLeverWorkUntil = this.elapsed + 1.1;
    }
    if (cue.type === "shove" || cue.type === "impact") {
      const king = this.nearestWorker("king", 0);
      const queen = this.nearestWorker("queen", 0);
      if (king && queen && king.body.getPosition().distance(queen.body.getPosition()) < 3.2) {
        const direction = king.body.getPosition().x < queen.body.getPosition().x ? 1 : -1;
        king.body.rigidbody!.applyImpulse(-direction * cue.intensity * 1.5, 0.35, 0);
        queen.body.rigidbody!.applyImpulse(direction * cue.intensity * 1.5, 0.35, 0);
      }
    }
  }

  private updateMechanicalMotion(dt: number): void {
    const kingTurning = this.kingLeverWorkUntil > this.elapsed;
    const queenCocking =
      this.springTrapKickUntil > this.elapsed ||
      this.latest?.entities.some(
        (entity) =>
          entity.team === "queen" &&
          (entity.taskOperation === "tension" ||
            entity.taskOperation === "reeve"),
      ) === true;
    if (kingTurning) this.kingDriveAngle += dt * 132;
    if (queenCocking) this.queenDriveAngle -= dt * 108;
    this.kingTreadwheel?.setLocalEulerAngles(-90, 0, this.kingDriveAngle);
    this.kingWinchDrum?.setLocalEulerAngles(-90, 0, this.kingDriveAngle * 2.4);
    this.kingWinchRatchet?.setLocalEulerAngles(-90, 0, this.kingDriveAngle * 2.4);
    this.queenWindlassDrum?.setLocalEulerAngles(-90, 0, this.queenDriveAngle);
    this.queenWindlassRatchet?.setLocalEulerAngles(-90, 0, this.queenDriveAngle);

    if (this.springTrapArm) {
      const remaining = this.springTrapKickUntil - this.elapsed;
      const progress = 1 - Math.max(0, remaining) / 1.05;
      const release =
        remaining <= 0
          ? 0
          : progress < 0.22
            ? -38 * (progress / 0.22)
            : -38 * (1 - (progress - 0.22) / 0.78);
      this.springTrapArm.setLocalEulerAngles(0, 0, release);
    }
    if (this.queenLeverArm) {
      const remaining = this.queenLeverKickUntil - this.elapsed;
      const stroke =
        remaining <= 0
          ? 0
          : Math.sin((1 - remaining / 1.05) * Math.PI) * -24;
      this.queenLeverArm.setLocalEulerAngles(0, 0, stroke);
    }
    if (this.kingLeverArm) {
      const working = this.kingLeverWorkUntil > this.elapsed;
      this.kingLeverArm.setLocalEulerAngles(
        0,
        0,
        working ? Math.sin(this.elapsed * 8) * 7 : 0,
      );
    }
    if (this.kingScrewHandle) {
      this.kingScrewHandle.setLocalEulerAngles(
        0,
        0,
        this.kingLeverWorkUntil > this.elapsed
          ? (this.elapsed * 150) % 360
          : 0,
      );
    }
    for (const [key, until] of this.mechanismTestUntil) {
      if (until <= this.elapsed) {
        this.mechanismTestUntil.delete(key);
        continue;
      }
      const separator = key.indexOf("::");
      const machineId = key.slice(0, separator);
      const stageId = key.slice(separator + 2);
      const blueprint = [...this.parts.values()].find(
        (part) => part.blueprint.machineId === machineId,
      )?.blueprint;
      const stage = blueprint?.mechanisms.find(
        (candidate) => candidate.id === stageId,
      );
      if (!stage) continue;
      const testAngle = (this.elapsed * 105) % 360;
      for (const partId of stage.requires) {
        const part = this.parts.get(partId);
        if (!part?.detail || part.localState !== "installed") continue;
        if (
          ["wheel", "gear", "drum", "sheave"].includes(
            part.plan.componentType,
          )
        ) {
          part.detail.setLocalEulerAngles(-90, 0, testAngle);
        } else if (part.plan.componentType === "screw") {
          part.detail.setLocalEulerAngles(0, testAngle, 0);
        } else if (part.plan.componentType === "spring") {
          const pulse = 1 + Math.sin(this.elapsed * 5) * 0.08;
          part.detail.setLocalScale(pulse, 1, pulse);
        }
      }
      if (machineId === "queen_machine_spring_trap" && this.springTrapArm) {
        this.springTrapArm.setLocalEulerAngles(
          0,
          0,
          -12 + Math.sin(this.elapsed * 3.2) * 12,
        );
      }
      if (machineId === "machine_lever" && this.kingLeverArm) {
        this.kingLeverArm.setLocalEulerAngles(
          0,
          0,
          Math.sin(this.elapsed * 3.2) * 9,
        );
      }
      if (machineId === "queen_machine_lever" && this.queenLeverArm) {
        this.queenLeverArm.setLocalEulerAngles(
          0,
          0,
          Math.sin(this.elapsed * 3.2) * 9,
        );
      }
    }
    if (this.queenPortrait) {
      const pacing = this.elapsed * 0.16;
      const direction = Math.cos(pacing) >= 0 ? -1 : 1;
      this.queenPortrait.setLocalPosition(
        Math.sin(pacing) * 1.9,
        1.36 + Math.abs(Math.sin(this.elapsed * 2.2)) * 0.035,
        0.34,
      );
      this.queenPortrait.setLocalEulerAngles(0, direction * 11, 0);
    }
    if (this.queenPortraitHead) {
      this.queenPortraitHead.setLocalEulerAngles(
        7 + Math.sin(this.elapsed * 0.31) * 1.5,
        Math.sin(this.elapsed * 0.48) * 8,
        Math.sin(this.elapsed * 0.37) * 1.4,
      );
    }
    if (this.queenPortraitMouth) {
      const speaking =
        this.latest?.speech.some(
          (line) =>
            line.agentId === "queen" &&
            this.elapsed - line.elapsed >= 0 &&
            this.elapsed - line.elapsed < 5.8,
      ) === true;
      this.queenPortraitMouth.setLocalScale(
        0.35,
        speaking ? 0.14 + Math.abs(Math.sin(this.elapsed * 8)) * 0.12 : 0.09,
        0.06,
      );
    }
  }

  private throwProjectile(team: "king" | "queen", intensity: number): void {
    const projectile =
      this.projectiles.find((item) => item.team === team && !item.used) ??
      this.projectiles.find((item) => item.team === team);
    if (!projectile) return;
    projectile.used = true;
    projectile.body.rigidbody!.type = pc.BODYTYPE_DYNAMIC;
    projectile.body.rigidbody!.group = pc.BODYGROUP_DYNAMIC;
    projectile.body.rigidbody!.mask = pc.BODYMASK_ALL;
    this.dynamicBodies.add(projectile.body);
    const thrower = this.nearestWorker(team, 0);
    const launcher =
      team === "queen"
        ? [...this.parts.values()].find(
            (part) =>
              part.blueprint.id === "spring_trap" &&
              part.id.endsWith("_cup") &&
              part.localState === "installed",
          )
        : undefined;
    const source =
      launcher?.body.getPosition().clone() ??
      thrower?.body.getPosition().clone() ??
      new pc.Vec3(team === "king" ? -6 : 6, 1.2, 0);
    if (launcher) source.y += 0.45;
    projectile.body.rigidbody!.teleport(source.x, source.y + 1.15, source.z);
    projectile.body.rigidbody!.linearVelocity = pc.Vec3.ZERO;
    const target =
      team === "queen"
        ? this.humpty.getPosition()
        : this.nearestWorker("queen", source.x)?.body.getPosition() ?? new pc.Vec3(6, 1.2, 0);
    const delta = target.clone().sub(source);
    const distance = Math.max(1, Math.hypot(delta.x, delta.z));
    const speed = pc.math.clamp(8.5 + intensity * 3.2, 9, 17);
    delta.y = distance * 0.28 + 1.4;
    delta.normalize().mulScalar(speed);
    projectile.body.rigidbody!.applyImpulse(
      delta.x * projectile.body.rigidbody!.mass,
      delta.y * projectile.body.rigidbody!.mass,
      delta.z * projectile.body.rigidbody!.mass,
    );
  }

  private fireCrossbowBolt(
    team: "king" | "queen",
    targetId: string | undefined,
    sourceX: number,
  ): void {
    const bolt = this.bolts.find((item) => item.team === team && !item.used);
    if (!bolt) return;
    bolt.used = true;
    bolt.body.rigidbody!.type = pc.BODYTYPE_DYNAMIC;
    bolt.body.rigidbody!.group = pc.BODYGROUP_DYNAMIC;
    bolt.body.rigidbody!.mask = pc.BODYMASK_ALL;
    this.dynamicBodies.add(bolt.body);
    const thrower =
      [...this.workers.values()]
        .filter(
          (worker) =>
            worker.team === team && worker.activeWeapon === "crossbow",
        )
        .sort(
          (a, b) =>
            Math.abs(a.body.getPosition().x - sourceX) -
            Math.abs(b.body.getPosition().x - sourceX),
        )[0] ?? this.nearestWorker(team, sourceX);
    const source =
      thrower?.body.getPosition().clone() ??
      new pc.Vec3(team === "king" ? -7 : 7, 1.2, 0);
    const targetWorker = targetId ? this.workers.get(targetId) : undefined;
    const target =
      targetId === "humpty"
        ? this.humpty.getPosition().clone()
        : targetWorker?.body.getPosition().clone() ??
          this.nearestWorker(team === "king" ? "queen" : "king", source.x)
            ?.body.getPosition()
            .clone() ??
          new pc.Vec3(team === "king" ? 8 : -8, 1.2, 0);
    source.y += 1.08;
    source.z += 0.22;
    bolt.body.rigidbody!.teleport(source.x, source.y, source.z);
    bolt.body.rigidbody!.linearVelocity = pc.Vec3.ZERO;
    const delta = target.sub(source);
    const horizontal = Math.max(0.01, Math.hypot(delta.x, delta.z));
    delta.y += horizontal * 0.065;
    bolt.body.setEulerAngles(
      0,
      -Math.atan2(delta.z, delta.x) * DEG,
      Math.atan2(delta.y, horizontal) * DEG,
    );
    delta.normalize().mulScalar(19.5);
    bolt.body.rigidbody!.applyImpulse(
      delta.x * bolt.body.rigidbody!.mass,
      delta.y * bolt.body.rigidbody!.mass,
      delta.z * bolt.body.rigidbody!.mass,
    );
  }

  private nearestWorker(team: "king" | "queen", x: number): WorkerRuntime | undefined {
    return [...this.workers.values()]
      .filter((worker) => worker.team === team)
      .sort(
        (a, b) =>
          Math.abs(a.body.getPosition().x - x) -
          Math.abs(b.body.getPosition().x - x),
      )[0];
  }

  private releaseHumpty(rescue: boolean): void {
    this.humptyFalling = true;
    this.humpty.rigidbody!.activate();
    if (rescue || this.visualIntegrity <= 0) {
      this.humpty.tags.add("rescue");
      this.humpty.rigidbody!.type = pc.BODYTYPE_KINEMATIC;
    }
  }

  private updateHumpty(dt: number): void {
    const t = this.elapsed;
    const anxious = this.visualIntegrity < 70 || this.humptyFalling;
    this.humptyFace.setLocalPosition(
      Math.sin(t * 0.7) * 0.025,
      0.08 + Math.sin(t * 1.1) * 0.018,
      0.86,
    );
    this.humptyMouth.setLocalScale(
      anxious ? 0.34 : 0.52,
      anxious ? 0.24 + Math.abs(Math.sin(t * 4)) * 0.1 : 0.08,
      0.06,
    );
    for (let index = 0; index < this.humptyBrows.length; index += 1) {
      this.humptyBrows[index]!.setLocalEulerAngles(
        0,
        0,
        anxious ? (index === 0 ? 18 : -18) : index === 0 ? -8 : 8,
      );
    }
    if (this.humptyAuthoritative && this.visualIntegrity > 0) {
      const position = this.humpty.getPosition();
      const blend = 1 - Math.exp(-dt * (this.humptyRighting ? 18 : 10));
      const next = new pc.Vec3().lerp(
        position,
        this.humptyTargetPosition,
        blend,
      );
      const currentAngle = this.humpty.getEulerAngles().z;
      const targetAngle = this.humptyTargetAngle * DEG;
      const angleDelta =
        ((targetAngle - currentAngle + 540) % 360) - 180;
      this.humpty.setPosition(next);
      this.humpty.setEulerAngles(
        0,
        0,
        currentAngle + angleDelta * blend,
      );
    }
    for (const visual of this.towerVisuals.values()) {
      if (!visual.body.enabled) continue;
      const position = visual.body.getPosition();
      const blend = 1 - Math.exp(-dt * 18);
      visual.body.setPosition(
        new pc.Vec3().lerp(position, visual.targetPosition, blend),
      );
      const euler = visual.body.getEulerAngles();
      const rollDelta = ((visual.targetAngle - euler.z + 540) % 360) - 180;
      const yawDelta = ((visual.targetYaw - euler.y + 540) % 360) - 180;
      visual.body.setEulerAngles(
        0,
        euler.y + yawDelta * blend,
        euler.z + rollDelta * blend,
      );
    }
    if (this.humptyFalling && this.humpty.getPosition().y < -1) {
      this.callbacks.onHumptyFall?.();
    }
    void dt;
  }

  private splat(): void {
    if (this.humpty.tags.has("splatted")) return;
    this.humpty.tags.add("splatted");
    this.visualIntegrity = 0;
    this.bodyVisuals.get(this.humpty)!.enabled = false;
    this.humptyRig.enabled = false;
    const origin = this.humpty.getPosition();
    for (let index = 0; index < 34; index += 1) {
      const shell = this.rigidPrimitive(
        `shell-fragment-${index}`,
        index % 3 === 0 ? "sphere" : "box",
        new pc.Vec3(origin.x, Math.max(0.3, origin.y), origin.z),
        new pc.Vec3(0.12 + Math.random() * 0.24, 0.08 + Math.random() * 0.18, 0.08 + Math.random() * 0.2),
        index % 4 === 0 ? this.material("yolk", palette.ochre, { gloss: 0.64 }) : this.material("egg-shell", palette.egg),
        { mass: 0.2, friction: 0.6, restitution: 0.32 },
      );
      shell.rigidbody!.applyImpulse(
        (Math.random() - 0.5) * 5.5,
        1.2 + Math.random() * 5,
        (Math.random() - 0.5) * 4.2,
      );
      shell.rigidbody!.applyTorqueImpulse(
        (Math.random() - 0.5) * 1.2,
        (Math.random() - 0.5) * 1.2,
        (Math.random() - 0.5) * 1.2,
      );
      this.shellFragments.push(shell);
    }
  }

  private restoreHumpty(): void {
    for (const fragment of this.shellFragments.splice(0)) {
      this.dynamicBodies.delete(fragment);
      fragment.destroy();
    }
    this.humpty.tags.remove("splatted");
    this.bodyVisuals.get(this.humpty)!.enabled = true;
    this.humptyRig.enabled = true;
    this.humptyCrackReleased = false;
    this.humptyAuthoritative = true;
    this.humptyRighting = false;
    this.humpty.rigidbody!.type = pc.BODYTYPE_KINEMATIC;
    this.humpty.rigidbody!.linearVelocity = pc.Vec3.ZERO;
    this.humpty.rigidbody!.angularVelocity = pc.Vec3.ZERO;
  }

  private updateCamera(dt: number): void {
    if (this.follow && this.latest) {
      const focus = this.chooseFocus();
      if (focus) {
        const focusPosition = focus.getPosition();
        const aspect =
          this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
        const target = new pc.Vec3(
          aspect < 0.72
            ? 0
            : pc.math.clamp(focusPosition.x * 0.42, -4.4, 4.4),
          5.15,
          aspect < 0.72
            ? 0
            : pc.math.clamp(focusPosition.z * 0.18, -0.7, 0.7),
        );
        const framingDistance =
          aspect < 0.72
            ? 68
            : aspect < 1
              ? 42
              : 30;
        const blend = 1 - Math.exp(-dt * 1.6);
        this.cameraTarget.lerp(this.cameraTarget, target, blend);
        this.orbitDistance +=
          (framingDistance - this.orbitDistance) * blend * 0.7;
      }
    }
    const yaw = this.orbitYaw / DEG;
    const pitch = this.orbitPitch / DEG;
    const horizontal = Math.cos(pitch) * this.orbitDistance;
    const position = new pc.Vec3(
      this.cameraTarget.x + Math.sin(yaw) * horizontal,
      this.cameraTarget.y - Math.sin(pitch) * this.orbitDistance,
      this.cameraTarget.z + Math.cos(yaw) * horizontal,
    );
    this.camera.setPosition(position);
    this.camera.lookAt(this.cameraTarget);
  }

  private chooseFocus(): pc.Entity | undefined {
    const puzzleFits = (this.latest?.snapPreviews ?? []).filter(
      (preview) => preview.phase === "carry" || preview.phase === "snap",
    );
    if (puzzleFits.length > 0) {
      const index = Math.floor(this.elapsed / 7) % puzzleFits.length;
      const fit = puzzleFits[index];
      if (fit) {
        return (
          this.puzzleVisuals.get(fit.movingId)?.body ??
          this.workers.get(fit.workerId)?.body
        );
      }
    }
    const busy = [...this.workers.values()].filter((worker) => worker.job);
    if (this.humptyFalling) return this.humpty;
    if (busy.length === 0) return this.humpty;
    const index = Math.floor(this.elapsed / 8) % busy.length;
    return busy[index]?.body;
  }

  private bindInput(): void {
    this.canvas.addEventListener("pointerdown", (event) => {
      this.dragging = true;
      this.dragX = event.clientX;
      this.dragY = event.clientY;
      this.canvas.setPointerCapture(event.pointerId);
      this.follow = false;
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (!this.dragging) return;
      this.orbitYaw -= (event.clientX - this.dragX) * 0.24;
      this.orbitPitch = pc.math.clamp(
        this.orbitPitch - (event.clientY - this.dragY) * 0.18,
        -40,
        18,
      );
      this.dragX = event.clientX;
      this.dragY = event.clientY;
    });
    const release = () => {
      this.dragging = false;
    };
    this.canvas.addEventListener("pointerup", release);
    this.canvas.addEventListener("pointercancel", release);
    this.canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        this.follow = false;
        this.orbitDistance = pc.math.clamp(
          this.orbitDistance + event.deltaY * 0.015,
          11,
          42,
        );
      },
      { passive: false },
    );
  }

  private publishDebug(): void {
    const debug = {
      engine: `PlayCanvas ${pc.version}`,
      physics: "authoritative server snapshots; kinematic presentation",
      dynamicBodies: this.dynamicBodies.size,
      joints: this.joints.size,
      installedParts: this.installedCount,
      carriedParts: [...this.parts.values()].filter(
        (part) => part.localState === "carried",
      ).length,
      groundedAgents: [...this.workers.values()].filter(
        (worker) => worker.grounded,
      ).length,
      commissionedSubsystems: this.commissionedStages.size,
      activeCommissioningTests: this.mechanismTestUntil.size,
    };
    window.__HUMPTY_WORLD__ = debug;
    this.canvas.dataset.physics = JSON.stringify(debug);
    this.canvas.dataset.workers = JSON.stringify(
      [...this.workers.values()].map((worker) => ({
        id: worker.id,
        phase: worker.phase ?? "idle",
        job: worker.job?.id ?? null,
        x: Number(worker.body.getPosition().x.toFixed(2)),
        y: Number(worker.body.getPosition().y.toFixed(2)),
        z: Number(worker.body.getPosition().z.toFixed(2)),
        goalX: Number(worker.goal.x.toFixed(2)),
        goalY: Number(worker.goal.y.toFixed(2)),
        goalZ: Number(worker.goal.z.toFixed(2)),
        distance: Number(worker.body.getPosition().distance(worker.goal).toFixed(2)),
        bodyType: worker.body.rigidbody?.type ?? "missing",
        nativeBody: Boolean(worker.body.rigidbody?.body),
        active: worker.body.rigidbody?.isActive() ?? false,
        stalledFor: Number(worker.stalledFor.toFixed(2)),
        lastGoalDistance: Number(worker.lastGoalDistance.toFixed(2)),
        speed: Number(
          Math.hypot(
            worker.body.rigidbody?.linearVelocity.x ?? 0,
            worker.body.rigidbody?.linearVelocity.z ?? 0,
          ).toFixed(2),
        ),
      })),
    );
    this.canvas.dataset.parts = JSON.stringify(
      [...this.parts.values()]
        .filter((part) => part.assignedTo || part.localState !== "stock")
        .slice(0, 18)
        .map((part) => ({
          id: part.id,
          state: part.localState,
          worker: part.assignedTo ?? null,
          distance: Number(
            part.body.getPosition().distance(part.targetPosition).toFixed(2),
          ),
          x: Number(part.body.getPosition().x.toFixed(2)),
          y: Number(part.body.getPosition().y.toFixed(2)),
          z: Number(part.body.getPosition().z.toFixed(2)),
          targetX: Number(part.targetPosition.x.toFixed(2)),
          targetY: Number(part.targetPosition.y.toFixed(2)),
          targetZ: Number(part.targetPosition.z.toFixed(2)),
          speed: Number(
            (part.body.rigidbody?.linearVelocity.length() ?? 0).toFixed(2),
          ),
          bodyType: part.body.rigidbody?.type ?? "missing",
          visualScale: this.bodyVisuals
            .get(part.body)
            ?.getLocalScale()
            .toString(),
          rotation: part.body.getEulerAngles().toString(),
        })),
    );
  }
}
