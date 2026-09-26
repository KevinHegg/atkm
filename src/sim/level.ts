import { axisAngle, quatFromBasis } from "./geometry.js";
import type { BlockMaterial, CueKind, FixtureLook, Quat, StarHolder, StockKind, Vec3 } from "./types.js";

export interface BlockDef {
  kind: "block";
  material: BlockMaterial;
  pos: Vec3;
  size: Vec3;
  yaw: number;
}

export interface KegDef {
  kind: "keg";
  pos: Vec3;
  /** Lying on its side, ready to roll this way (radians, like a fixture's yaw). */
  lie?: number;
  /** A fuse that lights once it's rolling, and burns this many seconds. */
  fuse?: number;
}

export interface HayDef {
  kind: "hay";
  pos: Vec3;
  yaw: number;
}

/** Immovable scenery in the playing area: posts, hedges, bumpers. */
export interface FixtureDef {
  kind: "fixture";
  look: FixtureLook;
  pos: Vec3;
  size: Vec3;
  yaw: number;
  /** Restitution for bumpers; shots ricochet off anything above 0.5. */
  bounce?: number;
  /** Multiplier on Humpty's impact speed (a hedge is springy). */
  soft?: number;
  /** A stage cue: any shot that strikes this fixture calls it. */
  cue?: CueKind;
  /** A springy bed: Humpty landing on it is thrown back up at this speed (m/s). */
  spring?: number;
}

/** A clockwork turntable on an iron column; Humpty rides a seat at the end of its arm. */
export interface TurntableDef {
  kind: "turntable";
  /** Centre of the disc's top surface. */
  pos: Vec3;
  radius: number;
  arm: number;
  /** Clockwork speed in radians per second; shots can spin it faster or backwards. */
  speed: number;
  /** Starting angle of the arm (0 points toward +x). */
  angle: number;
}

/** A royal swing: a seat hung on ropes from a fixed frame. Shot passing through a rope cuts it. */
export interface SwingDef {
  kind: "swing";
  /** Centre of the seat's top surface. */
  pos: Vec3;
  width: number;
  /** Height of the frame's cross-beam. */
  beam: number;
  /** A cradle: two lines from a bough, deep sides, and the wind can rock it. */
  cradle?: boolean;
}

/** A see-saw on a fixed fulcrum with a bucket for Humpty at the low (-x) end. */
export interface SeesawDef {
  kind: "seesaw";
  /** The pivot point. */
  pos: Vec3;
  length: number;
  /** Starting tilt in radians; the bucket end rests on a stop. */
  tilt: number;
  /** How far toward the high (+x) end the pivot sits: a long bucket arm throws harder. */
  offset: number;
}

/** A paint pot on top of a painter's stepladder. Knock it onto a head. */
export interface BucketDef {
  kind: "bucket";
  /** Where the bucket sits (its centre). */
  pos: Vec3;
}

/** A stage-weight sandbag hanging on a line from the flies: a wrecking ball, once pushed. */
export interface SandbagDef {
  kind: "sandbag";
  /** Centre of the bag. */
  pos: Vec3;
  /** Height of the fly gallery the line hangs from. */
  top: number;
}

/** An iron-bound chest of the Queen's powder. Any shot that reaches it forces it open. */
export interface ChestDef {
  kind: "chest";
  /** Centre of the chest. */
  pos: Vec3;
  yaw: number;
}

/**
 * A weathercock: a bronze plate on a pivot that shots bounce off cleanly. Every blow turns it a
 * step further round, so one shot sets it and the next banks off it.
 */
export interface VaneDef {
  kind: "vane";
  /** Centre of the plate. */
  pos: Vec3;
  width: number;
  height: number;
  /** Where it starts (radians, like a fixture's yaw), and how far each blow turns it. */
  angle: number;
  step: number;
}

/**
 * A wooden trough on trestles, with a hopper at the top: a lobbed bomb that drops in rolls down
 * it and out of the far end, fuse fizzing. `path` runs down the middle of the trough's floor.
 */
export interface ChuteDef {
  kind: "chute";
  path: Vec3[];
  width: number;
  /** A hopper over the head of the trough (chutes have one; a barrel ramp doesn't). */
  hopper?: boolean;
  /** Slick boards for a bomb to slide on; a barrel ramp has ordinary ones to roll on. */
  slick?: boolean;
}

/**
 * Here we go round the mulberry bush: cut-out children on arms that turn round a painted bush
 * at a steady pace. Shots glance off them, so where one goes depends on when it arrives.
 */
