export type Cue =
  | "start"
  | "retort"
  | "aimed"
  | "fire"
  | "wobble"
  | "falling"
  | "caught"
  | "caughtQueen"
  | "hoist"
  | "bowled"
  | "nearMiss"
  | "crack"
  | "lose";

/** Lines with a recorded clip in public/audio. The text must match exactly. */
export const RECORDED: Readonly<Record<string, string>> = {
  "I should like it noted that I remain the principal load.": "humpty-principal-load.m4a",
  "Both sides appear to be measuring me without permission.": "humpty-measuring.m4a",
  "A little less competence would be considerably soothing.": "humpty-competence.m4a",
  "Please test the brakes before introducing me to gravity.": "humpty-brakes.m4a",
  "Bring me timber, iron, and one excellent consequence.": "queen-consequence.m4a",
  "The tower has opinions. Strike them out of it.": "queen-tower-opinions.m4a",
  "Let gravity serve the crown that understands it.": "queen-gravity.m4a",
  "Again. The egg remains offensively spherical.": "queen-spherical.m4a",
};

export const LINES: Record<Cue, { speaker: "humpty" | "queen"; lines: string[] }> = {
  start: {
    speaker: "queen",
    lines: [
      "Let gravity serve the crown that understands it.",
      "The tower has opinions. Strike them out of it.",
      "Bring me timber, iron, and one excellent consequence.",
      "Load the gun. I feel an omelette coming on.",
    ],
  },
  retort: {
    speaker: "humpty",
    lines: [
      "I should like it noted that I remain the principal load.",
      "It's a perfectly good wall. I chose it myself.",
      "I am not a common egg. I am a public monument.",
      "Madam, I have excellent balance and a very good cravat.",
    ],
  },
  aimed: {
    speaker: "humpty",
    lines: [
      "Please test the brakes before introducing me to gravity.",
      "Both sides appear to be measuring me without permission.",
      "Is that pointed at me? It looks pointed at me.",
    ],
  },
  fire: {
    speaker: "queen",
    lines: ["Fire!", "Again!", "Loose!", "For the crown!"],
  },
  wobble: {
    speaker: "humpty",
    lines: ["Steady. STEADY.", "Nobody panic. Especially me.", "I'm fine. This is fine."],
  },
  falling: {
    speaker: "humpty",
    lines: ["Oh, bother—", "Not the face!", "Aaaaaa!", "This is not a GREAT fall!", "Catch me, you fools!"],
  },
  caught: {
    speaker: "humpty",
    lines: ["I meant to do that.", "Put me back at once. And gently.", "The King shall hear of this.", "Ha! Still round."],
  },
  caughtQueen: {
    speaker: "queen",
    lines: ["Again. The egg remains offensively spherical.", "Who hired those men?", "Hay. Of course it's hay."],
  },
  hoist: {
    speaker: "humpty",
    lines: ["Gently! GENTLY!", "Higher. Higher! Perfect.", "Back to my wall, thank you."],
  },
  bowled: {
    speaker: "queen",
    lines: ["Skittles!", "Ha! Down you go.", "Strike!"],
  },
  nearMiss: {
    speaker: "humpty",
    lines: ["A little less competence would be considerably soothing.", "Missed! As I fully intended.", "You'll have to do better than that."],
  },
  crack: {
    speaker: "queen",
    lines: ["Now THAT is a great fall.", "Omelette!", "Let's see them put THAT back together.", "Delicious."],
  },
  lose: {
    speaker: "queen",
    lines: ["Bah. Tomorrow, then.", "More powder. Much more powder.", "He is mocking me. With his roundness."],
  },
};
