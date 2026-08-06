import * as pc from "playcanvas";
import type {
  BattleOrderState,
  BattleState,
  CoreBodyState,
  CoreSnapshot,
  PartFamily,
  Team,
} from "../shared/core-protocol.js";

interface RenderBody {
  root: pc.Entity;
  targetPosition: pc.Vec3;
  targetRotation: pc.Quat;
  currentPosition: pc.Vec3;
  currentRotation: pc.Quat;
  dynamic: boolean;
}

interface LabDebugState {
  renderer: string;
  gameplayPhysics: "none";
  ammoBodies: 0;
  renderedBodies: number;
  maxPoseDivergence: number;
  latestTick: number;
  nonBlankPixels?: number;
}

interface WorkerVisual {
  leftArm: pc.Entity;
  rightArm: pc.Entity;
  leftLeg: pc.Entity;
  rightLeg: pc.Entity;
  phase: string;
}

interface RopeVisual {
  segments: [pc.Entity, pc.Entity];
  bodyA: string;
  bodyB: string;
  slack: number;
}

type BattleMachineVisualKind =
  | "engineers"
  | "winch"
  | "sledge"
  | "ram"
  | "trebuchet"
  | "ballista";

interface BattleMachineVisual {
  kind: BattleMachineVisualKind;
  motion: pc.Entity;
  secondary?: pc.Entity;
  wheels: pc.Entity[];
}

declare global {
  interface Window {
    __HUMPTY_LAB__?: LabDebugState & {
      snapshot?: CoreSnapshot;
      consoleErrors?: string[];
    };
  }
}

const palette = {
  sky: new pc.Color(0.055, 0.082, 0.095),
  floor: new pc.Color(0.31, 0.255, 0.18),
  floorEdge: new pc.Color(0.17, 0.13, 0.085),
  stone: new pc.Color(0.39, 0.38, 0.335),
  stoneAlt: new pc.Color(0.44, 0.415, 0.35),
  mortar: new pc.Color(0.19, 0.205, 0.195),
  oak: new pc.Color(0.49, 0.285, 0.105),
  oakLight: new pc.Color(0.68, 0.455, 0.22),
  oakDark: new pc.Color(0.265, 0.135, 0.05),
  iron: new pc.Color(0.105, 0.12, 0.12),
  bronze: new pc.Color(0.49, 0.31, 0.09),
  rope: new pc.Color(0.52, 0.39, 0.2),
  king: new pc.Color(0.62, 0.075, 0.055),
  queen: new pc.Color(0.065, 0.39, 0.31),
  gold: new pc.Color(0.94, 0.63, 0.075),
  egg: new pc.Color(0.93, 0.865, 0.69),
  ink: new pc.Color(0.035, 0.028, 0.02),
  cream: new pc.Color(0.79, 0.73, 0.59),
};

export class LabWorld {
  readonly app: pc.Application;
  readonly canvas: HTMLCanvasElement;

  private readonly host: HTMLElement;
  private readonly materials = new Map<string, pc.StandardMaterial>();
  private readonly bodies = new Map<string, RenderBody>();
  private readonly workerVisuals = new Map<string, WorkerVisual>();
  private readonly ropeVisuals = new Map<string, RopeVisual>();
  private readonly battleMachineVisuals = new Map<string, BattleMachineVisual>();
  private readonly camera: pc.Entity;
  private readonly cameraTarget = new pc.Vec3(0, 2.15, -0.2);
  private readonly resizeObserver: ResizeObserver;
  private orbitYaw = 32;
  private orbitPitch = -16;
  private orbitDistance = 23.5;
  private dragging = false;
  private pointerX = 0;
  private pointerY = 0;
  private latestTick = 0;
  private humptyFace?: pc.Entity;
  private humptyMouth?: pc.Entity;
  private humptyBrows: pc.Entity[] = [];
  private queenRig?: pc.Entity;
  private queenHead?: pc.Entity;
  private queenCrown?: pc.Entity;
  private queenScepter?: pc.Entity;
  private elapsed = 0;
  private humptySpeakingUntil = 0;
  private queenSpeakingUntil = 0;
  private battleState: BattleState | undefined;
  private impactBurst?: pc.Entity;
  private impactShards: pc.Entity[] = [];

  constructor(host: HTMLElement) {
    this.host = host;
    this.canvas = document.createElement("canvas");
    this.canvas.setAttribute("aria-label", "Three-dimensional siege battlefield");
    host.replaceChildren(this.canvas);
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
    this.app.setCanvasFillMode(pc.FILLMODE_NONE);
    this.app.setCanvasResolution(pc.RESOLUTION_AUTO);
    this.app.scene.ambientLight = new pc.Color(0.235, 0.24, 0.225);
    this.app.scene.exposure = 1.15;
    this.camera = this.createCamera();
    this.createLights();
    this.createBattleEffects();
    this.bindInput();
    this.app.on("update", (dt: number) => this.update(Math.min(dt, 0.05)));
    this.app.start();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    this.publishDebug(0);
  }

  sync(snapshot: CoreSnapshot): void {
    this.latestTick = snapshot.tick;
    this.elapsed = snapshot.elapsed;
    this.battleState = snapshot.match.battle;
    const seen = new Set<string>();
    for (const state of snapshot.bodies) {
      seen.add(state.id);
      let runtime = this.bodies.get(state.id);
      if (!runtime) {
        runtime = this.createBody(state);
        this.bodies.set(state.id, runtime);
      }
      runtime.targetPosition.set(state.position.x, state.position.y, state.position.z);
      runtime.targetRotation.set(
        state.rotation.x,
        state.rotation.y,
        state.rotation.z,
        state.rotation.w,
      );
      if (snapshot.tick === 0 || !runtime.dynamic) {
        runtime.currentPosition.copy(runtime.targetPosition);
        runtime.currentRotation.copy(runtime.targetRotation);
        runtime.root.setPosition(runtime.currentPosition);
        runtime.root.setRotation(runtime.currentRotation);
      }
    }
    for (const worker of snapshot.workers) {
      const visual = this.workerVisuals.get(worker.id);
      if (visual) visual.phase = worker.phase;
    }
    for (const [id, runtime] of this.bodies) {
      runtime.root.enabled = seen.has(id);
    }
    this.syncRopeVisuals(snapshot);
    this.updateRopeVisuals();
    this.publishDebug(this.maxDivergence());
    this.host.dataset.renderedBodies = String(this.bodies.size);
    this.host.dataset.renderedRopeSpans = String(this.ropeVisuals.size * 2);
    this.host.dataset.ammoBodies = "0";
    this.host.dataset.gameplayPhysics = "none";
    this.host.dataset.poseDivergence = this.maxDivergence().toFixed(6);
    if (window.__HUMPTY_LAB__) window.__HUMPTY_LAB__.snapshot = snapshot;
  }

  fit(): void {
    this.orbitYaw = 32;
    this.orbitPitch = -16;
    this.orbitDistance = 23.5;
    this.cameraTarget.set(0, 2.15, -0.2);
  }

  resizeToHost(): void {
    this.resize();
  }

  speak(speaker: "humpty" | "queen", durationSeconds: number): void {
    const until = performance.now() + durationSeconds * 1000;
    if (speaker === "humpty") this.humptySpeakingUntil = Math.max(this.humptySpeakingUntil, until);
    else this.queenSpeakingUntil = Math.max(this.queenSpeakingUntil, until);
  }

  destroy(): void {
    this.resizeObserver.disconnect();
    this.app.destroy();
  }

  private createBody(state: CoreBodyState): RenderBody {
    const root = new pc.Entity(state.id);
    root.setPosition(state.position.x, state.position.y, state.position.z);
    root.setRotation(
      state.rotation.x,
      state.rotation.y,
      state.rotation.z,
      state.rotation.w,
    );
    this.app.root.addChild(root);
    if (state.kind === "floor") this.createFloorVisual(root, state);
    else if (state.id === "fortress-wall") this.createWallVisual(root, state);
    else if (state.kind === "wall") root.enabled = false;
    else if (state.kind === "rack") this.createRackVisual(root, state);
    else if (state.kind === "tower-block") this.createTowerBlockVisual(root, state);
    else if (state.kind === "cradle") this.createCradleVisual(root);
    else if (state.kind === "humpty") this.createHumptyVisual(root, state);
    else if (state.kind === "part") this.createPartVisual(root, state);
    else if (state.kind === "battle-machine") this.createBattleMachineVisual(root, state);
    else if (state.kind === "battle-projectile") this.createBattleProjectileVisual(root, state);
    else if (state.kind === "queen-device") this.createQueenDeviceVisual(root, state);
    else if (state.kind === "queen-bolt") this.createQueenBoltVisual(root, state);
    else if (state.kind === "worker") this.createWorkerVisual(root, state.id, state.team ?? "king");
    const position = new pc.Vec3(state.position.x, state.position.y, state.position.z);
    const rotation = new pc.Quat(
      state.rotation.x,
      state.rotation.y,
      state.rotation.z,
      state.rotation.w,
    );
    return {
      root,
      targetPosition: position.clone(),
      targetRotation: rotation.clone(),
      currentPosition: position,
      currentRotation: rotation,
      dynamic: state.dynamic,
    };
  }

