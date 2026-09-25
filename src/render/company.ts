import * as pc from "playcanvas";
import { CURIOS, DUKE_HILL } from "../sim/curios.js";
import { palette, type Kit } from "./kit.js";

const V = (x = 0, y = 0, z = 0): pc.Vec3 => new pc.Vec3(x, y, z);

type Box = { center: [number, number, number]; size: [number, number, number]; color: pc.Color };

const BLACK = new pc.Color(0.07, 0.065, 0.06);
const CAP = new pc.Color(0.2, 0.19, 0.17);
const SKIN = palette.skin;

/**
 * The rest of the company: the stagehands who work the hoist and mop up afterwards,
 * Old King Cole in his box, and the Grand Old Duke of York's men on the painted hill.
 * Static parts are baked into single meshes so the busy stage stays cheap to draw.
 */
export class Company {
  private readonly kit: Kit;
  private readonly root: pc.Entity;
  private readonly haulers: Stagehand[];
  private readonly haulerYaw = [-60, -120];
  private readonly mopper: Stagehand;
  private readonly mop: pc.Entity;
  private readonly king: KingRig;
  /** The box and everyone in it, above the stilts: it rattles when the stilts are struck. */
  private readonly boxSway: pc.Entity;
  private readonly fiddlers: Array<{ root: pc.Entity; bow: pc.Entity }> = [];
  private readonly soldiers: Array<{ root: pc.Entity; offset: number }> = [];
  private readonly duke: pc.Entity;
  private readonly puff: (at: pc.Vec3) => void;
  private kingAct: { kind: "outrage" | "cheer" | "sulk" | "laugh"; started: number } | undefined;
  private dukeHit = -99;
  private handsHit = -99;
  private towerHit = -99;
  private sandwichLost = false;
  private dustDone = true;
  private mopJob: { at: pc.Vec3; started: number } | undefined;
  private nextPipe = 4;

