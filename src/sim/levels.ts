import { Mason, perchAt, type CrewDef, type LevelDef, type ViewDef } from "./level.js";
import { CREW_SPECS } from "./crew.js";

const VIEW: ViewDef = { yaw: 0, pitch: -22, distance: 20, target: { x: 0, y: 1.8, z: -1.8 } };

function view(overrides: Partial<ViewDef> = {}): ViewDef {
  return { ...VIEW, ...overrides, target: { ...VIEW.target, ...overrides.target } };
}

function satOnAWall(): LevelDef {
  const m = new Mason();
  const top = m.wall("oak", 0, -1, 6, 6);
  m.chest(-5, -3.2, { yaw: 0.3 });
  return {
    id: "sat-on-a-wall",
    title: "Sat on a Wall",
    verse: ["Humpty Dumpty sat on a wall,", "and the Queen wheeled her cannon into the hall."],
    hint: "Aim at anything and fire. A cannonball won’t break him — only a fall will.",
    ammo: { shot: 4 },
    greatFall: 3,
    mayhem: 700,
    star: { curio: "cow" },
    humpty: perchAt(0, top, -1),
    pieces: m.pieces,
    crews: [],
    view: view(),
  };
}

function hadAGreatFall(): LevelDef {
  const m = new Mason();
  // The Queen's music box: an arm turns slowly round an iron column with Humpty on its seat.
  const { seat } = m.turntable(0, 4, -0.6, { arm: 1.6, speed: 0.42, angle: Math.PI * 0.35 });
  // Hay covers only the right-hand side, where a knocked egg lands.
  for (const x of [0.75, 2.05, 3.35]) {
    for (const z of [-3.4, -4.25, -5.1, -5.95, -6.8, -7.65]) m.hay(x, z);
  }
  m.chest(-4.6, -2.4, { yaw: -0.2 });
  return {
    id: "had-a-great-fall",
    title: "Had a Great Fall",
    verse: ["Humpty Dumpty went round and round", "on a music box, high off the ground."],
    hint: "Hay covers only one side. Wait for him to swing round to the bare side, or shoot the arm to spin it.",
    ammo: { shot: 4 },
    greatFall: 4,
    mayhem: 775,
    star: { curio: "cuckoo" },
    humpty: perchAt(seat.x, seat.y, seat.z),
    pieces: m.pieces,
    crews: [],
    view: view({ yaw: 12, pitch: -24 }),
    perch: "turntable",
  };
}

function allTheKingsMen(): LevelDef {
  const m = new Mason();
  const base = m.pillar("stone", 0, -1.5, 3, { size: 1.1, height: 0.7 });
  const top = m.tower("oak", 0, -1.5, 6, { y: base });
  // A painter left his pot on a stepladder right in front of a guard.
  m.paintPot(2.1, 2.95);
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
  m.chest(-6.4, -6.6, { yaw: 0.4 });
  return {
    id: "all-the-kings-men",
    title: "All the King's Men",
    verse: ["Then along came the King's men, two to a litter,", "and whenever he fell, they caught him. How bitter."],
    hint: "The stretcher crew will run to catch him. Time your shot while they're far away, or bowl them over first.",
    ammo: { shot: 4, grape: 1 },
    greatFall: 4,
    mayhem: 775,
    star: { crew: "guard-2" },
    humpty: perchAt(0, top, -1.5),
    pieces: m.pieces,
    crews,
    view: view(),
  };
}