  private createCamera(): pc.Entity {
    const camera = new pc.Entity("spectator-camera");
    camera.addComponent("camera", {
      clearColor: palette.sky,
      nearClip: 0.08,
      farClip: 80,
      fov: 43,
    });
    this.app.root.addChild(camera);
    return camera;
  }

  private createLights(): void {
    const key = new pc.Entity("stage-key");
    key.setEulerAngles(45, -34, 0);
    key.addComponent("light", {
      type: "directional",
      color: new pc.Color(1, 0.82, 0.58),
      intensity: 1.75,
      castShadows: true,
      shadowDistance: 34,
      shadowResolution: 2048,
      shadowBias: 0.16,
      normalOffsetBias: 0.035,
    });
    this.app.root.addChild(key);
    const fill = new pc.Entity("cool-fill");
    fill.setPosition(-7, 8, 6);
    fill.addComponent("light", {
      type: "omni",
      color: new pc.Color(0.38, 0.53, 0.62),
      intensity: 0.7,
      range: 30,
      castShadows: false,
    });
    this.app.root.addChild(fill);
    const foot = new pc.Entity("footlights");
    foot.setPosition(0, 1.2, 7);
    foot.addComponent("light", {
      type: "omni",
      color: new pc.Color(0.76, 0.46, 0.22),
      intensity: 0.45,
      range: 22,
      castShadows: false,
    });
    this.app.root.addChild(foot);
  }

  private createFloorVisual(root: pc.Entity, state: CoreBodyState): void {
    this.primitive("stage-floor-boards", "box", root, pc.Vec3.ZERO, state.size, this.material("floor", palette.floor, .14));
    const seamMaterial = this.material("floor-seam", palette.floorEdge, .08);
    for (let x = -state.size.x / 2 + 1.02; x < state.size.x / 2; x += 1.02) {
      this.primitive(
        `floor-seam-${x.toFixed(2)}`,
        "box",
        root,
        new pc.Vec3(x, state.size.y / 2 + 0.004, 0),
        new pc.Vec3(0.018, 0.012, state.size.z - 0.04),
        seamMaterial,
        undefined,
        false,
      );
    }
    this.primitive(
      "apron",
      "box",
      root,
      new pc.Vec3(0, -0.18, state.size.z / 2 + 0.18),
      new pc.Vec3(state.size.x + 0.35, 0.42, 0.36),
      this.material("apron", palette.floorEdge, .1),
    );
  }

  private createWallVisual(root: pc.Entity, state: CoreBodyState): void {
    this.primitive("wall-mortar", "box", root, pc.Vec3.ZERO, state.size, this.material("mortar", palette.mortar, .05));
    const stoneA = this.material("stone-a", palette.stone, .07);
    const stoneB = this.material("stone-b", palette.stoneAlt, .07);
    const rows = 7;
    const blockHeight = 1.04;
    const blockWidth = 1.44;
    for (let row = 0; row < rows; row += 1) {
      const y = -state.size.y / 2 + 0.56 + row * 1.12;
      const offset = row % 2 === 0 ? 0 : blockWidth / 2;
      for (let column = -7; column <= 7; column += 1) {
        const x = column * blockWidth + offset;
        if (Math.abs(x) > state.size.x / 2 - 0.65) continue;
        this.primitive(
          `wall-stone-${row}-${column}`,
          "box",
          root,
          new pc.Vec3(x, y, state.size.z / 2 + 0.035),
          new pc.Vec3(blockWidth - 0.07, blockHeight, 0.07),
          (row + column) % 3 === 0 ? stoneB : stoneA,
          undefined,
          false,
        );
      }
    }
    for (const x of [-6.4, -3.15, 3.15, 6.4]) {
      this.primitive("wall-buttress", "box", root, new pc.Vec3(x, 0, 0.38), new pc.Vec3(0.46, 7.7, 0.55), stoneA);
      this.primitive("wall-cap", "box", root, new pc.Vec3(x, 3.62, 0.42), new pc.Vec3(0.78, 0.3, 0.66), stoneB);
    }
    this.createQueenGallery(root);
  }

  private createQueenGallery(wall: pc.Entity): void {
    const gallery = new pc.Entity("queen-gallery");
    gallery.setLocalPosition(3.6, 1.25, 0.62);
    wall.addChild(gallery);
    const timber = this.material("gallery-timber", palette.oakDark, .16);
    const iron = this.material("gallery-iron", palette.iron, .5, .65);
    this.primitive("gallery-walk", "box", gallery, pc.Vec3.ZERO, new pc.Vec3(3.1, .18, .85), timber);
    for (const x of [-1.35, -.45, .45, 1.35]) {
      this.primitive("gallery-post", "cylinder", gallery, new pc.Vec3(x, .54, .35), new pc.Vec3(.07, .94, .07), iron);
    }
    this.primitive("gallery-rail", "box", gallery, new pc.Vec3(0, .91, .35), new pc.Vec3(3, .09, .09), iron);
    const queen = new pc.Entity("queen");
    queen.setLocalPosition(0, 1.05, .12);
    queen.setLocalEulerAngles(0, 180, 0);
    queen.setLocalScale(1.22, 1.22, 1.22);
    gallery.addChild(queen);
    this.queenRig = queen;

    const velvet = this.material("queen-velvet", new pc.Color(.025, .12, .095), .16);
    const green = this.material("queen-mad-green", new pc.Color(.055, .34, .22), .2);
    const sicklyGreen = this.material("queen-sickly-green", new pc.Color(.31, .42, .095), .18);
    const paleSkin = this.material("queen-pale-skin", new pc.Color(.72, .61, .43), .18);
    const bone = this.material("queen-bone", new pc.Color(.86, .81, .63), .25);
    const black = this.material("queen-black", palette.ink, .08);
    const tarnishedGold = this.material("queen-tarnished-gold", new pc.Color(.57, .39, .08), .5, .52);

    this.primitive("queen-underskirt", "cone", queen, new pc.Vec3(0, .25, .02), new pc.Vec3(.78, .76, .64), velvet);
    this.primitive("queen-overgown", "cone", queen, new pc.Vec3(0, .48, -.03), new pc.Vec3(.64, 1.16, .56), green);
    this.primitive("queen-bodice", "box", queen, new pc.Vec3(0, .95, -.01), new pc.Vec3(.48, .52, .34), velvet, new pc.Vec3(0, 0, -3));
    this.primitive("queen-collar", "cylinder", queen, new pc.Vec3(0, 1.18, 0), new pc.Vec3(.43, .08, .43), bone);
    this.primitive("queen-ragged-cape", "box", queen, new pc.Vec3(.05, .72, .24), new pc.Vec3(.82, 1.03, .08), velvet, new pc.Vec3(-8, 0, 4));

    const head = new pc.Entity("queen-head-rig");
    head.setLocalPosition(0, 1.43, 0);
    head.setLocalEulerAngles(0, 0, -7);
    queen.addChild(head);
    this.primitive("queen-head", "sphere", head, pc.Vec3.ZERO, new pc.Vec3(.4, .46, .38), paleSkin);
    this.queenHead = head;
    for (const [x, y, scale, angle] of [
      [-.27, .1, .2, -24],
      [.27, .12, .23, 29],
      [-.18, .34, .19, -13],
      [.17, .35, .2, 18],
    ] as const) {
      this.primitive("queen-wild-hair", "sphere", head, new pc.Vec3(x, y, .02), new pc.Vec3(scale, scale * 1.35, scale), black, new pc.Vec3(0, 0, angle));
    }
    this.primitive("queen-left-eye", "sphere", head, new pc.Vec3(.12, .07, -.18), new pc.Vec3(.13, .1, .045), bone);
    this.primitive("queen-right-eye", "sphere", head, new pc.Vec3(-.13, .05, -.18), new pc.Vec3(.095, .075, .04), bone);
    this.primitive("queen-left-pupil", "sphere", head, new pc.Vec3(.09, .08, -.207), new pc.Vec3(.045, .052, .025), black);
    this.primitive("queen-right-pupil", "sphere", head, new pc.Vec3(-.16, .035, -.205), new pc.Vec3(.036, .041, .023), sicklyGreen);
    this.primitive("queen-left-brow", "box", head, new pc.Vec3(.12, .2, -.195), new pc.Vec3(.18, .035, .035), black, new pc.Vec3(0, 0, 18));
    this.primitive("queen-right-brow", "box", head, new pc.Vec3(-.13, .17, -.195), new pc.Vec3(.16, .035, .035), black, new pc.Vec3(0, 0, -23));
    this.primitive("queen-nose", "cone", head, new pc.Vec3(-.01, -.03, -.225), new pc.Vec3(.075, .18, .075), paleSkin, new pc.Vec3(-90, 0, 0));
    this.primitive("queen-crooked-mouth", "box", head, new pc.Vec3(-.035, -.18, -.2), new pc.Vec3(.23, .04, .035), black, new pc.Vec3(0, 0, -14));

    const crown = new pc.Entity("queen-crooked-crown");
    crown.setLocalPosition(-.03, .42, 0);
    crown.setLocalEulerAngles(0, 0, -17);
    head.addChild(crown);
    this.queenCrown = crown;
    this.primitive("queen-crown-band", "cylinder", crown, pc.Vec3.ZERO, new pc.Vec3(.39, .13, .39), tarnishedGold);
    for (const [index, x] of [-.28, -.14, 0, .14, .28].entries()) {
      const height = index % 2 === 0 ? .42 : .3;
      this.primitive("queen-crown-point", "cone", crown, new pc.Vec3(x, .18, 0), new pc.Vec3(.11, height, .11), tarnishedGold, new pc.Vec3(0, 0, (index - 2) * 7));
    }

    this.primitive("queen-left-sleeve", "cone", queen, new pc.Vec3(-.46, .93, .02), new pc.Vec3(.25, .65, .25), green, new pc.Vec3(0, 0, -28));
    this.primitive("queen-right-sleeve", "cone", queen, new pc.Vec3(.45, .94, .01), new pc.Vec3(.26, .7, .26), green, new pc.Vec3(0, 0, 31));
    const scepter = new pc.Entity("queen-scepter");
    scepter.setLocalPosition(.68, .93, .02);
    scepter.setLocalEulerAngles(0, 0, -9);
    queen.addChild(scepter);
    this.queenScepter = scepter;
    this.primitive("queen-scepter-shaft", "cylinder", scepter, pc.Vec3.ZERO, new pc.Vec3(.055, 1.08, .055), tarnishedGold);
    this.primitive("queen-scepter-cage", "sphere", scepter, new pc.Vec3(0, .62, 0), new pc.Vec3(.22, .24, .22), iron);
    for (const angle of [0, 90, 180, 270]) {
      this.primitive("queen-scepter-spike", "cone", scepter, new pc.Vec3(Math.cos(angle * Math.PI / 180) * .18, .62, Math.sin(angle * Math.PI / 180) * .18), new pc.Vec3(.08, .3, .08), tarnishedGold, new pc.Vec3(0, 0, angle + 90));
    }
  }

