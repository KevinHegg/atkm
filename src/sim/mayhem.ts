import type { Vec3 } from "./types.js";

/**
 * Mayhem: the verse's score. Everything the Queen breaks, bowls, rings or startles counts,
 * up to the moment Humpty cracks. Then the curtain comes down and the bill is totted up.
 */
export type MayhemKind =
  | "masonry"
  | "hay"
  | "keg"
  | "bowled"
  | "bucket"
  | "curio"
  | "royal"
  | "duke"
  | "ricochet"
  | "rope"
  | "maypole"
  | "rat"
  | "gong"
  | "chest"
  | "bounce"
  | "wind"
  | "star"
  | "great"
  | "trap"
  | "stagehand"
  | "gate"
  | "chute"
  | "combo"
  | "barrel"
  | "china"
  | "slip"
  | "hive"
  | "stung"
  | "revolve"
  | "tower"
  | "crack";

export interface MayhemRule {
  points: number;
  /** A line on the King's bill of damages. */
  bill: string;
  /** What pops up on stage when it happens. */
  shout: string;
}

export const MAYHEM: Record<MayhemKind, MayhemRule> = {
  masonry: { points: 10, bill: "Masonry toppled", shout: "Crash!" },
  hay: { points: 5, bill: "Hay scattered", shout: "Whumph" },
  keg: { points: 40, bill: "Powder kegs", shout: "Kaboom!" },
  bowled: { points: 50, bill: "King's men bowled over", shout: "Skittles!" },
  bucket: { points: 120, bill: "Guards in buckets", shout: "Bucket!" },
  curio: { points: 75, bill: "Scenery disturbed", shout: "Encore!" },
  royal: { points: 150, bill: "Royal box, outraged", shout: "Treason!" },
  duke: { points: 75, bill: "The Grand Old Duke's men", shout: "About turn!" },
  ricochet: { points: 15, bill: "Bank shots", shout: "Clang!" },
  rope: { points: 30, bill: "Ropes cut", shout: "Snip!" },
  maypole: { points: 40, bill: "Maypoles felled", shout: "Timber!" },
  rat: { points: 40, bill: "Rats routed", shout: "Shoo!" },
  gong: { points: 50, bill: "Lunches called", shout: "Luncheon!" },
  chest: { points: 50, bill: "Treasure chests forced", shout: "Treasure!" },
  bounce: { points: 25, bill: "Bounces on the royal bed", shout: "Boing!" },
  wind: { points: 40, bill: "Gales raised", shout: "Whoosh!" },
  star: { points: 100, bill: "A hidden star, found", shout: "A star!" },
  great: { points: 150, bill: "A great fall", shout: "A great fall!" },
  trap: { points: 50, bill: "King's men down the trapdoor", shout: "A-tishoo!" },
  stagehand: { points: 75, bill: "Stagehands flattened", shout: "Oi!" },
  gate: { points: 40, bill: "Portcullises raised", shout: "Up she goes!" },
  chute: { points: 60, bill: "Bombs down the chute", shout: "Wheee!" },
  combo: { points: 0, bill: "Trick shots", shout: "Combo!" },
  barrel: { points: 40, bill: "Barrels sent rolling", shout: "Look out below!" },
  china: { points: 20, bill: "The King's best china", shout: "Smash!" },
  slip: { points: 70, bill: "Slips on banana skins", shout: "Whoops!" },
  hive: { points: 50, bill: "Beehives stirred up", shout: "Bees!" },
  stung: { points: 35, bill: "King's men stung", shout: "Ow!" },
  revolve: { points: 60, bill: "Revolving stage turned", shout: "Round she goes!" },
  tower: { points: 75, bill: "The royal box, rattled", shout: "Steady on!" },
  crack: { points: 300, bill: "One egg, cracked", shout: "Cracked!" },
};

/** Extra points per metre of Humpty's fall, on top of the crack. */
export const FALL_POINTS = 50;

export interface MayhemEntry {
  count: number;
  points: number;
}

export class MayhemTally {
  total = 0;
  readonly entries = new Map<MayhemKind, MayhemEntry>();

  add(kind: MayhemKind, points = MAYHEM[kind].points): number {
    const entry = this.entries.get(kind) ?? { count: 0, points: 0 };
    entry.count += 1;
    entry.points += points;
    this.entries.set(kind, entry);
    this.total += points;
    return points;
  }

  /** Bill lines in the order they were first earned. */
  lines(): Array<{ kind: MayhemKind; bill: string } & MayhemEntry> {
    return [...this.entries].map(([kind, entry]) => ({ kind, bill: MAYHEM[kind].bill, ...entry }));
  }
}

export interface MayhemEvent {
  type: "mayhem";
  kind: MayhemKind;
  points: number;
  at: Vec3;
  /** What to shout instead of the kind's usual word ("Combo ×4!"). */
  label?: string;
}

/**
 * A trick shot: one shot that sets off this many different kinds of mayhem earns a bonus on top.
 * Nothing below three; the crack and the great fall don't count towards it.
 */
export function comboBonus(kinds: number): number {
  if (kinds < 3) return 0;
  return [100, 200, 350, 500][kinds - 3] ?? 700;
}
