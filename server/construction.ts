import type {
  ComponentType,
  ConnectionType,
  MachinePart,
  WorkOperation,
} from "../shared/protocol.js";

export type BlueprintId =
  | "skid"
  | "cart"
  | "lever"
  | "screw_jack"
  | "mast"
  | "brace"
  | "ladder"
  | "winch"
  | "pulley"
  | "sling"
  | "spring_trap"
  | "barricade";

export interface ComponentPose {
  x: number;
  y: number;
  angle: number;
  z?: number;
}

export interface ComponentPlan {
  id: string;
  label: string;
  componentType: ComponentType;
  material: string;
  width?: number;
  height?: number;
  radius?: number;
  source: ComponentPose;
  staging: ComponentPose;
  final: ComponentPose;
  operations: WorkOperation[];
  connection?: ConnectionType;
}

export type MechanismPrimitive =
  | "frame"
  | "inclined_plane"
  | "wheel_and_axle"
  | "lever"
  | "screw"
  | "pulley"
  | "wedge"
  | "spring"
  | "ratchet"
  | "drum"
  | "counterweight"
  | "flexible_connector";

export type MechanismCapability =
  | "support"
  | "guide"
  | "transport"
  | "multiply_force"
  | "convert_motion"
  | "redirect_force"
  | "store_energy"
  | "hold_load"
  | "release_energy"
  | "control_motion"
  | "interface_load";

export type CommissioningTest =
  | "square_frame"
  | "spin_free"
  | "proof_load"
  | "hold_position"
  | "dry_cycle"
  | "reeve_line"
  | "fit_load";

export interface MechanismStage {
  id: string;
  label: string;
  primitive: MechanismPrimitive;
  capability: MechanismCapability;
  input: string;
  output: string;
  requires: string[];
  dependsOn: string[];
  commissioning: CommissioningTest;
  testDuration: number;
  mechanicalAdvantage: number;
  efficiency: number;
}

export interface BlueprintPlan {
  id: BlueprintId;
  machineId: string;
  machinePart?: MachinePart;
  team: "king" | "queen";
  label: string;
  material: string;
  center: ComponentPose;
  width: number;
  height: number;
  finalization: "inspect" | "raise" | "mount";
  raiseMotion?: {
    finalPivot: ComponentPose;
    stagingPivot: ComponentPose;
    startRotation: number;
  };
  components: ComponentPlan[];
  mechanisms: MechanismStage[];
  onComplete?: "harness";
}

export const WORK_DURATION: Record<WorkOperation, number> = {
  fetch: 0,
  carry: 0,
  snap: 2.2,
  measure: 2.4,
  saw: 3.8,
  bore: 3.2,
  position: 2.5,
  peg: 2.8,
  lash: 3.4,
  wedge: 2.6,
  mount: 4.5,
  raise: 10,
  inspect: 3.2,
  stitch: 11.2,
  grease: 2.5,
  shape: 4.4,
  forge: 5.2,
  temper: 4.8,
  thread: 5.6,
  tension: 5.4,
  reeve: 6,
};

const pose = (x: number, y: number, angle = 0, z?: number): ComponentPose => ({
  x,
  y,
  angle,
  ...(z !== undefined ? { z } : {}),
});

function rotatePose(
  target: ComponentPose,
  finalPivot: ComponentPose,
  stagingPivot: ComponentPose,
  rotation: number,
): ComponentPose {
  const dx = target.x - finalPivot.x;
  const dy = target.y - finalPivot.y;
  return pose(
    stagingPivot.x + dx * Math.cos(rotation) - dy * Math.sin(rotation),
    stagingPivot.y + dx * Math.sin(rotation) + dy * Math.cos(rotation),
    target.angle + rotation,
    target.z,
  );
}

function sourcePose(
  team: "king" | "queen",
  index: number,
  componentType: ComponentType,
): ComponentPose {
  const direction = team === "king" ? 1 : -1;
  const originX = team === "king" ? 112 : 1088;
  const row = Math.floor(index / 5);
  const column = index % 5;
  const low =
    componentType === "timber" ||
    componentType === "rail" ||
    componentType === "rung" ||
    componentType === "crossbeam";
  return pose(
    originX + direction * (column * 17 + row * 9),
    43 + row * 15 + (low ? 0 : 9),
    low ? direction * (0.04 + row * 0.025) : 0,
  );
}

function component(
  machineId: string,
  suffix: string,
  index: number,
  team: "king" | "queen",
  componentType: ComponentType,
  label: string,
  material: string,
  staging: ComponentPose,
  final: ComponentPose,
  operations: WorkOperation[],
  size: { width?: number; height?: number; radius?: number },
  connection?: ConnectionType,
): ComponentPlan {
  return {
    id: `${machineId}_${suffix}`,
    label,
    componentType,
    material,
    ...size,
    source: sourcePose(team, index, componentType),
    staging,
    final,
    operations,
    ...(connection ? { connection } : {}),
  };
}

function mechanism(
  machineId: string,
  id: string,
  label: string,
  primitive: MechanismPrimitive,
  capability: MechanismCapability,
  input: string,
  output: string,
  suffixes: string[],
  mechanicalAdvantage = 1,
  efficiency = 0.85,
): MechanismStage {
  const commissioning: CommissioningTest =
    capability === "support" || capability === "guide"
      ? "square_frame"
      : capability === "transport" || capability === "convert_motion"
        ? "spin_free"
        : capability === "hold_load"
          ? "hold_position"
          : capability === "release_energy" || capability === "store_energy"
            ? "dry_cycle"
            : capability === "redirect_force"
              ? "reeve_line"
              : capability === "interface_load"
                ? "fit_load"
                : "proof_load";
  return {
    id,
    label,
    primitive,
    capability,
    input,
    output,
    requires: suffixes.map((suffix) => `${machineId}_${suffix}`),
    dependsOn: [],
    commissioning,
    testDuration:
      commissioning === "proof_load" || commissioning === "dry_cycle"
        ? 5.5
        : 4.2,
    mechanicalAdvantage,
    efficiency,
  };
}

function sequenceBlueprint(plan: BlueprintPlan): BlueprintPlan {
  return {
    ...plan,
    mechanisms: plan.mechanisms.map((stage, index, stages) => ({
      ...stage,
      dependsOn: index === 0 ? [] : [stages[index - 1]!.id],
    })),
  };
}

