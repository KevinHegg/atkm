import {
  CORE_FIXED_DT,
  type ActivityEvent,
  type BattleChainState,
  type BattleOrderAction,
  type BattleOrderState,
  type BattleState,
  type BattleTargetId,
  type BattleUnitId,
  type CoreMatchState,
  type MachinePlanOptionState,
  type Team,
} from "../../shared/core-protocol.js";
import type { AgentStrategist } from "./agent-strategist.js";
import type { AutonomousTeamLane } from "./mock-director.js";
import type { CorePhysicsWorld } from "./physics.js";
import {
  SIEGE_MAX_ROUNDS,
  battleClock,
  chooseSiegeOrder,
  createSiegeState,
  isValidOrder,
  orderSentence,
  resolveSiegeRound,
  sealOrder,
  siegeTargets,
  siegeUnits,
  type SiegeState,
} from "./siege-rules.js";
import { SIEGE_EQUIPMENT, siegeDrillStage, siegeEquipment } from "../../shared/siege-equipment.js";

const PLANNING_TICKS = 10 * 60;
const REVEAL_TICKS = 12 * 60;
const AFTERMATH_TICKS = 16 * 60;
const ROUND_TICKS = 18 * 60;

export class BattleDirector {
  private readonly physics: CorePhysicsWorld;
  private readonly teamLanes: AutonomousTeamLane[];
  private readonly emit: (event: Omit<ActivityEvent, "id" | "tick" | "elapsed">) => void;
  private readonly seed: number;
  private readonly autoMatch: boolean;
  private readonly siege: SiegeState;
  private status: CoreMatchState["status"] = "waiting";
  private round = 0;
  private roundStartedAt = 0;
  private battlePhase: BattleState["phase"] = "planning";
  private sealedOrders: Partial<Record<Team, BattleOrderState>> = {};
  private visibleOrders: Partial<Record<Team, BattleOrderState>> = {};
  private outcome?: CoreMatchState["outcome"];
  private pendingOutcome: "king" | "queen" | undefined;
  private pendingPhysicalOrders: Partial<Record<Team, BattleOrderState>> = {};
  private readonly stagedPhysicalTeams = new Set<Team>();
  private evidence = new Set<string>();

  constructor(
    physics: CorePhysicsWorld,
    teamLanes: AutonomousTeamLane[],
    emit: (event: Omit<ActivityEvent, "id" | "tick" | "elapsed">) => void,
    seed: number,
    autoMatch: boolean,
    _strategist?: AgentStrategist,
  ) {
    this.physics = physics;
    this.teamLanes = teamLanes;
    this.emit = emit;
    this.seed = seed;
    this.autoMatch = autoMatch;
    this.siege = createSiegeState(seed);
    this.emit({
      text: "Six formed units stand ready. Each order is sealed, revealed, and resolved against the enemy's choice.",
      technical: "siege:ready",
    });
  }

  update(): void {
    this.forwardPhysicsEvents();
    if (this.status === "manual" || this.status === "complete") return;
    if (!this.autoMatch && this.round === 0 && this.physics.tick < 30) return;
    if (this.round === 0) {
      if (this.physics.tick < 30) return;
      this.startRound();
    }

    const elapsed = this.physics.tick - this.roundStartedAt;
    if (this.battlePhase === "planning" && elapsed >= PLANNING_TICKS) this.revealOrders();
    if (this.battlePhase === "reveal" && elapsed >= REVEAL_TICKS) this.resolveOrders();
    if (this.battlePhase === "resolving") {
      const operationProgress = Math.max(0, Math.min(1, (elapsed - REVEAL_TICKS) / (AFTERMATH_TICKS - REVEAL_TICKS)));
      for (const team of ["king", "queen"] as const) {
        const order = this.pendingPhysicalOrders[team];
        const effectAt = order ? siegeEquipment(order.unitId)?.effectAt ?? .66 : 1;
        if (order && !this.stagedPhysicalTeams.has(team) && operationProgress >= effectAt) {
          this.stagePhysicalEffect(order);
          this.stagedPhysicalTeams.add(team);
        }
      }
      if (elapsed >= AFTERMATH_TICKS) {
        for (const team of ["king", "queen"] as const) {
          const order = this.pendingPhysicalOrders[team];
          if (order && !this.stagedPhysicalTeams.has(team)) this.stagePhysicalEffect(order);
        }
        if (this.pendingOutcome) this.complete(this.pendingOutcome);
        else this.battlePhase = "aftermath";
      }
    }
    if (this.battlePhase === "aftermath" && elapsed >= ROUND_TICKS) this.startRound();
  }

