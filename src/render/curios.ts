import * as pc from "playcanvas";
import { CURIOS } from "../sim/curios.js";
import type { CurioId } from "../sim/types.js";
import { palette, type Kit } from "./kit.js";

const V = (x = 0, y = 0, z = 0): pc.Vec3 => new pc.Vec3(x, y, z);

interface Act {
  started: number;
}

/**
 * Nursery-rhyme curios dressed into the scenery. Striking one plays a little scene; none of them
 * change the verse. Positions come from the simulation's sensor list so hits and pictures agree.
 */
export class Curios {
  readonly root: pc.Entity;
  private readonly kit: Kit;
  private readonly acts = new Map<CurioId, Act>();
  private readonly cow: pc.Entity;
  private readonly cowStart: pc.Vec3;
  private readonly moon: pc.Entity;
  private readonly jack: pc.Entity;
  private readonly jill: pc.Entity;
  private readonly pail: pc.Entity;
  private readonly hillTop: pc.Vec3;
  private readonly cuckoo: pc.Entity;
  private readonly clockDoor: pc.Entity;
  private readonly clockSwing: pc.Entity;
  private readonly pendulum: pc.Entity;
  /** Sing a song of sixpence: the flown pie, its lid, and the four-and-twenty blackbirds inside. */
  private readonly pieSwing: pc.Entity;
  private readonly pieLid: pc.Entity;
  private readonly pieHome: pc.Vec3;
  private readonly birds: Array<{ root: pc.Entity; wings: [pc.Entity, pc.Entity] }> = [];
  /** Hickory dickory dock: the mouse, and the marks on the clock it climbs between. */
  private readonly mouse: pc.Entity;
  private readonly mouseTrack: pc.Entity[];
  private readonly cat: pc.Entity;
  private readonly bell: pc.Entity;
  private readonly spider: pc.Entity;
  private readonly spiderThread: pc.Entity;
  private readonly spiderHome: pc.Vec3;

