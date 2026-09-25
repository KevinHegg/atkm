import type { AmmoKind, BlockMaterial, Vec3 } from "./types.js";

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

export type PieceDef = BlockDef | KegDef | HayDef;

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
  ammo: Partial<Record<AmmoKind, number>>;
  /** Metres Humpty must drop for the "great fall" star. */
  greatFall: number;
  humpty: Vec3;
  pieces: PieceDef[];
  crews: CrewDef[];
  view: ViewDef;
  /** Winning shots discovered by `npm run solve`: ammo + aim point. */
  par?: Array<{ ammo: AmmoKind; at: Vec3 }>;
}

export const HUMPTY_HEIGHT = 1.4;
export const HUMPTY_RADIUS = 0.5;
/** Distance from Humpty's body origin down to the flat of his base. */
export const HUMPTY_BASE = 0.63;
export const KEG_RADIUS = 0.32;
export const KEG_HALF_HEIGHT = 0.4;
export const HAY_SIZE: Vec3 = { x: 1.3, y: 0.7, z: 0.8 };

const GAP = 0.002;

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