  constructor(kit: Kit, parent: pc.Entity, staticParent: pc.Entity, puff: (at: pc.Vec3) => void) {
    this.kit = kit;
    this.puff = puff;
    this.root = kit.group("company", parent);

    // Two stagehands at the fly line, upstage right under the royal box, and a third with a mop.
    const rope = kit.material("rope", palette.rope, 0.12);
    kit.primitive("fly-line", "cylinder", staticParent, V(12.1, 8, -8.3), { x: 0.05, y: 16, z: 0.05 }, rope);
    kit.primitive("fly-cleat", "box", staticParent, V(12.1, 1.1, -8.3), { x: 0.18, y: 0.08, z: 0.08 }, kit.material("iron", palette.iron, 0.55, 0.68));
    this.haulers = [
      buildStagehand(kit, this.root, "sandwich", V(12.55, 0, -8.55), this.haulerYaw[0]!),
      buildStagehand(kit, this.root, "none", V(12.6, 0, -7.75), this.haulerYaw[1]!),
    ];
    this.mopper = buildStagehand(kit, this.root, "none", V(17, 0, 0), -90);
    this.mopper.root.name = "mopper";
    this.mop = kit.group("mop", this.mopper.armR, V(0, -0.55, 0.05));
    kit.primitive("mop-pole", "cylinder", this.mop, V(0, 0.15, 0.1), { x: 0.04, y: 1.6, z: 0.04 }, kit.material("oak-light", palette.oakLight, 0.2), V(20, 0, 0), false);
    kit.primitive("mop-head", "cylinder", this.mop, V(0, -0.62, 0.38), { x: 0.3, y: 0.18, z: 0.3 }, kit.material("mop-strands", palette.cream, 0.1), V(20, 0, 0), false);
    this.mopper.root.enabled = false;

    // Old King Cole's box, high on braced stilts at stage right, looking down on the stage.
    const box = CURIOS.find((curio) => curio.id === "king")!.at;
    const floor = 4.1;
    const crimson = palette.king;
    const gold = palette.gold;
    const timber = palette.oakDark;
    const stilts = kit.group("royal-box-stilts", staticParent, V(box.x, 0, box.z), V(0, -28, 0));
    const legX = 0.95;
    const legZ = 0.78;
    const stiltParts: Box[] = [];
    for (const x of [-legX, legX]) {
      for (const z of [-legZ, legZ]) {
        stiltParts.push(
          { center: [x, 0.14, z], size: [0.44, 0.28, 0.44], color: palette.stone },
          { center: [x, floor / 2, z], size: [0.22, floor, 0.22], color: timber },
          { center: [x, 0.62, z], size: [0.28, 0.08, 0.28], color: gold },
          { center: [x, floor - 0.3, z], size: [0.28, 0.08, 0.28], color: gold },
        );
      }
    }
    for (const y of [1.45, 2.85]) {
      for (const z of [-legZ, legZ]) stiltParts.push({ center: [0, y, z], size: [legX * 2, 0.13, 0.12], color: timber });
      for (const x of [-legX, legX]) stiltParts.push({ center: [x, y, 0], size: [0.12, 0.13, legZ * 2], color: timber });
    }
    // A ladder up the side, for the King (and, on a bad night, the fiddlers).
    for (const z of [-0.26, 0.26]) stiltParts.push({ center: [legX + 0.2, (floor + 0.5) / 2, z], size: [0.07, floor + 0.5, 0.07], color: palette.oak });
    for (let rung = 0.4; rung < floor; rung += 0.38) stiltParts.push({ center: [legX + 0.2, rung, 0], size: [0.06, 0.05, 0.52], color: palette.oak });
    kit.meshEntity("royal-box-stilts", kit.boxes("royal-box-stilts", stiltParts), kit.paintMaterial(0.2), stilts);
    // Cross-bracing: an X in every bay, front and back, and a diagonal down each side.
    const brace = kit.material("oak-dark", timber, 0.16);
    const bays: Array<[number, number]> = [[0.3, 1.45], [1.45, 2.85], [2.85, floor - 0.1]];
    for (const [low, high] of bays) {
      const rise = high - low;
      const across = Math.hypot(legX * 2, rise);
      const tilt = (Math.atan2(rise, legX * 2) * 180) / Math.PI;
      for (const z of [-legZ - 0.06, legZ + 0.06]) {
        for (const sign of [-1, 1]) kit.primitive("brace", "box", stilts, V(0, (low + high) / 2, z), { x: across, y: 0.09, z: 0.06 }, brace, V(0, 0, sign * tilt));
      }
      const deep = Math.hypot(legZ * 2, rise);
      const lean = (Math.atan2(rise, legZ * 2) * 180) / Math.PI;
      for (const x of [-legX - 0.06, legX + 0.06]) kit.primitive("brace", "box", stilts, V(x, (low + high) / 2, 0), { x: 0.06, y: 0.09, z: deep }, brace, V(x < 0 ? lean : -lean, 0, 0));
    }

    this.boxSway = kit.group("royal-box", this.root, V(box.x, floor, box.z), V(0, -28, 0));
    const boxParts: Box[] = [
      { center: [0, -0.2, 0], size: [2.1, 0.24, 1.8], color: shade(crimson, 0.6) },
      { center: [0, -0.05, 0], size: [2.2, 0.14, 1.9], color: palette.oakDark },
      { center: [0, 0.42, 0.9], size: [2.2, 0.8, 0.12], color: crimson },
      { center: [0, 0.84, 0.92], size: [2.3, 0.08, 0.18], color: gold },
      { center: [0, 0.08, 0.92], size: [2.3, 0.08, 0.16], color: gold },
      { center: [-1.08, 0.42, 0], size: [0.12, 0.8, 1.9], color: crimson },
      { center: [1.08, 0.42, 0], size: [0.12, 0.8, 1.9], color: crimson },
      { center: [0, 1.3, -0.92], size: [2.2, 2.6, 0.1], color: shade(crimson, 0.55) },
      { center: [0, 2.55, 0.1], size: [2.4, 0.26, 2.1], color: crimson },
      { center: [0, 2.4, 1.14], size: [2.4, 0.1, 0.06], color: gold },
    ];
    for (let index = 0; index < 6; index += 1) {
      boxParts.push({ center: [-1 + index * 0.4, 2.3, 1.12], size: [0.34, 0.26, 0.04], color: index % 2 ? gold : crimson });
    }
    kit.meshEntity("royal-box", kit.boxes("royal-box", boxParts), kit.paintMaterial(0.25), this.boxSway);
    kit.primitive("box-crest", "sphere", this.boxSway, V(0, 0.46, 0.98), { x: 0.36, y: 0.36, z: 0.08 }, kit.material("gold", gold, 0.72, 0.55));
    // He sits on a tall throne, so he can be seen over the front of the box.
    const kingRoot = kit.group("king-cole", this.boxSway, V(0, 0.4, 0));
    this.king = buildKing(kit, kingRoot);
    for (const [dx, dz] of [[-0.75, -0.45], [0.75, -0.45], [0.05, -0.62]] as const) {
      const fiddler = kit.group("fiddler", kingRoot, V(dx, -0.1, dz));
      kit.meshEntity("fiddler-body", kit.boxes("fiddler", [
        { center: [0, 0.35, 0], size: [0.26, 0.5, 0.18], color: palette.queen },
        { center: [0, 0.72, 0], size: [0.2, 0.22, 0.18], color: SKIN },
        { center: [0, 0.86, 0], size: [0.24, 0.07, 0.22], color: BLACK },
        { center: [-0.1, 0.55, 0.1], size: [0.08, 0.3, 0.14], color: palette.oak },
      ]), kit.paintMaterial(0.2), fiddler);
      const bow = kit.group("bow", fiddler, V(0.12, 0.55, 0.12));
      kit.primitive("bow-stick", "box", bow, V(-0.12, 0, 0), { x: 0.34, y: 0.02, z: 0.02 }, kit.material("oak-light", palette.oakLight, 0.2), pc.Vec3.ZERO, false);
      this.fiddlers.push({ root: fiddler, bow });
    }

    // The Grand Old Duke of York marches his men up the hill and down again.
    const hill = kit.material("duke-hill", new pc.Color(0.15, 0.25, 0.14), 0.03);
    kit.primitive("duke-hill", "cylinder", staticParent, V(DUKE_HILL.x, DUKE_HILL.y, DUKE_HILL.z), { x: DUKE_HILL.radius * 2, y: 0.06, z: DUKE_HILL.radius * 2 }, hill, V(90, 0, 0), false);
    const soldier = kit.boxes("duke-soldier", [
      { center: [0, 0.1, 0], size: [0.1, 0.2, 0.02], color: BLACK },
      { center: [0, 0.3, 0], size: [0.16, 0.22, 0.02], color: crimson },
      { center: [0, 0.3, 0.012], size: [0.03, 0.22, 0.01], color: palette.cream },
      { center: [0, 0.46, 0], size: [0.1, 0.1, 0.02], color: SKIN },
      { center: [0, 0.57, 0], size: [0.12, 0.16, 0.02], color: BLACK },
      { center: [0.09, 0.42, 0], size: [0.02, 0.44, 0.02], color: palette.oakLight },
    ]);
    const paint = kit.paintMaterial(0.15);
    for (let index = 0; index < 9; index += 1) {
      const man = kit.group("duke-man", this.root);
      kit.meshEntity("duke-man-flat", soldier, paint, man, false);
      this.soldiers.push({ root: man, offset: 0.55 + index * 0.42 });
    }
    this.duke = kit.group("duke", this.root);
    kit.meshEntity("duke-flat", kit.boxes("duke-horse", [
      { center: [0, 0.3, 0], size: [0.5, 0.18, 0.02], color: palette.cream },
      { center: [-0.18, 0.12, 0], size: [0.05, 0.22, 0.02], color: palette.cream },
      { center: [0.18, 0.12, 0], size: [0.05, 0.22, 0.02], color: palette.cream },
      { center: [0.3, 0.44, 0], size: [0.12, 0.2, 0.02], color: palette.cream },
      { center: [0, 0.5, 0], size: [0.14, 0.24, 0.02], color: crimson },
      { center: [0, 0.68, 0], size: [0.1, 0.1, 0.02], color: SKIN },
      { center: [0, 0.78, 0], size: [0.2, 0.08, 0.02], color: BLACK },
      { center: [0.1, 0.72, 0], size: [0.03, 0.3, 0.02], color: palette.gold },
    ]), paint, this.duke, false);
  }

