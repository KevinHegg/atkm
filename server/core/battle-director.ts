import { AGENT_OBJECTIVES } from "../../shared/agent-rules.js";
import {
  CORE_FIXED_DT,
  CORE_MATCH_DURATION_SECONDS,
  type BattleChainState,
  type BattleState,
  type CoreMatchState,
  type MachinePlanOptionState,
  type Team,
} from "../../shared/core-protocol.js";
import type { ActionEvent } from "./actions.js";
import type {
  AgentStrategist,
  StrategyRequest,
  TeamStrategyOption,
} from "./agent-strategist.js";
import type { AutonomousTeamLane } from "./mock-director.js";
import {
  type BattlePhysicsEvent,
  CorePhysicsWorld,
} from "./physics.js";
import { REPO_AGENT_CONTEXT_TEXT } from "./repo-context.js";

type BattleAction = "operate" | "strike";

interface BattleTactic {
  id: string;
  team: Team;
  title: string;
  intent: string;
  machineId: string;
  targetId: string;
  action: BattleAction;
  utility: number;
  eligible: boolean;
  reasons: string[];
  simpleMachines: string[];
}

interface ActiveChain {
  tactic: BattleTactic;
  startedTick: number;
  sawBusy: boolean;
  operationFinished: boolean;
  resolutionDeadline: number;
  assessUntil: number;
  baselineRisk: number;
  baselineStress: number;
  baselineTargetIntegrity: number;
  baselineMachinePositionX: number;
}

interface PendingBattleDecision {
  request: StrategyRequest;
  tactics: BattleTactic[];
  deadline: number;
}

const TEAM_ACTORS: Record<Team, string[]> = {
  king: ["king-worker-1", "king-worker-2", "king-worker-3"],
  queen: ["queen-worker-1", "queen-worker-2", "queen-worker-3"],
};

const MACHINE_NAMES: Record<string, string> = {
  "red-rescue-winch": "Rescue Winch",
  "red-catch-sledge": "Catch Sledge",
  "green-battering-ram": "Battering Ram",
  "green-stone-thrower": "Stone Thrower",
};

const TARGET_NAMES: Record<string, string> = {
  "central-cradle": "Humpty's cradle",
  humpty: "Humpty",
  "tower-02-3": "the lower tower",
  "tower-08-2": "the upper tower",
  "red-rescue-winch": "Red's rescue winch",
  "red-catch-sledge": "Red's catch sledge",
  "green-battering-ram": "Green's battering ram",
  "green-stone-thrower": "Green's stone thrower",
};

const TACTIC_COUNT = 4;

export class BattleDirector {
  private status: CoreMatchState["status"] = "waiting";
  private outcome: CoreMatchState["outcome"];
  private moves = 0;
  private round = 0;
  private peakHumptyFallSpeed = 0;
  private readonly activeChains = new Map<Team, ActiveChain>();
  private readonly pendingDecisions = new Map<Team, PendingBattleDecision>();
  private readonly cooldownUntil = new Map<Team, number>();
  private readonly attemptedTactics: Record<Team, string[]> = { king: [], queen: [] };
  private readonly selectedTactics: Partial<Record<Team, string>> = {};
  private readonly lastResults: Record<Team, string> = {
    king: "Red is reading the first threat.",
    queen: "Green is selecting the first breach.",
  };
  private readonly chainStates: Record<Team, BattleChainState> = {
    king: idleChain("king", "Red is reading the first threat."),
    queen: idleChain("queen", "Green is selecting the first breach."),
  };
  private readonly evidence = new Set<string>();
  private strategySequence = 0;

  constructor(
    private readonly physics: CorePhysicsWorld,
    private readonly teamLanes: AutonomousTeamLane[],
    private readonly emit: (event: ActionEvent) => void,
    private readonly seed: number,
    private readonly autoMatch: boolean,
    private readonly strategist?: AgentStrategist,
  ) {
    if (autoMatch) {
      this.emit({
        text: "Four machines stand ready: two to break the hill, two to save its king.",
        technical: "battle:ready",
      });
    }
  }

