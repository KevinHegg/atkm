import * as pc from "playcanvas";
import { EGG_BASE_T, eggRadius, eggY } from "../sim/egg.js";
import { hashUnit, palette, type Kit } from "./kit.js";

const V = (x = 0, y = 0, z = 0): pc.Vec3 => new pc.Vec3(x, y, z);

// ------------------------------------------------------------------ Humpty

export interface HumptyRig {
  root: pc.Entity;
  body: pc.Entity;
  face: pc.Entity;
  eyes: pc.Entity[];
  pupils: pc.Entity[];
  lids: pc.Entity[];
  brows: pc.Entity[];
  mouth: pc.Entity;
  frown: pc.Entity;
  mouthO: pc.Entity;
  arms: pc.Entity[];
  legs: pc.Entity[];
  crown: pc.Entity;
}

export function eggProfile(from = EGG_BASE_T, to = 1, rings = 28): Array<[number, number]> {
  const profile: Array<[number, number]> = [];
  for (let ring = 0; ring <= rings; ring += 1) {
    const t = from + (to - from) * (ring / rings);
    profile.push([eggRadius(t), eggY(t)]);
  }
  return profile;
}

/** Humpty's cravat (or is it a belt?) sits at his widest point. */
const CRAVAT_T = -0.12;

export function buildHumpty(kit: Kit, parent: pc.Entity): HumptyRig {
  const root = kit.group("humpty", parent);
  const body = kit.group("humpty-body", root);
  const shell = kit.material("egg-shell", palette.egg, 0.55);
  kit.meshEntity("egg-shell", kit.lathe("egg", eggProfile(), 36, true), shell, body);

  const cravatY = eggY(CRAVAT_T);
  const cravatR = eggRadius(CRAVAT_T);
  const red = kit.material("royal-red", palette.king, 0.3);
  const gold = kit.material("gold", palette.gold, 0.72, 0.55);
  kit.meshEntity("cravat", kit.torus(cravatR + 0.005, 0.045, 36, 6), red, kit.group("cravat-ring", body, V(0, cravatY, 0)));
  const knot = kit.group("cravat-knot", body, V(0, cravatY - 0.02, cravatR + 0.02));
  kit.primitive("knot", "sphere", knot, V(0, 0, 0.01), { x: 0.1, y: 0.09, z: 0.07 }, red);
  kit.primitive("bow-l", "cone", knot, V(-0.1, 0, 0), { x: 0.1, y: 0.16, z: 0.05 }, red, V(0, 0, 90));
  kit.primitive("bow-r", "cone", knot, V(0.1, 0, 0), { x: 0.1, y: 0.16, z: 0.05 }, red, V(0, 0, -90));
  kit.primitive("pin", "sphere", knot, V(0, 0, 0.05), { x: 0.035, y: 0.035, z: 0.035 }, gold);

  const face = kit.group("humpty-face", body, V(0, 0.18, 0));
  const faceZ = (y: number): number => eggRadius((y + 0.18) / 0.7) - 0.02;
  const eyeWhite = kit.material("eye-white", new pc.Color(1, 1, 0.98), 0.7);
  const ink = kit.material("ink", palette.ink, 0.42);
  const eyes: pc.Entity[] = [];
  const pupils: pc.Entity[] = [];
  const lids: pc.Entity[] = [];
  const brows: pc.Entity[] = [];
  for (const x of [-0.14, 0.14]) {
    const eye = kit.group("eye", face, V(x, 0.07, faceZ(0.07) - 0.01));
    kit.primitive("eye-rim", "sphere", eye, V(0, 0, -0.012), { x: 0.205, y: 0.26, z: 0.1 }, ink);
    kit.primitive("eye-white", "sphere", eye, V(0, 0, 0), { x: 0.18, y: 0.235, z: 0.11 }, eyeWhite);
    const pupil = kit.primitive("pupil", "sphere", eye, V(0, -0.01, 0.045), { x: 0.085, y: 0.115, z: 0.045 }, ink);
    kit.primitive("glint", "sphere", pupil, V(0.22, 0.25, 0.4), { x: 0.3, y: 0.3, z: 0.3 }, eyeWhite, pc.Vec3.ZERO, false);
    const lid = kit.primitive("lid", "sphere", eye, V(0, 0.045, 0.014), { x: 0.19, y: 0.15, z: 0.11 }, shell);
    lid.enabled = false;
    const brow = kit.primitive("brow", "box", face, V(x, 0.24, faceZ(0.24) + 0.005), { x: 0.19, y: 0.035, z: 0.03 }, ink, V(0, 0, x < 0 ? -8 : 8));
    eyes.push(eye);
    pupils.push(pupil);
    lids.push(lid);
    brows.push(brow);
  }
  kit.primitive("nose", "cone", face, V(0, -0.06, faceZ(-0.06) + 0.05), { x: 0.08, y: 0.16, z: 0.08 }, kit.material("nose", palette.gold, 0.28), V(90, 0, 0));
  // Smile and frown are open arcs of the same torus, turned to face the audience.
  const arc = kit.torus(0.14, 0.026, 18, 6, 110);
  const mouth = kit.group("mouth", face, V(0, -0.1, faceZ(-0.2) + 0.012));
  kit.meshEntity("smile", arc, ink, kit.group("smile-arc", mouth, V(), V(90, 0, -35)));
  const frown = kit.group("frown", face, V(0, -0.33, faceZ(-0.2) + 0.012));
  kit.meshEntity("frown", arc, ink, kit.group("frown-arc", frown, V(), V(90, 0, 145)));
  frown.enabled = false;
  const mouthO = kit.primitive("mouth-o", "sphere", face, V(0, -0.21, faceZ(-0.21) - 0.005), { x: 0.12, y: 0.15, z: 0.06 }, ink);
  mouthO.enabled = false;

  const crown = kit.group("crown", body, V(0, 0.68, 0));
  kit.primitive("crown-band", "cylinder", crown, V(0, 0, 0), { x: 0.3, y: 0.09, z: 0.3 }, gold);
  for (let index = 0; index < 5; index += 1) {
    const angle = (index / 5) * Math.PI * 2;
    kit.primitive("crown-point", "cone", crown, V(Math.cos(angle) * 0.11, 0.11, Math.sin(angle) * 0.11), { x: 0.07, y: 0.2, z: 0.07 }, gold);
  }
  kit.primitive("crown-jewel", "sphere", crown, V(0, 0.01, 0.15), { x: 0.06, y: 0.06, z: 0.04 }, kit.material("ruby", new pc.Color(0.7, 0.02, 0.05), 0.9));

  const arms: pc.Entity[] = [];
  const cream = kit.material("glove", palette.cream, 0.2);
  for (const side of [-1, 1]) {
    const arm = kit.group(side < 0 ? "arm-l" : "arm-r", body, V(side * 0.46, -0.02, 0.02), V(0, 0, side * -35));
    kit.primitive("sleeve", "cylinder", arm, V(side * 0.14, 0, 0), { x: 0.09, y: 0.3, z: 0.09 }, red, V(0, 0, 90));
    kit.primitive("glove", "sphere", arm, V(side * 0.32, 0, 0), { x: 0.13, y: 0.12, z: 0.11 }, cream);
    arms.push(arm);
  }
  const legs: pc.Entity[] = [];
  const stocking = kit.material("stocking", palette.cream, 0.18);
  const shoe = kit.material("shoe", palette.ink, 0.5);
  for (const side of [-1, 1]) {
    const leg = kit.group(side < 0 ? "leg-l" : "leg-r", body, V(side * 0.17, -0.48, 0.24), V(-70, 0, 0));
    kit.primitive("shin", "cylinder", leg, V(0, -0.14, 0), { x: 0.07, y: 0.28, z: 0.07 }, stocking);
    kit.primitive("shoe", "box", leg, V(0, -0.3, 0.05), { x: 0.1, y: 0.07, z: 0.17 }, shoe);
    kit.primitive("buckle", "box", leg, V(0, -0.28, 0.14), { x: 0.06, y: 0.04, z: 0.01 }, gold);
    legs.push(leg);
  }
  return { root, body, face, eyes, pupils, lids, brows, mouth, frown, mouthO, arms, legs, crown };
}

function zigzag(angle: number, teeth: number, base: number, depth: number): number {
  const phase = (angle / (Math.PI * 2)) * teeth;
  const tri = Math.abs((phase % 1) * 2 - 1);
  return base + (tri - 0.5) * depth;
}

export function buildShellPiece(kit: Kit, parent: pc.Entity, piece: "egg-bottom" | "egg-top" | "egg-chip", size: { x: number; y: number; z: number }): pc.Entity {
  const shell = kit.material("egg-shell-broken", palette.egg, 0.5, 0, { doubleSided: true });
  const root = kit.group(piece, parent);
  if (piece === "egg-chip") {
    kit.primitive("chip", "box", root, V(), size, shell);
    return root;
  }
  const rim = (angle: number): number => zigzag(angle, 7, 0.08, 0.22);
  if (piece === "egg-bottom") {
    const mesh = kit.jaggedLathe("egg-cup", eggRadius, eggY, () => EGG_BASE_T, rim);
    const offset = -size.y / 2 - eggY(EGG_BASE_T);
    const cup = kit.meshEntity("cup", mesh, shell, root);
    cup.setLocalPosition(0, offset, 0);
    kit.primitive("cup-floor", "cylinder", root, V(0, -size.y / 2 + 0.01, 0), { x: eggRadius(EGG_BASE_T) * 2, y: 0.02, z: eggRadius(EGG_BASE_T) * 2 }, shell);
    kit.primitive("yolk-inside", "sphere", root, V(0, offset - 0.2, 0), { x: 0.74, y: 0.3, z: 0.74 }, kit.material("yolk", palette.yolk, 0.85));
  } else {
    const mesh = kit.jaggedLathe("egg-cap", eggRadius, eggY, rim, () => 1);
    const cap = kit.meshEntity("cap", mesh, shell, root);
    cap.setLocalPosition(0, -size.y / 2 - eggY(0.08), 0);
  }
  return root;
}

// ------------------------------------------------------------------ Queen

export interface QueenRig {
  root: pc.Entity;
  body: pc.Entity;
  head: pc.Entity;
  crown: pc.Entity;
  scepter: pc.Entity;
  arm: pc.Entity;
}

