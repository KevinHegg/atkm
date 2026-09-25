import { timeToHeight } from "./ballistics.js";
import type { CrewDef, Zone } from "./level.js";
import type { Vec3 } from "./types.js";

export type CrewKind = CrewDef["kind"];
export type CrewMode = "idle" | "patrol" | "run" | "stunned" | "recover" | "cheer";

export interface CrewSpec {
  walk: number;
  run: number;
  turn: number;
  /** Height of the catching surface (top of the litter or cart bed). */
  bedTop: number;
  reaction: number;
}

export const CREW_SPECS: Record<CrewKind, CrewSpec> = {
  litter: { walk: 1.25, run: 4.3, turn: 7, bedTop: 0.92, reaction: 0.18 },
  cart: { walk: 1.8, run: 6.6, turn: 3.2, bedTop: 0.95, reaction: 0.3 },
  guard: { walk: 1.1, run: 0, turn: 6, bedTop: 0, reaction: 0 },
};

export interface FormationSlot {
  role: "man" | "horse" | "bed";
  /** Local offset: +z is the direction of travel. */
  local: Vec3;
  size: Vec3;
}

export function formation(kind: CrewKind): FormationSlot[] {
  if (kind === "litter") {
    return [
      { role: "bed", local: { x: 0, y: 0.84, z: 0 }, size: { x: 0.95, y: 0.16, z: 1.75 } },
      { role: "man", local: { x: 0, y: 0.8, z: 1.28 }, size: { x: 0.5, y: 1.6, z: 0.4 } },
      { role: "man", local: { x: 0, y: 0.8, z: -1.28 }, size: { x: 0.5, y: 1.6, z: 0.4 } },
    ];
  }
  if (kind === "cart") {
    return [
      { role: "bed", local: { x: 0, y: 0.8, z: -0.55 }, size: { x: 1.55, y: 0.3, z: 2.1 } },
      { role: "horse", local: { x: 0, y: 1.05, z: 1.95 }, size: { x: 0.62, y: 1.3, z: 1.7 } },
      { role: "man", local: { x: 0.95, y: 0.8, z: 1.3 }, size: { x: 0.5, y: 1.6, z: 0.4 } },
    ];
  }
  return [{ role: "man", local: { x: 0, y: 0.8, z: 0 }, size: { x: 0.5, y: 1.6, z: 0.4 } }];
}

export interface CrewState {
  id: string;
  kind: CrewKind;
  def: CrewDef;
  x: number;
  z: number;
  heading: number;
  speed: number;
  mode: CrewMode;
  modeUntil: number;
  patrolIndex: number;
  stride: number;
  threatSince: number;
  target: { x: number; z: number } | undefined;
  /** Entity ids per formation slot. */
  slots: number[];
  toppled: number;
}

export function createCrewState(def: CrewDef): CrewState {
  return {
    id: def.id,
    kind: def.kind,
    def,
    x: def.home.x,
    z: def.home.z,
    heading: def.yaw ?? 0,
    speed: 0,
    mode: def.patrol?.length ? "patrol" : "idle",
    modeUntil: 0,
    patrolIndex: 0,
    stride: 0,
    threatSince: -1,
    target: undefined,
    slots: [],
    toppled: 0,
  };
}

export interface Threat {
  position: Vec3;
  velocity: Vec3;
}

/** Where a falling Humpty will pass through the given catch height. */
export function predictLanding(threat: Threat, catchY: number): { x: number; z: number; t: number } {
  const t = timeToHeight(threat.position.y, threat.velocity.y, catchY);
  return {
    x: threat.position.x + threat.velocity.x * t,
    z: threat.position.z + threat.velocity.z * t,
    t,
  };
}

function clampToZone(x: number, z: number, zone: Zone | undefined): { x: number; z: number } {
  if (!zone) return { x, z };
  return {
    x: Math.min(zone.maxX, Math.max(zone.minX, x)),
    z: Math.min(zone.maxZ, Math.max(zone.minZ, z)),
  };
}

function wrapAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Advance one crew by dt. Pure bookkeeping — the Game moves the kinematic bodies. */
export function steerCrew(crew: CrewState, dt: number, time: number, threat: Threat | undefined, humptyCatchOffset: number): void {
  const spec = CREW_SPECS[crew.kind];
  if (crew.mode === "stunned") {
    crew.toppled = Math.min(1, crew.toppled + dt * 6);
    crew.speed = 0;
    if (time >= crew.modeUntil) {
      crew.mode = "recover";
      crew.modeUntil = time + 0.7;
    }
    return;
  }
  if (crew.mode === "recover") {
    crew.toppled = Math.max(0, crew.toppled - dt / 0.7);
    crew.speed = 0;
    if (time >= crew.modeUntil) {
      crew.toppled = 0;
      crew.mode = crew.def.patrol?.length ? "patrol" : "idle";
    }
    return;
  }
  if (crew.mode === "cheer") {
    crew.speed = 0;
    if (time >= crew.modeUntil) crew.mode = crew.def.patrol?.length ? "patrol" : "idle";
    return;
  }

  let goal: { x: number; z: number } | undefined;
  let pace = spec.walk;
  const canCatch = spec.run > 0;

  if (canCatch && threat) {
    if (crew.threatSince < 0) crew.threatSince = time;
    if (time - crew.threatSince >= spec.reaction) {
      const landing = predictLanding(threat, spec.bedTop + humptyCatchOffset);
      goal = clampToZone(landing.x, landing.z, crew.def.zone);
      pace = spec.run;
      crew.mode = "run";
    }
  } else {
    crew.threatSince = -1;
    if (crew.mode === "run") {
      crew.mode = "cheer";
      crew.modeUntil = time + 2;
      crew.speed = 0;
      return;
    }
  }

  if (!goal) {
    const patrol = crew.def.patrol;
    if (crew.mode === "patrol" && patrol && patrol.length > 0) {
      const point = patrol[crew.patrolIndex % patrol.length]!;
      if (Math.hypot(point.x - crew.x, point.z - crew.z) < 0.15) {
        crew.patrolIndex = (crew.patrolIndex + 1) % patrol.length;
      }
      const next = patrol[crew.patrolIndex % patrol.length]!;
      goal = { x: next.x, z: next.z };
    } else if (Math.hypot(crew.def.home.x - crew.x, crew.def.home.z - crew.z) > 0.1 && crew.mode !== "run") {
      goal = { x: crew.def.home.x, z: crew.def.home.z };
    }
  }

  crew.target = goal;
  if (!goal) {
    crew.speed = Math.max(0, crew.speed - dt * 8);
    const rest = crew.def.yaw ?? crew.heading;
    crew.heading += wrapAngle(rest - crew.heading) * Math.min(1, dt * 2);
    return;
  }
  const dx = goal.x - crew.x;
  const dz = goal.z - crew.z;
  const gap = Math.hypot(dx, dz);
  if (gap < 0.02) {
    crew.speed = 0;
    return;
  }
  const desired = Math.atan2(dx, dz);
  const turn = wrapAngle(desired - crew.heading);
  // A litter is symmetric fore and aft, so it may run backwards rather than turn around.
  const reverse = crew.kind === "litter" && Math.abs(turn) > Math.PI / 2;
  const facingGoal = reverse ? wrapAngle(desired + Math.PI - crew.heading) : turn;
  crew.heading = wrapAngle(crew.heading + Math.sign(facingGoal) * Math.min(Math.abs(facingGoal), spec.turn * dt));
  const aligned = Math.cos(reverse ? wrapAngle(desired + Math.PI - crew.heading) : wrapAngle(desired - crew.heading));
  const accel = pace > spec.walk ? 14 : 4;
  const wanted = Math.min(pace, gap / Math.max(dt, 1e-3), gap * 4 + 0.2);
  crew.speed += Math.sign(wanted - crew.speed) * Math.min(Math.abs(wanted - crew.speed), accel * dt);
  const travel = Math.min(gap, crew.speed * dt * (crew.kind === "cart" ? Math.max(0.2, aligned) : 1));
  crew.x += (dx / gap) * travel;
  crew.z += (dz / gap) * travel;
  const clamped = clampToZone(crew.x, crew.z, crew.def.zone ?? undefined);
  crew.x = clamped.x;
  crew.z = clamped.z;
  crew.stride += travel;
}

export function slotWorld(crew: CrewState, slot: FormationSlot): Vec3 {
  const c = Math.cos(crew.heading);
  const s = Math.sin(crew.heading);
  const lx = slot.local.x;
  const lz = slot.local.z;
  let y = slot.local.y;
  if (slot.role === "bed" && crew.toppled > 0) y = y - (y - 0.28) * crew.toppled;
  return {
    x: crew.x + lx * c + lz * s,
    y,
    z: crew.z - lx * s + lz * c,
  };
}