export interface CarouselDef {
  kind: "carousel";
  /** The axis, on the boards. */
  pos: Vec3;
  /** Height of the middle of the paddles above the boards. */
  y: number;
  inner: number;
  outer: number;
  height: number;
  paddles: number;
  /** Radians per second (positive turns anticlockwise seen from above), and the starting turn. */
  speed: number;
  angle: number;
}

/** A portcullis between two piers. Strike its counterweight and it winds up for a while. */
export interface GateDef {
  kind: "gate";
  /** Bottom middle of the opening, on the boards. */
  pos: Vec3;
  width: number;
  height: number;
  yaw: number;
}

/** The King's china dresser: a painted cupboard and plate rack, its shelves full of china. */
export interface DresserDef {
  kind: "dresser";
  /** Middle of its foot, on the boards. */
  pos: Vec3;
  yaw: number;
}

export type ChinaKind = "plate" | "cup" | "teapot";

/** A dresser's size, and where its shelves and china stand (x across, y up, z out toward the house). */
export const DRESSER = { width: 2.4, height: 2.7, base: 0.9, depth: 0.6, rack: 0.3, shelves: [1.2, 1.7, 2.2] };

export function dresserChina(): Array<{ kind: ChinaKind; row: number; local: Vec3; size: Vec3 }> {
  const pieces: Array<{ kind: ChinaKind; row: number; local: Vec3; size: Vec3 }> = [];
  const plate = (row: number, x: number, y: number): void => {
    pieces.push({ kind: "plate", row, local: { x, y: y + 0.19, z: -0.17 }, size: { x: 0.38, y: 0.38, z: 0.06 } });
  };
  // Three rows of plates on the rack, and a teapot and cups on the counter below.
  for (const [row, y] of DRESSER.shelves.entries()) {
    for (const x of row === 1 ? [-0.9, -0.45, 0, 0.45, 0.9] : [-0.8, -0.27, 0.27, 0.8]) plate(row, x, y);
  }
  pieces.push({ kind: "teapot", row: 3, local: { x: -0.6, y: DRESSER.base + 0.16, z: 0.14 }, size: { x: 0.36, y: 0.32, z: 0.28 } });
  for (const x of [0.05, 0.4, 0.75]) pieces.push({ kind: "cup", row: 3, local: { x, y: DRESSER.base + 0.07, z: 0.16 }, size: { x: 0.16, y: 0.14, z: 0.16 } });
  return pieces;
}

/** A ring of stage trapdoors: pull the lever and anyone standing on them drops below. */
export interface TrapDef {
  kind: "trap";
  /** Centre of the ring, on the boards. */
  pos: Vec3;
  inner: number;
  outer: number;
}

/**
 * A revolve: a ring of the stage floor round a fixed middle, turned by the stagehands' capstan.
 * Whatever stands on the ring rides round with it; whatever stands in the middle stays put.
 */
export interface RevolveDef {
  kind: "revolve";
  /** Middle of the ring, on the boards. */
  pos: Vec3;
  inner: number;
  outer: number;
  /** How far one strike of the capstan turns it (radians), and how long that takes. */
  turn: number;
  time: number;
}

/** How high a revolve's ring stands above the boards. */
export const REVOLVE_HEIGHT = 0.12;

/** A banana skin lying on the boards: knock it under a running crew and down they go. */
export interface PeelDef {
  kind: "peel";
  pos: Vec3;
  yaw: number;
}

export type PieceDef = BlockDef | KegDef | HayDef | FixtureDef | TurntableDef | SwingDef | SeesawDef | BucketDef | SandbagDef | ChestDef | TrapDef | VaneDef | ChuteDef | CarouselDef | GateDef | DresserDef | PeelDef | RevolveDef;

/** A banana skin's size: long, flat and slippery. */
export const PEEL_SIZE = { x: 0.8, y: 0.14, z: 0.5 };

/** A giant rat that creeps out of the wings to gnaw the Queen's powder. */
export interface RatDef {
  /** Seconds before the first visit. */
  first: number;
  /** Seconds offstage between visits. */
  every: number;
  visits: number;
}