export function buildQueen(kit: Kit, parent: pc.Entity): QueenRig {
  const root = kit.group("queen", parent);
  const body = kit.group("queen-body", root);
  body.setLocalScale(1.22, 1.22, 1.22);
  const velvet = kit.material("queen-velvet", new pc.Color(0.025, 0.12, 0.095), 0.16);
  const green = kit.material("queen-mad-green", new pc.Color(0.055, 0.34, 0.22), 0.2);
  const sicklyGreen = kit.material("queen-sickly-green", new pc.Color(0.31, 0.42, 0.095), 0.18);
  const paleSkin = kit.material("queen-pale-skin", new pc.Color(0.72, 0.61, 0.43), 0.18);
  const bone = kit.material("queen-bone", new pc.Color(0.86, 0.81, 0.63), 0.25);
  const black = kit.material("queen-black", palette.ink, 0.08);
  const tarnishedGold = kit.material("queen-tarnished-gold", new pc.Color(0.57, 0.39, 0.08), 0.5, 0.52);
  const iron = kit.material("iron", palette.iron, 0.55, 0.68);

  kit.primitive("underskirt", "cone", body, V(0, 0.38, 0.02), { x: 0.78, y: 0.76, z: 0.64 }, velvet);
  kit.primitive("overgown", "cone", body, V(0, 0.6, -0.03), { x: 0.64, y: 1.16, z: 0.56 }, green);
  kit.primitive("bodice", "box", body, V(0, 1.07, -0.01), { x: 0.48, y: 0.52, z: 0.34 }, velvet, V(0, 0, -3));
  kit.primitive("collar", "cylinder", body, V(0, 1.3, 0), { x: 0.43, y: 0.08, z: 0.43 }, bone);
  kit.primitive("ragged-cape", "box", body, V(0.05, 0.84, 0.24), { x: 0.82, y: 1.03, z: 0.08 }, velvet, V(-8, 0, 4));

  const head = kit.group("queen-head", body, V(0, 1.55, 0), V(0, 0, -7));
  kit.primitive("head", "sphere", head, V(), { x: 0.4, y: 0.46, z: 0.38 }, paleSkin);
  for (const [x, y, scale, angle] of [[-0.27, 0.1, 0.2, -24], [0.27, 0.12, 0.23, 29], [-0.18, 0.34, 0.19, -13], [0.17, 0.35, 0.2, 18]] as const) {
    kit.primitive("wild-hair", "sphere", head, V(x, y, 0.02), { x: scale, y: scale * 1.35, z: scale }, black, V(0, 0, angle));
  }
  kit.primitive("left-eye", "sphere", head, V(0.12, 0.07, -0.18), { x: 0.13, y: 0.1, z: 0.045 }, bone);
  kit.primitive("right-eye", "sphere", head, V(-0.13, 0.05, -0.18), { x: 0.095, y: 0.075, z: 0.04 }, bone);
  kit.primitive("left-pupil", "sphere", head, V(0.09, 0.08, -0.207), { x: 0.045, y: 0.052, z: 0.025 }, black);
  kit.primitive("right-pupil", "sphere", head, V(-0.16, 0.035, -0.205), { x: 0.036, y: 0.041, z: 0.023 }, sicklyGreen);
  kit.primitive("left-brow", "box", head, V(0.12, 0.2, -0.195), { x: 0.18, y: 0.035, z: 0.035 }, black, V(0, 0, 18));
  kit.primitive("right-brow", "box", head, V(-0.13, 0.17, -0.195), { x: 0.16, y: 0.035, z: 0.035 }, black, V(0, 0, -23));
  kit.primitive("nose", "cone", head, V(-0.01, -0.03, -0.225), { x: 0.075, y: 0.18, z: 0.075 }, paleSkin, V(-90, 0, 0));
  kit.primitive("crooked-mouth", "box", head, V(-0.035, -0.18, -0.2), { x: 0.23, y: 0.04, z: 0.035 }, black, V(0, 0, -14));

  const crown = kit.group("queen-crown", head, V(-0.03, 0.42, 0), V(0, 0, -17));
  kit.primitive("band", "cylinder", crown, V(), { x: 0.39, y: 0.13, z: 0.39 }, tarnishedGold);
  for (const [index, x] of [-0.28, -0.14, 0, 0.14, 0.28].entries()) {
    const height = index % 2 === 0 ? 0.42 : 0.3;
    kit.primitive("point", "cone", crown, V(x, 0.18, 0), { x: 0.11, y: height, z: 0.11 }, tarnishedGold, V(0, 0, (index - 2) * 7));
  }

  kit.primitive("left-sleeve", "cone", body, V(-0.46, 1.05, 0.02), { x: 0.25, y: 0.65, z: 0.25 }, green, V(0, 0, -28));
  const arm = kit.group("scepter-arm", body, V(0.4, 1.2, 0.01));
  kit.primitive("right-sleeve", "cone", arm, V(0.08, -0.2, 0), { x: 0.26, y: 0.7, z: 0.26 }, green, V(0, 0, 31));
  const scepter = kit.group("scepter", arm, V(0.28, -0.26, 0.01), V(0, 0, -9));
  kit.primitive("shaft", "cylinder", scepter, V(), { x: 0.055, y: 1.08, z: 0.055 }, tarnishedGold);
  kit.primitive("cage", "sphere", scepter, V(0, 0.62, 0), { x: 0.22, y: 0.24, z: 0.22 }, iron);
  for (const angle of [0, 90, 180, 270]) {
    const rad = (angle * Math.PI) / 180;
    kit.primitive("spike", "cone", scepter, V(Math.cos(rad) * 0.18, 0.62, Math.sin(rad) * 0.18), { x: 0.08, y: 0.3, z: 0.08 }, tarnishedGold, V(0, 0, angle + 90));
  }
  return { root, body, head, crown, scepter, arm };
}

// ------------------------------------------------------------------ King's men and horses

export interface ManRig {
  root: pc.Entity;
  rig: pc.Entity;
  leftArm: pc.Entity;
  rightArm: pc.Entity;
  leftLeg: pc.Entity;
  rightLeg: pc.Entity;
  daze: pc.Entity;
}

export function buildMan(kit: Kit, parent: pc.Entity, variant: "bearer" | "guard" | "driver"): ManRig {
  const root = kit.group("kings-man", parent);
  const rig = kit.group("rig", root, V(0, -0.8, 0));
  const uniform = kit.material("king-cloth", palette.king, 0.16);
  const ink = kit.material("ink", palette.ink, 0.42);
  const iron = kit.material("helmet-iron", palette.iron, 0.52, 0.66);
  const gold = kit.material("gold", palette.gold, 0.72, 0.55);
  const white = kit.material("belt-white", new pc.Color(0.86, 0.83, 0.74), 0.2);
  kit.primitive("torso", "box", rig, V(0, 1.05, 0), { x: 0.46, y: 0.62, z: 0.3 }, uniform);
  kit.primitive("cross-belt", "box", rig, V(0, 1.06, 0.155), { x: 0.08, y: 0.7, z: 0.02 }, white, V(0, 0, 32));
  kit.primitive("belt", "box", rig, V(0, 0.78, 0), { x: 0.48, y: 0.08, z: 0.32 }, ink);
  kit.primitive("buckle", "box", rig, V(0, 0.78, 0.165), { x: 0.08, y: 0.06, z: 0.01 }, gold);
  kit.primitive("head", "sphere", rig, V(0, 1.55, 0), { x: 0.34, y: 0.38, z: 0.32 }, kit.material("skin", palette.skin, 0.25));
  kit.primitive("nose", "sphere", rig, V(0, 1.53, 0.16), { x: 0.07, y: 0.07, z: 0.07 }, kit.material("skin-dark", new pc.Color(0.6, 0.38, 0.26), 0.25));
  for (const x of [-0.07, 0.07]) kit.primitive("eye", "sphere", rig, V(x, 1.6, 0.145), { x: 0.045, y: 0.055, z: 0.03 }, ink);
  kit.primitive("moustache", "box", rig, V(0, 1.49, 0.15), { x: 0.16, y: 0.035, z: 0.04 }, ink);
  if (variant === "guard") {
    kit.primitive("bearskin", "cylinder", rig, V(0, 1.84, -0.01), { x: 0.34, y: 0.42, z: 0.34 }, ink);
    kit.primitive("bearskin-top", "sphere", rig, V(0, 2.05, -0.01), { x: 0.34, y: 0.2, z: 0.34 }, ink);
    kit.primitive("chinstrap", "box", rig, V(0, 1.45, 0.02), { x: 0.36, y: 0.03, z: 0.02 }, gold);
  } else {
    const helmet = kit.primitive("helmet", "sphere", rig, V(0, 1.7, -0.01), { x: 0.38, y: 0.2, z: 0.36 }, iron);
    kit.primitive("brim", "cylinder", rig, V(0, 1.66, -0.01), { x: 0.5, y: 0.02, z: 0.5 }, iron);
    kit.primitive("ridge", "box", helmet, V(0, 0.4, 0), { x: 0.11, y: 0.22, z: 0.48 }, uniform);
  }
  const leftArm = kit.group("arm-l", rig, V(-0.3, 1.3, 0));
  kit.primitive("sleeve", "cylinder", leftArm, V(0, -0.27, 0), { x: 0.12, y: 0.56, z: 0.12 }, uniform);
  kit.primitive("hand", "sphere", leftArm, V(0, -0.56, 0), { x: 0.11, y: 0.11, z: 0.11 }, kit.material("skin", palette.skin, 0.25));
  const rightArm = kit.group("arm-r", rig, V(0.3, 1.3, 0));
  kit.primitive("sleeve", "cylinder", rightArm, V(0, -0.27, 0), { x: 0.12, y: 0.56, z: 0.12 }, uniform);
  kit.primitive("hand", "sphere", rightArm, V(0, -0.56, 0), { x: 0.11, y: 0.11, z: 0.11 }, kit.material("skin", palette.skin, 0.25));
  if (variant === "guard") {
    kit.primitive("pike", "cylinder", rightArm, V(0, -0.2, 0.08), { x: 0.035, y: 2.1, z: 0.035 }, kit.material("pike-shaft", palette.oakLight, 0.16));
    kit.primitive("pike-head", "cone", rightArm, V(0, 0.92, 0.08), { x: 0.09, y: 0.24, z: 0.03 }, iron);
  }
  const leftLeg = kit.group("leg-l", rig, V(-0.12, 0.74, 0));
  kit.primitive("leg", "cylinder", leftLeg, V(0, -0.36, 0), { x: 0.13, y: 0.72, z: 0.13 }, ink);
  kit.primitive("boot", "box", leftLeg, V(0, -0.7, 0.05), { x: 0.14, y: 0.1, z: 0.24 }, ink);
  const rightLeg = kit.group("leg-r", rig, V(0.12, 0.74, 0));
  kit.primitive("leg", "cylinder", rightLeg, V(0, -0.36, 0), { x: 0.13, y: 0.72, z: 0.13 }, ink);
  kit.primitive("boot", "box", rightLeg, V(0, -0.7, 0.05), { x: 0.14, y: 0.1, z: 0.24 }, ink);
  const daze = kit.group("daze", rig, V(0, 2.1, 0));
  for (let index = 0; index < 3; index += 1) {
    const angle = (index / 3) * Math.PI * 2;
    kit.primitive("star", "sphere", daze, V(Math.cos(angle) * 0.3, 0, Math.sin(angle) * 0.3), { x: 0.09, y: 0.09, z: 0.09 }, kit.material("daze-star", palette.gold, 0.6, 0, { emissive: new pc.Color(0.5, 0.35, 0.02) }), pc.Vec3.ZERO, false);
  }
  daze.enabled = false;
  return { root, rig, leftArm, rightArm, leftLeg, rightLeg, daze };
}

export interface HorseRig {
  root: pc.Entity;
  body: pc.Entity;
  legs: pc.Entity[];
  head: pc.Entity;
  tail: pc.Entity;
}

