import type {
  BattleOrderAction,
  BattleTargetId,
  BattleUnitId,
  Team,
} from "./core-protocol.js";

export type SiegeCrewTool = "none" | "sapper-tool" | "rope-coil" | "sponge-rammer" | "linstock" | "matchlock";

export interface SiegeCrewStation {
  role: string;
  duty: string;
  tool: SiegeCrewTool;
  outboard: number;
  lateral: number;
}

export interface SiegeDrillStage {
  id: string;
  label: string;
  from: number;
  to: number;
  leadCrew: number[];
}

export interface SiegeEquipmentDefinition {
  id: BattleUnitId;
  team: Team;
  name: string;
  role: string;
  purpose: string;
  machineRole: "war" | "rescue";
  munition: string;
  maxAmmunition: number;
  availableActions: BattleOrderAction[];
  availableTargets: BattleTargetId[];
  simpleMachines: string[];
  affordances: string[];
  crew: [SiegeCrewStation, SiegeCrewStation, SiegeCrewStation];
  drill: SiegeDrillStage[];
  effectStage: string;
  effectAt: number;
}

export const SIEGE_EQUIPMENT: readonly SiegeEquipmentDefinition[] = [
  {
    id: "red-engineers",
    team: "king",
    name: "Royal Sappers",
    role: "Gabions, repairs, and raids",
    purpose: "Set woven gabions, shore a threatened position, or raid Green's powder train.",
    machineRole: "rescue",
    munition: "gabion and fascine stores",
    maxAmmunition: 6,
    availableActions: ["fortify", "raid"],
    availableTargets: ["foundation", "tower-face", "humpty", "enemy-machine"],
    simpleMachines: ["wedge", "lever"],
    affordances: ["survey damage", "carry fascines", "place gabions", "drive braces", "cut powder lines"],
    crew: [
      { role: "Master sapper", duty: "surveys the work and sets the brace", tool: "sapper-tool", outboard: .78, lateral: -.7 },
      { role: "Fascine bearer", duty: "hauls cover into the threatened line", tool: "none", outboard: 1.08, lateral: 0 },
      { role: "Tool hand", duty: "drives wedges and clears the retreat", tool: "sapper-tool", outboard: .78, lateral: .7 },
    ],
    drill: drill([
      ["survey", "Survey the damaged work", [0]],
      ["haul", "Haul fascines and gabions", [1]],
      ["place", "Place cover on the threatened line", [0, 1]],
      ["brace", "Drive wedges and braces", [0, 2]],
      ["inspect", "Inspect the repaired work", [0, 1, 2]],
    ]),
    effectStage: "brace",
    effectAt: .62,
  },
  {
    id: "red-rescue-winch",
    team: "king",
    name: "Rescue Capstan",
    role: "Block-and-tackle rescue",
    purpose: "Tension a tackle line to steady the crown or haul a fallen Humpty toward ground shelter.",
    machineRole: "rescue",
    munition: "prepared tackle pulls",
    maxAmmunition: 4,
    availableActions: ["reposition"],
    availableTargets: ["humpty"],
    simpleMachines: ["wheel-and-axle", "pulley"],
    affordances: ["anchor the frame", "reeve the tackle", "turn the capstan", "tend the running line", "belay the load"],
    crew: [
      { role: "Capstan captain", duty: "calls the heave and watches Humpty", tool: "none", outboard: .76, lateral: -.72 },
      { role: "Bar hand", duty: "walks the capstan bar under load", tool: "none", outboard: 1.08, lateral: 0 },
      { role: "Rope tender", duty: "tends the tackle and belays the line", tool: "rope-coil", outboard: .76, lateral: .72 },
    ],
    drill: drill([
      ["anchor", "Set the capstan anchors", [0]],
      ["reeve", "Reeve the block and tackle", [2]],
      ["bars", "Man the capstan bars", [0, 1]],
      ["heave", "Heave on the rescue line", [0, 1, 2]],
      ["belay", "Belay and inspect the load", [0, 2]],
    ]),
    effectStage: "heave",
    effectAt: .62,
  },
  {
    id: "red-catch-sledge",
    team: "king",
    name: "Gabion Rescue Cart",
    role: "Last-chance ground rescue",
    purpose: "Roll a straw-lined litter and gabion wall beneath the fall line for one desperate catch.",
    machineRole: "rescue",
    munition: "prepared rescue deployments",
    maxAmmunition: 3,
    availableActions: ["deploy"],
    availableTargets: ["humpty"],
    simpleMachines: ["inclined plane", "wheel-and-axle"],
    affordances: ["unlock the wheels", "push the litter", "brake under the fall line", "set gabions", "receive the casualty"],
    crew: [
      { role: "Cart captain", duty: "steers and calls the brake", tool: "none", outboard: 1.38, lateral: -.6 },
      { role: "Wheel hand", duty: "pushes the litter into the fall line", tool: "none", outboard: 1.5, lateral: 0 },
      { role: "Gabion bearer", duty: "sets the woven shield beside the litter", tool: "sapper-tool", outboard: 1.38, lateral: .6 },
    ],
    drill: drill([
      ["unlock", "Unlock the cart wheels", [0]],
      ["push", "Run the litter forward", [0, 1]],
      ["brake", "Brake beneath the fall line", [0, 1]],
      ["gabions", "Set the gabion shield", [2]],
      ["receive", "Brace the straw litter", [0, 1, 2]],
    ]),
    effectStage: "receive",
    effectAt: .82,
  },
  {
    id: "green-battering-ram",
    team: "queen",
    name: "Demi-Culverin",
    role: "Direct-fire siege cannon",
    purpose: "Fire heavy iron round shot into the foundation or smash exposed equipment.",
    machineRole: "war",
    munition: "iron round shot",
    maxAmmunition: 6,
    availableActions: ["breach"],
    availableTargets: ["foundation", "tower-face", "enemy-machine"],
    simpleMachines: ["wheel-and-axle", "inclined plane", "wedge"],
    affordances: ["quench and sponge the bore", "load powder and wad", "ram round shot", "run out the carriage", "lay the barrel", "touch the vent with slow match"],
    crew: [
      { role: "Gunner", duty: "lays the barrel and touches the vent", tool: "linstock", outboard: .84, lateral: -.72 },
      { role: "Loader", duty: "sponges and rams the bore", tool: "sponge-rammer", outboard: .72, lateral: 0 },
      { role: "Matross", duty: "brings powder, wad, and round shot", tool: "none", outboard: .94, lateral: .72 },
    ],
    drill: drill([
      ["sponge", "Quench and sponge the bore", [1]],
      ["charge", "Load powder and wad", [2]],
      ["ram", "Ram the round shot home", [1, 2]],
      ["run-out", "Run out the carriage", [0, 1, 2]],
      ["lay", "Lay the barrel on target", [0]],
      ["fire", "Touch the vent with slow match", [0]],
    ]),
    effectStage: "fire",
    effectAt: .84,
  },
  {
    id: "green-stone-thrower",
    team: "queen",
    name: "Bed Mortar",
    role: "Arcing shell bombardment",
    purpose: "Lob scarce powder shells over gabions at the tower, Humpty, or Red equipment.",
    machineRole: "war",
    munition: "fused powder shells",
    maxAmmunition: 5,
    availableActions: ["bombard"],
    availableTargets: ["foundation", "tower-face", "humpty", "enemy-machine"],
    simpleMachines: ["inclined plane", "wedge"],
    affordances: ["bed the mortar", "measure the powder charge", "seat the shell", "set elevation", "cut and light the fuse"],
    crew: [
      { role: "Bombardier", duty: "sets elevation and fires the mortar", tool: "linstock", outboard: .82, lateral: -.7 },
      { role: "Shell handler", duty: "seats the fused shell in the bore", tool: "none", outboard: .72, lateral: 0 },
      { role: "Powder hand", duty: "measures the charge and tends the fuse", tool: "sponge-rammer", outboard: .88, lateral: .7 },
    ],
    drill: drill([
      ["bed", "Bed and wedge the mortar", [0, 2]],
      ["charge", "Measure and load the charge", [2]],
      ["shell", "Seat the fused shell", [1]],
      ["elevate", "Set elevation for the target", [0]],
      ["fuse", "Cut and light the shell fuse", [0, 2]],
      ["fire", "Fire the high-angle shell", [0]],
    ]),
    effectStage: "fire",
    effectAt: .84,
  },
  {
    id: "green-ballista",
    team: "queen",
    name: "Matchlock Company",
    role: "Precision volley fire",
    purpose: "Fire a coordinated matchlock volley at Humpty or exposed royal equipment.",
    machineRole: "war",
    munition: "prepared matchlock volleys",
    maxAmmunition: 5,
    availableActions: ["snipe"],
    availableTargets: ["tower-face", "humpty", "enemy-machine"],
    simpleMachines: ["lever", "wedge"],
    affordances: ["charge from bandolier", "prime the pan", "set the slow match", "present on the rest", "fire by rank", "recover behind pikes"],
    crew: [
      { role: "Sergeant", duty: "sets the range and gives the volley command", tool: "matchlock", outboard: .72, lateral: -.62 },
      { role: "First rank", duty: "primes, presents, and fires from the rest", tool: "matchlock", outboard: .72, lateral: 0 },
      { role: "Second rank", duty: "loads while the first rank fires", tool: "matchlock", outboard: .72, lateral: .62 },
    ],
    drill: drill([
      ["charge", "Charge from the bandolier", [1, 2]],
      ["prime", "Prime pans and set slow match", [0, 1, 2]],
      ["shoulder", "Shoulder the matchlocks", [1, 2]],
      ["present", "Present on the firing rests", [0, 1, 2]],
      ["volley", "Fire by rank", [0, 1, 2]],
      ["recover", "Recover behind the pike line", [0, 1, 2]],
    ]),
    effectStage: "volley",
    effectAt: .68,
  },
] as const;

export function siegeEquipment(id: BattleUnitId | string): SiegeEquipmentDefinition | undefined {
  return SIEGE_EQUIPMENT.find((definition) => definition.id === id);
}

export function siegeDrillStage(id: BattleUnitId | string, progress: number): SiegeDrillStage | undefined {
  const definition = siegeEquipment(id);
  const clamped = Math.max(0, Math.min(.999999, progress));
  return definition?.drill.find((stage) => clamped >= stage.from && clamped < stage.to)
    ?? definition?.drill.at(-1);
}

function drill(stages: Array<[string, string, number[]]>): SiegeDrillStage[] {
  return stages.map(([id, label, leadCrew], index) => ({
    id,
    label,
    from: index / stages.length,
    to: (index + 1) / stages.length,
    leadCrew,
  }));
}