function overTheWall(): LevelDef {
  const m = new Mason();
  // Taller than Humpty as the gun sees him: any round shot that clears it sails overhead.
  m.wall("stone", 0, 1.2, 9, 10, { brick: { x: 1.5, y: 0.55, z: 0.8 } });
  const top = m.pillar("brick", 0, -2.6, 6, { size: 0.9, height: 0.75 });
  for (const x of [-3.8, 3.8]) m.pillar("brick", x, -2.6, 4, { size: 0.9, height: 0.75 });
  m.hay(-2.1, -4.4);
  m.hay(2.1, -4.4);
  // Behind the wall: a shell or nothing.
  m.chest(-3.8, -4.6);
  return {
    id: "over-the-wall",
    title: "Over the Wall",
    verse: ["Humpty Dumpty hid behind a wall,", "so the Queen sent for something that doesn't aim at all."],
    hint: "Round shot can't clear this wall. Mortar shells go up and over, then burst: press 2.",
    ammo: { shell: 2, shot: 3 },
    greatFall: 4,
    mayhem: 925,
    star: { crew: "litter-b" },
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
    view: view({ pitch: -30, distance: 20, target: { x: 0, y: 2.6, z: -1.6 } }),
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
  m.chest(6.8, -3.2, { yaw: -0.3 });
  return {
    id: "the-powder-room",
    title: "The Powder Room",
    verse: ["Humpty Dumpty built on a keg.", "Say what you like — he's a very brave egg."],
    hint: "Powder kegs go off when they're struck hard. One good blast can take the whole tower.",
    ammo: { shot: 3 },
    greatFall: 3.8,
    mayhem: 750,
    star: { curio: "stagehands" },
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
  for (const x of [-1.9, 1.9]) {
    m.hay(x, -1.6, 0, Math.PI / 2);
    m.hay(x, -1.6, 0.7, Math.PI / 2);
  }
  // Powder beside the cart road, clear of where the horses turn: time a shot as they pass.
  m.keg(-5, -7.6);
  m.keg(5, -7.6);
  m.keg(0.95, -2.55);
  // A stage weight hangs over the cart road: push it and it swings like a wrecking ball.
  m.sandbag(3.3, 1.2, -2.8);
  m.chest(-8.4, -0.7, { yaw: 0.3 });
  // Up the stage-left corner, a barrel waits at the head of a ramp down onto the cart road. Its
  // chock is hidden from the guns behind a hedge; a run of dominoes leads round to it.
  m.barrelRamp({ x: -10, y: 1.5, z: -4.3 }, { x: -7.2, y: 0.06, z: -4.3 }, { chock: 0.85 });
  m.hedge(-8.55, -1.6, 2.7, 2.6);
  // Every domino falls clear of the barrel's road; the last one lands on the end of the chock.
  m.dominoes([{ x: -6.2, z: 1.2 }, { x: -6.2, z: -0.6 }, { x: -6.35, z: -1.3 }, { x: -6.75, z: -1.95 }, { x: -7.35, z: -2.45 }, { x: -8.75, z: -2.6 }], [0.9, 1.1, 1.3, 1.5, 1.7, 1.8, 1.9, 2]);
  return {
    id: "all-the-kings-horses",
    title: "All the King's Horses",
    verse: ["All the King's horses came thundering near,", "with a cart full of straw and a very large ear."],
    hint: "The horse cart catches everything. Scatter it (grapeshot, a keg as it passes, or topple the dominoes and let loose the barrel) then knock Humpty off.",
    ammo: { grape: 2, shot: 3 },
    greatFall: 4.5,
    mayhem: 850,
    star: { crew: "guard-a" },
    humpty: perchAt(0, top, -1.6),
    pieces: m.pieces,
    crews: [
      {
        id: "cart",
        kind: "cart",
        home: { x: -3.4, y: 0, z: -5 },
        yaw: Math.PI / 2,
        zone: { minX: -11, maxX: 11, minZ: -8.3, maxZ: -3.2 },
        // It turns round well clear of the dominoes up the stage-left corner.
        patrol: [{ x: -3.4, y: 0, z: -5 }, { x: 6.5, y: 0, z: -5 }],
      },
      { id: "guard-a", kind: "guard", home: { x: -3.6, y: 0, z: 1.6 }, yaw: 0 },
      { id: "guard-b", kind: "guard", home: { x: 3.6, y: 0, z: 1.6 }, yaw: 0 },
    ],
    view: view({ target: { x: 0, y: 2.2, z: -2 }, distance: 21, pitch: -24 }),
  };
}

function chainOfCommand(): LevelDef {
  const m = new Mason();
  // He sits on a maypole planted in the stage. Nothing moves it but chain shot, which cuts it.
  const top = m.maypole(0, -1.8, 5.2);
  // Spare perches for the stagehands, well clear of the road to lunch.
  for (const x of [-3.6, 3.6]) m.pillar("oak", x, -4, 7, { size: 0.55, height: 0.62 });
  for (const x of [-2.1, -0.7, 0.7, 2.1]) m.hay(x, 0.6);
  m.keg(-4.5, -4);
  // Four stretcher crews stand guard round the maypole. Only lunch will move them.
  m.gong(6.2, -1.4, -0.6);
  const guard = (id: string, x: number, z: number, yaw: number): CrewDef => ({
    id,
    kind: "litter",
    home: { x, y: 0, z },
    yaw,
    zone: { minX: -9, maxX: 9, minZ: -8.5, maxZ: -0.4 },
  });
  m.chest(-6.2, -1.4, { yaw: 0.2 });
  return {
    id: "chain-of-command",
    title: "Chain of Command",
    verse: ["Humpty Dumpty sat on a stick.", "The Queen brought a chain. It was ever so quick."],
    hint: "Only chain shot can cut down his maypole. But four stretcher crews stand guard: ring the dinner gong first, and they'll all go to lunch.",
    ammo: { chain: 2, shot: 2 },
    greatFall: 5,
    mayhem: 875,
    star: { crew: "litter-d3" },
    humpty: perchAt(0, top, -1.8),
    pieces: m.pieces,
    crews: [guard("litter-d1", -1.6, -1.9, 0), guard("litter-d2", 1.6, -1.9, 0), guard("litter-d3", -2.3, -6.9, Math.PI / 2), guard("litter-d4", 2.3, -6.9, Math.PI / 2)],
    view: view({ target: { x: 0.8, y: 2.6, z: -1.6 } }),
  };
}

function theKeep(): LevelDef {
  const m = new Mason();
  const rampart = m.wall("stone", 0, 1.4, 12, 4, { brick: { x: 1.2, y: 0.5, z: 0.6 } });
  m.keg(3, 1.4, rampart);
  for (const x of [-4.5, 4.5]) m.tower("oak", x, -1.6, 9);
  m.keg(6.6, -2.6);
  m.keg(6.6, -1.9);
  m.keg(-2.2, -1.2);
  m.keg(2.2, -1.2);
  let y = m.wall("stone", 0, -2.2, 3.3, 4, { brick: { x: 1.1, y: 0.55, z: 1.1 } });
  y = m.slab("plank", 0, y, -2.2, 3.4, 1.4, 0.16);
  const top = m.tower("oak", 0, -2.2, 5, { y });
  for (const x of [-3, -1.6, 1.6, 3]) m.hay(x, -5.2);
  // Tucked in the corner, stage left, behind the rampart.
  m.chest(-8.6, -2.2, { yaw: 0.4 });
  return {
    id: "the-keep",
    title: "The Keep",
    verse: ["All the King's horses and all the King's men", "built him a castle. Let's knock it down again."],
    hint: "Everything you've learned, all at once. There's more than one way in.",
    ammo: { shot: 3, shell: 2, grape: 1, chain: 1, bomb: 1 },
    greatFall: 5,
    mayhem: 850,
    star: { crew: "guard-e3" },
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
    rat: { first: 8, every: 12, visits: 3 },
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
  for (const x of [-6.6, 6.6]) {
    m.keg(x, -3.2);
    m.keg(x, -2.5);
    m.keg(x, -2.85, 0.8);
  }
  let y = m.wall("stone", 0, -2.4, 3.3, 5, { brick: { x: 1.1, y: 0.55, z: 1.1 } });
  y = m.slab("plank", 0, y, -2.4, 3.6, 1.6, 0.16);
  y = m.tower("oak", 0, -2.4, 4, { y });
  // He takes his curtain call under a royal canopy: mortar shells burst on the roof, not on him.
  m.canopy(0, y, -2.4);
  for (const x of [-2.2, -0.8, 0.8, 2.2]) m.hay(x, -5.6);
  for (const x of [-7.2, 7.2]) m.hay(x, -0.2);
  m.sandbag(-3.4, 1.2, -3.3);
  m.chest(8.6, -4.8, { yaw: -0.4 });
  return {
    id: "the-encore",
    title: "The Encore",
    verse: ["The audience stamped and demanded one more,", "so the Queen brought the whole of the royal armoury."],
    hint: "He's under a royal canopy, so shells burst on the roof. Strip it away first, then make it the greatest fall of all.",
    ammo: { shot: 5, shell: 2, grape: 3, chain: 2, bomb: 2 },
    greatFall: 4.6,
    mayhem: 1175,
    star: { rat: true },
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
    rat: { first: 5, every: 9, visits: 4 },
  };
}

function hangingByAThread(): LevelDef {
  const m = new Mason();
  // A royal swing on four ropes. Round shot only rocks it; chain shot cuts rope.
  const { seat } = m.swing(0, 4.4, -2.2, { width: 1.3, beam: 8 });
  for (const x of [-4.6, 4.6]) m.hay(x, -2.2);
  m.chest(5.6, -5, { yaw: -0.3 });
  return {
    id: "hanging-by-a-thread",
    title: "Hanging by a Thread",
    verse: ["Humpty Dumpty sat on a swing,", "held up by nothing but four bits of string."],
    hint: "Chain shot cuts rope. Cut the ropes on one side to tip him out, or all four to drop him.",
    ammo: { chain: 2, shot: 3 },
    greatFall: 4,
    mayhem: 850,
    star: { crew: "guard-h1" },
    humpty: perchAt(seat.x, seat.y, seat.z),
    pieces: m.pieces,
    crews: [
      {
        id: "litter-h",
        kind: "litter",
        home: { x: -5, y: 0, z: -4.4 },
        yaw: Math.PI / 2,
        zone: { minX: -9, maxX: 9, minZ: -8.5, maxZ: 1.5 },
        patrol: [{ x: -5, y: 0, z: -4.4 }, { x: 5, y: 0, z: -4.4 }],
      },
      { id: "guard-h1", kind: "guard", home: { x: -2.6, y: 0, z: 1.8 }, yaw: 0 },
      { id: "guard-h2", kind: "guard", home: { x: 2.6, y: 0, z: 1.8 }, yaw: 0 },
    ],
    view: view({ pitch: -18, distance: 22, target: { x: 0, y: 3.4, z: -2 } }),
    perch: "swing",
  };
}

function seeSawMargeryDaw(): LevelDef {
  const m = new Mason();
  // A trebuchet-style see-saw: Humpty waits in the bucket on the long, low arm.
  const { bucket, tray } = m.seesaw(-0.4, 1.6, -1.8, { length: 6.4, tilt: 0.2, offset: 0.8 });
  // The anvil overhangs the back of its plinth, right above the tray: a nudge drops it.
  const plinth = m.pillar("stone", tray.x + 0.3, -0.3, 6, { size: 0.8, height: 0.8 });
  m.block("anvil", tray.x + 0.3, plinth, -0.58, 0.62, 0.42, 0.52);
  for (const x of [-6.2, -7.5]) m.hay(x, -1.8, 0, Math.PI / 2);
  m.chest(4.6, -4.4, { yaw: -0.2 });
  return {
    id: "see-saw-margery-daw",
    title: "See-Saw Margery Daw",
    verse: ["See-saw, Margery Daw,", "drop the anvil and watch the egg soar."],
    hint: "Knock the anvil onto the high end of the see-saw. And mind the rat: grab the blunderbuss (6) when it creeps in.",
    ammo: { shot: 4, grape: 1 },
    greatFall: 3.2,
    mayhem: 750,
    star: { rat: true },
    humpty: perchAt(bucket.x, bucket.y, bucket.z),
    pieces: m.pieces,
    crews: [
      {
        id: "litter-s",
        kind: "litter",
        home: { x: 7, y: 0, z: -3.2 },
        yaw: Math.PI / 2,
        zone: { minX: 2.5, maxX: 12, minZ: -8.5, maxZ: 1.5 },
        patrol: [{ x: 4, y: 0, z: -3.2 }, { x: 9.5, y: 0, z: -3.2 }],
      },
    ],
    view: view({ pitch: -22, distance: 21, target: { x: 0.6, y: 2, z: -1.6 } }),
    rat: { first: 6, every: 11, visits: 3 },
    perch: "seesaw",
  };
}

function theQueensBilliards(): LevelDef {
  const m = new Mason();
  // A painted screen hides him from the gun; bronze bumpers on plinths bank shots round it.
  m.fixture("screen", 0, 0, 0.4, 5.4, 6, 0.4);
  const top = m.pillar("stone", 0, -3, 5, { size: 1, height: 0.9 });
  for (const [x, z, yaw] of [[-6.5, -1, 1.2], [6.5, -1, -1.27]] as const) {
    m.fixture("column", x, 0, z, 0.9, 3.2, 0.9);
    m.bumper(x, z, yaw, { y: 3.2, height: 2.6, width: 1.9 });
  }
  // Out of sight behind the screen: a soft landing on the right-hand side.
  for (const x of [1.6, 2.9, 4.2]) {
    for (const z of [-3.9, -4.75, -5.6]) m.hay(x, z);
  }
  m.hedge(-5, -5.6, 3.2, 1.6);
  // Hidden behind the screen: bank a shot to reach it.
  m.chest(-1.6, -5.2);
  return {
    id: "the-queens-billiards",
    title: "The Queen's Billiards",
    verse: ["Humpty Dumpty hid out of sight,", "so the Queen played billiards by candlelight."],
    hint: "The screen stops round shot, but the bronze bumpers bounce it. Bank your shot — and drag to look behind the screen first.",
    ammo: { shot: 4 },
    greatFall: 4.5,
    mayhem: 800,
    star: { curio: "duke" },
    humpty: perchAt(0, top, -3),
    pieces: m.pieces,
    crews: [],
    view: view({ pitch: -20, distance: 22, target: { x: 0, y: 2.8, z: -1.6 } }),
    rat: { first: 9, every: 14, visits: 2 },
  };
}

function rememberRemember(): LevelDef {
  const m = new Mason();
  // Parliament: a stone house with powder in the cellar and Humpty in the roof garden.
  const z = -2.6;
  const roof = m.house(0, z, { rows: 3 });
  for (const x of [-0.7, 0, 0.7]) m.keg(x, z - 0.2);
  m.parapet(0, roof, z, 3.7, 2.9);
  m.canopy(0, roof, z, { span: 1.3, height: 2, roof: 2.4 });
  // Area railings in front of the cellar door: flat shot can't get through them.
  m.railing(0, z + 2.4, 3.4);
  m.paintPot(2.75, 0.15);
  m.chest(0, -6.2);
  return {
    id: "remember-remember",
    title: "Remember, Remember",
    verse: ["Remember, remember the fifth of November,", "gunpowder, treason, and one flying egg."],
    hint: "The parapet stops round shot and the canopy stops shells. But there's powder in the cellar: lob a fizzing bomb (5) over the railings to the cellar door.",
    ammo: { bomb: 2, shot: 3 },
    greatFall: 7,
    mayhem: 1500,
    star: { curio: "king" },
    humpty: perchAt(0, roof, z),
    pieces: m.pieces,
    crews: [
      {
        id: "litter-r",
        kind: "litter",
        home: { x: -5, y: 0, z: -7 },
        yaw: Math.PI / 2,
        zone: { minX: -11, maxX: 11, minZ: -8.5, maxZ: 3 },
        patrol: [{ x: -6, y: 0, z: -7 }, { x: 6, y: 0, z: -7 }],
      },
      { id: "guard-r1", kind: "guard", home: { x: -3, y: 0, z: -0.4 }, yaw: 0 },
      { id: "guard-r2", kind: "guard", home: { x: 3, y: 0, z: -0.4 }, yaw: 0 },
    ],
    view: view({ pitch: -22, distance: 20, target: { x: 0, y: 2, z: -1.6 } }),
  };
}

function heyDiddleDiddle(): LevelDef {
  const m = new Mason();
  // A low garden wall: a tumble off it is nothing. Behind it, the Queen's bouncy four-poster.
  const top = m.wall("brick", 0, -1.4, 3, 3, { brick: { x: 1, y: 0.5, z: 0.6 } });
  m.bouncyBed(0, -3.7);
  for (const x of [-3.3, 3.3]) m.hay(x, -3.7, 0, Math.PI / 2);
  m.chest(6.4, -1.6, { yaw: -0.3 });
  // The King's china dresser, stage right: and the dish ran away with the spoon.
  m.dresser(6.9, -3.6, -0.5);
  return {
    id: "hey-diddle-diddle",
    title: "Hey Diddle Diddle",
    verse: ["Hey diddle diddle, a bed with a spring in the middle;", "the egg jumped over the moon."],
    hint: "A tumble off this little wall won't hurt him. Knock him back onto the royal bed and it will throw him sky-high.",
    ammo: { shot: 4 },
    greatFall: 5,
    mayhem: 950,
    star: { curio: "moon" },
    humpty: perchAt(0, top, -1.4),
    pieces: m.pieces,
    crews: [
      {
        id: "litter-hd",
        kind: "litter",
        home: { x: -5, y: 0, z: -7.4 },
        yaw: Math.PI / 2,
        zone: { minX: -10, maxX: 10, minZ: -8.6, maxZ: -5.2 },
        patrol: [{ x: -5.5, y: 0, z: -7.4 }, { x: 5.5, y: 0, z: -7.4 }],
      },
    ],
    view: view({ pitch: -24, distance: 21, target: { x: 0, y: 2.4, z: -3 } }),
  };
}

function rockABye(): LevelDef {
  const m = new Mason();
  // Rock-a-bye baby, on the tree top: a cradle on two lines from a painted bough.
  const seat = m.cradle(0.6, 4.4, -2.4, { bough: 7.9, trunkX: -4.6 });
  // A haystack right under him: cut the lines on a still day and he lands soft.
  for (const x of [-0.05, 1.25]) {
    for (const z of [-1.95, -2.8]) m.hay(x, z, m.hay(x, z));
  }
  // The stagehands' wind machine: strike it and a gale rocks the cradle out over the boards.
  m.windMachine(-7.6, 0.4, Math.PI / 2);
  m.chest(6.6, -5.2, { yaw: -0.3 });
  return {
    id: "rock-a-bye-baby",
    title: "Rock-a-bye Baby",
    verse: ["Rock-a-bye baby, the wind's on its way;", "when the lines break, the egg falls today."],
    hint: "Cut the lines now and he drops in the hay. Strike the wind machine first: when the cradle swings out over the boards, cut it down.",
    ammo: { chain: 2, shot: 3 },
    greatFall: 4.5,
    mayhem: 825,
    star: { curio: "spider" },
    humpty: perchAt(seat.x, seat.y, seat.z),
    pieces: m.pieces,
    crews: [
      {
        id: "litter-rb",
        kind: "litter",
        home: { x: 5, y: 0, z: -6.4 },
        yaw: -Math.PI / 2,
        zone: { minX: -10, maxX: 10, minZ: -8.6, maxZ: 1 },
        patrol: [{ x: 5.5, y: 0, z: -6.4 }, { x: -5.5, y: 0, z: -6.4 }],
      },
    ],
    view: view({ pitch: -17, distance: 22, target: { x: 0, y: 3.6, z: -2 } }),
    perch: "swing",
  };
}

function ringOfRoses(): LevelDef {
  const m = new Mason();
  const base = m.pillar("stone", 0, -2.2, 3, { size: 1.1, height: 0.8 });
  const top = m.tower("oak", 0, -2.2, 4, { y: base });
  // The King's men dance in a ring round him, on a ring of stage trapdoors.
  m.trapRing(0, -2.2, 1.9, 4.6, { x: 6.6, z: 0.2, yaw: -0.5 });
  m.chest(-7.6, -5, { yaw: 0.3 });
  const radius = 3.2;
  const steps = 16;
  const ring = Array.from({ length: steps }, (_, index) => {
    const angle = (index / steps) * Math.PI * 2;
    return { x: Math.sin(angle) * radius, y: 0, z: -2.2 + Math.cos(angle) * radius };
  });
  const circle = (start: number) => [...ring.slice(start), ...ring.slice(0, start)];
  // Stretcher crews and guards take turns round the ring; the stretchers dash out to catch.
  const crews: CrewDef[] = Array.from({ length: 8 }, (_, index) => {
    const start = index * 2;
    const litter = index % 2 === 0;
    return {
      id: `rose-${index + 1}`,
      kind: litter ? "litter" : "guard",
      home: ring[start]!,
      yaw: Math.atan2(ring[(start + 1) % steps]!.x - ring[start]!.x, ring[(start + 1) % steps]!.z - ring[start]!.z),
      ...(litter ? { zone: { minX: -9, maxX: 9, minZ: -9, maxZ: 2.5 } } : {}),
      patrol: circle(start),
      // Everyone keeps the stretchers' pace, or they tread on the guards' heels.
      pace: CREW_SPECS.litter.walk,
    };
  });
  return {
    id: "ring-of-roses",
    title: "Ring-a-ring o' Roses",
    verse: ["Ring-a-ring o' roses, a pocket full of posies;", "a-tishoo! a-tishoo! We ALL fall down."],
    hint: "The King's men dance round him and catch anything that falls. Shoot the stage lever and the trapdoors drop them, then knock him off before they climb back up.",
    ammo: { shot: 4 },
    greatFall: 4,
    mayhem: 1125,
    star: { crew: "rose-4" },
    humpty: perchAt(0, top, -2.2),
    pieces: m.pieces,
    crews,
    view: view({ pitch: -24, distance: 21, target: { x: 0.5, y: 2.4, z: -2 } }),
  };
}

function rideACockHorse(): LevelDef {
  const m = new Mason();
  // A painted screen hides him from the gun. Off to the right stands the Queen's weathercock, a
  // bronze plate on a tall pole: every blow turns it an eighth of the way round.
  m.fixture("screen", -0.6, 0, -1.2, 5.2, 5.8, 0.4);
  const top = m.pillar("stone", -1, -4, 4, { size: 1, height: 0.9 });
  m.vane(5.4, -4.4, -1.8, { y: 3.2 });
  // A shove backwards only puts him in the hay; he must go over sideways.
  for (const x of [-2.2, -0.9, 0.4]) m.hay(x, -5.7);
  m.hedge(-6.2, -3.6, 2.6, 1.6);
  m.chest(-4.6, -1.8, { yaw: 0.3 });
  return {
    id: "ride-a-cock-horse",
    title: "Ride a Cock-Horse",
    verse: ["Ride a cock-horse to Banbury Cross,", "where the Queen's weathercock turns at each toss."],
    hint: "He's behind the screen. Every shot that strikes the weathercock turns it an eighth of a turn; turn it to face him, then bank a shot off it.",
    ammo: { shot: 4 },
    greatFall: 3.4,
    mayhem: 825,
    star: { curio: "well" },
    humpty: perchAt(-1, top, -4),
    pieces: m.pieces,
    crews: [],
    view: view({ pitch: -20, distance: 22, target: { x: 1.2, y: 2.8, z: -2 } }),
  };
}

function cameTumblingAfter(): LevelDef {
  const m = new Mason();
  // The powder shed: stone walls, a stone roof and three kegs inside. Its only way in is the
  // chute, which runs down from a hopper on the hill.
  const cx = 1.7;
  const cz = -4.3;
  m.wall("stone", cx, cz + 1.05, 3.1, 3);
  m.wall("stone", cx, cz - 1.05, 3.1, 3);
  for (let row = 0; row < 3; row += 1) {
    const y = row * 0.502;
    for (const z of [cz - 0.4, cz + 0.4]) m.block("stone", cx + 1.3, y, z, 0.5, 0.5, 0.8);
    // The left wall is two thin jambs: the chute runs in between them, under the roof.
    for (const z of [cz - 0.7, cz + 0.7]) m.block("stone", cx - 1.3, y, z, 0.5, 0.5, 0.2);
  }
  // He sits right on the shed's stone roof, which keeps a bomb's flash off the powder below.
  const y = m.slab("stone", cx, 1.506, cz, 3.2, 2.7, 0.22);
  // The powder is stacked at the front: when it goes, it throws him off the back.
  m.keg(cx + 0.1, cz + 0.55);
  m.keg(cx + 0.7, cz + 0.55);
  m.keg(cx + 0.7, cz - 0.1);
  // A broad royal canopy: bombs lobbed at him roll off it and go off outside the shed walls.
  const seat = cz - 0.5;
  m.canopy(cx, y, seat, { roof: 3.4 });
  m.chute([{ x: -3, y: 3.1, z: -3.4 }, { x: -1.1, y: 1.65, z: cz }, { x: 0.1, y: 0.6, z: cz }, { x: cx - 0.4, y: 0.3, z: cz }]);
  m.chest(5.6, -2.4, { yaw: -0.3 });
  return {
    id: "came-tumbling-after",
    title: "Came Tumbling After",
    verse: ["Up the hill the Queen's bomb went to fetch a pail of powder;", "down the chute it came tumbling, and the bang was rather louder."],
    hint: "Under the canopy he's safe from above, and the stone shed keeps its kegs dry. Drop a bomb in the hopper on the hill and let it roll down the chute into the shed.",
    ammo: { bomb: 3 },
    greatFall: 4,
    mayhem: 1400,
    star: { curio: "jack-and-jill" },
    humpty: perchAt(cx, y, seat),
    pieces: m.pieces,
    crews: [],
    view: view({ pitch: -22, distance: 22, target: { x: -0.6, y: 2.4, z: -2.4 } }),
  };
}

function roundTheMulberryBush(): LevelDef {
  const m = new Mason();
  // A screen hides him; beside it, the children go round and round the mulberry bush on a
  // carousel. A shot that glances off one of them goes wherever the carousel has turned it.
  m.fixture("screen", -0.8, 0, -1.3, 5.4, 6, 0.4);
  const top = m.pillar("stone", -1.2, -4.2, 4, { size: 1, height: 0.9 });
  m.carousel(4.8, -3, { y: 4, height: 1.6, outer: 1.9, speed: 0.8 });
  for (const x of [-2.4, -1.1, 0.2]) m.hay(x, -5.9);
  m.chest(-5, -2.2, { yaw: 0.3 });
  return {
    id: "round-the-mulberry-bush",
    title: "Round the Mulberry Bush",
    verse: ["Here we go round the mulberry bush, so early in the morning;", "the children bat the cannonballs about without a word of warning."],
    hint: "He's behind the screen, but the children on the carousel bat shots about. Watch the arc as they turn, and fire when it glances round to him.",
    ammo: { shot: 5 },
    greatFall: 3.4,
    mayhem: 750,
    star: { crew: "bush-guard" },
    humpty: perchAt(-1.2, top, -4.2),
    pieces: m.pieces,
    crews: [{ id: "bush-guard", kind: "guard", home: { x: 7.2, y: 0, z: -5.2 }, yaw: -0.4 }],
    view: view({ pitch: -20, distance: 22, target: { x: 1.4, y: 2.8, z: -2 } }),
  };
}

function londonBridge(): LevelDef {
  const m = new Mason();
  // A gatehouse, portcullis down. Behind it he sits on a little wooden bridge on two posts:
  // raise the gate with its counterweight and shoot a post out through the arch.
  m.gatehouse(0, -1.6, { width: 2.6, height: 2.8 });
  // Slender posts right under the ends of the deck: lose one and that end drops at once.
  for (const x of [-0.95, 0.95]) m.block("post", x, 0, -4.6, 0.24, 2.9, 0.24);
  const deck = m.slab("plank", 0, 2.902, -4.6, 2.5, 1.1, 0.16);
  for (const x of [-5.6, 5.6]) m.hedge(x, -3.4, 3.2, 3.2, Math.PI / 2);
  m.chest(-4.6, -5.4, { yaw: 0.3 });
  return {
    id: "london-bridge",
    title: "London Bridge",
    verse: ["London Bridge is falling down, falling down, falling down;", "raise the gate and knock it down, my fair lady."],
    hint: "The portcullis stops round shot. Strike the iron counterweight beside the gatehouse and it winds up for a while: then shoot a post out from under the bridge.",
    ammo: { shot: 4 },
    greatFall: 3,
    mayhem: 775,
    star: { curio: "tower" },
    humpty: perchAt(0, deck, -4.6),
    pieces: m.pieces,
    crews: [],
    view: view({ pitch: -18, distance: 21, target: { x: 0.4, y: 2.6, z: -2.2 } }),
  };
}

export const LEVELS: readonly LevelDef[] = [
  satOnAWall(),
  hadAGreatFall(),
  allTheKingsMen(),
  overTheWall(),
  thePowderRoom(),
  heyDiddleDiddle(),
  allTheKingsHorses(),
  chainOfCommand(),
  hangingByAThread(),
  rockABye(),
  seeSawMargeryDaw(),
  theQueensBilliards(),
  rememberRemember(),
  theKeep(),
  theEncore(),
  ringOfRoses(),
  rideACockHorse(),
  cameTumblingAfter(),
  roundTheMulberryBush(),
  londonBridge(),
];

export function levelById(id: string): LevelDef | undefined {
  return LEVELS.find((level) => level.id === id);
}
