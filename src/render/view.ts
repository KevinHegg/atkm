import * as pc from "playcanvas";
import { AMMO } from "../sim/ballistics.js";
import { CANNON_PIVOT, MORTAR_PIVOT, QUEEN_GUN, type AimPreview, type CrewView, type Game } from "../sim/game.js";
import type { AmmoKind, BodyView, GameEvent, StockKind, Vec3 } from "../sim/types.js";
import { yAxisTo } from "../sim/geometry.js";
import { Kit, palette } from "./kit.js";
import {
  buildBlock,
  buildBucket,
  buildChest,
  buildRunaways,
  buildPeel,
  buildRevolve,
  buildSwarm,
  buildCannon,
  buildCartBed,
  buildCrown,
  buildHay,
  buildHorse,
  buildHumpty,
  buildKeg,
  buildLitterBed,
  buildLoad,
  buildMan,
  buildMortar,
  buildProjectile,
  buildQueen,
  buildShellPiece,
  buildFixture,
  buildRat,
  buildSandbag,
  buildTrapRing,
  buildCarousel,
  buildChute,
  buildTurntable,
  type RatRig,
  type GunRig,
  type HorseRig,
  type HumptyRig,
  type ManRig,
  type QueenRig,
  LEVER_THROW,
} from "./props.js";
import { buildStage, type StageSet } from "./stage.js";
import { Company } from "./company.js";
import { Curios } from "./curios.js";

const V = (x = 0, y = 0, z = 0): pc.Vec3 => new pc.Vec3(x, y, z);
const DEG = 180 / Math.PI;
/** Bodies that last the whole verse: worth batching. Shots and debris come and go too often. */
const BATCHED = new Set<string>(["block", "hay", "keg", "fixture", "man", "horse", "litter", "turntable", "bucket", "sandbag", "peel"]);
const SWEAT = new pc.Color(0.55, 0.78, 0.95);
/** How long a released star rises on stage before flying off to its chip in the HUD. */
const STAR_RISE = 1.9;
const UNBATCHED = new Set(["daze", "sandwich", "mopper", "cat"]);
/** The Queen stands on a podium stage-left of her battery. */
const QUEEN_SPOT = { x: -4.4, y: 0.42, z: 7.4 };
const smoothstep = (k: number): number => k * k * (3 - 2 * k);
/** The Queen's stroll, in seconds: hop down, walk, look about, walk back, hop up. */
const STROLL = { down: 0.45, look: 3.6, back: 8.2, up: 11.3, end: 11.75 };

interface BodyVisual {
  view: BodyView;
  root: pc.Entity;
  man?: ManRig;
  horse?: HorseRig;
  wheels?: pc.Entity[];
  rat?: RatRig;
  key?: pc.Entity;
  /** A paint pot worn as a hat, for a man who has had one dropped on him. */
  hat?: pc.Entity;
  /** A treasure chest's lid and the hoard inside. */
  lid?: pc.Entity;
  hoard?: pc.Entity;
  /** The wind machine's slatted drum. */
  drum?: pc.Entity;
  /** The stage lever's handle. */
  lever?: pc.Entity;
  /** The portcullis counterweight: it sinks as the gate rises. */
  counterweight?: pc.Entity;
  /** How far the chest lid has opened, 0 to 1. */
  opened?: number;
  /** The King's china on a dresser, piece by piece. */
  china?: pc.Entity[];
  /** A beehive's straw skep, which swings when struck. */
  skep?: pc.Entity;
  /** The capstan's spoked head, which turns while the revolve does. */
  capstan?: pc.Entity;
}

/** A released star, floating up off the stage. */
interface RisingStar {
  root: pc.Entity;
  from: pc.Vec3;
  age: number;
  /** Sparks owed to the trail: it sheds them at a steady rate, whatever the frame rate. */
  trail: number;
}

interface Puff {
  entity: pc.Entity;
  velocity: pc.Vec3;
  age: number;
  life: number;
  size: number;
  grow: number;
  gravity: number;
  spin: number;
  /** Keep this shape rather than shrinking to a cube (confetti). */
  shape?: pc.Vec3;
  /** An expanding ring (the gong's shimmer): grows to `size` instead of blooming. */
  ring?: boolean;
  /** The pool this particle goes back to when it fades (not destroyed: blasts make hundreds). */
  pool?: string;
}

interface Splat {
  root: pc.Entity;
  age: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
  visible: boolean;
}

export type CameraMode = "title" | "intro" | "play" | "replay" | "finale";

export class StageView {
  readonly app: pc.Application;
  readonly canvas: HTMLCanvasElement;
  readonly kit: Kit;
  private readonly host: HTMLElement;
  private readonly camera: pc.Entity;
  private readonly world: pc.Entity;
  private readonly actors: pc.Entity;
  private readonly effects: pc.Entity;
  private readonly stage: StageSet;
  private readonly curios: Curios;
  private readonly company: Company;
  private readonly ropePool: pc.Entity[] = [];
  private readonly blunderbuss: pc.Entity;
  private blunderRecoil = 0;
  private readonly queen: QueenRig;
  private readonly cannon: GunRig;
  private readonly mortar: GunRig;
  /** What is loaded in each gun's mouth, by ammunition. */
  private readonly loads = new Map<AmmoKind, pc.Entity>();
  /** A gold ring on the rug under whichever gun the selected shot fires from. */
  private readonly gunMarker: pc.Entity;
  private lastSelected: AmmoKind | undefined;
  private swap = 0;
  private readonly visuals = new Map<number, BodyVisual>();
  /** Masonry, hay, powder and the King's men share materials: drawn in a few dynamic batches. */
  private readonly actorBatch: number;
  private readonly chains = new Map<number, pc.Entity>();
  private readonly puffs: Puff[] = [];
  private readonly splats: Splat[] = [];
  /** The bees, when they're out, and when their hive was last struck. */
  private readonly swarm: pc.Entity;
  private hiveStruckAt = -99;
  private capstanTurn = 0;
  /** A piece of the King's china has been smashed since the dresser was last redrawn. */
  private chinaDirty = false;
  /** The dish that ran away with the spoon, while they're still on stage. */
  private runaways: { root: pc.Entity; legs: pc.Entity[]; from: pc.Vec3; toward: number; age: number } | undefined;
  private readonly arcDots: pc.Entity[] = [];
  private readonly passRings: pc.Entity[] = [];
  private readonly reticle: pc.Entity;
  private readonly reticleHot: pc.Entity;
  /** Chain shot's sweep: a bar across the reticle as wide as the chain. */
  private readonly chainSpan: pc.Entity;
  private readonly hintMarker: pc.Entity;
  private readonly hintLock: pc.Entity;
  private hintAt: Vec3 | undefined;
  private readonly rope: pc.Entity;
  private readonly hook: pc.Entity;
  private readonly resizeObserver: ResizeObserver;
  private humpty: HumptyRig | undefined;
  private humptyVisualId: number | undefined;
  private game: Game | undefined;
  private elapsed = 0;
  private aim: AimPreview | undefined;
  private cannonAim = { yaw: 0, pitch: 8 };
  private mortarAim = { yaw: 0, pitch: 60 };
  private recoil = { cannon: 0, mortar: 0 };
  private queenCheer = 0;
  private queenPoint = 0;
  private queenSulk = 0;
  private shake = 0;
  private cameraMode: CameraMode = "title";
  private introTime = 0;
  private readonly camTarget = V(0, 2.2, -1);
  private camYaw = 0;
  private camPitch = -14;
  private camDistance = 20;
  private userYaw = 0;
  private userPitch = 0;
  private userZoom = 0;
  private follow = 0;
  private humptyLookAt: Vec3 | undefined;
  private crackAt: pc.Vec3 | undefined;

  constructor(host: HTMLElement) {
    this.host = host;
    this.canvas = document.createElement("canvas");
    this.canvas.setAttribute("aria-label", "The Great Fall: a toy theatre siege");
    host.replaceChildren(this.canvas);
    this.app = new pc.Application(this.canvas, {
      mouse: new pc.Mouse(this.canvas),
      touch: new pc.TouchDevice(this.canvas),
      graphicsDeviceOptions: { antialias: true, alpha: false, powerPreference: "high-performance" },
    });
    this.app.setCanvasFillMode(pc.FILLMODE_NONE);
    this.app.setCanvasResolution(pc.RESOLUTION_AUTO);
    const handheld = matchMedia("(pointer: coarse)").matches;
    this.ceiling = Math.max(1, Math.min(window.devicePixelRatio, handheld ? 1.5 : 2));
    this.app.graphicsDevice.maxPixelRatio = this.ceiling;
    this.app.scene.ambientLight = new pc.Color(0.25, 0.245, 0.23);
    this.app.scene.exposure = 1.15;
    this.kit = new Kit(this.app);
    this.world = new pc.Entity("world");
    this.app.root.addChild(this.world);
    this.actors = this.kit.group("actors", this.world);
    this.effects = this.kit.group("effects", this.world);
    this.swarm = buildSwarm(this.kit, this.effects);
    this.swarm.enabled = false;
    this.camera = this.createCamera();
    this.createLights();
    this.stage = buildStage(this.kit, this.world);
    this.curios = new Curios(this.kit, this.world, this.stage.moon);
    this.company = new Company(this.kit, this.world, this.stage.root, (at) => {
      this.puff(at, V(0.1, 0.5, 0.05), 0.22, 1.6, 0, palette.smoke);
    });
    this.batchScenery();
    this.actorBatch = this.app.batcher.addGroup("actors", true, 200).id;
    this.batch(this.company.actors);
    this.cannon = buildCannon(this.kit, this.world);
    this.cannon.root.setLocalPosition(CANNON_PIVOT.x, 0.12, CANNON_PIVOT.z);
    this.cannon.pitch.setLocalPosition(0, CANNON_PIVOT.y - 0.12, 0);
    this.mortar = buildMortar(this.kit, this.world);
    this.mortar.root.setLocalPosition(MORTAR_PIVOT.x, 0.12, MORTAR_PIVOT.z);
    this.mortar.pitch.setLocalPosition(0, MORTAR_PIVOT.y - 0.12, 0);
    for (const kind of ["shot", "grape", "chain"] as const) {
      const load = buildLoad(this.kit, this.cannon.recoil, kind);
      load.setLocalPosition(0, 0, -1.56);
      load.enabled = false;
      this.loads.set(kind, load);
    }
    for (const kind of ["shell", "bomb"] as const) {
      const load = buildLoad(this.kit, this.mortar.recoil, kind);
      load.setLocalPosition(0, 0, -0.62);
      load.enabled = false;
      this.loads.set(kind, load);
    }
    const markerGold = this.kit.material("gun-marker", palette.gold, 0.4, 0, { emissive: new pc.Color(0.45, 0.3, 0.03) });
    this.gunMarker = this.kit.group("gun-marker", this.world);
    this.kit.meshEntity("gun-marker-ring", this.kit.torus(1.05, 0.05, 36, 5), markerGold, this.gunMarker, false);
    this.gunMarker.enabled = false;
    this.queen = buildQueen(this.kit, this.world);
    this.queen.root.setLocalPosition(QUEEN_SPOT.x, QUEEN_SPOT.y, QUEEN_SPOT.z);
    this.queen.root.setLocalEulerAngles(0, 150, 0);
    this.batch(this.queen.root);
    this.batch(this.curios.root);
    // Her blunderbuss leans on the podium until vermin appear.
    this.blunderbuss = this.kit.group("blunderbuss", this.world, V(QUEEN_GUN.x, QUEEN_GUN.y, QUEEN_GUN.z));
    this.kit.primitive("stock", "box", this.blunderbuss, V(0, 0, 0.35), { x: 0.12, y: 0.14, z: 0.55 }, this.kit.material("oak-dark", palette.oakDark, 0.16));
    this.kit.primitive("barrel", "cylinder", this.blunderbuss, V(0, 0.04, -0.2), { x: 0.1, y: 0.7, z: 0.1 }, this.kit.material("bronze-barrel", palette.bronze, 0.66, 0.58), V(90, 0, 0));
    this.kit.primitive("bell-mouth", "cone", this.blunderbuss, V(0, 0.04, -0.6), { x: 0.24, y: 0.2, z: 0.24 }, this.kit.material("bronze-barrel", palette.bronze, 0.66, 0.58), V(-90, 0, 0));
    this.blunderbuss.enabled = false;

    const dot = this.kit.material("aim-dot", palette.gold, 0.4, 0, { emissive: new pc.Color(0.55, 0.36, 0.04) });
    for (let index = 0; index < 90; index += 1) {
      const entity = this.kit.primitive("aim-dot", "sphere", this.effects, V(), { x: 0.09, y: 0.09, z: 0.09 }, dot, pc.Vec3.ZERO, false);
      entity.enabled = false;
      this.arcDots.push(entity);
    }
    this.reticle = this.kit.group("reticle", this.effects);
    this.kit.meshEntity("reticle-ring", this.kit.torus(0.42, 0.04, 28, 6), dot, this.reticle, false);
    this.kit.primitive("reticle-dot", "sphere", this.reticle, V(), { x: 0.12, y: 0.12, z: 0.12 }, dot, pc.Vec3.ZERO, false);
    this.reticle.enabled = false;
    this.chainSpan = this.kit.group("chain-span", this.effects);
    this.kit.primitive("chain-span-bar", "box", this.chainSpan, V(), { x: 1.25, y: 0.03, z: 0.03 }, dot, pc.Vec3.ZERO, false);
    for (const side of [-1, 1]) this.kit.primitive("chain-span-ball", "sphere", this.chainSpan, V(side * 0.62, 0, 0), { x: 0.16, y: 0.16, z: 0.16 }, dot, pc.Vec3.ZERO, false);
    this.chainSpan.enabled = false;
    const hot = this.kit.material("aim-hot", new pc.Color(0.9, 0.1, 0.05), 0.4, 0, { emissive: new pc.Color(0.7, 0.05, 0.02) });
    this.reticleHot = this.kit.group("reticle-hot", this.effects);
    this.kit.meshEntity("reticle-ring-hot", this.kit.torus(0.62, 0.05, 28, 6), hot, this.reticleHot, false);
    this.reticleHot.enabled = false;
    // Where the shot flies through a curio, or a chain will cut a rope: rings turned to the house.
    const passRing = this.kit.torus(0.3, 0.035, 24, 6);
    for (let index = 0; index < 5; index += 1) {
      const ring = this.kit.group("reticle-pass", this.effects);
      this.kit.meshEntity("reticle-ring-pass", passRing, dot, ring, false);
      ring.enabled = false;
      this.passRings.push(ring);
    }

    const tip = this.kit.material("astrologer", new pc.Color(0.3, 0.85, 0.65), 0.4, 0, { emissive: new pc.Color(0.08, 0.45, 0.3) });
    this.hintMarker = this.kit.group("astrologer-hint", this.effects);
    this.kit.meshEntity("hint-ring", this.kit.torus(0.5, 0.05, 28, 6), tip, this.hintMarker, false);
    for (let index = 0; index < 4; index += 1) {
      this.kit.primitive("hint-tick", "box", this.hintMarker, V(Math.cos((index * Math.PI) / 2) * 0.75, 0, Math.sin((index * Math.PI) / 2) * 0.75), { x: 0.3, y: 0.05, z: 0.08 }, tip, V(0, -index * 90, 0), false);
    }
    this.hintLock = this.kit.primitive("hint-lock", "cylinder", this.hintMarker, V(), { x: 0.8, y: 0.02, z: 0.8 }, tip, pc.Vec3.ZERO, false);
    this.hintLock.enabled = false;
    this.hintMarker.enabled = false;

    const rope = this.kit.material("rope", palette.rope, 0.12);
    // The Queen's standard, kept in the wings until the Grand Finale.
    this.queenFlag = this.kit.group("queen-standard", this.world);
    this.kit.primitive("standard-pole", "cylinder", this.queenFlag, V(0, 1.6, 0), { x: 0.09, y: 3.2, z: 0.09 }, this.kit.material("pole", palette.oakLight, 0.2));
    this.kit.primitive("standard-finial", "sphere", this.queenFlag, V(0, 3.28, 0), { x: 0.22, y: 0.22, z: 0.22 }, this.kit.material("gold", palette.gold, 0.72, 0.55));
    this.queenFlagCloth = this.kit.group("standard-cloth", this.queenFlag, V(0.05, 2.75, 0));
    const green = this.kit.material("queen-green-flag", new pc.Color(0.035, 0.49, 0.29), 0.22, 0, { doubleSided: true });
    this.kit.primitive("standard-banner", "box", this.queenFlagCloth, V(0.72, 0, 0), { x: 1.4, y: 0.9, z: 0.03 }, green);
    this.kit.primitive("standard-crest", "cylinder", this.queenFlagCloth, V(0.72, 0, 0.02), { x: 0.44, y: 0.02, z: 0.44 }, this.kit.material("gold", palette.gold, 0.72, 0.55), V(90, 0, 0), false);
    this.kit.primitive("standard-egg", "sphere", this.queenFlagCloth, V(0.72, 0, 0.04), { x: 0.16, y: 0.22, z: 0.04 }, this.kit.material("egg-shell", palette.egg, 0.55), pc.Vec3.ZERO, false);
    this.queenFlag.enabled = false;

    this.starLight = new pc.Entity("star-light");
    this.starLight.addComponent("light", { type: "omni", color: new pc.Color(1, 0.8, 0.35), intensity: 3, range: 9, castShadows: false });
    this.starLight.enabled = false;
    this.effects.addChild(this.starLight);

    this.rope = this.kit.primitive("fly-rope", "cylinder", this.effects, V(), { x: 0.05, y: 1, z: 0.05 }, rope, pc.Vec3.ZERO, false);
    this.hook = this.kit.group("fly-hook", this.effects);
    this.kit.meshEntity("hook", this.kit.torus(0.16, 0.035, 16, 6), this.kit.material("iron", palette.iron, 0.55, 0.68), this.kit.group("hook-ring", this.hook, V(), V(90, 0, 0)));
    this.rope.enabled = false;
    this.hook.enabled = false;

    this.app.start();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
  }

