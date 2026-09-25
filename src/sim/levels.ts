import { Mason, perchAt, type CrewDef, type LevelDef, type ViewDef } from "./level.js";

const VIEW: ViewDef = { yaw: 0, pitch: -22, distance: 20, target: { x: 0, y: 1.8, z: -1.8 } };

function view(overrides: Partial<ViewDef> = {}): ViewDef {
  return { ...VIEW, ...overrides, target: { ...VIEW.target, ...overrides.target } };
}

function satOnAWall(): LevelDef {
  const m = new Mason();
  const top = m.wall("oak", 0, -1, 6, 6);
  return {
    id: "sat-on-a-wall",
    title: "Sat on a Wall",
    verse: ["Humpty Dumpty sat on a wall,", "and the Queen wheeled her cannon into the hall."],
    hint: "Aim at anything and fire. A cannonball won’t break him — only a fall will.",
    ammo: { shot: 3 },
    greatFall: 3,
    humpty: perchAt(0, top, -1),
    pieces: m.pieces,
    crews: [],
    view: view(),
  };
}

function hadAGreatFall(): LevelDef {
  const m = new Mason();
  const top = m.pillar("stone", 0, -1.2, 5, { size: 1, height: 0.8 });
  for (const z of [-2.6, -3.45, -4.3, -5.15, -6, -6.85, -7.7]) m.hay(0, z);
  m.hay(0, -3.45, 0.7);
  m.hay(0, -5.15, 0.7);
  return {
    id: "had-a-great-fall",
    title: "Had a Great Fall",
    verse: ["Humpty Dumpty sat up high", "on a haystack's worth of alibi."],
    hint: "Straight hits push him back into the hay. Clip him on one side to send him somewhere harder.",
    ammo: { shot: 3 },
    greatFall: 3.6,
    humpty: perchAt(0, top, -1.2),
    pieces: m.pieces,
    crews: [],
    view: view({ yaw: 22, pitch: -24 }),
  };
}

function allTheKingsMen(): LevelDef {
  const m = new Mason();
  const base = m.pillar("stone", 0, -1.5, 3, { size: 1.1, height: 0.7 });
  const top = m.tower("oak", 0, -1.5, 6, { y: base });
  const crews: CrewDef[] = [
    {
      id: "litter-a",
      kind: "litter",
      home: { x: -5, y: 0, z: -4.2 },
      yaw: Math.PI / 2,
      zone: { minX: -9, maxX: 9, minZ: -8.5, maxZ: 3.5 },
      patrol: [{ x: -5.5, y: 0, z: -4.2 }, { x: 5.5, y: 0, z: -4.2 }],
    },
    { id: "guard-1", kind: "guard", home: { x: -2.4, y: 0, z: 2.4 }, yaw: 0 },
    { id: "guard-2", kind: "guard", home: { x: -1.3, y: 0, z: 2.6 }, yaw: 0 },
    { id: "guard-3", kind: "guard", home: { x: 1.3, y: 0, z: 2.6 }, yaw: 0 },
    { id: "guard-4", kind: "guard", home: { x: 2.4, y: 0, z: 2.4 }, yaw: 0 },
  ];
  return {
    id: "all-the-kings-men",
    title: "All the King's Men",
    verse: ["Then along came the King's men, two to a litter,", "and whenever he fell, they caught him. How bitter."],
    hint: "The stretcher crew will run to catch him. Time your shot while they're far away, or bowl them over first.",
    ammo: { shot: 3, grape: 1 },
    greatFall: 4,
    humpty: perchAt(0, top, -1.5),
    pieces: m.pieces,
    crews,
    view: view(),
  };
}

