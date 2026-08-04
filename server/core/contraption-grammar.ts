import type { LegalActionRequest, Team } from "../../shared/core-protocol.js";
import type { CompoundPlanOption } from "./compound-plans.js";

export interface ContraptionRecipe {
  id: string;
  basePlanId: string;
  team: Team;
  label: string;
  machineOrder: readonly string[];
  crewOrder: readonly string[];
  explanation: string;
}

/**
 * Expands an observed machine into legal crew permutations. The recipe only
 * changes public actor assignments and descriptions; parts, ports, joints,
 * and forces remain owned by the action validator and Rapier.
 */
export function expandContraptionPlans(
  plans: readonly CompoundPlanOption[],
): CompoundPlanOption[] {
  const crewVariants = plans.flatMap((base) => [
    base,
    permutedPlan(base, ["1", "3", "2"], "reversed-crew"),
    permutedPlan(base, ["2", "3", "1"], "rotated-crew"),
  ]);
  const hybridVariants = composeHybridPlans(plans).flatMap((base) => [
    base,
    permutedPlan(base, ["1", "3", "2"], "reversed-crew"),
    permutedPlan(base, ["2", "3", "1"], "rotated-crew"),
  ]);
  return [...crewVariants, ...hybridVariants];
}

export function enumerateContraptionRecipes(
  plans: readonly CompoundPlanOption[],
): ContraptionRecipe[] {
  return expandContraptionPlans(plans).map((plan) => ({
    id: plan.id,
    basePlanId: plan.baseId ?? plan.id,
    team: plan.team,
    label: plan.label,
    machineOrder: plan.simpleMachines,
    crewOrder: plan.id.endsWith("reversed-crew")
      ? ["1", "3", "2"]
      : plan.id.endsWith("rotated-crew") ? ["2", "3", "1"] : ["1", "2", "3"],
    explanation: plan.announcement,
  }));
}

function permutedPlan(
  base: CompoundPlanOption,
  order: readonly [string, string, string],
  suffix: string,
): CompoundPlanOption {
  const baseId = base.baseId ?? base.id;
  return {
    ...base,
    id: `${base.id}:${suffix}`,
    baseId,
    label: `${base.label} / ${suffix.replaceAll("-", " ")}`,
    announcement: `${base.announcement} The crew uses a ${suffix.replaceAll("-", " ")} role permutation.`,
    weight: Math.max(.12, base.weight * .22),
    requests: base.requests.map((request) => ({
      ...request,
      actorIds: request.actorIds.map((actorId) => remapActor(actorId, order)),
    })),
  };
}

function composeHybridPlans(
  plans: readonly CompoundPlanOption[],
): CompoundPlanOption[] {
  const hybrids: CompoundPlanOption[] = [];
  for (let firstIndex = 0; firstIndex < plans.length; firstIndex += 1) {
    const first = plans[firstIndex];
    if (!first) continue;
    for (let secondIndex = firstIndex + 1; secondIndex < plans.length; secondIndex += 1) {
      const second = plans[secondIndex];
      if (!second || second.team !== first.team) continue;
      const hybrid = composePair(first, second);
      if (hybrid) hybrids.push(hybrid);
    }
  }
  return hybrids;
}

function composePair(
  first: CompoundPlanOption,
  second: CompoundPlanOption,
): CompoundPlanOption | undefined {
  const targetId = first.parts.target ?? second.parts.target;
  const partIds = [...Object.values(first.parts), ...Object.values(second.parts)].filter(Boolean);
  for (const [key, value] of Object.entries(first.parts)) {
    const otherValue = second.parts[key];
    if (otherValue && otherValue !== value && value !== targetId && otherValue !== targetId) return undefined;
  }
  const id = `hybrid:${first.id}+${second.id}`;
  const requests = [...first.requests, ...second.requests];
  if (!isPublicActionPacket(requests)) return undefined;
  const counts = new Map(partIds.map((partId) => [partId, (partIds.filter((candidate) => candidate === partId).length)]));
  const targetIds = new Set([first.parts.target, second.parts.target].filter((partId): partId is string => Boolean(partId)));
  if ([...counts].some(([partId, count]) => count > 1 && !targetIds.has(partId))) return undefined;
  return {
    id,
    baseId: id,
    composition: [first.id, second.id],
    componentParts: {
      [first.id]: first.parts,
      [second.id]: second.parts,
    },
    ruleId: "compound-hybrid",
    team: first.team,
    label: `${first.label} + ${second.label}`,
    announcement: `${first.team === "king" ? "Red" : "Green"} composes ${first.simpleMachines.join(" and ")} with ${second.simpleMachines.join(" and ")} into an improvised hybrid machine.`,
    weight: .26,
    simpleMachines: unique(first.simpleMachines, second.simpleMachines),
    capabilities: unique(first.capabilities, second.capabilities),
    requiredFacts: unique(first.requiredFacts, second.requiredFacts),
    observedFacts: unique(first.observedFacts, second.observedFacts),
    eligible: first.eligible && second.eligible,
    parts: { ...first.parts, ...second.parts },
    requests,
  };
}

function unique<T>(first: readonly T[], second: readonly T[]): T[] {
  return [...new Set([...first, ...second])];
}

function remapActor(actorId: string, order: readonly [string, string, string]): string {
  const match = actorId.match(/^(.*-worker-)([123])$/);
  if (!match) return actorId;
  return `${match[1]}${order[Number(match[2]) - 1]}`;
}

export function planBaseId(plan: CompoundPlanOption): string {
  return plan.baseId ?? plan.id;
}

export function isPublicActionPacket(requests: readonly LegalActionRequest[]): boolean {
  return requests.length > 0 && requests.every((request) =>
    request.actorIds.length > 0 && request.actorIds.every((actorId) => /-worker-[123]$/.test(actorId)));
}