export function buildHorse(kit: Kit, parent: pc.Entity): HorseRig {
  const root = kit.group("horse", parent);
  const body = kit.group("horse-body", root, V(0, -1.05, 0));
  const coat = kit.material("horse-coat", new pc.Color(0.9, 0.87, 0.8), 0.2);
  const mane = kit.material("horse-mane", new pc.Color(0.3, 0.27, 0.24), 0.1);
  const ink = kit.material("ink", palette.ink, 0.42);
  const red = kit.material("king-cloth", palette.king, 0.16);
  const gold = kit.material("gold", palette.gold, 0.72, 0.55);
  kit.primitive("barrel", "capsule", body, V(0, 1.25, 0), { x: 0.62, y: 1.55, z: 0.7 }, coat, V(90, 0, 0));
  kit.primitive("caparison", "box", body, V(0, 1.12, -0.05), { x: 0.7, y: 0.55, z: 1.2 }, red);
  kit.primitive("caparison-trim", "box", body, V(0, 0.86, -0.05), { x: 0.72, y: 0.06, z: 1.22 }, gold);
  kit.primitive("saddle-crown", "sphere", body, V(0, 1.43, -0.05), { x: 0.2, y: 0.12, z: 0.2 }, gold);
  const legs: pc.Entity[] = [];
  for (const [x, z] of [[-0.2, 0.55], [0.2, 0.55], [-0.2, -0.55], [0.2, -0.55]] as const) {
    const leg = kit.group("leg", body, V(x, 1.0, z));
    kit.primitive("leg", "cylinder", leg, V(0, -0.45, 0), { x: 0.15, y: 0.9, z: 0.15 }, coat);
    kit.primitive("hoof", "cylinder", leg, V(0, -0.9, 0), { x: 0.17, y: 0.1, z: 0.17 }, ink);
    legs.push(leg);
  }
  const head = kit.group("head", body, V(0, 1.55, 0.72));
  kit.primitive("neck", "box", head, V(0, 0.28, 0.12), { x: 0.28, y: 0.7, z: 0.34 }, coat, V(30, 0, 0));
  kit.primitive("mane", "box", head, V(0, 0.35, -0.02), { x: 0.1, y: 0.7, z: 0.14 }, mane, V(30, 0, 0));
  kit.primitive("skull", "box", head, V(0, 0.62, 0.36), { x: 0.26, y: 0.26, z: 0.52 }, coat, V(20, 0, 0));
  kit.primitive("muzzle", "box", head, V(0, 0.52, 0.6), { x: 0.24, y: 0.2, z: 0.2 }, kit.material("horse-muzzle", new pc.Color(0.7, 0.62, 0.58), 0.2));
  for (const x of [-0.08, 0.08]) kit.primitive("ear", "cone", head, V(x, 0.82, 0.22), { x: 0.07, y: 0.18, z: 0.05 }, coat);
  for (const x of [-0.14, 0.14]) kit.primitive("eye", "sphere", head, V(x, 0.68, 0.4), { x: 0.05, y: 0.06, z: 0.06 }, ink);
  kit.primitive("plume", "cone", head, V(0, 0.98, 0.18), { x: 0.1, y: 0.3, z: 0.1 }, red);
  kit.primitive("bridle", "box", head, V(0, 0.6, 0.42), { x: 0.28, y: 0.04, z: 0.3 }, gold, V(20, 0, 0));
  const tail = kit.group("tail", body, V(0, 1.35, -0.78));
  kit.primitive("tail", "cone", tail, V(0, -0.25, -0.05), { x: 0.14, y: 0.6, z: 0.14 }, mane, V(160, 0, 0));
  return { root, body, legs, head, tail };
}

export function buildLitterBed(kit: Kit, parent: pc.Entity, size: { x: number; y: number; z: number }): pc.Entity {
  const root = kit.group("litter", parent);
  const straw = kit.material("straw", palette.straw, 0.08);
  const pole = kit.material("pole", palette.oakLight, 0.2);
  const red = kit.material("king-cloth", palette.king, 0.16);
  kit.primitive("mattress", "box", root, V(0, 0.02, 0), { x: size.x * 0.92, y: size.y, z: size.z * 0.86 }, straw);
  for (const x of [-size.x / 2, size.x / 2]) {
    kit.primitive("pole", "cylinder", root, V(x, 0.02, 0), { x: 0.07, y: size.z + 0.9, z: 0.07 }, pole, V(90, 0, 0));
  }
  kit.primitive("blanket", "box", root, V(0, size.y / 2 + 0.02, -size.z * 0.2), { x: size.x * 0.94, y: 0.03, z: size.z * 0.35 }, red);
  kit.primitive("pillow", "sphere", root, V(0, size.y / 2 + 0.04, size.z * 0.34), { x: 0.5, y: 0.14, z: 0.3 }, kit.material("pillow", palette.cream, 0.2));
  return root;
}

export function buildCartBed(kit: Kit, parent: pc.Entity, size: { x: number; y: number; z: number }): { root: pc.Entity; wheels: pc.Entity[] } {
  const root = kit.group("cart", parent);
  const dark = kit.material("oak-dark", palette.oakDark, 0.16);
  const oak = kit.material("oak", palette.oak, 0.2);
  const straw = kit.material("straw", palette.straw, 0.08);
  const red = kit.material("king-cloth", palette.king, 0.16);
  const gold = kit.material("gold", palette.gold, 0.72, 0.55);
  kit.primitive("tray", "box", root, V(0, -0.05, 0), { x: size.x, y: 0.12, z: size.z }, dark);
  for (const x of [-size.x / 2, size.x / 2]) kit.primitive("side", "box", root, V(x, 0.08, 0), { x: 0.08, y: 0.3, z: size.z }, red);
  kit.primitive("side-trim", "box", root, V(size.x / 2 + 0.045, 0.08, 0), { x: 0.02, y: 0.06, z: size.z * 0.9 }, gold);
  kit.primitive("side-trim", "box", root, V(-size.x / 2 - 0.045, 0.08, 0), { x: 0.02, y: 0.06, z: size.z * 0.9 }, gold);
  kit.primitive("hay-load", "box", root, V(0, 0.12, 0), { x: size.x * 0.9, y: 0.24, z: size.z * 0.92 }, straw);
  for (const [x, z] of [[-0.3, -0.5], [0.35, 0.3], [0, -0.1]] as const) kit.primitive("hay-mound", "sphere", root, V(x, 0.24, z), { x: 0.7, y: 0.25, z: 0.6 }, straw);
  const wheels: pc.Entity[] = [];
  for (const x of [-size.x / 2 - 0.12, size.x / 2 + 0.12]) {
    const wheel = kit.group("wheel", root, V(x, -0.3, -0.1), V(0, 0, 90));
    kit.meshEntity("rim", kit.torus(0.44, 0.05, 20, 6), dark, kit.group("rim-axis", wheel, V(), V(0, 0, 0)));
    for (let spoke = 0; spoke < 4; spoke += 1) kit.primitive("spoke", "box", wheel, V(), { x: 0.05, y: 0.04, z: 0.86 }, oak, V(0, spoke * 45, 0));
    kit.primitive("hub", "cylinder", wheel, V(), { x: 0.14, y: 0.14, z: 0.14 }, gold);
    wheels.push(wheel);
  }
  for (const x of [-0.35, 0.35]) kit.primitive("shaft", "cylinder", root, V(x, 0.05, size.z / 2 + 0.7), { x: 0.06, y: 1.5, z: 0.06 }, oak, V(90, 0, 0));
  return { root, wheels };
}

// ------------------------------------------------------------------ Masonry and stores

type Box = { center: readonly [number, number, number]; size: readonly [number, number, number]; color: pc.Color };

const shade = (color: pc.Color, amount: number): pc.Color =>
  new pc.Color(Math.min(1, color.r * amount), Math.min(1, color.g * amount), Math.min(1, color.b * amount));

/** Masonry and timber are baked into one vertex-coloured mesh per size and tone. */
export function buildBlock(kit: Kit, parent: pc.Entity, material: string, size: { x: number; y: number; z: number }, seed: string): pc.Entity {
  const root = kit.group(`block-${material}`, parent);
  const tone = Math.floor(hashUnit(seed) * 4);
  const key = `${material}-${tone}-${size.x.toFixed(2)}x${size.y.toFixed(2)}x${size.z.toFixed(2)}`;
  const { x, y, z } = size;
  const boxes: Box[] = [];
  let gloss = 0.17;
  if (material === "canopy") return buildCanopy(kit, root, size);
  if (material === "maypole") return buildMaypole(kit, root, size.y, true);
  if (material === "seat") return buildSwingSeat(kit, root, size);
  if (material === "cradle") return buildCradle(kit, root, size);
  if (material === "seesaw") return buildSeesaw(kit, root, size);
  if (material === "anvil") {
    const iron = new pc.Color(0.16, 0.17, 0.18);
    const edge = new pc.Color(0.3, 0.31, 0.32);
    boxes.push({ center: [0, -y * 0.38, 0], size: [x * 0.8, y * 0.24, z * 0.9], color: iron });
    boxes.push({ center: [0, -y * 0.08, 0], size: [x * 0.42, y * 0.4, z * 0.56], color: iron });
    boxes.push({ center: [0, y * 0.3, 0], size: [x * 0.78, y * 0.4, z], color: iron });
    boxes.push({ center: [x * 0.44, y * 0.34, 0], size: [x * 0.22, y * 0.24, z * 0.6], color: iron });
    boxes.push({ center: [0, y * 0.505, 0], size: [x * 0.74, 0.012, z * 0.94], color: edge });
    kit.meshEntity("anvil", kit.boxes(`anvil-${x.toFixed(2)}`, boxes), kit.paintMaterial(0.55), root);
    return root;
  }
  if (material === "post") {
    gloss = 0.6;
    boxes.push({ center: [0, 0, 0], size: [x, y, z], color: shade(palette.gold, 0.85) });
    for (const band of [-0.3, 0, 0.3]) {
      boxes.push({ center: [0, band * y, 0], size: [x * 1.15, 0.08, z * 1.15], color: palette.king });
    }
    boxes.push({ center: [0, y / 2 - 0.03, 0], size: [x * 1.6, 0.06, z * 1.6], color: palette.gold });
  } else if (material === "stone") {
    gloss = 0.07;
    const color = new pc.Color(0.38 + tone * 0.025, 0.37 + tone * 0.022, 0.33 + tone * 0.018);
    boxes.push({ center: [0, 0, 0], size: [x * 0.985, y * 0.97, z * 0.985], color });
    const face = shade(color, 1.12);
    for (const side of [-1, 1]) {
      boxes.push({ center: [0, 0, side * z * 0.5], size: [x * 0.86, y * 0.8, 0.02], color: face });
      boxes.push({ center: [side * x * 0.5, 0, 0], size: [0.02, y * 0.8, z * 0.86], color: face });
    }
    boxes.push({ center: [0, y * 0.49, 0], size: [x * 0.86, 0.02, z * 0.86], color: face });
  } else if (material === "brick") {
    gloss = 0.1;
    const color = new pc.Color(0.44 + tone * 0.03, 0.19 + tone * 0.015, 0.12);
    boxes.push({ center: [0, 0, 0], size: [x * 0.985, y * 0.97, z * 0.985], color });
    const courses = Math.max(1, Math.round(y / 0.25));
    const mortar = new pc.Color(0.66, 0.6, 0.5);
    for (let course = 1; course < courses; course += 1) {
      boxes.push({ center: [0, -y / 2 + (course * y) / courses, 0], size: [x * 1.001, 0.025, z * 1.001], color: mortar });
    }
  } else {
    const base = material === "plank" ? palette.oakLight : material === "beam" ? palette.oakDark : palette.oak;
    const color = shade(base, 0.88 + tone * 0.06);
    boxes.push({ center: [0, 0, 0], size: [x * 0.99, y * 0.96, z * 0.97], color });
    const grain = palette.oakDark;
    const long = x >= z;
    const length = (long ? x : z) * 0.84;
    const across = long ? z : x;
    for (const offset of [-0.22, 0.05, 0.26]) {
      const o = offset * across;
      boxes.push(long
        ? { center: [0, y * 0.48 + 0.004, o], size: [length, 0.012, 0.014], color: grain }
        : { center: [o, y * 0.48 + 0.004, 0], size: [0.014, 0.012, length], color: grain });
    }
    for (const side of [-1, 1]) {
      const h = y * 0.2;
      boxes.push(long
        ? { center: [0, h * side * 0.8, side * z * 0.485 + side * 0.004], size: [length, 0.012, 0.012], color: grain }
        : { center: [side * x * 0.495 + side * 0.004, h * side * 0.8, 0], size: [0.012, 0.012, length], color: grain });
    }
    const end = shade(palette.oakLight, 0.95 + tone * 0.03);
    for (const side of [-1, 1]) {
      boxes.push(long
        ? { center: [side * x * 0.495, 0, 0], size: [0.014, y * 0.86, z * 0.84], color: end }
        : { center: [0, 0, side * z * 0.485], size: [x * 0.84, y * 0.86, 0.014], color: end });
    }
  }
  kit.meshEntity("block", kit.boxes(key, boxes), kit.paintMaterial(gloss), root);
  return root;
}