  submitOrder(
    team: Team,
    unitId: BattleUnitId,
    action: BattleOrderAction,
    targetId: BattleTargetId,
  ): { ok: boolean; message?: string } {
    if (this.status === "complete") return { ok: false, message: "The siege is complete." };
    if (this.battlePhase !== "planning") return { ok: false, message: "Orders can only be changed during planning." };
    const choice = { team, unitId, action, targetId };
    if (!isValidOrder(this.siege, choice)) return { ok: false, message: "That unit cannot execute the selected order this turn." };
    this.sealedOrders[team] = sealOrder(this.siege, choice);
    this.emit({
      team,
      text: `${teamLabel(team)} seals an order for turn ${this.round || 1}.`,
      technical: `siege:sealed:${team}:${unitId}:${action}:${targetId}`,
    });
    return { ok: true, message: `${teamLabel(team)} order sealed.` };
  }

  snapshot(): CoreMatchState {
    const battle = this.battleSnapshot();
    const visibleKing = this.visibleOrders.king;
    const visibleQueen = this.visibleOrders.queen;
    const phase = this.status === "manual"
      ? "manual"
      : this.status === "complete"
        ? "complete"
        : this.battlePhase === "planning"
          ? "advance"
          : "contest";
    const urgency = this.status === "manual"
      ? "manual"
      : this.status === "complete"
        ? "complete"
        : this.round >= 10
          ? "last-minute"
          : this.round >= 8
            ? "desperate"
            : this.round >= 2
              ? "siege"
              : "opening";
    const activeRuleIds: Record<string, string> = {};
    for (const team of ["king", "queen"] as const) {
      const order = this.visibleOrders[team];
      const definition = order ? siegeEquipment(order.unitId) : undefined;
      this.physics.workerIds(team).forEach((workerId, index) => {
        const crew = definition?.crew[index];
        activeRuleIds[workerId] = order && crew
          ? `${order.unitId}:${crew.role}:${battle.chains[team].stageLabel}`
          : "hold-position";
      });
    }
    const machinePlans = {
      king: visibleKing ? orderSentence(visibleKing) : this.sealedOrders.king ? "Red order sealed" : "Red commander is reading the field",
      queen: visibleQueen ? orderSentence(visibleQueen) : this.sealedOrders.queen ? "Green order sealed" : "Green commander is reading the field",
    };
    const selectedMachinePlanIds: Partial<Record<Team, string>> = {};
    if (visibleKing) selectedMachinePlanIds.king = orderId(visibleKing);
    if (visibleQueen) selectedMachinePlanIds.queen = orderId(visibleQueen);
    return {
      driver: this.status === "manual" ? "manual" : "mock",
      status: this.status,
      phase,
      urgency,
      timeRemaining: battle.timeRemaining,
      moves: this.siege.history.length * 2 + (this.siege.history.length < this.round ? Object.keys(this.sealedOrders).length : 0),
      busyWorkers: this.battlePhase === "resolving" ? 6 : 0,
      kingObjective: "Keep Humpty uncracked through ten simultaneous siege turns.",
      queenObjective: "Crack Humpty before the tenth turn is resolved.",
      rulebookSize: 7,
      activeRuleIds,
      applicableRuleIds: Object.fromEntries(this.physics.workerIds().map((id) => {
        const team = id.startsWith("king-") ? "king" : "queen";
        const affordances = SIEGE_EQUIPMENT
          .filter((definition) => definition.team === team)
          .flatMap((definition) => definition.affordances.map((affordance) => `${definition.id}:${affordance}`));
        return [id, affordances];
      })),
      machinePlans,
      machinePlanOptions: {
        king: planOptions(battle.units.filter((unit) => unit.team === "king")),
        queen: planOptions(battle.units.filter((unit) => unit.team === "queen")),
      },
      selectedMachinePlanIds,
      machineEvidence: [...this.evidence],
      queenAdvantage: this.physics.queenAdvantageState(),
      battle,
      nextMoveIn: this.nextMoveIn(),
      ...(this.outcome ? { outcome: this.outcome } : {}),
    };
  }

  stopForManualControl(): void {
    if (this.status === "manual") return;
    for (const lane of this.teamLanes) lane.actions.cancelAll("The siege yields to the engineering laboratory.", false);
    this.status = "manual";
    this.emit({ text: "The tactical siege stands down for direct engineering control.", technical: "siege:manual" });
  }

  usesManualControl(): boolean {
    return this.status === "manual";
  }

  usesCompoundControl(): boolean {
    return this.status !== "manual";
  }