  onUpdate(callback: (dt: number) => void): void {
    this.app.on("update", (dt: number) => callback(Math.min(dt, 0.1)));
  }

  // ------------------------------------------------------------------ binding

  bind(game: Game): void {
    this.game = game;
    for (const visual of this.visuals.values()) visual.root.destroy();
    this.visuals.clear();
    for (const chain of this.chains.values()) chain.destroy();
    this.chains.clear();
    for (const splat of this.splats) splat.root.destroy();
    this.splats.length = 0;
    for (const puff of this.puffs) this.retire(puff);
    this.puffs.length = 0;
    this.runaways?.root.destroy();
    this.runaways = undefined;
    this.chinaDirty = false;
    this.swarm.enabled = false;
    this.hiveStruckAt = -99;
    this.humpty = undefined;
    this.humptyVisualId = undefined;
    this.crackAt = undefined;
    this.hintAt = undefined;
    this.aim = undefined;
    this.queenCheer = 0;
    this.queenSulk = 0;
    this.follow = 0;
    this.userYaw = 0;
    this.userPitch = 0;
    this.userZoom = 0;
    // Only the guns this verse has powder for are wheeled out.
    const stocked = (Object.keys(game.level.ammo) as StockKind[]).filter((kind) => (game.level.ammo[kind] ?? 0) > 0);
    const mortar = stocked.some((kind) => AMMO[kind].gun === "mortar");
    this.mortar.root.enabled = mortar;
    this.cannon.root.enabled = !mortar || stocked.some((kind) => AMMO[kind].gun === "cannon");
    this.lastSelected = game.selected;
    this.swap = 0;
    this.company.reset();
    this.finale = undefined;
    this.queenFlag.enabled = false;
    this.queen.root.setPosition(QUEEN_SPOT.x, QUEEN_SPOT.y, QUEEN_SPOT.z);
    this.queen.body.setLocalPosition(0, 0, 0);
    this.strollAt = -1;
    this.strollWait = 12;
    this.trapRing?.root.destroy();
    this.trapRing = undefined;
    const trap = game.trapView;
    if (trap) {
      this.trapRing = buildTrapRing(this.kit, this.world, trap.inner, trap.outer);
      this.trapRing.root.setPosition(trap.center.x, 0, trap.center.z);
      this.batch(this.trapRing.root);
    }
    for (const chute of this.chutes) chute.destroy();
    this.chutes.length = 0;
    for (const piece of game.level.pieces) {
      if (piece.kind !== "chute") continue;
      const chute = buildChute(this.kit, this.world, piece.path, piece.width, piece.hopper !== false);
      this.batch(chute);
      this.chutes.push(chute);
    }
    for (const star of this.risingStars) star.root.destroy();
    this.risingStars.length = 0;
    this.starLight.enabled = false;
    this.nextGlint = this.elapsed + 6;
    this.sync(0);
  }

  setCameraMode(mode: CameraMode): void {
    this.cameraMode = mode;
    this.introTime = 0;
    if (mode === "intro" && this.game) {
      const view = this.game.level.view;
      this.camYaw = view.yaw + 34;
      this.camPitch = -9;
      this.camDistance = view.distance + 5;
      this.camTarget.set(view.target.x, view.target.y + 1.2, view.target.z - 1);
    }
  }

  orbit(dx: number, dy: number): void {
    this.userYaw = pc.math.clamp(this.userYaw - dx * 0.2, -40, 40);
    this.userPitch = pc.math.clamp(this.userPitch - dy * 0.15, -22, 12);
  }

  /** Turn the view round the set by whole steps, for the look buttons and arrow keys. */
  look(degrees: number): void {
    this.userYaw = pc.math.clamp(this.userYaw + degrees, -40, 40);
  }

  zoom(delta: number): void {
    this.userZoom = pc.math.clamp(this.userZoom + delta, -8, 8);
  }

  resetCamera(): void {
    this.userYaw = 0;
    this.userPitch = 0;
    this.userZoom = 0;
  }

  setAim(preview: AimPreview | undefined): void {
    this.aim = preview;
  }

  /** A gentle marker where a known winning shot lands. */
  setHint(point: Vec3 | undefined): void {
    this.hintAt = point;
  }

  /** The player's aim is inside the hint ring: fill it in so they know their hand is guided. */
  setHintLocked(locked: boolean): void {
    this.hintLock.enabled = locked;
  }

  /** Ray from the camera through a point on the canvas (CSS pixels). */
  screenRay(x: number, y: number): { origin: Vec3; direction: Vec3 } {
    const component = this.camera.camera!;
    const near = component.screenToWorld(x, y, component.nearClip, new pc.Vec3());
    const far = component.screenToWorld(x, y, component.farClip, new pc.Vec3());
    const direction = far.sub(near).normalize();
    return { origin: { x: near.x, y: near.y, z: near.z }, direction: { x: direction.x, y: direction.y, z: direction.z } };
  }

  project(point: Vec3): ScreenPoint {
    const out = this.camera.camera!.worldToScreen(new pc.Vec3(point.x, point.y, point.z), new pc.Vec3());
    return { x: out.x, y: out.y, visible: out.z > 0 };
  }

  kingHead(): Vec3 {
    const p = this.company.kingHead();
    return { x: p.x, y: p.y, z: p.z };
  }

  queenHead(): Vec3 {
    const p = this.queen.head.getPosition();
    return { x: p.x, y: p.y + 0.9, z: p.z };
  }

  humptyHead(): Vec3 | undefined {
    if (!this.humpty) return undefined;
    const p = this.humpty.root.getPosition();
    return { x: p.x, y: p.y + 1.25, z: p.z };
  }

  lookHumptyAt(point: Vec3 | undefined): void {
    this.humptyLookAt = point;
  }

  // ------------------------------------------------------------------ events