/** A royal pavilion: cloth roof with gold trim and a scalloped valance, a peaked top and a finial. */
function buildCanopy(kit: Kit, root: pc.Entity, size: { x: number; y: number; z: number }): pc.Entity {
  const { x, y, z } = size;
  const crimson = palette.king;
  const gold = palette.gold;
  const boxes: Box[] = [{ center: [0, 0, 0], size: [x, y, z], color: crimson }];
  for (const side of [-1, 1]) {
    boxes.push({ center: [0, y / 2, side * z / 2], size: [x + 0.04, 0.05, 0.05], color: gold });
    boxes.push({ center: [side * x / 2, y / 2, 0], size: [0.05, 0.05, z + 0.04], color: gold });
  }
  const tabs = 9;
  for (let index = 0; index < tabs; index += 1) {
    const along = -x / 2 + (index + 0.5) * (x / tabs);
    const color = index % 2 === 0 ? crimson : gold;
    for (const side of [-1, 1]) {
      boxes.push({ center: [along, -y / 2 - 0.1, side * (z / 2 + 0.01)], size: [x / tabs - 0.03, 0.22, 0.03], color });
      boxes.push({ center: [side * (x / 2 + 0.01), -y / 2 - 0.1, along], size: [0.03, 0.22, x / tabs - 0.03], color });
    }
  }
  kit.meshEntity("canopy-cloth", kit.boxes(`canopy-${x.toFixed(2)}x${z.toFixed(2)}`, boxes), kit.paintMaterial(0.2), root);
  const cloth = kit.material("canopy-crimson", crimson, 0.25);
  const trim = kit.material("gold", palette.gold, 0.72, 0.55);
  kit.primitive("canopy-peak", "cone", root, V(0, y / 2 + 0.42, 0), { x: x * 1.02, y: 0.84, z: z * 1.02 }, cloth);
  kit.primitive("canopy-peak-band", "cone", root, V(0, y / 2 + 0.72, 0), { x: x * 0.32, y: 0.26, z: z * 0.32 }, trim, pc.Vec3.ZERO, false);
  kit.primitive("canopy-finial", "sphere", root, V(0, y / 2 + 0.95, 0), { x: 0.22, y: 0.22, z: 0.22 }, trim);
  kit.primitive("canopy-pennant", "cone", root, V(0.22, y / 2 + 1.2, 0), { x: 0.3, y: 0.5, z: 0.02 }, kit.material("queen-green-flag", new pc.Color(0.035, 0.49, 0.29), 0.22), V(0, 0, -90), false);
  return root;
}

/** A royal swing seat: plank, back and arms, gilded and upholstered. */
function buildSwingSeat(kit: Kit, root: pc.Entity, size: { x: number; y: number; z: number }): pc.Entity {
  const w = size.x;
  const d = size.z;
  const wood = shade(palette.oakLight, 0.9);
  const red = palette.king;
  const gold = palette.gold;
  const boxes: Box[] = [
    { center: [0, -0.06, 0], size: [w, 0.12, d], color: wood },
    { center: [0, 0.015, 0.02], size: [w - 0.16, 0.05, d - 0.14], color: red },
    { center: [0, 0.42, -d / 2 + 0.05], size: [w, 0.84, 0.1], color: wood },
    { center: [0, 0.45, -d / 2 + 0.11], size: [w - 0.2, 0.62, 0.03], color: red },
    { center: [0, 0.86, -d / 2 + 0.05], size: [w + 0.06, 0.06, 0.14], color: gold },
  ];
  for (const side of [-1, 1]) {
    boxes.push({ center: [side * (w / 2 - 0.05), 0.3, 0], size: [0.1, 0.6, d], color: wood });
    boxes.push({ center: [side * (w / 2 - 0.05), 0.62, 0.02], size: [0.14, 0.05, d - 0.04], color: gold });
  }

  kit.meshEntity("swing-seat", kit.boxes(`swing-seat-${w.toFixed(2)}`, boxes), kit.paintMaterial(0.3), root);
  return root;
}

/** The see-saw: a long plank with a bucket on the throwing arm and a lipped tray on the short one. */
function buildSeesaw(kit: Kit, root: pc.Entity, size: { x: number; y: number; z: number }): pc.Entity {
  const half = size.x / 2;
  const plank = palette.oakLight;
  const dark = palette.oakDark;
  const red = palette.king;
  const bucket = -half + 0.62;
  const boxes: Box[] = [
    { center: [0, 0, 0], size: [size.x, 0.16, 0.9], color: plank },
    { center: [0, 0.085, 0], size: [size.x - 0.2, 0.01, 0.06], color: dark },
    // Bucket, painted royal red.
    { center: [-half + 0.05, 0.36, 0], size: [0.1, 0.56, 1.24], color: red },
    { center: [bucket + 0.62, 0.36, 0], size: [0.1, 0.56, 1.24], color: red },
    { center: [bucket, 0.36, 0.6], size: [1.24, 0.56, 0.1], color: red },
    { center: [bucket, 0.36, -0.6], size: [1.24, 0.56, 0.1], color: red },
    { center: [bucket, 0.66, 0.6], size: [1.3, 0.05, 0.14], color: palette.gold },
    { center: [bucket, 0.66, -0.6], size: [1.3, 0.05, 0.14], color: palette.gold },
    // The tray on the short arm.
    { center: [half - 0.65, 0.1, 0], size: [1.3, 0.12, 1.6], color: dark },
    { center: [half - 0.65, 0.3, 0.78], size: [1.3, 0.28, 0.08], color: plank },
    { center: [half - 0.65, 0.3, -0.78], size: [1.3, 0.28, 0.08], color: plank },
    { center: [half - 0.02, 0.3, 0], size: [0.08, 0.28, 1.6], color: plank },
  ];
  kit.meshEntity("seesaw", kit.boxes(`seesaw-${size.x.toFixed(2)}`, boxes), kit.paintMaterial(0.2), root);
  return root;
}

/**
 * A maypole: a striped shaft with a gilt crown to sit on and ribbons hanging from it.
 * `crowned` false gives the stump left behind when chain shot cuts it, splintered on top.
 */
export function buildMaypole(kit: Kit, root: pc.Entity, height: number, crowned: boolean): pc.Entity {
  const crown = crowned ? 0.12 : 0;
  const shaft = height - crown;
  const cream = kit.material("maypole-cream", palette.cream, 0.35);
  const red = kit.material("maypole-red", palette.king, 0.35);
  const gold = kit.material("gold", palette.gold, 0.72, 0.55);
  const bands = Math.max(1, Math.round(shaft / 0.34));
  const band = shaft / bands;
  for (let index = 0; index < bands; index += 1) {
    const y = -height / 2 + band * (index + 0.5);
    kit.primitive("maypole-band", "cylinder", root, V(0, y, 0), { x: 0.3, y: band + 0.002, z: 0.3 }, index % 2 ? red : cream, pc.Vec3.ZERO, index % 3 === 0);
  }
  if (!crowned) {
    const wood = kit.material("oak-light", palette.oakLight, 0.2);
    for (const [dx, dz, h] of [[0.06, 0.02, 0.2], [-0.07, 0.05, 0.14], [0.01, -0.08, 0.17]] as const) {
      kit.primitive("splinter", "cone", root, V(dx, height / 2 + h / 2 - 0.01, dz), { x: 0.1, y: h, z: 0.1 }, wood, pc.Vec3.ZERO, false);
    }
    return root;
  }
  const top = height / 2 - crown / 2;
  kit.primitive("maypole-crown", "cylinder", root, V(0, top, 0), { x: 0.96, y: crown, z: 0.96 }, gold);
  kit.primitive("maypole-rim", "cylinder", root, V(0, top - 0.04, 0), { x: 1.02, y: 0.05, z: 1.02 }, red, pc.Vec3.ZERO, false);
  const ribbons = [palette.king, palette.gold, palette.queen, palette.cream, palette.king, palette.queen];
  ribbons.forEach((color, index) => {
    const angle = (index / ribbons.length) * 360 + 15;
    const arm = kit.group("ribbon", root, V(0, top - 0.06, 0), V(0, angle, 0));
    const ribbon = kit.material(`ribbon-${index % 4}`, color, 0.3, 0, { doubleSided: true });
    kit.primitive("ribbon-strip", "box", arm, V(0.47, -0.8, 0), { x: 0.02, y: 1.6, z: 0.09 }, ribbon, V(0, 0, 8), false);
  });
  for (let index = 0; index < 10; index += 1) {
    const angle = (index / 10) * Math.PI * 2;
    kit.primitive("garland", "sphere", root, V(Math.cos(angle) * 0.49, top, Math.sin(angle) * 0.49), { x: 0.11, y: 0.11, z: 0.11 }, index % 2 ? cream : red, pc.Vec3.ZERO, false);
  }
  return root;
}

