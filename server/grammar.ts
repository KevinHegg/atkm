import materialsSource from "../data/materials.json";
import portsSource from "../data/ports.json";
import partsSource from "../data/parts.json";
import compatibilitySource from "../data/compatibility-matrix.json";
import grammarManifest from "../all-the-kings-men-machine-grammar.json";
import type {
  CompatibilityRule,
  MachineGrammarData,
  PartDefinitionData,
  PortKind,
} from "../shared/machines.js";

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Machine grammar: ${label} must be an object`);
  }
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Machine grammar: ${label} must be a non-empty string`);
  }
}

function uniqueIds(values: Array<{ id: string }>, label: string): void {
  const ids = new Set<string>();
  for (const value of values) {
    assertString(value.id, `${label}.id`);
    if (ids.has(value.id)) throw new Error(`Machine grammar: duplicate ${label} id ${value.id}`);
    ids.add(value.id);
  }
}

function validatePart(part: PartDefinitionData, materialIds: Set<string>, portIds: Set<string>): void {
  assertString(part.id, "part.id");
  assertString(part.label, `${part.id}.label`);
  if (!materialIds.has(part.materialId)) {
    throw new Error(`Machine grammar: ${part.id} references missing material ${part.materialId}`);
  }
  if (!isFiniteNumber(part.mass) || part.mass <= 0) {
    throw new Error(`Machine grammar: ${part.id} has invalid mass`);
  }
  if (
    !isFiniteNumber(part.dimensions.width) ||
    !isFiniteNumber(part.dimensions.height) ||
    !isFiniteNumber(part.dimensions.depth) ||
    part.dimensions.width <= 0 ||
    part.dimensions.height <= 0 ||
    part.dimensions.depth <= 0
  ) {
    throw new Error(`Machine grammar: ${part.id} has invalid dimensions`);
  }
  if (!Number.isInteger(part.handling.workers) || part.handling.workers < 1 || part.handling.workers > 2) {
    throw new Error(`Machine grammar: ${part.id} handling.workers must be 1 or 2`);
  }
  if (part.ports.length === 0) throw new Error(`Machine grammar: ${part.id} has no ports`);
  uniqueIds(part.ports, `${part.id}.port`);
  for (const port of part.ports) {
    if (!portIds.has(port.kind)) {
      throw new Error(`Machine grammar: ${part.id}:${port.id} references missing port kind ${port.kind}`);
    }
    const vectors = [port.pose.position, port.pose.normal, port.pose.tangent];
    if (vectors.some((vector) => ![vector.x, vector.y, vector.z].every(isFiniteNumber))) {
      throw new Error(`Machine grammar: ${part.id}:${port.id} has a non-finite pose`);
    }
  }
  if (part.affordances.length < 2 || part.nonAffordances.length < 2) {
    throw new Error(`Machine grammar: ${part.id} needs at least two affordances and non-affordances`);
  }
}

function validateRule(rule: CompatibilityRule, portIds: Set<string>): void {
  if (!portIds.has(rule.first) || !portIds.has(rule.second)) {
    throw new Error(`Machine grammar: compatibility references ${rule.first}>${rule.second}`);
  }
  if (
    !isFiniteNumber(rule.tolerance.distance) ||
    rule.tolerance.distance <= 0 ||
    !isFiniteNumber(rule.tolerance.angleDegrees) ||
    rule.tolerance.angleDegrees <= 0
  ) {
    throw new Error(`Machine grammar: invalid tolerance for ${rule.first}>${rule.second}`);
  }
  if (
    !isFiniteNumber(rule.safeLoad) ||
    !isFiniteNumber(rule.warningLoad) ||
    !isFiniteNumber(rule.breakForce) ||
    rule.warningLoad >= rule.safeLoad ||
    rule.safeLoad >= rule.breakForce
  ) {
    throw new Error(`Machine grammar: load thresholds must increase for ${rule.first}>${rule.second}`);
  }
}

