import type {
  ConnectionClass,
  PartFamily,
} from "../../shared/core-protocol.js";

const TENON_RECEIVERS = new Set<PartFamily>(["hub", "plank", "wedge", "drum"]);
const BEARING_RECEIVERS = new Set<PartFamily>(["hub", "sheave", "plank"]);
const KEYED_RECEIVERS = new Set<PartFamily>(["wheel", "sheave", "drum"]);
const ROPE_RECEIVERS = new Set<PartFamily>(["plank", "sheave", "drum"]);

export type PhysicalJointKind = "fixed" | "revolute" | "rope";

export function connectionJointKind(connectionClass: ConnectionClass): PhysicalJointKind {
  if (connectionClass === "AXLE_BEARING") return "revolute";
  if (connectionClass === "ROPE_ATTACH") return "rope";
  return "fixed";
}

export function connectionClassSupportsFamilies(
  connectionClass: ConnectionClass,
  first: PartFamily | undefined,
  second: PartFamily | undefined,
): boolean {
  if (!first || !second || first === second) return false;
  if (connectionClass === "TENON_LOCK") return isPair(first, second, "beam", TENON_RECEIVERS);
  if (connectionClass === "AXLE_BEARING") return isPair(first, second, "axle", BEARING_RECEIVERS);
  if (connectionClass === "KEYED_COAXIAL") return isPair(first, second, "axle", KEYED_RECEIVERS);
  return isPair(first, second, "rope", ROPE_RECEIVERS);
}

function isPair(
  first: PartFamily,
  second: PartFamily,
  source: PartFamily,
  receivers: ReadonlySet<PartFamily>,
): boolean {
  return (first === source && receivers.has(second)) ||
    (second === source && receivers.has(first));
}