/** The dinner gong: bronze on an oak frame, with a painted knife-and-fork sign. Faces +z. */
function buildGong(kit: Kit, root: pc.Entity, size: { x: number; y: number; z: number }): pc.Entity {
  const oak = kit.material("oak-dark", palette.oakDark, 0.16);
  const bronze = kit.material("gong-bronze", new pc.Color(0.72, 0.47, 0.17), 0.85, 0.8);
  const gold = kit.material("gold", palette.gold, 0.72, 0.55);
  const rope = kit.material("rope", palette.rope, 0.12);
  const radius = size.x / 2 - 0.04;
  const floor = -size.y / 2 - 0.35;
  const beam = size.y / 2 + 0.22;
  for (const side of [-1, 1]) {
    kit.primitive("gong-post", "box", root, V(side * (radius + 0.2), (floor + beam) / 2, 0), { x: 0.14, y: beam - floor, z: 0.14 }, oak);
    kit.primitive("gong-foot", "box", root, V(side * (radius + 0.2), floor + 0.05, 0), { x: 0.2, y: 0.1, z: 0.8 }, oak);
    kit.primitive("gong-cord", "cylinder", root, V(side * 0.3, (beam + radius * 0.8) / 2, 0), { x: 0.03, y: beam - radius * 0.8, z: 0.03 }, rope, pc.Vec3.ZERO, false);
  }
  kit.primitive("gong-beam", "box", root, V(0, beam, 0), { x: radius * 2 + 0.6, y: 0.14, z: 0.16 }, oak);
  kit.primitive("gong-disc", "cylinder", root, V(0, 0, 0), { x: radius * 2, y: 0.06, z: radius * 2 }, bronze, V(90, 0, 0));
  kit.primitive("gong-rim", "cylinder", root, V(0, 0, 0.01), { x: radius * 2 + 0.06, y: 0.03, z: radius * 2 + 0.06 }, gold, V(90, 0, 0), false);
  kit.primitive("gong-boss", "sphere", root, V(0, 0, 0.04), { x: 0.36, y: 0.36, z: 0.12 }, gold, pc.Vec3.ZERO, false);
  // The sign: a cream board with a crossed knife and fork.
  const sign = kit.group("gong-sign", root, V(0, beam + 0.32, 0.02));
  kit.primitive("sign-board", "box", sign, V(), { x: 0.72, y: 0.46, z: 0.05 }, kit.material("sign-cream", palette.cream, 0.3));
  const ink = kit.material("ink", palette.ink, 0.42);
  kit.primitive("sign-knife", "box", sign, V(0, 0, 0.03), { x: 0.05, y: 0.36, z: 0.01 }, ink, V(0, 0, 32), false);
  kit.primitive("sign-fork", "box", sign, V(0, 0, 0.03), { x: 0.05, y: 0.36, z: 0.01 }, ink, V(0, 0, -32), false);
  kit.primitive("sign-plate", "cylinder", sign, V(0, 0, 0.035), { x: 0.22, y: 0.01, z: 0.22 }, kit.material("sign-plate", palette.gold, 0.5), V(90, 0, 0), false);
  // The beater, hung on its peg.
  kit.primitive("beater-stick", "cylinder", root, V(radius + 0.32, 0.1, 0.12), { x: 0.05, y: 0.7, z: 0.05 }, oak, V(0, 0, 12), false);
  kit.primitive("beater-head", "sphere", root, V(radius + 0.39, -0.24, 0.12), { x: 0.18, y: 0.18, z: 0.18 }, kit.material("beater-felt", palette.king, 0.2), pc.Vec3.ZERO, false);
  return root;
}

/** Rock-a-bye: a wicker basket lined with a crimson blanket. */
function buildCradle(kit: Kit, root: pc.Entity, size: { x: number; y: number; z: number }): pc.Entity {
  const w = size.x;
  const d = size.z;
  const wicker = new pc.Color(0.72, 0.56, 0.3);
  const weave = new pc.Color(0.58, 0.43, 0.2);
  const parts: Box[] = [
    { center: [0, -0.06, 0], size: [w, 0.12, d], color: wicker },
    { center: [0, 0.02, 0], size: [w - 0.12, 0.04, d - 0.12], color: palette.king },
  ];
  for (const side of [-1, 1]) {
    parts.push({ center: [0, 0.17, side * (d / 2 - 0.05)], size: [w, 0.34, 0.1], color: wicker });
    parts.push({ center: [side * (w / 2 - 0.05), 0.17, 0], size: [0.1, 0.34, d], color: wicker });
    for (const k of [0.1, 0.24]) {
      parts.push({ center: [0, k, side * (d / 2 - 0.0)], size: [w + 0.01, 0.03, 0.02], color: weave });
      parts.push({ center: [side * (w / 2), k, 0], size: [0.02, 0.03, d + 0.01], color: weave });
    }
    parts.push({ center: [side * (w / 2 - 0.2), 0.34, 0], size: [0.3, 0.06, d - 0.1], color: palette.cream });
  }
  kit.meshEntity("cradle", kit.boxes(`cradle-${w.toFixed(2)}x${d.toFixed(2)}`, parts), kit.paintMaterial(0.2), root);
  return root;
}

/** An iron-bound chest of spare powder and shot. The lid swings up when it is forced. */
export function buildChest(kit: Kit, parent: pc.Entity, size: { x: number; y: number; z: number }): { root: pc.Entity; lid: pc.Entity; hoard: pc.Entity } {
  const root = kit.group("chest", parent);
  const { x, y, z } = size;
  const wood = palette.oakDark;
  const iron = new pc.Color(0.16, 0.17, 0.18);
  const gold = palette.gold;
  const body = y * 0.66;
  const parts: Box[] = [{ center: [0, -y / 2 + body / 2, 0], size: [x, body, z], color: wood }];
  for (const k of [-0.36, 0, 0.36]) parts.push({ center: [k * x, -y / 2 + body / 2, 0], size: [0.06, body + 0.01, z + 0.02], color: iron });
  parts.push({ center: [0, -y / 2 + body - 0.08, z / 2 + 0.01], size: [0.14, 0.16, 0.03], color: gold });
  kit.meshEntity("chest-body", kit.boxes(`chest-${x.toFixed(2)}`, parts), kit.paintMaterial(0.35), root);
  // The hoard inside: a heap of shot and a glint of gold, seen once the lid is up.
  const hoard = kit.group("chest-hoard", root, V(0, -y / 2 + body - 0.02, 0));
  const shot = kit.material("shot-iron", palette.iron, 0.62, 0.76);
  for (const [dx, dz] of [[-0.2, 0], [0, 0.06], [0.2, -0.04], [-0.08, -0.1], [0.12, 0.12]] as const) kit.primitive("hoard-ball", "sphere", hoard, V(dx * x, 0.02, dz * z * 2), { x: 0.16, y: 0.16, z: 0.16 }, shot, pc.Vec3.ZERO, false);
  kit.primitive("hoard-gold", "box", hoard, V(0.26 * x, 0.04, -0.12), { x: 0.14, y: 0.06, z: 0.1 }, kit.material("gold", gold, 0.72, 0.55), V(0, 30, 0), false);
  const lid = kit.group("chest-lid", root, V(0, -y / 2 + body, -z / 2));
  const lidParts: Box[] = [{ center: [0, (y - body) / 2, z / 2], size: [x + 0.02, y - body, z + 0.02], color: shade(wood, 1.15) }];
  for (const k of [-0.36, 0, 0.36]) lidParts.push({ center: [k * x, (y - body) / 2, z / 2], size: [0.06, y - body + 0.02, z + 0.04], color: iron });
  kit.meshEntity("chest-lid", kit.boxes(`chest-lid-${x.toFixed(2)}`, lidParts), kit.paintMaterial(0.35), lid);
  return { root, lid, hoard };
}

/** A tin paint pot, full to the brim with royal whitewash. */
export function buildBucket(kit: Kit, parent: pc.Entity, size: { x: number; y: number; z: number }, upsideDown = false): pc.Entity {
  const root = kit.group("paint-pot", parent);
  const tin = kit.material("bucket-tin", new pc.Color(0.5, 0.52, 0.53), 0.7, 0.6);
  const paint = kit.material("whitewash", new pc.Color(0.95, 0.95, 0.9), 0.5);
  const flip = upsideDown ? -1 : 1;
  kit.primitive("pail", "cylinder", root, V(), { x: size.x, y: size.y, z: size.z }, tin);
  kit.primitive("pail-rim", "cylinder", root, V(0, (flip * size.y) / 2, 0), { x: size.x * 1.08, y: 0.03, z: size.z * 1.08 }, tin, pc.Vec3.ZERO, false);
  kit.primitive("pail-paint", "cylinder", root, V(0, (flip * size.y) / 2 - flip * 0.03, 0), { x: size.x * 0.92, y: 0.02, z: size.z * 0.92 }, paint, pc.Vec3.ZERO, false);
  kit.primitive("pail-drip", "box", root, V(size.x * 0.46, (flip * size.y) / 2 - flip * 0.12, 0), { x: 0.03, y: 0.24, z: 0.08 }, paint, pc.Vec3.ZERO, false);
  const handle = kit.group("pail-handle", root, V(0, (flip * size.y) / 2, 0), V(90, 0, 0));
  kit.meshEntity("pail-handle", kit.torus(size.x * 0.5, 0.012, 16, 4, 180), kit.material("iron", palette.iron, 0.55, 0.68), handle, false);
  return root;
}

/** A canvas stage-weight: a fat sack of sand, tied at the neck. */
export function buildSandbag(kit: Kit, parent: pc.Entity, size: { x: number; y: number; z: number }): pc.Entity {
  const root = kit.group("sandbag", parent);
  const canvas = kit.material("sandbag-canvas", new pc.Color(0.62, 0.52, 0.36), 0.08);
  kit.primitive("sack", "sphere", root, V(0, -0.05, 0), { x: size.x * 1.05, y: size.y * 0.95, z: size.z * 1.05 }, canvas);
  kit.primitive("neck", "cone", root, V(0, size.y / 2 - 0.02, 0), { x: size.x * 0.5, y: 0.22, z: size.z * 0.5 }, canvas, pc.Vec3.ZERO, false);
  kit.primitive("tie", "cylinder", root, V(0, size.y / 2 - 0.06, 0), { x: size.x * 0.34, y: 0.05, z: size.z * 0.34 }, kit.material("rope", palette.rope, 0.12), pc.Vec3.ZERO, false);
  kit.primitive("stencil", "box", root, V(0, -0.05, size.z * 0.5), { x: size.x * 0.5, y: 0.1, z: 0.01 }, kit.material("ink", palette.ink, 0.42), pc.Vec3.ZERO, false);
  return root;
}