function skid(team: "king" | "queen"): BlueprintPlan {
  const id = "machine_skid";
  const material = "ash runners, oak cross-ties, wedges, wrought-iron dogs";
  const parts: ComponentPlan[] = [
    component(id, "runner_a", 0, team, "timber", "near runner", "squared ash", pose(386, 47), pose(386, 47), ["measure", "saw", "position"], { width: 236, height: 14 }),
    component(id, "runner_b", 1, team, "timber", "far runner", "squared ash", pose(399, 63), pose(399, 63), ["measure", "saw", "position"], { width: 236, height: 14 }),
    component(id, "tie_a", 2, team, "crossbeam", "left cross-tie", "seasoned oak", pose(328, 57), pose(328, 57), ["measure", "saw", "position", "peg"], { width: 78, height: 11 }, "peg"),
    component(id, "tie_b", 3, team, "crossbeam", "middle cross-tie", "seasoned oak", pose(392, 57), pose(392, 57), ["measure", "saw", "position", "peg"], { width: 78, height: 11 }, "peg"),
    component(id, "tie_c", 4, team, "crossbeam", "right cross-tie", "seasoned oak", pose(456, 57), pose(456, 57), ["measure", "saw", "position", "peg"], { width: 78, height: 11 }, "peg"),
    component(id, "dog_a", 5, team, "fastener", "left iron dog", "wrought iron", pose(333, 65), pose(333, 65), ["bore", "position", "wedge"], { width: 18, height: 10 }, "dog"),
    component(id, "dog_b", 6, team, "fastener", "right iron dog", "wrought iron", pose(451, 65), pose(451, 65), ["bore", "position", "wedge"], { width: 18, height: 10 }, "dog"),
  ];
  return {
    id: "skid",
    machineId: id,
    machinePart: "beam",
    team,
    label: "load-spreading skid",
    material,
    center: pose(392, 56),
    width: 250,
    height: 42,
    finalization: "inspect",
    components: parts,
    mechanisms: [
      mechanism(id, "bearing_surface", "paired runners share the load", "inclined_plane", "guide", "sliding load", "guided horizontal travel", ["runner_a", "runner_b"], 1.4, 0.62),
      mechanism(id, "locked_bed", "cross-ties and dogs lock the runners", "wedge", "support", "concentrated load", "distributed ground reaction", ["runner_a", "runner_b", "tie_a", "tie_b", "tie_c", "dog_a", "dog_b"], 1, 0.92),
    ],
  };
}

function newMachineId(
  team: "king" | "queen",
  name: "cart" | "lever" | "screw_jack" | "spring_trap",
): string {
  return team === "king" ? `machine_${name}` : `queen_machine_${name}`;
}

function orientAssembly(
  plan: BlueprintPlan,
  team: "king" | "queen",
): BlueprintPlan {
  if (team === "king") return plan;
  const mirror = (value: ComponentPose): ComponentPose => ({
    ...value,
    x: 1200 - value.x,
    angle: -value.angle,
  });
  return {
    ...plan,
    center: mirror(plan.center),
    components: plan.components.map((part) => ({
      ...part,
      staging: mirror(part.staging),
      final: mirror(part.final),
    })),
  };
}

function cart(team: "king" | "queen"): BlueprintPlan {
  const id = newMachineId(team, "cart");
  const parts: ComponentPlan[] = [
    component(id, "bed_a", 0, team, "timber", "near cart bed rail", "seasoned oak", pose(302, 88, 0, -0.38), pose(302, 88, 0, -0.38), ["measure", "saw", "position", "peg"], { width: 172, height: 14 }, "peg"),
    component(id, "bed_b", 1, team, "timber", "far cart bed rail", "seasoned oak", pose(302, 88, 0, 0.38), pose(302, 88, 0, 0.38), ["measure", "saw", "position", "peg"], { width: 172, height: 14 }, "peg"),
    component(id, "deck_a", 2, team, "platform", "front deck plank", "split oak", pose(278, 101, 0, 0), pose(278, 101, 0, 0), ["measure", "saw", "position", "peg"], { width: 54, height: 10 }, "peg"),
    component(id, "deck_b", 3, team, "platform", "middle deck plank", "split oak", pose(318, 101, 0, 0), pose(318, 101, 0, 0), ["measure", "saw", "position", "peg"], { width: 54, height: 10 }, "peg"),
    component(id, "deck_c", 4, team, "platform", "rear deck plank", "split oak", pose(358, 101, 0, 0), pose(358, 101, 0, 0), ["measure", "saw", "position", "peg"], { width: 54, height: 10 }, "peg"),
    component(id, "axle_a", 5, team, "axle", "front iron axle", "wrought iron", pose(263, 66), pose(263, 66), ["measure", "forge", "grease", "position"], { width: 72, height: 8 }, "bearing"),
    component(id, "axle_b", 6, team, "axle", "rear iron axle", "wrought iron", pose(341, 66), pose(341, 66), ["measure", "forge", "grease", "position"], { width: 72, height: 8 }, "bearing"),
    component(id, "wheel_fl", 7, team, "wheel", "front near wheel", "oak felloe and iron tyre", pose(263, 58, 0, -0.62), pose(263, 58, 0, -0.62), ["measure", "shape", "bore", "mount", "grease"], { radius: 28 }, "bearing"),
    component(id, "wheel_fr", 8, team, "wheel", "front far wheel", "oak felloe and iron tyre", pose(263, 58, 0, 0.62), pose(263, 58, 0, 0.62), ["measure", "shape", "bore", "mount", "grease"], { radius: 28 }, "bearing"),
    component(id, "wheel_rl", 9, team, "wheel", "rear near wheel", "oak felloe and iron tyre", pose(341, 58, 0, -0.62), pose(341, 58, 0, -0.62), ["measure", "shape", "bore", "mount", "grease"], { radius: 28 }, "bearing"),
    component(id, "wheel_rr", 10, team, "wheel", "rear far wheel", "oak felloe and iron tyre", pose(341, 58, 0, 0.62), pose(341, 58, 0, 0.62), ["measure", "shape", "bore", "mount", "grease"], { radius: 28 }, "bearing"),
    component(id, "drawbar", 11, team, "bar", "cart drawbar", "straight ash", pose(207, 76), pose(207, 76), ["measure", "saw", "position", "peg"], { width: 112, height: 11 }, "pin"),
    component(id, "ramp_a", 12, team, "rail", "left loading ramp", "rough oak", pose(400, 64, 0.24, -0.3), pose(400, 64, 0.24, -0.3), ["measure", "saw", "position", "lash"], { width: 104, height: 11 }, "lash"),
    component(id, "ramp_b", 13, team, "rail", "right loading ramp", "rough oak", pose(400, 64, 0.24, 0.3), pose(400, 64, 0.24, 0.3), ["measure", "saw", "position", "lash"], { width: 104, height: 11 }, "lash"),
    component(id, "bearing_fl", 14, team, "cheek", "front near axle block", "oak and bronze", pose(263, 72, 0, -0.42), pose(263, 72, 0, -0.42), ["measure", "shape", "bore", "mount", "grease"], { width: 28, height: 26 }, "bearing"),
    component(id, "bearing_fr", 15, team, "cheek", "front far axle block", "oak and bronze", pose(263, 72, 0, 0.42), pose(263, 72, 0, 0.42), ["measure", "shape", "bore", "mount", "grease"], { width: 28, height: 26 }, "bearing"),
    component(id, "bearing_rl", 16, team, "cheek", "rear near axle block", "oak and bronze", pose(341, 72, 0, -0.42), pose(341, 72, 0, -0.42), ["measure", "shape", "bore", "mount", "grease"], { width: 28, height: 26 }, "bearing"),
    component(id, "bearing_rr", 17, team, "cheek", "rear far axle block", "oak and bronze", pose(341, 72, 0, 0.42), pose(341, 72, 0, 0.42), ["measure", "shape", "bore", "mount", "grease"], { width: 28, height: 26 }, "bearing"),
  ];
  return orientAssembly({
    id: "cart",
    machineId: id,
    machinePart: "cart",
    team,
    label: "wheeled material cart",
    material: "oak bed, iron axles, four tyred wheels, loading ramps",
    center: pose(304, 77),
    width: 300,
    height: 112,
    finalization: "inspect",
    components: parts,
    mechanisms: [
      mechanism(id, "rolling_train", "four wheels turn on aligned axles", "wheel_and_axle", "transport", "horizontal pull", "rolling carriage motion", ["bearing_fl", "bearing_fr", "bearing_rl", "bearing_rr", "axle_a", "axle_b", "wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr"], 3.2, 0.82),
      mechanism(id, "load_bed", "pegged rails carry the platform", "frame", "support", "carried mass", "distributed axle load", ["bed_a", "bed_b", "deck_a", "deck_b", "deck_c"], 1, 0.9),
      mechanism(id, "loading_planes", "cleated ramps trade lift for travel", "inclined_plane", "guide", "long horizontal push", "short vertical rise", ["ramp_a", "ramp_b", "bed_a", "bed_b"], 2.6, 0.58),
      mechanism(id, "drawbar_control", "drawbar steers the rolling base", "lever", "control_motion", "hand motion", "carriage direction", ["drawbar", "axle_a", "axle_b"], 1.5, 0.78),
    ],
  }, team);
}

