import { CURIOS } from "./curios.js";
import { Game, STEP } from "./game.js";
import { dresserChina, hopperFrame, type LevelDef } from "./level.js";
import type { StockKind, Vec3 } from "./types.js";

export interface PlannedShot {
  ammo: StockKind;
  /** World aim point, or an offset from wherever Humpty is when the gun is ready. */
  at: Vec3;
  relativeToHumpty?: boolean;
  /** Extra seconds to wait after the gun is ready before firing. */
  wait?: number;
}

function resolveAim(game: Game, shot: PlannedShot): Vec3 | undefined {
  if (!shot.relativeToHumpty) return shot.at;
  const humpty = game.humptyPosition;
  return humpty ? { x: humpty.x + shot.at.x, y: humpty.y + shot.at.y, z: humpty.z + shot.at.z } : undefined;
}

export interface PlayResult {
  won: boolean;
  lost: boolean;
  time: number;
  fall: number;
  stars: number;
  bowled: number;
  catches: number;
  shotsFired: number;
  /** Mayhem earned before the crack (or by the end). */
  mayhem: number;
  landing?: Vec3;
}

/** Plays a level headlessly with a fixed list of shots. Deterministic for a given build. */
export async function playOut(level: LevelDef, shots: readonly PlannedShot[], maxTime = 40): Promise<PlayResult> {
  const game = await Game.create(level);
  try {
    let index = 0;
    let readySince: number | undefined;
    let landing: Vec3 | undefined;
    let wasAirborne = false;
    while (game.time < maxTime) {
      const shot = shots[index];
      if (shot && game.phase === "aim" && game.reload <= 0) {
        readySince ??= game.time;
        const aim = resolveAim(game, shot);
        if (game.time - readySince >= (shot.wait ?? 0) && aim) {
          game.select(shot.ammo);
          if (game.fire(aim)) {
            index += 1;
            readySince = undefined;
          }
        }
      }
      game.step();
      if (wasAirborne && !game.humptyAirborne) landing = game.humptyPosition ?? landing;
      wasAirborne = game.humptyAirborne;
      for (const event of game.drainEvents()) {
        if (event.type === "crack") landing = event.at;
        if (event.type === "result") {
          const stars = game.stars();
          return {
            won: event.won,
            lost: !event.won,
            time: game.time,
            fall: game.stats.fall,
            stars: stars.count,
            bowled: game.stats.bowled,
            catches: game.stats.catches,
            shotsFired: game.stats.shots,
            mayhem: game.mayhem.total,
            ...(landing ? { landing } : {}),
          };
        }
      }
      if (index >= shots.length && game.phase !== "won" && game.ammoLeft > 0 && game.phase === "aim" && game.time > 30) break;
    }
    return {
      won: game.cracked,
      lost: false,
      time: game.time,
      fall: game.stats.fall,
      stars: game.stars().count,
      bowled: game.stats.bowled,
      catches: game.stats.catches,
      shotsFired: game.stats.shots,
      mayhem: game.mayhem.total,
      ...(landing ? { landing } : {}),
    };
  } catch (error) {
    console.error("playOut failed", level.id, JSON.stringify(shots), error);
    throw error;
  } finally {
    game.destroy();
  }
}

/** Largest displacement of any body after `seconds` with every body awake and no shots. */
export async function settleDrift(level: LevelDef, seconds = 6): Promise<{ drift: number; cracked: boolean; humptyDrift: number; humptyDrop: number }> {
  const game = await Game.create(level);
  try {
    for (const body of game.world.bodies.getAll()) if (body.isDynamic()) body.wakeUp();
    const start = new Map(game.bodies.map((view) => [view.id, { ...view.position }]));
    const humptyStart = game.humptyPosition;
    const steps = Math.round(seconds / STEP);
    for (let step = 0; step < steps; step += 1) game.step();
    let drift = 0;
    for (const view of game.bodies) {
      const from = start.get(view.id);
      if (!from || view.kind === "man" || view.kind === "litter" || view.kind === "horse" || view.kind === "rat") continue;
      drift = Math.max(drift, Math.hypot(view.position.x - from.x, view.position.y - from.y, view.position.z - from.z));
    }
    const humptyNow = game.humptyPosition;
    const humptyDrift = humptyStart && humptyNow
      ? Math.hypot(humptyNow.x - humptyStart.x, humptyNow.y - humptyStart.y, humptyNow.z - humptyStart.z)
      : Infinity;
    const humptyDrop = humptyStart && humptyNow ? humptyStart.y - humptyNow.y : Infinity;
    return { drift, cracked: game.cracked, humptyDrift, humptyDrop };
  } finally {
    game.destroy();
  }
}