/** Immovable scenery in the playing area. */
export function buildFixture(kit: Kit, parent: pc.Entity, look: string, size: { x: number; y: number; z: number }): pc.Entity {
  const root = kit.group(`fixture-${look}`, parent);
  const { x, y, z } = size;
  const gold = kit.material("gold", palette.gold, 0.72, 0.55);
  if (look === "bumper") {
    const bronze = kit.material("bumper-bronze", new pc.Color(0.7, 0.45, 0.16), 0.85, 0.8);
    kit.primitive("plate", "box", root, V(), { x, y, z }, bronze);
    kit.primitive("rim-top", "box", root, V(0, y / 2, 0), { x: x + 0.08, y: 0.08, z: z + 0.06 }, gold);
    kit.primitive("rim-bottom", "box", root, V(0, -y / 2, 0), { x: x + 0.08, y: 0.08, z: z + 0.06 }, gold);
    kit.primitive("boss", "sphere", root, V(0, 0, z / 2), { x: 0.4, y: 0.4, z: 0.14 }, gold);
    kit.primitive("boss-back", "sphere", root, V(0, 0, -z / 2), { x: 0.4, y: 0.4, z: 0.14 }, gold);
    return root;
  }
  if (look === "column") {
    const iron = kit.material("column-iron", new pc.Color(0.13, 0.14, 0.15), 0.5, 0.7);
    kit.primitive("shaft", "cylinder", root, V(), { x: x * 0.7, y, z: z * 0.7 }, iron);
    for (const k of [-0.5, -0.2, 0.2, 0.5]) kit.primitive("band", "cylinder", root, V(0, k * y, 0), { x: x * 0.82, y: 0.08, z: z * 0.82 }, gold);
    kit.primitive("base", "cylinder", root, V(0, -y / 2 + 0.1, 0), { x: x * 1.2, y: 0.2, z: z * 1.2 }, iron);
    kit.primitive("capital", "cylinder", root, V(0, y / 2 - 0.08, 0), { x: x * 1.05, y: 0.16, z: z * 1.05 }, gold);
    return root;
  }
  if (look === "hedge") {
    const leaf = kit.material("hedge-leaf", new pc.Color(0.13, 0.3, 0.13), 0.08);
    const dark = kit.material("hedge-dark", new pc.Color(0.09, 0.22, 0.1), 0.08);
    kit.primitive("hedge", "box", root, V(0, -0.1, 0), { x, y: y - 0.2, z }, leaf);
    const tufts = Math.max(2, Math.round(x / 0.6));
    for (let index = 0; index < tufts; index += 1) {
      const tx = -x / 2 + (index + 0.5) * (x / tufts);
      kit.primitive("tuft", "sphere", root, V(tx, y / 2 - 0.15, 0), { x: x / tufts + 0.1, y: 0.5, z: z + 0.05 }, index % 2 ? dark : leaf);
    }
    return root;
  }
  if (look === "screen") {
    // A painted scenery flat: a castle wall on canvas, framed in timber.
    const canvas = kit.material("screen-canvas", new pc.Color(0.55, 0.5, 0.42), 0.05);
    const paint = kit.material("screen-stones", new pc.Color(0.42, 0.38, 0.32), 0.05);
    const frame = kit.material("oak-dark", palette.oakDark, 0.16);
    kit.primitive("canvas", "box", root, V(), { x, y, z }, canvas);
    for (let row = 0; row < 8; row += 1) {
      const sy = -y / 2 + 0.5 + row * (y / 8.4);
      kit.primitive("painted-course", "box", root, V(0, sy, z / 2 + 0.005), { x: x - 0.2, y: 0.04, z: 0.01 }, paint, pc.Vec3.ZERO, false);
    }
    for (const side of [-1, 1]) kit.primitive("brace", "box", root, V(side * (x / 2 - 0.05), 0, -z / 2 - 0.1), { x: 0.12, y, z: 0.12 }, frame);
    for (let index = 0; index < 5; index += 1) {
      kit.primitive("crenel", "box", root, V(-x / 2 + 0.55 + index * ((x - 1.1) / 4), y / 2 + 0.25, 0), { x: 0.55, y: 0.5, z }, canvas);
    }
    return root;
  }
  if (look === "fulcrum") {
    const stone = kit.material("stone-2", new pc.Color(0.43, 0.414, 0.366), 0.07);
    kit.primitive("trestle", "box", root, V(), { x, y, z }, stone);
    kit.primitive("cap", "box", root, V(0, y / 2 - 0.04, 0), { x: x + 0.1, y: 0.08, z: z + 0.1 }, kit.material("iron", palette.iron, 0.55, 0.68));
    return root;
  }
  if (look === "maypole" || look === "stump") return buildMaypole(kit, root, y, look === "maypole");
  if (look === "gong") return buildGong(kit, root, size);
  if (look === "bed") {
    // The Queen's four-poster, all springs: a fat mattress, a quilt and a gilt frame.
    const parts: Box[] = [
      { center: [0, -y / 2 + 0.16, 0], size: [x, 0.32, z], color: palette.oakDark },
      { center: [0, y / 2 - 0.2, 0], size: [x - 0.08, 0.4, z - 0.08], color: palette.cream },
      { center: [0, y / 2 - 0.02, 0.2], size: [x - 0.04, 0.06, z * 0.7], color: palette.king },
      { center: [0, y / 2 + 0.04, -z / 2 + 0.35], size: [x * 0.7, 0.14, 0.4], color: new pc.Color(0.95, 0.94, 0.9) },
    ];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) parts.push({ center: [sx * (x / 2 - 0.06), 0.9, sz * (z / 2 - 0.06)], size: [0.12, y + 1.8, 0.12], color: palette.oak });
      parts.push({ center: [sx * (x / 2 - 0.06), y / 2 + 1.72, 0], size: [0.1, 0.1, z], color: palette.gold });
      parts.push({ center: [0, y / 2 + 1.72, sx * (z / 2 - 0.06)], size: [x, 0.1, 0.1], color: palette.gold });
    }
    for (let coil = 0; coil < 6; coil += 1) parts.push({ center: [-x / 2 + 0.3 + coil * ((x - 0.6) / 5), -y / 2 + 0.36, z / 2 + 0.01], size: [0.12, 0.12, 0.02], color: new pc.Color(0.55, 0.56, 0.58) });
    kit.meshEntity("bed", kit.boxes(`bed-${x.toFixed(2)}x${z.toFixed(2)}`, parts), kit.paintMaterial(0.25), root);
    return root;
  }
  if (look === "windmachine") {
    // A slatted drum under a canvas sheet, turned by a crank: the theatre's gale.
    const oak = kit.material("oak-dark", palette.oakDark, 0.16);
    for (const side of [-1, 1]) kit.primitive("wind-frame", "box", root, V(side * (x / 2 - 0.05), -0.1, 0), { x: 0.1, y: y - 0.2, z: z * 0.8 }, oak);
    kit.primitive("wind-foot", "box", root, V(0, -y / 2 + 0.05, 0), { x: x, y: 0.1, z: z }, oak);
    const drum = kit.group("wind-drum", root, V(0, 0.15, 0));
    const slat = kit.material("oak-light", palette.oakLight, 0.2);
    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * 360;
      const arm = kit.group("slat-arm", drum, V(), V(angle, 0, 0));
      kit.primitive("slat", "box", arm, V(0, 0.42, 0), { x: x - 0.3, y: 0.05, z: 0.16 }, slat);
    }
    kit.primitive("wind-axle", "cylinder", drum, V(), { x: 0.08, y: x - 0.1, z: 0.08 }, kit.material("iron", palette.iron, 0.55, 0.68), V(0, 0, 90));
    kit.primitive("wind-canvas", "box", root, V(0, 0.62, -0.08), { x: x - 0.25, y: 0.04, z: z * 0.7 }, kit.material("sign-cream", palette.cream, 0.3), V(-12, 0, 0));
    kit.primitive("wind-crank", "box", root, V(x / 2 + 0.12, 0.15, 0.2), { x: 0.06, y: 0.06, z: 0.5 }, kit.material("iron", palette.iron, 0.55, 0.68));
    drum.name = "wind-drum";
    return root;
  }
  if (look === "trunk") {
    const bark = kit.material("bark", new pc.Color(0.24, 0.15, 0.08), 0.08);
    kit.primitive("trunk", "cylinder", root, V(), { x, y, z }, bark);
    const leaves = [new pc.Color(0.12, 0.26, 0.12), new pc.Color(0.16, 0.32, 0.14)];
    for (const [dx, dy, r, i] of [[0, 1.2, 3.2, 0], [-0.9, 0.5, 2.2, 1], [1.1, 0.7, 2.4, 1], [0.2, 2.1, 2.2, 0]] as const) {
      kit.primitive("leaves", "sphere", root, V(dx, y / 2 + dy - 0.6, 0), { x: r, y: r * 0.75, z: r * 0.7 }, kit.material(`tree-leaf-${i}`, leaves[i]!, 0.06));
    }
    return root;
  }
  if (look === "bough") {
    const bark = kit.material("bark", new pc.Color(0.24, 0.15, 0.08), 0.08);
    kit.primitive("bough", "cylinder", root, V(), { x: y, y: x, z: y }, bark, V(0, 0, 90));
    for (const [dx, r] of [[0.3, 1.1], [0.46, 0.9]] as const) {
      kit.primitive("bough-leaves", "sphere", root, V(dx * x, 0.3, 0.1), { x: r * 1.4, y: r, z: r }, kit.material("tree-leaf-1", new pc.Color(0.16, 0.32, 0.14), 0.06));
    }
    return root;
  }
  if (look === "ladder") {
    // A painter's stepladder, spattered with whitewash.
    const splash = new pc.Color(0.92, 0.92, 0.87);
    const wood = palette.oakLight;
    const parts: Box[] = [];
    for (const side of [-1, 1]) {
      parts.push({ center: [side * (x / 2 - 0.04), 0, z / 2 - 0.08], size: [0.07, y, 0.07], color: wood });
      parts.push({ center: [side * (x / 2 - 0.04), -0.05, -z / 2 + 0.08], size: [0.07, y - 0.1, 0.07], color: wood });
    }
    for (let rung = 1; rung <= 4; rung += 1) parts.push({ center: [0, -y / 2 + (rung * y) / 5, z / 2 - 0.08], size: [x - 0.08, 0.05, 0.1], color: wood });
    parts.push({ center: [0, y / 2 - 0.03, 0], size: [x, 0.06, z], color: wood });
    parts.push({ center: [0.08, y / 2 - 0.25, z / 2 - 0.02], size: [0.06, 0.4, 0.02], color: splash });
    parts.push({ center: [-0.15, -0.3, z / 2 - 0.02], size: [0.12, 0.08, 0.02], color: splash });
    kit.meshEntity("ladder", kit.boxes(`ladder-${x.toFixed(2)}x${y.toFixed(2)}`, parts), kit.paintMaterial(0.2), root);
    return root;
  }
  if (look === "railing") {
    const iron = kit.material("railing-iron", new pc.Color(0.09, 0.1, 0.1), 0.5, 0.6);
    const bars = Math.max(3, Math.round(x / 0.22));
    for (let index = 0; index <= bars; index += 1) {
      const bx = -x / 2 + (index * x) / bars;
      kit.primitive("rail-bar", "cylinder", root, V(bx, 0, 0), { x: 0.05, y, z: 0.05 }, iron, pc.Vec3.ZERO, index % 2 === 0);
      kit.primitive("rail-spike", "cone", root, V(bx, y / 2 + 0.08, 0), { x: 0.09, y: 0.16, z: 0.09 }, gold, pc.Vec3.ZERO, false);
    }
    for (const k of [-0.42, 0.3]) kit.primitive("rail-rail", "box", root, V(0, k * y, 0), { x: x + 0.06, y: 0.06, z: 0.06 }, iron);
    return root;
  }
  if (look === "drum") {
    kit.primitive("drum", "cylinder", root, V(), { x, y, z }, kit.material("drum-red", palette.king, 0.4));
    kit.primitive("skin", "cylinder", root, V(0, y / 2, 0), { x: x * 1.02, y: 0.04, z: z * 1.02 }, kit.material("drum-skin", palette.cream, 0.3));
    return root;
  }
  const timber = kit.material(look === "beam" ? "oak-dark" : "oak", look === "beam" ? palette.oakDark : palette.oak, 0.18);
  kit.primitive(look, "box", root, V(), { x, y, z }, timber);
  if (look === "beam") for (const k of [-0.4, 0, 0.4]) kit.primitive("bracket", "box", root, V(k * x, -y / 2 - 0.02, 0), { x: 0.12, y: 0.06, z: z + 0.04 }, gold);
  return root;
}