function screwJack(team: "king" | "queen"): BlueprintPlan {
  const id = newMachineId(team, "screw_jack");
  return orientAssembly({
    id: "screw_jack",
    machineId: id,
    machinePart: "screw",
    team,
    label: "wooden screw jack",
    material: "oak frame, threaded hornbeam spindle, iron saddle",
    center: pose(405, 108),
    width: 116,
    height: 148,
    finalization: "inspect",
    components: [
      component(id, "base", 0, team, "timber", "jack sole", "oak", pose(405, 49), pose(405, 49), ["measure", "saw", "position", "peg"], { width: 112, height: 18 }, "peg"),
      component(id, "post_a", 1, team, "cheek", "left jack cheek", "oak", pose(375, 102), pose(375, 102), ["measure", "saw", "bore", "position", "peg"], { width: 18, height: 112 }, "peg"),
      component(id, "post_b", 2, team, "cheek", "right jack cheek", "oak", pose(435, 102), pose(435, 102), ["measure", "saw", "bore", "position", "peg"], { width: 18, height: 112 }, "peg"),
      component(id, "nut", 3, team, "nut", "fixed threaded nut", "hard hornbeam", pose(405, 128), pose(405, 128), ["measure", "bore", "thread", "position", "wedge"], { width: 58, height: 26 }, "thread"),
      component(id, "spindle", 4, team, "screw", "threaded lifting spindle", "hornbeam and tallow", pose(405, 118), pose(405, 118), ["measure", "shape", "thread", "grease", "mount"], { width: 18, height: 118 }, "thread"),
      component(id, "saddle", 5, team, "saddle", "iron lifting saddle", "forged iron", pose(405, 180), pose(405, 180), ["forge", "temper", "bore", "mount"], { width: 72, height: 18 }, "pin"),
      component(id, "handle_a", 6, team, "bar", "first turning handle", "ash", pose(405, 91, 0), pose(405, 91, 0), ["measure", "saw", "position"], { width: 92, height: 7 }, "socket"),
      component(id, "handle_b", 7, team, "bar", "cross turning handle", "ash", pose(405, 91, Math.PI / 2), pose(405, 91, Math.PI / 2), ["measure", "saw", "position"], { width: 92, height: 7 }, "socket"),
      component(id, "guide_collar", 8, team, "nut", "upper spindle guide collar", "hornbeam and bronze", pose(405, 151), pose(405, 151), ["measure", "bore", "thread", "position", "wedge"], { width: 64, height: 20 }, "thread"),
      component(id, "thrust_washer", 9, team, "fastener", "saddle thrust washer", "forged iron", pose(405, 171), pose(405, 171), ["forge", "temper", "bore", "mount", "grease"], { width: 48, height: 8 }, "bearing"),
    ],
    mechanisms: [
      mechanism(id, "braced_guide", "cheeks guide the spindle in compression", "frame", "guide", "off-center load", "aligned vertical load", ["base", "post_a", "post_b", "nut", "guide_collar"], 1, 0.88),
      mechanism(id, "thread_drive", "cross handles turn the threaded spindle", "screw", "multiply_force", "long circular hand travel", "short locked vertical travel", ["nut", "guide_collar", "spindle", "handle_a", "handle_b"], 18, 0.46),
      mechanism(id, "load_saddle", "the saddle spreads screw force", "wedge", "interface_load", "point lift", "broad supported lift", ["spindle", "thrust_washer", "saddle"], 1, 0.91),
    ],
  }, team);
}