  update(): void {
    if (this.status === "manual" || this.status === "complete") return;
    this.consumePhysicsEvents();
    this.updateObjective();
    if (this.outcome) return;
    if (!this.autoMatch) return;
    if (this.status === "waiting") {
      if (this.physics.tick < 30) return;
      this.status = "active";
      this.round = 1;
      this.emit({
        text: "The siege begins. Green attacks the structure; Red answers the visible threat.",
        technical: "battle:round:1",
      });
    }

    for (const team of ["king", "queen"] as const) this.updateChain(team);
    for (const team of ["king", "queen"] as const) this.pollDecision(team);
    for (const team of ["king", "queen"] as const) this.maybeChooseTactic(team);
  }

  snapshot(): CoreMatchState {
    const elapsed = this.physics.tick * CORE_FIXED_DT;
    const risk = this.physics.battleRiskState();
    const options = {
      king: this.tacticsFor("king"),
      queen: this.tacticsFor("queen"),
    };
    const activeRuleIds: Record<string, string> = {};
    const applicableRuleIds: Record<string, string[]> = {};
    for (const team of ["king", "queen"] as const) {
      const applicable = options[team].filter((tactic) => tactic.eligible).map((tactic) => tactic.id);
      for (const workerId of TEAM_ACTORS[team]) {
        activeRuleIds[workerId] = this.activeChains.get(team)?.tactic.id ?? "battle-recover";
        applicableRuleIds[workerId] = applicable;
      }
    }
    const machinePlanOptions: Record<Team, MachinePlanOptionState[]> = {
      king: options.king.map(toPlanOptionState),
      queen: options.queen.map(toPlanOptionState),
    };
    const machinePlans: Record<Team, string> = {
      king: this.chainStates.king.title || this.lastResults.king,
      queen: this.chainStates.queen.title || this.lastResults.queen,
    };
    const nextTick = Math.min(
      this.cooldownUntil.get("king") ?? this.physics.tick,
      this.cooldownUntil.get("queen") ?? this.physics.tick,
    );
    return {
      driver: this.status === "manual" ? "manual" : this.strategist?.enabled ? "llm" : "mock",
      status: this.status,
      phase: this.status === "manual" ? "manual" : this.status === "complete" ? "complete" : this.status === "waiting" ? "muster" : "contest",
      urgency: urgencyFor(elapsed, this.status),
      timeRemaining: Math.max(0, CORE_MATCH_DURATION_SECONDS - elapsed),
      moves: this.moves,
      busyWorkers: this.teamLanes.flatMap((lane) => lane.actions.states()).filter((worker) => worker.phase !== "idle").length,
      kingObjective: AGENT_OBJECTIVES.king.text,
      queenObjective: AGENT_OBJECTIVES.queen.text,
      rulebookSize: TACTIC_COUNT,
      activeRuleIds,
      applicableRuleIds,
      machinePlans,
      machinePlanOptions,
      selectedMachinePlanIds: { ...this.selectedTactics },
      machineEvidence: [...this.evidence],
      queenAdvantage: this.physics.queenAdvantageState(),
      battle: {
        round: this.round,
        towerStress: risk.towerStress,
        humptyRisk: risk.humptyRisk,
        tempo: battleTempo(elapsed, risk.humptyRisk, this.status),
        chains: {
          king: cloneChain(this.chainStates.king),
          queen: cloneChain(this.chainStates.queen),
        },
        machines: this.physics.battleMachineStates(),
      },
      nextMoveIn: Math.max(0, (nextTick - this.physics.tick) * CORE_FIXED_DT),
      ...(this.outcome ? { outcome: this.outcome } : {}),
    };
  }

  stopForManualControl(): void {
    if (this.status === "manual") return;
    this.status = "manual";
    for (const lane of this.teamLanes) lane.actions.cancelAll("The battle plan yields to direct control.", false);
    for (const pending of this.pendingDecisions.values()) this.strategist?.cancel(pending.request.id);
    this.pendingDecisions.clear();
    this.activeChains.clear();
    this.emit({ text: "Autonomous battle plans stand down for direct control.", technical: "battle:manual" });
  }

  usesManualControl(): boolean {
    return this.status === "manual";
  }

  usesCompoundControl(): boolean {
    return this.status !== "manual";
  }

  destroy(): void {
    for (const pending of this.pendingDecisions.values()) this.strategist?.cancel(pending.request.id);
    this.pendingDecisions.clear();
  }

