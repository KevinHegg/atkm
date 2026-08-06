import type {
  BattleOrderAction,
  BattleOrderState,
  BattleRoundRecord,
  BattleTargetId,
  BattleTargetState,
  BattleUnitId,
  BattleUnitState,
  Team,
} from "../../shared/core-protocol.js";

export const SIEGE_MAX_ROUNDS = 10;

interface SiegeState {
  units: Record<BattleUnitId, BattleUnitState>;
  targets: Record<"foundation" | "tower-face" | "humpty", BattleTargetState>;
  history: BattleRoundRecord[];
  doctrine: Record<Team, string>;
  catchReady: boolean;
  catchUsed: boolean;
  humptyPosition: "crown" | "sheltered" | "exposed";
  foundationCollapsed: boolean;
}

interface OrderChoice {
  team: Team;
  unitId: BattleUnitId;
  action: BattleOrderAction;
  targetId: BattleTargetId;
}

interface RoundResolution {
  kingOrder: BattleOrderState;
  queenOrder: BattleOrderState;
  summary: string;
  outcome?: "king" | "queen";
}

const TARGET_NAMES: Record<BattleTargetId, string> = {
  foundation: "the tower foundation",
  "tower-face": "the exposed tower face",
  humpty: "Humpty",
  "enemy-machine": "enemy equipment",
};

const ORDER_LABELS: Record<BattleOrderAction, string> = {
  hold: "holds before",
  breach: "drives against",
  bombard: "bombards",
  snipe: "takes aim at",
  fortify: "braces",
  reposition: "hauls",
  deploy: "deploys beneath",
  raid: "raids",
};

const UNIT_BLUEPRINTS: readonly BattleUnitState[] = [
  {
    id: "red-engineers",
    team: "king",
    name: "Field Engineers",
    role: "Fortification and raids",
    purpose: "Brace a threatened position, repair damage, or raid Green equipment.",
    integrity: 100,
    maxIntegrity: 100,
    ammunition: 6,
    maxAmmunition: 6,
    cooldown: 0,
    state: "ready",
    availableActions: ["fortify", "raid"],
    availableTargets: ["foundation", "tower-face", "humpty", "enemy-machine"],
  },
  {
    id: "red-rescue-winch",
    team: "king",
    name: "Rescue Winch",
    role: "Royal repositioning",
    purpose: "Move Humpty between the crown and prepared shelter before a strike lands.",
    integrity: 100,
    maxIntegrity: 100,
    ammunition: 4,
    maxAmmunition: 4,
    cooldown: 0,
    state: "ready",
    availableActions: ["reposition"],
    availableTargets: ["humpty"],
  },
  {
    id: "red-catch-sledge",
    team: "king",
    name: "Catch-Net Sledge",
    role: "Last-chance rescue",
    purpose: "Deploy a mobile catch bed that can turn one lethal fall into a second chance.",
    integrity: 100,
    maxIntegrity: 100,
    ammunition: 3,
    maxAmmunition: 3,
    cooldown: 0,
    state: "ready",
    availableActions: ["deploy"],
    availableTargets: ["humpty"],
  },
  {
    id: "green-battering-ram",
    team: "queen",
    name: "Battering Ram",
    role: "Foundation breaker",
    purpose: "Deliver reliable heavy damage to masonry or crush exposed equipment.",
    integrity: 100,
    maxIntegrity: 100,
    ammunition: 6,
    maxAmmunition: 6,
    cooldown: 0,
    state: "ready",
    availableActions: ["breach"],
    availableTargets: ["foundation", "tower-face", "enemy-machine"],
  },
  {
    id: "green-stone-thrower",
    team: "queen",
    name: "Siege Mortar",
    role: "High explosive bombardment",
    purpose: "Arc scarce shells over defenses at structures, Humpty, or Red equipment.",
    integrity: 100,
    maxIntegrity: 100,
    ammunition: 5,
    maxAmmunition: 5,
    cooldown: 0,
    state: "ready",
    availableActions: ["bombard"],
    availableTargets: ["foundation", "tower-face", "humpty", "enemy-machine"],
  },
  {
    id: "green-ballista",
    team: "queen",
    name: "Siege Ballista",
    role: "Precision counterbattery",
    purpose: "Spend a bolt on a precise royal or equipment target.",
    integrity: 100,
    maxIntegrity: 100,
    ammunition: 5,
    maxAmmunition: 5,
    cooldown: 0,
    state: "ready",
    availableActions: ["snipe"],
    availableTargets: ["tower-face", "humpty", "enemy-machine"],
  },
] as const;

