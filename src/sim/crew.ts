import { timeToHeight } from "./ballistics.js";
import type { CrewDef, Zone } from "./level.js";
import type { Vec3 } from "./types.js";

export type CrewKind = CrewDef["kind"];
export type CrewMode = "idle" | "patrol" | "run" | "stunned" | "recover" | "cheer" | "lunch" | "blind" | "trapped" | "stung";

/** How long the King's men are down the trapdoor before they climb back up. */
export const TRAP_TIME = 9;
/** How far below the boards they drop, and how fast they fall and climb. */
const TRAP_DEPTH = 2.6;

/** How long a man with a bucket on his head blunders about. */
export const BUCKET_TIME = 8;

/** How long a man keeps flapping and running after the bees last got at him. */
export const STING_TIME = 2.2;

/** How long the King's men are away when the dinner gong goes. */
export const LUNCH_BREAK = 13;
/** Where they eat: just past the wings. */
const CANTEEN_X = 18.5;

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
  /** Which wing they go to for lunch (-1 or 1), and when they're due back. */
  canteen: number;
  lunchUntil: number;
  /** Wearing a bucket: blundering about until then, catching nothing. */
  bucketUntil: number;
  /** Down the trapdoor: how far below the boards, and when they climb back out. */
  sink: number;
  trapUntil: number;
  /** Chased by bees: fleeing (away from `stingFrom`) until then, catching nothing. */
  stungUntil: number;
  stingFrom: { x: number; z: number };
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
    canteen: def.home.x < 0 ? -1 : 1,
    lunchUntil: -1,
    bucketUntil: -1,
    sink: 0,
    trapUntil: -1,
    stungUntil: -1,
    stingFrom: { x: def.home.x, z: def.home.z },
  };
}

/** The bees have found them: off they run, flapping, with the swarm behind. */
export function sting(crew: CrewState, time: number, from: { x: number; z: number }): boolean {
  if (crew.mode === "stunned" || crew.mode === "recover" || crew.mode === "trapped" || crew.mode === "lunch") return false;
  const fresh = crew.mode !== "stung";
  crew.stungUntil = time + STING_TIME;
  crew.stingFrom = { x: from.x, z: from.z };
  crew.threatSince = -1;
  crew.mode = "stung";
  return fresh;
}

/** The trapdoor opens under them: a-tishoo, a-tishoo, they all fall down. */
export function dropThroughTrap(crew: CrewState, time: number): void {
  // Anyone lying flat drops through too, and climbs back out on his feet.
  crew.toppled = 0;
  crew.mode = "trapped";
  crew.trapUntil = time + TRAP_TIME;
  crew.threatSince = -1;
  crew.speed = 0;
}

/** A bucket lands on someone's head. The whole crew stops to deal with it. */
export function crownWithBucket(crew: CrewState, time: number): void {
  crew.bucketUntil = time + BUCKET_TIME;
  crew.threatSince = -1;
  if (crew.mode !== "stunned" && crew.mode !== "recover" && crew.mode !== "trapped") crew.mode = "blind";
}

/** The gong: off they go to the nearest wing. Anyone knocked flat follows once he's up. */
export function callLunch(crew: CrewState, time: number): void {
  crew.canteen = crew.x < 0 ? -1 : 1;
  crew.lunchUntil = time + LUNCH_BREAK;
  crew.threatSince = -1;
  if (crew.mode !== "stunned" && crew.mode !== "recover" && crew.mode !== "trapped") crew.mode = "lunch";
}

/** What a crew goes back to doing: lunch if it isn't over, otherwise their post. */
function resume(crew: CrewState, time: number): CrewMode {
  if (crew.sink > 0) return "trapped";
  if (time < crew.stungUntil) return "stung";
  if (time < crew.bucketUntil) return "blind";
  if (time < crew.lunchUntil) return "lunch";
  return crew.def.patrol?.length ? "patrol" : "idle";
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

/** Where a crew may run when it panics: along its patrol, or a few paces either side of its post. */
function beatOf(crew: CrewState): { minX: number; maxX: number; z: number } {
  const patrol = crew.def.patrol;
  if (patrol?.length) {
    const xs = patrol.map((point) => point.x);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), z: patrol[0]!.z };
  }
  const zone = crew.def.zone;
  return { minX: Math.max(zone?.minX ?? -Infinity, crew.def.home.x - 3), maxX: Math.min(zone?.maxX ?? Infinity, crew.def.home.x + 3), z: crew.def.home.z };
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
  // Out of the trapdoor, whatever else is happening (a crack sends everyone cheering mid-climb).
  if (crew.mode !== "trapped" && crew.sink > 0) crew.sink = Math.max(0, crew.sink - dt * 2.4);
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
      crew.mode = resume(crew, time);
    }
    return;
  }
  if (crew.mode === "cheer") {
    crew.speed = 0;
    if (time >= crew.modeUntil) crew.mode = resume(crew, time);
    return;
  }

  let goal: { x: number; z: number } | undefined;
  let pace = crew.def.pace ?? spec.walk;
  const canCatch = spec.run > 0;

  if (crew.mode === "trapped") {
    // Down they go, fast; later they climb back up the ladder, slowly.
    crew.speed = 0;
    if (time < crew.trapUntil) {
      crew.sink = Math.min(TRAP_DEPTH, crew.sink + dt * 7);
    } else {
      crew.sink = Math.max(0, crew.sink - dt * 2.4);
      if (crew.sink === 0) crew.mode = resume(crew, time);
    }
    return;
  }
  if (crew.mode === "stung") {
    if (time >= crew.stungUntil) {
      crew.mode = resume(crew, time);
    } else if (crew.kind !== "litter") {
      // A guard has nowhere to run and a horse only rears: they stay put, flapping and stamping.
      crew.speed = 0;
      if (crew.kind === "guard") crew.heading = wrapAngle(crew.heading + dt * 5);
      crew.target = undefined;
      return;
    } else {
      // Bearers run for it along their own beat, away from the bees; cornered at the end of it,
      // they double back past them. Their beat is kept clear, so they never plough into scenery.
      const beat = beatOf(crew);
      const away = crew.x >= crew.stingFrom.x ? 1 : -1;
      let x = away > 0 ? beat.maxX : beat.minX;
      if (Math.abs(x - crew.x) < 0.5) x = away > 0 ? beat.minX : beat.maxX;
      goal = { x, z: beat.z };
      pace = spec.run;
    }
  }
  if (crew.mode === "blind") {
    if (time >= crew.bucketUntil) {
      crew.mode = resume(crew, time);
    } else {
      // Arms out, turning in slow circles, walking into things.
      crew.heading = wrapAngle(crew.heading + dt * (crew.kind === "guard" ? 1.6 : 0.9));
      crew.speed = crew.kind === "guard" ? 0.25 : 0.7;
      const travel = crew.speed * dt;
      crew.x += Math.sin(crew.heading) * travel;
      crew.z += Math.cos(crew.heading) * travel;
      crew.stride += travel;
      crew.target = undefined;
      return;
    }
  }
  if (crew.mode === "lunch") {
    // Nothing comes between the King's men and their lunch. Not even a falling egg.
    if (time >= crew.lunchUntil) crew.mode = resume(crew, time);
    else {
      goal = { x: crew.canteen * CANTEEN_X, z: crew.z };
      pace = Math.max(spec.walk * 2.2, spec.run * 0.6);
    }
  } else if (crew.mode === "stung") {
    // Nothing else on their minds.
  } else if (canCatch && threat) {
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
  // Goals are already inside the zone; a crew back from lunch walks in from the wings.
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