  /** The moving figures, for the view to batch. */
  get actors(): pc.Entity {
    return this.root;
  }

  /** Where the King's head is, for his speech bubbles. */
  kingHead(): pc.Vec3 {
    return this.king.head.getPosition().clone().add(V(0, 0.5, 0));
  }

  /** New verse: everyone back to their marks. */
  reset(): void {
    this.mopJob = undefined;
    this.mopper.root.enabled = false;
    this.kingAct = undefined;
    this.dukeHit = -99;
    this.handsHit = -99;
    this.towerHit = -99;
    this.sandwichLost = false;
    this.dustDone = true;
  }

  /** A shot through the fly-line crew: both go over like skittles, and the sandwich is lost. */
  stagehandsStruck(now: number): void {
    if (now - this.handsHit < 3.4) return;
    this.handsHit = now;
    this.sandwichLost = true;
    this.dustDone = false;
  }

  /** A shot into the stilts: the whole box shudders, and the King is not amused. */
  towerStruck(now: number): void {
    this.towerHit = now;
    this.kingReacts("outrage", now);
  }

  /** Something the King has an opinion about. */
  kingReacts(kind: "outrage" | "cheer" | "sulk" | "laugh", now: number): void {
    if (this.kingAct && this.kingAct.kind === "outrage" && now - this.kingAct.started < 3) return;
    this.kingAct = { kind, started: now };
  }