  private updateObjective(): void {
    const elapsed = this.physics.tick * CORE_FIXED_DT;
    const integrity = this.physics.records.get("humpty")?.integrity ?? 100;
    const velocity = this.physics.bodyLinearVelocity("humpty");
    const fallSpeed = velocity ? Math.max(0, -velocity.y) : 0;
    const height = this.physics.bodyPosition("humpty")?.y ?? 0;
    if (height < 2.2) this.peakHumptyFallSpeed = Math.max(this.peakHumptyFallSpeed, fallSpeed);
    if (integrity <= 0) {
      this.finish("queen", "Humpty's shell fails before the bell. Green wins the siege.");
      return;
    }
    if ((this.physics.contactCount("humpty", "stage-floor") > 0 || height < .58) && this.peakHumptyFallSpeed >= 3) {
      this.physics.applyDamage("humpty", 100);
      this.finish("queen", `Humpty strikes the stone at ${this.peakHumptyFallSpeed.toFixed(1)} m/s. Green wins.`);
      return;
    }
    if (elapsed >= CORE_MATCH_DURATION_SECONDS) {
      this.finish("king", "The ten-minute bell rings with Humpty uncracked. Red holds the hill.");
    }
  }

  private finish(outcome: NonNullable<CoreMatchState["outcome"]>, text: string): void {
    this.status = "complete";
    this.outcome = outcome;
    for (const lane of this.teamLanes) lane.actions.cancelAll("The bell ends the current order.", false);
    this.activeChains.clear();
    for (const pending of this.pendingDecisions.values()) this.strategist?.cancel(pending.request.id);
    this.pendingDecisions.clear();
    this.chainStates.king = {
      ...this.chainStates.king,
      stage: "idle",
      stageLabel: outcome === "king" ? "Hill held" : "Rescue failed",
      progress: 1,
      lastResult: text,
    };
    this.chainStates.queen = {
      ...this.chainStates.queen,
      stage: "idle",
      stageLabel: outcome === "queen" ? "Breach complete" : "Assault spent",
      progress: 1,
      lastResult: text,
    };
    this.emit({ text, technical: `battle:complete:${outcome}` });
  }

  private maybeChooseTactic(team: Team): void {
    if (this.status !== "active" || this.activeChains.has(team) || this.pendingDecisions.has(team)) return;
    if (this.physics.tick < (this.cooldownUntil.get(team) ?? 0)) return;
    const tactics = this.tacticsFor(team).filter((tactic) => tactic.eligible);
    if (tactics.length === 0) {
      this.chainStates[team] = idleChain(team, `${teamLabel(team)} has no intact machine or reachable sabotage target.`);
      this.cooldownUntil.set(team, this.physics.tick + 3 * 60);
      return;
    }
    if (!this.strategist?.enabled) {
      this.startTactic(team, chooseByUtility(tactics, this.seed + this.round + this.moves), "utility");
      return;
    }
    const request: StrategyRequest = {
      id: `battle-${this.seed}-${++this.strategySequence}-${team}`,
      phase: battleTempo(this.physics.tick * CORE_FIXED_DT, this.physics.battleRiskState().humptyRisk, this.status),
      trigger: this.moves === 0 ? "scheduled" : "impact",
      repositoryContext: REPO_AGENT_CONTEXT_TEXT,
      teams: [{
        team,
        objective: team === "king" ? AGENT_OBJECTIVES.king.text : AGENT_OBJECTIVES.queen.text,
        observedFacts: this.observedFacts(team),
        attemptedPlanIds: [...this.attemptedTactics[team]],
        options: tactics.map(toStrategyOption),
      }],
    };
    this.pendingDecisions.set(team, {
      request,
      tactics,
      deadline: this.physics.tick + 8 * 60,
    });
    this.chainStates[team] = {
      ...idleChain(team, "The tactical agent is comparing visible threats."),
      stage: "choosing",
      stageLabel: "Choosing response",
      progress: .08,
    };
    this.strategist.request(request);
  }

  private pollDecision(team: Team): void {
    const pending = this.pendingDecisions.get(team);
    if (!pending || !this.strategist) return;
    const poll = this.strategist.poll(pending.request.id);
    if (poll.state === "pending" && this.physics.tick < pending.deadline) return;
    this.pendingDecisions.delete(team);
    let chosen: BattleTactic | undefined;
    let source: "llm" | "utility" = "llm";
    if (poll.state === "ready") {
      const planId = poll.decision.teams.find((choice) => choice.team === team)?.planId;
      chosen = pending.tactics.find((tactic) => tactic.id === planId);
    }
    if (!chosen) {
      this.strategist.cancel(pending.request.id);
      chosen = chooseByUtility(pending.tactics, this.seed + this.moves);
      source = "utility";
    }
    this.startTactic(team, chosen, source);
  }

