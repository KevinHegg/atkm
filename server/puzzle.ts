import type { ComponentType } from "../shared/protocol.js";
import type {
  CompatibilityRule,
  DerivedCapability,
  PartDefinitionData,
  PortKind,
} from "../shared/machines.js";
import {
  acceptedPortKinds,
  compatibilityRule,
  machineGrammar,
  materialById,
  partDefinitionById,
} from "./grammar.js";

export type PuzzlePortKind = PortKind;

export type PuzzleCapability =
  | "support"
  | "ramp"
  | "pivot"
  | "pull"
  | "push"
  | "lift"
  | "lower"
  | "redirect_rope"
  | "wind_rope"
  | "strike"
  | "support_surface"
  | "brace"
  | "climb"
  | "transport"
  | "rotate"
  | "roll"
  | "multiply_force"
  | "convert_motion"
  | "redirect_force"
  | "store_energy"
  | "hold_load"
  | "release_energy"
  | "tension_link"
  | "anchor"
  | "grip"
  | "interface_load"
  | "aim"
  | "launch_projectile"
  | "shield"
  | "lower_load"
  | "lift_load"
  | "pull_load"
  | "inclined_transport"
  | "split_force"
  | "lock_motion"
  | "transmit_torque"
  | "wind_line"
  | "lever_member"
  | "pivot_support"
  | "bearing_support"
  | "handle"
  | "helical_input"
  | "helical_reaction"
  | "wedge"
  | "chock"
  | "cushion";

const REPAIR_CAPABILITIES = new Set<PuzzleCapability>([
  "support",
  "brace",
  "roll",
  "ramp",
  "pivot",
  "pull",
  "push",
  "lift",
  "lower",
  "redirect_rope",
  "wind_rope",
  "chock",
  "strike",
]);

export interface PuzzlePortDefinition {
  id: string;
  kind: PuzzlePortKind;
  accepts: PuzzlePortKind[];
  pose: PartDefinitionData["ports"][number]["pose"];
}

export interface PuzzlePortPose {
  x: number;
  y: number;
  depth: number;
  normal: number;
}

export interface PuzzlePartDefinition {
  key: string;
  definitionId: string;
  label: string;
  componentType: ComponentType;
  material: string;
  materialId: string;
  mass: number;
  width?: number;
  height?: number;
  radius?: number;
  depth: number;
  handling: PartDefinitionData["handling"];
  ports: PuzzlePortDefinition[];
  affordances: string[];
  constraints: string[];
  capabilities: PuzzleCapability[];
}

export interface PuzzlePartInstance extends PuzzlePartDefinition {
  id: string;
}

export interface PuzzleConnectionView {
  firstId: string;
  secondId: string;
  firstPort?: string;
  secondPort?: string;
  integrity?: number;
  currentLoad?: number;
}

export type SimpleMachineKind =
  | "lever"
  | "wheel_and_axle"
  | "pulley"
  | "inclined_plane"
  | "wedge"
  | "screw";

export interface SimpleMachineEvidence {
  kind: SimpleMachineKind;
  confidence: number;
  partIds: string[];
  inputPortId: string;
  outputPortId: string;
  mechanicalAdvantage: number;
  failureMargin: number;
  evidence: string[];
}

export interface PuzzleAssemblySummary {
  id: string;
  partIds: string[];
  capabilities: PuzzleCapability[];
  derivedCapabilities: DerivedCapability[];
  simpleMachines: SimpleMachineEvidence[];
  mass: number;
  stability: number;
  supportMargin: number;
  failureMargin: number;
  warnings: string[];
}

interface ResolvedEdge {
  first: PuzzlePartInstance;
  second: PuzzlePartInstance;
  firstPort: PuzzlePortDefinition;
  secondPort: PuzzlePortDefinition;
  rule: CompatibilityRule;
  integrity: number;
  currentLoad: number;
}

function asComponentType(value: string): ComponentType {
  return value as ComponentType;
}