export function createSiegeState(seed: number): SiegeState {
  const units = Object.fromEntries(UNIT_BLUEPRINTS.map((unit) => [unit.id, cloneUnit(unit)])) as Record<BattleUnitId, BattleUnitState>;
  return {
    units,
    targets: {
      foundation: target("foundation", "Tower foundation"),
      "tower-face": target("tower-face", "Exposed tower face"),
      humpty: target("humpty", "Humpty"),
    },
    history: [],
    doctrine: {
      king: ["Fortress doctrine", "Rescue doctrine", "Counterbattery doctrine"][hashInt(seed, "red-doctrine") % 3]!,
      queen: ["Breach doctrine", "Bombardment doctrine", "Decapitation doctrine"][hashInt(seed, "green-doctrine") % 3]!,
    },
    catchReady: false,
    catchUsed: false,
    humptyPosition: "crown",
    foundationCollapsed: false,
  };
}

export function siegeUnits(state: SiegeState): BattleUnitState[] {
  return UNIT_BLUEPRINTS.map((unit) => cloneUnit(state.units[unit.id]));
}

export function siegeTargets(state: SiegeState): BattleTargetState[] {
  return [state.targets.foundation, state.targets["tower-face"], state.targets.humpty].map((value) => ({ ...value }));
}

export function isValidOrder(state: SiegeState, choice: OrderChoice): boolean {
  const unit = state.units[choice.unitId];
  if (!unit || unit.team !== choice.team || unit.integrity <= 0 || unit.ammunition <= 0 || unit.cooldown > 0) return false;
  if (!unit.availableActions.includes(choice.action) || !unit.availableTargets.includes(choice.targetId)) return false;
  if (choice.action === "fortify" && choice.targetId === "enemy-machine") return false;
  if (choice.action === "raid" && choice.targetId !== "enemy-machine") return false;
  if (choice.action === "deploy" && state.catchUsed) return false;
  return true;
}

export function sealOrder(state: SiegeState, choice: OrderChoice): BattleOrderState {
  if (!isValidOrder(state, choice)) throw new Error("That unit cannot execute the selected order this turn.");
  const unit = state.units[choice.unitId];
  return {
    ...choice,
    unitName: unit.name,
    targetName: TARGET_NAMES[choice.targetId],
    status: "sealed",
    result: `${unit.name} is committed to ${choice.action}.`,
  };
}

export function chooseSiegeOrder(state: SiegeState, team: Team, seed: number, round: number): BattleOrderState {
  const choices = Object.values(state.units)
    .filter((unit) => unit.team === team)
    .flatMap((unit) => unit.availableActions.flatMap((action) =>
      unit.availableTargets.map((targetId) => ({ team, unitId: unit.id, action, targetId }))
    ))
    .filter((choice) => isValidOrder(state, choice));
  if (choices.length === 0) {
    const unit = Object.values(state.units).find((candidate) => candidate.team === team)!;
    return {
      team,
      unitId: unit.id,
      unitName: unit.name,
      action: "hold",
      targetId: "humpty",
      targetName: TARGET_NAMES.humpty,
      status: "sealed",
      result: `${team === "king" ? "Red" : "Green"} has no available equipment.`,
    };
  }
  const doctrine = state.doctrine[team];
  const ranked = choices.map((choice) => ({
    choice,
    score: orderUtility(state, choice, doctrine) + hashUnit(seed, `${round}:${choice.unitId}:${choice.action}:${choice.targetId}`) * 12,
  })).sort((left, right) => right.score - left.score);
  return sealOrder(state, ranked[0]!.choice);
}

