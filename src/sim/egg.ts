import { HUMPTY_BASE, HUMPTY_HEIGHT, HUMPTY_RADIUS } from "./level.js";

/** Normalised height along the egg where the flat base is cut. */
export const EGG_BASE_T = -HUMPTY_BASE / (HUMPTY_HEIGHT / 2);

/** Radius of Humpty's shell at normalised height t (-1 bottom … 1 top). The bottom is fuller. */
export function eggRadius(t: number): number {
  const clamped = Math.max(-1, Math.min(1, t));
  return HUMPTY_RADIUS * Math.sqrt(Math.max(0, 1 - clamped * clamped)) * (1 - 0.14 * clamped);
}

export function eggY(t: number): number {
  return t * HUMPTY_HEIGHT / 2;
}

/** Convex hull points for the physics collider. */
export function eggHullPoints(rings = 10, segments = 14): Float32Array {
  const points: number[] = [];
  for (let ring = 0; ring <= rings; ring += 1) {
    const t = EGG_BASE_T + (1 - EGG_BASE_T) * (ring / rings);
    const radius = eggRadius(t);
    const y = eggY(t);
    if (radius < 1e-3) {
      points.push(0, y, 0);
      continue;
    }
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = (segment / segments) * Math.PI * 2;
      points.push(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
    }
  }
  return new Float32Array(points);
}