  destroy(): void {
    // The deterministic commander owns no external requests.
  }

  private startRound(): void {
    if (this.outcome || this.round >= SIEGE_MAX_ROUNDS) return;
    const openingOrders = this.round === 0 ? this.sealedOrders : {};
    this.round += 1;
    this.roundStartedAt = this.physics.tick;
    this.battlePhase = "planning";
    this.pendingOutcome = undefined;
    this.pendingPhysicalOrders = {};
    this.stagedPhysicalTeams.clear();
    this.sealedOrders = openingOrders;
    this.visibleOrders = {};
    this.status = "active";
    this.emit({
      text: `Turn ${this.round}. One minute remains in this exchange; both commanders prepare a single decisive order.`,
      technical: `siege:round:${this.round}:planning`,
    });
  }

  private revealOrders(): void {
    for (const team of ["king", "queen"] as const) {
      this.sealedOrders[team] ??= chooseSiegeOrder(this.siege, team, this.seed, this.round);
      this.sealedOrders[team]!.status = "revealed";
    }
    this.visibleOrders = {
      king: { ...this.sealedOrders.king! },
      queen: { ...this.sealedOrders.queen! },
    };
    this.battlePhase = "reveal";
    const red = orderSentence(this.visibleOrders.king!);
    const green = orderSentence(this.visibleOrders.queen!);
    this.emit({ text: `Orders revealed together: Red, ${red} Green, ${green}`, technical: `siege:round:${this.round}:reveal` });
    this.evidence.add(`round:${this.round}:red:${orderId(this.visibleOrders.king!)}`);
    this.evidence.add(`round:${this.round}:green:${orderId(this.visibleOrders.queen!)}`);
  }

  private resolveOrders(): void {
    const kingOrder = this.visibleOrders.king;
    const queenOrder = this.visibleOrders.queen;
    if (!kingOrder || !queenOrder) return;
    const resolution = resolveSiegeRound(this.siege, this.round, this.seed, kingOrder, queenOrder);
    this.visibleOrders = { king: { ...resolution.kingOrder }, queen: { ...resolution.queenOrder } };
    this.pendingPhysicalOrders = { king: resolution.kingOrder, queen: resolution.queenOrder };
    this.stagedPhysicalTeams.clear();
    this.battlePhase = "resolving";
    this.emit({ text: resolution.summary, technical: `siege:round:${this.round}:resolved` });
    this.evidence.add(`round:${this.round}:resolved`);
    this.pendingOutcome = resolution.outcome;
  }

  private complete(outcome: "king" | "queen"): void {
    this.outcome = outcome;
    this.status = "complete";
    this.battlePhase = "complete";
    const text = outcome === "king"
      ? "The tenth bell sounds. Humpty remains uncracked, and Red holds the hill."
      : "Humpty cracks before the final bell. Green takes the hill.";
    this.emit({ text, team: outcome, technical: `siege:complete:${outcome}` });
  }

  private battleSnapshot(): BattleState {
    const units = siegeUnits(this.siege);
    const targets = siegeTargets(this.siege);
    const towerStress = Math.round(((100 - targets[0]!.integrity) * .6) + ((100 - targets[1]!.integrity) * .4));
    const humptyRisk = Math.min(100, Math.round((100 - targets[2]!.integrity) * .7 + towerStress * .3));
    const elapsed = Math.max(0, this.physics.tick - this.roundStartedAt);
    return {
      round: this.round,
      maxRounds: SIEGE_MAX_ROUNDS,
      phase: this.status === "complete" ? "complete" : this.battlePhase,
      phaseProgress: this.round === 0 ? 0 : Math.min(1, elapsed / ROUND_TICKS),
      timeRemaining: battleClock(Math.max(1, this.round), this.battlePhase === "aftermath" || this.status === "complete"),
      towerStress,
      humptyRisk,
      tempo: this.status === "complete" ? "complete" : this.round >= 10 ? "last-stand" : humptyRisk >= 70 ? "critical" : this.round >= 4 || humptyRisk >= 30 ? "pressing" : "opening",
      chains: {
        king: compatibilityChain("king", this.visibleOrders.king, this.battlePhase, elapsed),
        queen: compatibilityChain("queen", this.visibleOrders.queen, this.battlePhase, elapsed),
      },
      machines: this.physics.battleMachineStates(),
      units,
      targets,
      sealedTeams: Object.keys(this.sealedOrders) as Team[],
      orders: structuredClone(this.visibleOrders),
      history: structuredClone(this.siege.history),
      doctrine: { ...this.siege.doctrine },
      catchReady: this.siege.catchReady,
      humptyPosition: this.siege.humptyPosition,
    };
  }