  private startTactic(team: Team, tactic: BattleTactic, source: "llm" | "utility"): void {
    const lane = this.teamLanes.find((candidate) => candidate.team === team);
    if (!lane) return;
    const result = lane.actions.enqueue([{
      action: tactic.action,
      actorIds: TEAM_ACTORS[team],
      targetId: tactic.action === "operate" ? tactic.machineId : tactic.targetId,
    }]);
    if (!result.ok) {
      const text = `${teamLabel(team)} cannot begin ${tactic.title.toLowerCase()}: ${result.message ?? "the route is closed"}`;
      this.lastResults[team] = text;
      this.chainStates[team] = idleChain(team, text);
      this.cooldownUntil.set(team, this.physics.tick + 2 * 60);
      this.emit({ text, team, technical: `battle:chain:${team}:rejected:${tactic.id}` });
      return;
    }
    const risk = this.physics.battleRiskState();
    const target = this.physics.records.get(tactic.targetId);
    const machinePosition = this.physics.bodyPosition(tactic.machineId);
    this.activeChains.set(team, {
      tactic,
      startedTick: this.physics.tick,
      sawBusy: false,
      operationFinished: false,
      resolutionDeadline: 0,
      assessUntil: 0,
      baselineRisk: risk.humptyRisk,
      baselineStress: risk.towerStress,
      baselineTargetIntegrity: target?.integrity ?? 100,
      baselineMachinePositionX: machinePosition?.x ?? 0,
    });
    this.moves += 1;
    if (team === "queen") this.round = Math.max(1, Math.ceil(this.moves / 2));
    this.selectedTactics[team] = tactic.id;
    this.attemptedTactics[team].push(tactic.id);
    this.attemptedTactics[team] = this.attemptedTactics[team].slice(-4);
    this.chainStates[team] = chainFromTactic(tactic);
    this.emit({
      text: `${teamLabel(team)} plan: ${tactic.intent} ${tactic.title} commits ${MACHINE_NAMES[tactic.machineId] ?? "the crew"} against ${TARGET_NAMES[tactic.targetId] ?? tactic.targetId}.`,
      team,
      technical: `battle:chain:${team}:plan:${tactic.id}:utility:${Math.round(tactic.utility)}:source:${source}`,
    });
  }

  private updateChain(team: Team): void {
    const active = this.activeChains.get(team);
    if (!active) return;
    const lane = this.teamLanes.find((candidate) => candidate.team === team);
    if (!lane) return;
    const busy = lane.actions.isBusy();
    const chain = this.chainStates[team];
    if (busy) {
      active.sawBusy = true;
      const description = lane.actions.activeDescription() ?? "";
      if (description.includes(":work")) {
        chain.stage = "operating";
        chain.stageLabel = active.tactic.action === "strike" ? "Sabotaging machine" : `Operating ${MACHINE_NAMES[active.tactic.machineId]}`;
        chain.progress = .62;
      } else {
        chain.stage = "crewing";
        chain.stageLabel = `Crew moving to ${MACHINE_NAMES[active.tactic.machineId]}`;
        chain.progress = Math.min(.5, .12 + (this.physics.tick - active.startedTick) / 900);
      }
      return;
    }
    if (active.sawBusy && !active.operationFinished) {
      active.operationFinished = true;
      active.resolutionDeadline = this.physics.tick + resolutionTicks(active.tactic);
      chain.stage = "impact";
      chain.stageLabel = `Watching ${TARGET_NAMES[active.tactic.targetId] ?? active.tactic.targetId}`;
      chain.progress = .78;
      this.emit({
        text: active.tactic.action === "strike"
          ? `${teamLabel(team)} completes its sabotage attempt against ${MACHINE_NAMES[active.tactic.targetId]}. The crews check the damage.`
          : `${teamLabel(team)} has operated ${MACHINE_NAMES[active.tactic.machineId]}. The crews watch for the physical result.`,
        team,
        technical: `battle:chain:${team}:operate:${active.tactic.id}`,
      });
      return;
    }
    if (chain.stage === "assessing" && this.physics.tick >= active.assessUntil) {
      this.finishAssessment(team, active);
      return;
    }
    if (active.operationFinished && this.physics.tick >= active.resolutionDeadline) {
      const result = this.measureFallbackResult(active);
      this.beginAssessment(team, active, result);
    }
  }

