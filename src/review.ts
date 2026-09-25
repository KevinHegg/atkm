import type { MayhemEntry, MayhemKind } from "./sim/mayhem.js";

export interface ReviewInput {
  won: boolean;
  fall: number;
  greatFall: number;
  stars: number;
  mayhem: number;
  tally: ReadonlyMap<MayhemKind, MayhemEntry>;
  shots: number;
  title: string;
  /** Who was hiding the star, if it was found. */
  starFrom?: string;
}

export interface Review {
  paper: string;
  headline: string;
  body: string;
  critic: string;
}

/** What the morning papers made of the performance, written from the Queen's bill of damages. */
export function review(input: ReviewInput, pick: (count: number) => number = (count) => Math.floor(Math.random() * count)): Review {
  const count = (kind: MayhemKind): number => input.tally.get(kind)?.count ?? 0;
  const choose = <T>(options: readonly T[]): T => options[pick(options.length)]!;
  if (!input.won) {
    return {
      paper: "The Daily Yolk",
      headline: choose(["EGG SURVIVES; QUEEN FURIOUS", "ALL THE KING'S MEN TRIUMPHANT", "HUMPTY: “I WAS NEVER IN ANY DANGER”"]),
      body: choose([
        `Mr H. Dumpty took ${input.shots} shots without so much as a hairline crack, and afterwards signed autographs.`,
        "The Queen's gunner spent the evening redecorating the set. Humpty spent it smiling.",
        "Our egg remains whole, round and, he would like it known, extremely handsome.",
      ]),
      critic: "“The egg gave the finest performance of the night by staying in one piece.”",
    };
  }
  // The headline goes to the most memorable thing that happened.
  const stories: Array<[boolean, number, () => string]> = [
    [count("star") > 0, 95, () => `STAR FOUND HIDING IN ${(input.starFrom ?? "the scenery").toUpperCase()}`],
    [count("royal") > 0, 90, () => "KING COLE OUTRAGED IN HIS OWN BOX"],
    [count("bounce") >= 2, 58, () => "EGG BOUNCES ON ROYAL BED; SPRINGS CONFISCATED"],
    [count("wind") > 0, 57, () => "GALE BLOWS THROUGH THEATRE; CRADLE ROCKED"],
    [count("chest") > 0, 52, () => "QUEEN RAIDS ROYAL POWDER CHEST"],
    [count("bucket") > 0, 85, () => (count("bucket") > 1 ? `${count("bucket")} GUARDS BLUNDER ABOUT IN PAINT POTS` : "GUARD BLUNDERS ABOUT IN PAINT POT")],
    [count("gong") > 0, 80, () => "KING'S MEN ABANDON POST FOR SOUP"],
    [count("duke") > 0, 75, () => "DUKE OF YORK'S MEN FLATTENED HALFWAY UP HILL"],
    [count("maypole") > 0, 70, () => "MAYPOLE FELLED; VILLAGE IN MOURNING"],
    [count("keg") >= 3, 68, () => `${count("keg")} POWDER KEGS GO UP; FRONT ROW LOSES EYEBROWS`],
    [count("bowled") >= 3, 65, () => `${count("bowled")} OF THE KING'S MEN BOWLED LIKE SKITTLES`],
    [count("masonry") >= 20, 60, () => `${count("masonry")} BLOCKS OF ROYAL MASONRY REDUCED TO RUBBLE`],
    [count("rope") > 0, 55, () => "ROYAL SWING CUT DOWN"],
    [count("rat") > 0, 50, () => "GIANT RAT ROUTED BY BLUNDERBUSS"],
    [count("curio") >= 2, 45, () => "NURSERY RHYMES RUN AMOK ACROSS THE SCENERY"],
    [input.fall >= input.greatFall, 40, () => `${input.fall.toFixed(1)} METRES! EGG IN PIECES`],
    [true, 0, () => "HUMPTY DUMPTY HAS A FALL"],
  ];
  const [, , headline] = stories.filter(([happened]) => happened).sort((a, b) => b[1] - a[1])[0]!;
  const sentences: string[] = [];
  sentences.push(input.fall >= input.greatFall
    ? `Mr H. Dumpty fell ${input.fall.toFixed(1)} metres and broke, as promised, into a great many pieces.`
    : `Mr H. Dumpty fell a mere ${input.fall.toFixed(1)} metres, which he will insist was not a great fall.`);
  const extras: string[] = [];
  if (count("bowled")) extras.push(`${count("bowled")} of the King's men bowled over`);
  if (count("masonry")) extras.push(`${count("masonry")} blocks brought down`);
  if (count("keg")) extras.push(`${count("keg")} kegs of powder set off`);
  if (count("curio") + count("royal") + count("duke")) extras.push("the scenery thoroughly disturbed");
  if (extras.length) sentences.push(`The evening also saw ${listOf(extras)}.`);
  sentences.push(`Damages to the Crown: ${input.mayhem.toLocaleString("en-GB")} crowns.`);
  const critic = [
    "“Cracked, certainly. Memorable? Hardly.”",
    "“Cracked, yes, though the second act dragged.”",
    "“Promising carnage. I shall return with a larger hat.”",
    "“A cracking performance. I laughed until my monocle fell out.”",
  ][Math.min(3, input.stars)]!;
  return { paper: choose(["The Nursery Times", "The Pudding Lane Gazette", "The Banbury Cross Courier"]), headline: headline(), body: sentences.join(" "), critic };
}

function listOf(items: string[]): string {
  if (items.length < 2) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
