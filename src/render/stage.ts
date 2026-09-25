import * as pc from "playcanvas";
import { STAGE } from "../sim/game.js";
import { hashUnit, palette, type Kit } from "./kit.js";

const V = (x = 0, y = 0, z = 0): pc.Vec3 => new pc.Vec3(x, y, z);

export interface StageSet {
  root: pc.Entity;
  footlights: pc.Entity[];
  clouds: pc.Entity[];
  moon: pc.Entity;
  pennants: pc.Entity[];
}

/**
 * A toy theatre: board stage, painted backdrop flats, wings, a velvet proscenium and footlights.
 * Everything here is scenery; the physical stage lives in the simulation.
 */
export function buildStage(kit: Kit, parent: pc.Entity): StageSet {
  const root = kit.group("theatre", parent);
  const width = STAGE.maxX - STAGE.minX;
  const depth = STAGE.maxZ - STAGE.minZ;
  const cz = (STAGE.maxZ + STAGE.minZ) / 2;

  // Stage boards.
  const floor = kit.material("floor", palette.floor, 0.14);
  const seam = kit.material("floor-seam", palette.floorEdge, 0.08);
  kit.primitive("boards", "box", root, V(0, -0.25, cz), { x: width + 0.6, y: 0.5, z: depth + 0.4 }, floor);
  for (let x = STAGE.minX + 1.02; x < STAGE.maxX; x += 1.02) {
    kit.primitive("seam", "box", root, V(x, 0.004, cz), { x: 0.02, y: 0.01, z: depth + 0.3 }, seam, pc.Vec3.ZERO, false);
  }
  // Painted felt lawn where the King keeps his walls.
  const felt = kit.material("felt", palette.felt, 0.04);
  const feltEdge = kit.material("felt-edge", palette.feltDark, 0.04);
  kit.primitive("lawn", "box", root, V(0, 0.012, -3.4), { x: 26, y: 0.02, z: 12.6 }, felt, pc.Vec3.ZERO, false);
  kit.primitive("lawn-edge", "box", root, V(0, 0.008, 2.95), { x: 26.3, y: 0.02, z: 0.3 }, feltEdge, pc.Vec3.ZERO, false);
  // Front apron with its lip.
  const apron = kit.material("apron", palette.floorEdge, 0.1);
  const gold = kit.material("gold", palette.gold, 0.72, 0.55);
  kit.primitive("apron", "box", root, V(0, 0.2, STAGE.maxZ + 0.2), { x: width + 1, y: 0.44, z: 0.4 }, apron);
  kit.primitive("apron-trim", "box", root, V(0, 0.36, STAGE.maxZ + 0.41), { x: width + 1, y: 0.05, z: 0.02 }, gold, pc.Vec3.ZERO, false);
  kit.primitive("stage-front", "box", root, V(0, -1.4, STAGE.maxZ + 0.35), { x: width + 1.4, y: 2.4, z: 0.3 }, kit.material("stage-front", new pc.Color(0.22, 0.035, 0.035), 0.2));

  // Backdrop: a painted dusk in stripes.
  const backZ = STAGE.minZ - 0.3;
  const skyStops: Array<[number, [number, number, number]]> = [
    [16.5, [0.05, 0.09, 0.13]],
    [11, [0.08, 0.14, 0.18]],
    [7, [0.2, 0.21, 0.21]],
    [3.5, [0.46, 0.31, 0.21]],
    [0.5, [0.62, 0.4, 0.24]],
  ];
  const bands = 16;
  for (let band = 0; band < bands; band += 1) {
    const top = 16.5 - (band * 16) / bands;
    const height = 16 / bands;
    const mid = top - height / 2;
    let upper = skyStops[0]!;
    let lower = skyStops[skyStops.length - 1]!;
    for (let index = 0; index < skyStops.length - 1; index += 1) {
      if (mid <= skyStops[index]![0] && mid >= skyStops[index + 1]![0]) {
        upper = skyStops[index]!;
        lower = skyStops[index + 1]!;
      }
    }
    const k = (upper[0] - mid) / Math.max(0.001, upper[0] - lower[0]);
    const color = new pc.Color(
      upper[1][0] + (lower[1][0] - upper[1][0]) * k,
      upper[1][1] + (lower[1][1] - upper[1][1]) * k,
      upper[1][2] + (lower[1][2] - upper[1][2]) * k,
    );
    kit.primitive("sky-band", "box", root, V(0, mid, backZ), { x: width + 8, y: height + 0.02, z: 0.1 }, kit.material(`sky-${band}`, color, 0.02), pc.Vec3.ZERO, false);
  }
  const moonMaterial = kit.material("moon", new pc.Color(0.95, 0.85, 0.55), 0.2, 0, { emissive: new pc.Color(0.55, 0.45, 0.22) });
  const moon = kit.primitive("moon", "cylinder", root, V(-9, 11.5, backZ + 0.12), { x: 2.1, y: 0.05, z: 2.1 }, moonMaterial, V(90, 0, 0), false);
  kit.primitive("moon-bite", "cylinder", root, V(-8.35, 11.8, backZ + 0.16), { x: 1.8, y: 0.05, z: 1.8 }, kit.material("moon-shadow", new pc.Color(0.075, 0.13, 0.17), 0.02), V(90, 0, 0), false);
  const star = kit.material("star", new pc.Color(1, 0.95, 0.75), 0.2, 0, { emissive: new pc.Color(0.8, 0.72, 0.45) });
  for (let index = 0; index < 26; index += 1) {
    const x = (hashUnit(`sx${index}`) - 0.5) * (width + 4);
    const y = 9.5 + hashUnit(`sy${index}`) * 7;
    const s = 0.06 + hashUnit(`ss${index}`) * 0.09;
    kit.primitive("star", "box", root, V(x, y, backZ + 0.1), { x: s, y: s, z: 0.02 }, star, V(0, 0, 45), false);
  }
  const clouds: pc.Entity[] = [];
  const cloudMaterial = kit.material("cloud", new pc.Color(0.5, 0.47, 0.44), 0.05);
  for (const [x, y, s] of [[6, 11.2, 1.3], [-2, 13.2, 1], [11, 8.8, 0.9], [-12, 8.4, 1.1]] as const) {
    const cloud = kit.group("cloud", root, V(x, y, backZ + 0.25));
    for (const [dx, dy, r] of [[-0.9, 0, 0.8], [0, 0.3, 1], [0.95, 0.05, 0.75], [0.3, -0.2, 0.7]] as const) {
      kit.primitive("puff", "cylinder", cloud, V(dx * s, dy * s, 0), { x: r * s * 1.6, y: 0.05, z: r * s }, cloudMaterial, V(90, 0, 0), false);
    }
    clouds.push(cloud);
  }
  // Layered hill flats with cut-out trees and a far-off castle.
  const hills: Array<[number, number, number, number, [number, number, number]]> = [
    [-10, -8, 12, 0.35, [0.09, 0.16, 0.13]],
    [7, -9, 14, 0.25, [0.1, 0.17, 0.12]],
    [-3, -10.5, 13.5, 0.7, [0.13, 0.22, 0.14]],
    [13, -8.5, 11, 0.7, [0.12, 0.2, 0.13]],
    [-15, -8, 10, 1.05, [0.16, 0.27, 0.15]],
    [2, -12, 14.5, 1.05, [0.17, 0.28, 0.15]],
  ];
  hills.forEach(([x, y, r, dz, [cr, cg, cb]], index) => {
    kit.primitive("hill", "cylinder", root, V(x, y, backZ + dz), { x: r * 2, y: 0.08, z: r * 2 }, kit.material(`hill-${index}`, new pc.Color(cr, cg, cb), 0.03), V(90, 0, 0), false);
  });
  const castle = kit.group("far-castle", root, V(8.5, 4.4, backZ + 0.32));
  const castleMat = kit.material("far-castle", new pc.Color(0.1, 0.14, 0.14), 0.03);
  for (const [x, w, h] of [[-1.2, 0.5, 2.4], [0, 1.6, 1.5], [1.2, 0.5, 2.1], [0, 0.45, 2.8]] as const) {
    kit.primitive("keep", "box", castle, V(x, h / 2, 0), { x: w, y: h, z: 0.05 }, castleMat, pc.Vec3.ZERO, false);
    kit.primitive("roof", "cone", castle, V(x, h + 0.35, 0), { x: w * 1.2, y: 0.7, z: 0.05 }, castleMat, pc.Vec3.ZERO, false);
  }
  const lamp = kit.material("window", new pc.Color(1, 0.8, 0.4), 0.2, 0, { emissive: new pc.Color(0.9, 0.62, 0.2) });
  for (const [x, y] of [[0, 2.2], [-0.35, 0.8], [0.4, 0.9], [1.2, 1.5]] as const) kit.primitive("window", "box", castle, V(x, y, 0.04), { x: 0.12, y: 0.2, z: 0.02 }, lamp, pc.Vec3.ZERO, false);
  const trunk = kit.material("tree-trunk", new pc.Color(0.12, 0.08, 0.05), 0.05);
  for (let index = 0; index < 11; index += 1) {
    const x = -15 + index * 3 + (hashUnit(`tx${index}`) - 0.5) * 1.6;
    if (Math.abs(x - 8.5) < 2.2) continue;
    const h = 2.2 + hashUnit(`th${index}`) * 1.6;
    const shade = 0.13 + hashUnit(`tc${index}`) * 0.06;
    const tree = kit.group("tree-flat", root, V(x, 0, backZ + 1.3 + hashUnit(`tz${index}`) * 0.3));
    kit.primitive("trunk", "box", tree, V(0, h * 0.25, 0), { x: 0.16, y: h * 0.5, z: 0.04 }, trunk, pc.Vec3.ZERO, false);
    kit.primitive("crown", "cone", tree, V(0, h * 0.72, 0), { x: h * 0.55, y: h * 0.9, z: 0.05 }, kit.material(`tree-${Math.round(shade * 100)}`, new pc.Color(shade * 0.7, shade * 1.4, shade * 0.85), 0.04), pc.Vec3.ZERO, false);
  }

  // Wings: tall cut-out trees at the sides of the stage.
  for (const side of [-1, 1]) {
    for (const [dz, h] of [[-7, 9], [-2.5, 10.5], [2.5, 9.5]] as const) {
      const wing = kit.group("wing", root, V(side * (STAGE.maxX + 0.6), 0, dz), V(0, side * 90, 0));
      kit.primitive("wing-trunk", "box", wing, V(0, h * 0.3, 0), { x: 0.4, y: h * 0.6, z: 0.05 }, trunk, pc.Vec3.ZERO, false);
      kit.primitive("wing-leaves", "cone", wing, V(0, h * 0.62, 0.02), { x: 3.6, y: h * 0.62, z: 0.05 }, kit.material("wing-leaves", new pc.Color(0.1, 0.22, 0.12), 0.04), pc.Vec3.ZERO, false);
      kit.primitive("wing-leaves-top", "cone", wing, V(0, h * 0.86, 0.04), { x: 2.6, y: h * 0.4, z: 0.05 }, kit.material("wing-leaves-2", new pc.Color(0.13, 0.26, 0.14), 0.04), pc.Vec3.ZERO, false);
    }
  }

  // Proscenium: gilt arch, velvet curtains, a valance.
  const velvet = kit.material("velvet", palette.velvet, 0.22);
  const velvetDark = kit.material("velvet-dark", new pc.Color(0.26, 0.015, 0.03), 0.18);
  const archZ = STAGE.maxZ + 1.1;
  for (const side of [-1, 1]) {
    const x = side * (width / 2 + 1.6);
    kit.primitive("pilaster", "box", root, V(x, 7, archZ), { x: 1.4, y: 16, z: 0.8 }, kit.material("pilaster", new pc.Color(0.3, 0.06, 0.05), 0.3), pc.Vec3.ZERO, false);
    kit.primitive("pilaster-trim", "box", root, V(x - side * 0.72, 7, archZ + 0.1), { x: 0.08, y: 16, z: 0.6 }, gold, pc.Vec3.ZERO, false);
    for (let fold = 0; fold < 6; fold += 1) {
      kit.primitive("curtain-fold", "cylinder", root, V(x - side * (0.9 + fold * 0.34), 6.6, archZ - 0.45 + (fold % 2) * 0.12), { x: 0.42, y: 14.6, z: 0.3 }, fold % 2 ? velvetDark : velvet, pc.Vec3.ZERO, false);
    }
    kit.primitive("tieback", "cylinder", root, V(x - side * 1.7, 3.2, archZ - 0.25), { x: 0.1, y: 2.2, z: 0.1 }, gold, V(0, 0, 90), false);
  }
  kit.primitive("valance", "box", root, V(0, 14.2, archZ - 0.3), { x: width + 5, y: 1.6, z: 0.4 }, velvet, pc.Vec3.ZERO, false);
  for (let index = 0; index < 22; index += 1) {
    const x = -width / 2 - 2 + index * ((width + 4) / 21);
    kit.primitive("scallop", "sphere", root, V(x, 13.35, archZ - 0.3), { x: 1.6, y: 0.8, z: 0.4 }, velvet, pc.Vec3.ZERO, false);
    kit.primitive("tassel", "cone", root, V(x, 12.85, archZ - 0.2), { x: 0.12, y: 0.35, z: 0.12 }, gold, V(180, 0, 0), false);
  }
  kit.primitive("arch-gilt", "box", root, V(0, 15.1, archZ + 0.05), { x: width + 5, y: 0.3, z: 0.5 }, gold, pc.Vec3.ZERO, false);
  const crest = kit.group("crest", root, V(0, 15.2, archZ + 0.35));
  kit.primitive("crest-shield", "cylinder", crest, V(), { x: 1.5, y: 0.1, z: 1.9 }, kit.material("crest", new pc.Color(0.035, 0.3, 0.2), 0.3), V(90, 0, 0), false);
  kit.primitive("crest-egg", "sphere", crest, V(0, 0.05, 0.08), { x: 0.55, y: 0.75, z: 0.2 }, kit.material("egg-shell", palette.egg, 0.55), pc.Vec3.ZERO, false);
  kit.primitive("crest-crack", "box", crest, V(0.02, 0.05, 0.19), { x: 0.07, y: 0.62, z: 0.02 }, kit.material("ink", palette.ink, 0.42), V(0, 0, 18), false);

  // Footlights along the apron.
  const footlights: pc.Entity[] = [];
  const brass = kit.material("brass", palette.bronze, 0.7, 0.6);
  const flame = kit.material("footlight-flame", new pc.Color(1, 0.8, 0.45), 0.2, 0, { emissive: new pc.Color(1, 0.7, 0.3) });
  for (let index = 0; index < 13; index += 1) {
    const x = -width / 2 + 1.2 + index * ((width - 2.4) / 12);
    const lamp = kit.group("footlight", root, V(x, 0.44, STAGE.maxZ + 0.28));
    kit.primitive("shade", "cylinder", lamp, V(0, 0.06, 0), { x: 0.3, y: 0.12, z: 0.3 }, brass);
    kit.primitive("reflector", "cone", lamp, V(0, 0.2, 0.06), { x: 0.34, y: 0.2, z: 0.34 }, brass, V(-120, 0, 0));
    footlights.push(kit.primitive("flame", "sphere", lamp, V(0, 0.18, -0.02), { x: 0.13, y: 0.16, z: 0.13 }, flame, pc.Vec3.ZERO, false));
  }

  // The Queen's battery dais and its stores.
  const dais = kit.group("battery", root, V(0.3, 0, 8.7));
  kit.primitive("dais", "box", dais, V(0, 0.06, 0.1), { x: 6.6, y: 0.12, z: 2.8 }, kit.material("dais", palette.oakDark, 0.14));
  kit.primitive("dais-rug", "box", dais, V(0, 0.125, 0.1), { x: 6.1, y: 0.02, z: 2.4 }, kit.material("queen-rug", new pc.Color(0.035, 0.3, 0.2), 0.08));
  kit.primitive("dais-rug-trim", "box", dais, V(0, 0.12, 0.1), { x: 6.3, y: 0.02, z: 2.6 }, gold);
  const iron = kit.material("shot-iron", palette.iron, 0.62, 0.76);
  for (const [x, y, z] of [[-3.1, 0.3, 0.9], [-2.7, 0.3, 0.9], [-2.9, 0.3, 1.25], [-2.9, 0.62, 1.02]] as const) {
    kit.primitive("shot-pile", "sphere", dais, V(x, y, z), { x: 0.4, y: 0.4, z: 0.4 }, iron);
  }
  const podium = kit.group("queen-podium", root, V(-4.4, 0, 7.4));
  kit.primitive("podium", "cylinder", podium, V(0, 0.2, 0), { x: 1.5, y: 0.4, z: 1.5 }, kit.material("podium", new pc.Color(0.05, 0.28, 0.19), 0.2));
  kit.primitive("podium-rim", "cylinder", podium, V(0, 0.41, 0), { x: 1.56, y: 0.04, z: 1.56 }, gold);
  kit.primitive("podium-step", "box", podium, V(0.55, 0.1, 0.55), { x: 0.7, y: 0.2, z: 0.5 }, kit.material("dais", palette.oakDark, 0.14), V(0, 45, 0));
  const pennants: pc.Entity[] = [];
  for (const x of [-3.4, 3.7]) {
    kit.primitive("pole", "cylinder", dais, V(x, 1.5, -0.9), { x: 0.07, y: 3, z: 0.07 }, kit.material("pole", palette.oakLight, 0.2));
    kit.primitive("finial", "sphere", dais, V(x, 3.05, -0.9), { x: 0.14, y: 0.14, z: 0.14 }, gold);
    const pennant = kit.group("pennant", dais, V(x, 2.7, -0.9));
    kit.primitive("flag", "cone", pennant, V(0.55, 0, 0), { x: 0.4, y: 1.1, z: 0.03 }, kit.material("queen-green-flag", new pc.Color(0.035, 0.49, 0.29), 0.22), V(0, 0, -90), false);
    pennants.push(pennant);
  }
  return { root, footlights, clouds, moon, pennants };
}
