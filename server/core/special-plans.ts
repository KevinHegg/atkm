import type { LegalActionRequest, Team } from "../../shared/core-protocol.js";
import type { MachineCapability, SimpleMachineId } from "../../shared/agent-rules.js";
import type { CompoundPlanOption } from "./compound-plans.js";
import { CorePhysicsWorld } from "./physics.js";

export function specialPlans(physics: CorePhysicsWorld, team: Team): CompoundPlanOption[] {
  return team === "queen"
    ? queenAdvantagePlans(physics)
    : redCounterplayPlans(physics);
}

export function queenAdvantagePlans(physics: CorePhysicsWorld): CompoundPlanOption[] {
  const state = physics.queenAdvantageState();
  const workerId = physics.workerIds("queen")[0];
  const deviceId = state.deviceId;
  const targetId = physics.records.has("humpty") ? "humpty" : undefined;
  if (!workerId || !targetId || state.disabled || state.charges <= 0) return [];
  const boltId = `queen-crown-bolt-${state.maxCharges - state.charges + 1}`;
  const requiredFacts = [
    "queen-command-post-intact",
    "queen-crown-bolt-available",
    "humpty-still-aloft",
  ] as const;
  const observedFacts = compactFacts([
    ["queen-command-post-intact", !state.disabled],
    ["queen-crown-bolt-available", state.charges > 0],
    ["humpty-still-aloft", (physics.bodyPosition(targetId)?.y ?? 0) > .8],
  ]);
  const requests: LegalActionRequest[] = [
    { action: "fetch", actorIds: [workerId], targetId: deviceId },
    { action: "hold", actorIds: [workerId], targetId: deviceId, magnitude: .6 },
    { action: "operate", actorIds: [workerId], targetId: deviceId },
  ];
  return [{
    id: `queen-crown-bolt-${state.maxCharges - state.charges + 1}`,
    ruleId: "fire-queen-crown-bolt",
    team: "queen",
    label: "command post + crown bolt",
    announcement: "Green wakes the Queen's war engine and fires a crown bolt through the open lane.",
    weight: 1.55,
    simpleMachines: ["wheel-and-axle", "lever"],
    capabilities: ["launch", "strike"],
    requiredFacts,
    observedFacts,
    eligible: requiredFacts.every((fact) => observedFacts.includes(fact)),
    parts: { device: deviceId, bolt: boltId, target: targetId },
    requests,
  }];
}

export function redCounterplayPlans(physics: CorePhysicsWorld): CompoundPlanOption[] {
  const state = physics.queenAdvantageState();
  const workers = physics.workerIds("king");
  const first = workers[0];
  const second = workers[1];
  const targetId = state.deviceId;
  if (!first || !second || state.disabled) return [];
  const requiredFacts = [
    "queen-command-post-exposed",
    "red-striking-crew-ready",
    "humpty-still-aloft",
  ] as const;
  const observedFacts = compactFacts([
    ["queen-command-post-exposed", !state.disabled],
    ["red-striking-crew-ready", Boolean(first && second)],
    ["humpty-still-aloft", (physics.bodyPosition("humpty")?.y ?? 0) > .8],
  ]);
  return [{
    id: "red-strike-queen-command-post",
    ruleId: "strike-queen-command-post",
    team: "king",
    label: "two-worker crowbar assault",
    announcement: "Red breaks formation and drives a two-worker strike at the Queen's command post.",
    weight: 1.5,
    simpleMachines: ["lever", "wedge"],
    capabilities: ["strike"],
    requiredFacts,
    observedFacts,
    eligible: requiredFacts.every((fact) => observedFacts.includes(fact)),
    parts: { device: targetId },
    requests: [
      { action: "fetch", actorIds: [first, second], targetId },
      { action: "strike", actorIds: [first, second], targetId },
      { action: "strike", actorIds: [first, second], targetId },
    ],
  }];
}

function compactFacts(entries: readonly (readonly [string, boolean])[]): string[] {
  return entries.filter(([, observed]) => observed).map(([fact]) => fact);
}

export const SPECIAL_MACHINE_TYPES: readonly SimpleMachineId[] = ["lever", "wheel-and-axle", "wedge"];
export const SPECIAL_CAPABILITIES: readonly MachineCapability[] = ["launch", "strike"];