  private consumePhysicsEvents(): void {
    for (const event of this.physics.consumeBattleEvents()) {
      const machineTeam = this.physics.records.get(event.machineId)?.team;
      this.emit({
        text: event.text,
        ...(machineTeam ? { team: machineTeam } : {}),
        technical: `battle:impact:${event.type}:${event.machineId}:${event.targetId}:${event.value.toFixed(2)}`,
      });
      this.evidence.add(`${event.type}:${event.machineId}:${event.targetId}:${event.value.toFixed(2)}`);
      const attackingTeam = this.teamForEvent(event);
      const active = attackingTeam ? this.activeChains.get(attackingTeam) : undefined;
      if (attackingTeam && active) this.beginAssessment(attackingTeam, active, event.text);
    }
  }

  private teamForEvent(event: BattlePhysicsEvent): Team | undefined {
    for (const team of ["king", "queen"] as const) {
      const tactic = this.activeChains.get(team)?.tactic;
      if (!tactic) continue;
      if (tactic.machineId === event.machineId) return team;
      if (event.type === "machine-disabled" && tactic.targetId === event.targetId) return team;
    }
    if (event.type === "catch" || event.type === "deployment" || event.type === "winch-pull" || event.type === "line-snap") return "king";
    if (event.type === "ram-impact" || event.type === "stone-impact") return "queen";
    return undefined;
  }

  private beginAssessment(team: Team, active: ActiveChain, result: string): void {
    const chain = this.chainStates[team];
    chain.stage = "assessing";
    chain.stageLabel = "Assessing result";
    chain.progress = .94;
    chain.lastResult = result;
    active.assessUntil = this.physics.tick + 75;
    active.resolutionDeadline = Number.POSITIVE_INFINITY;
  }

  private finishAssessment(team: Team, active: ActiveChain): void {
    const result = this.chainStates[team].lastResult;
    this.lastResults[team] = result;
    this.evidence.add(`chain:${team}:${active.tactic.id}:complete`);
    this.emit({
      text: `${teamLabel(team)} assessment: ${result}`,
      team,
      technical: `battle:chain:${team}:result:${active.tactic.id}`,
    });
    this.activeChains.delete(team);
    this.cooldownUntil.set(team, this.physics.tick + (team === "queen" ? 5.5 : 1.5) * 60);
    this.chainStates[team] = {
      ...this.chainStates[team],
      stage: "recovering",
      stageLabel: "Crew resetting",
      progress: 1,
      lastResult: result,
    };
  }

  private measureFallbackResult(active: ActiveChain): string {
    const currentRisk = this.physics.battleRiskState();
    const target = this.physics.records.get(active.tactic.targetId);
    const targetIntegrity = target?.integrity ?? active.baselineTargetIntegrity;
    if (active.tactic.action === "strike") {
      const damage = Math.max(0, active.baselineTargetIntegrity - targetIntegrity);
      return damage > 0
        ? `${MACHINE_NAMES[active.tactic.targetId] ?? active.tactic.targetId} loses ${Math.round(damage)} integrity to sabotage.`
        : `The sabotage crew reaches ${MACHINE_NAMES[active.tactic.targetId] ?? active.tactic.targetId}, but causes no measurable damage.`;
    }
    const machineX = this.physics.bodyPosition(active.tactic.machineId)?.x ?? active.baselineMachinePositionX;
    const machineTravel = Math.abs(machineX - active.baselineMachinePositionX);
    const stressChange = currentRisk.towerStress - active.baselineStress;
    const riskChange = currentRisk.humptyRisk - active.baselineRisk;
    if (active.tactic.team === "king") {
      return machineTravel > .2
        ? `${MACHINE_NAMES[active.tactic.machineId]} moves ${machineTravel.toFixed(2)} metres into its rescue position.`
        : `The rescue operation changes Humpty's measured risk by ${riskChange.toFixed(0)} points.`;
    }
    return stressChange > 1
      ? `The assault raises measured tower stress by ${stressChange.toFixed(0)} points.`
      : `The assault produces no decisive contact; Green must change its target.`;
  }

