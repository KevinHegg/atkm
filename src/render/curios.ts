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
    this.clockSwing = kit.group("cuckoo-flown", this.root, V(clockAt.x, flies, clockAt.z), V(0, 22, 0));
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
    const cuckoo = age("cuckoo");
    this.pendulum.setLocalEulerAngles(0, 0, Math.sin(now * 4.4) * 16);
    const out = cuckoo < 2.4 ? Math.max(0, Math.sin((cuckoo / 0.8) * Math.PI)) : 0;
    this.cuckoo.setLocalPosition(0, 0.44, 0.05 + out * 0.4);
    this.clockDoor.setLocalEulerAngles(0, out > 0.05 ? -100 : 0, 0);
    const swing = cuckoo < 4 ? Math.sin(cuckoo * 2.6) * 2.2 * (1 - cuckoo / 4) : 0;
    this.clockSwing.setLocalEulerAngles(swing, 22, swing * 0.5);
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