export function resolveSiegeRound(
  state: SiegeState,
  round: number,
  seed: number,
  kingOrder: BattleOrderState,
  queenOrder: BattleOrderState,
): RoundResolution {
  for (const targetState of Object.values(state.targets)) targetState.protection = 0;
  for (const unit of Object.values(state.units)) {
    if (unit.cooldown > 0) unit.cooldown -= 1;
    refreshUnitState(unit);
  }

  if (kingOrder.action !== "hold") commitUnit(state.units[kingOrder.unitId]);
  if (queenOrder.action !== "hold") commitUnit(state.units[queenOrder.unitId]);

  const redResult = applyRedOrder(state, round, seed, kingOrder);
  const greenResult = applyGreenOrder(state, round, seed, queenOrder);
  const collapseResult = applyCollapse(state);

  kingOrder.status = "resolved";
  kingOrder.result = redResult.text;
  if (redResult.hit !== undefined) kingOrder.hit = redResult.hit;
  if (redResult.damage !== undefined) kingOrder.damage = redResult.damage;
  if (redResult.resolvedTargetId) kingOrder.resolvedTargetId = redResult.resolvedTargetId;

  queenOrder.status = "resolved";
  queenOrder.result = greenResult.text;
  if (greenResult.hit !== undefined) queenOrder.hit = greenResult.hit;
  if (greenResult.damage !== undefined) queenOrder.damage = greenResult.damage;
  if (greenResult.resolvedTargetId) queenOrder.resolvedTargetId = greenResult.resolvedTargetId;

  updateTargetStatuses(state);
  const parts = [greenResult.text, redResult.text];
  if (collapseResult) parts.push(collapseResult);
  const summary = parts.join(" ");
  const record: BattleRoundRecord = {
    round,
    clock: `${SIEGE_MAX_ROUNDS - round}:00`,
    kingOrder: { ...kingOrder },
    queenOrder: { ...queenOrder },
    summary,
  };
  state.history.push(record);

  let outcome: RoundResolution["outcome"];
  if (state.targets.humpty.integrity <= 0) outcome = "queen";
  else if (Object.values(state.units).filter((unit) => unit.team === "queen").every((unit) => unit.integrity <= 0 || unit.ammunition <= 0)) outcome = "king";
  else if (round >= SIEGE_MAX_ROUNDS) outcome = "king";
  return { kingOrder, queenOrder, summary, ...(outcome ? { outcome } : {}) };
}

export function battleClock(round: number, resolved: boolean): number {
  return Math.max(0, (SIEGE_MAX_ROUNDS - round + (resolved ? 0 : 1)) * 60);
}

function applyRedOrder(
  state: SiegeState,
  round: number,
  seed: number,
  order: BattleOrderState,
): { text: string; hit?: boolean; damage?: number; resolvedTargetId?: string } {
  if (order.action === "hold") return { text: "Red has no available equipment and shelters in place." };
  if (order.action === "fortify") {
    const targetState = state.targets[order.targetId as keyof typeof state.targets];
    targetState.protection = 58;
    const repair = Math.min(6, targetState.maxIntegrity - targetState.integrity);
    targetState.integrity += repair;
    return { text: `Red braces ${targetState.name}, adding heavy cover${repair > 0 ? ` and repairing ${repair} integrity` : ""}.` };
  }
  if (order.action === "reposition") {
    state.humptyPosition = "sheltered";
    state.targets.humpty.protection = 32;
    return { text: "The rescue winch hauls Humpty behind the merlon and shifts his silhouette." };
  }
  if (order.action === "deploy") {
    state.catchReady = true;
    state.targets.humpty.protection = Math.max(state.targets.humpty.protection, 18);
    return { text: "The catch-net sledge locks beneath Humpty's fall line." };
  }

  const targetUnit = selectEnemyUnit(state, "queen", seed, round);
  const roll = hashUnit(seed, `${round}:red-raid:${targetUnit.id}`);
  const hit = roll <= .68;
  const damage = hit ? Math.round(22 + hashUnit(seed, `${round}:red-raid-damage`) * 8) : 0;
  if (hit) damageUnit(targetUnit, damage);
  return {
    text: hit
      ? `Red's engineers raid ${targetUnit.name} for ${damage} damage.`
      : `Red's engineers are driven off before reaching ${targetUnit.name}.`,
    hit,
    damage,
    resolvedTargetId: targetUnit.id,
  };
}

