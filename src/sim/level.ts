import type { BlockMaterial, CueKind, FixtureLook, StockKind, Vec3 } from "./types.js";

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

export type PieceDef = BlockDef | KegDef | HayDef | FixtureDef | TurntableDef | SwingDef | SeesawDef;

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
  humpty: Vec3;
  pieces: PieceDef[];
  crews: CrewDef[];
  view: ViewDef;
  rat?: RatDef;
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

  fixture(look: FixtureLook, x: number, y: number, z: number, sx: number, sy: number, sz: number, opts: { yaw?: number; bounce?: number; soft?: number; cue?: CueKind } = {}): number {
    this.pieces.push({
      kind: "fixture",
      look,
      pos: { x, y: y + sy / 2, z },
      size: { x: sx, y: sy, z: sz },
      yaw: opts.yaw ?? 0,
      ...(opts.bounce !== undefined ? { bounce: opts.bounce } : {}),
      ...(opts.soft !== undefined ? { soft: opts.soft } : {}),
      ...(opts.cue !== undefined ? { cue: opts.cue } : {}),
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