/** The Queen's music box: a painted disc on a brass collar, an arm and a velvet seat. */
export function buildTurntable(kit: Kit, parent: pc.Entity, radius: number, arm: number): { root: pc.Entity; key: pc.Entity } {
  const root = kit.group("turntable", parent);
  const gold = kit.material("gold", palette.gold, 0.72, 0.55);
  const lacquer = kit.material("music-box-lacquer", new pc.Color(0.05, 0.3, 0.22), 0.6);
  const cream = kit.material("music-box-cream", palette.cream, 0.4);
  kit.primitive("disc", "cylinder", root, V(0, -0.08, 0), { x: radius * 2, y: 0.16, z: radius * 2 }, lacquer);
  kit.primitive("disc-rim", "cylinder", root, V(0, -0.02, 0), { x: radius * 2 + 0.06, y: 0.05, z: radius * 2 + 0.06 }, gold);
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2;
    kit.primitive("pip", "sphere", root, V(Math.cos(angle) * radius * 0.75, 0.01, Math.sin(angle) * radius * 0.75), { x: 0.12, y: 0.06, z: 0.12 }, cream, pc.Vec3.ZERO, false);
  }
  kit.primitive("arm", "box", root, V(arm / 2, 0.06, 0), { x: arm, y: 0.12, z: 0.26 }, gold);
  kit.primitive("seat", "box", root, V(arm, 0.13, 0), { x: 0.92, y: 0.1, z: 0.92 }, kit.material("velvet-seat", palette.king, 0.3));
  kit.primitive("seat-rail", "box", root, V(arm + 0.43, 0.23, 0), { x: 0.06, y: 0.1, z: 0.92 }, gold, pc.Vec3.ZERO, false);
  for (const side of [-1, 1]) kit.primitive("seat-rail", "box", root, V(arm, 0.23, side * 0.43), { x: 0.92, y: 0.1, z: 0.06 }, gold, pc.Vec3.ZERO, false);
  kit.primitive("seat-tassel", "sphere", root, V(arm + 0.46, 0.1, 0.46), { x: 0.1, y: 0.1, z: 0.1 }, gold);
  kit.primitive("seat-tassel", "sphere", root, V(arm + 0.46, 0.1, -0.46), { x: 0.1, y: 0.1, z: 0.1 }, gold);
  kit.primitive("counterweight", "box", root, V(-arm * 0.55, 0.14, 0), { x: 0.6, y: 0.28, z: 0.6 }, kit.material("iron", palette.iron, 0.55, 0.68));
  kit.primitive("ballerina-post", "cylinder", root, V(0, 0.25, 0), { x: 0.08, y: 0.5, z: 0.08 }, gold);
  kit.primitive("finial", "sphere", root, V(0, 0.52, 0), { x: 0.22, y: 0.22, z: 0.22 }, gold);
  const key = kit.group("wind-up-key", root, V(-arm * 0.55, 0.5, 0));
  kit.primitive("key-stem", "cylinder", key, V(0, 0.1, 0), { x: 0.06, y: 0.25, z: 0.06 }, gold);
  kit.primitive("key-bow", "box", key, V(0, 0.28, 0), { x: 0.42, y: 0.18, z: 0.05 }, gold);
  return { root, key };
}

export interface RatRig {
  root: pc.Entity;
  body: pc.Entity;
  legs: pc.Entity[];
  tail: pc.Entity[];
  bag: pc.Entity;
  head: pc.Entity;
}

/** A giant medieval rat in a dented helmet, with a very long tail and no manners. */
export function buildRat(kit: Kit, parent: pc.Entity): RatRig {
  const root = kit.group("rat", parent);
  const body = kit.group("rat-body", root, V(0, 0, 0));
  const fur = kit.material("rat-fur", new pc.Color(0.34, 0.3, 0.27), 0.12);
  const belly = kit.material("rat-belly", new pc.Color(0.52, 0.47, 0.42), 0.1);
  const pink = kit.material("rat-pink", new pc.Color(0.86, 0.55, 0.55), 0.3);
  const eye = kit.material("rat-eye", new pc.Color(0.8, 0.05, 0.04), 0.9, 0, { emissive: new pc.Color(0.5, 0.02, 0.01) });
  const iron = kit.material("iron", palette.iron, 0.55, 0.68);
  kit.primitive("torso", "sphere", body, V(0, 0.42, -0.1), { x: 0.62, y: 0.55, z: 1.1 }, fur);
  kit.primitive("belly", "sphere", body, V(0, 0.34, -0.05), { x: 0.5, y: 0.4, z: 0.85 }, belly);
  const head = kit.group("rat-head", body, V(0, 0.5, 0.5));
  kit.primitive("skull", "sphere", head, V(), { x: 0.42, y: 0.38, z: 0.48 }, fur);
  kit.primitive("snout", "cone", head, V(0, -0.04, 0.3), { x: 0.22, y: 0.36, z: 0.2 }, fur, V(90, 0, 0));
  kit.primitive("nose", "sphere", head, V(0, -0.04, 0.48), { x: 0.09, y: 0.08, z: 0.08 }, pink);
  for (const side of [-1, 1]) {
    kit.primitive("ear", "sphere", head, V(side * 0.18, 0.24, -0.04), { x: 0.22, y: 0.24, z: 0.06 }, pink, V(0, side * 20, side * 20));
    kit.primitive("eye", "sphere", head, V(side * 0.12, 0.08, 0.2), { x: 0.07, y: 0.07, z: 0.05 }, eye, pc.Vec3.ZERO, false);
    for (const tilt of [-12, 6]) {
      kit.primitive("whisker", "box", head, V(side * 0.2, -0.04, 0.36), { x: 0.36, y: 0.01, z: 0.01 }, kit.material("ink", palette.ink, 0.42), V(0, side * 15, tilt), false);
    }
  }
  kit.primitive("tooth", "box", head, V(0, -0.14, 0.4), { x: 0.06, y: 0.07, z: 0.02 }, kit.material("rat-tooth", palette.cream, 0.5), pc.Vec3.ZERO, false);
  kit.primitive("helmet", "sphere", head, V(0, 0.16, -0.02), { x: 0.44, y: 0.24, z: 0.46 }, iron);
  kit.primitive("helmet-spike", "cone", head, V(0, 0.34, -0.02), { x: 0.07, y: 0.18, z: 0.07 }, iron, V(0, 0, 12));
  const legs: pc.Entity[] = [];
  for (const [x, z] of [[-0.2, 0.25], [0.2, 0.25], [-0.22, -0.4], [0.22, -0.4]] as const) {
    const leg = kit.group("leg", body, V(x, 0.3, z));
    kit.primitive("leg", "cylinder", leg, V(0, -0.14, 0), { x: 0.1, y: 0.3, z: 0.1 }, fur);
    kit.primitive("paw", "sphere", leg, V(0, -0.29, 0.04), { x: 0.13, y: 0.06, z: 0.16 }, pink);
    legs.push(leg);
  }
  const tail: pc.Entity[] = [];
  let joint = kit.group("tail-0", body, V(0, 0.36, -0.62));
  for (let index = 0; index < 5; index += 1) {
    kit.primitive("tail-seg", "cylinder", joint, V(0, 0, -0.14), { x: 0.07 - index * 0.01, y: 0.3, z: 0.07 - index * 0.01 }, pink, V(90, 0, 0));
    tail.push(joint);
    joint = kit.group(`tail-${index + 1}`, joint, V(0, 0, -0.28));
  }
  const bag = kit.group("stolen-powder", head, V(0, -0.2, 0.46));
  kit.primitive("bag", "sphere", bag, V(), { x: 0.26, y: 0.24, z: 0.24 }, kit.material("powder-bag", new pc.Color(0.6, 0.5, 0.32), 0.1));
  kit.primitive("bag-tie", "cylinder", bag, V(0, 0.12, 0), { x: 0.08, y: 0.06, z: 0.08 }, kit.material("powder-red", new pc.Color(0.72, 0.08, 0.04), 0.3));
  bag.enabled = false;
  return { root, body, legs, tail, bag, head };
}

export function buildKeg(kit: Kit, parent: pc.Entity, size: { x: number; y: number; z: number }): pc.Entity {
  const root = kit.group("keg", parent);
  const staves = kit.material("keg-staves", new pc.Color(0.36, 0.2, 0.08), 0.2);
  const iron = kit.material("iron", palette.iron, 0.55, 0.68);
  const red = kit.material("powder-red", new pc.Color(0.72, 0.08, 0.04), 0.3);
  const r = size.x / 2;
  const h = size.y;
  const profile: Array<[number, number]> = [];
  for (let index = 0; index <= 10; index += 1) {
    const t = index / 10;
    profile.push([r * (0.84 + 0.16 * Math.sin(t * Math.PI)), -h / 2 + t * h]);
  }
  kit.meshEntity("barrel", kit.lathe("keg-body", profile, 18, true), staves, root);
  kit.primitive("lid", "cylinder", root, V(0, h / 2 - 0.01, 0), { x: r * 1.66, y: 0.02, z: r * 1.66 }, kit.material("keg-lid", new pc.Color(0.44, 0.26, 0.1), 0.2));
  for (const y of [-h * 0.38, h * 0.38]) kit.meshEntity("hoop", kit.torus(r * 0.9, 0.022, 20, 5), iron, kit.group("hoop-ring", root, V(0, y, 0)));
  kit.meshEntity("band", kit.torus(r * 1.0, 0.05, 20, 5), red, kit.group("band-ring", root, V(0, 0, 0)));
  kit.primitive("fuse", "cylinder", root, V(0.1, h / 2 + 0.08, 0), { x: 0.03, y: 0.16, z: 0.03 }, kit.material("fuse", new pc.Color(0.88, 0.38, 0.055), 0.2), V(0, 0, -18));
  return root;
}

export function buildHay(kit: Kit, parent: pc.Entity, size: { x: number; y: number; z: number }, seed: string): pc.Entity {
  const root = kit.group("hay", parent);
  const variation = hashUnit(seed);
  const straw = kit.material(`straw-${Math.floor(variation * 3)}`, new pc.Color(0.8 + variation * 0.06, 0.64 + variation * 0.06, 0.29), 0.06);
  const dark = kit.material("straw-dark", palette.strawDark, 0.05);
  const twine = kit.material("twine", palette.rope, 0.1);
  kit.primitive("bale", "box", root, V(), { x: size.x * 0.97, y: size.y * 0.95, z: size.z * 0.95 }, straw);
  for (const x of [-size.x * 0.28, size.x * 0.28]) {
    kit.primitive("twine", "box", root, V(x, 0, 0), { x: 0.035, y: size.y * 0.97, z: size.z * 0.97 }, twine, pc.Vec3.ZERO, false);
  }
  for (let index = 0; index < 5; index += 1) {
    const angle = variation * 10 + index * 1.7;
    kit.primitive("tuft", "cone", root, V(Math.cos(angle) * size.x * 0.4, size.y * 0.48, Math.sin(angle) * size.z * 0.35), { x: 0.05, y: 0.16, z: 0.05 }, dark, V(Math.sin(angle) * 40, 0, Math.cos(angle) * 40), false);
  }
  return root;
}

// ------------------------------------------------------------------ Ordnance