  react(event: GameEvent): void {
    if (event.type === "fire") {
      const spec = AMMO[event.ammo];
      const muzzle = event.from;
      if (spec.gun === "mortar") this.recoil.mortar = 1;
      else if (spec.gun === "queen") this.blunderRecoil = 1;
      else this.recoil.cannon = 1;
      this.flash(muzzle, 0.9);
      const forward = new pc.Vec3(event.velocity.x, event.velocity.y, event.velocity.z).normalize();
      for (let index = 0; index < 9; index += 1) {
        this.puff(
          V(muzzle.x + forward.x * 0.4, muzzle.y + forward.y * 0.4, muzzle.z + forward.z * 0.4),
          V(forward.x * (2 + Math.random() * 3) + (Math.random() - 0.5) * 1.5, forward.y * 2 + Math.random() * 1.2, forward.z * (2 + Math.random() * 3) + (Math.random() - 0.5) * 1.5),
          0.5 + Math.random() * 0.5,
          1.3 + Math.random() * 0.8,
        );
      }
      this.queenPoint = 1;
      this.shake = Math.max(this.shake, spec.gun === "mortar" ? 0.12 : 0.18);
    } else if (event.type === "explode") {
      const at = V(event.at.x, event.at.y, event.at.z);
      this.flash(event.at, event.keg ? 2.6 : 1.9);
      for (let index = 0; index < (event.keg ? 22 : 16); index += 1) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 2 + Math.random() * (event.keg ? 6 : 4.5);
        this.puff(at.clone(), V(Math.cos(angle) * speed, 1.5 + Math.random() * 4, Math.sin(angle) * speed), 0.6 + Math.random() * 0.8, 1.2 + Math.random(), 0.3);
      }
      for (let index = 0; index < 12; index += 1) {
        const angle = Math.random() * Math.PI * 2;
        this.spark(at, V(Math.cos(angle) * (4 + Math.random() * 6), 3 + Math.random() * 6, Math.sin(angle) * (4 + Math.random() * 6)));
      }
      this.shake = Math.max(this.shake, event.keg ? 0.75 : 0.5);
    } else if (event.type === "impact") {
      if (event.strength > 0.25 && this.puffs.length < 140) {
        const count = Math.round(event.strength * 4);
        for (let index = 0; index < count; index += 1) {
          this.puff(
            V(event.at.x, Math.max(0.1, event.at.y - 0.2), event.at.z),
            V((Math.random() - 0.5) * 2, 0.5 + Math.random(), (Math.random() - 0.5) * 2),
            0.25 + event.strength * 0.35,
            0.7 + Math.random() * 0.5,
            0,
            event.material === "straw" ? palette.straw : undefined,
          );
        }
      }
      if (event.strength > 0.6) this.shake = Math.max(this.shake, event.strength * 0.18);
    } else if (event.type === "crack") {
      this.crackAt = V(event.at.x, event.at.y, event.at.z);
      this.company.mopUp(this.crackAt, this.elapsed);
      this.company.kingReacts("sulk", this.elapsed + 0.8);
      this.confetti(event.at);
      this.shake = 0.9;
      this.queenCheer = 1;
      this.splat(event.at);
      for (let index = 0; index < 14; index += 1) {
        const angle = (index / 14) * Math.PI * 2;
        this.spark(V(event.at.x, event.at.y, event.at.z), V(Math.cos(angle) * 5, 3 + Math.random() * 3, Math.sin(angle) * 5), palette.yolk);
      }
    } else if (event.type === "caught") {
      this.queenSulk = 1;
      this.company.kingReacts("cheer", this.elapsed);
    } else if (event.type === "curio") {
      this.curios.trigger(event.id, this.elapsed);
      if (event.id === "king") this.company.kingReacts("outrage", this.elapsed);
      if (event.id === "duke") this.company.dukeStruck(this.elapsed);
      if (event.id === "stagehands") this.company.stagehandsStruck(this.elapsed);
      if (event.id === "tower") this.company.towerStruck(this.elapsed);
      this.flash(event.at, 0.5);
    } else if (event.type === "slip") {
      this.puff(V(event.at.x, 0.2, event.at.z), V(0, 0.6, 0), 0.45, 0.8, 0, palette.cream);
      for (let index = 0; index < 8; index += 1) {
        const angle = (index / 8) * Math.PI * 2;
        this.spark(V(event.at.x, 0.4, event.at.z), V(Math.cos(angle) * 2.5, 2.5 + Math.random() * 2, Math.sin(angle) * 2.5), palette.straw);
      }
    } else if (event.type === "stung") {
      for (let index = 0; index < 5; index += 1) {
        this.spark(V(event.at.x, event.at.y + 0.2, event.at.z), V((Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3), palette.gold, 0.07, 0.5, 4);
      }
    } else if (event.type === "cue" && event.cue === "hive") {
      this.hiveStruckAt = this.elapsed;
    } else if (event.type === "smash") {
      // Blue-and-white shards, and a puff of dust off the shelf.
      const shards = event.piece === "teapot" ? 16 : event.piece === "plate" ? 10 : 6;
      const white = this.kit.material("china-shard", new pc.Color(0.95, 0.94, 0.9), 0.85, 0, { doubleSided: true });
      const blue = this.kit.material("china-shard-blue", new pc.Color(0.13, 0.24, 0.62), 0.85, 0, { doubleSided: true });
      for (let index = 0; index < shards && this.puffs.length < 180; index += 1) {
        const shape = V(0.05 + Math.random() * 0.08, 0.015, 0.04 + Math.random() * 0.06);
        const angle = Math.random() * Math.PI * 2;
        const { entity, pool } = this.particle("box", index % 3 ? white : blue, V(event.at.x, event.at.y, event.at.z), shape, V(Math.random() * 360, Math.random() * 360, 0));
        const speed = 1.5 + Math.random() * 3;
        this.puffs.push({ entity, pool, velocity: V(Math.cos(angle) * speed, 1.5 + Math.random() * 3, Math.sin(angle) * speed + 1), age: 0, life: 1 + Math.random() * 0.5, size: 1, grow: 0, gravity: 12, spin: 300 + Math.random() * 400, shape });
      }
      this.puff(V(event.at.x, event.at.y, event.at.z), V(0, 0.3, 0.3), 0.3, 0.7, 0, palette.cream);
      this.chinaDirty = true;
    } else if (event.type === "dish") {
      this.runaways?.root.destroy();
      const rig = buildRunaways(this.kit, this.effects);
      rig.root.setLocalScale(1.7, 1.7, 1.7);
      this.runaways = { ...rig, from: V(event.at.x, event.at.y, event.at.z), toward: event.toward, age: 0 };
      this.company.kingReacts("outrage", this.elapsed);
    } else if (event.type === "ricochet") {
      for (let index = 0; index < 6; index += 1) {
        this.spark(V(event.at.x, event.at.y, event.at.z), V((Math.random() - 0.5) * 6, 2 + Math.random() * 3, (Math.random() - 0.5) * 6), palette.gold);
      }
    } else if (event.type === "chest") {
      this.flash({ x: event.at.x, y: event.at.y + 0.3, z: event.at.z }, 0.7);
      for (let index = 0; index < 14; index += 1) {
        this.spark(V(event.at.x, event.at.y + 0.3, event.at.z), V((Math.random() - 0.5) * 3, 3 + Math.random() * 3, (Math.random() - 0.5) * 3), palette.gold);
      }
    } else if (event.type === "star") {
      this.releaseStar(event.at);
    } else if (event.type === "bounce") {
      this.bedBounceAt = this.elapsed;
      for (let index = 0; index < 5; index += 1) {
        this.puff(V(event.at.x, event.at.y - 0.6, event.at.z), V((Math.random() - 0.5) * 2, 0.5, (Math.random() - 0.5) * 2), 0.3, 0.6, 0, palette.cream);
      }
    } else if (event.type === "cue") {
      this.flash(event.at, 0.8);
      this.shockwave(event.at);
      for (let index = 0; index < 8; index += 1) {
        this.spark(V(event.at.x, event.at.y, event.at.z), V((Math.random() - 0.5) * 5, 1 + Math.random() * 3, (Math.random() - 0.5) * 5), palette.gold);
      }
    } else if (event.type === "cut") {
      for (let index = 0; index < 10; index += 1) {
        this.puff(V(event.at.x, event.at.y, event.at.z), V((Math.random() - 0.5) * 4, Math.random() * 2, (Math.random() - 0.5) * 4), 0.18, 0.7, 4, palette.oakLight);
      }
      this.shake = Math.max(this.shake, 0.2);
    } else if (event.type === "rope-cut") {
      for (let index = 0; index < 5; index += 1) {
        this.puff(V(event.at.x, event.at.y, event.at.z), V((Math.random() - 0.5) * 2, Math.random(), (Math.random() - 0.5) * 2), 0.25, 0.6, 0, palette.rope);
      }
    } else if (event.type === "rat") {
      if (event.action === "scared" || event.action === "steal") {
        for (let index = 0; index < 5; index += 1) {
          this.puff(V(event.at.x, 0.3, event.at.z), V((Math.random() - 0.5) * 2, 0.8, (Math.random() - 0.5) * 2), 0.35, 0.7);
        }
      }
    } else if (event.type === "bowled") {
      this.company.kingReacts("laugh", this.elapsed);
      for (let index = 0; index < 4; index += 1) {
        this.puff(V(event.at.x, 0.2, event.at.z), V((Math.random() - 0.5) * 2, 0.6, (Math.random() - 0.5) * 2), 0.4, 0.8);
      }
    }
  }

  // ------------------------------------------------------------------ frame

  sync(alpha: number): void {
    const game = this.game;
    if (!game) return;
    const seen = new Set<number>();
    const crews = new Map<number, CrewView>();
    for (const crew of game.crewViews) for (const id of crew.slots) crews.set(id, crew);
    const q0 = new pc.Quat();
    const q1 = new pc.Quat();
    for (const view of game.bodies) {
      seen.add(view.id);
      let visual = this.visuals.get(view.id);
      if (!visual) {
        visual = this.createVisual(view, crews.get(view.id));
        this.visuals.set(view.id, visual);
      }
      const p = view.prevPosition;
      const c = view.position;
      visual.root.setPosition(p.x + (c.x - p.x) * alpha, p.y + (c.y - p.y) * alpha, p.z + (c.z - p.z) * alpha);
      q0.set(view.prevRotation.x, view.prevRotation.y, view.prevRotation.z, view.prevRotation.w);
      q1.set(view.rotation.x, view.rotation.y, view.rotation.z, view.rotation.w);
      visual.root.setRotation(new pc.Quat().slerp(q0, q1, alpha));
    }
    for (const [id, visual] of this.visuals) {
      if (seen.has(id)) continue;
      visual.root.destroy();
      this.visuals.delete(id);
      if (id === this.humptyVisualId) {
        this.humpty = undefined;
        this.humptyVisualId = undefined;
      }
    }
    for (const [id, chain] of this.chains) {
      if (!seen.has(id)) {
        chain.destroy();
        this.chains.delete(id);
      }
    }
    for (const [id, chain] of this.chains) {
      const a = this.visuals.get(id);
      const b = a?.view.link !== undefined ? this.visuals.get(a.view.link) : undefined;
      if (!a || !b) {
        chain.enabled = false;
        continue;
      }
      placeSegment(chain, a.root.getPosition(), b.root.getPosition(), 0.05);
    }
    for (const visual of this.visuals.values()) {
      if (visual.lid && visual.view.open && (visual.opened ?? 0) < 1) {
        visual.opened = Math.min(1, (visual.opened ?? 0) + 0.06);
        visual.lid.setLocalEulerAngles(-visual.opened * 110, 0, 0);
      }
      if (visual.drum) visual.drum.rotateLocal(game.windy ? 14 : 0.4, 0, 0);
      if (visual.lever) visual.lever.setLocalEulerAngles(0, 0, game.trapView?.pulled ? -LEVER_THROW : LEVER_THROW);
      if (visual.counterweight) visual.counterweight.setLocalPosition(0, -(game.gateView?.lift ?? 0) * 0.75, 0);
      if (visual.view.material === "bed") {
        const squash = Math.max(0, 1 - (this.elapsed - this.bedBounceAt) * 4);
        visual.root.setLocalScale(1 + squash * 0.06, 1 - squash * 0.22, 1 + squash * 0.06);
      }
    }
    for (const [id, visual] of this.visuals) {
      const crew = crews.get(id);
      if (crew) this.animateCrew(visual, crew, crew.slots.find((slot) => this.visuals.get(slot)?.man) === id);
      if (visual.key) visual.key.setLocalEulerAngles(0, this.elapsed * -120, 0);
    }
  }

  private readonly pace = { time: 0, frames: 0, calm: 0, windows: 0, raisedAt: -99 };
  /** The finest ratio still worth trying: lowered for good when a step up proves too much. */
  private ceiling = 1;

  /**
   * Keep the frame rate up on slower machines: measure two-second windows and step the pixel ratio
   * down a notch when frames average over ~24 ms, back up after a sustained run of quick ones.
   */
  private governPixelRatio(dt: number, realDt: number): void {
    // Skip hitches (the frame loop caps dt at 0.1) and frozen frames: a hit-stop or the
    // replay's rewind does its own heavy lifting and says nothing about the steady pace.
    if (dt <= 0 || realDt <= 0 || realDt >= 0.1) return;
    const pace = this.pace;
    pace.time += realDt;
    pace.frames += 1;
    if (pace.time < 2) return;
    const average = pace.time / pace.frames;
    pace.time = 0;
    pace.frames = 0;
    pace.windows += 1;
    const device = this.app.graphicsDevice;
    const ratio = device.maxPixelRatio;
    if (average > 0.024 && ratio > 1) {
      const lower = Math.max(1, ratio - 0.25);
      // Too slow straight after stepping up: that step was a mistake, don't try it again.
      if (pace.windows - pace.raisedAt <= 3) this.ceiling = lower;
      device.maxPixelRatio = lower;
      pace.calm = 0;
      this.resize();
    } else if (average < 0.0175 && ratio < this.ceiling) {
      pace.calm += 1;
      if (pace.calm >= 4) {
        device.maxPixelRatio = Math.min(this.ceiling, ratio + 0.25);
        pace.calm = 0;
        pace.raisedAt = pace.windows;
        this.resize();
      }
    } else {
      pace.calm = 0;
    }
  }

  frame(dt: number, realDt: number): void {
    this.elapsed += realDt;
    this.governPixelRatio(dt, realDt);
    this.animateHumpty(dt);
    this.animateQueen(realDt);
    this.animateGuns(realDt);
    this.animateAim();
    this.animateHint();
    this.animateHoist();
    this.animateRopes();
    this.animateRat();
    this.animateBlunderbuss(realDt);
    this.animateBombs(dt);
    this.animateStars(realDt);
    this.animateTrap();
    this.curios.update(this.elapsed);
    this.company.update(this.elapsed, Boolean(this.game?.hoisting));
    this.animateEffects(dt);
    this.animateChina(dt);
    this.animateBees(dt);
    this.animateScenery();
    this.updateCamera(realDt);
  }

  // ------------------------------------------------------------------ visuals