function lever(team: "king" | "queen"): BlueprintPlan {
  const id = newMachineId(team, "lever");
  return orientAssembly({
    id: "lever",
    machineId: id,
    machinePart: "lever",
    team,
    label: "counterweighted lifting cantilever",
    material: "oak sole, ash lever arm, iron pivot, stone counterweight",
    center: pose(458, 150, -0.12),
    width: 330,
    height: 220,
    finalization: "inspect",
    components: [
      component(id, "sole", 0, team, "timber", "lever sole", "oak", pose(430, 49), pose(430, 49), ["measure", "saw", "position", "wedge"], { width: 176, height: 18 }, "wedge"),
      component(id, "fulcrum", 1, team, "fulcrum", "triangular fulcrum", "laminated oak", pose(448, 98), pose(448, 98), ["measure", "shape", "bore", "position", "peg"], { width: 72, height: 92 }, "peg"),
      component(id, "pivot", 2, team, "axle", "lever pivot pin", "forged iron", pose(448, 132), pose(448, 132), ["measure", "forge", "temper", "grease", "position"], { width: 82, height: 9 }, "bearing"),
      component(id, "arm", 3, team, "bar", "long ash lever arm", "straight-grained ash", pose(510, 146, -0.12), pose(510, 146, -0.12), ["measure", "saw", "shape", "bore", "mount"], { width: 310, height: 22 }, "pin"),
      component(id, "basket", 4, team, "platform", "counterweight basket", "oak slats and rawhide", pose(372, 119), pose(372, 119), ["measure", "saw", "position", "lash"], { width: 74, height: 62 }, "lash"),
      component(id, "stone_a", 5, team, "counterweight", "first ballast stone", "dense limestone", pose(372, 122, 0, -0.22), pose(372, 122, 0, -0.22), ["position"], { radius: 19 }),
      component(id, "stone_b", 6, team, "counterweight", "second ballast stone", "dense limestone", pose(372, 122, 0, 0.22), pose(372, 122, 0, 0.22), ["position"], { radius: 19 }),
      component(id, "nose_hook", 7, team, "hook", "cantilever nose hook", "forged iron", pose(653, 132), pose(653, 132), ["forge", "temper", "bore", "mount"], { width: 24, height: 42 }, "hook"),
      component(id, "stop", 8, team, "trigger", "lever travel stop", "oak and rawhide", pose(565, 88), pose(565, 88), ["measure", "saw", "position", "lash"], { width: 34, height: 72 }, "catch"),
      component(id, "pivot_cheek_a", 9, team, "cheek", "near pivot cheek", "oak and bronze", pose(448, 113, 0, -0.38), pose(448, 113, 0, -0.38), ["measure", "shape", "bore", "position", "peg"], { width: 36, height: 74 }, "bearing"),
      component(id, "pivot_cheek_b", 10, team, "cheek", "far pivot cheek", "oak and bronze", pose(448, 113, 0, 0.38), pose(448, 113, 0, 0.38), ["measure", "shape", "bore", "position", "peg"], { width: 36, height: 74 }, "bearing"),
    ],
    mechanisms: [
      mechanism(id, "pivoted_arm", "long arm turns on the greased fulcrum", "lever", "multiply_force", "long effort stroke", "short high-force stroke", ["sole", "fulcrum", "pivot_cheek_a", "pivot_cheek_b", "pivot", "arm"], 5.2, 0.76),
      mechanism(id, "gravity_store", "basket ballast stores gravitational energy", "counterweight", "store_energy", "raised ballast", "rotational impulse", ["basket", "stone_a", "stone_b", "arm"], 1, 0.84),
      mechanism(id, "limited_output", "hook and stop constrain the output arc", "ratchet", "control_motion", "arm rotation", "bounded hook travel", ["nose_hook", "stop", "arm"], 1, 0.9),
    ],
  }, team);
}

function mast(team: "king" | "queen"): BlueprintPlan {
  const id = "machine_mast";
  const material = "three scarfed ash lengths with iron fishplates";
  const finalPivot = pose(480, 43);
  const stagingPivot = pose(480, 43);
  const startRotation = -Math.PI / 2 - 0.02;
  const stage = (target: ComponentPose): ComponentPose =>
    rotatePose(target, finalPivot, stagingPivot, startRotation);
  const parts: ComponentPlan[] = [];
  for (let index = 0; index < 3; index += 1) {
    const finalY = 122 + index * 158;
    parts.push(
      component(
        id,
        `length_${index + 1}`,
        index,
        team,
        "timber",
        `mast length ${index + 1}`,
        "straight-grained ash",
        stage(pose(480, finalY, 0.02)),
        pose(480, finalY, 0.02),
        ["measure", "saw", "position", "peg"],
        { width: 18, height: 158 },
        "scarf",
      ),
    );
  }
  parts.push(
    component(id, "fishplate_a", 3, team, "fastener", "lower fishplate", "wrought iron", stage(pose(480, 201, 0.02)), pose(480, 201, 0.02), ["bore", "position", "peg"], { width: 29, height: 13 }, "bolt"),
    component(id, "fishplate_b", 4, team, "fastener", "upper fishplate", "wrought iron", stage(pose(480, 359, 0.02)), pose(480, 359, 0.02), ["bore", "position", "peg"], { width: 29, height: 13 }, "bolt"),
    component(id, "heel", 5, team, "fastener", "mast heel shoe", "forged iron", stage(pose(480, 43, 0.02)), pose(480, 43, 0.02), ["measure", "bore", "position", "wedge"], { width: 31, height: 18 }, "dog"),
  );
  return {
    id: "mast",
    machineId: id,
    machinePart: "beam",
    team,
    label: "scarfed lifting mast",
    material,
    center: pose(480, 280, 0.02),
    width: 28,
    height: 500,
    finalization: "raise",
    raiseMotion: { finalPivot, stagingPivot, startRotation },
    components: parts,
    mechanisms: [
      mechanism(id, "scarfed_column", "fishplated scarf joints carry compression", "frame", "support", "head load", "grounded column load", ["length_1", "length_2", "length_3", "fishplate_a", "fishplate_b"], 1, 0.86),
      mechanism(id, "heel_pivot", "heel shoe anchors the raised mast", "lever", "control_motion", "raising line travel", "controlled mast rotation", ["length_1", "heel"], 1.8, 0.74),
    ],
  };
}