function createPartDefinition(source: PartDefinitionData): PuzzlePartDefinition {
  const material = materialById.get(source.materialId);
  if (!material) throw new Error(`Missing material ${source.materialId}`);
  const base = {
    key: source.id,
    definitionId: source.id,
    label: source.label,
    componentType: asComponentType(source.componentType),
    material: `${material.label.toLowerCase()}; ${material.appearance}`,
    materialId: source.materialId,
    mass: source.mass,
    width: source.dimensions.width,
    height: source.dimensions.height,
    depth: source.dimensions.depth,
    handling: { ...source.handling },
    ports: source.ports.map((sourcePort) => ({
      id: sourcePort.id,
      kind: sourcePort.kind,
      accepts: acceptedPortKinds(sourcePort.kind),
      pose: {
        position: { ...sourcePort.pose.position },
        normal: { ...sourcePort.pose.normal },
        tangent: { ...sourcePort.pose.tangent },
        rotationalSymmetry: sourcePort.pose.rotationalSymmetry,
      },
    })),
    affordances: [...source.affordances],
    constraints: [...source.nonAffordances],
    capabilities: [...source.intrinsicCapabilities] as PuzzleCapability[],
  };
  return source.dimensions.radius === undefined
    ? base
    : { ...base, radius: source.dimensions.radius };
}

export function puzzlePortPose(
  part: PuzzlePartDefinition,
  portId: string,
): PuzzlePortPose {
  const port = part.ports.find((candidate) => candidate.id === portId);
  if (!port) throw new Error(`Unknown port ${part.key}:${portId}`);
  const width = part.width ?? (part.radius ?? 18) * 2;
  const height = part.height ?? (part.radius ?? 14) * 2;
  return {
    x: port.pose.position.x * width,
    y: port.pose.position.y * height,
    depth: port.pose.position.z * part.depth,
    normal: Math.atan2(port.pose.normal.y, port.pose.normal.x),
  };
}

export function portsCompatible(
  first: PuzzlePortDefinition,
  second: PuzzlePortDefinition,
): boolean {
  return !!compatibilityRule(first.kind, second.kind);
}

export function connectionRule(
  first: PuzzlePortDefinition,
  second: PuzzlePortDefinition,
): CompatibilityRule | undefined {
  return compatibilityRule(first.kind, second.kind);
}

export function gameplayPuzzleCatalog(): PuzzlePartInstance[] {
  const instances: PuzzlePartInstance[] = [];
  for (const entry of machineGrammar.inventory.entries) {
    const source = partDefinitionById.get(entry.definitionId);
    if (!source) throw new Error(`Missing opening part ${entry.definitionId}`);
    for (let index = 1; index <= entry.quantity; index += 1) {
      const definition = createPartDefinition(source);
      instances.push({
        ...definition,
        id: `${entry.definitionId}_${String(index).padStart(2, "0")}`,
      });
    }
  }
  return instances;
}

// Kept as a public compatibility alias for tests and data-inspection tools.
export function disassembleMachineCatalog(): PuzzlePartInstance[] {
  return gameplayPuzzleCatalog();
}

function resolveEdges(
  partIds: string[],
  parts: Map<string, PuzzlePartInstance>,
  connections: PuzzleConnectionView[],
): ResolvedEdge[] {
  const members = new Set(partIds);
  return connections.flatMap((connection) => {
    if (!members.has(connection.firstId) || !members.has(connection.secondId)) return [];
    const first = parts.get(connection.firstId);
    const second = parts.get(connection.secondId);
    if (!first || !second) return [];
    const explicitFirst = connection.firstPort
      ? first.ports.find((port) => port.id === connection.firstPort)
      : undefined;
    const explicitSecond = connection.secondPort
      ? second.ports.find((port) => port.id === connection.secondPort)
      : undefined;
    let selected:
      | { firstPort: PuzzlePortDefinition; secondPort: PuzzlePortDefinition; rule: CompatibilityRule }
      | undefined;
    if (explicitFirst && explicitSecond) {
      const rule = connectionRule(explicitFirst, explicitSecond);
      if (rule) selected = { firstPort: explicitFirst, secondPort: explicitSecond, rule };
    } else {
      for (const firstPort of first.ports) {
        for (const secondPort of second.ports) {
          const rule = connectionRule(firstPort, secondPort);
          if (rule) {
            selected = { firstPort, secondPort, rule };
            break;
          }
        }
        if (selected) break;
      }
    }
    if (!selected) return [];
    return [{
      first,
      second,
      ...selected,
      integrity: Math.max(0, Math.min(1, connection.integrity ?? 1)),
      currentLoad: Math.max(0, connection.currentLoad ?? 0),
    }];
  });
}

