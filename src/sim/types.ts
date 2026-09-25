import type { MayhemEvent } from "./mayhem.js";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export type AmmoKind = "shot" | "shell" | "grape" | "chain" | "bomb" | "blunderbuss";
/** Ordnance the level stocks; the Queen's blunderbuss is always to hand when vermin appear. */
export type StockKind = Exclude<AmmoKind, "blunderbuss">;

export type BlockMaterial = "oak" | "stone" | "plank" | "beam" | "brick" | "post" | "canopy" | "anvil" | "seat" | "maypole";

/** Static scenery in the playing area: it stops shots but never moves. */
export type FixtureLook = "post" | "beam" | "hedge" | "bumper" | "drum" | "fulcrum" | "column" | "screen" | "gong" | "maypole" | "stump" | "railing" | "ladder" | "bed" | "windmachine" | "trunk" | "bough" | "lever";

/** Stage cues: strike one and the theatre does something that helps the Queen. */
export type CueKind = "lunch" | "wind" | "trap";

/** Where a verse hides its star: in one of the King's crews, a curio, or the rat. */
export type StarHolder = { crew: string } | { curio: CurioId } | { rat: true };

/** Nursery-rhyme curios hidden in the scenery; striking one only does something silly. */
export type CurioId = "cow" | "moon" | "jack-and-jill" | "cuckoo" | "well" | "spider" | "king" | "duke";

export type BodyKind =
  | "ground"
  | "block"
  | "humpty"
  | "shot"
  | "shell"
  | "bomb"
  | "grape"
  | "chain"
  | "keg"
  | "hay"
  | "litter"
  | "man"
  | "horse"
  | "crown"
  | "shard"
  | "fixture"
  | "turntable"
  | "rat"
  | "pellet"
  | "bucket"
  | "sandbag"
  | "chest";

export type Phase = "aim" | "flight" | "hoist" | "won" | "lost";

export type HumptyMood = "calm" | "nervous" | "falling" | "dizzy" | "smug" | "cracked";

export type Speaker = "humpty" | "queen" | "men";

export type GameEvent =
  | { type: "fire"; ammo: AmmoKind; from: Vec3; velocity: Vec3 }
  | { type: "impact"; at: Vec3; strength: number; material: string }
  | { type: "explode"; at: Vec3; radius: number; keg: boolean }
  | { type: "crack"; at: Vec3; fall: number; speed: number }
  | { type: "caught"; at: Vec3; by: "litter" | "hay" | "cart" | "ground" }
  | { type: "hoist-start"; from: Vec3; to: Vec3 }
  | { type: "hoist-end"; at: Vec3 }
  | { type: "bowled"; at: Vec3; crewId: string }
  | { type: "airborne"; at: Vec3 }
  | { type: "wobble"; at: Vec3 }
  | { type: "say"; speaker: Speaker; line: string }
  | { type: "reload"; ammo: AmmoKind | undefined }
  | { type: "result"; won: boolean }
  | { type: "ricochet"; at: Vec3; look: FixtureLook; strength: number }
  | { type: "rope-cut"; at: Vec3; by: AmmoKind }
  | { type: "curio"; id: CurioId; at: Vec3 }
  | { type: "cue"; cue: CueKind; at: Vec3 }
  | { type: "cut"; at: Vec3 }
  | { type: "chest"; at: Vec3; gained: Partial<Record<StockKind, number>> }
  | { type: "star"; at: Vec3 }
  | { type: "bounce"; at: Vec3; speed: number }
  | MayhemEvent
  | { type: "spin"; at: Vec3; speed: number }
  | { type: "rat"; action: "enter" | "gnaw" | "steal" | "scared" | "gone"; at: Vec3; stole?: StockKind };

export interface BodyView {
  id: number;
  kind: BodyKind;
  material: string;
  size: Vec3;
  position: Vec3;
  rotation: Quat;
  prevPosition: Vec3;
  prevRotation: Quat;
  removed: boolean;
  /** Partner body for chain shot. */
  link?: number;
  /** Seconds left on a bomb's fuse. */
  fuse?: number;
  /** A treasure chest that has been forced open. */
  open?: boolean;
}

export const vec = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export function lengthOf(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function yawQuat(yaw: number): Quat {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}