function brace(team: "king" | "queen"): BlueprintPlan {
  const id = "machine_brace";
  const finalPivot = pose(405, 48);
  const stagingPivot = pose(405, 48);
  const startRotation = -Math.PI / 2 + 0.25;
  const stage = (target: ComponentPose): ComponentPose =>
    rotatePose(target, finalPivot, stagingPivot, startRotation);
  const material = "paired ash braces with oak gussets";
  const parts: ComponentPlan[] = [
    component(id, "lower", 0, team, "brace", "lower diagonal", "squared ash", stage(pose(432, 151, -0.25)), pose(432, 151, -0.25), ["measure", "saw", "position", "peg"], { width: 17, height: 214 }, "peg"),
    component(id, "upper", 1, team, "brace", "upper diagonal", "squared ash", stage(pose(459, 355, -0.25)), pose(459, 355, -0.25), ["measure", "saw", "position", "peg"], { width: 17, height: 214 }, "peg"),
    component(id, "foot_gusset", 2, team, "fastener", "foot gusset", "oak and iron", stage(pose(405, 48, -0.25)), pose(405, 48, -0.25), ["measure", "bore", "position", "wedge"], { width: 34, height: 20 }, "bolt"),
    component(id, "head_gusset", 3, team, "fastener", "head gusset", "oak and iron", stage(pose(480, 457, -0.25)), pose(480, 457, -0.25), ["measure", "bore", "position", "wedge"], { width: 34, height: 20 }, "bolt"),
  ];
  return {
    id: "brace",
    machineId: id,
    machinePart: "beam",
    team,
    label: "two-piece diagonal brace",
    material,
    center: pose(445, 258, -0.25),
    width: 28,
    height: 440,
    finalization: "raise",
    raiseMotion: { finalPivot, stagingPivot, startRotation },
    components: parts,
    mechanisms: [
      mechanism(id, "triangulated_load_path", "diagonal braces oppose mast bending", "frame", "support", "lateral head load", "grounded compression", ["lower", "upper", "foot_gusset", "head_gusset"], 1, 0.93),
    ],
  };
}

function ladder(team: "king" | "queen"): BlueprintPlan {
  const id = "machine_ladder";
  const finalPivot = pose(520, 43);
  const stagingPivot = pose(520, 43);
  const startRotation = -Math.PI / 2;
  const stage = (target: ComponentPose): ComponentPose =>
    rotatePose(target, finalPivot, stagingPivot, startRotation);
  const parts: ComponentPlan[] = [];
  const railXs = [505, 535];
  let sourceIndex = 0;
  for (let side = 0; side < 2; side += 1) {
    for (let section = 0; section < 2; section += 1) {
      const finalY = section === 0 ? 160 : 390;
      parts.push(
        component(
          id,
          `rail_${side}_${section}`,
          sourceIndex++,
          team,
          "rail",
          `${side === 0 ? "left" : "right"} rail ${section + 1}`,
          "riven ash rail",
          stage(pose(railXs[side] ?? 520, finalY)),
          pose(railXs[side] ?? 520, finalY),
          ["measure", "saw", "position", "lash"],
          { width: 10, height: 230 },
          "scarf",
        ),
      );
    }
  }
  for (let rung = 0; rung < 12; rung += 1) {
    const y = 69 + rung * 39;
    parts.push(
      component(
        id,
        `rung_${String(rung + 1).padStart(2, "0")}`,
        sourceIndex++,
        team,
        "rung",
        `rung ${rung + 1}`,
        "split oak",
        stage(pose(520, y)),
        pose(520, y),
        ["measure", "position", "bore", "peg", "lash"],
        { width: 42, height: 7 },
        "lash",
      ),
    );
  }
  parts.push(
    component(id, "foot_a", sourceIndex++, team, "fastener", "left iron foot", "forged iron", stage(pose(505, 43)), pose(505, 43), ["bore", "position", "peg"], { width: 16, height: 18 }, "bolt"),
    component(id, "foot_b", sourceIndex, team, "fastener", "right iron foot", "forged iron", stage(pose(535, 43)), pose(535, 43), ["bore", "position", "peg"], { width: 16, height: 18 }, "bolt"),
  );
  return {
    id: "ladder",
    machineId: id,
    machinePart: "ladder",
    team,
    label: "sectional lashed ladder",
    material: "four ash rail sections, twelve oak rungs, rawhide lashings",
    center: pose(520, 285),
    width: 58,
    height: 510,
    finalization: "raise",
    raiseMotion: { finalPivot, stagingPivot, startRotation },
    components: parts,
    mechanisms: [
      mechanism(id, "climbing_plane", "rungs divide one rise into short steps", "inclined_plane", "guide", "repeated short climbs", "controlled vertical access", ["rail_0_0", "rail_0_1", "rail_1_0", "rail_1_1", ...Array.from({ length: 12 }, (_, index) => `rung_${String(index + 1).padStart(2, "0")}`)], 3.4, 0.71),
      mechanism(id, "grounded_feet", "iron feet resist ladder slip", "wedge", "support", "rail thrust", "ground reaction", ["foot_a", "foot_b", "rail_0_0", "rail_1_0"], 1, 0.9),
    ],
  };
}