function hasKind(edge: ResolvedEdge, first: PortKind, second: PortKind): boolean {
  return (
    (edge.firstPort.kind === first && edge.secondPort.kind === second) ||
    (edge.firstPort.kind === second && edge.secondPort.kind === first)
  );
}

function connectedPart(edge: ResolvedEdge, componentType: ComponentType): PuzzlePartInstance | undefined {
  if (edge.first.componentType === componentType) return edge.first;
  if (edge.second.componentType === componentType) return edge.second;
  return undefined;
}

function portRef(part: PuzzlePartInstance, port: PuzzlePortDefinition): string {
  return `${part.id}:${port.id}`;
}

function recognizeSimpleMachines(
  members: PuzzlePartInstance[],
  edges: ResolvedEdge[],
): SimpleMachineEvidence[] {
  const found: SimpleMachineEvidence[] = [];
  for (const axle of members.filter((part) => part.componentType === "axle")) {
    const axleEdges = edges.filter((edge) => edge.first.id === axle.id || edge.second.id === axle.id);
    const wheelEdge = axleEdges.find((edge) => !!connectedPart(edge, "wheel") && hasKind(edge, "key_flat", "keyway"));
    const supportEdge = axleEdges.find((edge) => !!connectedPart(edge, "cheek") && hasKind(edge, "axle_shaft", "bearing_bore"));
    if (!wheelEdge || !supportEdge) continue;
    const wheel = connectedPart(wheelEdge, "wheel")!;
    const wheelRadius = wheel.radius ?? (wheel.height ?? 58) / 2;
    const axleRadius = Math.max(4, (axle.height ?? 12) / 2);
    found.push({
      kind: "wheel_and_axle",
      confidence: Math.min(wheelEdge.integrity, supportEdge.integrity) * 0.96,
      partIds: [axle.id, wheel.id, connectedPart(supportEdge, "cheek")!.id],
      inputPortId: `${wheel.id}:rim`,
      outputPortId: `${axle.id}:axis`,
      mechanicalAdvantage: Math.round((wheelRadius / axleRadius) * 100) / 100,
      failureMargin: Math.max(0, 1 - Math.max(wheelEdge.currentLoad / wheelEdge.rule.breakForce, supportEdge.currentLoad / supportEdge.rule.breakForce)),
      evidence: ["wheel bore and support bearing share one two-ended axle", "wheel radius exceeds axle radius"],
    });
  }

  for (const sheave of members.filter((part) => part.componentType === "sheave")) {
    const ropeEdge = edges.find(
      (edge) =>
        (edge.first.id === sheave.id || edge.second.id === sheave.id) &&
        hasKind(edge, "rope_end", "sheave_groove"),
    );
    if (!ropeEdge) continue;
    const anchorEdge = edges.find(
      (edge) =>
        (edge.first.id === sheave.id || edge.second.id === sheave.id) &&
        hasKind(edge, "hook", "load_eye"),
    );
    const rope = connectedPart(ropeEdge, "lashing");
    if (!rope) continue;
    const sheaveCount = members.filter((part) => part.componentType === "sheave").length;
    const anchored = anchorEdge ? 1 : 0;
    found.push({
      kind: "pulley",
      confidence: ropeEdge.integrity * (anchorEdge ? 0.94 : 0.72),
      partIds: [sheave.id, rope.id, ...(anchorEdge ? [anchorEdge.first.id === sheave.id ? anchorEdge.second.id : anchorEdge.first.id] : [])],
      inputPortId: `${rope.id}:free_line`,
      outputPortId: `${sheave.id}:reaction`,
      mechanicalAdvantage: Math.max(1, Math.min(2, sheaveCount + anchored - 1)),
      failureMargin: Math.max(0, 1 - ropeEdge.currentLoad / ropeEdge.rule.breakForce),
      evidence: ["tension line is reeved through a rotating groove", anchorEdge ? "block has a connected reaction point" : "block currently redirects without a fixed reaction"],
    });
  }

  for (const deck of members.filter((part) => part.componentType === "platform")) {
    const supports = edges.filter(
      (edge) =>
        (edge.first.id === deck.id || edge.second.id === deck.id) &&
        edge.rule.joint === "fixed",
    );
    if (supports.length === 0) continue;
    const distinctSupportHeights = new Set(
      supports.map((edge) => Math.round((edge.first.id === deck.id ? edge.second.height : edge.first.height) ?? 0)),
    );
    found.push({
      kind: "inclined_plane",
      confidence: Math.min(0.9, 0.68 + supports.length * 0.1),
      partIds: [deck.id, ...supports.map((edge) => edge.first.id === deck.id ? edge.second.id : edge.first.id)],
      inputPortId: `${deck.id}:lower_edge`,
      outputPortId: `${deck.id}:upper_edge`,
      mechanicalAdvantage: Math.max(1, (deck.width ?? 116) / Math.max(24, [...distinctSupportHeights][0] ?? 24)),
      failureMargin: Math.min(...supports.map((edge) => Math.max(0, 1 - edge.currentLoad / edge.rule.breakForce))),
      evidence: ["continuous load surface has a rigid support reaction", "surface length exceeds support rise"],
    });
  }

  return found;
}

