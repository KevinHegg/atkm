/**
 * Named trick shots: judged in the simulation at the crack, from how he came off his perch.
 * Each pays a little mayhem on top (before the crack goes on the bill), and each is named on
 * stage, and again in the instant replay, when he cracks.
 */
export type TrickKind = "bank" | "double-bank" | "mid-air" | "rug-pull" | "powder" | "last-round";

export interface TrickRule {
  name: string;
  points: number;
  /** What it means, for the bill and the replay's caption. */
  blurb: string;
}

export const TRICKS: Record<TrickKind, TrickRule> = {
  bank: { name: "Bank Shot", points: 60, blurb: "Glanced off the scenery on its way to him." },
  "double-bank": { name: "Double Bank", points: 150, blurb: "Glanced off two things on its way to him." },
  "mid-air": { name: "Mid-Air", points: 120, blurb: "Struck again on his way down." },
  "rug-pull": { name: "Rug Pull", points: 60, blurb: "Nothing you fired touched him: the ground went out from under him." },
  powder: { name: "Powder Trick", points: 80, blurb: "A powder keg's blast sent him flying." },
  "last-round": { name: "Last Round", points: 80, blurb: "The battery was empty." },
};

/** Something the Queen fired that reached him: a munition (and what it glanced off first), or a blast. */
export interface Blow {
  time: number;
  /** Which shot in the log it came from (-1: a keg nobody in particular set off). */
  shot: number;
  /** How many things a munition glanced off before it reached him; blasts are 0. */
  banks: number;
  blast?: "bomb" | "keg";
  /** Was he already in the air? */
  airborne: boolean;
}

export interface TrickFacts {
  /** Blows since he last sat still (at most a few seconds before the crack). */
  blows: readonly Blow[];
  /** Rounds left in every rack. */
  stock: number;
}

/** Every trick he cracked with, most prized first. */
export function judgeTricks(facts: TrickFacts): TrickKind[] {
  const tricks: TrickKind[] = [];
  const banks = Math.max(0, ...facts.blows.map((blow) => blow.banks));
  if (banks >= 2) tricks.push("double-bank");
  else if (banks === 1) tricks.push("bank");
  // Caught in the air by another shot than the one that knocked him off (a grapeshot volley's
  // stragglers are the same shot).
  const first = facts.blows[0];
  if (facts.blows.some((blow) => blow.airborne && (blow === first || blow.shot < 0 || blow.shot !== first!.shot))) tricks.push("mid-air");
  if (facts.blows.some((blow) => blow.blast === "keg")) tricks.push("powder");
  if (!facts.blows.length) tricks.push("rug-pull");
  if (facts.stock === 0) tricks.push("last-round");
  return tricks;
}