  private createRackVisual(root: pc.Entity, state: CoreBodyState): void {
    const team: Team = state.id.startsWith("king") ? "king" : "queen";
    const material = this.material("rack-oak", palette.oakDark, .16);
    this.primitive(`${state.id}-timber`, "box", root, pc.Vec3.ZERO, state.size, material);
    if (state.id.endsWith("backstop")) {
      this.primitive(
        `${state.id}-cloth`,
        "box",
        root,
        new pc.Vec3(0, .48, .1),
        new pc.Vec3(1.45, .32, .035),
        this.teamMaterial(team),
      );
    }
  }

  private createQueenDeviceVisual(root: pc.Entity, state: CoreBodyState): void {
    const dark = this.material("queen-engine-dark", palette.ink, .18);
    const green = this.material("queen-engine-green", palette.queen, .24);
    const gold = this.material("queen-engine-gold", palette.gold, .62, .5);
    const iron = this.material("queen-engine-iron", palette.iron, .58, .7);
    this.primitive("command-post-base", "cylinder", root, new pc.Vec3(0, -.58, 0), new pc.Vec3(.94, .16, .94), dark);
    this.primitive("command-post-body", "box", root, new pc.Vec3(0, -.08, 0), new pc.Vec3(.62, 1.02, .62), green);
    this.primitive("command-post-collar", "cylinder", root, new pc.Vec3(0, .38, 0), new pc.Vec3(.76, .12, .76), iron);
    this.primitive("command-post-crown", "cylinder", root, new pc.Vec3(0, .61, 0), new pc.Vec3(.52, .13, .52), gold);
    for (let index = 0; index < 5; index += 1) {
      const angle = index / 5 * Math.PI * 2;
      this.primitive(
        "command-post-point",
        "cone",
        root,
        new pc.Vec3(Math.cos(angle) * .22, .82, Math.sin(angle) * .22),
        new pc.Vec3(.1, .38, .1),
        gold,
        new pc.Vec3(0, 0, index * 9 - 18),
      );
    }
    this.primitive("command-post-eye", "sphere", root, new pc.Vec3(0, .08, -.34), new pc.Vec3(.13, .13, .045), gold);
    this.teamWrap(root, "queen", new pc.Vec3(.72, .05, .72), new pc.Vec3(0, -.42, 0));
    void state;
  }

  private createQueenBoltVisual(root: pc.Entity, state: CoreBodyState): void {
    const gold = this.material("queen-bolt-gold", palette.gold, .7, .58);
    const iron = this.material("queen-bolt-iron", palette.iron, .55, .72);
    this.primitive("crown-bolt-core", "sphere", root, pc.Vec3.ZERO, new pc.Vec3(.28, .28, .28), iron);
    this.primitive("crown-bolt-cap", "cylinder", root, new pc.Vec3(0, .04, 0), new pc.Vec3(.2, .06, .2), gold);
    this.primitive("crown-bolt-tip", "cone", root, new pc.Vec3(0, .17, 0), new pc.Vec3(.11, .25, .11), gold);
    void state;
  }