  private createVisual(view: BodyView, crew: CrewView | undefined): BodyVisual {
    const root = this.kit.group(`${view.kind}-${view.id}`, this.actors);
    const visual: BodyVisual = { view, root };
    switch (view.kind) {
      case "block":
        buildBlock(this.kit, root, view.material, view.size, `b${view.id}`);
        break;
      case "keg":
        buildKeg(this.kit, root, view.size);
        break;
      case "hay":
        buildHay(this.kit, root, view.size, `h${view.id}`);
        break;
      case "humpty":
        this.humpty = buildHumpty(this.kit, root);
        this.humptyVisualId = view.id;
        break;
      case "shot":
      case "shell":
      case "bomb":
      case "grape":
      case "chain":
        buildProjectile(this.kit, root, view.kind, view.size);
        if (view.kind === "chain" && view.link !== undefined && !this.chains.has(view.link)) {
          const chain = this.kit.primitive("chain", "cylinder", this.effects, V(), { x: 0.05, y: 1, z: 0.05 }, this.kit.material("chain-iron", palette.iron, 0.5, 0.7), pc.Vec3.ZERO, false);
          this.chains.set(view.id, chain);
        }
        break;
      case "shard":
        buildShellPiece(this.kit, root, view.material as "egg-bottom" | "egg-top" | "egg-chip", view.size);
        break;
      case "crown":
        buildCrown(this.kit, root);
        break;
      case "man":
        visual.man = buildMan(this.kit, root, view.material === "guard" ? "guard" : crew?.kind === "cart" ? "driver" : "bearer");
        break;
      case "horse":
        visual.horse = buildHorse(this.kit, root);
        break;
      case "litter":
        if (view.material === "cart") visual.wheels = buildCartBed(this.kit, root, view.size).wheels;
        else buildLitterBed(this.kit, root, view.size);
        break;
      case "fixture": {
        const carousel = view.material === "carousel" ? this.game?.level.pieces.find((piece) => piece.kind === "carousel") : undefined;
        const revolve = view.material === "revolve" ? this.game?.level.pieces.find((piece) => piece.kind === "revolve") : undefined;
        const fixture = carousel?.kind === "carousel"
          ? buildCarousel(this.kit, root, carousel)
          : revolve?.kind === "revolve"
            ? buildRevolve(this.kit, root, revolve)
            : buildFixture(this.kit, root, view.material, view.size);
        if (view.material === "capstan") visual.capstan = fixture.findByName("capstan-head") as pc.Entity;
        if (view.material === "counterweight") visual.counterweight = fixture.findByName("counterweight-body") as pc.Entity;
        if (view.material === "windmachine") visual.drum = fixture.findByName("wind-drum") as pc.Entity;
        if (view.material === "lever") visual.lever = fixture.findByName("lever-arm") as pc.Entity;
        if (view.material === "dresser") visual.china = (fixture.findByName("china") as pc.Entity).children as pc.Entity[];
        if (view.material === "hive") visual.skep = fixture.findByName("skep") as pc.Entity;
        break;
      }
      case "chest": {
        const chest = buildChest(this.kit, root, view.size);
        visual.lid = chest.lid;
        visual.hoard = chest.hoard;
        visual.opened = 0;
        break;
      }
      case "turntable": {
        const def = this.game?.level.pieces.find((piece) => piece.kind === "turntable");
        const arm = def && def.kind === "turntable" ? def.arm : 1.5;
        visual.key = buildTurntable(this.kit, root, view.size.x / 2, arm).key;
        break;
      }
      case "rat":
        visual.rat = buildRat(this.kit, root);
        break;
      case "pellet":
        buildProjectile(this.kit, root, "grape", view.size);
        break;
      case "bucket":
        buildBucket(this.kit, root, view.size);
        break;
      case "sandbag":
        buildSandbag(this.kit, root, view.size);
        break;
      case "peel":
        buildPeel(this.kit, root, view.size);
        break;
      default:
        break;
    }
    // Things that animate inside (the wind drum, a chest lid) stay out of the batch.
    if (BATCHED.has(view.kind) && !visual.drum && !visual.lever && !visual.counterweight) this.batch(root);
    return visual;
  }

  /**
   * Put every mesh under this visual into the actors' dynamic batch group. Parts that are
   * switched on and off (dazed stars, a sandwich, the mop stagehand) stay out: toggling a
   * batched mesh rebuilds the whole group, which would stutter at the big moments.
   */
  private batch(node: pc.GraphNode): void {
    if (UNBATCHED.has(node.name)) return;
    const entity = node as pc.Entity;
    if (entity.render) entity.render.batchGroupId = this.actorBatch;
    for (const child of node.children) this.batch(child);
  }

  private animateCrew(visual: BodyVisual, crew: CrewView, lead: boolean): void {
    const stride = crew.stride;
    const running = crew.speed > 2;
    const cheering = crew.mode === "cheer";
    if (visual.man) {
      const man = visual.man;
      const swing = Math.sin(stride * (running ? 3.2 : 4.2)) * Math.min(1, crew.speed) * (running ? 40 : 28);
      man.leftLeg.setLocalEulerAngles(swing, 0, 0);
      man.rightLeg.setLocalEulerAngles(-swing, 0, 0);
      const gameOver = this.game?.cracked ?? false;
      // A paint pot on the leader's head, dripping whitewash.
      const hatted = lead && crew.bucket;
      if (hatted && !visual.hat) {
        visual.hat = buildBucket(this.kit, man.rig, { x: 0.42, y: 0.4, z: 0.42 }, true);
        visual.hat.setLocalPosition(0, 1.72, 0);
      }
      if (visual.hat) visual.hat.enabled = hatted;
      const dancing = crew.mode === "patrol" && crew.kind === "guard";
      const stung = crew.mode === "stung";
      if (stung) {
        // Swatting at bees with both hands over his head.
        const flap = Math.sin(this.elapsed * 22 + stride) * 35;
        man.leftArm.setLocalEulerAngles(20, 0, -135 + flap);
        man.rightArm.setLocalEulerAngles(-20, 0, 135 + flap);
      } else if (dancing) {
        // Ring-a-ring o' roses: arms out, hands held, a skip in every step.
        const skip = Math.sin(this.elapsed * 7 + stride);
        man.leftArm.setLocalEulerAngles(0, 0, -95 + skip * 10);
        man.rightArm.setLocalEulerAngles(0, 0, 95 - skip * 10);
      } else if (hatted) {
        const grope = Math.sin(this.elapsed * 3) * 15;
        man.leftArm.setLocalEulerAngles(-80 + grope, 0, 10);
        man.rightArm.setLocalEulerAngles(-80 - grope, 0, -10);
      } else if (crew.kind === "litter") {
        man.leftArm.setLocalEulerAngles(-25, 0, 8);
        man.rightArm.setLocalEulerAngles(-25, 0, -8);
      } else if (cheering && !gameOver) {
        const wave = Math.sin(this.elapsed * 12) * 20;
        man.leftArm.setLocalEulerAngles(0, 0, -150 + wave);
        man.rightArm.setLocalEulerAngles(0, 0, 150 - wave);
      } else if (gameOver) {
        man.leftArm.setLocalEulerAngles(-60, 0, 15);
        man.rightArm.setLocalEulerAngles(-60, 0, -15);
      } else {
        man.leftArm.setLocalEulerAngles(-swing * 0.8, 0, 6);
        man.rightArm.setLocalEulerAngles(swing * 0.8, 0, -6);
      }
      const bob = running ? Math.abs(Math.sin(stride * 3.2)) * 0.08 : stung ? Math.abs(Math.sin(this.elapsed * 11)) * 0.14 : cheering && !gameOver ? Math.abs(Math.sin(this.elapsed * 9)) * 0.12 : 0;
      man.rig.setLocalPosition(0, -0.8 + bob, 0);
      man.rig.setLocalEulerAngles(gameOver && cheering ? 18 : 0, 0, 0);
      man.daze.enabled = crew.mode === "stunned";
      if (man.daze.enabled) man.daze.setLocalEulerAngles(0, this.elapsed * 360, 0);
    }
    if (visual.horse) {
      const horse = visual.horse;
      const gallop = stride * 2.6;
      horse.legs.forEach((leg, index) => {
        const phase = gallop + (index < 2 ? 0 : Math.PI * 0.6) + (index % 2) * 0.4;
        leg.setLocalEulerAngles(Math.sin(phase) * Math.min(1, crew.speed / 2) * 38, 0, 0);
      });
      horse.head.setLocalEulerAngles(Math.sin(gallop) * 6 * Math.min(1, crew.speed / 3), 0, 0);
      horse.tail.setLocalEulerAngles(Math.sin(this.elapsed * 3) * 10 - crew.speed * 4, Math.sin(this.elapsed * 2.1) * 12, 0);
      horse.body.setLocalPosition(0, -1.05 + Math.abs(Math.sin(gallop)) * 0.06 * Math.min(1, crew.speed / 2), 0);
      // Stung, the horse rears and kicks.
      horse.body.setLocalEulerAngles(crew.mode === "stung" ? -18 + Math.sin(this.elapsed * 9) * 6 : 0, 0, 0);
    }
    if (visual.wheels) {
      for (const wheel of visual.wheels) wheel.setLocalEulerAngles(stride * -130, 0, 90);
    }
  }

  private animateHumpty(dt: number): void {
    const rig = this.humpty;
    const game = this.game;
    if (!rig || !game) return;
    const mood = game.humptyMood;
    const t = this.elapsed;
    const falling = mood === "falling";
    const aimClose = this.aim?.hit && game.humptyPosition
      ? Math.hypot(this.aim.hit.x - game.humptyPosition.x, this.aim.hit.y - game.humptyPosition.y, this.aim.hit.z - game.humptyPosition.z) < 1.8
      : false;
    const nervous = mood === "nervous" || aimClose;
    const hoisting = game.hoisting;
    const brow = falling ? 22 : nervous ? 14 : mood === "smug" ? -12 : hoisting ? 10 : 0;
    const browLift = falling ? 0.08 : nervous ? 0.04 : 0;
    rig.brows[0]!.setLocalEulerAngles(0, 0, -8 - brow);
    rig.brows[1]!.setLocalEulerAngles(0, 0, 8 + brow);
    rig.brows[0]!.setLocalPosition(-0.14, 0.24 + browLift, rig.brows[0]!.getLocalPosition().z);
    rig.brows[1]!.setLocalPosition(0.14, 0.24 + browLift, rig.brows[1]!.getLocalPosition().z);
    const eyeScale = falling ? 1.25 : nervous ? 1.1 : 1;
    for (const eye of rig.eyes) eye.setLocalScale(eyeScale, eyeScale, 1);
    for (const lid of rig.lids) lid.enabled = mood === "smug";

    let lookX = Math.sin(t * 0.6) * 0.012;
    let lookY = 0;
    if (this.humptyLookAt && game.humptyPosition) {
      const dx = this.humptyLookAt.x - game.humptyPosition.x;
      const dy = this.humptyLookAt.y - game.humptyPosition.y;
      lookX = pc.math.clamp(dx * 0.006, -0.035, 0.035);
      lookY = pc.math.clamp(dy * 0.006, -0.03, 0.03);
    }
    if (nervous && !falling) lookX += Math.sin(t * 13) * 0.02;
    if (hoisting) {
      lookX = Math.cos(t * 9) * 0.03;
      lookY = Math.sin(t * 9) * 0.03;
    }
    rig.pupils.forEach((pupil) => {
      pupil.setLocalPosition(lookX, -0.01 + lookY, 0.045);
      const s = falling ? 0.6 : 1;
      pupil.setLocalScale(0.07 * s, 0.1 * s, 0.04);
    });

    const talking = this.humptyTalk > 0;
    rig.mouthO.enabled = falling || (talking && !nervous && Math.sin(t * 16) > 0.2);
    rig.mouth.enabled = !rig.mouthO.enabled && !nervous;
    rig.frown.enabled = !rig.mouthO.enabled && nervous;
    if (falling) {
      const scream = 1 + Math.sin(t * 30) * 0.15;
      rig.mouthO.setLocalScale(0.12 * scream, 0.17 * scream, 0.06);
    } else if (rig.mouthO.enabled) {
      rig.mouthO.setLocalScale(0.1, 0.09, 0.05);
    }
    rig.mouth.setLocalEulerAngles(0, 0, mood === "smug" ? 14 : 0);
    rig.mouth.setLocalScale(mood === "smug" ? 1.1 : 1, 1, 1);
    rig.frown.setLocalEulerAngles(0, 0, Math.sin(t * 17) * 7);
    this.humptyTalk = Math.max(0, this.humptyTalk - dt);

    const flail = falling ? Math.sin(t * 22) * 50 : 0;
    const wave = nervous && !falling ? Math.sin(t * 6) * 10 : 0;
    const teeter = !falling ? game.teeterView : undefined;
    if (teeter) {
      // On the brink: arms out, windmilling like mad, and sweating.
      const mill = t * 15;
      rig.arms[0]!.setLocalEulerAngles(Math.cos(mill) * 45, 0, 95 + Math.sin(mill) * 40);
      rig.arms[1]!.setLocalEulerAngles(Math.cos(mill + Math.PI) * 45, 0, -95 - Math.sin(mill + Math.PI) * 40);
      if (this.elapsed > this.sweatAt) {
        this.sweatAt = this.elapsed + 0.18;
        const head = rig.root.getPosition();
        this.spark(V(head.x + (Math.random() < 0.5 ? -0.32 : 0.32), head.y + 0.45, head.z + 0.3), V((Math.random() - 0.5) * 0.8, 0.8, 0.4), SWEAT);
      }
    } else {
      rig.arms[0]!.setLocalEulerAngles(0, 0, 35 + (falling ? 70 + flail : wave) + (hoisting ? 90 : 0));
      rig.arms[1]!.setLocalEulerAngles(0, 0, -35 - (falling ? 70 - flail : -wave) - (hoisting ? 90 : 0));
    }
    rig.crown.setLocalEulerAngles(falling ? Math.sin(t * 25) * 12 : 0, 0, nervous ? Math.sin(t * 11) * 4 : 0);
    // Left in peace, he keeps himself busy: the paper, a cup of tea, a polish of the crown.
    const idle = !falling && !nervous && !hoisting && mood === "calm" && !this.humptyTalk && !game.cracked && game.phase !== "won";
    this.busyWith(rig, idle ? this.idleActivity(t) : undefined, t);
    // A lit bomb nearby: he sweats.
    if (!falling && this.elapsed > this.sweatAt && game.humptyPosition && game.fuses.some((fuse) => Math.hypot(fuse.at.x - game.humptyPosition!.x, fuse.at.z - game.humptyPosition!.z) < 4)) {
      this.sweatAt = this.elapsed + 0.25;
      const head = rig.root.getPosition();
      this.spark(V(head.x + (Math.random() < 0.5 ? -0.3 : 0.3), head.y + 0.5, head.z + 0.3), V((Math.random() - 0.5) * 0.6, 0.6, 0.3), SWEAT);
    }
    const kick = falling ? Math.sin(t * 18) * 35 : hoisting ? Math.sin(t * 8) * 25 : Math.sin(t * 1.7) * 6;
    rig.legs[0]!.setLocalEulerAngles(-70 + kick, 0, 0);
    rig.legs[1]!.setLocalEulerAngles(-70 - kick, 0, 0);
  }