function applyGreenOrder(
  state: SiegeState,
  round: number,
  seed: number,
  order: BattleOrderState,
): { text: string; hit: boolean; damage: number; resolvedTargetId?: string } {
  if (order.action === "hold") return { text: "Green has no operational siege equipment.", hit: false, damage: 0 };
  const unit = state.units[order.unitId];
  const profile = attackProfile(order.action, order.targetId);
  let accuracy = profile.accuracy;
  if (order.targetId === "humpty") {
    if (state.humptyPosition === "sheltered") accuracy -= .24;
    if (state.targets["tower-face"].integrity <= 50) accuracy += .1;
    if (state.humptyPosition === "exposed") accuracy += .08;
  }
  const hit = hashUnit(seed, `${round}:${unit.id}:${order.targetId}:accuracy`) <= Math.max(.15, Math.min(.95, accuracy));
  let damage = 0;
  let resolvedTargetId: string | undefined;
  if (hit) {
    damage = Math.round(profile.damage * (.9 + hashUnit(seed, `${round}:${unit.id}:damage`) * .2));
    if (order.targetId === "enemy-machine") {
      const targetUnit = selectEnemyUnit(state, "king", seed, round);
      resolvedTargetId = targetUnit.id;
      damageUnit(targetUnit, damage);
    } else {
      const targetState = state.targets[order.targetId];
      damage = Math.max(1, Math.round(damage * (1 - targetState.protection / 100)));
      targetState.integrity = Math.max(0, targetState.integrity - damage);
      if (order.targetId === "humpty") applyCatchIfNeeded(state);
      if (order.targetId === "tower-face" && targetState.integrity <= 35) state.humptyPosition = "exposed";
    }
  }
  const targetName = resolvedTargetId ? state.units[resolvedTargetId as BattleUnitId].name : TARGET_NAMES[order.targetId];
  return {
    text: hit
      ? `${unit.name} hits ${targetName} for ${damage} damage.`
      : `${unit.name} fires at ${targetName} and misses.`,
    hit,
    damage,
    ...(resolvedTargetId ? { resolvedTargetId } : {}),
  };
}

function applyCollapse(state: SiegeState): string | undefined {
  if (state.foundationCollapsed || state.targets.foundation.integrity > 0) return undefined;
  state.foundationCollapsed = true;
  state.targets["tower-face"].integrity = Math.max(0, state.targets["tower-face"].integrity - 35);
  state.targets.humpty.integrity = Math.max(0, state.targets.humpty.integrity - 48);
  state.humptyPosition = "exposed";
  const caught = applyCatchIfNeeded(state);
  return caught
    ? "The foundation gives way, but the catch net saves Humpty from the collapse."
    : "The foundation gives way and the crown drops through the shattered tower.";
}

function applyCatchIfNeeded(state: SiegeState): boolean {
  if (state.targets.humpty.integrity > 0 || !state.catchReady) return false;
  state.catchReady = false;
  state.catchUsed = true;
  state.targets.humpty.integrity = 14;
  state.units["red-catch-sledge"].ammunition = 0;
  damageUnit(state.units["red-catch-sledge"], 45);
  return true;
}

function attackProfile(action: BattleOrderAction, targetId: BattleTargetId): { accuracy: number; damage: number } {
  if (action === "breach") {
    if (targetId === "foundation") return { accuracy: .94, damage: 25 };
    if (targetId === "tower-face") return { accuracy: .9, damage: 18 };
    return { accuracy: .78, damage: 26 };
  }
  if (action === "bombard") {
    if (targetId === "humpty") return { accuracy: .6, damage: 42 };
    if (targetId === "tower-face") return { accuracy: .72, damage: 24 };
    if (targetId === "foundation") return { accuracy: .68, damage: 18 };
    return { accuracy: .62, damage: 28 };
  }
  if (targetId === "humpty") return { accuracy: .84, damage: 39 };
  if (targetId === "tower-face") return { accuracy: .88, damage: 14 };
  return { accuracy: .86, damage: 30 };
}