  private createBattleMachineVisual(root: pc.Entity, state: CoreBodyState): void {
    const timber = this.material("battle-machine-timber", palette.oak, .2);
    const lightTimber = this.material("battle-machine-light-timber", palette.oakLight, .16);
    const dark = this.material("battle-machine-dark", palette.oakDark, .16);
    const iron = this.material("battle-machine-iron", palette.iron, .58, .72);
    const bronze = this.material("battle-machine-bronze", palette.bronze, .66, .58);
    const rope = this.material("battle-machine-rope", palette.rope, .12);
    const padding = this.material("rescue-padding", new pc.Color(.84, .74, .48), .08);
    const red = this.material("battle-red", new pc.Color(.78, .065, .045), .22);
    const green = this.material("battle-green", new pc.Color(.035, .49, .29), .22);
    const gold = this.material("battle-gold", palette.gold, .52, .32);
    const team = state.team ?? "king";
    const variant = state.variant ?? "";
    const wheels: pc.Entity[] = [];
    const wheel = (name: string, position: pc.Vec3, radius = .38): pc.Entity => {
      const visual = this.primitive(name, "cylinder", root, position, new pc.Vec3(radius, .18, radius), iron, new pc.Vec3(90, 0, 0));
      wheels.push(visual);
      return visual;
    };
    if (variant.includes("field engineer wagon")) {
      this.primitive("engineer-chassis", "box", root, new pc.Vec3(0, -.2, 0), new pc.Vec3(2.05, .32, 1.26), dark);
      this.primitive("engineer-armored-chest", "box", root, new pc.Vec3(-.32, .22, 0), new pc.Vec3(.92, .68, 1), timber);
      this.primitive("engineer-shield", "box", root, new pc.Vec3(-.86, .22, 0), new pc.Vec3(.08, .75, .86), red);
      this.primitive("engineer-anvil", "box", root, new pc.Vec3(.52, .32, 0), new pc.Vec3(.58, .18, .34), iron);
      this.primitive("engineer-anvil-foot", "box", root, new pc.Vec3(.52, .02, 0), new pc.Vec3(.2, .46, .2), iron);
      const hammer = new pc.Entity("engineer-hammer-rig");
      hammer.setLocalPosition(.62, .64, 0);
      root.addChild(hammer);
      this.primitive("engineer-hammer-handle", "cylinder", hammer, new pc.Vec3(0, .24, 0), new pc.Vec3(.055, .58, .055), lightTimber, new pc.Vec3(0, 0, 22));
      this.primitive("engineer-hammer-head", "box", hammer, new pc.Vec3(-.1, .53, 0), new pc.Vec3(.42, .16, .18), iron, new pc.Vec3(0, 0, 22));
      for (const x of [-.76, .76]) for (const z of [-.56, .56]) wheel("engineer-wheel", new pc.Vec3(x, -.42, z), .35);
      this.primitive("engineer-standard", "box", root, new pc.Vec3(-.05, .95, -.48), new pc.Vec3(.68, .5, .05), red);
      this.primitive("engineer-standard-mark", "box", root, new pc.Vec3(-.05, .95, -.515), new pc.Vec3(.36, .08, .02), gold, undefined, false);
      this.battleMachineVisuals.set(state.id, { kind: "engineers", motion: hammer, wheels });
      return;
    }
    if (variant.includes("rescue winch")) {
      this.primitive("winch-sled-base", "box", root, new pc.Vec3(0, -.6, 0), new pc.Vec3(1.7, .22, 1.5), dark);
      for (const x of [-.58, .58]) this.primitive("winch-upright", "box", root, new pc.Vec3(x, .12, 0), new pc.Vec3(.18, 1.48, .22), timber, new pc.Vec3(0, 0, x * -8));
      this.primitive("winch-crossbeam", "box", root, new pc.Vec3(0, .8, 0), new pc.Vec3(1.52, .18, .24), lightTimber);
      const drumRig = new pc.Entity("winch-drum-rig");
      drumRig.setLocalPosition(0, -.26, 0);
      root.addChild(drumRig);
      this.primitive("winch-drum", "cylinder", drumRig, pc.Vec3.ZERO, new pc.Vec3(.5, .82, .5), timber, new pc.Vec3(90, 0, 0));
      for (const z of [-.38, .38]) this.primitive("winch-drum-collar", "cylinder", drumRig, new pc.Vec3(0, 0, z), new pc.Vec3(.59, .09, .59), bronze, new pc.Vec3(90, 0, 0));
      const crankRig = new pc.Entity("winch-crank-rig");
      crankRig.setLocalPosition(.58, -.26, .46);
      root.addChild(crankRig);
      this.primitive("winch-crank", "box", crankRig, new pc.Vec3(.16, 0, 0), new pc.Vec3(.72, .09, .09), iron);
      this.primitive("winch-crank-grip", "cylinder", crankRig, new pc.Vec3(.52, .12, 0), new pc.Vec3(.08, .28, .08), lightTimber);
      this.primitive("winch-sheave", "cylinder", root, new pc.Vec3(0, .82, -.18), new pc.Vec3(.4, .13, .4), bronze, new pc.Vec3(90, 0, 0));
      this.primitive("winch-line", "cylinder", root, new pc.Vec3(0, .12, -.23), new pc.Vec3(.045, 1.34, .045), rope);
      this.primitive("winch-rescue-mark", "box", root, new pc.Vec3(0, .38, .73), new pc.Vec3(.86, .36, .05), red);
      this.primitive("winch-rescue-cross-a", "box", root, new pc.Vec3(0, .38, .765), new pc.Vec3(.48, .09, .02), padding, undefined, false);
      this.primitive("winch-rescue-cross-b", "box", root, new pc.Vec3(0, .38, .765), new pc.Vec3(.09, .48, .02), padding, undefined, false);
      this.battleMachineVisuals.set(state.id, { kind: "winch", motion: drumRig, secondary: crankRig, wheels });
      return;
    }
    if (variant.includes("catch sledge")) {
      this.primitive("sledge-frame", "box", root, new pc.Vec3(0, -.08, 0), new pc.Vec3(state.size.x * .96, .2, state.size.z * .96), dark);
      const net = new pc.Entity("catch-net-rig");
      net.setLocalPosition(0, .18, 0);
      root.addChild(net);
      this.primitive("sledge-bed", "box", net, pc.Vec3.ZERO, new pc.Vec3(state.size.x * .9, .11, state.size.z * .88), padding);
      for (let x = -1.7; x <= 1.7; x += .56) this.primitive("catch-net-rope", "box", net, new pc.Vec3(x, .075, 0), new pc.Vec3(.028, .018, 1.82), rope, undefined, false);
      for (let z = -.72; z <= .72; z += .36) this.primitive("catch-net-rope", "box", net, new pc.Vec3(0, .08, z), new pc.Vec3(3.85, .018, .028), rope, undefined, false);
      for (const x of [-state.size.x * .4, state.size.x * .4]) {
        for (const z of [-state.size.z * .47, state.size.z * .47]) {
          wheel("sledge-wheel", new pc.Vec3(x, -.2, z), .34);
        }
      }
      for (const x of [-state.size.x * .45, state.size.x * .45]) {
        this.primitive("sledge-ramp", "box", root, new pc.Vec3(x, .16, 0), new pc.Vec3(.3, .12, state.size.z * .9), timber, new pc.Vec3(0, 0, x * -4));
      }
      this.primitive("sledge-red-rail", "box", root, new pc.Vec3(0, .34, -state.size.z * .42), new pc.Vec3(state.size.x * .92, .12, .12), red);
      this.battleMachineVisuals.set(state.id, { kind: "sledge", motion: net, wheels });
      return;
    }
    if (variant.includes("battering ram")) {
      this.primitive("ram-chassis", "box", root, new pc.Vec3(.15, -.12, 0), new pc.Vec3(2.9, .34, 1.42), dark);
      for (const x of [-.72, .72]) this.primitive("ram-tower", "box", root, new pc.Vec3(x, .62, 0), new pc.Vec3(.18, 1.34, 1.12), lightTimber);
      this.primitive("ram-canopy", "box", root, new pc.Vec3(0, 1.23, 0), new pc.Vec3(2.15, .18, 1.55), green, new pc.Vec3(0, 0, -3));
      for (const z of [-.62, .62]) this.primitive("ram-suspension", "cylinder", root, new pc.Vec3(-.08, .72, z), new pc.Vec3(.035, .86, .035), rope, new pc.Vec3(0, 0, 8));
      const ramRig = new pc.Entity("ram-striker-rig");
      ramRig.setLocalPosition(-.1, .3, 0);
      root.addChild(ramRig);
      this.primitive("ram-log", "cylinder", ramRig, pc.Vec3.ZERO, new pc.Vec3(.48, 3.12, .48), timber, new pc.Vec3(0, 0, 90));
      this.primitive("ram-iron-bands-a", "cylinder", ramRig, new pc.Vec3(-.9, 0, 0), new pc.Vec3(.52, .14, .52), iron, new pc.Vec3(0, 0, 90));
      this.primitive("ram-iron-bands-b", "cylinder", ramRig, new pc.Vec3(.72, 0, 0), new pc.Vec3(.52, .14, .52), iron, new pc.Vec3(0, 0, 90));
      this.primitive("ram-dragon-head", "cone", ramRig, new pc.Vec3(-1.7, 0, 0), new pc.Vec3(.58, .72, .58), bronze, new pc.Vec3(0, 0, 90));
      this.primitive("ram-dragon-brow", "box", ramRig, new pc.Vec3(-1.56, .24, 0), new pc.Vec3(.42, .12, .62), gold, new pc.Vec3(0, 0, 12));
      for (const x of [-.9, .9]) {
        for (const z of [-.66, .66]) wheel("ram-wheel", new pc.Vec3(x, -.4, z), .46);
      }
      this.battleMachineVisuals.set(state.id, { kind: "ram", motion: ramRig, wheels });
      return;
    }
    if (variant.includes("stone thrower")) {
      this.primitive("trebuchet-base", "box", root, new pc.Vec3(0, -.72, 0), new pc.Vec3(2.25, .26, 2.05), dark);
      for (const x of [-.72, .72]) {
        this.primitive("trebuchet-frame-front", "box", root, new pc.Vec3(x, .22, -.58), new pc.Vec3(.2, 2, .2), timber, new pc.Vec3(0, 0, x * -17));
        this.primitive("trebuchet-frame-back", "box", root, new pc.Vec3(x, .22, .58), new pc.Vec3(.2, 2, .2), timber, new pc.Vec3(0, 0, x * -17));
      }
      this.primitive("trebuchet-topbeam", "box", root, new pc.Vec3(0, 1.12, 0), new pc.Vec3(1.9, .2, .32), lightTimber);
      this.primitive("trebuchet-axle", "cylinder", root, new pc.Vec3(0, .8, 0), new pc.Vec3(.19, 1.72, .19), bronze, new pc.Vec3(90, 0, 0));
      const armRig = new pc.Entity("trebuchet-arm-rig");
      armRig.setLocalPosition(0, .8, 0);
      armRig.setLocalEulerAngles(0, 0, -52);
      root.addChild(armRig);
      this.primitive("trebuchet-arm", "box", armRig, new pc.Vec3(-.45, 0, 0), new pc.Vec3(3.25, .18, .24), lightTimber);
      this.primitive("trebuchet-counterweight", "box", armRig, new pc.Vec3(.98, -.38, 0), new pc.Vec3(.72, .78, .72), iron);
      this.primitive("trebuchet-counterweight-mark", "box", armRig, new pc.Vec3(.98, -.38, -.37), new pc.Vec3(.4, .4, .04), green, undefined, false);
      this.primitive("trebuchet-sling", "cylinder", armRig, new pc.Vec3(-1.65, -.42, 0), new pc.Vec3(.04, .9, .04), rope, new pc.Vec3(0, 0, -18));
      this.primitive("trebuchet-sling-cup", "sphere", armRig, new pc.Vec3(-1.92, -.84, 0), new pc.Vec3(.36, .16, .36), rope);
      this.primitive("trebuchet-chevron", "box", root, new pc.Vec3(0, -.45, 1.04), new pc.Vec3(1.15, .22, .05), green, undefined, false);
      this.battleMachineVisuals.set(state.id, { kind: "trebuchet", motion: armRig, wheels });
      return;
    }
    if (variant.includes("siege ballista")) {
      this.primitive("ballista-base", "box", root, new pc.Vec3(.12, -.42, 0), new pc.Vec3(2.65, .3, 1.55), dark);
      this.primitive("ballista-turntable", "cylinder", root, new pc.Vec3(0, -.2, 0), new pc.Vec3(.72, .18, .72), bronze);
      this.primitive("ballista-stock", "box", root, new pc.Vec3(-.12, .18, 0), new pc.Vec3(2.85, .22, .25), lightTimber);
      const bowRig = new pc.Entity("ballista-bow-rig");
      bowRig.setLocalPosition(-.78, .24, 0);
      root.addChild(bowRig);
      this.primitive("ballista-bow-upper", "box", bowRig, new pc.Vec3(0, 0, -.62), new pc.Vec3(.18, .18, 1.25), timber, new pc.Vec3(0, -8, 0));
      this.primitive("ballista-bow-lower", "box", bowRig, new pc.Vec3(0, 0, .62), new pc.Vec3(.18, .18, 1.25), timber, new pc.Vec3(0, 8, 0));
      for (const z of [-1.22, 1.22]) this.primitive("ballista-bow-cap", "cylinder", bowRig, new pc.Vec3(0, 0, z), new pc.Vec3(.11, .26, .11), bronze);
      this.primitive("ballista-string", "box", bowRig, new pc.Vec3(.42, 0, 0), new pc.Vec3(.035, .035, 2.35), rope, undefined, false);
      this.primitive("ballista-crank", "cylinder", root, new pc.Vec3(.68, .08, 0), new pc.Vec3(.3, .95, .3), iron, new pc.Vec3(90, 0, 0));
      this.primitive("ballista-loaded-bolt", "cylinder", root, new pc.Vec3(-.38, .34, 0), new pc.Vec3(.08, 2.05, .08), iron, new pc.Vec3(0, 0, 90));
      this.primitive("ballista-loaded-tip", "cone", root, new pc.Vec3(-1.45, .34, 0), new pc.Vec3(.16, .32, .16), gold, new pc.Vec3(0, 0, 90));
      for (const x of [-.7, .7]) {
        for (const z of [-.66, .66]) wheel("ballista-wheel", new pc.Vec3(x, -.58, z), .38);
      }
      this.primitive("ballista-green-mark", "box", root, new pc.Vec3(.34, .55, -.7), new pc.Vec3(1.05, .38, .05), green, undefined, false);
      this.battleMachineVisuals.set(state.id, { kind: "ballista", motion: bowRig, wheels });
      return;
    }
    this.primitive("battle-machine", "box", root, pc.Vec3.ZERO, state.size, timber);
  }

