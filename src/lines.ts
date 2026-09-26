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
  | "lose"
  | "ratEnter"
  | "ratSteal"
  | "ratScared"
  | "ratHumpty"
  | "ricochet"
  | "ropeCut"
  | "spin"
  | "launch"
  | "lunch"
  | "lunchQueen"
  | "timber"
  | "fizz"
  | "kingOutrage"
  | "kingCheer"
  | "kingSulk"
  | "kingLaugh"
  | "bucket"
  | "chest"
  | "star"
  | "bounce"
  | "gale"
  | "trapdoor"
  | "gate"
  | "chute"
  | "vane"
  | "teeter"
  | "combo"
  | "barrel"
  | "china"
  | "dish"
  | "bees"
  | "revolve"
  | "mousetrap"
  | "challenge"
  | "revolved"
  | "stung"
  | "slip"
  | "phew";

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

export type Speaker = "humpty" | "queen" | "king";

export const LINES: Record<Cue, { speaker: Speaker; lines: string[] }> = {
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
  ratEnter: {
    speaker: "queen",
    lines: ["RAT! Fetch my blunderbuss!", "Vermin! In MY theatre?", "Not the powder, you whiskered wretch!", "Somebody hand me the blunderbuss. Now."],
  },
  ratSteal: {
    speaker: "queen",
    lines: ["He's eaten a cartridge! The villain!", "Thief! Come back with my powder!", "That was a perfectly good cannonball."],
  },
  ratScared: {
    speaker: "queen",
    lines: ["Ha! Run, whiskers!", "And stay out!", "That's for the cheese.", "Next time I aim properly."],
  },
  ratHumpty: {
    speaker: "humpty",
    lines: ["Even the rats are on my side.", "Go on, little fellow. Eat the lot.", "I have always admired rats. Loyal creatures."],
  },
  ricochet: {
    speaker: "queen",
    lines: ["Off the cushion!", "Bank shot!", "Geometry, darling.", "Billiards is simply cannonry with manners."],
  },
  ropeCut: {
    speaker: "humpty",
    lines: ["Was that the rope? That sounded like the rope.", "Er. Hello? Ropes?", "I'd like to speak to whoever tied these."],
  },
  spin: {
    speaker: "humpty",
    lines: ["Wheee— I mean, stop that.", "I'm getting dizzy. Distinguished, but dizzy.", "Round and round goes the principal load."],
  },
  lunch: {
    speaker: "humpty",
    lines: [
      "Lunch? NOW? Gentlemen, I am up a pole!",
      "Bring me back a sandwich! Crusts off!",
      "You can't all go! Who's minding the egg?",
      "Soup? You're leaving me for SOUP?",
    ],
  },
  lunchQueen: {
    speaker: "queen",
    lines: ["Luncheon is served, gentlemen. Take your time.", "Nobody refuses a free lunch.", "Chop chop. The stew won't eat itself."],
  },
  kingOutrage: {
    speaker: "king",
    lines: ["Treason! In MY box?", "Call for my fiddlers three! And a new crown!", "I say! That was nearly my pipe!"],
  },
  kingCheer: {
    speaker: "king",
    lines: ["Well held, men! Well held!", "Ha! That's my egg!", "A pint for every man on that stretcher!"],
  },
  kingSulk: {
    speaker: "king",
    lines: ["My egg. My beautiful egg.", "Somebody fetch the glue.", "I shall need a larger bowl."],
  },
  kingLaugh: {
    speaker: "king",
    lines: ["Ho ho! Clumsy oafs.", "Get up, you great puddings!", "Ha! Down like ninepins."],
  },
  chest: {
    speaker: "queen",
    lines: ["Spare powder! Somebody's been saving.", "Finders keepers.", "Ooh, a little something for the battery."],
  },
  star: {
    speaker: "humpty",
    lines: ["Was that a star? Put it back at once!", "That was MY star. I was keeping it.", "Oh, now you've found the star. Show-off."],
  },
  bounce: {
    speaker: "humpty",
    lines: ["Wheeeee— I mean, stop that.", "This bed is FAR too bouncy!", "Up I go! And, er, down?"],
  },
  barrel: {
    speaker: "humpty",
    lines: ["Is that a barrel? Is that a LIT barrel?", "Somebody stop that barrel! Somebody else!", "Gentlemen, I believe we are being bowled at."],
  },
  mousetrap: {
    speaker: "queen",
    lines: ["Snap! And stay out of my powder.", "Cheese: the rat's one weakness.", "Got you by the tail, you thief."],
  },
  challenge: {
    speaker: "queen",
    lines: ["And with a flourish, too.", "That's how it's done. Take notes, egg.", "Show-off. I adore it."],
  },
  revolve: {
    speaker: "humpty",
    lines: ["Is the room going round, or is it me?", "Where is my hay going? Come back, hay!", "Round and round the cobbler's bench... I hate this song."],
  },
  revolved: {
    speaker: "queen",
    lines: ["There. The hay is out front now, where it can watch.", "All the way round. Pop goes the weasel.", "Mind the back, egg. There's nothing there."],
  },
  bees: {
    speaker: "humpty",
    lines: ["Bees? BEES?", "Nobody panic! Everybody panic!", "Keep them away from me, I'm mostly yolk!"],
  },
  stung: {
    speaker: "queen",
    lines: ["Run, gentlemen! Run!", "Buzz off, the lot of you.", "They'll need a stretcher for the stretcher-bearers."],
  },
  slip: {
    speaker: "queen",
    lines: ["Whoops-a-daisy.", "Mind the banana.", "The oldest joke in the theatre, and still the best."],
  },
  china: {
    speaker: "king",
    lines: ["My best china!", "Not the willow pattern!", "That teapot was my mother's!", "Guards! Arrest that cannon!"],
  },
  dish: {
    speaker: "queen",
    lines: ["And the dish ran away with the spoon.", "Hey diddle diddle. Off they go.", "Catch that dish! No, let it go."],
  },
  phew: {
    speaker: "humpty",
    lines: ["Phew.", "Perfectly balanced. As I said.", "I was never in any danger. None whatsoever."],
  },
  combo: {
    speaker: "queen",
    lines: ["Did you SEE that? All of that, with one shot!", "That, egg, is what we call a trick shot.", "Bravo me. Bravissimo me."],
  },
  teeter: {
    speaker: "humpty",
    lines: ["Whoa. Whoa. WHOA.", "Nobody move. Nobody BREATHE.", "I meant to do that. I am perfectly balanced.", "Is it windy? It feels windy up here."],
  },
  gate: {
    speaker: "queen",
    lines: ["Wind it up! Wind it UP!", "London Bridge is falling down, and so are you, egg.", "The gate is open. My patience is not."],
  },
  chute: {
    speaker: "humpty",
    lines: ["What is that rumbling?", "Did somebody post a parcel? Down the chute? Near the POWDER?", "I hear fizzing. I dislike fizzing."],
  },
  vane: {
    speaker: "queen",
    lines: ["Round she goes. Now, which way is the egg?", "The weathercock says: east wind, and a great fall.", "Turn, cockerel, turn."],
  },
  trapdoor: {
    speaker: "humpty",
    lines: ["Gentlemen? GENTLEMEN? Where did everybody go?", "A-tishoo yourselves! Come back up!", "That was not in the choreography."],
  },
  gale: {
    speaker: "humpty",
    lines: ["Rock-a-bye ME? I am not a baby!", "Somebody turn that wind off!", "I'm going to be sick. Majestically."],
  },
  bucket: {
    speaker: "queen",
    lines: ["A perfect fit.", "Whitewash suits him.", "Somebody fetch that man a mirror."],
  },
  fizz: {
    speaker: "humpty",
    lines: ["Is that… fizzing?", "Somebody pinch that out!", "Nobody panic. It's a very small bomb.", "I say, that's lit!"],
  },
  timber: {
    speaker: "humpty",
    lines: ["TIMBER! Oh — that's me.", "That was load-bearing!", "Somebody has cut down my maypole!"],
  },
  launch: {
    speaker: "humpty",
    lines: ["I'M FLYING. I DON'T LIKE IT.", "This was not in the brochure!", "Put me DOWN. Gently. GENTLY!"],
  },
};

/** What someone says when a curio in the scenery is struck. */
export const CURIO_LINES: Readonly<Record<string, { speaker: Speaker; line: string }>> = {
  cow: { speaker: "humpty", line: "Did that cow just jump over the moon?" },
  moon: { speaker: "queen", line: "Don't shoot the moon. It's the only one we've got." },
  "jack-and-jill": { speaker: "humpty", line: "Somebody fetch Jack a new crown. Not mine." },
  cuckoo: { speaker: "queen", line: "It's the hour of your doom, egg. Cuckoo!" },
  well: { speaker: "humpty", line: "Ding dong bell! Who put the cat in there?" },
  spider: { speaker: "queen", line: "Miss Muffet will be absolutely furious." },
  pie: { speaker: "king", line: "My pie! Four-and-twenty blackbirds, and not one of them baked!" },
  mouse: { speaker: "humpty", line: "The clock struck one, the mouse ran down. I, however, am staying up." },
  duke: { speaker: "humpty", line: "The Grand Old Duke of York! He had ten thousand men. Had." },
  stagehands: { speaker: "humpty", line: "Not the stagehands! Who's going to winch me back up now?" },
};
