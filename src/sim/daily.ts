import type { LevelDef, Weather } from "./level.js";
import type { StockKind } from "./types.js";

/**
 * The Verse of the Day: one of the verses, played under a twist of the day and under another
 * sky. Every twist a verse is offered is one its recorded par line still wins under (the tests
 * replay each), so the day's verse can always be done. Nothing here reads the clock: the day
 * comes in as a string, and the same day always gives the same verse.
 */
export type DailyRule = "round-shot" | "short-rations" | "no-spare" | "royal";

export const DAILY_RULES: Record<DailyRule, { name: string; text: string }> = {
  "round-shot": { name: "Round Shot Only", text: "Every rack is round shot today: as many rounds as the verse usually carries, all of them round shot." },
  "short-rations": { name: "Short Rations", text: "Half the usual rounds in every rack." },
  "no-spare": { name: "Not a Round to Spare", text: "Only as many rounds as it takes, and not one more. (A chest still pays out.)" },
  royal: { name: "Royal Rules", text: "Royal difficulty today: half an aim arc, no ring where the shot lands, and no Court Astrologer." },
};

const WEATHERS: readonly Weather[] = ["dusk", "dawn", "day", "night", "rain", "storm", "snow"];

type Line = ReadonlyArray<{ ammo: string }>;

/** What each rack holds today (in the verse's own tray order), or undefined if the rule changes nothing here. */
function dailyAmmo(level: LevelDef, rule: DailyRule, par: Line): Partial<Record<StockKind, number>> | undefined {
  const kinds = (Object.keys(level.ammo) as StockKind[]).filter((kind) => (level.ammo[kind] ?? 0) > 0);
  const total = kinds.reduce((sum, kind) => sum + (level.ammo[kind] ?? 0), 0);
  const used = (kind: StockKind): number => par.filter((shot) => shot.ammo === kind).length;
  if (rule === "round-shot") return kinds.some((kind) => kind !== "shot") ? { shot: total } : undefined;
  if (rule === "short-rations") {
    const ammo = Object.fromEntries(kinds.map((kind) => [kind, Math.ceil((level.ammo[kind] ?? 0) / 2)])) as Partial<Record<StockKind, number>>;
    return kinds.some((kind) => ammo[kind]! < (level.ammo[kind] ?? 0)) ? ammo : undefined;
  }
  if (rule === "no-spare") {
    const ammo = Object.fromEntries(kinds.filter((kind) => used(kind) > 0).map((kind) => [kind, used(kind)])) as Partial<Record<StockKind, number>>;
    return Object.values(ammo).reduce((sum, count) => sum + count!, 0) < total ? ammo : undefined;
  }
  return undefined;
}

/**
 * The twists a verse can be played under: each must leave its par line enough of every kind it
 * fires, and must actually change something. (The rat's verses keep their full racks: he steals.)
 */
export function dailyRules(level: LevelDef, par: Line | undefined): DailyRule[] {
  if (!par?.length || par.some((shot) => shot.ammo === "blunderbuss")) return ["royal"];
  const rules: DailyRule[] = [];
  if (par.every((shot) => shot.ammo === "shot") && dailyAmmo(level, "round-shot", par)) rules.push("round-shot");
  if (!level.rat) {
    for (const rule of ["short-rations", "no-spare"] as const) {
      const ammo = dailyAmmo(level, rule, par);
      const enough = ammo && par.every((shot) => (ammo[shot.ammo as StockKind] ?? 0) >= par.filter((other) => other.ammo === shot.ammo).length);
      if (enough) rules.push(rule);
    }
  }
  rules.push("royal");
  return rules;
}

/** The verse as it's played today: the same verse (same id), with today's racks and sky. */
export function dailyLevel(level: LevelDef, rule: DailyRule, weather: Weather, par: Line | undefined): LevelDef {
  const ammo = par ? dailyAmmo(level, rule, par) : undefined;
  return { ...level, ...(ammo ? { ammo } : {}), weather };
}

/** A day's key hashed to a number (FNV-1a), so each day turns up its own verse. */
function hashDay(day: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < day.length; index += 1) {
    hash ^= day.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * Today's verse, twist and sky, from the verses on offer (each with the twists it can take).
 * The weather is never the verse's own.
 */
export function pickDaily(day: string, offers: ReadonlyArray<{ index: number; level: LevelDef; rules: readonly DailyRule[] }>): { index: number; rule: DailyRule; weather: Weather } | undefined {
  const choices = offers.flatMap((offer) => offer.rules.map((rule) => ({ offer, rule })));
  if (!choices.length) return undefined;
  const hash = hashDay(day);
  const { offer, rule } = choices[hash % choices.length]!;
  const own = offer.level.weather ?? "dusk";
  const others = WEATHERS.filter((weather) => weather !== own);
  return { index: offer.index, rule, weather: others[(hash >>> 11) % others.length]! };
}