export function buildProjectile(kit: Kit, parent: pc.Entity, kind: string, size: { x: number; y: number; z: number }): pc.Entity {
  const root = kit.group(kind, parent);
  const iron = kit.material("shot-iron", palette.iron, 0.62, 0.76);
  if (kind === "shell") {
    kit.primitive("shell", "sphere", root, V(), size, kit.material("mortar-shell", new pc.Color(0.18, 0.19, 0.17), 0.35, 0.54));
    kit.primitive("band", "cylinder", root, V(), { x: size.x * 1.07, y: 0.05, z: size.z * 1.07 }, iron);
    kit.primitive("fuse", "cylinder", root, V(0, size.y * 0.55, 0), { x: 0.035, y: 0.2, z: 0.035 }, kit.material("fuse", new pc.Color(0.88, 0.38, 0.055), 0.2));
    kit.primitive("spark", "sphere", root, V(0, size.y * 0.55 + 0.12, 0), { x: 0.1, y: 0.1, z: 0.1 }, kit.material("spark", palette.gold, 0.4, 0, { emissive: new pc.Color(1, 0.6, 0.1) }), pc.Vec3.ZERO, false);
    return root;
  }
  if (kind === "bomb") {
    const bomb = kit.material("bomb-iron", new pc.Color(0.06, 0.065, 0.07), 0.55, 0.5);
    kit.primitive("bomb", "sphere", root, V(), size, bomb);
    kit.primitive("cap", "cylinder", root, V(0, size.y * 0.48, 0), { x: size.x * 0.4, y: 0.1, z: size.x * 0.4 }, kit.material("bronze", palette.bronze, 0.46, 0.5));
    kit.primitive("fuse", "cylinder", root, V(0, size.y * 0.5 + 0.1, 0), { x: 0.035, y: 0.16, z: 0.035 }, kit.material("fuse", new pc.Color(0.88, 0.38, 0.055), 0.2));
    kit.primitive("fuse-spark", "sphere", root, V(0, size.y * 0.5 + 0.2, 0), { x: 0.12, y: 0.12, z: 0.12 }, kit.material("spark", palette.gold, 0.4, 0, { emissive: new pc.Color(1, 0.6, 0.1) }), pc.Vec3.ZERO, false);
    return root;
  }
  kit.primitive("ball", "sphere", root, V(), size, iron);
  if (kind === "shot") kit.primitive("casting-mark", "cylinder", root, V(0, size.y * 0.48, 0), { x: 0.08, y: 0.025, z: 0.08 }, kit.material("bronze", palette.bronze, 0.46, 0.5));
  return root;
}

/**
 * The charge sitting in a gun's mouth, so the player can see what is loaded: a ball, a chain
 * dangling from the muzzle, a bag of grape, a fused shell. Built facing -z at the muzzle.
 */
export function buildLoad(kit: Kit, parent: pc.Entity, kind: string): pc.Entity {
  const root = kit.group(`load-${kind}`, parent);
  const iron = kit.material("shot-iron", palette.iron, 0.62, 0.76);
  const spark = kit.material("spark", palette.gold, 0.4, 0, { emissive: new pc.Color(1, 0.6, 0.1) });
  if (kind === "chain") {
    kit.primitive("ball", "sphere", root, V(0, 0, 0.02), { x: 0.3, y: 0.3, z: 0.3 }, iron);
    const chain = kit.material("chain-iron", palette.iron, 0.5, 0.7);
    for (let link = 0; link < 5; link += 1) {
      kit.primitive("link", "box", root, V(0, -0.12 - link * 0.1, -0.08 - Math.sin(link * 0.7) * 0.06), { x: 0.05, y: 0.09, z: 0.05 }, chain, V(link % 2 ? 0 : 90, 0, 0), false);
    }
    kit.primitive("ball-dangling", "sphere", root, V(0, -0.72, -0.1), { x: 0.3, y: 0.3, z: 0.3 }, iron);
    return root;
  }
  if (kind === "grape") {
    kit.primitive("bag", "cylinder", root, V(0, 0, 0.05), { x: 0.34, y: 0.26, z: 0.34 }, kit.material("grape-bag", palette.cream, 0.2), V(90, 0, 0));
    for (const [x, y] of [[-0.08, 0.06], [0.08, 0.05], [0, -0.08]] as const) kit.primitive("grape", "sphere", root, V(x, y, -0.1), { x: 0.13, y: 0.13, z: 0.13 }, iron);
    kit.primitive("tie", "cylinder", root, V(0, 0, -0.03), { x: 0.36, y: 0.03, z: 0.36 }, kit.material("rope", palette.rope, 0.12), V(90, 0, 0), false);
    return root;
  }
  if (kind === "bomb") {
    kit.primitive("bomb", "sphere", root, V(), { x: 0.48, y: 0.48, z: 0.48 }, kit.material("bomb-iron", new pc.Color(0.06, 0.065, 0.07), 0.55, 0.5));
    kit.primitive("cap", "cylinder", root, V(0, 0, -0.24), { x: 0.2, y: 0.08, z: 0.2 }, kit.material("bronze", palette.bronze, 0.46, 0.5), V(90, 0, 0));
    kit.primitive("fuse", "cylinder", root, V(0, 0, -0.34), { x: 0.035, y: 0.16, z: 0.035 }, kit.material("fuse", new pc.Color(0.88, 0.38, 0.055), 0.2), V(90, 0, 0));
    kit.primitive("fuse-spark", "sphere", root, V(0, 0, -0.44), { x: 0.13, y: 0.13, z: 0.13 }, spark, pc.Vec3.ZERO, false);
    return root;
  }
  if (kind === "shell") {
    kit.primitive("shell", "sphere", root, V(), { x: 0.5, y: 0.5, z: 0.5 }, kit.material("mortar-shell", new pc.Color(0.18, 0.19, 0.17), 0.35, 0.54));
    kit.primitive("fuse", "cylinder", root, V(0, 0, -0.3), { x: 0.035, y: 0.16, z: 0.035 }, kit.material("fuse", new pc.Color(0.88, 0.38, 0.055), 0.2), V(90, 0, 0));
    kit.primitive("fuse-spark", "sphere", root, V(0, 0, -0.4), { x: 0.1, y: 0.1, z: 0.1 }, spark, pc.Vec3.ZERO, false);
    return root;
  }
  kit.primitive("ball", "sphere", root, V(), { x: 0.4, y: 0.4, z: 0.4 }, iron);
  return root;
}

export function buildCrown(kit: Kit, parent: pc.Entity): pc.Entity {
  const root = kit.group("fallen-crown", parent);
  const gold = kit.material("gold", palette.gold, 0.72, 0.55);
  kit.primitive("band", "cylinder", root, V(0, -0.05, 0), { x: 0.3, y: 0.09, z: 0.3 }, gold);
  for (let index = 0; index < 5; index += 1) {
    const angle = (index / 5) * Math.PI * 2;
    kit.primitive("point", "cone", root, V(Math.cos(angle) * 0.11, 0.06, Math.sin(angle) * 0.11), { x: 0.07, y: 0.2, z: 0.07 }, gold);
  }
  return root;
}

// ------------------------------------------------------------------ The Queen's battery

export interface GunRig {
  root: pc.Entity;
  yaw: pc.Entity;
  pitch: pc.Entity;
  recoil: pc.Entity;
  wheels: pc.Entity[];
}

export function buildCannon(kit: Kit, parent: pc.Entity): GunRig {
  const root = kit.group("demi-culverin", parent);
  const dark = kit.material("oak-dark", palette.oakDark, 0.16);
  const iron = kit.material("iron", palette.iron, 0.55, 0.68);
  const bronze = kit.material("bronze-barrel", palette.bronze, 0.66, 0.58);
  const green = kit.material("queen-green", new pc.Color(0.035, 0.49, 0.29), 0.22);
  const yaw = kit.group("yaw", root);
  kit.primitive("trail", "box", yaw, V(0, 0.28, 0.95), { x: 0.5, y: 0.22, z: 1.9 }, dark, V(-10, 0, 0));
  for (const x of [-0.3, 0.3]) kit.primitive("cheek", "box", yaw, V(x, 0.72, 0.05), { x: 0.1, y: 0.55, z: 0.9 }, dark);
  kit.primitive("axle", "cylinder", yaw, V(0, 0.55, 0), { x: 0.1, y: 1.3, z: 0.1 }, iron, V(0, 0, 90));
  const wheels: pc.Entity[] = [];
  for (const x of [-0.62, 0.62]) {
    const wheel = kit.group("wheel", yaw, V(x, 0.55, 0), V(0, 0, 90));
    kit.meshEntity("rim", kit.torus(0.5, 0.06, 22, 6), dark, wheel);
    for (let spoke = 0; spoke < 4; spoke += 1) kit.primitive("spoke", "box", wheel, V(), { x: 0.05, y: 0.05, z: 1 }, dark, V(0, spoke * 45, 0));
    kit.primitive("hub", "cylinder", wheel, V(), { x: 0.16, y: 0.16, z: 0.16 }, iron);
    wheels.push(wheel);
  }
  kit.primitive("queen-mark", "box", yaw, V(0.36, 0.72, 0.2), { x: 0.02, y: 0.3, z: 0.4 }, green, pc.Vec3.ZERO, false);
  const pitch = kit.group("pitch", yaw, V(0, 1.02, 0));
  const recoil = kit.group("recoil", pitch);
  kit.primitive("barrel", "cylinder", recoil, V(0, 0, -0.35), { x: 0.3, y: 2.3, z: 0.3 }, bronze, V(90, 0, 0));
  kit.primitive("muzzle", "cylinder", recoil, V(0, 0, -1.5), { x: 0.4, y: 0.2, z: 0.4 }, bronze, V(90, 0, 0));
  kit.primitive("reinforce", "cylinder", recoil, V(0, 0, 0.35), { x: 0.38, y: 0.3, z: 0.38 }, bronze, V(90, 0, 0));
  kit.primitive("breech", "sphere", recoil, V(0, 0, 0.8), { x: 0.42, y: 0.42, z: 0.42 }, bronze);
  kit.primitive("cascabel", "sphere", recoil, V(0, 0, 1.06), { x: 0.14, y: 0.14, z: 0.14 }, bronze);
  kit.primitive("trunnion", "cylinder", recoil, V(), { x: 0.12, y: 0.62, z: 0.12 }, iron, V(0, 0, 90));
  return { root, yaw, pitch, recoil, wheels };
}

export function buildMortar(kit: Kit, parent: pc.Entity): GunRig {
  const root = kit.group("bed-mortar", parent);
  const dark = kit.material("oak-dark", palette.oakDark, 0.16);
  const light = kit.material("oak-light", palette.oakLight, 0.16);
  const bronze = kit.material("bronze-barrel", palette.bronze, 0.66, 0.58);
  const iron = kit.material("iron", palette.iron, 0.55, 0.68);
  const yaw = kit.group("yaw", root);
  kit.primitive("bed", "box", yaw, V(0, 0.16, 0.1), { x: 1.1, y: 0.32, z: 1.4 }, dark);
  for (const x of [-0.46, 0.46]) kit.primitive("rail", "box", yaw, V(x, 0.42, 0.1), { x: 0.14, y: 0.3, z: 1.2 }, light);
  const pitch = kit.group("pitch", yaw, V(0, 0.78, 0));
  const recoil = kit.group("recoil", pitch);
  kit.primitive("barrel", "cylinder", recoil, V(0, 0, -0.18), { x: 0.5, y: 0.8, z: 0.5 }, bronze, V(90, 0, 0));
  kit.primitive("muzzle", "cylinder", recoil, V(0, 0, -0.55), { x: 0.62, y: 0.16, z: 0.62 }, bronze, V(90, 0, 0));
  kit.primitive("bore", "cylinder", recoil, V(0, 0, -0.64), { x: 0.34, y: 0.04, z: 0.34 }, iron, V(90, 0, 0));
  kit.primitive("chamber", "sphere", recoil, V(0, 0, 0.22), { x: 0.52, y: 0.52, z: 0.52 }, bronze);
  kit.primitive("trunnion", "cylinder", recoil, V(), { x: 0.13, y: 0.9, z: 0.13 }, iron, V(0, 0, 90));
  return { root, yaw, pitch, recoil, wheels: [] };
}