  private createBattleProjectileVisual(root: pc.Entity, state: CoreBodyState): void {
    if (state.variant?.includes("ballista bolt")) {
      const iron = this.material("ballista-bolt-iron", palette.iron, .5, .68);
      const wood = this.material("ballista-bolt-shaft", palette.oakDark, .15);
      const gold = this.material("ballista-bolt-gold", palette.gold, .55, .42);
      this.primitive("bolt-shaft", "cylinder", root, pc.Vec3.ZERO, new pc.Vec3(.065, .86, .065), wood, new pc.Vec3(0, 0, 90));
      this.primitive("bolt-head", "cone", root, new pc.Vec3(-.52, 0, 0), new pc.Vec3(.14, .26, .14), iron, new pc.Vec3(0, 0, 90));
      this.primitive("bolt-fletching-a", "box", root, new pc.Vec3(.42, 0, 0), new pc.Vec3(.24, .03, .28), gold, undefined, false);
      this.primitive("bolt-fletching-b", "box", root, new pc.Vec3(.42, 0, 0), new pc.Vec3(.24, .28, .03), gold, undefined, false);
      return;
    }
    const stone = this.material("siege-stone", new pc.Color(.31, .295, .25), .08);
    const iron = this.material("siege-stone-band", palette.iron, .38, .36);
    const green = this.material("siege-stone-mark", new pc.Color(.04, .46, .27), .18);
    this.primitive("siege-stone", "sphere", root, pc.Vec3.ZERO, new pc.Vec3(.46, .46, .46), stone);
    this.primitive("siege-stone-band", "cylinder", root, pc.Vec3.ZERO, new pc.Vec3(.49, .07, .49), iron);
    this.primitive("siege-stone-mark", "box", root, new pc.Vec3(0, .34, -.33), new pc.Vec3(.34, .08, .025), green, new pc.Vec3(-38, 0, 0), false);
  }

  private createBattleEffects(): void {
    const burst = new pc.Entity("battle-impact-burst");
    burst.enabled = false;
    this.app.root.addChild(burst);
    this.impactBurst = burst;
    const flash = this.material("impact-flash", new pc.Color(1, .56, .05), .34);
    const dust = this.material("impact-dust", new pc.Color(.58, .48, .31), .04);
    this.primitive("impact-core", "sphere", burst, pc.Vec3.ZERO, new pc.Vec3(.34, .34, .34), flash, undefined, false);
    for (let index = 0; index < 9; index += 1) {
      const angle = index / 9 * Math.PI * 2;
      const shard = this.primitive(
        "impact-shard",
        index % 2 === 0 ? "cone" : "box",
        burst,
        new pc.Vec3(Math.cos(angle) * .62, .08 + (index % 3) * .16, Math.sin(angle) * .62),
        index % 2 === 0 ? new pc.Vec3(.1, .72, .1) : new pc.Vec3(.12, .46, .16),
        index % 3 === 0 ? flash : dust,
        new pc.Vec3(Math.sin(angle) * 52, 0, -Math.cos(angle) * 52),
        false,
      );
      this.impactShards.push(shard);
    }
  }

  private createTowerBlockVisual(root: pc.Entity, state: CoreBodyState): void {
    const variation = hashUnit(state.id);
    const oak = new pc.Color(
      .43 + variation * .09,
      .235 + variation * .055,
      .075 + variation * .035,
    );
    const body = this.primitive(
      `${state.id}-timber`,
      "box",
      root,
      pc.Vec3.ZERO,
      new pc.Vec3(state.size.x * .992, state.size.y * .96, state.size.z * .97),
      this.material(`tower-oak-${Math.floor(variation * 6)}`, oak, .17),
    );
    const grain = this.material("tower-grain", palette.oakDark, .08);
    for (const z of [-.15, .02, .17]) {
      this.primitive(
        "grain",
        "box",
        body,
        new pc.Vec3(0, .505, z / state.size.z),
        new pc.Vec3(.84, .015, .012),
        grain,
        undefined,
        false,
      );
    }
    const end = this.material("tower-end-grain", palette.oakLight, .12);
    for (const x of [-.502, .502]) {
      this.primitive("end-grain", "box", body, new pc.Vec3(x, 0, 0), new pc.Vec3(.012, .88, .88), end, undefined, false);
    }
  }

  private createCradleVisual(root: pc.Entity): void {
    const oak = this.material("cradle-oak", new pc.Color(.34, .16, .055), .2);
    const iron = this.material("cradle-iron", palette.iron, .55, .68);
    this.primitive("cradle-platform", "box", root, new pc.Vec3(0, .02, 0), new pc.Vec3(1.4, .14, 1.4), oak);
    for (const x of [-.52, .52]) {
      for (const z of [-.52, .52]) {
        this.primitive("cradle-foot", "box", root, new pc.Vec3(x, -.11, z), new pc.Vec3(.2, .2, .2), oak);
      }
    }
    const seat = this.meshEntity(
      "cradle-seat-ring",
      pc.createTorus(this.app.graphicsDevice, {
        ringRadius: .5,
        tubeRadius: .08,
        segments: 24,
        sides: 8,
      }),
      iron,
      root,
    );
    seat.setLocalPosition(0, .18, 0);
    seat.setLocalEulerAngles(0, 0, 0);
    for (const x of [-.66, .66]) {
      const eye = this.meshEntity(
        "cradle-rope-eye",
        pc.createTorus(this.app.graphicsDevice, { ringRadius: .08, tubeRadius: .022, segments: 12, sides: 6 }),
        iron,
        root,
      );
      eye.setLocalPosition(x, .19, 0);
      eye.setLocalEulerAngles(90, 0, 0);
    }
  }