function winch(team: "king" | "queen"): BlueprintPlan {
  const id = "machine_winch";
  const parts: ComponentPlan[] = [
    component(id, "base_a", 0, team, "timber", "near windlass sole", "oak", pose(350, 47, 0, -0.72), pose(350, 47, 0, -0.72), ["measure", "saw", "position", "peg"], { width: 172, height: 14 }, "peg"),
    component(id, "base_b", 1, team, "timber", "far windlass sole", "oak", pose(350, 47, 0, 0.72), pose(350, 47, 0, 0.72), ["measure", "saw", "position", "peg"], { width: 172, height: 14 }, "peg"),
    component(id, "cheek_a", 2, team, "cheek", "near bearing standard", "oak", pose(350, 105, 0, -1.0), pose(350, 105, 0, -1.0), ["measure", "saw", "bore", "position", "peg"], { width: 28, height: 128 }, "peg"),
    component(id, "cheek_b", 3, team, "cheek", "far bearing standard", "oak", pose(350, 105, 0, 1.0), pose(350, 105, 0, 1.0), ["measure", "saw", "bore", "position", "peg"], { width: 28, height: 128 }, "peg"),
    component(id, "crossbrace", 4, team, "brace", "windlass cross brace", "ash", pose(350, 82, -0.34), pose(350, 82, -0.34), ["measure", "saw", "position", "peg"], { width: 132, height: 14 }, "peg"),
    component(id, "axle", 5, team, "axle", "common iron axle", "wrought iron", pose(350, 126), pose(350, 126), ["measure", "forge", "temper", "grease", "position"], { width: 138, height: 9 }, "bearing"),
    component(id, "treadwheel", 6, team, "wheel", "human treadwheel", "oak spokes and iron tyre", pose(350, 126, 0, -1.24), pose(350, 126, 0, -1.24), ["measure", "shape", "bore", "mount", "grease"], { radius: 64 }, "bearing"),
    component(id, "drum", 7, team, "drum", "rope winding drum", "banded oak", pose(350, 126, 0, 0), pose(350, 126, 0, 0), ["measure", "shape", "bore", "mount", "grease"], { radius: 29 }, "pin"),
    component(id, "ratchet", 8, team, "gear", "holding ratchet wheel", "tempered iron", pose(350, 126, 0, 0.94), pose(350, 126, 0, 0.94), ["measure", "forge", "temper", "bore", "mount"], { radius: 34 }, "pin"),
    component(id, "pawl", 9, team, "pawl", "spring-backed holding pawl", "tempered iron", pose(388, 93, -0.46, 0.94), pose(388, 93, -0.46, 0.94), ["measure", "forge", "temper", "bore", "mount"], { width: 42, height: 9 }, "pin"),
    component(id, "brake", 10, team, "trigger", "wooden brake lever", "hornbeam and leather", pose(410, 72, -0.28, 0.94), pose(410, 72, -0.28, 0.94), ["measure", "shape", "bore", "mount", "inspect"], { width: 86, height: 9 }, "pin"),
  ];
  return {
    id: "winch",
    machineId: id,
    machinePart: "winch",
    team,
    label: "ratcheted treadwheel windlass",
    material: "braced oak frame, treadwheel, drum, iron ratchet and brake",
    center: pose(350, 112),
    width: 190,
    height: 196,
    finalization: "inspect",
    components: parts,
    mechanisms: [
      mechanism(id, "windlass_frame", "braced standards align the common axle", "frame", "support", "axle reaction", "grounded frame load", ["base_a", "base_b", "cheek_a", "cheek_b", "crossbrace"], 1, 0.9),
      mechanism(id, "treadwheel_drive", "large treadwheel multiplies human torque", "wheel_and_axle", "multiply_force", "walking effort", "high axle torque", ["axle", "treadwheel"], 7.1, 0.78),
      mechanism(id, "rope_drum", "axle rotation winds line onto the drum", "drum", "convert_motion", "axle rotation", "linear rope travel", ["axle", "drum"], 1.8, 0.84),
      mechanism(id, "ratchet_hold", "ratchet and pawl prevent reverse rotation", "ratchet", "hold_load", "incremental drum rotation", "held rope tension", ["ratchet", "pawl", "axle"], 1, 0.94),
      mechanism(id, "brake_control", "brake meters stored line tension", "lever", "control_motion", "hand pressure", "controlled drum speed", ["brake", "drum", "ratchet"], 3.4, 0.7),
    ],
  };
}

function pulley(team: "king" | "queen"): BlueprintPlan {
  const id = "machine_pulley";
  const stageCenter = pose(442, 70);
  const finalCenter = pose(492, 525);
  const lowerCenter = pose(548, 464);
  const parts: ComponentPlan[] = [
    component(id, "cheek_a", 0, team, "cheek", "front pulley cheek", "oak", pose(stageCenter.x, stageCenter.y, 0, -0.34), pose(finalCenter.x, finalCenter.y, 0, -0.34), ["measure", "saw", "bore", "position"], { width: 28, height: 56 }, "pin"),
    component(id, "cheek_b", 1, team, "cheek", "rear pulley cheek", "oak", pose(stageCenter.x, stageCenter.y, 0, 0.34), pose(finalCenter.x, finalCenter.y, 0, 0.34), ["measure", "saw", "bore", "position"], { width: 28, height: 56 }, "pin"),
    component(id, "sheave", 2, team, "sheave", "brass sheave", "cast brass", pose(stageCenter.x, stageCenter.y), pose(finalCenter.x, finalCenter.y), ["measure", "grease", "mount"], { radius: 19 }, "pin"),
    component(id, "pin", 3, team, "axle", "sheave pin", "forged iron", pose(stageCenter.x, stageCenter.y), pose(finalCenter.x, finalCenter.y), ["measure", "grease", "position", "peg"], { width: 51, height: 7 }, "pin"),
    component(id, "hook", 4, team, "hook", "mounting hook", "forged iron", pose(stageCenter.x, stageCenter.y + 35), pose(finalCenter.x, finalCenter.y + 35), ["measure", "bore", "mount"], { width: 22, height: 30 }, "hook"),
    component(id, "lower_cheek_a", 5, team, "cheek", "traveling block front cheek", "oak", pose(stageCenter.x + 30, stageCenter.y, 0, -0.34), pose(lowerCenter.x, lowerCenter.y, 0, -0.34), ["measure", "saw", "bore", "position"], { width: 28, height: 56 }, "pin"),
    component(id, "lower_cheek_b", 6, team, "cheek", "traveling block rear cheek", "oak", pose(stageCenter.x + 56, stageCenter.y, 0, 0.34), pose(lowerCenter.x, lowerCenter.y, 0, 0.34), ["measure", "saw", "bore", "position"], { width: 28, height: 56 }, "pin"),
    component(id, "lower_sheave", 7, team, "sheave", "traveling brass sheave", "cast brass", pose(stageCenter.x + 43, stageCenter.y), pose(lowerCenter.x, lowerCenter.y), ["measure", "grease", "mount"], { radius: 19 }, "pin"),
    component(id, "lower_pin", 8, team, "axle", "traveling sheave pin", "forged iron", pose(stageCenter.x + 43, stageCenter.y), pose(lowerCenter.x, lowerCenter.y), ["measure", "grease", "position", "peg"], { width: 51, height: 7 }, "pin"),
    component(id, "lower_hook", 9, team, "hook", "traveling load hook", "forged iron", pose(stageCenter.x + 43, stageCenter.y - 35), pose(lowerCenter.x, lowerCenter.y - 35), ["measure", "bore", "mount"], { width: 22, height: 30 }, "hook"),
    component(id, "becket", 10, team, "hook", "standing-line becket", "forged iron", pose(stageCenter.x - 35, stageCenter.y + 22), pose(finalCenter.x - 35, finalCenter.y + 22), ["forge", "temper", "bore", "mount"], { width: 18, height: 24 }, "hook"),
  ];
  return {
    id: "pulley",
    machineId: id,
    machinePart: "pulley",
    team,
    label: "four-part traveling block and tackle",
    material: "paired oak blocks, brass sheaves, forged pins, hooks and becket",
    center: pose(520, 494),
    width: 126,
    height: 146,
    finalization: "mount",
    components: parts,
    mechanisms: [
      mechanism(id, "direction_block", "fixed sheave redirects the hauling line", "pulley", "redirect_force", "horizontal rope pull", "vertical rope tension", ["cheek_a", "cheek_b", "sheave", "pin", "hook"], 1, 0.9),
      mechanism(id, "traveling_tackle", "two sheaves create four supporting rope parts", "pulley", "multiply_force", "long rope travel", "short high-force lift", ["sheave", "pin", "lower_cheek_a", "lower_cheek_b", "lower_sheave", "lower_pin", "becket"], 4, 0.72),
      mechanism(id, "load_hook", "traveling hook presents tackle force to the sling", "flexible_connector", "interface_load", "block tension", "balanced sling load", ["lower_hook", "lower_sheave", "lower_pin"], 1, 0.93),
    ],
  };
}

