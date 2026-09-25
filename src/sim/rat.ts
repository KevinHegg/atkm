import type { RatDef } from "./level.js";
import type { Vec3 } from "./types.js";

/** The powder the rat is after: between the Queen's podium and her cannon. */
export const RAT_LARDER: Vec3 = { x: -2.5, y: 0, z: 6.7 };
/** He slips out from behind the upstage wing flats, where the audience can see all of his approach. */
const OFFSTAGE_X = 15.6;
const ENTRY_Z = -8.6;
/** He cuts across the lawn by way of this point (mirrored for each wing) so his whole approach is in view. */
const WAYPOINT = { x: 5.2, z: 1.4 };

export type RatMode = "off" | "creep" | "gnaw" | "flee" | "stunned";

export interface RatState {
  mode: RatMode;
  x: number;
  z: number;
  heading: number;
  speed: number;
  /** Time of the next visit while off, or the end of the current gnaw/stun. */
  until: number;
  visitsLeft: number;
  side: 1 | -1;
  stride: number;
  /** 0 upright … 1 flipped on his back (stunned). */
  flip: number;
  carrying: boolean;
  /** Has he reached the waypoint on this visit? */
  crossed: boolean;
  def: RatDef;
}

export function createRat(def: RatDef): RatState {
  return {
    mode: "off",
    x: OFFSTAGE_X,
    z: 5,
    heading: -Math.PI / 2,
    speed: 0,
    until: def.first,
    visitsLeft: def.visits,
    side: 1,
    stride: 0,
    flip: 0,
    carrying: false,
    crossed: false,
    def,
  };
}

export type RatAction = "enter" | "arrived" | "gone" | undefined;

const CREEP = 2.6;
const SCURRY = 5.5;

/** Advance the rat. Returns what just happened so the game can react. */
export function stepRat(rat: RatState, dt: number, time: number, active: boolean): RatAction {
  if (rat.mode === "off") {
    if (!active || rat.visitsLeft <= 0 || time < rat.until) return undefined;
    rat.visitsLeft -= 1;
    rat.side = rat.side === 1 ? -1 : 1;
    rat.x = rat.side * OFFSTAGE_X;
    rat.z = ENTRY_Z;
    rat.crossed = false;
    rat.mode = "creep";
    rat.carrying = false;
    rat.flip = 0;
    return "enter";
  }
  if (rat.mode === "stunned") {
    rat.flip = Math.min(1, rat.flip + dt * 8);
    rat.speed = 0;
    if (time >= rat.until) rat.mode = "flee";
    return undefined;
  }
  if (rat.mode === "gnaw") {
    rat.speed = 0;
    rat.stride += dt * 3;
    if (time >= rat.until) {
      rat.mode = "flee";
      return "arrived";
    }
    return undefined;
  }
  rat.flip = Math.max(0, rat.flip - dt * 4);
  const fleeing = rat.mode === "flee";
  const waypoint = { x: rat.side * WAYPOINT.x, z: WAYPOINT.z };
  if (!fleeing && !rat.crossed && Math.hypot(waypoint.x - rat.x, waypoint.z - rat.z) < 0.5) rat.crossed = true;
  const goal = fleeing
    ? { x: rat.side * OFFSTAGE_X, z: ENTRY_Z }
    : rat.crossed ? { x: RAT_LARDER.x, z: RAT_LARDER.z } : waypoint;
  const dx = goal.x - rat.x;
  const dz = goal.z - rat.z;
  const gap = Math.hypot(dx, dz);
  if (!fleeing && gap < 0.35) {
    rat.mode = "gnaw";
    rat.until = time + 1.8;
    return undefined;
  }
  if (fleeing && gap < 0.3) {
    rat.mode = "off";
    rat.until = time + rat.def.every;
    return "gone";
  }
  rat.speed = fleeing ? SCURRY : CREEP;
  // A rat never walks straight: he darts and pauses.
  const dart = fleeing ? 1 : 0.55 + 0.45 * Math.max(0, Math.sin(time * 5.3));
  const step = Math.min(gap, rat.speed * dart * dt);
  rat.x += (dx / gap) * step;
  rat.z += (dz / gap) * step;
  const desired = Math.atan2(dx, dz);
  let turn = desired - rat.heading;
  while (turn > Math.PI) turn -= Math.PI * 2;
  while (turn < -Math.PI) turn += Math.PI * 2;
  rat.heading += turn * Math.min(1, dt * 10);
  rat.stride += step;
  return undefined;
}

/** Startle him: he flips, then bolts for the wings, dropping anything he was carrying. */
export function scareRat(rat: RatState, time: number): boolean {
  if (rat.mode === "off" || rat.mode === "stunned" || rat.mode === "flee") return false;
  rat.mode = "stunned";
  rat.until = time + 0.9;
  rat.carrying = false;
  return true;
}