function overTheWall(): LevelDef {
  const m = new Mason();
  m.wall("stone", 0, 1.2, 9, 8, { brick: { x: 1.2, y: 0.5, z: 0.6 } });
  const top = m.pillar("brick", 0, -2.6, 6, { size: 0.9, height: 0.75 });
  for (const x of [-3.8, 3.8]) m.pillar("brick", x, -2.6, 4, { size: 0.9, height: 0.75 });
  m.hay(-2.1, -4.4);
  m.hay(2.1, -4.4);
  return {
    id: "over-the-wall",
    title: "Over the Wall",
    verse: ["Humpty Dumpty hid behind a wall,", "so the Queen sent for something that doesn't aim at all."],
    hint: "Mortar shells go up and over, then burst. Press 2 or pick the shell from the tray.",
    ammo: { shell: 2, shot: 2 },
    greatFall: 4,
    humpty: perchAt(0, top, -2.6),
    pieces: m.pieces,
    crews: [
      {
        id: "litter-b",
        kind: "litter",
        home: { x: 4.5, y: 0, z: -5.5 },
        yaw: Math.PI / 2,
        zone: { minX: -8, maxX: 8, minZ: -8.5, maxZ: 0.2 },
      },
    ],
    view: view({ pitch: -26, distance: 21 }),
  };
}

function thePowderRoom(): LevelDef {
  const m = new Mason();
  let y = 0;
  m.keg(-0.55, -1.6);
  m.keg(0.55, -1.6);
  m.keg(0, -0.95);
  y = m.slab("plank", 0, 0.8, -1.4, 2.4, 1.8, 0.16);
  y = m.wall("stone", 0, -1.4, 2.2, 3, { y, brick: { x: 1.1, y: 0.5, z: 1.1 } });
  const top = m.tower("oak", 0, -1.4, 4, { y });
  for (const x of [-4.2, -2.8, 2.8, 4.2]) m.hay(x, -1.4);
  for (const x of [-2.1, -0.7, 0.7, 2.1]) m.hay(x, -3.4);
  m.keg(-6.5, 0.6);
  m.keg(6.5, 0.6);
  return {
    id: "the-powder-room",
    title: "The Powder Room",
    verse: ["Humpty Dumpty built on a keg.", "Say what you like — he's a very brave egg."],
    hint: "Powder kegs go off when they're struck hard. One good blast can take the whole tower.",
    ammo: { shot: 2 },
    greatFall: 3.8,
    humpty: perchAt(0, top, -1.4),
    pieces: m.pieces,
    crews: [
      {
        id: "litter-c",
        kind: "litter",
        home: { x: -6, y: 0, z: -5.5 },
        yaw: Math.PI / 2,
        zone: { minX: -9, maxX: 9, minZ: -8.5, maxZ: 3 },
        patrol: [{ x: -6, y: 0, z: -5.5 }, { x: 6, y: 0, z: -5.5 }],
      },
    ],
    view: view(),
  };
}

function allTheKingsHorses(): LevelDef {
  const m = new Mason();
  const top = m.pillar("stone", 0, -1.6, 6, { size: 0.9, height: 0.8 });
  for (const x of [-2.3, 2.3]) {
    m.hay(x, -1.6, 0, Math.PI / 2);
    m.hay(x, -1.6, 0.7, Math.PI / 2);
  }
  return {
    id: "all-the-kings-horses",
    title: "All the King's Horses",
    verse: ["All the King's horses came thundering near,", "with a cart full of straw and a very large ear."],
    hint: "The horse cart catches everything. Scatter it with grapeshot, then knock Humpty off before it recovers.",
    ammo: { grape: 2, shot: 2 },
    greatFall: 4.5,
    humpty: perchAt(0, top, -1.6),
    pieces: m.pieces,
    crews: [
      {
        id: "cart",
        kind: "cart",
        home: { x: -6, y: 0, z: -5 },
        yaw: Math.PI / 2,
        zone: { minX: -11, maxX: 11, minZ: -8.3, maxZ: -3.2 },
        patrol: [{ x: -6.5, y: 0, z: -5 }, { x: 6.5, y: 0, z: -5 }],
      },
      { id: "guard-a", kind: "guard", home: { x: -3.6, y: 0, z: 1.6 }, yaw: 0 },
      { id: "guard-b", kind: "guard", home: { x: 3.6, y: 0, z: 1.6 }, yaw: 0 },
    ],
    view: view({ target: { x: 0, y: 2.2, z: -2 }, distance: 21, pitch: -24 }),
  };
}