function orderUtility(state: SiegeState, choice: OrderChoice, doctrine: string): number {
  const unit = state.units[choice.unitId];
  let score = 35 + unit.ammunition * 1.5;
  const foundationDamage = 100 - state.targets.foundation.integrity;
  const towerDamage = 100 - state.targets["tower-face"].integrity;
  const humptyDamage = 100 - state.targets.humpty.integrity;
  if (choice.team === "queen") {
    if (choice.targetId === "foundation") score += 22 + foundationDamage * .28;
    if (choice.targetId === "tower-face") score += 18 + towerDamage * .22;
    if (choice.targetId === "humpty") score += 20 + humptyDamage * .4 + towerDamage * .14;
    if (choice.targetId === "enemy-machine") score += state.catchReady ? 12 : 8;
    if (doctrine === "Breach doctrine" && choice.unitId === "green-battering-ram") score += 24;
    if (doctrine === "Bombardment doctrine" && choice.unitId === "green-stone-thrower") score += 24;
    if (doctrine === "Decapitation doctrine" && choice.targetId === "humpty") score += 26;
  } else {
    if (choice.action === "fortify" && choice.targetId === "foundation") score += foundationDamage * .55;
    if (choice.action === "fortify" && choice.targetId === "tower-face") score += towerDamage * .5;
    if (choice.action === "fortify" && choice.targetId === "humpty") score += humptyDamage * .65;
    if (choice.action === "reposition") score += humptyDamage * .45 + towerDamage * .2 + (state.humptyPosition === "exposed" ? 22 : 0);
    if (choice.action === "deploy") score += humptyDamage * .35 + foundationDamage * .2 + (!state.catchReady ? 14 : -20);
    if (choice.action === "raid") score += state.catchReady ? 4 : 18;
    if (doctrine === "Fortress doctrine" && choice.action === "fortify") score += 20;
    if (doctrine === "Rescue doctrine" && (choice.action === "reposition" || choice.action === "deploy")) score += 20;
    if (doctrine === "Counterbattery doctrine" && choice.action === "raid") score += 25;
  }
  return score;
}

function commitUnit(unit: BattleUnitState): void {
  unit.ammunition = Math.max(0, unit.ammunition - 1);
  unit.cooldown = 1;
  unit.state = unit.ammunition > 0 ? "recovering" : "spent";
}

function damageUnit(unit: BattleUnitState, damage: number): void {
  unit.integrity = Math.max(0, unit.integrity - damage);
  refreshUnitState(unit);
}

function refreshUnitState(unit: BattleUnitState): void {
  if (unit.integrity <= 0) unit.state = "disabled";
  else if (unit.ammunition <= 0) unit.state = "spent";
  else if (unit.cooldown > 0) unit.state = "recovering";
  else unit.state = "ready";
}

function selectEnemyUnit(state: SiegeState, team: Team, seed: number, round: number): BattleUnitState {
  const candidates = Object.values(state.units).filter((unit) => unit.team === team && unit.integrity > 0);
  if (candidates.length === 0) return Object.values(state.units).find((unit) => unit.team === team)!;
  return [...candidates].sort((left, right) => {
    const leftScore = left.ammunition * 5 + left.integrity * .2 + hashUnit(seed, `${round}:target:${left.id}`) * 8 + (left.id === "red-catch-sledge" && state.catchReady ? 24 : 0);
    const rightScore = right.ammunition * 5 + right.integrity * .2 + hashUnit(seed, `${round}:target:${right.id}`) * 8 + (right.id === "red-catch-sledge" && state.catchReady ? 24 : 0);
    return rightScore - leftScore;
  })[0]!;
}

function updateTargetStatuses(state: SiegeState): void {
  for (const targetState of Object.values(state.targets)) {
    const ratio = targetState.integrity / targetState.maxIntegrity;
    targetState.status = ratio <= 0 ? "destroyed" : ratio <= .3 ? "critical" : ratio <= .7 ? "damaged" : "secure";
  }
}

function target(id: "foundation" | "tower-face" | "humpty", name: string): BattleTargetState {
  return { id, name, integrity: 100, maxIntegrity: 100, protection: 0, status: "secure" };
}

function cloneUnit(unit: BattleUnitState): BattleUnitState {
  return {
    ...unit,
    availableActions: [...unit.availableActions],
    availableTargets: [...unit.availableTargets],
  };
}

function hashInt(seed: number, value: string): number {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hashUnit(seed: number, value: string): number {
  return hashInt(seed, value) / 0xffffffff;
}

export function orderSentence(order: BattleOrderState): string {
  return `${order.unitName} ${ORDER_LABELS[order.action]} ${order.targetName}.`;
}

export type { OrderChoice, RoundResolution, SiegeState };