  private humptyTalk = 0;
  private queenTalk = 0;
  private sweatAt = 0;
  private idleSince = 0;

  /** Which pastime he's on, if he has been left alone long enough to start one. */
  private idleActivity(t: number): "paper" | "tea" | "polish" | undefined {
    if (this.idleSince === 0) this.idleSince = t;
    const quiet = t - this.idleSince;
    if (quiet < 4) return undefined;
    const cycle = Math.floor((quiet - 4) / 7);
    const within = (quiet - 4) % 7;
    if (within > 5.2) return undefined;
    return (["paper", "tea", "polish"] as const)[cycle % 3];
  }

  private busyWith(rig: HumptyRig, activity: "paper" | "tea" | "polish" | undefined, t: number): void {
    if (!activity) this.idleSince = this.humptyTalk || this.game?.humptyMood !== "calm" ? 0 : this.idleSince;
    rig.paper.enabled = activity === "paper";
    rig.cup.enabled = activity === "tea";
    rig.cloth.enabled = activity === "polish";
    if (activity === "paper") {
      // Both hands forward holding the paper; now and then he lowers it to peek.
      const peek = Math.max(0, Math.sin(t * 0.9) - 0.7) * 3;
      rig.arms[0]!.setLocalEulerAngles(0, 65, -5);
      rig.arms[1]!.setLocalEulerAngles(0, -65, 5);
      rig.paper.setLocalPosition(0, 0.06 - peek * 0.18, 0.66);
      rig.paper.setLocalEulerAngles(-8 - peek * 10, Math.sin(t * 0.7) * 4, 0);
    } else if (activity === "tea") {
      // A sip, little finger out; then the cup comes down again.
      const sip = Math.max(0, Math.sin(t * 1.3));
      rig.arms[1]!.setLocalEulerAngles(0, -55 - sip * 20, -10 + sip * 38);
    } else if (activity === "polish") {
      // Up to the crown with a cloth, in little circles.
      rig.arms[0]!.setLocalEulerAngles(0, Math.sin(t * 8) * 15, 125 + Math.cos(t * 8) * 10);
      rig.crown.setLocalEulerAngles(Math.sin(t * 8) * 4, 0, Math.cos(t * 8) * 4);
    }
  }

  talk(speaker: "humpty" | "queen", seconds: number): void {
    if (speaker === "humpty") this.humptyTalk = seconds;
    else this.queenTalk = seconds;
  }

  /** All forty-eight stars: the Queen marches to the broken egg and plants her standard. */
  startFinale(): void {
    const at = this.crackAt ?? V(0, 0, -2);
    this.finale = { age: 0, to: V(at.x + 1.3, 0, at.z + 1.1), nextBurst: 4.6, showered: false };
    this.queenFlag.enabled = true;
    this.cameraMode = "finale";
  }

  get finaleAge(): number {
    return this.finale?.age ?? 0;
  }

  private animateFinale(dt: number): boolean {
    const finale = this.finale;
    if (!finale) return false;
    finale.age += dt;
    const t = finale.age;
    const queen = this.queen;
    const podium = V(QUEEN_SPOT.x, QUEEN_SPOT.y, QUEEN_SPOT.z);
    const step = V(-3.2, 0, 5.8);
    const walk = 4.2;
    let at: pc.Vec3;
    if (t < 0.8) at = new pc.Vec3().lerp(podium, step, t / 0.8);
    else if (t < walk) at = new pc.Vec3().lerp(step, finale.to, (t - 0.8) / (walk - 0.8));
    else at = finale.to.clone();
    const marching = t < walk;
    queen.root.setPosition(at.x, at.y + (marching ? Math.abs(Math.sin(t * 9)) * 0.08 : 0), at.z);
    const heading = marching ? Math.atan2(finale.to.x - step.x, finale.to.z - step.z) * DEG : 200 + Math.sin(t * 1.5) * 10;
    queen.root.setLocalEulerAngles(0, heading, marching ? Math.sin(t * 9) * 5 : 0);
    queen.body.setLocalPosition(0, t > walk + 0.6 ? Math.abs(Math.sin(t * 8)) * 0.2 : 0, 0);
    // She carries the standard aloft, then plants it by the broken egg.
    const hand = queen.arm.getPosition();
    if (t < walk + 0.4) {
      this.queenFlag.setPosition(hand.x + 0.2, Math.max(0, hand.y - 1.2), hand.z);
      this.queenFlag.setLocalEulerAngles(0, 0, -8);
      queen.arm.setLocalEulerAngles(0, 0, 100);
    } else {
      const plant = Math.min(1, (t - walk - 0.4) / 0.35);
      this.queenFlag.setPosition(finale.to.x - 0.9, 1.2 - plant * 1.2, finale.to.z - 0.5);
      this.queenFlag.setLocalEulerAngles(0, 0, (1 - plant) * -8);
      queen.arm.setLocalEulerAngles(0, 0, 140 + Math.sin(t * 14) * 20);
      if (plant >= 1 && this.shake < 0.2 && t < walk + 0.9) this.shake = 0.35;
    }
    this.queenFlagCloth.setLocalEulerAngles(0, Math.sin(t * 5) * 14, Math.sin(t * 3.3) * 4);
    queen.head.setLocalEulerAngles(0, marching ? 0 : Math.sin(t * 2) * 12, -7);
    // Fireworks over the painted sky, and paper confetti from the flies.
    if (t > finale.nextBurst && t < 13) {
      finale.nextBurst = t + 0.35 + Math.random() * 0.35;
      this.firework(V((Math.random() - 0.5) * 18, 8 + Math.random() * 5, -9 + Math.random() * 5));
    }
    if (!finale.showered && t > walk + 0.7) {
      finale.showered = true;
      this.confetti({ x: finale.to.x, y: 0, z: finale.to.z });
    }
    return true;
  }

  /** A firework: a flash and a ring of coloured sparks. */
  private firework(at: pc.Vec3): void {
    const colours = [palette.gold, palette.king, palette.queen, palette.cream, new pc.Color(0.35, 0.5, 0.95)];
    const colour = colours[Math.floor(Math.random() * colours.length)]!;
    this.flash({ x: at.x, y: at.y, z: at.z }, 1.2);
    for (let index = 0; index < 24; index += 1) {
      const angle = (index / 24) * Math.PI * 2;
      const lift = (Math.random() - 0.3) * 5;
      this.spark(at.clone(), V(Math.cos(angle) * 6.5, lift, Math.sin(angle) * 3), colour, 0.3, 1.5, 3);
    }
  }

  /**
   * Now and then, when nothing needs her, the Queen hops off her podium and strolls down to the
   * edge of the boards for a look at the stage, then strolls back. Returns her place and heading.
   */
  private queenStroll(dt: number): { at: pc.Vec3; heading: number; look: number; bob: number } | undefined {
    const game = this.game;
    const needed = !game || game.selected === "blunderbuss" || (game.ratView !== undefined && game.ratView.mode !== "off") || game.cracked || game.hoisting;
    if (this.strollAt < 0) {
      this.strollWait -= dt;
      if (this.strollWait > 0 || needed || this.queenTalk > 0) return undefined;
      this.strollAt = 0;
    }
    // Wanted back at the battery: skip the looking about and turn for home from wherever she is.
    if (needed && this.strollAt < STROLL.back) {
      const t = this.strollAt;
      if (t < STROLL.down) this.strollAt = STROLL.end - (t / STROLL.down) * (STROLL.end - STROLL.up);
      else if (t < STROLL.look) this.strollAt = STROLL.back + (1 - (t - STROLL.down) / (STROLL.look - STROLL.down)) * (STROLL.up - STROLL.back);
      else this.strollAt = STROLL.back;
    }
    this.strollAt += dt * (needed ? 2.2 : 1);
    const t = this.strollAt;
    const home = V(QUEEN_SPOT.x, QUEEN_SPOT.y, QUEEN_SPOT.z);
    const foot = V(QUEEN_SPOT.x + 0.2, 0, QUEEN_SPOT.z - 0.95);
    const edge = V(QUEEN_SPOT.x + 0.8, 0, 3.7);
    const heading = (from: pc.Vec3, to: pc.Vec3): number => Math.atan2(to.x - from.x, to.z - from.z) * DEG;
    const hop = (from: pc.Vec3, to: pc.Vec3, k: number): pc.Vec3 => new pc.Vec3().lerp(from, to, k).add(V(0, Math.sin(k * Math.PI) * 0.22, 0));
    if (t < STROLL.down) return { at: hop(home, foot, t / STROLL.down), heading: heading(home, edge), look: 0, bob: 0 };
    if (t < STROLL.look) return { at: new pc.Vec3().lerp(foot, edge, smoothstep((t - STROLL.down) / (STROLL.look - STROLL.down))), heading: heading(foot, edge), look: 0, bob: 1 };
    if (t < STROLL.back) {
      // A look to one side, then the other, then a long hard look at the egg.
      const k = t - STROLL.look;
      const look = k < 1.2 ? Math.sin((k / 1.2) * Math.PI * 0.5) * 38 : k < 2.6 ? 38 - ((k - 1.2) / 1.4) * 76 : k < 3.4 ? -38 + ((k - 2.6) / 0.8) * 38 : 0;
      return { at: edge, heading: 180, look, bob: 0 };
    }
    if (t < STROLL.up) return { at: new pc.Vec3().lerp(edge, foot, smoothstep((t - STROLL.back) / (STROLL.up - STROLL.back))), heading: heading(edge, foot), look: 0, bob: 1 };
    if (t < STROLL.end) return { at: hop(foot, home, (t - STROLL.up) / (STROLL.end - STROLL.up)), heading: heading(foot, home), look: 0, bob: 0 };
    this.strollAt = -1;
    this.strollWait = 22 + Math.random() * 14;
    return undefined;
  }

  private strollAt = -1;
  private strollWait = 12;

  private animateQueen(dt: number): void {
    if (this.animateFinale(dt)) return;
    const queen = this.queen;
    const t = this.elapsed;
    const stroll = this.queenStroll(dt);
    if (stroll) {
      const walking = stroll.bob > 0 ? Math.sin(t * 9) : 0;
      queen.root.setPosition(stroll.at.x, stroll.at.y + Math.abs(walking) * 0.06, stroll.at.z);
      queen.root.setLocalEulerAngles(0, stroll.heading, walking * 4);
      queen.body.setLocalPosition(0, 0, 0);
      queen.head.setLocalEulerAngles(stroll.look === 0 && stroll.bob === 0 ? -6 : 0, stroll.look, -7);
      queen.arm.setLocalEulerAngles(0, 0, 20 + walking * 12);
      queen.scepter.setLocalEulerAngles(0, 0, -9 + walking * 10);
      return;
    }
    queen.root.setPosition(QUEEN_SPOT.x, QUEEN_SPOT.y, QUEEN_SPOT.z);
    this.queenPoint = Math.max(0, this.queenPoint - dt * 0.9);
    this.queenCheer = Math.max(0, this.queenCheer - dt * 0.25);
    this.queenSulk = Math.max(0, this.queenSulk - dt * 0.4);
    this.queenTalk = Math.max(0, this.queenTalk - dt);
    const twitch = Math.sin(t * 2.7) + Math.sin(t * 7.9) * 0.28;
    const declaim = this.queenTalk > 0 ? Math.sin(t * 9) : 0;
    const hop = this.queenCheer > 0 ? Math.abs(Math.sin(t * 10)) * 0.25 * this.queenCheer : 0;
    const stomp = this.queenSulk > 0 ? Math.abs(Math.sin(t * 14)) * 0.08 * this.queenSulk : 0;
    queen.body.setLocalPosition(0, Math.sin(t * 1.8) * 0.018 + hop + stomp, 0);
    const turn = this.queenPoint * 50;
    queen.root.setLocalEulerAngles(0, 150 + turn, 0);
    queen.head.setLocalEulerAngles(declaim * 4 - this.queenSulk * 10, twitch * 5, -7 + twitch * 3.5);
    queen.crown.setLocalEulerAngles(twitch * 1.5 + declaim * 3 + hop * 20, 0, -17 - twitch * 2.5);
    const raise = Math.max(this.queenPoint, this.queenCheer) * 110;
    queen.arm.setLocalEulerAngles(0, 0, raise + Math.sin(t * 3.6) * 6 + declaim * 12);
    queen.scepter.setLocalEulerAngles(0, twitch * 2, -9 + Math.sin(t * 3.6) * 8 + (this.queenCheer > 0 ? Math.sin(t * 14) * 25 : 0));
  }