  private stagePhysicalEffect(order: BattleOrderState): void {
    if (order.unitId === "red-rescue-winch") this.physics.operateBattleMachine("red-rescue-winch");
    if (order.unitId === "red-catch-sledge") this.physics.operateBattleMachine("red-catch-sledge");
    const targetId = physicalTargetId(order);
    if (order.unitId === "green-battering-ram") this.physics.operateBattleMachine("green-battering-ram", targetId, order.hit !== false);
    if (order.unitId === "green-stone-thrower") this.physics.operateBattleMachine("green-stone-thrower", targetId, order.hit !== false);
    if (order.unitId === "green-ballista") this.physics.fireBattleBallista(targetId, order.hit !== false);
  }

  private forwardPhysicsEvents(): void {
    for (const event of this.physics.consumeBattleEvents()) {
      this.emit({
        text: event.text,
        team: event.type === "catch" || event.type === "deployment" || event.type === "winch-pull" ? "king" : "queen",
        technical: `siege:physical:${event.type}:${event.machineId}:${event.targetId}:${Math.round(event.value)}`,
      });
      this.evidence.add(`physical:${event.type}:${event.targetId}`);
    }
  }

  private nextMoveIn(): number {
    if (this.status === "complete" || this.status === "manual") return 0;
    const elapsed = this.physics.tick - this.roundStartedAt;
    const target = this.battlePhase === "planning" ? PLANNING_TICKS : this.battlePhase === "reveal" ? REVEAL_TICKS : ROUND_TICKS;
    return Math.max(0, (target - elapsed) * CORE_FIXED_DT);
  }
}

function compatibilityChain(
  team: Team,
  order: BattleOrderState | undefined,
  phase: BattleState["phase"],
  elapsed: number,
): BattleChainState {
  if (!order) {
    return {
      tacticId: "",
      title: "Order not revealed",
      intent: "Read the battlefield",
      machineId: "",
      machineName: "Command awaiting reveal",
      targetId: "",
      targetName: "Unknown",
      stage: "choosing",
      stageLabel: "Planning in secret",
      progress: 0,
      utility: 0,
      lastResult: `${teamLabel(team)} is considering ammunition, damage, and counterplay.`,
      simpleMachines: [],
    };
  }
  const definition = siegeEquipment(order.unitId);
  const operationProgress = Math.max(0, Math.min(.999999, (elapsed - REVEAL_TICKS) / (AFTERMATH_TICKS - REVEAL_TICKS)));
  const drillStage = phase === "resolving" ? siegeDrillStage(order.unitId, operationProgress) : undefined;
  return {
    tacticId: orderId(order),
    title: order.action,
    intent: orderSentence(order),
    machineId: order.unitId,
    machineName: order.unitName,
    targetId: order.targetId,
    targetName: order.targetName,
    stage: phase === "resolving" ? "operating" : order.status === "resolved" ? "assessing" : "crewing",
    stageLabel: drillStage?.label ?? (order.status === "resolved" ? "Result recorded" : "Crew moving to stations"),
    progress: phase === "resolving" ? operationProgress : order.status === "resolved" ? 1 : .5,
    utility: 0,
    lastResult: order.result,
    simpleMachines: [...(definition?.simpleMachines ?? [])],
  };
}

function planOptions(units: BattleState["units"]): MachinePlanOptionState[] {
  return units.map((unit) => ({
    id: unit.id,
    ruleId: unit.availableActions.join("/"),
    label: `${unit.name}: ${unit.purpose}`,
    eligible: unit.state === "ready",
    observedFacts: [
      `${unit.ammunition}/${unit.maxAmmunition} ${unit.munition}`,
      `${unit.integrity} integrity`,
      `crew: ${unit.crewRoles.join(", ")}`,
      `affordances: ${unit.affordances.join(", ")}`,
    ],
    missingFacts: unit.state === "ready" ? [] : [unit.state],
  }));
}

function physicalTargetId(order: BattleOrderState): string {
  if (order.resolvedTargetId) return order.resolvedTargetId;
  if (order.targetId === "humpty") return "humpty";
  if (order.targetId === "foundation") return "tower-02-3";
  if (order.targetId === "tower-face") return "tower-08-2";
  return "red-rescue-winch";
}

function orderId(order: BattleOrderState): string {
  return `${order.unitId}:${order.action}:${order.targetId}`;
}

function teamLabel(team: Team): string {
  return team === "king" ? "Red" : "Green";
}