export interface Zone {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface CrewDef {
  id: string;
  kind: "litter" | "cart" | "guard";
  home: Vec3;
  yaw?: number;
  zone?: Zone;
  patrol?: Vec3[];
  /** Walking pace on patrol, when crews of different kinds share a path and must keep step. */
  pace?: number;
}

export interface ViewDef {
  yaw: number;
  pitch: number;
  distance: number;
  target: Vec3;
}

export interface LevelDef {
  id: string;
  title: string;
  verse: [string, string];
  hint: string;
  ammo: Partial<Record<StockKind, number>>;
  /** Metres Humpty must drop for the "great fall" star. */
  greatFall: number;
  /** Mayhem points (earned before he cracks) for the mayhem star. */
  mayhem: number;
  humpty: Vec3;
  pieces: PieceDef[];
  crews: CrewDef[];
  view: ViewDef;
  rat?: RatDef;
  /** Which figure hides this verse's star. */
  star: StarHolder;
  /** Where the stagehands return him after a safe landing: the highest nearby perch, or his ride. */
  perch?: "highest" | "turntable" | "swing" | "seesaw";
}

export const HUMPTY_HEIGHT = 1.4;
export const HUMPTY_RADIUS = 0.5;
/** Distance from Humpty's body origin down to the flat of his base. */
export const HUMPTY_BASE = 0.63;
export const KEG_RADIUS = 0.32;
export const KEG_HALF_HEIGHT = 0.4;
export const HAY_SIZE: Vec3 = { x: 1.3, y: 0.7, z: 0.8 };

const GAP = 0.002;
/** Height of a turntable seat's top above the disc's top surface. */
export const TURNTABLE_SEAT = 0.18;
/** Height of the see-saw bucket floor above the plank's centreline. */
export const SEESAW_FLOOR = 0.14;
/** A maypole's shaft, and the flat crown on top of it where the ribbons hang. */
export const MAYPOLE_WIDTH = 0.3;
export const MAYPOLE_CROWN = { radius: 0.48, height: 0.12 };
export const BUCKET_SIZE = { radius: 0.2, height: 0.36 };
export const SANDBAG_SIZE = { radius: 0.32, height: 0.7 };
export const CHEST_SIZE = { x: 0.9, y: 0.62, z: 0.6 };
/**
 * The boards of a chute's hopper round the head of its trough, as boxes (centre, rotation, size).
 * Bombs are lobbed in from the front of the stage, so the side facing the guns is low and the
 * far side is a tall backstop: a bomb can't clip the near rim or ride up and out over the far one.
 */
export function hopperBoards(path: readonly Vec3[], width: number): Array<{ center: Vec3; rotation: Quat; size: Vec3 }> {
  const head = path[0]!;
  const frame = hopperFrame(path);
  const half = width / 2;
  const splay = (22 * Math.PI) / 180;
  const at = (rise: number, out: Vec3, lean: number): Vec3 => ({
    x: head.x + out.x * lean,
    y: head.y + (rise / 2) * Math.cos(splay),
    z: head.z + out.z * lean,
  });
  const boards: Array<{ center: Vec3; rotation: Quat; size: Vec3 }> = [];
  for (const side of [-1, 1]) {
    const out = { x: frame.across.x * side, y: 0, z: frame.across.z * side };
    const rise = out.z > 0 ? 0.45 : 1.7;
    boards.push({
      center: at(rise, out, half + (rise / 2) * Math.sin(splay)),
      rotation: multiplyQuat(frame.rotation, axisAngle({ x: 0, y: 0, z: 1 }, -side * splay)),
      size: { x: 0.08, y: rise, z: width + 1 },
    });
  }
  const back = { x: -frame.along.x, y: 0, z: -frame.along.z };
  boards.push({
    center: at(1.1, back, half + 0.55 * Math.sin(splay)),
    rotation: multiplyQuat(frame.rotation, axisAngle({ x: 1, y: 0, z: 0 }, -splay)),
    size: { x: width + 1.2, y: 1.1, z: 0.08 },
  });
  return boards;
}

/** A hopper stands upright over the head of its trough, facing down the trough's first run. */
export function hopperFrame(path: readonly Vec3[]): { along: Vec3; across: Vec3; rotation: Quat; mouth: Vec3 } {
  const head = path[0]!;
  const next = path[1]!;
  const flat = Math.hypot(next.x - head.x, next.z - head.z) || 1;
  const along = { x: (next.x - head.x) / flat, y: 0, z: (next.z - head.z) / flat };
  const across = { x: along.z, y: 0, z: -along.x };
  return { along, across, rotation: quatFromBasis(across, { x: 0, y: 1, z: 0 }, along), mouth: { x: head.x + along.x * 0.3, y: head.y + 0.5, z: head.z + along.z * 0.3 } };
}

function multiplyQuat(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

/** Small builder so level layouts read as masonry rather than coordinates. */
export class Mason {
  readonly pieces: PieceDef[] = [];

  block(material: BlockMaterial, x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw = 0): number {
    this.pieces.push({
      kind: "block",
      material,
      pos: { x, y: y + sy / 2 + GAP, z },
      size: { x: sx, y: sy, z: sz },
      yaw,
    });
    return y + sy + GAP;
  }

  /** Running-bond wall along x, centred on (cx, cz). Returns the top height. */
  wall(material: BlockMaterial, cx: number, cz: number, length: number, rows: number, opts: { y?: number; brick?: Vec3 } = {}): number {
    const brick = opts.brick ?? { x: 1, y: 0.5, z: 0.5 };
    let y = opts.y ?? 0;
    for (let row = 0; row < rows; row += 1) {
      const offset = row % 2 === 0 ? 0 : brick.x / 2;
      const start = cx - length / 2;
      const end = cx + length / 2;
      let x = start - offset;
      while (x < end - 0.05) {
        const left = Math.max(x, start);
        const right = Math.min(x + brick.x, end);
        const width = right - left;
        if (width > 0.2) this.block(material, (left + right) / 2, y, cz, width - 0.01, brick.y, brick.z);
        x += brick.x;
      }
      y += brick.y + GAP;
    }
    return y;
  }

  /** Jenga-style tower: three sticks per course, alternating direction. */
  tower(material: BlockMaterial, cx: number, cz: number, courses: number, opts: { y?: number; stick?: Vec3; yaw?: number } = {}): number {
    const stick = opts.stick ?? { x: 1.5, y: 0.35, z: 0.48 };
    const baseYaw = opts.yaw ?? 0;
    let y = opts.y ?? 0;
    const pitch = stick.z + 0.03;
    for (let course = 0; course < courses; course += 1) {
      const yaw = baseYaw + (course % 2 === 0 ? 0 : Math.PI / 2);
      for (let lane = -1; lane <= 1; lane += 1) {
        const lx = 0;
        const lz = lane * pitch;
        const x = cx + lx * Math.cos(yaw) + lz * Math.sin(yaw);
        const z = cz - lx * Math.sin(yaw) + lz * Math.cos(yaw);
        this.block(material, x, y, z, stick.x, stick.y, stick.z, yaw);
      }
      y += stick.y + GAP;
    }
    return y;
  }

  /** Stack of cubes. */
  pillar(material: BlockMaterial, x: number, z: number, count: number, opts: { y?: number; size?: number; height?: number } = {}): number {
    const size = opts.size ?? 0.8;
    const height = opts.height ?? size;
    let y = opts.y ?? 0;
    for (let index = 0; index < count; index += 1) y = this.block(material, x, y, z, size, height, size);
    return y;
  }

  slab(material: BlockMaterial, x: number, y: number, z: number, sx: number, sz: number, thickness = 0.2, yaw = 0): number {
    return this.block(material, x, y, z, sx, thickness, sz, yaw);
  }

  /**
   * A royal canopy over a perch: four gilded posts and a cloth roof. Mortar shells burst on the
   * roof instead of on Humpty; shoot the posts or blow the roof away first.
   */
  canopy(x: number, y: number, z: number, opts: { span?: number; height?: number; roof?: number } = {}): number {
    const span = opts.span ?? 1.2;
    const height = opts.height ?? 1.95;
    const roof = opts.roof ?? 2.8;
    for (const dx of [-span / 2, span / 2]) {
      for (const dz of [-span / 2, span / 2]) this.block("post", x + dx, y, z + dz, 0.12, height, 0.12);
    }
    return this.block("canopy", x, y + height + GAP, z, roof, 0.12, roof);
  }

  fixture(look: FixtureLook, x: number, y: number, z: number, sx: number, sy: number, sz: number, opts: { yaw?: number; bounce?: number; soft?: number; cue?: CueKind; spring?: number } = {}): number {
    this.pieces.push({
      kind: "fixture",
      look,
      pos: { x, y: y + sy / 2, z },
      size: { x: sx, y: sy, z: sz },
      yaw: opts.yaw ?? 0,
      ...(opts.bounce !== undefined ? { bounce: opts.bounce } : {}),
      ...(opts.soft !== undefined ? { soft: opts.soft } : {}),
      ...(opts.cue !== undefined ? { cue: opts.cue } : {}),
      ...(opts.spring !== undefined ? { spring: opts.spring } : {}),
    });
    return y + sy;
  }

  /**
   * A maypole planted in the stage, with a flat crown to sit on. Nothing moves it but chain
   * shot, which cuts it in two: the stump stays, the top falls like a tree with whoever sits
   * on the crown. Returns the height of the crown's top.
   */
  maypole(x: number, z: number, height: number): number {
    return this.fixture("maypole", x, 0, z, MAYPOLE_WIDTH, height, MAYPOLE_WIDTH);
  }

  /** Iron area railings: nothing flat gets through, but a lobbed bomb drops in behind. */
  railing(x: number, z: number, length: number, height = 1.3, yaw = 0): void {
    this.fixture("railing", x, 0, z, length, height, 0.12, { yaw });
  }

  /**
   * A stone house with a cellar door in its front wall and a flat roof. Returns the roof top.
   * Walls are separate blocks, so a blast inside takes the whole house apart.
   */
  house(cx: number, cz: number, opts: { width?: number; depth?: number; rows?: number; door?: number } = {}): number {
    const width = opts.width ?? 3.4;
    const depth = opts.depth ?? 2.6;
    const rows = opts.rows ?? 4;
    const door = opts.door ?? 1.1;
    const course = 0.55;
    const thick = 0.45;
    const front = cz + depth / 2 - thick / 2;
    const back = cz - depth / 2 + thick / 2;
    let y = 0;
    for (let row = 0; row < rows; row += 1) {
      const doorway = row < 2;
      if (doorway) {
        const pier = (width - door) / 2;
        for (const side of [-1, 1]) this.block("stone", cx + side * (door / 2 + pier / 2), y, front, pier - 0.01, course, thick);
      } else {
        for (const side of [-1, 1]) this.block("stone", cx + side * width / 4, y, front, width / 2 - 0.01, course, thick);
      }
      for (const side of [-1, 1]) this.block("stone", cx + side * width / 4, y, back, width / 2 - 0.01, course, thick);
      for (const side of [-1, 1]) this.block("stone", cx + side * (width / 2 - thick / 2), y, cz, thick, course, depth - thick * 2 - 0.01);
      y += course + GAP;
    }
    return this.slab("plank", cx, y, cz, width + 0.3, depth + 0.3, 0.2);
  }

  /** A low wall round the edge of a roof, so nobody tumbles off it by accident. */
  parapet(cx: number, y: number, cz: number, width: number, depth: number, height = 0.7): void {
    const thick = 0.22;
    for (const side of [-1, 1]) {
      this.block("brick", cx, y, cz + side * (depth / 2 - thick / 2), width, height, thick);
      this.block("brick", cx + side * (width / 2 - thick / 2), y, cz, thick, height, depth - thick * 2 - 0.01);
    }
  }

  /** A painter's stepladder with a full paint pot on top. Returns the bucket's position. */
  paintPot(x: number, z: number, yaw = 0): Vec3 {
    const height = 1.95;
    this.fixture("ladder", x, 0, z, 0.62, height, 0.5, { yaw });
    const pos = { x, y: height + BUCKET_SIZE.height / 2 + GAP, z };
    this.pieces.push({ kind: "bucket", pos });
    return pos;
  }

  /** A treasure chest of spare powder and shot. */
  chest(x: number, z: number, opts: { y?: number; yaw?: number } = {}): void {
    this.pieces.push({
      kind: "chest",
      pos: { x, y: (opts.y ?? 0) + CHEST_SIZE.y / 2 + GAP, z },
      yaw: opts.yaw ?? 0,
    });
  }

  /** The Queen's bouncy four-poster: anything landing on it goes straight back up. Returns the mattress top. */
  bouncyBed(x: number, z: number, opts: { yaw?: number; spring?: number; width?: number; length?: number } = {}): number {
    return this.fixture("bed", x, 0, z, opts.width ?? 2.2, 0.75, opts.length ?? 2.8, { yaw: opts.yaw ?? 0, spring: opts.spring ?? 10.5, soft: 0.15 });
  }

  /** A ring of trapdoors in the boards, and the stage lever that opens them. */
  trapRing(x: number, z: number, inner: number, outer: number, lever: { x: number; z: number; yaw?: number }): void {
    this.pieces.push({ kind: "trap", pos: { x, y: 0, z }, inner, outer });
    this.fixture("lever", lever.x, 0, lever.z, 0.5, 1.7, 0.4, { yaw: lever.yaw ?? 0, cue: "trap" });
  }

  /** A weathercock on a post: a bronze plate that bounces shots and turns `step` each time it's hit. */
  vane(x: number, z: number, angle: number, opts: { y?: number; width?: number; height?: number; step?: number } = {}): void {
    const height = opts.height ?? 2.2;
    const y = opts.y ?? 1.2;
    this.fixture("post", x, 0, z, 0.22, y, 0.22);
    this.pieces.push({ kind: "vane", pos: { x, y: y + height / 2 + 0.05, z }, width: opts.width ?? 1.9, height, angle, step: opts.step ?? Math.PI / 4 });
  }

  /**
   * A hopper and a trough: `path` is the trough floor from the hopper down to where it spills out.
   * The hopper sits over the first point.
   */
  chute(path: Vec3[], width = 0.72): void {
    this.pieces.push({ kind: "chute", path, width });
    // Trestles under each bend, so it stands on the boards.
    for (const point of path.slice(0, -1)) {
      if (point.y > 0.5) this.fixture("post", point.x, 0, point.z, 0.18, point.y - 0.1, 0.18);
    }
  }

  /**
   * A barrel ramp: a plank trough from `top` down to `foot`, a powder keg lying across its head and
   * a chock holding it. Strike the chock and the keg rolls, its fuse lit, wherever the ramp sends it.
   */
  barrelRamp(top: Vec3, foot: Vec3, opts: { fuse?: number; chock?: number } = {}): void {
    const width = 1.1;
    this.pieces.push({ kind: "chute", path: [top, foot], width, hopper: false, slick: false });
    if (top.y > 0.5) this.fixture("post", top.x, 0, top.z, 0.2, top.y - 0.1, 0.2);
    const run = Math.hypot(foot.x - top.x, foot.z - top.z) || 1;
    const along = { x: (foot.x - top.x) / run, z: (foot.z - top.z) / run };
    const slope = (top.y - foot.y) / run;
    const heading = Math.atan2(along.x, along.z);
    const at = (d: number, lift: number): Vec3 => ({ x: top.x + along.x * d, y: top.y - slope * d + lift, z: top.z + along.z * d });
    const keg = at(0.5, KEG_RADIUS + 0.03);
    this.pieces.push({ kind: "keg", pos: keg, lie: heading, fuse: opts.fuse ?? 3.2 });
    // The chock is a stout board standing up above the trough's sides, so a shot can reach it.
    const chock = at(0.5 + KEG_RADIUS + 0.16, 0);
    // It reaches out past the trough on both sides: `chock` is how far, for a domino to catch its end.
    this.fixture("chock", chock.x, chock.y - 0.05, chock.z, width + 2 * (opts.chock ?? 0.3), 0.85, 0.2, { yaw: heading, cue: "release" });
  }

  /**
   * A run of dominoes along `path` (points on the boards), from its start, growing through
   * `heights`: each stands about half its own height from the one before, facing along the path,
   * so each topples the next (a domino can fell one about half as tall again as itself).
   */
  dominoes(path: Array<{ x: number; z: number }>, heights: number[], material: BlockMaterial = "domino"): void {
    const legs = path.slice(1).map((point, index) => ({ from: path[index]!, to: point, length: Math.hypot(point.x - path[index]!.x, point.z - path[index]!.z) }));
    const pointAt = (distance: number): { x: number; z: number; yaw: number } => {
      let rest = distance;
      for (const leg of legs) {
        if (rest <= leg.length || leg === legs[legs.length - 1]) {
          const k = Math.min(1, rest / (leg.length || 1));
          return { x: leg.from.x + (leg.to.x - leg.from.x) * k, z: leg.from.z + (leg.to.z - leg.from.z) * k, yaw: Math.atan2(leg.to.x - leg.from.x, leg.to.z - leg.from.z) };
        }
        rest -= leg.length;
      }
      return { x: path[0]!.x, z: path[0]!.z, yaw: 0 };
    };
    let along = 0;
    for (const [index, height] of heights.entries()) {
      const spot = pointAt(along);
      this.block(material, spot.x, 0, spot.z, 0.7, height, 0.12, spot.yaw);
      along += height * 0.5 + 0.12;
    }
  }

  /**
   * A revolving stage round (x, z); returns the height of its boards, to build things on it.
   * The capstan that turns it is a stage cue: see `capstan`.
   */
  revolve(x: number, z: number, opts: { inner?: number; outer?: number; turn?: number; time?: number } = {}): number {
    this.pieces.push({ kind: "revolve", pos: { x, y: 0, z }, inner: opts.inner ?? 1.9, outer: opts.outer ?? 6, turn: opts.turn ?? Math.PI, time: opts.time ?? 6 });
    return REVOLVE_HEIGHT;
  }

  /** The stagehands' capstan in the wings: strike it and the revolve turns. */
  capstan(x: number, z: number, yaw = 0): void {
    this.fixture("capstan", x, 0, z, 1.3, 1.2, 1.3, { yaw, cue: "revolve" });
  }

  /** A banana skin on the boards. */
  peel(x: number, z: number, yaw = 0): void {
    this.pieces.push({ kind: "peel", pos: { x, y: PEEL_SIZE.y / 2 + GAP, z }, yaw });
  }

  /**
   * An orchard tree in the wings with a straw beehive hanging from its bough (a stage cue).
   * `reach` is how far the bough stretches toward centre stage (its sign says which way).
   */
  beehive(trunkX: number, z: number, opts: { height?: number; reach?: number } = {}): Vec3 {
    const height = opts.height ?? 4.2;
    const reach = opts.reach ?? (trunkX < 0 ? 2.6 : -2.6);
    this.fixture("trunk", trunkX, 0, z, 0.6, height + 0.6, 0.6);
    this.fixture("bough", trunkX + reach / 2, height - 0.12, z, Math.abs(reach) + 0.3, 0.24, 0.36);
    const hive = { x: trunkX + reach * 0.8, y: height - 0.95, z };
    this.fixture("hive", hive.x, hive.y - 0.4, hive.z, 0.7, 0.8, 0.7, { cue: "hive" });
    return hive;
  }

  /** The King's china dresser, turned to face `yaw` (0 faces the house). */
  dresser(x: number, z: number, yaw = 0): void {
    this.pieces.push({ kind: "dresser", pos: { x, y: 0, z }, yaw });
  }

  /** A carousel of paddles round a painted bush, turning at `speed` radians a second. */
  carousel(x: number, z: number, opts: { y?: number; inner?: number; outer?: number; height?: number; paddles?: number; speed?: number; angle?: number } = {}): void {
    const y = opts.y ?? 1.9;
    const height = opts.height ?? 1.5;
    this.fixture("column", x, 0, z, 0.36, y + height / 2 + 0.5, 0.36);
    this.pieces.push({
      kind: "carousel",
      pos: { x, y: 0, z },
      y,
      inner: opts.inner ?? 0.45,
      outer: opts.outer ?? 1.9,
      height,
      paddles: opts.paddles ?? 4,
      speed: opts.speed ?? 0.9,
      angle: opts.angle ?? 0,
    });
  }

  /**
   * A gatehouse: two stone piers, a lintel over the opening, a portcullis in it, and an iron
   * counterweight hanging beside it. Strike the weight and the gate winds up for a while.
   */
  gatehouse(x: number, z: number, opts: { width?: number; height?: number; yaw?: number; weight?: { x: number; z: number } } = {}): { lintelTop: number } {
    const width = opts.width ?? 2.6;
    const height = opts.height ?? 2.8;
    const yaw = opts.yaw ?? 0;
    const pier = 1.1;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    for (const side of [-1, 1]) {
      const offset = side * (width / 2 + pier / 2);
      this.fixture("pier", x + offset * c, 0, z - offset * s, pier, height + 0.9, 1.2, { yaw });
    }
    const lintelTop = this.fixture("lintel", x, height, z, width + pier * 2, 0.9, 1.2, { yaw });
    this.pieces.push({ kind: "gate", pos: { x, y: 0, z }, width, height, yaw });
    const weight = opts.weight ?? { x: x + (width / 2 + pier + 0.6) * c, z: z - (width / 2 + pier + 0.6) * s };
    this.fixture("counterweight", weight.x, 0.9, weight.z, 0.7, 0.9, 0.7, { yaw, cue: "gate" });
    return { lintelTop };
  }

  /** A stagehand's wind machine: strike it and a gale blows across the stage for a while. */
  windMachine(x: number, z: number, yaw = 0): void {
    this.fixture("windmachine", x, 0, z, 1.3, 1.6, 1.1, { yaw, cue: "wind" });
  }

  /**
   * A painted tree with a cradle hung from its bough on two lines. The wind rocks it;
   * chain shot cuts the lines. Returns the cradle floor, where Humpty sits.
   */
  cradle(x: number, y: number, z: number, opts: { bough?: number; trunkX?: number } = {}): Vec3 {
    const bough = opts.bough ?? y + 3.2;
    const trunkX = opts.trunkX ?? x - 2.6;
    this.fixture("trunk", trunkX, 0, z, 0.7, bough + 0.9, 0.7);
    this.fixture("bough", (trunkX + x + 1.2) / 2, bough - 0.12, z, Math.abs(x + 1.2 - trunkX), 0.26, 0.4);
    this.pieces.push({ kind: "swing", pos: { x, y, z }, width: 1.3, beam: bough - 0.12, cradle: true });
    return { x, y, z };
  }

  /** A sandbag hanging from the flies on a single line. Only chain shot cuts the line. */
  sandbag(x: number, y: number, z: number, top = 13): void {
    this.pieces.push({ kind: "sandbag", pos: { x, y: y + SANDBAG_SIZE.height / 2, z }, top });
  }

  /** The dinner gong: strike it and every one of the King's men downs tools for lunch. */
  gong(x: number, z: number, yaw = 0): void {
    this.fixture("gong", x, 0.35, z, 1.3, 1.3, 0.14, { yaw, cue: "lunch" });
  }

  /** A bronze ricochet plate standing on the stage, turned by `yaw`. */
  bumper(x: number, z: number, yaw: number, opts: { width?: number; height?: number; y?: number } = {}): void {
    const height = opts.height ?? 2.4;
    this.fixture("bumper", x, opts.y ?? 0, z, opts.width ?? 1.8, height, 0.16, { yaw, bounce: 0.92 });
  }

  /** A painted hedge flat: hides what is behind it from the audience's usual seat. */
  hedge(x: number, z: number, length: number, height = 2.6, yaw = 0): void {
    this.fixture("hedge", x, 0, z, length, height, 0.7, { yaw, soft: 0.45 });
  }

  turntable(x: number, y: number, z: number, opts: { radius?: number; arm?: number; speed?: number; angle?: number } = {}): { seat: Vec3 } {
    const radius = opts.radius ?? 0.9;
    const arm = opts.arm ?? 1.55;
    const angle = opts.angle ?? 0;
    this.fixture("column", x, 0, z, 0.7, y - 0.16, 0.7);
    this.pieces.push({ kind: "turntable", pos: { x, y, z }, radius, arm, speed: opts.speed ?? 0.45, angle });
    return { seat: { x: x + Math.cos(angle) * arm, y: y + TURNTABLE_SEAT, z: z - Math.sin(angle) * arm } };
  }

  swing(x: number, y: number, z: number, opts: { width?: number; beam?: number } = {}): { seat: Vec3 } {
    const width = opts.width ?? 1.3;
    const beam = opts.beam ?? y + 3;
    for (const side of [-1, 1]) this.fixture("post", x + side * (width / 2 + 0.55), 0, z, 0.3, beam + 0.15, 0.3);
    this.fixture("beam", x, beam - 0.12, z, width + 1.5, 0.28, 0.32);
    this.pieces.push({ kind: "swing", pos: { x, y, z }, width, beam: beam - 0.12 });
    return { seat: { x, y, z } };
  }

  /** A trebuchet-style see-saw: long bucket arm to -x, short arm with a catching tray to +x. */
  seesaw(x: number, y: number, z: number, opts: { length?: number; tilt?: number; offset?: number } = {}): { bucket: Vec3; tray: Vec3 } {
    const length = opts.length ?? 6.4;
    const tilt = opts.tilt ?? 0.2;
    const offset = opts.offset ?? 0.8;
    const half = length / 2;
    // A slim trestle well below the plank, so it never limits the swing.
    this.fixture("fulcrum", x, 0, z, 0.3, y - 0.3, 1);
    // A stop under the bucket end holds the see-saw at rest.
    const stopReach = half + offset - 0.5;
    const stopTop = y - stopReach * Math.sin(tilt) - 0.08 * Math.cos(tilt) - 0.005;
    this.fixture("fulcrum", x - stopReach * Math.cos(tilt), 0, z, 0.5, stopTop, 1);
    this.pieces.push({ kind: "seesaw", pos: { x, y, z }, length, tilt, offset });
    const reach = half + offset - 0.62;
    const trayReach = half - offset - 0.65;
    return {
      bucket: { x: x - Math.cos(tilt) * reach, y: y - Math.sin(tilt) * reach + SEESAW_FLOOR * Math.cos(tilt), z },
      tray: { x: x + Math.cos(tilt) * trayReach, y: y + Math.sin(tilt) * trayReach + 0.16, z },
    };
  }

  hay(x: number, z: number, y = 0, yaw = 0): number {
    this.pieces.push({ kind: "hay", pos: { x, y: y + HAY_SIZE.y / 2 + GAP, z }, yaw });
    return y + HAY_SIZE.y + GAP;
  }

  keg(x: number, z: number, y = 0): number {
    this.pieces.push({ kind: "keg", pos: { x, y: y + KEG_HALF_HEIGHT + GAP, z } });
    return y + KEG_HALF_HEIGHT * 2 + GAP;
  }
}

/** Humpty's body origin when sitting on a surface at height y. */
export function perchAt(x: number, y: number, z: number): Vec3 {
  return { x, y: y + HUMPTY_BASE + 0.004, z };
}
