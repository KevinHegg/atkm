import type { Quat, Vec3 } from "./types.js";

export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

export const scale = (v: Vec3, k: number): Vec3 => ({ x: v.x * k, y: v.y * k, z: v.z * k });

/** A turn of `angle` radians about a unit `axis`. */
export function axisAngle(axis: Vec3, angle: number): Quat {
  const s = Math.sin(angle / 2);
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(angle / 2) };
}

/** The rotation that takes x, y, z to the given right-handed orthonormal axes. */
export function quatFromBasis(x: Vec3, y: Vec3, z: Vec3): Quat {
  const trace = x.x + y.y + z.z;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    return { w: s / 4, x: (y.z - z.y) / s, y: (z.x - x.z) / s, z: (x.y - y.x) / s };
  }
  if (x.x > y.y && x.x > z.z) {
    const s = Math.sqrt(1 + x.x - y.y - z.z) * 2;
    return { w: (y.z - z.y) / s, x: s / 4, y: (y.x + x.y) / s, z: (z.x + x.z) / s };
  }
  if (y.y > z.z) {
    const s = Math.sqrt(1 + y.y - x.x - z.z) * 2;
    return { w: (z.x - x.z) / s, x: (y.x + x.y) / s, y: s / 4, z: (z.y + y.z) / s };
  }
  const s = Math.sqrt(1 + z.z - x.x - y.y) * 2;
  return { w: (x.y - y.x) / s, x: (z.x + x.z) / s, y: (z.y + y.z) / s, z: s / 4 };
}

/**
 * A chute trough's frame from a down to b: `along` the run, `across` it (level), and `up` out of
 * the floor; `rotation` takes a box's x, y, z to across, up, along.
 */
export function troughFrame(a: Vec3, b: Vec3): { along: Vec3; across: Vec3; up: Vec3; length: number; rotation: Quat } {
  const run = sub(b, a);
  const length = Math.hypot(run.x, run.y, run.z) || 1;
  const along = scale(run, 1 / length);
  const flat = Math.hypot(along.x, along.z) || 1;
  const across = { x: along.z / flat, y: 0, z: -along.x / flat };
  const up = {
    x: along.y * across.z - along.z * across.y,
    y: along.z * across.x - along.x * across.z,
    z: along.x * across.y - along.y * across.x,
  };
  return { along, across, up, length, rotation: quatFromBasis(across, up, along) };
}

/** Rotate a vector by a unit quaternion. */
export function rotate(q: Quat, v: Vec3): Vec3 {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

export function distanceToSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / Math.max(1e-9, dot(ab, ab))));
  const closest = { x: a.x + ab.x * t, y: a.y + ab.y * t, z: a.z + ab.z * t };
  return Math.hypot(p.x - closest.x, p.y - closest.y, p.z - closest.z);
}

/** Closest distance between segments p1-q1 and p2-q2. */
export function segmentDistance(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): number {
  return closestBetweenSegments(p1, q1, p2, q2).distance;
}

/** The nearest pair of points on segments p1-q1 and p2-q2, as fractions along each, and their gap. */
export function closestBetweenSegments(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): { s: number; t: number; distance: number } {
  const d1 = sub(q1, p1);
  const d2 = sub(q2, p2);
  const r = sub(p1, p2);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  let s = 0;
  let t = 0;
  if (a < 1e-9 && e < 1e-9) return { s: 0, t: 0, distance: Math.hypot(r.x, r.y, r.z) };
  if (a < 1e-9) {
    t = Math.max(0, Math.min(1, f / e));
  } else {
    const c = dot(d1, r);
    if (e < 1e-9) {
      s = Math.max(0, Math.min(1, -c / a));
    } else {
      const b = dot(d1, d2);
      const denom = a * e - b * b;
      s = denom > 1e-9 ? Math.max(0, Math.min(1, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.max(0, Math.min(1, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.max(0, Math.min(1, (b - c) / a));
      }
    }
  }
  const c1 = { x: p1.x + d1.x * s, y: p1.y + d1.y * s, z: p1.z + d1.z * s };
  const c2 = { x: p2.x + d2.x * t, y: p2.y + d2.y * t, z: p2.z + d2.z * t };
  return { s, t, distance: Math.hypot(c1.x - c2.x, c1.y - c2.y, c1.z - c2.z) };
}

/** The point on segment a-b nearest to p, and how far along (0…1) it lies. */
export function closestOnSegment(p: Vec3, a: Vec3, b: Vec3): { point: Vec3; t: number } {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / Math.max(1e-9, dot(ab, ab))));
  return { point: { x: a.x + ab.x * t, y: a.y + ab.y * t, z: a.z + ab.z * t }, t };
}

/** Rotation taking the +y axis onto the unit vector `u` (for capsules laid along a segment). */
export function yAxisTo(u: Vec3): Quat {
  const w = 1 + u.y;
  if (w < 1e-6) return { x: 1, y: 0, z: 0, w: 0 };
  // Half-way quaternion between +y and u: axis y × u = (u.z, 0, -u.x).
  const length = Math.hypot(u.z, w, u.x);
  return { x: u.z / length, y: 0, z: -u.x / length, w: w / length };
}
