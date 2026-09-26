import * as pc from "playcanvas";
import { EGG_BASE_T, eggRadius, eggY } from "../sim/egg.js";
import { axisAngle, troughFrame } from "../sim/geometry.js";
import { DRESSER, REVOLVE_HEIGHT, dresserChina, hopperBoards, type RevolveDef } from "../sim/level.js";
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
  /** Things he busies himself with between shots. */
  paper: pc.Entity;
  cup: pc.Entity;
  cloth: pc.Entity;
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
  // The Daily Yolk, held up in front of him; a teacup; a cloth for polishing the crown.
  const paper = kit.group("daily-yolk", body, V(0, 0.02, 0.66), V(-8, 0, 0));
  const newsprint = new pc.Color(0.93, 0.9, 0.82);
  const sheet: Box[] = [
    { center: [0, 0, 0], size: [0.78, 0.52, 0.02], color: newsprint },
    { center: [0, 0.2, 0.012], size: [0.62, 0.06, 0.01], color: palette.ink },
    { center: [-0.2, -0.02, 0.012], size: [0.3, 0.22, 0.01], color: new pc.Color(0.55, 0.52, 0.46) },
  ];
  for (let line = 0; line < 5; line += 1) sheet.push({ center: [0.18, 0.1 - line * 0.07, 0.012], size: [0.3, 0.018, 0.01], color: new pc.Color(0.45, 0.43, 0.4) });
  kit.meshEntity("newspaper", kit.boxes("daily-yolk", sheet), kit.paintMaterial(0.1), paper, false);
  paper.enabled = false;
  const cup = kit.group("teacup", arms[1]!, V(0.34, 0.07, 0.04));
  const china = kit.material("china", new pc.Color(0.96, 0.95, 0.92), 0.7);
  kit.primitive("cup", "cylinder", cup, V(0, 0.04, 0), { x: 0.1, y: 0.09, z: 0.1 }, china, pc.Vec3.ZERO, false);
  kit.primitive("tea", "cylinder", cup, V(0, 0.085, 0), { x: 0.085, y: 0.01, z: 0.085 }, kit.material("tea", new pc.Color(0.45, 0.25, 0.08), 0.8), pc.Vec3.ZERO, false);
  kit.primitive("saucer", "cylinder", cup, V(0, -0.01, 0), { x: 0.17, y: 0.015, z: 0.17 }, china, pc.Vec3.ZERO, false);
  cup.enabled = false;
  const cloth = kit.group("polishing-cloth", arms[0]!, V(-0.36, 0.02, 0));
  kit.primitive("cloth", "box", cloth, V(), { x: 0.12, y: 0.03, z: 0.14 }, kit.material("cloth-white", new pc.Color(0.95, 0.95, 0.95), 0.1), V(10, 20, 0), false);
  cloth.enabled = false;
  return { root, body, face, eyes, pupils, lids, brows, mouth, frown, mouthO, arms, legs, crown, paper, cup, cloth };
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
  if (material === "domino") {
    // An ivory domino with a black rule across the middle and pips on both faces.
    gloss = 0.45;
    const ivory = new pc.Color(0.93, 0.9, 0.82);
    const ink = new pc.Color(0.08, 0.07, 0.07);
    boxes.push({ center: [0, 0, 0], size: [x, y, z], color: ivory });
    const pip = Math.min(x, y) * 0.13;
    const counts = [1 + (tone % 3), 2 + ((tone + 1) % 4)];
    for (const face of [-1, 1]) {
      const zf = face * (z / 2 + 0.005);
      boxes.push({ center: [0, 0, zf], size: [x * 0.8, 0.03, 0.01], color: ink });
      for (const [half, count] of counts.entries()) {
        const cy = (half === 0 ? 1 : -1) * y * 0.25;
        const spots = [[0, 0], [-1, -1], [1, 1], [-1, 1], [1, -1], [-1, 0], [1, 0]].slice(count % 2 ? 0 : 1, (count % 2 ? 0 : 1) + count);
        for (const [dx, dy] of spots) boxes.push({ center: [dx! * x * 0.25, cy + dy! * y * 0.12, zf], size: [pip, pip, 0.01], color: ink });
      }
    }
    kit.meshEntity("domino", kit.boxes(`domino-${tone}-${x.toFixed(2)}x${y.toFixed(2)}x${z.toFixed(2)}`, boxes), kit.paintMaterial(gloss), root);
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

/**
 * Here we go round the mulberry bush: a hub with cut-out children on paddles, and the bush on top.
 * Built round the carousel's axis at the paddles' mid-height; the view turns it with the body.
 */
export function buildCarousel(kit: Kit, parent: pc.Entity, def: { inner: number; outer: number; height: number; paddles: number }): pc.Entity {
  const root = kit.group("carousel", parent);
  const gold = kit.material("gold", palette.gold, 0.72, 0.55);
  const oak = kit.material("oak", palette.oak, 0.18);
  const length = def.outer - def.inner;
  const reach = (def.inner + def.outer) / 2;
  const frocks = [palette.queen, palette.king, new pc.Color(0.25, 0.4, 0.7), new pc.Color(0.85, 0.55, 0.2), new pc.Color(0.5, 0.3, 0.6), new pc.Color(0.3, 0.55, 0.3)];
  kit.primitive("hub", "cylinder", root, V(0, def.height / 2 - 0.05, 0), { x: def.inner * 2 + 0.2, y: 0.14, z: def.inner * 2 + 0.2 }, gold);
  kit.primitive("hub-low", "cylinder", root, V(0, -def.height / 2 + 0.05, 0), { x: def.inner * 2 + 0.2, y: 0.1, z: def.inner * 2 + 0.2 }, gold);
  for (let index = 0; index < def.paddles; index += 1) {
    const turn = (index / def.paddles) * 360;
    const arm = kit.group("paddle", root, V(), V(0, turn, 0));
    const frock = frocks[index % frocks.length]!;
    // A painted board with a child on each face, arms out, holding hands round the bush.
    const parts: Box[] = [
      { center: [reach, 0, 0], size: [length, def.height, 0.1], color: palette.cream },
      { center: [reach, def.height / 2 - 0.05, 0], size: [length + 0.04, 0.1, 0.14], color: palette.oakDark },
      { center: [reach, -def.height / 2 + 0.05, 0], size: [length + 0.04, 0.1, 0.14], color: palette.oakDark },
      { center: [def.outer - 0.04, 0, 0], size: [0.08, def.height, 0.14], color: palette.oakDark },
    ];
    for (const side of [-1, 1]) {
      const z = side * 0.06;
      parts.push(
        { center: [reach, -0.2, z], size: [0.46, 0.7, 0.02], color: frock },
        { center: [reach, 0.3, z], size: [0.3, 0.32, 0.02], color: palette.skin },
        { center: [reach, 0.48, z], size: [0.36, 0.1, 0.02], color: index % 2 ? palette.oakDark : palette.gold },
        { center: [reach, 0.08, z], size: [length * 0.8, 0.07, 0.02], color: palette.skin },
        { center: [reach - 0.1, -0.68, z], size: [0.08, 0.26, 0.02], color: palette.ink },
        { center: [reach + 0.1, -0.68, z], size: [0.08, 0.26, 0.02], color: palette.ink },
      );
    }
    kit.meshEntity("paddle-board", kit.boxes(`carousel-paddle-${index % frocks.length}-${length.toFixed(2)}x${def.height.toFixed(2)}`, parts), kit.paintMaterial(0.2), arm);
    kit.primitive("paddle-rod", "cylinder", arm, V(reach, def.height / 2 + 0.02, 0), { x: 0.05, y: length, z: 0.05 }, oak, V(0, 0, 90), false);
  }
  // The mulberry bush itself, on top of the hub.
  const bush = kit.material("hedge-leaf", new pc.Color(0.13, 0.3, 0.13), 0.08);
  const berry = kit.material("mulberry", new pc.Color(0.3, 0.08, 0.25), 0.5);
  for (const [dx, dy, dz, r] of [[0, 0.35, 0, 0.55], [0.3, 0.2, 0.15, 0.4], [-0.28, 0.22, -0.1, 0.42], [0.05, 0.25, -0.3, 0.38], [-0.1, 0.62, 0.1, 0.36]] as const) {
    kit.primitive("bush", "sphere", root, V(dx, def.height / 2 + dy, dz), { x: r, y: r * 0.85, z: r }, bush);
  }
  for (let index = 0; index < 9; index += 1) {
    const a = index * 2.4;
    kit.primitive("berry", "sphere", root, V(Math.cos(a) * 0.36, def.height / 2 + 0.3 + (index % 3) * 0.14, Math.sin(a) * 0.36), { x: 0.09, y: 0.09, z: 0.09 }, berry, pc.Vec3.ZERO, false);
  }
  return root;
}

/** The chute: a plank trough down `path` on its trestles, and a hopper over the top end. */
export function buildChute(kit: Kit, parent: pc.Entity, path: ReadonlyArray<{ x: number; y: number; z: number }>, width: number, hopper = true): pc.Entity {
  const root = kit.group("chute", parent);
  const plank = kit.material("oak", palette.oak, 0.18);
  const dark = kit.material("oak-dark", palette.oakDark, 0.16);
  const half = width / 2;
  const place = (name: string, at: { x: number; y: number; z: number }, rotation: { x: number; y: number; z: number; w: number }, size: { x: number; y: number; z: number }, material: pc.StandardMaterial): void => {
    const entity = kit.primitive(name, "box", root, V(at.x, at.y, at.z), size, material);
    entity.setLocalRotation(rotation.x, rotation.y, rotation.z, rotation.w);
  };
  const offset = (a: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, k: number) => ({ x: a.x + d.x * k, y: a.y + d.y * k, z: a.z + d.z * k });
  for (let index = 0; index + 1 < path.length; index += 1) {
    const a = path[index]!;
    const b = path[index + 1]!;
    const frame = troughFrame(a, b);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
    const long = frame.length + 0.12;
    place("trough-floor", offset(mid, frame.up, -0.04), frame.rotation, { x: width, y: 0.08, z: long }, plank);
    for (const side of [-1, 1]) {
      place("trough-side", offset(offset(mid, frame.across, side * (half + 0.04)), frame.up, 0.16), frame.rotation, { x: 0.08, y: 0.4, z: long }, dark);
    }
  }
  // The hopper: low on the side facing the guns, a tall backstop behind.
  if (hopper) for (const board of hopperBoards(path, width)) place("hopper-board", board.center, board.rotation, board.size, plank);
  return root;
}

function quatMultiply(a: { x: number; y: number; z: number; w: number }, b: { x: number; y: number; z: number; w: number }): { x: number; y: number; z: number; w: number } {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

/** How far the stage lever leans either way, in degrees. */
export const LEVER_THROW = 16;

/** A ring of trapdoors in the boards; each leaf hangs from its outer edge. */
export function buildTrapRing(kit: Kit, parent: pc.Entity, inner: number, outer: number): { root: pc.Entity; leaves: pc.Entity[]; pit: pc.Entity } {
  const root = kit.group("trap-ring", parent);
  const count = 16;
  const mid = (inner + outer) / 2;
  const length = outer - inner;
  const width = (2 * Math.PI * mid) / count - 0.04;
  const plank = kit.material("trap-plank", shade(palette.floor, 1.12), 0.14);
  const seam = kit.material("floor-seam", palette.floorEdge, 0.08);
  const pit = kit.group("trap-pit", root);
  const dark = kit.material("trap-pit", new pc.Color(0.02, 0.018, 0.015), 0.02);
  const leaves: pc.Entity[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * 360;
    const spoke = kit.group("trap-spoke", root, V(), V(0, angle, 0));
    // Both sit just above the painted lawn (whose top is at 0.022).
    kit.primitive("trap-hole", "box", kit.group("trap-hole-spoke", pit, V(), V(0, angle, 0)), V(0, 0.026, mid), { x: width + 0.06, y: 0.008, z: length }, dark, pc.Vec3.ZERO, false);
    const hinge = kit.group("trap-hinge", spoke, V(0, 0.036, outer));
    kit.primitive("trap-leaf", "box", hinge, V(0, 0, -length / 2), { x: width, y: 0.024, z: length }, plank, pc.Vec3.ZERO, false);
    kit.primitive("trap-seam", "box", hinge, V(width / 2, 0.012, -length / 2), { x: 0.02, y: 0.01, z: length }, seam, pc.Vec3.ZERO, false);
    leaves.push(hinge);
  }
  // Shrunk away rather than disabled, so the ring can sit in a dynamic batch without rebuilds.
  pit.setLocalScale(0.001, 0.001, 0.001);
  return { root, leaves, pit };
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
  if (look === "vane") {
    // The Queen's weathercock: a polished bronze plate with a gilt cockerel on top.
    const bronze = kit.material("bumper-bronze", new pc.Color(0.7, 0.45, 0.16), 0.85, 0.8);
    kit.primitive("plate", "box", root, V(), { x, y, z }, bronze);
    for (const side of [-1, 1]) {
      kit.primitive("rim", "box", root, V(0, (side * y) / 2, 0), { x: x + 0.08, y: 0.08, z: z + 0.06 }, gold);
      kit.primitive("rim", "box", root, V((side * x) / 2, 0, 0), { x: 0.08, y: y + 0.08, z: z + 0.06 }, gold);
    }
    kit.primitive("spindle", "cylinder", root, V(0, -y / 2 - 0.1, 0), { x: 0.12, y: 0.2, z: 0.12 }, gold);
    const cock = kit.group("cockerel", root, V(0, y / 2 + 0.36, 0));
    kit.primitive("cock-body", "sphere", cock, V(), { x: 0.6, y: 0.42, z: 0.12 }, gold);
    kit.primitive("cock-tail", "cone", cock, V(-0.34, 0.16, 0), { x: 0.34, y: 0.5, z: 0.08 }, gold, V(0, 0, 38));
    kit.primitive("cock-head", "sphere", cock, V(0.28, 0.26, 0), { x: 0.2, y: 0.22, z: 0.1 }, gold);
    kit.primitive("cock-comb", "box", cock, V(0.28, 0.4, 0), { x: 0.16, y: 0.1, z: 0.04 }, kit.material("lever-red", palette.king, 0.4), pc.Vec3.ZERO, false);
    kit.primitive("cock-beak", "cone", cock, V(0.42, 0.26, 0), { x: 0.06, y: 0.12, z: 0.05 }, gold, V(0, 0, -90), false);
    for (const dx of [-0.08, 0.08]) kit.primitive("cock-leg", "box", cock, V(dx, -0.26, 0), { x: 0.04, y: 0.16, z: 0.04 }, gold, pc.Vec3.ZERO, false);
    return root;
  }
  if (look === "pier" || look === "lintel") {
    // Dressed stone in courses, with a line of merlons along the top of the gatehouse.
    const parts: Box[] = [];
    const course = 0.45;
    for (let row = 0; row * course < y - 0.01; row += 1) {
      const h = Math.min(course, y - row * course);
      const tone = row % 2 ? palette.stone : palette.stoneAlt;
      parts.push({ center: [0, -y / 2 + row * course + h / 2, 0], size: [x, h - 0.03, z], color: tone });
      parts.push({ center: [0, -y / 2 + row * course + h - 0.015, 0], size: [x - 0.02, 0.03, z - 0.02], color: palette.mortar });
    }
    if (look === "lintel") {
      parts.push({ center: [0, 0, z / 2 + 0.01], size: [0.5, y - 0.1, 0.04], color: palette.stoneAlt });
      for (let index = 0; index < Math.floor(x / 0.8); index += 1) {
        parts.push({ center: [-x / 2 + 0.3 + index * 0.8, y / 2 + 0.2, 0], size: [0.45, 0.4, z], color: palette.stone });
      }
    }
    kit.meshEntity(look, kit.boxes(`${look}-${x.toFixed(2)}x${y.toFixed(2)}`, parts), kit.paintMaterial(0.06), root);
    return root;
  }
  if (look === "portcullis") {
    // An iron grille with spiked feet. It rises bodily; the view doesn't need to know how.
    const parts: Box[] = [];
    const iron = palette.iron;
    const bars = Math.max(3, Math.round(x / 0.32));
    for (let index = 0; index <= bars; index += 1) parts.push({ center: [-x / 2 + (index * x) / bars, 0, 0], size: [0.07, y, 0.07], color: iron });
    for (const k of [-0.35, 0, 0.35]) parts.push({ center: [0, k * y, 0], size: [x, 0.08, 0.09], color: iron });
    kit.meshEntity("grille", kit.boxes(`portcullis-${x.toFixed(2)}x${y.toFixed(2)}`, parts), kit.material("iron", palette.iron, 0.55, 0.68), root);
    for (let index = 0; index <= bars; index += 1) {
      kit.primitive("spike", "cone", root, V(-x / 2 + (index * x) / bars, -y / 2 - 0.1, 0), { x: 0.1, y: 0.2, z: 0.1 }, kit.material("iron", palette.iron, 0.55, 0.68), V(180, 0, 0), false);
    }
    return root;
  }
  if (look === "chock") {
    // A stout red-painted stop-board holding the barrel, with a rope handle to haul it out by.
    const parts: Box[] = [
      { center: [0, 0, 0], size: [x, y, z], color: palette.king },
      { center: [0, y / 2 - 0.04, 0], size: [x + 0.04, 0.08, z + 0.04], color: palette.gold },
      { center: [0, -y * 0.1, z / 2 + 0.01], size: [x * 0.6, 0.06, 0.02], color: palette.cream },
    ];
    kit.meshEntity("chock", kit.boxes(`chock-${x.toFixed(2)}x${y.toFixed(2)}`, parts), kit.paintMaterial(0.3), root);
    kit.primitive("chock-handle", "cylinder", root, V(0, y / 2 + 0.12, 0), { x: 0.3, y: 0.04, z: 0.3 }, kit.material("rope", palette.rope, 0.12), V(90, 0, 0), false);
    return root;
  }
  if (look === "dresser") return buildDresser(kit, root);
  if (look === "capstan") {
    // The stagehands' capstan: a crimson drum on a heavy foot, and a spoked brass head that spins.
    const oak = kit.material("oak-dark", palette.oakDark, 0.16);
    const drum = kit.material("capstan-red", palette.king, 0.3);
    const brass = kit.material("gold", palette.gold, 0.72, 0.55);
    kit.primitive("capstan-foot", "box", root, V(0, -y / 2 + 0.08, 0), { x: x * 0.95, y: 0.16, z: z * 0.95 }, oak);
    kit.primitive("capstan-drum", "cylinder", root, V(0, -0.1, 0), { x: 0.62, y: y * 0.62, z: 0.62 }, drum);
    for (const k of [-0.32, 0.12]) kit.primitive("capstan-hoop", "cylinder", root, V(0, k, 0), { x: 0.66, y: 0.06, z: 0.66 }, brass, pc.Vec3.ZERO, false);
    const head = kit.group("capstan-head", root, V(0, y / 2 - 0.2, 0));
    kit.primitive("capstan-cap", "cylinder", head, V(), { x: 0.5, y: 0.14, z: 0.5 }, brass);
    for (let index = 0; index < 6; index += 1) {
      const arm = kit.group("capstan-arm", head, V(), V(0, index * 60, 0));
      kit.primitive("capstan-bar", "box", arm, V(0.38, 0, 0), { x: 0.5, y: 0.07, z: 0.07 }, oak);
      kit.primitive("capstan-grip", "sphere", arm, V(0.62, 0, 0), { x: 0.1, y: 0.1, z: 0.1 }, brass, pc.Vec3.ZERO, false);
    }
    return root;
  }
  if (look === "hive") {
    // A straw skep on a short rope from the bough: coiled straw, a dark little door at the foot.
    const straw = kit.material("straw", palette.straw, 0.12);
    const coil = kit.material("straw-dark", palette.strawDark, 0.1);
    const skep = kit.group("skep", root, V(0, y / 2 - 0.02, 0));
    const profile: Array<[number, number]> = [[0.33, -0.78], [0.35, -0.64], [0.34, -0.48], [0.31, -0.32], [0.25, -0.18], [0.17, -0.08], [0.07, -0.02], [0, 0]];
    kit.meshEntity("skep-dome", kit.lathe("skep", profile, 20, true), straw, skep);
    for (const [ring, r] of [[-0.7, 0.35], [-0.55, 0.345], [-0.4, 0.33], [-0.26, 0.285], [-0.13, 0.21]] as const) {
      const band = kit.meshEntity("skep-coil", kit.torus(r, 0.022, 20, 6), coil, skep);
      band.setLocalPosition(0, ring, 0);
    }
    kit.primitive("skep-door", "box", skep, V(0, -0.72, 0.31), { x: 0.14, y: 0.08, z: 0.06 }, kit.material("ink", palette.ink, 0.42), pc.Vec3.ZERO, false);
    kit.primitive("skep-rope", "cylinder", root, V(0, y / 2 + 0.2, 0), { x: 0.035, y: 0.44, z: 0.035 }, kit.material("rope", palette.rope, 0.12), pc.Vec3.ZERO, false);
    return root;
  }
  if (look === "counterweight") {
    // A great iron weight on a chain from a pulley on the gatehouse: strike it and the gate rises.
    const iron = kit.material("iron", palette.iron, 0.55, 0.68);
    const weight = kit.group("counterweight-body", root);
    kit.primitive("weight", "cylinder", weight, V(0, -0.05, 0), { x, y: y * 0.8, z }, iron);
    kit.primitive("weight-band", "cylinder", weight, V(0, y * 0.2, 0), { x: x + 0.04, y: 0.08, z: z + 0.04 }, gold);
    kit.primitive("weight-ring", "cylinder", weight, V(0, y / 2 + 0.08, 0), { x: 0.24, y: 0.05, z: 0.24 }, iron, V(90, 0, 0), false);
    kit.primitive("weight-mark", "box", weight, V(0, -0.05, z / 2 + 0.01), { x: 0.32, y: 0.1, z: 0.02 }, kit.material("cream", palette.cream, 0.3), pc.Vec3.ZERO, false);
    kit.primitive("chain", "box", root, V(0, y / 2 + 1.2, 0), { x: 0.05, y: 2.4, z: 0.05 }, iron, pc.Vec3.ZERO, false);
    kit.primitive("pulley", "cylinder", root, V(0, y / 2 + 2.45, 0), { x: 0.5, y: 0.1, z: 0.5 }, gold, V(90, 0, 0));
    return root;
  }
  if (look === "lever") {
    // The stage manager's lever: a post, a quadrant and a long iron handle with a red grip.
    const oak = kit.material("oak-dark", palette.oakDark, 0.16);
    const iron = kit.material("iron", palette.iron, 0.55, 0.68);
    kit.primitive("lever-post", "box", root, V(0, -0.2, 0), { x: 0.3, y: y - 0.4, z: 0.3 }, oak);
    kit.primitive("lever-foot", "box", root, V(0, -y / 2 + 0.06, 0), { x: 0.6, y: 0.12, z: 0.5 }, oak);
    kit.primitive("lever-quadrant", "cylinder", root, V(0, y / 2 - 0.75, 0.16), { x: 0.5, y: 0.05, z: 0.5 }, iron, V(90, 0, 0));
    // Short enough, and thrown through a small enough arc, that the red grip stays inside the
    // fixture's collider: a shot at the knob must strike the lever.
    const arm = kit.group("lever-arm", root, V(0, y / 2 - 0.75, 0.2));
    kit.primitive("lever-handle", "cylinder", arm, V(0, 0.32, 0), { x: 0.06, y: 0.64, z: 0.06 }, iron);
    kit.primitive("lever-grip", "sphere", arm, V(0, 0.66, 0), { x: 0.16, y: 0.16, z: 0.16 }, kit.material("lever-red", palette.king, 0.4));
    arm.setLocalEulerAngles(0, 0, LEVER_THROW);
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
/**
 * The King's dresser: a crimson-panelled cupboard with a verdigris plate rack, and on it his
 * best blue-and-white china. Each piece is its own group (named "china-N", in `dresserChina`
 * order) so the view can shrink a smashed one away without rebuilding the batch.
 */
function buildDresser(kit: Kit, root: pc.Entity): pc.Entity {
  const { width, height, base, depth, rack, shelves } = DRESSER;
  const back = -depth / 2;
  const parts: Box[] = [
    { center: [0, 0.06, 0], size: [width, 0.12, depth - 0.04], color: palette.oakDark },
    { center: [0, base / 2 + 0.03, 0], size: [width - 0.04, base - 0.18, depth - 0.02], color: palette.oak },
    { center: [0, base - 0.03, 0.02], size: [width + 0.06, 0.06, depth + 0.04], color: palette.oakLight },
    { center: [0, (base + height) / 2, back + 0.03], size: [width - 0.1, height - base, 0.04], color: palette.queen },
    { center: [0, height - 0.06, back + rack / 2], size: [width + 0.1, 0.12, rack + 0.06], color: palette.oakDark },
    { center: [0, height - 0.13, back + rack + 0.04], size: [width + 0.1, 0.03, 0.02], color: palette.gold },
    // A little gilt crown on the cornice: this is the King's.
    { center: [0, height + 0.05, back + rack / 2], size: [0.3, 0.1, 0.1], color: palette.gold },
  ];
  for (const k of [-1, 0, 1]) parts.push({ center: [k * 0.11, height + 0.14, back + rack / 2], size: [0.05, 0.1, 0.05], color: palette.gold });
  for (const side of [-1, 1]) {
    parts.push({ center: [side * (width / 2 - 0.03), (base + height) / 2, back + rack / 2], size: [0.06, height - base, rack], color: palette.oak });
    // Two crimson doors with gilt knobs.
    parts.push({ center: [side * width * 0.25, base / 2 + 0.03, depth / 2 + 0.005], size: [width * 0.42, base - 0.3, 0.02], color: palette.king });
    parts.push({ center: [side * 0.12, base / 2 + 0.03, depth / 2 + 0.03], size: [0.06, 0.06, 0.05], color: palette.gold });
  }
  for (const y of shelves) {
    parts.push({ center: [0, y, back + rack / 2], size: [width - 0.1, 0.04, rack], color: palette.oakLight });
    // A rail across the plates' feet stops them sliding off.
    parts.push({ center: [0, y + 0.1, back + rack - 0.04], size: [width - 0.1, 0.025, 0.025], color: palette.gold });
  }
  kit.meshEntity("dresser", kit.boxes("dresser", parts), kit.paintMaterial(0.3), root);
  const white = kit.material("china-white", new pc.Color(0.95, 0.94, 0.9), 0.85);
  const blue = kit.material("china-blue", new pc.Color(0.13, 0.24, 0.62), 0.85);
  const china = kit.group("china", root);
  for (const [index, piece] of dresserChina().entries()) {
    const group = kit.group(`china-${index}`, china, V(piece.local.x, piece.local.y, piece.local.z));
    if (piece.kind === "plate") {
      // Stood on edge, leaning back a touch against the rack.
      const face = kit.group("plate", group, V(), V(82, 0, 0));
      kit.primitive("plate-rim", "cylinder", face, V(), { x: 0.36, y: 0.03, z: 0.36 }, white);
      kit.primitive("plate-band", "cylinder", face, V(0, 0.01, 0), { x: 0.27, y: 0.03, z: 0.27 }, blue, pc.Vec3.ZERO, false);
      kit.primitive("plate-well", "cylinder", face, V(0, 0.02, 0), { x: 0.19, y: 0.03, z: 0.19 }, white, pc.Vec3.ZERO, false);
      kit.primitive("plate-motif", "box", face, V(0, 0.03, 0), { x: 0.07, y: 0.02, z: 0.07 }, blue, V(0, 45, 0), false);
    } else if (piece.kind === "teapot") {
      kit.primitive("pot", "sphere", group, V(0, -0.02, 0), { x: 0.28, y: 0.24, z: 0.28 }, white);
      kit.primitive("pot-band", "cylinder", group, V(0, -0.02, 0), { x: 0.285, y: 0.05, z: 0.285 }, blue, pc.Vec3.ZERO, false);
      kit.primitive("pot-lid", "sphere", group, V(0, 0.11, 0), { x: 0.14, y: 0.06, z: 0.14 }, white, pc.Vec3.ZERO, false);
      kit.primitive("pot-knob", "sphere", group, V(0, 0.15, 0), { x: 0.05, y: 0.05, z: 0.05 }, blue, pc.Vec3.ZERO, false);
      kit.primitive("pot-spout", "cone", group, V(0.17, 0.02, 0), { x: 0.06, y: 0.16, z: 0.06 }, white, V(0, 0, -55), false);
      kit.primitive("pot-handle", "box", group, V(-0.16, 0, 0), { x: 0.03, y: 0.14, z: 0.03 }, white, pc.Vec3.ZERO, false);
    } else {
      kit.primitive("cup", "cylinder", group, V(), { x: 0.12, y: 0.12, z: 0.12 }, white);
      kit.primitive("cup-band", "cylinder", group, V(0, 0.03, 0), { x: 0.125, y: 0.025, z: 0.125 }, blue, pc.Vec3.ZERO, false);
      kit.primitive("cup-handle", "box", group, V(0.075, 0, 0), { x: 0.03, y: 0.07, z: 0.02 }, white, pc.Vec3.ZERO, false);
    }
  }
  return root;
}

/** The revolve's ring of floorboards: planks in two tones, a gilt inlay and a dark rim, all one mesh. */
export function buildRevolve(kit: Kit, parent: pc.Entity, def: RevolveDef): pc.Entity {
  const root = kit.group("fixture-revolve", parent);
  const inlay = def.outer - 0.34;
  const rim = def.outer - 0.2;
  const mesh = kit.ring(`revolve-${def.inner}-${def.outer}`, def.inner, def.outer, REVOLVE_HEIGHT, 32, [inlay, rim], (sector, band) =>
    band === 1 ? palette.gold : band === 2 ? palette.oakDark : sector % 2 ? palette.oak : palette.oakLight,
  );
  kit.meshEntity("revolve", mesh, kit.paintMaterial(0.22), root);
  return root;
}

/** A banana skin, three limp strips splayed from the stalk end, their tips curled up off the boards. */
export function buildPeel(kit: Kit, parent: pc.Entity, size: { x: number; y: number; z: number }): pc.Entity {
  const root = kit.group("peel", parent);
  const yellow = new pc.Color(0.95, 0.8, 0.2);
  const ripe = new pc.Color(0.85, 0.64, 0.14);
  const brown = new pc.Color(0.32, 0.2, 0.07);
  const k = size.x / 0.8;
  const low = -size.y / 2;
  const parts: Box[] = [
    // The stalk end, a stubby hump with a brown nub.
    { center: [-0.24 * k, low + 0.05 * k, 0], size: [0.3 * k, 0.1 * k, 0.16 * k], color: yellow },
    { center: [-0.4 * k, low + 0.06 * k, 0], size: [0.06 * k, 0.07 * k, 0.07 * k], color: brown },
  ];
  // Three strips fanned out from it, each a flat run and a turned-up tip with a brown end.
  for (const [angle, tone] of [[-0.5, ripe], [0, yellow], [0.5, ripe]] as const) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    parts.push({ center: [c * 0.08 * k, low + 0.02 * k, s * 0.14 * k], size: [0.34 * k, 0.04 * k, 0.12 * k], color: tone });
    parts.push({ center: [c * 0.27 * k, low + 0.06 * k, s * 0.24 * k], size: [0.08 * k, 0.1 * k, 0.12 * k], color: tone });
    parts.push({ center: [c * 0.31 * k, low + 0.11 * k, s * 0.27 * k], size: [0.05 * k, 0.03 * k, 0.09 * k], color: brown });
  }
  kit.meshEntity("peel-body", kit.boxes(`peel-${size.x.toFixed(2)}`, parts), kit.paintMaterial(0.35), root);
  return root;
}

/** A mousetrap: an oak board, a spring bail pulled back on its hinge, and a wedge of cheese. */
export function buildMousetrap(kit: Kit, parent: pc.Entity, size: { x: number; y: number; z: number }): { root: pc.Entity; bail: pc.Entity; cheese: pc.Entity } {
  const root = kit.group("mousetrap", parent);
  const low = -size.y / 2;
  kit.meshEntity("trap-board", kit.boxes("mousetrap-board", [
    { center: [0, low + 0.025, 0], size: [size.x, 0.05, size.z], color: palette.oakLight },
    { center: [0, low + 0.055, 0], size: [0.06, 0.012, size.z - 0.04], color: palette.iron },
    { center: [0.16, low + 0.056, 0], size: [0.12, 0.012, 0.1], color: palette.bronze },
    { center: [-0.24, low + 0.07, 0], size: [0.04, 0.04, 0.04], color: palette.iron },
  ]), kit.paintMaterial(0.3), root);
  const bail = kit.group("trap-bail", root, V(0, low + 0.06, 0));
  kit.meshEntity("trap-bail-wire", kit.boxes("mousetrap-bail", [
    { center: [0.13, 0, -size.z / 2 + 0.04], size: [0.26, 0.02, 0.02], color: palette.iron },
    { center: [0.13, 0, size.z / 2 - 0.04], size: [0.26, 0.02, 0.02], color: palette.iron },
    { center: [0.26, 0, 0], size: [0.02, 0.02, size.z - 0.06], color: palette.iron },
  ]), kit.paintMaterial(0.5), bail);
  const cheese = kit.group("trap-cheese", root, V(0.16, low + 0.1, 0));
  kit.meshEntity("trap-cheese-wedge", kit.boxes("mousetrap-cheese", [
    { center: [0, 0, 0], size: [0.12, 0.07, 0.09], color: new pc.Color(0.98, 0.8, 0.25) },
    { center: [0.02, 0.036, 0.02], size: [0.025, 0.004, 0.025], color: new pc.Color(0.85, 0.62, 0.15) },
  ]), kit.paintMaterial(0.35), cheese);
  return { root, bail, cheese };
}

/** A cloud of bees, baked into one mesh: the view spins and shakes it about the swarm's centre. */
export function buildSwarm(kit: Kit, parent: pc.Entity): pc.Entity {
  const root = kit.group("swarm", parent);
  const gold = new pc.Color(0.95, 0.72, 0.1);
  // Cartoon bees, big enough to read from the stalls: gold bodies, a black stripe, pale wings.
  const wing = new pc.Color(0.9, 0.92, 0.95);
  for (const [layer, count, spread] of [[0, 26, 0.75], [1, 20, 1.15]] as const) {
    const parts: Box[] = [];
    for (let index = 0; index < count; index += 1) {
      // A scatter that doesn't line up (a string hash of near-identical keys falls into streaks).
      const h = (k: number): number => {
        const v = Math.sin(index * 12.9898 + k * 78.233 + layer * 37.719) * 43758.5453;
        return v - Math.floor(v) - 0.5;
      };
      const at: [number, number, number] = [h(0) * spread * 2, h(1) * spread * 1.4, h(2) * spread * 2];
      parts.push({ center: at, size: [0.13, 0.09, 0.09], color: gold });
      parts.push({ center: [at[0] + 0.02, at[1], at[2]], size: [0.035, 0.095, 0.095], color: palette.ink });
      parts.push({ center: [at[0], at[1] + 0.07, at[2]], size: [0.07, 0.02, 0.12], color: wing });
    }
    kit.meshEntity(`swarm-${layer}`, kit.boxes(`swarm-${layer}`, parts), kit.paintMaterial(0.4), root, false);
  }
  return root;
}

/** The dish that ran away with the spoon: a plate on little legs, hand in hand with a silver spoon. */
export function buildRunaways(kit: Kit, parent: pc.Entity): { root: pc.Entity; legs: pc.Entity[] } {
  const root = kit.group("runaways", parent);
  const white = kit.material("china-white", new pc.Color(0.95, 0.94, 0.9), 0.85);
  const blue = kit.material("china-blue", new pc.Color(0.13, 0.24, 0.62), 0.85);
  const silver = kit.material("spoon-silver", new pc.Color(0.78, 0.8, 0.82), 0.9, 0.9);
  const ink = kit.material("ink", palette.ink, 0.2);
  const legs: pc.Entity[] = [];
  const dish = kit.group("dish", root, V(-0.26, 0.5, 0));
  const face = kit.group("dish-face", dish, V(), V(90, 0, 0));
  kit.primitive("dish-rim", "cylinder", face, V(), { x: 0.5, y: 0.04, z: 0.5 }, white);
  kit.primitive("dish-band", "cylinder", face, V(0, 0.01, 0), { x: 0.38, y: 0.04, z: 0.38 }, blue, pc.Vec3.ZERO, false);
  kit.primitive("dish-well", "cylinder", face, V(0, 0.02, 0), { x: 0.28, y: 0.04, z: 0.28 }, white, pc.Vec3.ZERO, false);
  for (const dx of [-0.07, 0.07]) kit.primitive("dish-eye", "sphere", dish, V(dx, 0.05, 0.04), { x: 0.05, y: 0.07, z: 0.03 }, ink, pc.Vec3.ZERO, false);
  kit.primitive("dish-grin", "box", dish, V(0, -0.07, 0.04), { x: 0.08, y: 0.02, z: 0.02 }, ink, pc.Vec3.ZERO, false);
  for (const side of [-1, 1]) kit.primitive("dish-grin", "box", dish, V(side * 0.055, -0.055, 0.04), { x: 0.05, y: 0.02, z: 0.02 }, ink, V(0, 0, side * 40), false);
  const spoon = kit.group("spoon", root, V(0.26, 0.5, 0));
  kit.primitive("spoon-bowl", "sphere", spoon, V(0, 0.18, 0), { x: 0.16, y: 0.24, z: 0.06 }, silver);
  kit.primitive("spoon-handle", "box", spoon, V(0, -0.08, 0), { x: 0.05, y: 0.34, z: 0.03 }, silver, pc.Vec3.ZERO, false);
  for (const dx of [-0.03, 0.03]) kit.primitive("spoon-eye", "sphere", spoon, V(dx, 0.2, 0.035), { x: 0.03, y: 0.04, z: 0.02 }, ink, pc.Vec3.ZERO, false);
  // Hand in hand.
  kit.primitive("hands", "box", root, V(0, 0.5, 0), { x: 0.3, y: 0.025, z: 0.025 }, ink, pc.Vec3.ZERO, false);
  for (const [who, x] of [["dish", -0.26], ["spoon", 0.26]] as const) {
    for (const dx of [-0.06, 0.06]) {
      const hip = kit.group(`${who}-hip`, root, V(x + dx, 0.26, 0));
      kit.primitive("leg", "box", hip, V(0, -0.12, 0), { x: 0.025, y: 0.24, z: 0.025 }, ink, pc.Vec3.ZERO, false);
      kit.primitive("shoe", "box", hip, V(0, -0.24, 0.03), { x: 0.06, y: 0.03, z: 0.09 }, ink, pc.Vec3.ZERO, false);
      legs.push(hip);
    }
  }
  return { root, legs };
}

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