  private animateGuns(dt: number): void {
    const game = this.game;
    this.recoil.cannon = Math.max(0, this.recoil.cannon - dt * 2.2);
    this.recoil.mortar = Math.max(0, this.recoil.mortar - dt * 2.8);
    this.swap = Math.max(0, this.swap - dt * 2.5);
    const selected = game?.selected;
    const gun = selected ? AMMO[selected].gun : undefined;
    if (game && selected !== this.lastSelected) {
      // A change of shot: the crew unloads and rams home the new charge, and the Queen points.
      this.lastSelected = selected;
      if (gun !== "queen") {
        this.swap = 1;
        this.queenPoint = Math.max(this.queenPoint, 0.6);
      }
    }
    if (game && this.aim) {
      const v = this.aim.velocity;
      const yaw = Math.atan2(-v.x, -v.z) * DEG;
      const pitch = Math.atan2(v.y, Math.hypot(v.x, v.z)) * DEG;
      const target = gun === "mortar" ? this.mortarAim : gun === "cannon" ? this.cannonAim : undefined;
      if (target) {
        target.yaw += (yaw - target.yaw) * Math.min(1, dt * 10);
        target.pitch += (pitch - target.pitch) * Math.min(1, dt * 10);
      }
    }
    // The idle gun settles back to rest, so it is plain which one is manned.
    const rest = (aim: { yaw: number; pitch: number }, pitch: number): void => {
      aim.yaw += (0 - aim.yaw) * Math.min(1, dt * 3);
      aim.pitch += (pitch - aim.pitch) * Math.min(1, dt * 3);
    };
    if (gun !== "cannon") rest(this.cannonAim, -4);
    if (gun !== "mortar") rest(this.mortarAim, 35);
    const kick = (amount: number): number => Math.sin(Math.min(1, amount) * Math.PI) * amount;
    const loading = Math.sin(this.swap * Math.PI) * this.swap;
    const cannonLoad = gun === "cannon" ? loading : 0;
    const mortarLoad = gun === "mortar" ? loading : 0;
    this.cannon.yaw.setLocalEulerAngles(0, this.cannonAim.yaw, 0);
    this.cannon.pitch.setLocalEulerAngles(this.cannonAim.pitch - cannonLoad * 10, 0, 0);
    this.cannon.recoil.setLocalPosition(0, 0, kick(this.recoil.cannon) * 0.55 + cannonLoad * 0.35);
    for (const wheel of this.cannon.wheels) wheel.setLocalEulerAngles(this.recoil.cannon * 40, 0, 90);
    this.mortar.yaw.setLocalEulerAngles(0, this.mortarAim.yaw, 0);
    this.mortar.pitch.setLocalEulerAngles(this.mortarAim.pitch - mortarLoad * 15, 0, 0);
    this.mortar.recoil.setLocalPosition(0, -kick(this.recoil.mortar) * 0.12, kick(this.recoil.mortar) * 0.2 + mortarLoad * 0.15);
    // Show the charge in the mouth of the gun that will fire it, once it is loaded.
    const ready = Boolean(game && game.phase === "aim" && game.reload <= 0 && this.swap < 0.5);
    for (const [kind, load] of this.loads) {
      load.enabled = ready && kind === selected && (game?.ammo[kind as StockKind] ?? 0) > 0;
      if (load.enabled && kind === "chain") load.setLocalEulerAngles(Math.sin(this.elapsed * 2.4) * 6, 0, 0);
    }
    const live = game && game.phase !== "won" && game.phase !== "lost" && (gun === "cannon" || gun === "mortar");
    this.gunMarker.enabled = Boolean(live);
    if (live) {
      const at = gun === "mortar" ? MORTAR_PIVOT : CANNON_PIVOT;
      const pulse = 1 + Math.sin(this.elapsed * 3) * 0.04 + this.swap * 0.25;
      this.gunMarker.setPosition(at.x, 0.16, at.z + (gun === "cannon" ? 0.2 : 0));
      this.gunMarker.setLocalScale(pulse * (gun === "mortar" ? 0.85 : 1.15), 1, pulse * (gun === "mortar" ? 0.85 : 1.15));
    }
  }