/** Things worth a shot for the sake of mayhem alone: curios, gags and the King's men. */
export async function mayhemTargets(level: LevelDef): Promise<Array<{ label: string; at: Vec3 }>> {
  const game = await Game.create(level);
  try {
    const targets: Array<{ label: string; at: Vec3 }> = CURIOS.map((curio) => ({ label: curio.id, at: { ...curio.at } }));
    for (const view of game.bodies) {
      if (view.kind === "bucket" || view.kind === "sandbag") targets.push({ label: view.kind, at: { ...view.position } });
      if (view.kind === "man" || view.kind === "horse") targets.push({ label: view.kind, at: { ...view.position } });
      if (view.kind === "keg") targets.push({ label: "keg", at: { ...view.position } });
      if (view.kind === "fixture" && (view.material === "gong" || view.material === "hive")) targets.push({ label: view.material, at: { ...view.position } });
      if (view.kind === "peel") targets.push({ label: "peel", at: { ...view.position } });
    }
    // The King's china: a plate from each shelf, the teapot and a cup.
    const china = game.chinaView;
    if (china.length) {
      dresserChina().forEach((piece, index) => {
        if (Math.abs(piece.local.x) < 0.3 || piece.kind === "teapot") targets.push({ label: `china ${piece.kind}`, at: { ...china[index]!.at } });
      });
    }
    return targets;
  } finally {
    game.destroy();
  }
}

/** Aim points worth trying: every structural body, Humpty, and the crews. */
/**
 * Where to aim at the stage machinery: the weathercock's plate, the carousel's paddles and the
 * chute's hopper. These go first in the candidate list, as openers (and follow-ups) of two-shot lines.
 */
export function machineTargets(level: LevelDef): Vec3[] {
  const points: Vec3[] = [];
  for (const piece of level.pieces) {
    if (piece.kind === "vane") {
      const c = Math.cos(piece.angle);
      const s = Math.sin(piece.angle);
      for (const k of [0, -0.35, 0.35]) points.push({ x: piece.pos.x + k * c, y: piece.pos.y, z: piece.pos.z - k * s });
    }
    if (piece.kind === "chute") {
      const mouth = hopperFrame(piece.path).mouth;
      for (const [dx, dz] of [[0, 0], [-0.25, 0.15], [0.25, -0.15]]) points.push({ x: mouth.x + dx!, y: mouth.y, z: mouth.z + dz! });
    }
    if (piece.kind === "carousel") {
      for (const r of [(piece.inner + piece.outer) / 2, piece.outer * 0.85]) {
        for (let index = 0; index < 8; index += 1) {
          const a = (index / 8) * Math.PI * 2;
          points.push({ x: piece.pos.x + Math.cos(a) * r, y: piece.y, z: piece.pos.z - Math.sin(a) * r });
        }
      }
    }
  }
  return points;
}

export async function candidateTargets(level: LevelDef): Promise<Vec3[]> {
  const game = await Game.create(level);
  try {
    const points: Vec3[] = [];
    // Fixtures that set off a stage cue (the gong, the wind machine, the trapdoor lever).
    const cues = new Set<string>(level.pieces.flatMap((piece) => (piece.kind === "fixture" && piece.cue ? [piece.look] : [])));
    for (const view of game.bodies) {
      if (view.kind === "block" || view.kind === "keg" || view.kind === "hay") {
        points.push({ ...view.position });
        // Heavy things perched on plinths are best struck high.
        if (view.material === "anvil") for (const dy of [0.1, 0.18]) points.push({ ...view.position, y: view.position.y + dy });
      }
      if (view.kind === "humpty") {
        points.push({ ...view.position });
        points.push({ x: view.position.x - 0.35, y: view.position.y, z: view.position.z });
        points.push({ x: view.position.x + 0.35, y: view.position.y, z: view.position.z });
        points.push({ x: view.position.x, y: view.position.y - 0.4, z: view.position.z });
      }
      if (view.kind === "man" || view.kind === "horse") points.push({ ...view.position });
      if (view.kind === "bucket" || view.kind === "sandbag") points.push({ ...view.position });
      // Stage cues come first: they are the openers of two-shot lines.
      if (view.kind === "fixture" && cues.has(view.material)) points.unshift({ ...view.position });
      if (view.kind === "fixture" && (view.material === "bumper" || view.material === "drum")) {
        for (const dy of [-0.5, -0.25, 0, 0.25, 0.5]) points.push({ x: view.position.x, y: view.position.y + dy, z: view.position.z });
      }
    }
    // The machinery goes right after the stage cues.
    const cueCount = level.pieces.filter((piece) => piece.kind === "fixture" && piece.cue).length;
    points.splice(cueCount, 0, ...machineTargets(level));
    for (const rope of game.ropeViews) {
      for (const k of [0.25, 0.5, 0.75]) {
        points.push({
          x: rope.bottom.x + (rope.top.x - rope.bottom.x) * k,
          y: rope.bottom.y + (rope.top.y - rope.bottom.y) * k,
          z: rope.bottom.z + (rope.top.z - rope.bottom.z) * k,
        });
      }
    }
    return points;
  } finally {
    game.destroy();
  }
}