  private createHumptyVisual(root: pc.Entity, state: CoreBodyState): void {
    const rig = new pc.Entity("humpty-visual-root");
    root.addChild(rig);
    this.primitive("egg-shell", "sphere", rig, pc.Vec3.ZERO, state.size, this.material("egg-shell", palette.egg, .48));
    const face = new pc.Entity("humpty-face");
    face.setLocalPosition(0, .08, .545);
    rig.addChild(face);
    this.humptyFace = face;
    const eyeWhite = this.material("eye-white", new pc.Color(.97, .95, .84), .6);
    const ink = this.material("ink", palette.ink, .42);
    for (const x of [-.23, .23]) {
      this.primitive("eye", "sphere", face, new pc.Vec3(x, .19, 0), new pc.Vec3(.25, .32, .13), eyeWhite);
      this.primitive("pupil", "sphere", face, new pc.Vec3(x, .17, .075), new pc.Vec3(.085, .13, .055), ink);
      const brow = this.primitive("brow", "box", face, new pc.Vec3(x, .43, .08), new pc.Vec3(.29, .045, .04), ink, new pc.Vec3(0, 0, x < 0 ? -10 : 10));
      this.humptyBrows.push(brow);
    }
    this.primitive("nose", "cone", face, new pc.Vec3(0, -.005, .09), new pc.Vec3(.11, .24, .11), this.material("nose", palette.gold, .28), new pc.Vec3(90, 0, 0));
    this.humptyMouth = this.primitive("mouth", "box", face, new pc.Vec3(0, -.22, .08), new pc.Vec3(.31, .055, .035), ink);
    const crown = new pc.Entity("crown");
    crown.setLocalPosition(0, .89, 0);
    rig.addChild(crown);
    const gold = this.material("gold", palette.gold, .72, .55);
    this.primitive("crown-band", "cylinder", crown, pc.Vec3.ZERO, new pc.Vec3(.52, .14, .52), gold);
    for (let index = 0; index < 5; index += 1) {
      const angle = (index / 5) * Math.PI * 2;
      this.primitive("crown-point", "cone", crown, new pc.Vec3(Math.cos(angle) * .19, .19, Math.sin(angle) * .19), new pc.Vec3(.11, .36, .11), gold);
    }
    for (const direction of [-1, 1]) {
      const arm = new pc.Entity(direction < 0 ? "humpty-left-arm" : "humpty-right-arm");
      arm.setLocalPosition(direction * .68, .03, 0);
      arm.setLocalEulerAngles(0, 0, direction * -28);
      rig.addChild(arm);
      this.primitive("sleeve", "cylinder", arm, new pc.Vec3(direction * .23, 0, 0), new pc.Vec3(.14, .47, .14), this.material("royal-red", palette.king, .21), new pc.Vec3(0, 0, 90));
      this.primitive("glove", "sphere", arm, new pc.Vec3(direction * .5, 0, 0), new pc.Vec3(.2, .18, .16), this.material("cream", palette.cream, .2));
    }
  }

  private createPartVisual(root: pc.Entity, state: CoreBodyState): void {
    const team = state.team ?? "king";
    const timber = this.material("part-oak", palette.oak, .18);
    const dark = this.material("part-dark-oak", palette.oakDark, .14);
    const iron = this.material("part-iron", palette.iron, .54, .68);
    const bronze = this.material("part-bronze", palette.bronze, .62, .55);
    const family = state.family;
    if (family === "beam") {
      this.primitive("beam", "box", root, pc.Vec3.ZERO, state.size, timber);
      for (const z of [-state.size.z / 2 - .045, state.size.z / 2 + .045]) {
        this.primitive("square-peg", "box", root, new pc.Vec3(0, 0, z), new pc.Vec3(.09, .09, .09), dark);
      }
      this.teamWrap(root, team, new pc.Vec3(state.size.x * 1.08, state.size.y * 1.08, .08), new pc.Vec3(0, 0, -state.size.z * .3));
    } else if (family === "plank") {
      this.primitive("broad-plank", "box", root, pc.Vec3.ZERO, state.size, timber);
      for (const x of [-.18, .18]) this.primitive("plank-rail", "box", root, new pc.Vec3(x, .07, 0), new pc.Vec3(.035, .05, state.size.z * .9), dark);
      this.primitive(
        "keyed-plank-socket",
        "box",
        root,
        new pc.Vec3(0, .085, .52),
        new pc.Vec3(.22, .07, .22),
        iron,
        new pc.Vec3(-45, 0, 0),
      );
      for (const z of [-.5, .5]) {
        this.primitive(
          "chassis-bearing-collar",
          "cylinder",
          root,
          new pc.Vec3(0, -.12, z),
          new pc.Vec3(.2, .58, .2),
          iron,
          new pc.Vec3(0, 0, 90),
        );
        this.primitive(
          "chassis-bearing-key",
          "box",
          root,
          new pc.Vec3(0, -.205, z),
          new pc.Vec3(.14, .055, .08),
          bronze,
        );
      }
      this.teamWrap(root, team, new pc.Vec3(state.size.x * 1.02, .03, .11), new pc.Vec3(0, .065, -.45));
    } else if (family === "hub") {
      const hubRig = new pc.Entity("hub-axle-frame");
      hubRig.setLocalEulerAngles(90, 0, 0);
      root.addChild(hubRig);
      const hubTube = state.size.x * .085;
      this.meshEntity(
        "octagonal-hub",
        pc.createTorus(this.app.graphicsDevice, {
          ringRadius: state.size.x / 2 - hubTube,
          tubeRadius: hubTube,
          segments: 8,
          sides: 4,
        }),
        timber,
        hubRig,
      );
      this.meshEntity(
        "iron-bore-collar",
        pc.createTorus(this.app.graphicsDevice, {
          ringRadius: state.size.x * .21,
          tubeRadius: state.size.x * .025,
          segments: 16,
          sides: 5,
        }),
        iron,
        hubRig,
      );
      this.teamWrap(hubRig, team, new pc.Vec3(.09, state.size.z * 1.04, .045), new pc.Vec3(0, 0, state.size.x * .32));
    } else if (family === "axle") {
      this.primitive("round-axle", "cylinder", root, pc.Vec3.ZERO, new pc.Vec3(state.size.x, state.size.z, state.size.x), dark, new pc.Vec3(90, 0, 0));
      for (const z of [-state.size.z / 2 + .06, state.size.z / 2 - .06]) this.primitive("axle-collar", "cylinder", root, new pc.Vec3(0, 0, z), new pc.Vec3(.19, .05, .19), bronze, new pc.Vec3(90, 0, 0));
      this.teamWrap(root, team, new pc.Vec3(.16, .16, .08), pc.Vec3.ZERO);
    } else if (family === "wheel") {
      const wheelRig = new pc.Entity("wheel-axle-frame");
      wheelRig.setLocalEulerAngles(90, 0, 0);
      root.addChild(wheelRig);
      const tireRadius = state.size.x * .095;
      const wheel = this.meshEntity("spoked-wheel", pc.createTorus(this.app.graphicsDevice, {
        ringRadius: state.size.x / 2 - tireRadius,
        tubeRadius: tireRadius,
        segments: 24,
        sides: 8,
      }), timber, wheelRig);
      wheel.setLocalEulerAngles(0, 0, 0);
      this.primitive("wheel-hub", "cylinder", wheelRig, pc.Vec3.ZERO, new pc.Vec3(.18, state.size.y * 1.1, .18), bronze);
      for (let spoke = 0; spoke < 6; spoke += 1) {
        this.primitive("wheel-spoke", "box", wheelRig, pc.Vec3.ZERO, new pc.Vec3(.045, state.size.y * .72, state.size.x * .78), dark, new pc.Vec3(0, spoke * 30, 0));
      }
      this.teamWrap(wheelRig, team, new pc.Vec3(.12, state.size.y * 1.16, .12), pc.Vec3.ZERO);
    } else if (family === "sheave") {
      const sheaveRig = new pc.Entity("sheave-axle-frame");
      sheaveRig.setLocalEulerAngles(90, 0, 0);
      root.addChild(sheaveRig);
      const grooveRadius = state.size.x * .095;
      for (const offset of [-state.size.y * .22, state.size.y * .22]) {
        const cheek = this.meshEntity(
          "sheave-cheek",
          pc.createTorus(this.app.graphicsDevice, {
            ringRadius: state.size.x / 2 - grooveRadius,
            tubeRadius: grooveRadius,
            segments: 24,
            sides: 7,
          }),
          timber,
          sheaveRig,
        );
        cheek.setLocalPosition(0, offset, 0);
      }
      this.meshEntity(
        "deep-rope-groove",
        pc.createTorus(this.app.graphicsDevice, {
          ringRadius: state.size.x * .35,
          tubeRadius: state.size.x * .035,
          segments: 24,
          sides: 6,
        }),
        iron,
        sheaveRig,
      );
      this.primitive("sheave-pin", "cylinder", sheaveRig, pc.Vec3.ZERO, new pc.Vec3(.14, state.size.y * 1.25, .14), bronze);
      this.teamWrap(sheaveRig, team, new pc.Vec3(.08, state.size.y * 1.3, .08), pc.Vec3.ZERO);
    } else if (family === "drum") {
      const drumRig = new pc.Entity("drum-axle-frame");
      drumRig.setLocalEulerAngles(90, 0, 0);
      root.addChild(drumRig);
      this.primitive("winding-drum", "cylinder", drumRig, pc.Vec3.ZERO, state.size, timber);
      for (const y of [-state.size.y * .34, state.size.y * .17, 0, state.size.y * .34]) {
        const winding = this.meshEntity(
          "drum-rope-wrap",
          pc.createTorus(this.app.graphicsDevice, {
            ringRadius: state.size.x * .43,
            tubeRadius: .018,
            segments: 20,
            sides: 5,
          }),
          this.material("rope", palette.rope, .13),
          drumRig,
        );
        winding.setLocalPosition(0, y, 0);
      }
      this.primitive("drum-axle-bore", "cylinder", drumRig, pc.Vec3.ZERO, new pc.Vec3(.11, state.size.y * 1.15, .11), iron);
      this.teamWrap(drumRig, team, new pc.Vec3(state.size.x * .55, .035, .07), new pc.Vec3(0, state.size.y * .28, 0));
    } else if (family === "rope") {
      for (const radius of [.13, .17, .205]) {
        const coil = this.meshEntity("rope-coil", pc.createTorus(this.app.graphicsDevice, { ringRadius: radius, tubeRadius: .022, segments: 20, sides: 6 }), this.material("rope", palette.rope, .13), root);
        coil.setLocalPosition(0, (radius - .13) * .7, 0);
      }
      const hook = this.meshEntity("rope-hook", pc.createTorus(this.app.graphicsDevice, { ringRadius: .055, tubeRadius: .015, segments: 12, sides: 5 }), iron, root);
      hook.setLocalPosition(.25, .02, 0);
      this.teamWrap(root, team, new pc.Vec3(.06, .06, .18), new pc.Vec3(-.21, .02, 0));
    } else if (family === "wedge") {
      const wedge = this.createWedgeMesh(state.size);
      this.meshEntity("wedge", wedge, timber, root);
      this.teamWrap(root, team, new pc.Vec3(state.size.x * 1.02, .025, .08), new pc.Vec3(0, -state.size.y / 2 + .018, .12));
    }
  }