const REQUIRED_OPENING_INVENTORY = new Map<string, number>([
  ["beam_short", 2],
  ["beam_medium", 2],
  ["beam_long", 2],
  ["hub", 4],
  ["axle_short", 1],
  ["axle_long", 1],
  ["wheel", 2],
  ["sheave", 2],
  ["drum", 1],
  ["plank", 2],
  ["rope_hook", 2],
  ["wedge", 3],
]);

export function validateMachineGrammar(raw: unknown): MachineGrammarData {
  assertRecord(raw, "root");
  const candidate = raw as unknown as MachineGrammarData;
  if (
    !Array.isArray(candidate.materials) ||
    !Array.isArray(candidate.portTypes) ||
    !Array.isArray(candidate.parts) ||
    !Array.isArray(candidate.compatibility) ||
    !candidate.inventory
  ) {
    throw new Error("Machine grammar: missing root collections");
  }
  uniqueIds(candidate.materials, "material");
  uniqueIds(candidate.portTypes, "port type");
  uniqueIds(candidate.parts, "part");
  const materialIds = new Set(candidate.materials.map((material) => material.id));
  const portIds = new Set(candidate.portTypes.map((port) => port.id));
  candidate.parts.forEach((part) => validatePart(part, materialIds, portIds));
  candidate.compatibility.forEach((rule) => validateRule(rule, portIds));
  const partIds = new Set(candidate.parts.map((part) => part.id));
  const total = candidate.inventory.entries.reduce((sum, entry) => {
    if (!partIds.has(entry.definitionId)) {
      throw new Error(`Machine grammar: inventory references missing part ${entry.definitionId}`);
    }
    if (!Number.isInteger(entry.quantity) || entry.quantity < 1) {
      throw new Error(`Machine grammar: invalid quantity for ${entry.definitionId}`);
    }
    return sum + entry.quantity;
  }, 0);
  if (total !== candidate.inventory.countPerTeam || total !== 24) {
    throw new Error(`Machine grammar: inventory declares ${candidate.inventory.countPerTeam} but contains ${total}`);
  }
  if (candidate.inventory.entries.length !== REQUIRED_OPENING_INVENTORY.size) {
    throw new Error("Machine grammar: opening inventory must contain the eleven required object classes");
  }
  for (const [definitionId, quantity] of REQUIRED_OPENING_INVENTORY) {
    const actual = candidate.inventory.entries.find(
      (entry) => entry.definitionId === definitionId,
    )?.quantity;
    if (actual !== quantity) {
      throw new Error(
        `Machine grammar: opening inventory requires ${quantity} ${definitionId}, received ${actual ?? 0}`,
      );
    }
  }
  return candidate;
}

const rawGrammar = {
  materials: materialsSource.materials,
  portTypes: portsSource.ports,
  parts: partsSource.parts,
  compatibility: compatibilitySource.compatibility,
  inventory: grammarManifest.inventory,
};

export const machineGrammar = validateMachineGrammar(rawGrammar);

export const materialById = new Map(
  machineGrammar.materials.map((material) => [material.id, material]),
);
export const partDefinitionById = new Map(
  machineGrammar.parts.map((part) => [part.id, part]),
);

export function compatibilityRule(
  first: PortKind,
  second: PortKind,
): CompatibilityRule | undefined {
  return machineGrammar.compatibility.find(
    (rule) =>
      (rule.first === first && rule.second === second) ||
      (rule.first === second && rule.second === first),
  );
}

export function acceptedPortKinds(kind: PortKind): PortKind[] {
  const accepted = new Set<PortKind>();
  for (const rule of machineGrammar.compatibility) {
    if (rule.first === kind) accepted.add(rule.second);
    if (rule.second === kind && !rule.directional) accepted.add(rule.first);
    if (rule.second === kind && rule.directional) accepted.add(rule.first);
  }
  return [...accepted];
}
