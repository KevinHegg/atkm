import type { AmmoKind, Vec3 } from "./types.js";

export const GRAVITY = 9.81;

export interface AmmoSpec {
  kind: AmmoKind;
  name: string;
  blurb: string;
  speed: number;
  lob: boolean;
  gun: "cannon" | "mortar" | "queen";
}

export const AMMO: Record<AmmoKind, AmmoSpec> = {
  shot: {
    kind: "shot",
    name: "Round shot",
    blurb: "A flat, heavy punch. Knocks blocks clean out of a wall.",
    speed: 24,
    lob: false,
    gun: "cannon",
  },
  shell: {
    kind: "shell",
    name: "Mortar shell",
    blurb: "Lobbed high over walls. Bursts on the first thing it touches.",
    speed: 15,
    lob: true,
    gun: "mortar",
  },
  grape: {
    kind: "grape",
    name: "Grapeshot",
    blurb: "A spray of small balls. Bowls over the King's men.",
    speed: 25,
    lob: false,
    gun: "cannon",
  },
  chain: {
    kind: "chain",
    name: "Chain shot",
    blurb: "Two balls on a chain, spinning. Scythes through tall, thin things.",
    speed: 21,
    lob: false,
    gun: "cannon",
  },
  bomb: {
    kind: "bomb",
    name: "Fizzing bomb",
    blurb: "Lobbed from the mortar. It bounces and rolls, then goes off when the fuse runs out, wherever it has got to.",
    speed: 14,
    lob: true,
    gun: "mortar",
  },
  blunderbuss: {
    kind: "blunderbuss",
    name: "Blunderbuss",
    blurb: "The Queen's own gun, for vermin. Short range, never runs out.",
    speed: 13,
    lob: false,
    gun: "queen",
  },
};

export interface LaunchSolution {
  velocity: Vec3;
  reachable: boolean;
}

/**
 * Launch velocity at fixed speed that passes through `to`.
 * Unreachable targets fall back to the maximum-range 45° shot on the same heading.
 */
export function solveLaunch(from: Vec3, to: Vec3, speed: number, lob: boolean): LaunchSolution {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dy = to.y - from.y;
  const flat = Math.max(1e-4, Math.hypot(dx, dz));
  const hx = dx / flat;
  const hz = dz / flat;
  const v2 = speed * speed;
  const disc = v2 * v2 - GRAVITY * (GRAVITY * flat * flat + 2 * dy * v2);
  let angle: number;
  let reachable = true;
  if (disc < 0) {
    angle = Math.PI / 4;
    reachable = false;
  } else {
    const root = Math.sqrt(disc);
    angle = Math.atan((v2 + (lob ? root : -root)) / (GRAVITY * flat));
  }
  const horizontal = speed * Math.cos(angle);
  return {
    velocity: { x: hx * horizontal, y: speed * Math.sin(angle), z: hz * horizontal },
    reachable,
  };
}

export function arcPoint(from: Vec3, velocity: Vec3, t: number): Vec3 {
  return {
    x: from.x + velocity.x * t,
    y: from.y + velocity.y * t - 0.5 * GRAVITY * t * t,
    z: from.z + velocity.z * t,
  };
}

export function arcVelocity(velocity: Vec3, t: number): Vec3 {
  return { x: velocity.x, y: velocity.y - GRAVITY * t, z: velocity.z };
}

/** Time for a ballistic body to fall from height y (moving vy) down to height floor. */
export function timeToHeight(y: number, vy: number, floor: number): number {
  const drop = y - floor;
  const disc = vy * vy + 2 * GRAVITY * drop;
  if (disc < 0) return 0;
  return Math.max(0, (vy + Math.sqrt(disc)) / GRAVITY);
}