  private createWorkerVisual(root: pc.Entity, id: string, team: Team): void {
    const uniform = this.teamMaterial(team);
    this.primitive("worker-torso", "box", root, new pc.Vec3(0, .05, 0), new pc.Vec3(.5, .72, .32), uniform);
    this.primitive("worker-head", "sphere", root, new pc.Vec3(0, .58, 0), new pc.Vec3(.38, .42, .36), this.material("skin", new pc.Color(.67, .48, .33), .25));
    const helmet = this.primitive("worker-helmet", "sphere", root, new pc.Vec3(0, .73, -.01), new pc.Vec3(.42, .22, .4), team === "king" ? this.material("worker-iron", palette.iron, .52, .66) : this.material("worker-bronze", palette.bronze, .55, .55));
    this.primitive("helmet-ridge", "box", helmet, new pc.Vec3(0, .4, 0), new pc.Vec3(.11, .22, .48), uniform);
    const leftArm = this.primitive("worker-left-arm", "cylinder", root, new pc.Vec3(-.34, .02, .03), new pc.Vec3(.12, .62, .12), uniform, new pc.Vec3(0, 0, -12));
    const rightArm = this.primitive("worker-right-arm", "cylinder", root, new pc.Vec3(.34, .02, .03), new pc.Vec3(.12, .62, .12), uniform, new pc.Vec3(0, 0, 12));
    const leftLeg = this.primitive("worker-left-leg", "cylinder", root, new pc.Vec3(-.16, -.48, 0), new pc.Vec3(.12, .55, .12), this.material("ink", palette.ink, .42));
    const rightLeg = this.primitive("worker-right-leg", "cylinder", root, new pc.Vec3(.16, -.48, 0), new pc.Vec3(.12, .55, .12), this.material("ink", palette.ink, .42));
    this.workerVisuals.set(id, { leftArm, rightArm, leftLeg, rightLeg, phase: "idle" });
  }

  private teamWrap(root: pc.Entity, team: Team, size: pc.Vec3, position: pc.Vec3): void {
    this.primitive(`${team}-cloth-wrap`, "box", root, position, size, this.teamMaterial(team));
  }

  private teamMaterial(team: Team): pc.StandardMaterial {
    return this.material(`${team}-cloth`, team === "king" ? palette.king : palette.queen, .16);
  }

  private createWedgeMesh(size: { x: number; y: number; z: number }): pc.Mesh {
    const x = size.x / 2;
    const y = size.y / 2;
    const z = size.z / 2;
    const positions = [
      -x, -y, -z,
      x, -y, -z,
      -x, -y, z,
      x, -y, z,
      -x, y, z,
      x, y, z,
    ];
    const indices = [
      0, 2, 1, 1, 2, 3,
      2, 4, 3, 3, 4, 5,
      0, 1, 4, 1, 5, 4,
      0, 4, 2,
      1, 3, 5,
    ];
    return pc.createMesh(this.app.graphicsDevice, positions, {
      indices,
      normals: pc.calculateNormals(positions, indices),
    });
  }

  private meshEntity(
    name: string,
    mesh: pc.Mesh,
    material: pc.StandardMaterial,
    parent: pc.Entity,
  ): pc.Entity {
    const entity = new pc.Entity(name);
    const meshInstance = new pc.MeshInstance(mesh, material);
    meshInstance.castShadow = true;
    entity.addComponent("render", { meshInstances: [meshInstance] });
    parent.addChild(entity);
    return entity;
  }

  private primitive(
    name: string,
    type: "box" | "sphere" | "cylinder" | "capsule" | "cone",
    parent: pc.Entity,
    position: pc.Vec3,
    scale: { x: number; y: number; z: number },
    material: pc.StandardMaterial,
    euler = pc.Vec3.ZERO,
    castShadows = true,
  ): pc.Entity {
    const entity = new pc.Entity(name);
    entity.setLocalPosition(position);
    entity.setLocalScale(scale.x, scale.y, scale.z);
    entity.setLocalEulerAngles(euler);
    entity.addComponent("render", {
      type,
      material,
      castShadows,
      receiveShadows: true,
    });
    parent.addChild(entity);
    return entity;
  }

  private material(
    name: string,
    color: pc.Color,
    gloss = .25,
    metalness = 0,
  ): pc.StandardMaterial {
    const existing = this.materials.get(name);
    if (existing) return existing;
    const material = new pc.StandardMaterial();
    material.name = name;
    material.diffuse = color;
    material.gloss = gloss;
    material.metalness = metalness;
    material.update();
    this.materials.set(name, material);
    return material;
  }

  private update(dt: number): void {
    const blend = 1 - Math.exp(-dt * 18);
    for (const runtime of this.bodies.values()) {
      if (!runtime.dynamic) continue;
      runtime.currentPosition.lerp(runtime.currentPosition, runtime.targetPosition, blend);
      runtime.currentRotation.slerp(runtime.currentRotation, runtime.targetRotation, blend);
      runtime.root.setPosition(runtime.currentPosition);
      runtime.root.setRotation(runtime.currentRotation);
    }
    this.updateRopeVisuals();
    if (this.humptyFace && this.humptyMouth) {
      const concern = Math.sin(this.elapsed * .75);
      const speaking = performance.now() < this.humptySpeakingUntil;
      const chatter = speaking ? Math.abs(Math.sin(performance.now() * .014)) : 0;
      this.humptyFace.setLocalEulerAngles(0, concern * 2.5, concern * 1.4 + chatter * 1.6);
      this.humptyMouth.setLocalScale(.31, .055 + Math.max(0, concern) * .035 + chatter * .07, .035);
      this.humptyBrows[0]?.setLocalEulerAngles(0, 0, -10 - concern * 8);
      this.humptyBrows[1]?.setLocalEulerAngles(0, 0, 10 + concern * 8);
    }
    if (this.queenRig && this.queenHead && this.queenScepter && this.queenCrown) {
      const twitch = Math.sin(this.elapsed * 2.7) + Math.sin(this.elapsed * 7.9) * .28;
      const speaking = performance.now() < this.queenSpeakingUntil;
      const declaim = speaking ? Math.sin(performance.now() * .009) : 0;
      this.queenRig.setLocalPosition(0, 1.05 + Math.sin(this.elapsed * 1.8) * .018, .12);
      this.queenHead.setLocalEulerAngles(declaim * 4, twitch * 5, -7 + twitch * 3.5);
      this.queenCrown.setLocalEulerAngles(twitch * 1.5 + declaim * 3, 0, -17 - twitch * 2.5);
      this.queenScepter.setLocalEulerAngles(0, twitch * 2, -9 + Math.sin(this.elapsed * 3.6) * 8 + declaim * 14);
    }
    for (const [id, visual] of this.workerVisuals) {
      const working = ["routing", "carrying", "step-clear", "pushing", "pulling"].includes(visual.phase);
      const gait = working ? Math.sin(this.elapsed * 10 + hashUnit(id) * 4) * 25 : 0;
      visual.leftLeg.setLocalEulerAngles(gait, 0, 0);
      visual.rightLeg.setLocalEulerAngles(-gait, 0, 0);
      if (visual.phase === "carrying" || visual.phase === "holding") {
        visual.leftArm.setLocalEulerAngles(62, 0, -18);
        visual.rightArm.setLocalEulerAngles(62, 0, 18);
      } else {
        visual.leftArm.setLocalEulerAngles(-gait * .72, 0, -12);
        visual.rightArm.setLocalEulerAngles(gait * .72, 0, 12);
      }
    }
    this.updateBattlePresentation();
    this.updateCamera();
    this.publishDebug(this.maxDivergence());
  }

