import type { CurioId, Vec3 } from "./types.js";

/**
 * Nursery-rhyme curios painted into the theatre. They are sensors: shots pass through,
 * nothing in the verse changes, and the scenery does something silly.
 */
export const CURIOS: ReadonlyArray<{ id: CurioId; at: Vec3; size: Vec3 }> = [
  { id: "cow", at: { x: -11, y: 4.7, z: -9.6 }, size: { x: 1.8, y: 1.3, z: 0.7 } },
  { id: "moon", at: { x: -9, y: 11.5, z: -9.7 }, size: { x: 4.2, y: 4.2, z: 0.5 } },
  { id: "jack-and-jill", at: { x: 4.2, y: 5.3, z: -9.6 }, size: { x: 1.8, y: 1.4, z: 0.7 } },
  { id: "cuckoo", at: { x: -15.65, y: 4.6, z: -2.5 }, size: { x: 0.6, y: 1.4, z: 1 } },
  { id: "well", at: { x: 13, y: 0.8, z: 5.3 }, size: { x: 1.5, y: 1.6, z: 1.5 } },
  { id: "spider", at: { x: 6.5, y: 7.6, z: -3 }, size: { x: 0.8, y: 0.8, z: 0.8 } },
  // Old King Cole watches from a royal box high on the stage-right wing, upstage.
  { id: "king", at: { x: 10.2, y: 5.3, z: -7.3 }, size: { x: 2.4, y: 2.6, z: 2.2 } },
  // The Grand Old Duke of York's men, marching up the painted hill and down again.
  { id: "duke", at: { x: -5.6, y: 3.3, z: -9.75 }, size: { x: 7, y: 2.2, z: 0.8 } },
];

/** The painted hill the Duke's men march over: centre and radius on the backdrop. */
export const DUKE_HILL = { x: -5.6, y: -1.6, radius: 5.2, z: -9.9 };