function sling(team: "king" | "queen"): BlueprintPlan {
  const id = "rescue_sling";
  return {
    id: "sling",
    machineId: id,
    team,
    label: "broad lifting sling",
    material: "double canvas, leather eyes, waxed linen thread",
    center: pose(600, 520),
    width: 104,
    height: 70,
    finalization: "mount",
    onComplete: "harness",
    components: [
      component(id, "canvas", 0, team, "canvas", "double canvas sling", "waxed double canvas", pose(454, 65), pose(600, 520), ["measure", "stitch", "position", "lash"], { width: 96, height: 34 }, "stitch"),
      component(id, "eye_a", 1, team, "lashing", "left leather eye", "boiled leather", pose(424, 65), pose(558, 523), ["measure", "stitch", "lash"], { radius: 9 }, "stitch"),
      component(id, "eye_b", 2, team, "lashing", "right leather eye", "boiled leather", pose(484, 65), pose(642, 523), ["measure", "stitch", "lash"], { radius: 9 }, "stitch"),
    ],
    mechanisms: [
      mechanism(id, "broad_interface", "canvas spreads line force around the curved shell", "flexible_connector", "interface_load", "two eye tensions", "distributed shell pressure", ["canvas", "eye_a", "eye_b"], 1, 0.88),
    ],
  };
}

function springTrap(team: "king" | "queen"): BlueprintPlan {
  const id = newMachineId(team, "spring_trap");
  const direction = team === "king" ? 1 : -1;
  const centerX = team === "king" ? 510 : 790;
  return {
    id: "spring_trap",
    machineId: id,
    machinePart: "spring",
    team,
    label: "torsion spring stone-thrower",
    material: "oak frame, twisted sinew spring, ash arm, iron catch",
    center: pose(centerX, 104),
    width: 246,
    height: 174,
    finalization: "inspect",
    components: [
      component(id, "bed_a", 0, team, "timber", "near launcher bed", "oak", pose(centerX, 49, 0, -0.62), pose(centerX, 49, 0, -0.62), ["measure", "saw", "position", "peg"], { width: 218, height: 15 }, "peg"),
      component(id, "bed_b", 1, team, "timber", "far launcher bed", "oak", pose(centerX, 49, 0, 0.62), pose(centerX, 49, 0, 0.62), ["measure", "saw", "position", "peg"], { width: 218, height: 15 }, "peg"),
      component(id, "upright_a", 2, team, "cheek", "near spring cheek", "oak", pose(centerX, 102, 0, -0.72), pose(centerX, 102, 0, -0.72), ["measure", "saw", "bore", "position", "wedge"], { width: 28, height: 112 }, "wedge"),
      component(id, "upright_b", 3, team, "cheek", "far spring cheek", "oak", pose(centerX, 102, 0, 0.72), pose(centerX, 102, 0, 0.72), ["measure", "saw", "bore", "position", "wedge"], { width: 28, height: 112 }, "wedge"),
      component(id, "spring", 4, team, "spring", "twisted sinew spring", "waxed sinew and horn", pose(centerX, 106), pose(centerX, 106), ["measure", "lash", "tension", "inspect"], { radius: 31 }, "bearing"),
      component(id, "pivot", 5, team, "axle", "throwing arm spindle", "forged iron", pose(centerX, 112), pose(centerX, 112), ["measure", "forge", "temper", "grease", "position"], { width: 96, height: 8 }, "bearing"),
      component(id, "arm", 6, team, "bar", "throwing lever arm", "elastic ash", pose(centerX + direction * 35, 156, direction * -0.34), pose(centerX + direction * 35, 156, direction * -0.34), ["measure", "saw", "shape", "bore", "mount", "tension"], { width: 184, height: 18 }, "pin"),
      component(id, "cup", 7, team, "canvas", "stone throwing cup", "boiled leather", pose(centerX + direction * 116, 183), pose(centerX + direction * 116, 183), ["measure", "shape", "stitch", "lash"], { width: 46, height: 26 }, "lash"),
      component(id, "catch", 8, team, "trigger", "iron release catch", "tempered iron", pose(centerX - direction * 69, 70), pose(centerX - direction * 69, 70), ["forge", "temper", "bore", "mount"], { width: 38, height: 14 }, "catch"),
      component(id, "trigger", 9, team, "trigger", "wooden trigger lever", "hornbeam", pose(centerX - direction * 92, 67), pose(centerX - direction * 92, 67), ["measure", "shape", "bore", "mount", "inspect"], { width: 72, height: 8 }, "pin"),
      component(id, "crossbrace_a", 10, team, "brace", "near diagonal frame brace", "ash", pose(centerX, 92, direction * -0.35, -0.62), pose(centerX, 92, direction * -0.35, -0.62), ["measure", "saw", "position", "peg"], { width: 142, height: 13 }, "peg"),
      component(id, "crossbrace_b", 11, team, "brace", "far diagonal frame brace", "ash", pose(centerX, 92, direction * 0.35, 0.62), pose(centerX, 92, direction * 0.35, 0.62), ["measure", "saw", "position", "peg"], { width: 142, height: 13 }, "peg"),
      component(id, "windlass_axle", 12, team, "axle", "cocking windlass axle", "wrought iron", pose(centerX - direction * 76, 87), pose(centerX - direction * 76, 87), ["measure", "forge", "temper", "grease", "position"], { width: 104, height: 8 }, "bearing"),
      component(id, "windlass_drum", 13, team, "drum", "cocking rope drum", "banded oak", pose(centerX - direction * 76, 87), pose(centerX - direction * 76, 87), ["measure", "shape", "bore", "mount", "grease"], { radius: 24 }, "pin"),
      component(id, "ratchet", 14, team, "gear", "cocking ratchet wheel", "tempered iron", pose(centerX - direction * 76, 87, 0, 0.62), pose(centerX - direction * 76, 87, 0, 0.62), ["measure", "forge", "temper", "bore", "mount"], { radius: 29 }, "pin"),
      component(id, "pawl", 15, team, "pawl", "cocking pawl", "tempered iron", pose(centerX - direction * 45, 66, direction * -0.45, 0.62), pose(centerX - direction * 45, 66, direction * -0.45, 0.62), ["forge", "temper", "bore", "mount"], { width: 38, height: 8 }, "pin"),
      component(id, "crank_a", 16, team, "bar", "first windlass crank", "ash", pose(centerX - direction * 76, 87, 0), pose(centerX - direction * 76, 87, 0), ["measure", "saw", "position"], { width: 84, height: 7 }, "socket"),
      component(id, "crank_b", 17, team, "bar", "cross windlass crank", "ash", pose(centerX - direction * 76, 87, Math.PI / 2), pose(centerX - direction * 76, 87, Math.PI / 2), ["measure", "saw", "position"], { width: 84, height: 7 }, "socket"),
      component(id, "draw_line", 18, team, "lashing", "arm cocking line", "three-strand hemp", pose(centerX - direction * 18, 108, direction * -0.25), pose(centerX - direction * 18, 108, direction * -0.25), ["measure", "lash", "reeve", "tension"], { width: 128, height: 7 }, "lash"),
    ],
    mechanisms: [
      mechanism(id, "braced_launcher", "cross-braced bed contains launch reactions", "frame", "support", "spring and arm reaction", "distributed ground load", ["bed_a", "bed_b", "upright_a", "upright_b", "crossbrace_a", "crossbrace_b"], 1, 0.9),
      mechanism(id, "cocking_windlass", "cranks and drum pull the arm through long travel", "wheel_and_axle", "multiply_force", "repeated crank travel", "high draw-line tension", ["windlass_axle", "windlass_drum", "crank_a", "crank_b", "draw_line"], 5.4, 0.72),
      mechanism(id, "incremental_hold", "ratchet holds each increment of the draw", "ratchet", "hold_load", "forward drum steps", "retained draw-line tension", ["ratchet", "pawl", "windlass_axle"], 1, 0.94),
      mechanism(id, "torsion_store", "twisted sinew stores windlass work", "spring", "store_energy", "slow draw-line work", "rapid rotational energy", ["spring", "pivot", "arm", "draw_line"], 1, 0.68),
      mechanism(id, "throwing_lever", "long arm converts spring torque into cup speed", "lever", "convert_motion", "short high-torque rotation", "fast long-arc cup motion", ["pivot", "arm", "cup"], 0.34, 0.79),
      mechanism(id, "controlled_release", "catch and trigger choose the release instant", "ratchet", "release_energy", "held arm", "timed free rotation", ["catch", "trigger", "arm"], 1, 0.91),
    ],
  };
}