  private updateBattlePresentation(): void {
    const battle = this.battleState;
    const resolving = battle?.phase === "resolving";
    const progress = resolving
      ? pc.math.clamp((battle.phaseProgress - 2 / 3) / (2 / 9), 0, 1)
      : 0;
    const redOrder = battle?.orders.king;
    const greenOrder = battle?.orders.queen;
    const wheelSpin = this.elapsed * 155;

    for (const [id, visual] of this.battleMachineVisuals) {
      const order = id.startsWith("red-") ? redOrder : greenOrder;
      const engaged = resolving && order?.unitId === id;
      for (const wheel of visual.wheels) wheel.setLocalEulerAngles(90, wheelSpin, 0);
      if (visual.kind === "engineers") {
        const strike = engaged ? Math.sin(Math.min(1, progress * 2.4) * Math.PI) : 0;
        visual.motion.setLocalEulerAngles(0, 0, 18 - strike * 78);
      } else if (visual.kind === "winch") {
        const spin = engaged ? progress * 1080 : 0;
        visual.motion.setLocalEulerAngles(0, 0, spin);
        visual.secondary?.setLocalEulerAngles(spin * 1.3, 0, 0);
      } else if (visual.kind === "sledge") {
        const catchPulse = engaged ? Math.sin(progress * Math.PI * 3) * (1 - progress) : 0;
        visual.motion.setLocalScale(1, 1 + Math.abs(catchPulse) * .65, 1);
        visual.motion.setLocalEulerAngles(0, 0, catchPulse * 3.5);
      } else if (visual.kind === "ram") {
        const stroke = engaged ? Math.sin(Math.min(1, progress * 1.45) * Math.PI) : 0;
        visual.motion.setLocalPosition(-.1 - stroke * .72, .3 + Math.abs(stroke) * .06, 0);
        visual.motion.setLocalEulerAngles(0, 0, stroke * -5);
      } else if (visual.kind === "trebuchet") {
        const release = engaged ? smoothStep(.08, .52, progress) : 0;
        visual.motion.setLocalEulerAngles(0, 0, -52 + release * 112);
      } else if (visual.kind === "ballista") {
        const tension = engaged ? 1 - smoothStep(.08, .34, progress) : 0;
        const recoil = engaged && progress >= .34
          ? Math.sin((progress - .34) * Math.PI * 8) * Math.exp(-(progress - .34) * 7)
          : 0;
        visual.motion.setLocalPosition(-.78 + recoil * .24, .24, 0);
        visual.motion.setLocalScale(1, 1, 1 + tension * .18);
      }
    }

    if (!this.impactBurst) return;
    const attack = greenOrder && ["breach", "bombard", "snipe"].includes(greenOrder.action)
      ? greenOrder
      : undefined;
    const impactLife = resolving && attack?.hit !== false
      ? 1 - Math.abs(pc.math.clamp((progress - .48) / .24, -1, 1))
      : 0;
    const target = attack ? this.battleTargetPosition(attack) : undefined;
    this.impactBurst.enabled = Boolean(target && impactLife > .03);
    if (!target || impactLife <= .03) return;
    this.impactBurst.setPosition(target.x, target.y + .12, target.z);
    this.impactBurst.setLocalScale(.55 + impactLife * 1.15, .55 + impactLife * 1.15, .55 + impactLife * 1.15);
    for (let index = 0; index < this.impactShards.length; index += 1) {
      const angle = index / this.impactShards.length * Math.PI * 2;
      const travel = .3 + impactLife * (1 + (index % 3) * .18);
      this.impactShards[index]?.setLocalPosition(
        Math.cos(angle) * travel,
        .08 + impactLife * (.35 + (index % 3) * .22),
        Math.sin(angle) * travel,
      );
    }
  }

  private battleTargetPosition(order: BattleOrderState): pc.Vec3 | undefined {
    const bodyId = order.resolvedTargetId
      ?? (order.targetId === "foundation"
        ? "tower-02-3"
        : order.targetId === "tower-face"
          ? "tower-08-2"
          : order.targetId === "humpty"
            ? "humpty"
            : "red-catch-sledge");
    return this.bodies.get(bodyId)?.currentPosition;
  }

  private syncRopeVisuals(snapshot: CoreSnapshot): void {
    const seen = new Set<string>();
    for (const connection of snapshot.connections) {
      if (connection.class !== "ROPE_ATTACH") continue;
      seen.add(connection.id);
      let visual = this.ropeVisuals.get(connection.id);
      if (!visual) {
        const material = this.material("live-rope", palette.rope, .12);
        const first = this.primitive(
          `${connection.id}-rope-a`,
          "cylinder",
          this.app.root,
          pc.Vec3.ZERO,
          new pc.Vec3(.045, 1, .045),
          material,
          pc.Vec3.ZERO,
          false,
        );
        const second = this.primitive(
          `${connection.id}-rope-b`,
          "cylinder",
          this.app.root,
          pc.Vec3.ZERO,
          new pc.Vec3(.045, 1, .045),
          material,
          pc.Vec3.ZERO,
          false,
        );
        visual = {
          segments: [first, second],
          bodyA: connection.bodyA,
          bodyB: connection.bodyB,
          slack: connection.slack ?? 0,
        };
        this.ropeVisuals.set(connection.id, visual);
      }
      visual.bodyA = connection.bodyA;
      visual.bodyB = connection.bodyB;
      visual.slack = connection.slack ?? 0;
    }
    for (const [id, visual] of this.ropeVisuals) {
      if (seen.has(id)) continue;
      visual.segments[0].destroy();
      visual.segments[1].destroy();
      this.ropeVisuals.delete(id);
    }
  }

  private updateRopeVisuals(): void {
    for (const visual of this.ropeVisuals.values()) {
      const firstBody = this.bodies.get(visual.bodyA);
      const secondBody = this.bodies.get(visual.bodyB);
      if (!firstBody || !secondBody) {
        visual.segments[0].enabled = false;
        visual.segments[1].enabled = false;
        continue;
      }
      visual.segments[0].enabled = true;
      visual.segments[1].enabled = true;
      const sag = Math.min(.3, Math.max(.012, visual.slack * .65));
      const midpoint = firstBody.currentPosition.clone()
        .add(secondBody.currentPosition)
        .mulScalar(.5);
      midpoint.y -= sag;
      this.placeRopeSegment(visual.segments[0], firstBody.currentPosition, midpoint);
      this.placeRopeSegment(visual.segments[1], midpoint, secondBody.currentPosition);
    }
  }

  private placeRopeSegment(segment: pc.Entity, start: pc.Vec3, end: pc.Vec3): void {
    const direction = end.clone().sub(start);
    const length = direction.length();
    if (length < .001) {
      segment.enabled = false;
      return;
    }
    segment.setPosition(start.clone().add(end).mulScalar(.5));
    segment.setRotation(new pc.Quat().setFromDirections(pc.Vec3.UP, direction.mulScalar(1 / length)));
    segment.setLocalScale(.045, length, .045);
  }

  private updateCamera(): void {
    const yaw = (this.orbitYaw * Math.PI) / 180;
    const pitch = (this.orbitPitch * Math.PI) / 180;
    const horizontal = Math.cos(pitch) * this.orbitDistance;
    this.camera.setPosition(
      this.cameraTarget.x + Math.sin(yaw) * horizontal,
      this.cameraTarget.y - Math.sin(pitch) * this.orbitDistance,
      this.cameraTarget.z + Math.cos(yaw) * horizontal,
    );
    this.camera.lookAt(this.cameraTarget);
  }

  private bindInput(): void {
    this.canvas.addEventListener("pointerdown", (event) => {
      this.dragging = true;
      this.pointerX = event.clientX;
      this.pointerY = event.clientY;
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (!this.dragging) return;
      this.orbitYaw -= (event.clientX - this.pointerX) * .22;
      this.orbitPitch = pc.math.clamp(this.orbitPitch - (event.clientY - this.pointerY) * .18, -38, 12);
      this.pointerX = event.clientX;
      this.pointerY = event.clientY;
    });
    const release = () => { this.dragging = false; };
    this.canvas.addEventListener("pointerup", release);
    this.canvas.addEventListener("pointercancel", release);
    this.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.orbitDistance = pc.math.clamp(this.orbitDistance + event.deltaY * .012, 9.5, 30);
    }, { passive: false });
  }

  private maxDivergence(): number {
    let maximum = 0;
    for (const runtime of this.bodies.values()) {
      if (!runtime.dynamic) continue;
      maximum = Math.max(maximum, runtime.currentPosition.distance(runtime.targetPosition));
    }
    return maximum;
  }

  private publishDebug(divergence: number): void {
    const previous = window.__HUMPTY_LAB__;
    window.__HUMPTY_LAB__ = {
      renderer: `PlayCanvas ${pc.version}`,
      gameplayPhysics: "none",
      ammoBodies: 0,
      renderedBodies: this.bodies.size,
      maxPoseDivergence: divergence,
      latestTick: this.latestTick,
      ...(previous?.snapshot ? { snapshot: previous.snapshot } : {}),
      ...(previous?.consoleErrors ? { consoleErrors: previous.consoleErrors } : {}),
    };
  }

  private resize(): void {
    this.app.resizeCanvas(this.host.clientWidth, this.host.clientHeight);
  }
}

function hashUnit(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function smoothStep(edge0: number, edge1: number, value: number): number {
  const amount = pc.math.clamp((value - edge0) / Math.max(.0001, edge1 - edge0), 0, 1);
  return amount * amount * (3 - 2 * amount);
}