  dukeStruck(now: number): void {
    if (now - this.dukeHit > 3) this.dukeHit = now;
  }

  /** The egg is broken: send on the stagehand with the mop. */
  mopUp(at: pc.Vec3, now: number): void {
    this.mopJob = { at: V(at.x + 0.7, 0, at.z + 0.4), started: now + 0.6 };
  }

  update(now: number, hoisting: boolean): void {
    this.animateHaulers(now, hoisting);
    this.animateMopper(now);
    this.animateKing(now);
    this.animateDuke(now);
  }

  private animateHaulers(now: number, hoisting: boolean): void {
    // Knocked flat: over backwards, a moment on the boards, then up again rubbing their heads.
    const hit = now - this.handsHit;
    const down = hit < 0.25 ? Math.sin((hit / 0.25) * Math.PI * 0.5) : hit < 2.6 ? 1 : hit < 3.4 ? 1 - (hit - 2.6) / 0.8 : 0;
    if (!this.dustDone && hit > 0.25) {
      this.dustDone = true;
      for (const hand of this.haulers) this.puff(hand.root.getPosition().clone().add(V(0, 0.2, 0)));
    }
    this.haulers.forEach((hand, index) => {
      const fall = new pc.Quat().setFromEulerAngles(0, this.haulerYaw[index]!, 0).mul(new pc.Quat().setFromEulerAngles(-84 * down, 0, 0));
      hand.root.setLocalRotation(fall);
      if (hand.prop && this.sandwichLost) hand.prop.enabled = false;
      if (down > 0) {
        hand.armL.setLocalEulerAngles(150 - down * 40, 0, 30 + Math.sin(now * 20 + index) * 10 * down);
        hand.armR.setLocalEulerAngles(150 - down * 40, 0, -30 - Math.sin(now * 20 + index) * 10 * down);
        hand.legL.setLocalEulerAngles(down * 30, 0, 0);
        hand.legR.setLocalEulerAngles(-down * 10, 0, 0);
        hand.head.setLocalEulerAngles(hit > 2.6 ? Math.sin(now * 9) * 10 : 0, 0, 0);
        return;
      }
      hand.legL.setLocalEulerAngles(0, 0, 0);
      hand.legR.setLocalEulerAngles(0, 0, 0);
      if (hoisting) {
        // Hand over hand on the fly line.
        const phase = now * 5 + index * 1.7;
        hand.armL.setLocalEulerAngles(150 + Math.sin(phase) * 35, 0, 8);
        hand.armR.setLocalEulerAngles(150 + Math.sin(phase + Math.PI) * 35, 0, -8);
        hand.body.setLocalEulerAngles(-10 + Math.sin(phase) * 4, 0, 0);
        hand.body.setLocalPosition(0, Math.abs(Math.sin(phase)) * 0.04, 0);
        if (hand.prop) hand.prop.enabled = false;
        return;
      }
      hand.body.setLocalEulerAngles(0, 0, 0);
      hand.body.setLocalPosition(0, Math.sin(now * 1.5 + index) * 0.01, 0);
      if (hand.prop) hand.prop.enabled = !this.sandwichLost;
      if (index === 0) {
        // A bite of sandwich every few seconds.
        const bite = Math.max(0, Math.sin(((now % 4.5) / 4.5) * Math.PI * 2 - 1.2));
        hand.armR.setLocalEulerAngles(40 + bite * 95, 0, -20 * bite);
        hand.armL.setLocalEulerAngles(8, 0, 6);
        hand.head.setLocalEulerAngles(-bite * 8, 0, 0);
      } else {
        // Arms folded, dozing, with the odd yawn.
        const yawn = Math.max(0, Math.sin(((now % 9) / 9) * Math.PI * 2) - 0.8) * 5;
        hand.armL.setLocalEulerAngles(70, 0, -55);
        hand.armR.setLocalEulerAngles(70, 0, 55);
        hand.head.setLocalEulerAngles(12 - yawn * 30 + Math.sin(now * 0.7) * 3, 0, 0);
      }
    });
  }