  private animateAim(): void {
    const aim = this.aim;
    const game = this.game;
    const visible = Boolean(aim && game && game.canFire());
    if (!visible || !aim) {
      for (const dot of this.arcDots) dot.enabled = false;
      this.reticle.enabled = false;
      this.reticleHot.enabled = false;
      for (const ring of this.passRings) ring.enabled = false;
      this.chainSpan.enabled = false;
      return;
    }
    // Chain shot sweeps a chain's width, level and across the line of flight: shown where it
    // first cuts a rope, or else where it lands.
    const chainAt = game?.selected === "chain" ? (aim.cuts?.[0] ?? aim.hit) : undefined;
    this.chainSpan.enabled = Boolean(chainAt);
    if (chainAt) {
      const a = aim.points[0]!;
      const heading = Math.atan2(chainAt.x - a.x, chainAt.z - a.z) * DEG;
      this.chainSpan.setPosition(chainAt.x, chainAt.y, chainAt.z);
      this.chainSpan.setEulerAngles(0, heading, Math.sin(this.elapsed * 5) * 8);
    }
    const marks = [...(aim.passes ? [aim.passes.at] : []), ...(aim.cuts ?? [])];
    this.passRings.forEach((ring, index) => {
      const at = marks[index];
      ring.enabled = Boolean(at);
      if (!at) return;
      const pulse = 1 + Math.sin(this.elapsed * 7 + index) * 0.12;
      ring.setPosition(at.x, at.y, at.z);
      ring.lookAt(this.camera.getPosition());
      ring.rotateLocal(90, 0, 0);
      ring.setLocalScale(pulse, pulse, pulse);
    });
    const spacing = 0.42;
    const offset = (this.elapsed * 1.6) % spacing;
    let dotIndex = 0;
    let carried = spacing - offset;
    for (let index = 1; index < aim.points.length && dotIndex < this.arcDots.length; index += 1) {
      const a = aim.points[index - 1]!;
      const b = aim.points[index]!;
      const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      let along = carried;
      while (along < length && dotIndex < this.arcDots.length) {
        const k = along / length;
        const dot = this.arcDots[dotIndex]!;
        dot.enabled = true;
        dot.setPosition(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
        const fade = 1 - dotIndex / this.arcDots.length;
        const s = 0.07 + 0.05 * fade;
        dot.setLocalScale(s, s, s);
        dotIndex += 1;
        along += spacing;
      }
      carried = along - length;
    }
    for (let index = dotIndex; index < this.arcDots.length; index += 1) this.arcDots[index]!.enabled = false;
    const hit = aim.hit;
    this.reticle.enabled = Boolean(hit);
    if (hit) {
      const pulse = 1 + Math.sin(this.elapsed * 7) * 0.12;
      // Lie flat on whatever it strikes (a wall, the backdrop, the top of a block), just proud of it.
      const n = aim.hitNormal ?? { x: 0, y: 1, z: 0 };
      this.reticle.setPosition(hit.x + n.x * 0.04, hit.y + n.y * 0.04, hit.z + n.z * 0.04);
      this.reticle.setLocalScale(pulse, pulse, pulse);
      const q = yAxisTo(n);
      this.reticle.setRotation(q.x, q.y, q.z, q.w);
      this.reticle.rotateLocal(0, this.elapsed * 40, 0);
      const humpty = game?.humptyPosition;
      const onHumpty = aim.hitKind === "humpty";
      this.reticleHot.enabled = onHumpty;
      if (onHumpty && humpty) {
        this.reticleHot.setPosition(humpty.x, humpty.y, humpty.z);
        this.reticleHot.lookAt(this.camera.getPosition());
        this.reticleHot.rotateLocal(90, 0, 0);
        this.reticleHot.setLocalScale(pulse * 1.3, pulse * 1.3, pulse * 1.3);
      }
    } else {
      this.reticleHot.enabled = false;
    }
  }

  private animateHint(): void {
    const at = this.hintAt;
    const show = Boolean(at && this.game?.canFire());
    this.hintMarker.enabled = show;
    if (!show || !at) return;
    const pulse = 1 + Math.sin(this.elapsed * 4) * 0.15;
    this.hintMarker.setPosition(at.x, at.y, at.z);
    this.hintMarker.lookAt(this.camera.getPosition());
    this.hintMarker.rotateLocal(90, 0, 0);
    this.hintMarker.rotateLocal(0, this.elapsed * 30, 0);
    this.hintMarker.setLocalScale(pulse, pulse, pulse);
  }

  private animateRopes(): void {
    const ropes = this.game?.ropeViews ?? [];
    while (this.ropePool.length < ropes.length) {
      this.ropePool.push(this.kit.primitive("swing-rope", "cylinder", this.effects, V(), { x: 0.05, y: 1, z: 0.05 }, this.kit.material("rope", palette.rope, 0.12), pc.Vec3.ZERO, false));
    }
    this.ropePool.forEach((segment, index) => {
      const rope = ropes[index];
      if (!rope) {
        segment.enabled = false;
        return;
      }
      placeSegment(segment, V(rope.bottom.x, rope.bottom.y, rope.bottom.z), V(rope.top.x, rope.top.y, rope.top.z), 0.055);
    });
  }

  private animateRat(): void {
    const rat = this.game?.ratView;
    if (!rat) return;
    const visual = this.visuals.get(rat.id);
    const rig = visual?.rat;
    if (!rig) return;
    const scurry = rat.stride * 7;
    rig.legs.forEach((leg, index) => leg.setLocalEulerAngles(Math.sin(scurry + (index % 2 ? Math.PI : 0) + (index > 1 ? 0.8 : 0)) * 40, 0, 0));
    rig.tail.forEach((joint, index) => joint.setLocalEulerAngles(-8, Math.sin(this.elapsed * 6 + index * 0.8) * 18, 0));
    rig.head.setLocalEulerAngles(rat.mode === "gnaw" ? Math.sin(this.elapsed * 30) * 12 + 18 : Math.sin(scurry * 0.5) * 5, 0, 0);
    rig.body.setLocalEulerAngles(0, 0, rat.flip * 180);
    rig.body.setLocalPosition(0, rat.flip * 0.75 + (rat.mode === "creep" ? Math.abs(Math.sin(scurry)) * 0.05 : 0), 0);
    rig.bag.enabled = rat.carrying;
  }

  private animateBlunderbuss(dt: number): void {
    const game = this.game;
    const show = Boolean(game && (game.vermin || game.selected === "blunderbuss" || this.blunderRecoil > 0));
    this.blunderbuss.enabled = show;
    if (!show) return;
    this.blunderRecoil = Math.max(0, this.blunderRecoil - dt * 3);
    const aim = game?.selected === "blunderbuss" ? this.aim : undefined;
    if (aim) {
      const v = aim.velocity;
      this.blunderbuss.setEulerAngles((Math.atan2(v.y, Math.hypot(v.x, v.z)) * 180) / Math.PI, (Math.atan2(-v.x, -v.z) * 180) / Math.PI, 0);
    }
    const kick = Math.sin(Math.min(1, this.blunderRecoil) * Math.PI) * this.blunderRecoil * 0.25;
    this.blunderbuss.setPosition(QUEEN_GUN.x, QUEEN_GUN.y + kick * 0.3, QUEEN_GUN.z + kick);
  }

  private animateHoist(): void {
    const game = this.game;
    const rig = this.humpty;
    const hoisting = Boolean(game?.hoisting && rig);
    this.rope.enabled = hoisting;
    this.hook.enabled = hoisting;
    if (!hoisting || !rig) return;
    const p = rig.root.getPosition();
    const top = V(p.x, 22, p.z);
    const grip = V(p.x, p.y + 0.95, p.z);
    placeSegment(this.rope, grip, top, 0.08);
    this.hook.setPosition(grip.x, grip.y - 0.05, grip.z);
  }

  // ------------------------------------------------------------------ effects

  private puffMaterial(color?: pc.Color): pc.StandardMaterial {
    if (color) return this.kit.material(`puff-${color.r.toFixed(2)}`, color, 0.02);
    return this.kit.material("cotton-smoke", new pc.Color(0.88, 0.87, 0.83), 0.02, 0, { emissive: new pc.Color(0.12, 0.11, 0.1) });
  }

  private readonly particlePools = new Map<string, pc.Entity[]>();

  /** A smoke puff, spark or scrap of confetti: from its pool if one is free, made new if not. */
  private particle(shape: "sphere" | "box", material: pc.StandardMaterial, position: pc.Vec3, scale: { x: number; y: number; z: number }, euler: pc.Vec3 = pc.Vec3.ZERO): { entity: pc.Entity; pool: string } {
    const pool = `${shape}:${material.name}`;
    const free = this.particlePools.get(pool)?.pop();
    if (free) {
      free.enabled = true;
      free.setLocalPosition(position);
      free.setLocalScale(scale.x, scale.y, scale.z);
      free.setLocalEulerAngles(euler);
      return { entity: free, pool };
    }
    return { entity: this.kit.primitive("particle", shape, this.effects, position, scale, material, euler, false), pool };
  }

  /** A particle has faded: back to its pool (or away, if it wasn't pooled). */
  private retire(puff: Puff): void {
    if (!puff.pool) {
      puff.entity.destroy();
      return;
    }
    puff.entity.enabled = false;
    const pool = this.particlePools.get(puff.pool) ?? [];
    if (pool.length < 240) pool.push(puff.entity);
    else puff.entity.destroy();
    this.particlePools.set(puff.pool, pool);
  }

  private puff(position: pc.Vec3, velocity: pc.Vec3, size: number, life: number, gravity = 0, color?: pc.Color): void {
    if (this.puffs.length > 180) return;
    const { entity, pool } = this.particle("sphere", this.puffMaterial(color), position, { x: 0.01, y: 0.01, z: 0.01 });
    this.puffs.push({ entity, pool, velocity, age: 0, life, size, grow: 1, gravity, spin: (Math.random() - 0.5) * 90 });
  }

  private spark(position: pc.Vec3, velocity: pc.Vec3, color: pc.Color = palette.flash, size = 0.1, life = 0.7 + Math.random() * 0.4, gravity = 12): void {
    if (this.puffs.length > 180) return;
    const material = this.kit.material(`spark-${color.r.toFixed(2)}-${color.g.toFixed(2)}`, color, 0.3, 0, { emissive: new pc.Color(color.r * 0.8, color.g * 0.6, color.b * 0.3) });
    const { entity, pool } = this.particle("box", material, position, { x: size * 0.8, y: size * 0.8, z: size * 0.8 });
    this.puffs.push({ entity, pool, velocity, age: 0, life, size, grow: 0, gravity, spin: 400 });
  }

  /** The flies let loose a shower of paper confetti over the wreckage. */
  private confetti(at: Vec3): void {
    const colours = [palette.king, palette.gold, palette.queen, palette.cream, new pc.Color(0.25, 0.4, 0.8)];
    for (let index = 0; index < 70; index += 1) {
      const colour = colours[index % colours.length]!;
      const material = this.kit.material(`confetti-${index % colours.length}`, colour, 0.4, 0, { emissive: new pc.Color(colour.r * 0.25, colour.g * 0.25, colour.b * 0.25), doubleSided: true });
      const { entity, pool } = this.particle("box", material, V(at.x + (Math.random() - 0.5) * 10, 10 + Math.random() * 4, at.z + (Math.random() - 0.5) * 6), { x: 0.16, y: 0.02, z: 0.1 }, V(Math.random() * 360, Math.random() * 360, 0));
      this.puffs.push({ entity, pool, velocity: V((Math.random() - 0.5) * 1.2, -0.6 - Math.random(), (Math.random() - 0.5) * 1.2), age: 0, life: 3.5 + Math.random() * 1.5, size: 1, grow: 0, gravity: 1.2, spin: 200 + Math.random() * 300, shape: V(0.16, 0.02, 0.1) });
    }
  }

  private fizzTimer = 0;
  private bedBounceAt = -10;
  private readonly risingStars: RisingStar[] = [];
  private trapRing: { root: pc.Entity; leaves: pc.Entity[]; pit: pc.Entity } | undefined;
  private readonly chutes: pc.Entity[] = [];
  /** The Grand Finale: the Queen marches to centre stage and plants her flag. */
  private finale: { age: number; to: pc.Vec3; nextBurst: number; showered: boolean } | undefined;
  private readonly queenFlag: pc.Entity;
  private readonly queenFlagCloth: pc.Entity;
  /** A warm glow that goes up with a released star. */
  private readonly starLight: pc.Entity;
  private starLightAge = 0;
  private nextGlint = 6;
  private windPuffAt = 0;

  /** Lit bombs spit sparks from their fuses and swell as the fuse runs out. */
  private animateBombs(dt: number): void {
    this.fizzTimer += dt;
    const emit = this.fizzTimer > 0.05;
    if (emit) this.fizzTimer = 0;
    for (const visual of this.visuals.values()) {
      // A barrel off its chock fizzes at one end as it rolls.
      if (visual.view.kind === "keg" && visual.view.fuse !== undefined) {
        if (!emit) continue;
        const end = visual.root.getPosition().clone().add(visual.root.up.clone().mulScalar(0.42));
        this.spark(end, V((Math.random() - 0.5) * 2, 1.5 + Math.random() * 1.5, (Math.random() - 0.5) * 2), palette.gold);
        continue;
      }
      if (visual.view.kind !== "bomb") continue;
      const left = visual.view.fuse ?? 3;
      const swell = left < 0.8 ? 1 + Math.abs(Math.sin(this.elapsed * 30)) * (0.8 - left) * 0.35 : 1;
      visual.root.setLocalScale(swell, swell, swell);
      if (!emit) continue;
      const top = visual.root.getPosition().clone();
      const up = visual.root.up.clone().mulScalar(0.36);
      top.add(up);
      this.spark(top, V((Math.random() - 0.5) * 2, 1.5 + Math.random() * 1.5, (Math.random() - 0.5) * 2), palette.gold);
    }
  }

  /** The trapdoor leaves swing down as the King's men drop, and up again behind them. */
  private animateTrap(): void {
    const ring = this.trapRing;
    const trap = this.game?.trapView;
    if (!ring || !trap) return;
    const pit = trap.open > 0.02 ? 1 : 0.001;
    ring.pit.setLocalScale(pit, pit, pit);
    for (const leaf of ring.leaves) leaf.setLocalEulerAngles(-trap.open * 92, 0, 0);
  }

  /** A five-pointed gold star, bright enough to see across the stage. */
  private buildStar(parent: pc.Entity): pc.Entity {
    const root = this.kit.group("hidden-star", parent);
    const gold = this.kit.material("star-gold", palette.gold, 0.9, 0.4, { emissive: new pc.Color(0.95, 0.7, 0.15) });
    for (let point = 0; point < 5; point += 1) {
      const arm = this.kit.group("star-arm", root, V(), V(0, 0, point * 72));
      this.kit.primitive("star-point", "cone", arm, V(0, 0.32, 0), { x: 0.3, y: 0.52, z: 0.12 }, gold, pc.Vec3.ZERO, false);
    }
    this.kit.primitive("star-heart", "cylinder", root, V(), { x: 0.36, y: 0.12, z: 0.36 }, gold, V(90, 0, 0), false);
    return root;
  }

  private releaseStar(at: Vec3): void {
    const root = this.buildStar(this.effects);
    root.setPosition(at.x, at.y, at.z);
    root.setLocalScale(0.01, 0.01, 0.01);
    this.risingStars.push({ root, from: V(at.x, at.y, at.z), age: 0, trail: 0 });
    this.flash(at, 2.2);
    this.shockwave(at);
    this.starLight.setPosition(at.x, at.y + 0.5, at.z);
    this.starLight.enabled = true;
    this.starLightAge = 0;
    for (let index = 0; index < 28; index += 1) {
      const angle = (index / 28) * Math.PI * 2;
      this.spark(V(at.x, at.y, at.z), V(Math.cos(angle) * 5, 2 + Math.random() * 4, Math.sin(angle) * 5), palette.gold);
    }
  }

  /** Where the newest released star is on screen, so the HUD can catch it. */
  risingStarPoint(): ScreenPoint | undefined {
    const star = this.risingStars[this.risingStars.length - 1];
    return star ? this.project(star.root.getPosition()) : undefined;
  }

  /** Released stars rise, spinning and twinkling, and leave the stage. The hidden one glints now and then. */
  private animateStars(dt: number): void {
    for (let index = this.risingStars.length - 1; index >= 0; index -= 1) {
      const star = this.risingStars[index]!;
      star.age += dt;
      const k = star.age / STAR_RISE;
      if (k >= 1) {
        star.root.destroy();
        this.risingStars.splice(index, 1);
        continue;
      }
      // Out it bursts, overshooting, then rises spinning with a trail of sparks; the HUD catches it.
      const lift = 3.4 * (1 - Math.pow(1 - Math.min(1, k * 1.4), 3));
      star.root.setPosition(star.from.x + Math.sin(star.age * 4) * 0.25, star.from.y + 0.4 + lift, star.from.z);
      star.root.lookAt(this.camera.getPosition());
      star.root.rotateLocal(0, 0, star.age * 300);
      const grow = k < 0.18 ? Math.sin((k / 0.18) * Math.PI * 0.5) * 1.25 : 1 + Math.sin(star.age * 16) * 0.08;
      const fade = k > 0.85 ? 1 - (k - 0.85) / 0.15 : 1;
      const size = 2.6 * grow * fade;
      star.root.setLocalScale(size, size, size);
      // About sixty sparks a second, short-lived, and never crowding out a blast or the crack.
      star.trail += dt * 60;
      const p = star.root.getPosition();
      for (; star.trail >= 1; star.trail -= 1) {
        if (this.puffs.length > 120) continue;
        this.spark(V(p.x + (Math.random() - 0.5) * 1.2, p.y + (Math.random() - 0.5) * 0.6, p.z + (Math.random() - 0.5) * 1.2), V((Math.random() - 0.5) * 2.5, -1.5 - Math.random() * 2, (Math.random() - 0.5) * 2.5), palette.gold, 0.1, 0.35 + Math.random() * 0.25);
      }
    }
    // The star's glow fades as it leaves.
    if (this.starLight.enabled) {
      this.starLightAge += dt;
      const star = this.risingStars[this.risingStars.length - 1];
      if (star) this.starLight.setPosition(star.root.getPosition());
      this.starLight.light!.intensity = Math.max(0, 3.2 * (1 - this.starLightAge / (STAR_RISE + 0.2)));
      if (this.starLightAge > STAR_RISE + 0.2) this.starLight.enabled = false;
    }
    // Wherever the star is hiding, a glint now and then: a clue, not a signpost.
    const game = this.game;
    if (game && this.elapsed > this.nextGlint) {
      this.nextGlint = this.elapsed + 9 + Math.random() * 5;
      const at = game.starAt;
      if (at && !game.cracked) {
        for (let index = 0; index < 4; index += 1) {
          this.spark(V(at.x + (Math.random() - 0.5) * 0.4, at.y + 0.2, at.z), V((Math.random() - 0.5) * 1.2, 1 + Math.random(), (Math.random() - 0.5) * 1.2), palette.gold);
        }
      }
    }
    // The wind machine's gale: streaks blown across the stage.
    if (game?.windy && this.elapsed > this.windPuffAt) {
      this.windPuffAt = this.elapsed + 0.08;
      this.puff(V(-12 + Math.random() * 4, 1 + Math.random() * 6, -6 + Math.random() * 8), V(9 + Math.random() * 4, 0, 0), 0.18, 1.6, 0, palette.cream);
    }
  }

  /** Rings of gold spreading from a struck gong. */
  private shockwave(at: Vec3): void {
    const material = this.kit.material("shimmer", palette.gold, 0.4, 0, { emissive: new pc.Color(0.6, 0.4, 0.05) });
    for (let index = 0; index < 3; index += 1) {
      const entity = this.kit.group("shimmer", this.effects, V(at.x, at.y, at.z));
      this.kit.meshEntity("shimmer-ring", this.kit.torus(0.5, 0.03, 32, 5), material, this.kit.group("shimmer-tilt", entity, V(), V(90, 0, 0)), false);
      entity.lookAt(this.camera.getPosition());
      this.puffs.push({ entity, velocity: V(), age: -index * 0.18, life: 0.9, size: 2.4 + index * 0.6, grow: 0, gravity: 0, spin: 0, ring: true });
    }
  }

  private flash(at: Vec3, size: number): void {
    const material = this.kit.material("blast", palette.flash, 0.3, 0, { emissive: new pc.Color(1, 0.55, 0.12) });
    const { entity, pool } = this.particle("sphere", material, V(at.x, at.y, at.z), { x: 0.1, y: 0.1, z: 0.1 });
    this.puffs.push({ entity, pool, velocity: V(), age: 0, life: 0.22, size, grow: 1, gravity: 0, spin: 0 });
  }

  private splat(at: Vec3): void {
    const root = this.kit.group("yolk-splat", this.effects, V(at.x, 0.015, at.z));
    this.kit.primitive("white", "cylinder", root, V(0.1, 0, 0.05), { x: 2.3, y: 0.02, z: 1.9 }, this.kit.material("albumen", new pc.Color(0.95, 0.93, 0.85), 0.8), V(0, 23, 0), false);
    this.kit.primitive("yolk", "sphere", root, V(-0.1, 0.04, 0), { x: 0.9, y: 0.18, z: 0.85 }, this.kit.material("yolk", palette.yolk, 0.85), pc.Vec3.ZERO, false);
    for (let index = 0; index < 6; index += 1) {
      const angle = (index / 6) * Math.PI * 2 + 0.4;
      this.kit.primitive("droplet", "cylinder", root, V(Math.cos(angle) * 1.5, 0, Math.sin(angle) * 1.3), { x: 0.3, y: 0.02, z: 0.24 }, this.kit.material("albumen", new pc.Color(0.95, 0.93, 0.85), 0.8), pc.Vec3.ZERO, false);
    }
    root.setLocalScale(0.01, 1, 0.01);
    this.splats.push({ root, age: 0 });
  }

  /** The struck skep swings on its rope; the swarm buzzes about wherever the bees have got to. */
  private animateBees(dt: number): void {
    // (And the capstan, which the stagehands heave round while the revolve turns.)
    if (this.game?.revolving) this.capstanTurn += dt * 70;
    for (const visual of this.visuals.values()) visual.capstan?.setLocalEulerAngles(0, this.capstanTurn, 0);
    const since = this.elapsed - this.hiveStruckAt;
    for (const visual of this.visuals.values()) {
      if (!visual.skep) continue;
      const swing = since < 4 ? Math.sin(since * 11) * 22 * Math.exp(-since * 1.2) : 0;
      visual.skep.setLocalEulerAngles(swing, 0, swing * 0.6);
    }
    const swarm = this.game?.swarmView;
    this.swarm.enabled = Boolean(swarm);
    if (!swarm) return;
    const t = this.elapsed;
    // A loose, lazy cloud on the way home; a tight, angry one on the chase.
    const size = swarm.home ? 0.7 : 1;
    this.swarm.setPosition(swarm.at.x + Math.sin(t * 5.3) * 0.18, swarm.at.y + Math.sin(t * 7.1) * 0.14, swarm.at.z + Math.cos(t * 4.7) * 0.18);
    this.swarm.setLocalScale(size, size * (0.9 + Math.sin(t * 13) * 0.1), size);
    const [inner, outer] = this.swarm.children as pc.Entity[];
    inner?.setLocalEulerAngles(t * 240, t * 410, 0);
    outer?.setLocalEulerAngles(0, -t * 300, t * 170);
  }

  /** Smashed china vanishes from the dresser; the dish and the spoon run off, hand in hand. */
  private animateChina(dt: number): void {
    if (this.chinaDirty && this.game) {
      this.chinaDirty = false;
      const whole = this.game.chinaView;
      for (const visual of this.visuals.values()) {
        // Shrunk away rather than disabled: switching a batched mesh off rebuilds the whole batch.
        visual.china?.forEach((piece, index) => {
          if (whole[index]?.whole === false) piece.setLocalScale(0.001, 0.001, 0.001);
        });
      }
    }
    const run = this.runaways;
    if (!run) return;
    run.age += dt;
    const t = run.age;
    // A hop down off the dresser toward the footlights, then away into the wings at a scamper.
    const hop = Math.min(1, t / 0.7);
    const floor = V(run.from.x + run.toward * 0.6, 0, run.from.z + 1.4);
    const x = floor.x + run.toward * Math.max(0, t - 0.7) * 3.6;
    const bob = t < 0.7 ? 0 : Math.abs(Math.sin((t - 0.7) * 14)) * 0.12;
    const y = t < 0.7 ? run.from.y * (1 - hop) + Math.sin(hop * Math.PI) * 0.6 : bob;
    run.root.setPosition(t < 0.7 ? run.from.x + (floor.x - run.from.x) * hop : x, y, t < 0.7 ? run.from.z + (floor.z - run.from.z) * hop : floor.z);
    // Turned only a little toward the wings, so the house still sees their faces.
    run.root.setLocalEulerAngles(0, t < 0.7 ? 0 : run.toward * 22, Math.sin(t * 14) * 6);
    run.legs.forEach((leg, index) => leg.setLocalEulerAngles(t < 0.7 ? 0 : Math.sin(t * 14 + (index % 2) * Math.PI) * 35, 0, 0));
    if (Math.abs(x) > 16 || t > 6) {
      run.root.destroy();
      this.runaways = undefined;
    }
  }

  private animateEffects(dt: number): void {
    for (let index = this.puffs.length - 1; index >= 0; index -= 1) {
      const puff = this.puffs[index]!;
      puff.age += dt;
      const k = puff.age / puff.life;
      if (k >= 1) {
        this.retire(puff);
        this.puffs.splice(index, 1);
        continue;
      }
      puff.velocity.y -= puff.gravity * dt;
      puff.velocity.mulScalar(puff.gravity > 0 ? 1 : Math.pow(0.12, dt));
      if (puff.gravity === 0) puff.velocity.y += dt * 0.8;
      const p = puff.entity.getPosition();
      puff.entity.setPosition(p.x + puff.velocity.x * dt, Math.max(0.03, p.y + puff.velocity.y * dt), p.z + puff.velocity.z * dt);
      if (puff.ring) {
        // Staggered rings wait their turn with a negative age.
        puff.entity.enabled = k >= 0;
        const s = puff.size * (0.25 + Math.max(0, k) * 0.75);
        puff.entity.setLocalScale(s, s, Math.max(0.01, s * (1 - k)));
      } else if (puff.grow > 0) {
        const bloom = 1 - Math.pow(1 - Math.min(1, k * 3), 3);
        const s = puff.size * bloom * (1 - Math.pow(k, 4));
        puff.entity.setLocalScale(Math.max(0.01, s), Math.max(0.01, s * 0.9), Math.max(0.01, s));
      } else if (puff.shape) {
        const fade = k < 0.8 ? 1 : (1 - k) / 0.2;
        puff.entity.setLocalScale(puff.shape.x * fade, puff.shape.y * fade, puff.shape.z * fade);
      } else {
        const s = puff.size * (1 - k);
        puff.entity.setLocalScale(s, s, s);
      }
      if (puff.spin) puff.entity.rotateLocal(puff.spin * dt, puff.spin * dt * 0.7, 0);
    }
    for (const splat of this.splats) {
      splat.age += dt;
      const k = Math.min(1, splat.age / 0.35);
      const s = 1 - Math.pow(1 - k, 3);
      splat.root.setLocalScale(s, 1, s);
    }
  }

  private animateScenery(): void {
    const t = this.elapsed;
    this.stage.footlights.forEach((flame, index) => {
      const flicker = 1 + Math.sin(t * 11 + index * 1.7) * 0.08 + Math.sin(t * 23 + index) * 0.05;
      flame.setLocalScale(0.13 * flicker, 0.16 * flicker, 0.13 * flicker);
    });
    this.stage.clouds.forEach((cloud, index) => {
      const p = cloud.getLocalPosition();
      cloud.setLocalPosition(p.x + Math.sin(t * 0.1 + index) * 0.002, p.y, p.z);
    });
    const gale = this.game?.windy ? 1 : 0;
    for (const [index, pennant] of this.stage.pennants.entries()) {
      // In the wind machine's gale the pennants stream out and snap.
      pennant.setLocalEulerAngles(0, gale ? -8 + Math.sin(t * 14 + index) * 10 : Math.sin(t * 1.3 + index) * 18, Math.sin(t * (gale ? 11 : 2.1) + index) * (gale ? 9 : 4));
    }
  }

  /** The theatre never moves (bar a few flickering flames), so merge it into static batches. */
  private batchScenery(): void {
    const group = this.app.batcher.addGroup("scenery", false, 200);
    const animated = new Set<pc.Entity>([...this.stage.footlights, ...this.stage.clouds, ...this.stage.pennants, this.stage.moon]);
    const visit = (node: pc.GraphNode): void => {
      if (animated.has(node as pc.Entity)) return;
      const entity = node as pc.Entity;
      if (entity.render) entity.render.batchGroupId = group.id;
      for (const child of node.children) visit(child);
    };
    visit(this.stage.root);
  }

  // ------------------------------------------------------------------ camera & lights

  private createCamera(): pc.Entity {
    const camera = new pc.Entity("camera");
    camera.addComponent("camera", {
      clearColor: palette.sky,
      nearClip: 0.1,
      farClip: 120,
      fov: 40,
    });
    this.app.root.addChild(camera);
    return camera;
  }

  private createLights(): void {
    const key = new pc.Entity("key");
    key.setEulerAngles(48, -30, 0);
    key.addComponent("light", {
      type: "directional",
      color: new pc.Color(1, 0.84, 0.62),
      intensity: 1.8,
      castShadows: true,
      shadowDistance: 44,
      shadowResolution: matchMedia("(pointer: coarse)").matches ? 1024 : 2048,
      shadowBias: 0.2,
      normalOffsetBias: 0.04,
    });
    this.app.root.addChild(key);
    const fill = new pc.Entity("fill");
    fill.setPosition(-9, 9, 6);
    fill.addComponent("light", { type: "omni", color: new pc.Color(0.38, 0.53, 0.64), intensity: 0.75, range: 36, castShadows: false });
    this.app.root.addChild(fill);
    const foot = new pc.Entity("footlights");
    foot.setPosition(0, 1.4, 11);
    foot.addComponent("light", { type: "omni", color: new pc.Color(0.9, 0.55, 0.26), intensity: 0.7, range: 26, castShadows: false });
    this.app.root.addChild(foot);
    const rim = new pc.Entity("rim");
    rim.setPosition(4, 10, -8);
    rim.addComponent("light", { type: "omni", color: new pc.Color(0.55, 0.62, 0.85), intensity: 0.45, range: 30, castShadows: false });
    this.app.root.addChild(rim);
  }

  private updateCamera(dt: number): void {
    const game = this.game;
    const level = game?.level.view ?? { yaw: 0, pitch: -14, distance: 20, target: { x: 0, y: 2.2, z: -1 } };
    let yaw = level.yaw + this.userYaw;
    let pitch = level.pitch + this.userPitch;
    // A tall phone screen is narrow: stand further back so the whole set fits across.
    const portrait = this.host.clientWidth / Math.max(1, this.host.clientHeight) < 0.8;
    let distance = level.distance * (portrait ? 1.45 : 1) + this.userZoom;
    const target = V(level.target.x, level.target.y, level.target.z);
    if (this.cameraMode === "title") {
      yaw = Math.sin(this.elapsed * 0.12) * 16;
      pitch = -9 + Math.sin(this.elapsed * 0.09) * 3;
      distance = level.distance + 13;
      target.set(level.target.x, level.target.y + 2.4, level.target.z);
    }
    const humpty = this.humpty?.root.getPosition() ?? (game?.cracked ? this.crackAt : undefined);
    const falling = Boolean(game?.humptyAirborne) || Boolean(game?.cracked && game.phase === "won");
    this.follow += ((falling ? 1 : 0) - this.follow) * Math.min(1, dt * (falling ? 2.5 : 1.2));
    if (humpty && this.follow > 0.001) {
      target.lerp(target, V(humpty.x, Math.max(0.8, humpty.y), humpty.z), this.follow * 0.6);
      distance -= this.follow * 3;
      // Rise to look over whatever he fell behind.
      pitch += (Math.min(pitch, -34) - pitch) * this.follow;
    }
    let ease = Math.min(1, dt * 3);
    if (this.cameraMode === "finale" && this.finale) {
      // Follow her down to the egg, then circle the flag slowly.
      const subject = this.queen.root.getPosition();
      const settled = Math.min(1, Math.max(0, (this.finale.age - 4.4) / 2));
      target.set(subject.x - 0.4, 1.6 + settled * 2.6, subject.z - 0.4 - settled * 1.5);
      yaw = level.yaw + 18 + (this.finale.age > 4.6 ? (this.finale.age - 4.6) * 5 : 0);
      pitch = -14 + settled * 9;
      distance = 12 + settled * 5;
      ease = Math.min(1, dt * 1.6);
    }
    if (this.cameraMode === "replay") {
      // Down on the boards beside him, turning slowly, like a newsreel.
      const subject = humpty ?? this.crackAt;
      if (subject) target.set(subject.x, Math.max(1, subject.y), subject.z);
      yaw = level.yaw + 32 + Math.sin(this.elapsed * 0.3) * 8;
      pitch = -12;
      distance = 13;
      ease = Math.min(1, dt * 2.2);
    }
    if (this.cameraMode === "intro") {
      this.introTime += dt;
      ease = Math.min(1, dt * 1.3);
      if (this.introTime > 3.2) this.cameraMode = "play";
    }
    this.camYaw += (yaw - this.camYaw) * ease;
    this.camPitch += (pitch - this.camPitch) * ease;
    this.camDistance += (distance - this.camDistance) * ease;
    this.camTarget.lerp(this.camTarget, target, ease);
    this.shake = Math.max(0, this.shake - dt * 1.6);
    const yawRad = this.camYaw / DEG;
    const pitchRad = this.camPitch / DEG;
    const horizontal = Math.cos(pitchRad) * this.camDistance;
    const jitter = this.shake * this.shake;
    this.camera.setPosition(
      this.camTarget.x + Math.sin(yawRad) * horizontal + (Math.random() - 0.5) * jitter,
      this.camTarget.y - Math.sin(pitchRad) * this.camDistance + (Math.random() - 0.5) * jitter,
      this.camTarget.z + Math.cos(yawRad) * horizontal,
    );
    this.camera.lookAt(this.camTarget);
    const aspect = this.host.clientWidth / Math.max(1, this.host.clientHeight);
    this.camera.camera!.fov = aspect < 0.8 ? 56 : aspect < 1.2 ? 46 : 35;
  }

  private resize(): void {
    this.app.resizeCanvas(this.host.clientWidth, this.host.clientHeight);
  }

  destroy(): void {
    this.resizeObserver.disconnect();
    this.app.destroy();
  }
}

function placeSegment(segment: pc.Entity, start: pc.Vec3, end: pc.Vec3, thickness: number): void {
  const direction = end.clone().sub(start);
  const length = direction.length();
  if (length < 0.001) {
    segment.enabled = false;
    return;
  }
  segment.enabled = true;
  segment.setPosition(start.clone().add(end).mulScalar(0.5));
  segment.setRotation(new pc.Quat().setFromDirections(pc.Vec3.UP, direction.mulScalar(1 / length)));
  segment.setLocalScale(thickness, length, thickness);
}