  constructor(kit: Kit, parent: pc.Entity, moon: pc.Entity) {
    this.kit = kit;
    this.root = kit.group("curios", parent);
    this.moon = moon;
    const at = (id: CurioId): pc.Vec3 => {
      const curio = CURIOS.find((item) => item.id === id)!;
      return V(curio.at.x, curio.at.y, curio.at.z);
    };
    const ink = kit.material("ink", palette.ink, 0.42);
    const cream = kit.material("glove", palette.cream, 0.2);

    // Hey diddle diddle: a cut-out cow on the far hill.
    const cowAt = at("cow");
    this.cowStart = V(cowAt.x, cowAt.y - 0.55, cowAt.z + 0.1);
    this.cow = kit.group("cow", this.root, this.cowStart.clone());
    const hide = kit.material("cow-hide", new pc.Color(0.92, 0.9, 0.84), 0.15);
    kit.primitive("cow-body", "box", this.cow, V(0, 0.45, 0), { x: 1.1, y: 0.5, z: 0.08 }, hide, pc.Vec3.ZERO, false);
    kit.primitive("cow-spot", "sphere", this.cow, V(-0.2, 0.5, 0.05), { x: 0.34, y: 0.26, z: 0.02 }, ink, pc.Vec3.ZERO, false);
    kit.primitive("cow-spot", "sphere", this.cow, V(0.25, 0.4, 0.05), { x: 0.22, y: 0.2, z: 0.02 }, ink, pc.Vec3.ZERO, false);
    kit.primitive("cow-head", "box", this.cow, V(0.66, 0.66, 0), { x: 0.3, y: 0.32, z: 0.08 }, hide, pc.Vec3.ZERO, false);
    kit.primitive("cow-muzzle", "box", this.cow, V(0.78, 0.58, 0.02), { x: 0.14, y: 0.14, z: 0.08 }, kit.material("rat-pink", new pc.Color(0.86, 0.55, 0.55), 0.3), pc.Vec3.ZERO, false);
    for (const side of [-1, 1]) kit.primitive("cow-horn", "cone", this.cow, V(0.62 + side * 0.1, 0.86, 0), { x: 0.05, y: 0.14, z: 0.05 }, cream, V(0, 0, side * -25), false);
    for (const x of [-0.4, -0.2, 0.25, 0.42]) kit.primitive("cow-leg", "box", this.cow, V(x, 0.1, 0), { x: 0.08, y: 0.3, z: 0.06 }, hide, pc.Vec3.ZERO, false);
    kit.primitive("cow-tail", "box", this.cow, V(-0.6, 0.5, 0), { x: 0.2, y: 0.03, z: 0.03 }, ink, V(0, 0, -30), false);

    // Jack and Jill at the top of the right-hand hill, with their pail.
    this.hillTop = at("jack-and-jill").clone().add(V(0, -0.55, 0.1));
    const blue = kit.material("jack-blue", new pc.Color(0.2, 0.3, 0.6), 0.2);
    const pinafore = kit.material("jill-pink", new pc.Color(0.8, 0.4, 0.5), 0.2);
    const skin = kit.material("skin", palette.skin, 0.25);
    const figure = (name: string, coat: pc.StandardMaterial, dx: number): pc.Entity => {
      const person = kit.group(name, this.root, this.hillTop.clone().add(V(dx, 0, 0)));
      kit.primitive("body", "cone", person, V(0, 0.3, 0), { x: 0.34, y: 0.6, z: 0.1 }, coat, pc.Vec3.ZERO, false);
      kit.primitive("head", "sphere", person, V(0, 0.72, 0), { x: 0.24, y: 0.26, z: 0.1 }, skin, pc.Vec3.ZERO, false);
      if (name === "jack") kit.primitive("jack-crown", "cone", person, V(0, 0.9, 0), { x: 0.18, y: 0.14, z: 0.05 }, kit.material("gold", palette.gold, 0.72, 0.55), pc.Vec3.ZERO, false);
      else kit.primitive("jill-bonnet", "sphere", person, V(0, 0.8, -0.01), { x: 0.3, y: 0.18, z: 0.1 }, cream, pc.Vec3.ZERO, false);
      return person;
    };
    this.jack = figure("jack", blue, -0.35);
    this.jill = figure("jill", pinafore, 0.35);
    this.pail = kit.group("pail", this.root, this.hillTop.clone().add(V(0, 0.12, 0.02)));
    kit.primitive("pail", "cylinder", this.pail, V(), { x: 0.2, y: 0.22, z: 0.2 }, kit.material("iron", palette.iron, 0.55, 0.68), pc.Vec3.ZERO, false);
    kit.primitive("water", "cylinder", this.pail, V(0, 0.1, 0), { x: 0.17, y: 0.02, z: 0.17 }, kit.material("water", new pc.Color(0.3, 0.55, 0.8), 0.9), pc.Vec3.ZERO, false);

    // A great Black Forest cuckoo clock, flown in on two lines over stage left and turned to the
    // house: a carved gable, a painted dial at five to midnight, a pendulum and pine-cone weights.
    const clockAt = at("cuckoo");
    const flies = 17;
    this.clockSwing = kit.group("cuckoo-flown", this.root, V(clockAt.x, flies, clockAt.z), V(0, 8, 0));
    const clock = kit.group("cuckoo-clock", this.clockSwing, V(0, clockAt.y - flies, 0));
    const wood = kit.material("oak-dark", palette.oakDark, 0.16);
    const light = kit.material("oak", palette.oak, 0.18);
    const leaf = kit.material("carved-leaf", new pc.Color(0.2, 0.3, 0.14), 0.12);
    const gold = kit.material("gold", palette.gold, 0.72, 0.55);
    const line = kit.material("rope", palette.rope, 0.12);
    for (const side of [-1, 1]) kit.primitive("clock-line", "cylinder", this.clockSwing, V(side * 0.42, (clockAt.y + 1 - flies) / 2, 0), { x: 0.04, y: flies - clockAt.y - 1, z: 0.04 }, line, pc.Vec3.ZERO, false);
    kit.primitive("case", "box", clock, V(), { x: 1.1, y: 1.2, z: 0.4 }, wood);
    // The gable: a lighter board set on its corner behind two roof boards and a carved bird.
    kit.primitive("gable", "box", clock, V(0, 0.6, 0), { x: 0.78, y: 0.78, z: 0.34 }, light, V(0, 0, 45), false);
    for (const side of [-1, 1]) kit.primitive("roof", "box", clock, V(side * 0.33, 0.93, 0.02), { x: 0.98, y: 0.08, z: 0.52 }, wood, V(0, 0, -side * 45), false);
    kit.primitive("finial-bird", "sphere", clock, V(0, 1.3, 0.05), { x: 0.2, y: 0.16, z: 0.26 }, light, pc.Vec3.ZERO, false);
    kit.primitive("finial-beak", "cone", clock, V(0, 1.31, 0.22), { x: 0.06, y: 0.1, z: 0.06 }, gold, V(90, 0, 0), false);
    for (const side of [-1, 1]) {
      for (const [dx, dy, size] of [[0.5, 0.52, 0.2], [0.42, 0.64, 0.16], [0.55, -0.62, 0.18], [0.44, -0.66, 0.14]] as const) {
        kit.primitive("carved-leaf", "sphere", clock, V(side * dx, dy, 0.2), { x: size, y: size * 0.6, z: 0.06 }, leaf, V(0, 0, side * 30), false);
      }
    }
    // The dial: twelve marks, and the hands at five to twelve. It is the hour of his doom.
    const dial = kit.group("dial", clock, V(0, -0.08, 0.21));
    kit.primitive("face", "cylinder", dial, V(), { x: 0.72, y: 0.03, z: 0.72 }, cream, V(90, 0, 0), false);
    kit.primitive("bezel", "cylinder", dial, V(0, 0, -0.01), { x: 0.8, y: 0.03, z: 0.8 }, gold, V(90, 0, 0), false);
    for (let hour = 0; hour < 12; hour += 1) {
      const angle = (hour / 12) * Math.PI * 2;
      const long = hour % 3 === 0;
      kit.primitive("mark", "box", dial, V(Math.sin(angle) * 0.29, Math.cos(angle) * 0.29, 0.02), { x: 0.03, y: long ? 0.09 : 0.05, z: 0.01 }, ink, V(0, 0, (-angle * 180) / Math.PI), false);
    }
    kit.primitive("minute-hand", "box", dial, V(-0.013, 0.13, 0.03), { x: 0.03, y: 0.26, z: 0.01 }, ink, V(0, 0, 6), false);
    kit.primitive("hour-hand", "box", dial, V(0, 0.09, 0.035), { x: 0.045, y: 0.18, z: 0.01 }, ink, pc.Vec3.ZERO, false);
    kit.primitive("boss", "sphere", dial, V(0, 0, 0.04), { x: 0.06, y: 0.06, z: 0.03 }, gold, pc.Vec3.ZERO, false);
    // The little door above the dial, hinged on its left, and the bird behind it.
    kit.primitive("door-frame", "box", clock, V(0, 0.44, 0.205), { x: 0.3, y: 0.26, z: 0.02 }, ink, pc.Vec3.ZERO, false);
    this.clockDoor = kit.group("door-hinge", clock, V(-0.12, 0.44, 0.22));
    kit.primitive("door", "box", this.clockDoor, V(0.12, 0, 0), { x: 0.24, y: 0.21, z: 0.02 }, light, pc.Vec3.ZERO, false);
    this.cuckoo = kit.group("cuckoo", clock, V(0, 0.44, 0.05));
    kit.primitive("bird", "sphere", this.cuckoo, V(), { x: 0.18, y: 0.16, z: 0.24 }, kit.material("cuckoo-blue", new pc.Color(0.25, 0.45, 0.75), 0.3), pc.Vec3.ZERO, false);
    kit.primitive("beak", "cone", this.cuckoo, V(0, 0, 0.15), { x: 0.06, y: 0.12, z: 0.06 }, kit.material("nose", palette.gold, 0.28), V(90, 0, 0), false);
    // The pendulum swings under the case; the weights hang on their chains beside it.
    this.pendulum = kit.group("pendulum", clock, V(0, -0.6, 0.14));
    kit.primitive("pendulum-rod", "box", this.pendulum, V(0, -0.45, 0), { x: 0.04, y: 0.9, z: 0.02 }, gold, pc.Vec3.ZERO, false);
    kit.primitive("pendulum-bob", "cylinder", this.pendulum, V(0, -0.92, 0), { x: 0.3, y: 0.04, z: 0.3 }, gold, V(90, 0, 0), false);
    for (const [side, drop] of [[-1, 0.9], [1, 0.62]] as const) {
      kit.primitive("chain", "box", clock, V(side * 0.3, -0.6 - drop / 2, 0.05), { x: 0.025, y: drop, z: 0.025 }, kit.material("iron", palette.iron, 0.55, 0.68), pc.Vec3.ZERO, false);
      kit.primitive("pine-cone", "cone", clock, V(side * 0.3, -0.6 - drop - 0.14, 0.05), { x: 0.16, y: 0.34, z: 0.16 }, gold, V(180, 0, 0), false);
    }
    // The mouse's way up the clock: from its perch on the long weight, up the chain, and up the
    // front of the case to the little door. Marks on the clock, so the mouse swings with it.
    this.mouseTrack = [V(-0.3, -1.42, 0.12), V(-0.3, -0.62, 0.12), V(-0.44, 0.3, 0.26)].map((mark) => kit.group("mouse-mark", clock, mark));
    this.mouse = kit.group("mouse", this.root);
    const fur = new pc.Color(0.56, 0.54, 0.52);
    const pink = new pc.Color(0.92, 0.6, 0.64);
    kit.meshEntity("mouse-body", kit.boxes("clock-mouse", [
      { center: [0, 0.07, 0], size: [0.22, 0.13, 0.13], color: fur },
      { center: [0.14, 0.09, 0], size: [0.1, 0.1, 0.1], color: fur },
      { center: [0.2, 0.09, 0], size: [0.03, 0.03, 0.03], color: pink },
      { center: [0.12, 0.17, -0.05], size: [0.02, 0.07, 0.06], color: pink },
      { center: [0.12, 0.17, 0.05], size: [0.02, 0.07, 0.06], color: pink },
      { center: [0.17, 0.11, -0.035], size: [0.02, 0.02, 0.02], color: palette.ink },
      { center: [0.17, 0.11, 0.035], size: [0.02, 0.02, 0.02], color: palette.ink },
      { center: [-0.24, 0.05, 0], size: [0.26, 0.015, 0.015], color: pink },
    ]), kit.paintMaterial(0.3), this.mouse);

    // Sing a song of sixpence: the King's supper flown in on three lines, a pie on a gilt platter.
    // One impatient blackbird has already pecked its head out through the crust.
    this.pieHome = at("pie");
    this.pieSwing = kit.group("pie-flown", this.root, V(this.pieHome.x, flies, this.pieHome.z));
    const pie = kit.group("pie", this.pieSwing, V(0, this.pieHome.y - flies - 0.1, 0));
    for (let index = 0; index < 3; index += 1) {
      const angle = (index / 3) * Math.PI * 2;
      kit.primitive("pie-line", "cylinder", this.pieSwing, V(Math.cos(angle) * 0.4, (this.pieHome.y - 0.1 - flies) / 2, Math.sin(angle) * 0.4), { x: 0.03, y: flies - this.pieHome.y + 0.1, z: 0.03 }, line, pc.Vec3.ZERO, false);
    }
    kit.primitive("pie-platter", "cylinder", pie, V(0, 0, 0), { x: 1, y: 0.05, z: 1 }, gold);
    kit.primitive("pie-dish", "cylinder", pie, V(0, 0.07, 0), { x: 0.74, y: 0.12, z: 0.74 }, kit.material("pewter", new pc.Color(0.62, 0.64, 0.66), 0.7, 0.8));
    kit.primitive("pie-filling", "cylinder", pie, V(0, 0.13, 0), { x: 0.62, y: 0.03, z: 0.62 }, kit.material("pie-filling", new pc.Color(0.22, 0.09, 0.05), 0.4), pc.Vec3.ZERO, false);
    const crust = kit.material("pie-crust", new pc.Color(0.86, 0.6, 0.27), 0.3);
    const browned = kit.material("pie-lattice", new pc.Color(0.7, 0.44, 0.16), 0.3);
    kit.meshEntity("pie-rim", kit.torus(0.32, 0.05, 20, 6), crust, pie).setLocalPosition(0, 0.15, 0);
    this.pieLid = kit.group("pie-lid", pie, V(0, 0.15, 0));
    kit.primitive("pie-dome", "sphere", this.pieLid, V(0, 0.02, 0), { x: 0.64, y: 0.28, z: 0.64 }, crust);
    for (const k of [-0.14, 0, 0.14]) {
      kit.primitive("pie-lattice", "box", this.pieLid, V(k, 0.14 - Math.abs(k) * 0.35, 0), { x: 0.035, y: 0.03, z: 0.52 - Math.abs(k) }, browned, pc.Vec3.ZERO, false);
      kit.primitive("pie-lattice", "box", this.pieLid, V(0, 0.14 - Math.abs(k) * 0.35, k), { x: 0.52 - Math.abs(k), y: 0.03, z: 0.035 }, browned, pc.Vec3.ZERO, false);
    }
    const black = new pc.Color(0.07, 0.065, 0.06);
    const beak = new pc.Color(0.95, 0.6, 0.1);
    kit.primitive("pie-peeker", "sphere", this.pieLid, V(0.13, 0.19, 0.12), { x: 0.1, y: 0.1, z: 0.1 }, kit.material("blackbird", black, 0.5));
    kit.primitive("pie-peeker-beak", "cone", this.pieLid, V(0.13, 0.19, 0.2), { x: 0.035, y: 0.08, z: 0.035 }, kit.material("beak", beak, 0.3), V(90, 0, 0), false);
    const birdBody = kit.boxes("blackbird-body", [
      { center: [0, 0, 0], size: [0.1, 0.1, 0.2], color: black },
      { center: [0, 0.03, 0.12], size: [0.08, 0.08, 0.08], color: black },
      { center: [0, 0.02, 0.19], size: [0.03, 0.03, 0.07], color: beak },
      { center: [0, 0.01, -0.13], size: [0.07, 0.02, 0.1], color: black },
    ]);
    const birdWing = kit.boxes("blackbird-wing", [{ center: [0.09, 0, 0], size: [0.18, 0.015, 0.1], color: black }]);
    const paintBird = kit.paintMaterial(0.35);
    for (let index = 0; index < 24; index += 1) {
      const bird = kit.group("blackbird", this.root);
      kit.meshEntity("blackbird-body", birdBody, paintBird, bird, false);
      // A wing each side, hinged at the shoulder (the left one is the right turned about).
      const wings = [kit.group("wing-l", bird, V(-0.04, 0.04, 0), V(0, 180, 0)), kit.group("wing-r", bird, V(0.04, 0.04, 0))] as [pc.Entity, pc.Entity];
      for (const wing of wings) kit.meshEntity("blackbird-wing", birdWing, paintBird, wing, false);
      // Out of sight until the pie is opened (shrunk, not switched off: the curios are one batch).
      bird.setLocalScale(0.001, 0.001, 0.001);
      this.birds.push({ root: bird, wings });
    }

    // Ding, dong, bell: a stone well with a bell on its gallows and a cat inside.
    const wellAt = at("well");
    const well = kit.group("well", this.root, V(wellAt.x, 0, wellAt.z));
    const stone = kit.material("stone-1", new pc.Color(0.405, 0.392, 0.348), 0.07);
    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2;
      kit.primitive("well-stone", "box", well, V(Math.cos(angle) * 0.55, 0.3, Math.sin(angle) * 0.55), { x: 0.44, y: 0.6, z: 0.26 }, stone, V(0, (-angle * 180) / Math.PI + 90, 0));
    }
    kit.primitive("well-water", "cylinder", well, V(0, 0.35, 0), { x: 0.9, y: 0.02, z: 0.9 }, kit.material("well-dark", new pc.Color(0.05, 0.1, 0.14), 0.9), pc.Vec3.ZERO, false);
    for (const side of [-1, 1]) kit.primitive("well-post", "box", well, V(side * 0.62, 1.05, 0), { x: 0.1, y: 1.5, z: 0.1 }, wood);
    kit.primitive("well-roof", "box", well, V(0, 1.85, 0), { x: 1.6, y: 0.08, z: 0.9 }, kit.material("oak", palette.oak, 0.18), V(0, 0, 0));
    this.bell = kit.group("bell", well, V(0, 1.72, 0));
    kit.primitive("bell", "cone", this.bell, V(0, -0.18, 0), { x: 0.3, y: 0.3, z: 0.3 }, kit.material("gold", palette.gold, 0.72, 0.55));
    this.cat = kit.group("cat", well, V(0, 0.1, 0));
    const tabby = kit.material("cat-tabby", new pc.Color(0.8, 0.5, 0.2), 0.15);
    kit.primitive("cat-head", "sphere", this.cat, V(0, 0, 0), { x: 0.36, y: 0.32, z: 0.3 }, tabby);
    for (const side of [-1, 1]) {
      kit.primitive("cat-ear", "cone", this.cat, V(side * 0.12, 0.18, 0), { x: 0.1, y: 0.14, z: 0.06 }, tabby, pc.Vec3.ZERO, false);
      kit.primitive("cat-eye", "sphere", this.cat, V(side * 0.07, 0.03, 0.14), { x: 0.06, y: 0.07, z: 0.03 }, kit.material("cat-eye", new pc.Color(0.4, 0.8, 0.2), 0.9, 0, { emissive: new pc.Color(0.2, 0.4, 0.05) }), pc.Vec3.ZERO, false);
    }
    this.cat.enabled = false;