  private animateMopper(now: number): void {
    const job = this.mopJob;
    const hand = this.mopper;
    if (!job || now < job.started) {
      hand.root.enabled = false;
      return;
    }
    const wing = V(16.5, 0, job.at.z);
    // He scurries: nobody wants to be on stage with the audience watching.
    const walk = wing.distance(job.at) / 6.5;
    const mop = 3.2;
    const t = now - job.started;
    let position: pc.Vec3;
    let facing: number;
    let scrub = 0;
    if (t < walk) {
      position = new pc.Vec3().lerp(wing, job.at, t / walk);
      facing = Math.atan2(job.at.x - wing.x, job.at.z - wing.z);
    } else if (t < walk + mop) {
      position = job.at.clone();
      facing = Math.atan2(-0.7, -0.4);
      scrub = Math.sin((t - walk) * 9);
    } else if (t < walk * 2 + mop) {
      position = new pc.Vec3().lerp(job.at, wing, (t - walk - mop) / walk);
      facing = Math.atan2(wing.x - job.at.x, wing.z - job.at.z);
    } else {
      this.mopJob = undefined;
      hand.root.enabled = false;
      return;
    }
    hand.root.enabled = true;
    hand.root.setLocalPosition(position);
    hand.root.setLocalEulerAngles(0, (facing * 180) / Math.PI, 0);
    const stride = scrub ? 0 : Math.sin(now * 14);
    hand.legL.setLocalEulerAngles(stride * 35, 0, 0);
    hand.legR.setLocalEulerAngles(-stride * 35, 0, 0);
    hand.armL.setLocalEulerAngles(55 + scrub * 12, 0, 20);
    hand.armR.setLocalEulerAngles(55 + scrub * 12, 0, -20);
    this.mop.setLocalEulerAngles(0, scrub * 30, 0);
    hand.body.setLocalPosition(0, Math.abs(stride) * 0.05, 0);
  }