function barricade(
  team: "king" | "queen",
  sequence: number,
  originX: number,
): BlueprintPlan {
  const id = `queen_barricade_${sequence}`;
  const direction = team === "king" ? 1 : -1;
  return {
    id: "barricade",
    machineId: id,
    machinePart: "beam",
    team,
    label: "angled field barricade",
    material: "salvaged timbers, stakes, rope lashings",
    center: pose(originX, 75),
    width: 170,
    height: 90,
    finalization: "inspect",
    components: [
      component(id, "rail_a", 0, team, "timber", "lower barricade rail", "salvaged oak", pose(originX, 52, direction * -0.08), pose(originX, 52, direction * -0.08), ["measure", "saw", "position", "peg"], { width: 150, height: 13 }, "peg"),
      component(id, "rail_b", 1, team, "timber", "upper barricade rail", "salvaged oak", pose(originX, 78, direction * -0.13), pose(originX, 78, direction * -0.13), ["measure", "saw", "position", "lash"], { width: 150, height: 13 }, "lash"),
      component(id, "stake_a", 2, team, "brace", "left ground stake", "ash", pose(originX - 52, 64, -0.25), pose(originX - 52, 64, -0.25), ["measure", "saw", "position", "wedge"], { width: 12, height: 80 }, "wedge"),
      component(id, "stake_b", 3, team, "brace", "right ground stake", "ash", pose(originX + 52, 64, 0.25), pose(originX + 52, 64, 0.25), ["measure", "saw", "position", "wedge"], { width: 12, height: 80 }, "wedge"),
    ],
    mechanisms: [
      mechanism(id, "staked_frame", "angled rails transfer impact into ground stakes", "frame", "support", "horizontal impact", "ground reaction", ["rail_a", "rail_b", "stake_a", "stake_b"], 1, 0.82),
    ],
  };
}

export function createBlueprint(
  id: BlueprintId,
  team: "king" | "queen",
  sequence = 0,
  originX = team === "king" ? 400 : 900,
): BlueprintPlan {
  switch (id) {
    case "skid":
      return sequenceBlueprint(skid(team));
    case "cart":
      return sequenceBlueprint(cart(team));
    case "lever":
      return sequenceBlueprint(lever(team));
    case "screw_jack":
      return sequenceBlueprint(screwJack(team));
    case "mast":
      return sequenceBlueprint(mast(team));
    case "brace":
      return sequenceBlueprint(brace(team));
    case "ladder":
      return sequenceBlueprint(ladder(team));
    case "winch":
      return sequenceBlueprint(winch(team));
    case "pulley":
      return sequenceBlueprint(pulley(team));
    case "sling":
      return sequenceBlueprint(sling(team));
    case "spring_trap":
      return sequenceBlueprint(springTrap(team));
    case "barricade":
      return sequenceBlueprint(barricade(team, sequence, originX));
  }
}