function addCapability(
  target: Map<PuzzleCapability, DerivedCapability>,
  id: PuzzleCapability,
  machine: SimpleMachineEvidence,
  stability: number,
): void {
  const candidate: DerivedCapability = {
    id,
    confidence: Math.round(machine.confidence * 100) / 100,
    inputPortId: machine.inputPortId,
    outputPortId: machine.outputPortId,
    expectedDirection: { x: id === "redirect_force" ? -1 : 1, y: id === "lift_load" ? 1 : 0, z: 0 },
    ratio: machine.mechanicalAdvantage,
    currentLoad: 0,
    clearance: 1,
    stability,
    failureMargin: machine.failureMargin,
    evidence: [...machine.evidence],
  };
  const current = target.get(id);
  if (!current || current.confidence < candidate.confidence) target.set(id, candidate);
}

export function summarizeAssembly(
  partIds: string[],
  parts: Map<string, PuzzlePartInstance>,
  connections: PuzzleConnectionView[],
): PuzzleAssemblySummary {
  const members = partIds
    .map((id) => parts.get(id))
    .filter((part): part is PuzzlePartInstance => !!part);
  const edges = resolveEdges(partIds, parts, connections);
  const capabilities = new Set<PuzzleCapability>(members.flatMap((part) => part.capabilities));
  const machines = recognizeSimpleMachines(members, edges);
  const supportParts = members.filter((part) =>
    part.ports.some((port) => port.kind === "ground_foot") || part.capabilities.includes("support"),
  );
  const requiredEdges = Math.max(1, members.length - 1);
  const connectivity = members.length <= 1 ? 0 : Math.min(1, edges.length / requiredEdges);
  const supportMargin = Math.min(1, supportParts.length * 0.22 + (capabilities.has("chock") ? 0.16 : 0));
  const averageIntegrity = edges.length === 0
    ? 1
    : edges.reduce((sum, edge) => sum + edge.integrity, 0) / edges.length;
  const stability = Math.max(0, Math.min(1, connectivity * 0.5 + supportMargin * 0.35 + averageIntegrity * 0.15));
  const derived = new Map<PuzzleCapability, DerivedCapability>();

  for (const machine of machines) {
    switch (machine.kind) {
      case "lever":
        capabilities.add("multiply_force");
        capabilities.add("convert_motion");
        addCapability(derived, "multiply_force", machine, stability);
        addCapability(derived, "convert_motion", machine, stability);
        break;
      case "wheel_and_axle":
        capabilities.add("transport");
        capabilities.add("multiply_force");
        addCapability(derived, "transport", machine, stability);
        addCapability(derived, "multiply_force", machine, stability);
        break;
      case "pulley":
        capabilities.add("redirect_force");
        addCapability(derived, "redirect_force", machine, stability);
        if (machine.mechanicalAdvantage > 1) {
          capabilities.add("multiply_force");
          addCapability(derived, "multiply_force", machine, stability);
        }
        break;
      case "inclined_plane":
        capabilities.add("inclined_transport");
        capabilities.add("multiply_force");
        addCapability(derived, "inclined_transport", machine, stability);
        addCapability(derived, "multiply_force", machine, stability);
        break;
      case "wedge":
        capabilities.add("lock_motion");
        capabilities.add("multiply_force");
        addCapability(derived, "lock_motion", machine, stability);
        addCapability(derived, "multiply_force", machine, stability);
        break;
      case "screw":
        capabilities.add("multiply_force");
        capabilities.add("convert_motion");
        capabilities.add("hold_load");
        addCapability(derived, "multiply_force", machine, stability);
        addCapability(derived, "convert_motion", machine, stability);
        addCapability(derived, "hold_load", machine, stability);
        break;
    }
  }

  const has = (capability: PuzzleCapability): boolean => capabilities.has(capability);
  if (has("wind_line") && has("tension_link") && has("bearing_support")) {
    capabilities.add("hold_load");
    capabilities.add("pull_load");
    capabilities.add("lower_load");
  }
  if (has("interface_load") && has("tension_link") && has("redirect_force") && has("hold_load")) {
    capabilities.add("lift_load");
    capabilities.add("lower_load");
  }
  const supportedLever = machines.some((machine) => machine.kind === "lever");
  if (
    supportedLever &&
    has("interface_load") &&
    has("tension_link") &&
    has("multiply_force") &&
    stability >= 0.48
  ) {
    capabilities.add("launch_projectile");
    capabilities.add("aim");
  }
  if (members.filter((part) => part.componentType === "bar").length >= 2 && has("brace")) {
    capabilities.add("climb");
  }

  const failureMargin = edges.length === 0
    ? 1
    : Math.min(...edges.map((edge) => Math.max(0, 1 - edge.currentLoad / edge.rule.breakForce)));
  const warnings: string[] = [];
  if (members.length > 1 && connectivity < 1) warnings.push("assembly graph is disconnected");
  if (supportMargin < 0.25 && members.length > 1) warnings.push("support polygon is narrow");
  if (failureMargin < 0.25) warnings.push("a connection is near failure load");
  if (edges.some((edge) => edge.currentLoad > edge.rule.warningLoad)) warnings.push("joint working load exceeded");

  return {
    id: [...partIds].sort()[0] ?? "empty_assembly",
    partIds: [...partIds].sort(),
    capabilities: [...capabilities]
      .filter((capability) => REPAIR_CAPABILITIES.has(capability))
      .sort(),
    derivedCapabilities: [...derived.values()]
      .filter((capability) => REPAIR_CAPABILITIES.has(capability.id as PuzzleCapability))
      .sort((a, b) => a.id.localeCompare(b.id)),
    simpleMachines: machines,
    mass: members.reduce((total, part) => total + part.mass, 0),
    stability: Math.round(stability * 100) / 100,
    supportMargin: Math.round(supportMargin * 100) / 100,
    failureMargin: Math.round(failureMargin * 100) / 100,
    warnings,
  };
}