function chainOfCommand(): LevelDef {
  const m = new Mason();
  const top = m.pillar("oak", 0, -1.8, 9, { size: 0.55, height: 0.62 });
  for (const [x, z, n] of [[-3, -1.2, 6], [3, -1.2, 6], [-1.6, -3.6, 7], [1.6, -3.6, 7]] as const) {
    m.pillar("oak", x, z, n, { size: 0.55, height: 0.62 });
  }
  for (const x of [-2.1, -0.7, 0.7, 2.1]) m.hay(x, 0.6);
  return {
    id: "chain-of-command",
    title: "Chain of Command",
    verse: ["Humpty Dumpty sat on a stick.", "The Queen brought a chain. It was ever so quick."],
    hint: "Chain shot spins as it flies and scythes through thin columns. Hay in front — make him fall backwards.",
    ammo: { chain: 2, shot: 1 },
    greatFall: 5,
    humpty: perchAt(0, top, -1.8),
    pieces: m.pieces,
    crews: [
      {
        id: "litter-d",
        kind: "litter",
        home: { x: 5.5, y: 0, z: -5.6 },
        yaw: Math.PI / 2,
        zone: { minX: -9, maxX: 9, minZ: -8.5, maxZ: -0.4 },
        patrol: [{ x: 5.5, y: 0, z: -5.6 }, { x: -5.5, y: 0, z: -5.6 }],
      },
    ],
    view: view({ target: { x: 0, y: 2.5, z: -1.8 } }),
  };
}

function theKeep(): LevelDef {
  const m = new Mason();
  m.wall("stone", 0, 1.4, 12, 4, { brick: { x: 1.2, y: 0.5, z: 0.6 } });
  for (const x of [-4.5, 4.5]) m.tower("oak", x, -1.6, 9);
  m.keg(-2.2, -1.2);
  m.keg(2.2, -1.2);
  let y = m.wall("stone", 0, -2.2, 3.3, 4, { brick: { x: 1.1, y: 0.55, z: 1.1 } });
  y = m.slab("plank", 0, y, -2.2, 3.4, 1.4, 0.16);
  const top = m.tower("oak", 0, -2.2, 5, { y });
  for (const x of [-3, -1.6, 1.6, 3]) m.hay(x, -5.2);
  return {
    id: "the-keep",
    title: "The Keep",
    verse: ["All the King's horses and all the King's men", "built him a castle. Let's knock it down again."],
    hint: "Everything you've learned, all at once. There's more than one way in.",
    ammo: { shot: 2, shell: 2, grape: 1, chain: 1 },
    greatFall: 5,
    humpty: perchAt(0, top, -2.2),
    pieces: m.pieces,
    crews: [
      {
        id: "litter-e",
        kind: "litter",
        home: { x: -6, y: 0, z: -6.5 },
        yaw: Math.PI / 2,
        zone: { minX: -10, maxX: 10, minZ: -8.5, maxZ: -3.2 },
        patrol: [{ x: -6, y: 0, z: -6.5 }, { x: 6, y: 0, z: -6.5 }],
      },
      {
        id: "cart-e",
        kind: "cart",
        home: { x: 8, y: 0, z: -4.2 },
        yaw: -Math.PI / 2,
        zone: { minX: -12, maxX: 12, minZ: -8.5, maxZ: -3 },
      },
      { id: "guard-e1", kind: "guard", home: { x: -6.8, y: 0, z: 2.8 }, yaw: 0 },
      { id: "guard-e2", kind: "guard", home: { x: 6.8, y: 0, z: 2.8 }, yaw: 0 },
      { id: "guard-e3", kind: "guard", home: { x: 0, y: 0, z: 3.2 }, yaw: 0 },
    ],
    view: view({ pitch: -24, distance: 22.5, target: { x: 0, y: 2.2, z: -2 } }),
  };
}

