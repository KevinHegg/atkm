import type { PartFamily, Team, Vec3 } from "../../shared/core-protocol.js";

export interface InventoryDefinition {
  definitionId: string;
  family: PartFamily;
  variant: string;
  quantity: number;
  size: Vec3;
  mass: number;
  oneWorker: boolean;
}

export const INVENTORY_DEFINITIONS: readonly InventoryDefinition[] = [
  {
    definitionId: "beam_short",
    family: "beam",
    variant: "short-0.60m",
    quantity: 2,
    size: { x: 0.14, y: 0.14, z: 0.6 },
    mass: 12,
    oneWorker: true,
  },
  {
    definitionId: "beam_medium",
    family: "beam",
    variant: "medium-1.20m",
    quantity: 2,
    size: { x: 0.14, y: 0.14, z: 1.2 },
    mass: 21,
    oneWorker: true,
  },
  {
    definitionId: "beam_long",
    family: "beam",
    variant: "long-1.80m",
    quantity: 2,
    size: { x: 0.14, y: 0.14, z: 1.8 },
    mass: 31,
    oneWorker: false,
  },
  {
    definitionId: "hub",
    family: "hub",
    variant: "octagonal",
    quantity: 4,
    size: { x: 0.54, y: 0.54, z: 0.28 },
    mass: 22,
    oneWorker: true,
  },
  {
    definitionId: "axle_short",
    family: "axle",
    variant: "short-keyed-0.70m",
    quantity: 1,
    size: { x: 0.12, y: 0.12, z: 0.7 },
    mass: 18,
    oneWorker: true,
  },
  {
    definitionId: "axle_long",
    family: "axle",
    variant: "long-keyed-1.30m",
    quantity: 1,
    size: { x: 0.12, y: 0.12, z: 1.3 },
    mass: 29,
    oneWorker: true,
  },
  {
    definitionId: "wheel",
    family: "wheel",
    variant: "spoked-0.70m",
    quantity: 2,
    size: { x: 0.7, y: 0.14, z: 0.7 },
    mass: 25,
    oneWorker: true,
  },
  {
    definitionId: "sheave",
    family: "sheave",
    variant: "deep-groove-0.48m",
    quantity: 2,
    size: { x: 0.48, y: 0.18, z: 0.48 },
    mass: 14,
    oneWorker: true,
  },
  {
    definitionId: "drum",
    family: "drum",
    variant: "rope-winding-0.38m",
    quantity: 1,
    size: { x: 0.38, y: 0.42, z: 0.38 },
    mass: 23,
    oneWorker: true,
  },
  {
    definitionId: "plank",
    family: "plank",
    variant: "broad-1.80x0.48m",
    quantity: 2,
    size: { x: 0.48, y: 0.1, z: 1.8 },
    mass: 28,
    oneWorker: false,
  },
  {
    definitionId: "rope_hook",
    family: "rope",
    variant: "hooked-3.50m",
    quantity: 2,
    size: { x: 0.44, y: 0.12, z: 0.44 },
    mass: 8,
    oneWorker: true,
  },
  {
    definitionId: "wedge",
    family: "wedge",
    variant: "iron-shod-0.55m",
    quantity: 3,
    size: { x: 0.55, y: 0.24, z: 0.3 },
    mass: 11,
    oneWorker: true,
  },
] as const;

export const INVENTORY_COUNT = INVENTORY_DEFINITIONS.reduce(
  (total, definition) => total + definition.quantity,
  0,
);

export const TEAM_WORKERS: Readonly<Record<Team, readonly string[]>> = {
  king: ["Bell", "March", "Pike"],
  queen: ["Vex", "Moth", "Knell"],
};

export function inventoryId(
  team: Team,
  family: PartFamily,
  variant: string,
  index: number,
): string {
  return `${team}-${family}-${variant}-${String(index + 1).padStart(2, "0")}`;
}