  private animateKing(now: number): void {
    // The box shudders on its stilts, dying away.
    const shake = now - this.towerHit;
    const sway = shake < 1.8 ? Math.sin(shake * 19) * 3.2 * (1 - shake / 1.8) : 0;
    this.boxSway.setLocalEulerAngles(sway, -28, sway * 0.6);
    const king = this.king;
    const act = this.kingAct;
    const age = act ? now - act.started : Infinity;
    const merry = Math.sin(now * 1.6);
    let crownLift = 0;
    let lean = merry * 3;
    let armR = 40 + Math.sin(now * 0.8) * 6;
    let armL = 30;
    let headTilt = merry * 4;
    let playing = false;
    if (act && age < 3.5) {
      if (act.kind === "outrage") {
        crownLift = age < 0.8 ? Math.sin((age / 0.8) * Math.PI) * 0.9 : 0;
        armR = 150 + Math.sin(age * 16) * 25;
        lean = -6;
        playing = age > 1.2;
      } else if (act.kind === "cheer") {
        armR = 160 + Math.sin(age * 12) * 12;
        armL = 160 + Math.sin(age * 12 + 1) * 12;
        lean = Math.sin(age * 10) * 5;
      } else if (act.kind === "sulk") {
        armR = 120;
        armL = 120;
        headTilt = 25;
        lean = 12;
      } else {
        lean = Math.sin(age * 18) * 6;
        headTilt = -10 + Math.sin(age * 18) * 6;
      }
    } else if (act && age >= 3.5) {
      this.kingAct = undefined;
    }
    king.body.setLocalEulerAngles(lean, 0, 0);
    king.head.setLocalEulerAngles(headTilt, merry * 6, 0);
    king.crown.setLocalPosition(0, 0.3 + crownLift, 0);
    king.crown.setLocalEulerAngles(0, crownLift * 360, 0);
    king.armR.setLocalEulerAngles(armR, 0, -10);
    king.armL.setLocalEulerAngles(armL, 0, 10);
    for (const [index, fiddler] of this.fiddlers.entries()) {
      fiddler.bow.setLocalEulerAngles(0, playing ? Math.sin(now * 16 + index) * 35 : 0, 0);
      fiddler.root.setLocalPosition(fiddler.root.getLocalPosition().x, -0.1 + (playing ? Math.abs(Math.sin(now * 8 + index)) * 0.05 : 0), fiddler.root.getLocalPosition().z);
    }
    if (now > this.nextPipe && !act) {
      // A merry old soul, puffing his pipe.
      this.nextPipe = now + 5 + Math.random() * 4;
      this.puff(king.pipe.getPosition().clone());
    }
  }

  private animateDuke(now: number): void {
    // Up the hill and down again, on a loop; about-turn at each end.
    const span = 7.4;
    const hit = now - this.dukeHit;
    const place = (entity: pc.Entity, along: number, fallen: number): void => {
      const lap = ((along % (span * 2)) + span * 2) % (span * 2);
      const outbound = lap < span;
      const s = outbound ? lap : span * 2 - lap;
      const x = DUKE_HILL.x - span / 2 + s;
      const dx = x - DUKE_HILL.x;
      const y = DUKE_HILL.y + Math.sqrt(Math.max(0, DUKE_HILL.radius * DUKE_HILL.radius - dx * dx));
      const bob = Math.abs(Math.sin(now * 7 + along)) * 0.04;
      entity.setLocalPosition(x, y + bob, DUKE_HILL.z + 0.08);
      // About turn: a half turn, not a mirror, so the figures can share a draw call.
      entity.setLocalEulerAngles(0, outbound ? 0 : 180, -fallen * 85);
    };
    const march = now * 0.55;
    this.soldiers.forEach((soldier, index) => {
      const delay = index * 0.09;
      const fallen = hit < 3.2 ? Math.min(1, Math.max(0, (hit - delay) / 0.18)) * (hit > 2.6 ? Math.max(0, 1 - (hit - 2.6) / 0.4) : 1) : 0;
      place(soldier.root, march - soldier.offset, fallen);
    });
    const rear = hit < 1.5 ? Math.sin((hit / 1.5) * Math.PI) * 0.4 : 0;
    place(this.duke, march, 0);
    const turned = this.duke.getLocalEulerAngles();
    this.duke.setLocalEulerAngles(turned.x, turned.y, turned.z + rear * 40);
  }
}