    // Little Miss Muffet's spider, dangling from the flies.
    this.spiderHome = at("spider");
    this.spider = kit.group("spider", this.root, this.spiderHome.clone());
    kit.primitive("spider-body", "sphere", this.spider, V(), { x: 0.34, y: 0.3, z: 0.4 }, ink);
    for (let index = 0; index < 8; index += 1) {
      const side = index < 4 ? -1 : 1;
      const row = (index % 4) - 1.5;
      kit.primitive("spider-leg", "box", this.spider, V(side * 0.25, -0.05, row * 0.1), { x: 0.32, y: 0.03, z: 0.03 }, ink, V(0, row * 12, side * -30), false);
    }
    for (const side of [-1, 1]) kit.primitive("spider-eye", "sphere", this.spider, V(side * 0.06, 0.06, 0.18), { x: 0.06, y: 0.06, z: 0.04 }, kit.material("eye-white", new pc.Color(1, 1, 0.98), 0.7), pc.Vec3.ZERO, false);
    this.spiderThread = kit.primitive("spider-thread", "cylinder", this.root, V(), { x: 0.015, y: 1, z: 0.015 }, kit.material("thread", new pc.Color(0.85, 0.85, 0.85), 0.5), pc.Vec3.ZERO, false);
  }

  /** Entities that animate and must stay out of static batches. */
  get animated(): pc.Entity[] {
    return [this.root];
  }

  trigger(id: CurioId, now: number): void {
    const act = this.acts.get(id);
    if (act && now - act.started < 3) return;
    this.acts.set(id, { started: now });
  }

  /**
   * Hickory dickory dock. Left alone, the mouse runs up the clock and down again every so often.
   * Struck, the clock strikes one and the mouse runs down, drops to the boards and bolts for the
   * wings; it's back on its weight a while later.
   */
  private animateMouse(now: number, struck: number): void {
    const mouse = this.mouse;
    const [cone, chainTop, door] = this.mouseTrack.map((mark) => mark.getPosition()) as [pc.Vec3, pc.Vec3, pc.Vec3];
    const place = (at: pc.Vec3, pitch: number, yaw: number): void => {
      mouse.setPosition(at);
      mouse.setEulerAngles(0, yaw, pitch);
      mouse.setLocalScale(1.5, 1.5, 1.5);
    };
    const between = (a: pc.Vec3, b: pc.Vec3, k: number): pc.Vec3 => new pc.Vec3().lerp(a, b, Math.max(0, Math.min(1, k)));
    if (struck < 12) {
      if (struck < 0.3) {
        // A startled hop where it sat.
        place(cone.clone().add(new pc.Vec3(0, Math.sin((struck / 0.3) * Math.PI) * 0.15, 0)), 0, 8);
      } else if (struck < 0.9) {
        // Off the weight and down to the boards.
        const k = (struck - 0.3) / 0.6;
        const floor = new pc.Vec3(cone.x - 0.4, 0.02, cone.z + 0.3);
        const at = between(cone, floor, k);
        at.y = cone.y + (floor.y - cone.y) * k * k;
        place(at, -60 * k, 8);
      } else if (struck < 3) {
        // And away into the wings, stage left, as fast as its legs will go.
        const k = (struck - 0.9) / 2.1;
        const x = cone.x - 0.4 - k * 9;
        place(new pc.Vec3(x, 0.02 + Math.abs(Math.sin(struck * 30)) * 0.03, cone.z + 0.3), 0, 180);
      } else {
        mouse.setLocalScale(0.001, 0.001, 0.001);
      }
      return;
    }
    // Its round: sit on the weight, run up the chain and the case, peek, and back down.
    const t = now % 16;
    if (t < 5 || t >= 13) place(cone, 0, 8 + Math.sin(now * 3) * 6);
    else if (t < 6.4) place(between(cone, chainTop, (t - 5) / 1.4), 90, 8);
    else if (t < 7.6) place(between(chainTop, door, (t - 6.4) / 1.2), 90, 8);
    else if (t < 9.6) place(door, 90 + Math.sin(now * 4) * 10, 8);
    else if (t < 11) place(between(door, chainTop, (t - 9.6) / 1.4), -90, 8);
    else place(between(chainTop, cone, (t - 11) / 2), -90, 8);
  }

  /**
   * When the pie is opened the birds begin to sing: the lid flies off and four-and-twenty
   * blackbirds wheel up out of it and away over the stage. The stagehands send down a fresh pie
   * a little later.
   */
  private animatePie(now: number, opened: number): void {
    const swing = opened < 4 ? Math.sin(opened * 3) * 5 * (1 - opened / 4) : Math.sin(now * 0.7) * 0.8;
    this.pieSwing.setLocalEulerAngles(swing, now * 4, swing * 0.4);
    if (opened > 10) {
      this.pieLid.setLocalPosition(0, 0.15, 0);
      this.pieLid.setLocalEulerAngles(0, 0, 0);
      this.pieLid.setLocalScale(1, 1, 1);
      for (const bird of this.birds) bird.root.setLocalScale(0.001, 0.001, 0.001);
      return;
    }
    if (opened < 1.2) {
      const k = opened / 1.2;
      this.pieLid.setLocalPosition(0.6 * k, 0.15 + Math.sin(k * Math.PI) * 1 - k * 1.4, 0.3 * k);
      this.pieLid.setLocalEulerAngles(k * 280, 0, k * 90);
      this.pieLid.setLocalScale(1, 1, 1);
    } else if (opened < 9) {
      this.pieLid.setLocalScale(0.001, 0.001, 0.001);
    } else {
      // A fresh pie, lowered in from above.
      const k = opened - 9;
      this.pieLid.setLocalScale(k, k, k);
      this.pieLid.setLocalPosition(0, 0.15, 0);
      this.pieLid.setLocalEulerAngles(0, 0, 0);
    }
    const from = this.pieHome;
    this.birds.forEach((bird, index) => {
      const t = opened - index * 0.05;
      if (t <= 0 || opened > 6.5) {
        bird.root.setLocalScale(0.001, 0.001, 0.001);
        return;
      }
      // Each bird wheels out on its own turn of a widening spiral, drifting away over the stage.
      const seed = Math.sin(index * 12.9898) * 43758.5453;
      const jitter = seed - Math.floor(seed);
      const angle = (index / 24) * Math.PI * 2 + t * (1.4 + jitter);
      const radius = 0.3 + t * (1.2 + jitter);
      bird.root.setPosition(
        from.x + Math.cos(angle) * radius - t * t * 0.4,
        from.y + 0.2 + t * (1 + jitter * 0.8) + Math.sin(t * 5 + index) * 0.15,
        from.z + Math.sin(angle) * radius + t * 0.5,
      );
      const size = 1.6 * (opened > 5.8 ? Math.max(0.001, (6.5 - opened) / 0.7) : Math.min(1, t * 4));
      bird.root.setLocalScale(size, size, size);
      bird.root.setEulerAngles(0, (-angle * 180) / Math.PI, 0);
      const flap = Math.sin(now * 28 + index * 1.7) * 45;
      bird.wings[0].setLocalEulerAngles(0, 180, flap);
      bird.wings[1].setLocalEulerAngles(0, 0, flap);
    });
  }

  update(now: number): void {
    const age = (id: CurioId): number => {
      const act = this.acts.get(id);
      return act ? now - act.started : Infinity;
    };
    // The cow jumps over the moon and back again.
    const cow = age("cow");
    if (cow < 5) {
      const leg = cow < 2 ? cow / 2 : cow < 3 ? 1 : 1 - (cow - 3) / 2;
      const k = Math.max(0, Math.min(1, leg));
      const x = this.cowStart.x + (4.2 * k);
      const y = this.cowStart.y + Math.sin(k * Math.PI) * 9;
      this.cow.setLocalPosition(x, y, this.cowStart.z);
      this.cow.setLocalEulerAngles(0, cow < 3 ? 0 : 180, Math.sin(k * Math.PI * 2) * 25);
    } else {
      this.cow.setLocalPosition(this.cowStart);
      this.cow.setLocalEulerAngles(0, 0, Math.sin(now * 2) * 2);
    }
    // The moon winks: a full turn.
    const moon = age("moon");
    this.moon.setLocalEulerAngles(0, 0, moon < 1.2 ? (moon / 1.2) * 360 : 0);
    // Jack falls down and breaks his crown, and Jill comes tumbling after.
    const jj = age("jack-and-jill");
    const tumble = (entity: pc.Entity, delay: number, dx: number): void => {
      const t = Math.max(0, jj - delay);
      if (jj > 7 || jj === Infinity) {
        entity.setLocalPosition(this.hillTop.x + dx, this.hillTop.y, this.hillTop.z);
        entity.setLocalEulerAngles(0, 0, 0);
        return;
      }
      const k = Math.min(1, t / 1.6);
      entity.setLocalPosition(this.hillTop.x + dx + k * 3.4, this.hillTop.y - k * 3.3 + Math.abs(Math.sin(k * Math.PI * 3)) * 0.35, this.hillTop.z + 0.05);
      entity.setLocalEulerAngles(0, 0, -k * 720);
    };
    tumble(this.jack, 0, -0.35);
    tumble(this.jill, 0.5, 0.35);
    tumble(this.pail, 0.2, 0);
    // Tick, tock; and when it is struck, cuckoo! Three times, swinging on its lines.
    const cuckoo = Math.min(age("cuckoo"), age("mouse"));
    this.pendulum.setLocalEulerAngles(0, 0, Math.sin(now * 4.4) * 16);
    const out = cuckoo < 2.4 ? Math.max(0, Math.sin((cuckoo / 0.8) * Math.PI)) : 0;
    this.cuckoo.setLocalPosition(0, 0.44, 0.05 + out * 0.4);
    this.clockDoor.setLocalEulerAngles(0, out > 0.05 ? -100 : 0, 0);
    const swing = cuckoo < 4 ? Math.sin(cuckoo * 2.6) * 2.2 * (1 - cuckoo / 4) : 0;
    this.clockSwing.setLocalEulerAngles(swing, 8, swing * 0.5);
    this.animateMouse(now, age("mouse"));
    this.animatePie(now, age("pie"));
    // Ding, dong, bell; pussy's in the well.
    const well = age("well");
    this.bell.setLocalEulerAngles(well < 2.5 ? Math.sin(well * 14) * 30 * (1 - well / 2.5) : 0, 0, 0);
    this.cat.enabled = well < 4;
    if (this.cat.enabled) {
      const pop = Math.min(1, well / 0.4) * (well > 3.4 ? Math.max(0, 1 - (well - 3.4) / 0.6) : 1);
      this.cat.setLocalPosition(0, 0.1 + pop * 0.55, 0);
    }
    // The spider scuttles up its thread and lowers itself again later.
    const spider = age("spider");
    const lift = spider < 0.6 ? spider / 0.6 : spider < 7 ? 1 : spider < 9 ? 1 - (spider - 7) / 2 : 0;
    const bob = Math.sin(now * 1.3) * 0.15;
    const y = this.spiderHome.y + lift * 7 + (lift === 0 ? bob : 0);
    this.spider.setLocalPosition(this.spiderHome.x, y, this.spiderHome.z);
    this.spider.setLocalEulerAngles(0, now * 20, 0);
    const top = 17;
    this.spiderThread.setLocalPosition(this.spiderHome.x, (y + top) / 2, this.spiderHome.z);
    this.spiderThread.setLocalScale(0.015, Math.max(0.01, top - y), 0.015);
  }
}