  private tacticsFor(team: Team): BattleTactic[] {
    const machines = new Map(this.physics.battleMachineStates().map((machine) => [machine.id, machine]));
    const risk = this.physics.battleRiskState();
    const last = this.attemptedTactics[team].at(-1);
    const repeatPenalty = (id: string): number => last === id ? 30 : 0;
    const machineReady = (id: string): boolean => {
      const machine = machines.get(id);
      return Boolean(machine && machine.integrity > 0 && machine.state !== "disabled" && machine.state !== "spent" && machine.state !== "moving" && machine.state !== "returning");
    };
    if (team === "king") {
      const sledge = machines.get("red-catch-sledge");
      return [
        tactic({
          id: "red-stabilize-cradle",
          team,
          title: "Tension the rescue line",
          intent: "Hold the king steady while the tower is struck.",
          machineId: "red-rescue-winch",
          targetId: "central-cradle",
          action: "operate",
          utility: 60 + risk.towerStress * .25 + risk.humptyRisk * .25 - repeatPenalty("red-stabilize-cradle"),
          eligible: machineReady("red-rescue-winch"),
          reasons: [`tower stress ${risk.towerStress.toFixed(0)}`, `Humpty risk ${risk.humptyRisk.toFixed(0)}`],
          simpleMachines: ["wheel-and-axle", "pulley"],
        }),
        tactic({
          id: "red-deploy-catch-sledge",
          team,
          title: "Drive the catch sledge",
          intent: "Put a padded receiving bed beneath the likely fall.",
          machineId: "red-catch-sledge",
          targetId: "humpty",
          action: "operate",
          utility: 42 + risk.towerStress * .45 + risk.humptyRisk * .6 + (sledge?.state === "ready" && risk.humptyRisk >= 25 ? 24 : 0) - repeatPenalty("red-deploy-catch-sledge"),
          eligible: machineReady("red-catch-sledge") && sledge?.state !== "working",
          reasons: [`fall risk ${risk.humptyRisk.toFixed(0)}`, "receiving bed mobile"],
          simpleMachines: ["inclined plane", "wheel-and-axle"],
        }),
      ];
    }
    const thrower = machines.get("green-stone-thrower");
    const stoneTargetId = this.physics.battleStoneTargetId();
    const royalShot = stoneTargetId === "humpty";
    const rescueShot = stoneTargetId === "red-catch-sledge";
    return [
      tactic({
        id: "green-drive-ram",
        team,
        title: "Drive the battering ram",
        intent: "Punch a lower timber out and make the tower answer gravity.",
        machineId: "green-battering-ram",
        targetId: "tower-02-3",
        action: "operate",
        utility: 78 + Math.max(0, 45 - risk.towerStress) * .32 - repeatPenalty("green-drive-ram"),
        eligible: machineReady("green-battering-ram"),
        reasons: [`tower stress ${risk.towerStress.toFixed(0)}`, "lower course exposed"],
        simpleMachines: ["lever", "wheel-and-axle"],
      }),
      tactic({
        id: "green-fire-stone",
        team,
        title: royalShot ? "Put a stone on the king" : rescueShot ? "Smash the catch sledge" : "Loose the stone thrower",
        intent: royalShot
          ? "Exploit the open fall line with a direct royal shot."
          : rescueShot
            ? "Break Red's receiving bed before the next collapse."
            : "Strike a named course and make the tower transmit the blow.",
        machineId: "green-stone-thrower",
        targetId: stoneTargetId,
        action: "operate",
        utility: 63 + risk.towerStress * .28 + (thrower?.charges ?? 0) * 3 - repeatPenalty("green-fire-stone"),
        eligible: machineReady("green-stone-thrower") && (thrower?.charges ?? 0) > 0,
        reasons: [`${thrower?.charges ?? 0} stones remain`, `tower stress ${risk.towerStress.toFixed(0)}`],
        simpleMachines: ["lever", "pulley", "counterweight"],
      }),
    ];
  }