function theEncore(): LevelDef {
  const m = new Mason();
  m.wall("stone", -4.2, 1.6, 5, 3, { brick: { x: 1.2, y: 0.5, z: 0.6 } });
  m.wall("stone", 4.2, 1.6, 5, 3, { brick: { x: 1.2, y: 0.5, z: 0.6 } });
  for (const x of [-5.4, 5.4]) {
    const base = m.pillar("brick", x, -2, 3, { size: 1.1, height: 0.8 });
    m.tower("oak", x, -2, 6, { y: base });
  }
  m.keg(-2.6, -0.6);
  m.keg(2.6, -0.6);
  m.keg(0, 0.2);
  let y = m.wall("stone", 0, -2.4, 3.3, 5, { brick: { x: 1.1, y: 0.55, z: 1.1 } });
  y = m.slab("plank", 0, y, -2.4, 3.6, 1.6, 0.16);
  y = m.tower("oak", 0, -2.4, 4, { y });
  for (const x of [-2.2, -0.8, 0.8, 2.2]) m.hay(x, -5.6);
  for (const x of [-7.2, 7.2]) m.hay(x, -0.2);
  return {
    id: "the-encore",
    title: "The Encore",
    verse: ["The audience stamped and demanded one more,", "so the Queen brought the whole of the royal armoury."],
    hint: "A curtain call with everything in the armoury. Make it the greatest fall of all.",
    ammo: { shot: 5, shell: 3, grape: 3, chain: 2 },
    greatFall: 5.2,
    humpty: perchAt(0, y, -2.4),
    pieces: m.pieces,
    crews: [
      {
        id: "litter-f",
        kind: "litter",
        home: { x: -5, y: 0, z: -6.8 },
        yaw: Math.PI / 2,
        zone: { minX: -10, maxX: 10, minZ: -8.5, maxZ: -3.6 },
        patrol: [{ x: -6, y: 0, z: -6.8 }, { x: 6, y: 0, z: -6.8 }],
      },
      {
        id: "litter-g",
        kind: "litter",
        home: { x: 5, y: 0, z: -4.4 },
        yaw: -Math.PI / 2,
        zone: { minX: -10, maxX: 10, minZ: -8.5, maxZ: -3.6 },
        patrol: [{ x: 4, y: 0, z: -4.4 }, { x: -4, y: 0, z: -4.4 }],
      },
      {
        id: "cart-f",
        kind: "cart",
        home: { x: -9, y: 0, z: -3.8 },
        yaw: Math.PI / 2,
        zone: { minX: -12, maxX: 12, minZ: -8.5, maxZ: -3.2 },
      },
      { id: "guard-f1", kind: "guard", home: { x: -1.4, y: 0, z: 3.4 }, yaw: 0 },
      { id: "guard-f2", kind: "guard", home: { x: 1.4, y: 0, z: 3.4 }, yaw: 0 },
      { id: "guard-f3", kind: "guard", home: { x: -8.4, y: 0, z: 2.2 }, yaw: 0.3 },
      { id: "guard-f4", kind: "guard", home: { x: 8.4, y: 0, z: 2.2 }, yaw: -0.3 },
    ],
    view: view({ pitch: -25, distance: 24, target: { x: 0, y: 2.4, z: -2.2 } }),
  };
}

export const LEVELS: readonly LevelDef[] = [
  satOnAWall(),
  hadAGreatFall(),
  allTheKingsMen(),
  overTheWall(),
  thePowderRoom(),
  allTheKingsHorses(),
  chainOfCommand(),
  theKeep(),
  theEncore(),
];

export function levelById(id: string): LevelDef | undefined {
  return LEVELS.find((level) => level.id === id);
}
