import type { LevelDef } from "./level.js";
import type { MayhemKind } from "./mayhem.js";
import type { StockKind } from "./types.js";

/** What the simulation knows at the moment Humpty cracks, for judging a verse's side challenge. */
export interface ChallengeFacts {
  /** How many times each kind of mischief went on the bill. */
  count: (kind: MayhemKind) => number;
  /** Stock shots fired (the Queen's blunderbuss doesn't count). */
  shots: number;
  /** The kinds of stock shot fired. */
  fired: ReadonlySet<StockKind>;
  /** Was the wind machine blowing when he cracked? */
  windy: boolean;
  /** Times the weathercock has been turned, and the music box spun by a shot. */
  vaneTurns: number;
  spins: number;
}

export interface Challenge {
  /** One line, for the verse card and the results: what to do, before (or as) he cracks. */
  text: string;
  met: (facts: ChallengeFacts, level: LevelDef) => boolean;
}

/**
 * One side challenge per verse, for replaying a verse already won: like the stars, it counts only
 * if he cracks. Each is proved possible by a recorded line in the tests.
 */
export const CHALLENGES: Readonly<Record<string, Challenge>> = {
  "sat-on-a-wall": { text: "Save him for last: fire your other three shots first, and crack him with the fourth.", met: (f) => f.shots >= 4 },
  "had-a-great-fall": { text: "Spin the music box twice with your shots, then crack him.", met: (f) => f.spins >= 2 },
  "all-the-kings-men": { text: "Slip the stretcher crew on the banana skin, then crack him.", met: (f) => f.count("slip") > 0 },
  "over-the-wall": { text: "Blast open the treasure chest behind the wall.", met: (f) => f.count("chest") > 0 },
  "the-powder-room": { text: "Crack him without turning the stage.", met: (f) => f.count("revolve") === 0 },
  "hey-diddle-diddle": { text: "Smash eight pieces of the King's china, then crack him.", met: (f) => f.count("china") >= 8 },
  "all-the-kings-horses": { text: "Send the barrel rolling down its ramp.", met: (f) => f.count("barrel") > 0 },
  "chain-of-command": { text: "Set off a powder keg.", met: (f) => f.count("keg") > 0 },
  "hanging-by-a-thread": { text: "Bowl over two of the King's men.", met: (f) => f.count("bowled") >= 2 },
  "rock-a-bye-baby": { text: "Crack him while the gale is blowing.", met: (f) => f.windy },
  "see-saw-margery-daw": { text: "Catch the rat in the mousetrap.", met: (f) => f.count("mousetrap") > 0 },
  "the-queens-billiards": { text: "Ricochet off the bumpers three times.", met: (f) => f.count("ricochet") >= 3 },
  "remember-remember": { text: "Crown a guard with the paint pot, then blow him up.", met: (f) => f.count("bucket") > 0 },
  "the-keep": { text: "Stir up the bees, then crack him.", met: (f) => f.count("hive") > 0 },
  "the-encore": { text: "Fire every kind of shot in the battery.", met: (f) => f.fired.size >= 5 },
  "ring-of-roses": { text: "Bowl over two of the dancing crews, then crack him.", met: (f) => f.count("bowled") >= 2 },
  "ride-a-cock-horse": { text: "Turn the weathercock three times, then crack him.", met: (f) => f.vaneTurns >= 3 },
  "came-tumbling-after": { text: "Crack him without sending anything down the chute.", met: (f) => f.count("chute") === 0 },
  "round-the-mulberry-bush": { text: "Bat two shots off the children on the carousel.", met: (f) => f.count("ricochet") >= 2 },
  "london-bridge": { text: "Open the treasure chest.", met: (f) => f.count("chest") > 0 },
};