interface Stagehand {
  root: pc.Entity;
  body: pc.Entity;
  head: pc.Entity;
  armL: pc.Entity;
  armR: pc.Entity;
  legL: pc.Entity;
  legR: pc.Entity;
  prop?: pc.Entity;
}

function buildStagehand(kit: Kit, parent: pc.Entity, prop: "sandwich" | "none", at: pc.Vec3, yaw: number): Stagehand {
  const root = kit.group("stagehand", parent, at, V(0, yaw, 0));
  const body = kit.group("stagehand-body", root);
  const paint = kit.paintMaterial(0.15);
  kit.meshEntity("stagehand-torso", kit.boxes("stagehand-torso", [
    { center: [0, 1.05, 0], size: [0.42, 0.6, 0.26], color: BLACK },
    { center: [0, 1.37, 0], size: [0.2, 0.06, 0.2], color: SKIN },
  ]), paint, body);
  const head = kit.group("stagehand-head", body, V(0, 1.52, 0));
  kit.meshEntity("stagehand-head", kit.boxes("stagehand-head", [
    { center: [0, 0.04, 0], size: [0.28, 0.3, 0.26], color: SKIN },
    { center: [0, 0.2, 0.02], size: [0.32, 0.08, 0.34], color: CAP },
    { center: [0, 0.17, 0.2], size: [0.28, 0.03, 0.12], color: CAP },
    { center: [0.07, 0.07, 0.13], size: [0.04, 0.04, 0.02], color: palette.ink },
    { center: [-0.07, 0.07, 0.13], size: [0.04, 0.04, 0.02], color: palette.ink },
    { center: [0, -0.05, 0.13], size: [0.12, 0.03, 0.02], color: shade(SKIN, 0.7) },
  ]), paint, head);
  const limb = (name: string, x: number, y: number, color: pc.Color, length: number): pc.Entity => {
    const group = kit.group(name, body, V(x, y, 0));
    kit.meshEntity(name, kit.boxes(`stagehand-${name}-${length}`, [
      { center: [0, -length / 2, 0], size: [0.12, length, 0.12], color },
      { center: [0, -length - 0.05, 0.02], size: [0.12, 0.1, name.startsWith("leg") ? 0.22 : 0.12], color: name.startsWith("leg") ? palette.ink : SKIN },
    ]), paint, group);
    return group;
  };
  const armL = limb("arm-l", -0.27, 1.3, BLACK, 0.5);
  const armR = limb("arm-r", 0.27, 1.3, BLACK, 0.5);
  const legL = limb("leg-l", -0.1, 0.75, CAP, 0.66);
  const legR = limb("leg-r", 0.1, 0.75, CAP, 0.66);
  let item: pc.Entity | undefined;
  if (prop === "sandwich") {
    item = kit.group("sandwich", armR, V(0, -0.58, 0.08));
    kit.meshEntity("sandwich", kit.boxes("sandwich", [
      { center: [0, 0, 0], size: [0.2, 0.05, 0.14], color: palette.oakLight },
      { center: [0, 0.035, 0], size: [0.21, 0.025, 0.15], color: new pc.Color(0.4, 0.62, 0.25) },
      { center: [0, 0.065, 0], size: [0.2, 0.05, 0.14], color: palette.oakLight },
    ]), paint, item, false);
  }
  return { root, body, head, armL, armR, legL, legR, ...(item ? { prop: item } : {}) };
}

interface KingRig {
  body: pc.Entity;
  head: pc.Entity;
  crown: pc.Entity;
  armL: pc.Entity;
  armR: pc.Entity;
  pipe: pc.Entity;
}