  private observedFacts(team: Team): string[] {
    const risk = this.physics.battleRiskState();
    const machines = this.physics.battleMachineStates();
    return [
      `tower stress ${risk.towerStress.toFixed(0)}`,
      `Humpty risk ${risk.humptyRisk.toFixed(0)}`,
      ...machines.map((machine) => `${machine.name}: ${machine.state}, ${machine.integrity.toFixed(0)} integrity, ${machine.charges}/${machine.maxCharges} charges`),
      `${teamLabel(team)} last result: ${this.lastResults[team]}`,
    ];
  }
}

function tactic(value: BattleTactic): BattleTactic {
  return { ...value, utility: Math.max(0, Math.min(100, value.utility)) };
}

function chooseByUtility(tactics: BattleTactic[], salt: number): BattleTactic {
  return [...tactics].sort((left, right) => {
    const difference = right.utility - left.utility;
    if (Math.abs(difference) > .001) return difference;
    return hashScore(right.id, salt) - hashScore(left.id, salt);
  })[0]!;
}

function hashScore(value: string, salt: number): number {
  let hash = salt | 0;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function toStrategyOption(tactic: BattleTactic): TeamStrategyOption {
  return {
    id: tactic.id,
    ruleId: tactic.id,
    label: `${tactic.title}: ${tactic.intent}`,
    utility: Math.round(tactic.utility),
    observedFacts: [...tactic.reasons, `utility ${Math.round(tactic.utility)}`],
    missingFacts: [],
    capabilities: [tactic.action, tactic.intent],
    simpleMachines: [...tactic.simpleMachines],
  };
}

function toPlanOptionState(tactic: BattleTactic): MachinePlanOptionState {
  return {
    id: tactic.id,
    ruleId: tactic.id,
    label: `${tactic.title} (${Math.round(tactic.utility)})`,
    eligible: tactic.eligible,
    observedFacts: [...tactic.reasons],
    missingFacts: tactic.eligible ? [] : ["machine unavailable or still moving"],
  };
}

function chainFromTactic(tactic: BattleTactic): BattleChainState {
  return {
    tacticId: tactic.id,
    title: tactic.title,
    intent: tactic.intent,
    machineId: tactic.machineId,
    machineName: MACHINE_NAMES[tactic.machineId] ?? tactic.machineId,
    targetId: tactic.targetId,
    targetName: TARGET_NAMES[tactic.targetId] ?? tactic.targetId,
    stage: "crewing",
    stageLabel: `Crew moving to ${MACHINE_NAMES[tactic.machineId] ?? tactic.machineId}`,
    progress: .12,
    utility: Math.round(tactic.utility),
    lastResult: "No result yet.",
    simpleMachines: [...tactic.simpleMachines],
  };
}

function idleChain(team: Team, result: string): BattleChainState {
  return {
    tacticId: "",
    title: team === "king" ? "Awaiting Green's threat" : "Reading the tower",
    intent: team === "king" ? "Protect the king." : "Find a visible breach.",
    machineId: "",
    machineName: "No machine committed",
    targetId: "",
    targetName: "No target committed",
    stage: "idle",
    stageLabel: "Standing by",
    progress: 0,
    utility: 0,
    lastResult: result,
    simpleMachines: [],
  };
}

function cloneChain(chain: BattleChainState): BattleChainState {
  return { ...chain, simpleMachines: [...chain.simpleMachines] };
}

function teamLabel(team: Team): "Red" | "Green" {
  return team === "king" ? "Red" : "Green";
}

function resolutionTicks(tactic: BattleTactic): number {
  if (tactic.action === "strike") return 2 * 60;
  if (tactic.machineId === "red-rescue-winch") return 6 * 60;
  if (tactic.machineId === "red-catch-sledge") return 7 * 60;
  return 8 * 60;
}

function urgencyFor(elapsed: number, status: CoreMatchState["status"]): CoreMatchState["urgency"] {
  if (status === "manual") return "manual";
  if (status === "complete") return "complete";
  if (elapsed >= 540) return "last-minute";
  if (elapsed >= 480) return "desperate";
  if (elapsed >= 60) return "siege";
  return "opening";
}

function battleTempo(
  elapsed: number,
  risk: number,
  status: CoreMatchState["status"],
): BattleState["tempo"] {
  if (status === "complete") return "complete";
  if (elapsed >= 540) return "last-stand";
  if (risk >= 70 || elapsed >= 480) return "critical";
  if (risk >= 30 || elapsed >= 120) return "pressing";
  return "opening";
}
