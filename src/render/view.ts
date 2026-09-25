import * as pc from "playcanvas";
import { AMMO } from "../sim/ballistics.js";
import { CANNON_PIVOT, MORTAR_PIVOT, type AimPreview, type CrewView, type Game } from "../sim/game.js";
import type { BodyView, GameEvent, Vec3 } from "../sim/types.js";
import { Kit, palette } from "./kit.js";
import {
  buildBlock,
  buildCannon,
  buildCartBed,
  buildCrown,
  buildHay,
  buildHorse,
  buildHumpty,
  buildKeg,
  buildLitterBed,
  buildMan,
  buildMortar,
  buildProjectile,
  buildQueen,
  buildShellPiece,
  type GunRig,
  type HorseRig,
  type HumptyRig,
  type ManRig,
  type QueenRig,
} from "./props.js";
import { buildStage, type StageSet } from "./stage.js";

const V = (x = 0, y = 0, z = 0): pc.Vec3 => new pc.Vec3(x, y, z);
const DEG = 180 / Math.PI;
/** The Queen stands on a podium stage-left of her battery. */
const QUEEN_SPOT = { x: -4.4, y: 0.42, z: 7.4 };

interface BodyVisual {
  view: BodyView;
  root: pc.Entity;
  man?: ManRig;
  horse?: HorseRig;
  wheels?: pc.Entity[];
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

export type CameraMode = "title" | "intro" | "play";

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
  private readonly queen: QueenRig;
  private readonly cannon: GunRig;
  private readonly mortar: GunRig;
  private readonly visuals = new Map<number, BodyVisual>();
  private readonly chains = new Map<number, pc.Entity>();
  private readonly puffs: Puff[] = [];
  private readonly splats: Splat[] = [];
  private readonly arcDots: pc.Entity[] = [];
  private readonly reticle: pc.Entity;
  private readonly reticleHot: pc.Entity;
  private readonly hintMarker: pc.Entity;
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
    this.app.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio, handheld ? 1.5 : 2);
    this.app.scene.ambientLight = new pc.Color(0.25, 0.245, 0.23);
    this.app.scene.exposure = 1.15;
    this.kit = new Kit(this.app);
    this.world = new pc.Entity("world");
    this.app.root.addChild(this.world);
    this.actors = this.kit.group("actors", this.world);
    this.effects = this.kit.group("effects", this.world);
    this.camera = this.createCamera();
    this.createLights();
    this.stage = buildStage(this.kit, this.world);
    this.batchScenery();
    this.cannon = buildCannon(this.kit, this.world);
    this.cannon.root.setLocalPosition(CANNON_PIVOT.x, 0.12, CANNON_PIVOT.z);
    this.cannon.pitch.setLocalPosition(0, CANNON_PIVOT.y - 0.12, 0);
    this.mortar = buildMortar(this.kit, this.world);
    this.mortar.root.setLocalPosition(MORTAR_PIVOT.x, 0.12, MORTAR_PIVOT.z);
    this.mortar.pitch.setLocalPosition(0, MORTAR_PIVOT.y - 0.12, 0);
    this.queen = buildQueen(this.kit, this.world);
    this.queen.root.setLocalPosition(QUEEN_SPOT.x, QUEEN_SPOT.y, QUEEN_SPOT.z);
    this.queen.root.setLocalEulerAngles(0, 150, 0);

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
    const hot = this.kit.material("aim-hot", new pc.Color(0.9, 0.1, 0.05), 0.4, 0, { emissive: new pc.Color(0.7, 0.05, 0.02) });
    this.reticleHot = this.kit.group("reticle-hot", this.effects);
    this.kit.meshEntity("reticle-ring-hot", this.kit.torus(0.62, 0.05, 28, 6), hot, this.reticleHot, false);
    this.reticleHot.enabled = false;

    const tip = this.kit.material("astrologer", new pc.Color(0.3, 0.85, 0.65), 0.4, 0, { emissive: new pc.Color(0.08, 0.45, 0.3) });
    this.hintMarker = this.kit.group("astrologer-hint", this.effects);
    this.kit.meshEntity("hint-ring", this.kit.torus(0.5, 0.05, 28, 6), tip, this.hintMarker, false);
    for (let index = 0; index < 4; index += 1) {
      this.kit.primitive("hint-tick", "box", this.hintMarker, V(Math.cos((index * Math.PI) / 2) * 0.75, 0, Math.sin((index * Math.PI) / 2) * 0.75), { x: 0.3, y: 0.05, z: 0.08 }, tip, V(0, -index * 90, 0), false);
    }
    this.hintMarker.enabled = false;

    const rope = this.kit.material("rope", palette.rope, 0.12);
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
    for (const puff of this.puffs) puff.entity.destroy();
    this.puffs.length = 0;
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
      this.shake = 0.9;
      this.queenCheer = 1;
      this.splat(event.at);
      for (let index = 0; index < 14; index += 1) {
        const angle = (index / 14) * Math.PI * 2;
        this.spark(V(event.at.x, event.at.y, event.at.z), V(Math.cos(angle) * 5, 3 + Math.random() * 3, Math.sin(angle) * 5), palette.yolk);
      }
    } else if (event.type === "caught") {
      this.queenSulk = 1;
    } else if (event.type === "bowled") {
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
    for (const [id, visual] of this.visuals) {
      const crew = crews.get(id);
      if (crew) this.animateCrew(visual, crew);
    }
  }

  frame(dt: number, realDt: number): void {
    this.elapsed += realDt;
    this.animateHumpty(dt);
    this.animateQueen(realDt);
    this.animateGuns(realDt);
    this.animateAim();
    this.animateHint();
    this.animateHoist();
    this.animateEffects(dt);
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
      default:
        break;
    }
    return visual;
  }

  private animateCrew(visual: BodyVisual, crew: CrewView): void {
    const stride = crew.stride;
    const running = crew.speed > 2;
    const cheering = crew.mode === "cheer";
    if (visual.man) {
      const man = visual.man;
      const swing = Math.sin(stride * (running ? 3.2 : 4.2)) * Math.min(1, crew.speed) * (running ? 40 : 28);
      man.leftLeg.setLocalEulerAngles(swing, 0, 0);
      man.rightLeg.setLocalEulerAngles(-swing, 0, 0);
      const gameOver = this.game?.cracked ?? false;
      if (crew.kind === "litter") {
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
      const bob = running ? Math.abs(Math.sin(stride * 3.2)) * 0.08 : cheering && !gameOver ? Math.abs(Math.sin(this.elapsed * 9)) * 0.12 : 0;
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
    rig.arms[0]!.setLocalEulerAngles(0, 0, 35 + (falling ? 70 + flail : wave) + (hoisting ? 90 : 0));
    rig.arms[1]!.setLocalEulerAngles(0, 0, -35 - (falling ? 70 - flail : -wave) - (hoisting ? 90 : 0));
    const kick = falling ? Math.sin(t * 18) * 35 : hoisting ? Math.sin(t * 8) * 25 : Math.sin(t * 1.7) * 6;
    rig.legs[0]!.setLocalEulerAngles(-70 + kick, 0, 0);
    rig.legs[1]!.setLocalEulerAngles(-70 - kick, 0, 0);
    rig.crown.setLocalEulerAngles(falling ? Math.sin(t * 25) * 12 : 0, 0, nervous ? Math.sin(t * 11) * 4 : 0);
  }

  private humptyTalk = 0;
  private queenTalk = 0;

  talk(speaker: "humpty" | "queen", seconds: number): void {
    if (speaker === "humpty") this.humptyTalk = seconds;
    else this.queenTalk = seconds;
  }

  private animateQueen(dt: number): void {
    const queen = this.queen;
    const t = this.elapsed;
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
    if (game && this.aim) {
      const spec = AMMO[game.selected];
      const v = this.aim.velocity;
      const yaw = Math.atan2(-v.x, -v.z) * DEG;
      const pitch = Math.atan2(v.y, Math.hypot(v.x, v.z)) * DEG;
      const target = spec.gun === "mortar" ? this.mortarAim : this.cannonAim;
      target.yaw += (yaw - target.yaw) * Math.min(1, dt * 10);
      target.pitch += (pitch - target.pitch) * Math.min(1, dt * 10);
    }
    const kick = (amount: number): number => Math.sin(Math.min(1, amount) * Math.PI) * amount;
    this.cannon.yaw.setLocalEulerAngles(0, this.cannonAim.yaw, 0);
    this.cannon.pitch.setLocalEulerAngles(this.cannonAim.pitch, 0, 0);
    this.cannon.recoil.setLocalPosition(0, 0, kick(this.recoil.cannon) * 0.55);
    for (const wheel of this.cannon.wheels) wheel.setLocalEulerAngles(this.recoil.cannon * 40, 0, 90);
    this.mortar.yaw.setLocalEulerAngles(0, this.mortarAim.yaw, 0);
    this.mortar.pitch.setLocalEulerAngles(this.mortarAim.pitch, 0, 0);
    this.mortar.recoil.setLocalPosition(0, -kick(this.recoil.mortar) * 0.12, kick(this.recoil.mortar) * 0.2);
  }

  private animateAim(): void {
    const aim = this.aim;
    const game = this.game;
    const visible = Boolean(aim && game && game.canFire());
    if (!visible || !aim) {
      for (const dot of this.arcDots) dot.enabled = false;
      this.reticle.enabled = false;
      this.reticleHot.enabled = false;
      return;
    }
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
      this.reticle.setPosition(hit.x, hit.y + 0.03, hit.z);
      this.reticle.setLocalScale(pulse, pulse, pulse);
      this.reticle.setEulerAngles(0, this.elapsed * 40, 0);
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

  private puff(position: pc.Vec3, velocity: pc.Vec3, size: number, life: number, gravity = 0, color?: pc.Color): void {
    if (this.puffs.length > 180) return;
    const entity = this.kit.primitive("puff", "sphere", this.effects, position, { x: 0.01, y: 0.01, z: 0.01 }, this.puffMaterial(color), pc.Vec3.ZERO, false);
    this.puffs.push({ entity, velocity, age: 0, life, size, grow: 1, gravity, spin: (Math.random() - 0.5) * 90 });
  }

  private spark(position: pc.Vec3, velocity: pc.Vec3, color: pc.Color = palette.flash): void {
    if (this.puffs.length > 180) return;
    const material = this.kit.material(`spark-${color.r.toFixed(2)}-${color.g.toFixed(2)}`, color, 0.3, 0, { emissive: new pc.Color(color.r * 0.8, color.g * 0.6, color.b * 0.3) });
    const entity = this.kit.primitive("spark", "box", this.effects, position.clone(), { x: 0.08, y: 0.08, z: 0.08 }, material, pc.Vec3.ZERO, false);
    this.puffs.push({ entity, velocity, age: 0, life: 0.7 + Math.random() * 0.4, size: 0.1, grow: 0, gravity: 12, spin: 400 });
  }

  private flash(at: Vec3, size: number): void {
    const material = this.kit.material("blast", palette.flash, 0.3, 0, { emissive: new pc.Color(1, 0.55, 0.12) });
    const entity = this.kit.primitive("flash", "sphere", this.effects, V(at.x, at.y, at.z), { x: 0.1, y: 0.1, z: 0.1 }, material, pc.Vec3.ZERO, false);
    this.puffs.push({ entity, velocity: V(), age: 0, life: 0.22, size, grow: 1, gravity: 0, spin: 0 });
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

  private animateEffects(dt: number): void {
    for (let index = this.puffs.length - 1; index >= 0; index -= 1) {
      const puff = this.puffs[index]!;
      puff.age += dt;
      const k = puff.age / puff.life;
      if (k >= 1) {
        puff.entity.destroy();
        this.puffs.splice(index, 1);
        continue;
      }
      puff.velocity.y -= puff.gravity * dt;
      puff.velocity.mulScalar(puff.gravity > 0 ? 1 : Math.pow(0.12, dt));
      if (puff.gravity === 0) puff.velocity.y += dt * 0.8;
      const p = puff.entity.getPosition();
      puff.entity.setPosition(p.x + puff.velocity.x * dt, Math.max(0.03, p.y + puff.velocity.y * dt), p.z + puff.velocity.z * dt);
      if (puff.grow > 0) {
        const bloom = 1 - Math.pow(1 - Math.min(1, k * 3), 3);
        const s = puff.size * bloom * (1 - Math.pow(k, 4));
        puff.entity.setLocalScale(Math.max(0.01, s), Math.max(0.01, s * 0.9), Math.max(0.01, s));
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
    for (const [index, pennant] of this.stage.pennants.entries()) {
      pennant.setLocalEulerAngles(0, Math.sin(t * 1.3 + index) * 18, Math.sin(t * 2.1 + index) * 4);
    }
  }

  /** The theatre never moves (bar a few flickering flames), so merge it into static batches. */
  private batchScenery(): void {
    const group = this.app.batcher.addGroup("scenery", false, 200);
    const animated = new Set<pc.Entity>([...this.stage.footlights, ...this.stage.clouds, ...this.stage.pennants]);
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
    let distance = level.distance + this.userZoom;
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