/** A merry old soul: robe, ermine, beard, a very large crown, a pipe and a bowl. */
function buildKing(kit: Kit, parent: pc.Entity): KingRig {
  const paint = kit.paintMaterial(0.25);
  const body = kit.group("king-body", parent, V(0, 0, 0.1));
  const ermine = new pc.Color(0.93, 0.9, 0.84);
  kit.meshEntity("king-robe", kit.boxes("king-robe", [
    { center: [0, 0.5, 0], size: [0.8, 0.9, 0.6], color: palette.king },
    { center: [0, 0.62, 0.2], size: [0.66, 0.5, 0.28], color: shade(palette.king, 1.15) },
    { center: [0, 0.98, 0], size: [0.86, 0.16, 0.64], color: ermine },
    { center: [-0.2, 0.98, 0.33], size: [0.05, 0.05, 0.01], color: palette.ink },
    { center: [0.15, 0.99, 0.33], size: [0.05, 0.05, 0.01], color: palette.ink },
    { center: [0, 0.42, 0.31], size: [0.08, 0.5, 0.02], color: palette.gold },
  ]), paint, body);
  const head = kit.group("king-head", body, V(0, 1.22, 0.02));
  kit.meshEntity("king-face", kit.boxes("king-face", [
    { center: [0, 0, 0], size: [0.4, 0.38, 0.36], color: SKIN },
    { center: [0, -0.2, 0.08], size: [0.42, 0.22, 0.26], color: ermine },
    { center: [-0.13, -0.02, 0.18], size: [0.08, 0.07, 0.02], color: new pc.Color(0.85, 0.4, 0.38) },
    { center: [0.13, -0.02, 0.18], size: [0.08, 0.07, 0.02], color: new pc.Color(0.85, 0.4, 0.38) },
    { center: [-0.08, 0.07, 0.185], size: [0.05, 0.03, 0.01], color: palette.ink },
    { center: [0.08, 0.07, 0.185], size: [0.05, 0.03, 0.01], color: palette.ink },
    { center: [0, 0.01, 0.2], size: [0.07, 0.08, 0.05], color: shade(SKIN, 0.85) },
  ]), paint, head);
  const crown = kit.group("king-crown", head, V(0, 0.3, 0));
  const gold = kit.material("gold", palette.gold, 0.72, 0.55);
  kit.primitive("crown-band", "cylinder", crown, V(0, -0.02, 0), { x: 0.44, y: 0.14, z: 0.42 }, gold);
  for (let index = 0; index < 5; index += 1) {
    const angle = (index / 5) * Math.PI * 2;
    kit.primitive("crown-point", "cone", crown, V(Math.cos(angle) * 0.18, 0.12, Math.sin(angle) * 0.18), { x: 0.09, y: 0.2, z: 0.09 }, gold, pc.Vec3.ZERO, false);
  }
  const arm = (name: string, x: number): pc.Entity => {
    const group = kit.group(name, body, V(x, 0.9, 0.05));
    kit.meshEntity(name, kit.boxes(`king-${name}`, [
      { center: [0, -0.22, 0], size: [0.18, 0.44, 0.18], color: palette.king },
      { center: [0, -0.4, 0], size: [0.2, 0.08, 0.2], color: ermine },
      { center: [0, -0.5, 0.02], size: [0.12, 0.12, 0.12], color: SKIN },
    ]), paint, group);
    return group;
  };
  const armL = arm("arm-l", -0.48);
  const armR = arm("arm-r", 0.48);
  const pipe = kit.group("king-pipe", armR, V(0, -0.56, 0.12));
  kit.meshEntity("pipe", kit.boxes("king-pipe", [
    { center: [0, 0, 0.06], size: [0.04, 0.04, 0.2], color: palette.oakDark },
    { center: [0, 0.05, 0.17], size: [0.09, 0.12, 0.09], color: palette.oakDark },
  ]), paint, pipe, false);
  const bowl = kit.group("king-bowl", armL, V(0, -0.58, 0.1));
  kit.primitive("bowl", "cone", bowl, V(0, 0.06, 0), { x: 0.2, y: 0.14, z: 0.2 }, gold, V(180, 0, 0), false);
  return { body, head, crown, armL, armR, pipe };
}

function shade(color: pc.Color, k: number): pc.Color {
  return new pc.Color(Math.min(1, color.r * k), Math.min(1, color.g * k), Math.min(1, color.b * k));
}
