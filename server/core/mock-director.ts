import {
  AGENT_OBJECTIVES,
  AGENT_RULES,
  AGENT_RULES_BY_ID,
} from "../../shared/agent-rules.js";
import {
  CORE_FIXED_DT,
  CORE_MATCH_DURATION_SECONDS,
  type CoreMatchState,
  type LegalActionRequest,
  type MachinePlanOptionState,
  type Quat,
  type Team,
  type Vec3,
} from "../../shared/core-protocol.js";
import { SeededRandom } from "../random.js";
import { CoreActionSystem, type ActionEvent } from "./actions.js";
import type {
  AgentStrategist,
  StrategyDecision,
  StrategyRequest,
} from "./agent-strategist.js";
import {
  observedCompoundPlans,
  type CompoundPlanOption,
} from "./compound-plans.js";
import {
  expandContraptionPlans,
  planBaseId,
} from "./contraption-grammar.js";
import { specialPlans } from "./special-plans.js";
import { REPO_AGENT_CONTEXT_TEXT } from "./repo-context.js";
import { CorePhysicsWorld } from "./physics.js";

export interface AutonomousActionLane {
  workerId: string;
  actions: CoreActionSystem;
}

export interface AutonomousTeamLane {
  team: Team;
  actions: CoreActionSystem;
}

interface WorkAssignment {
  actorIds: string[];
  targetId: string;
  carryHeight: number;
  floorHeight: number;
  z: number;
  carryPort?: string;
}

interface RuleCandidate {
  id: string;
  actorIds: string[];
  requests: LegalActionRequest[];
}

interface PendingFigureDecision {
  request: StrategyRequest;
  candidates: Map<string, RuleCandidate[]>;
  deadline: number;
}

interface PendingTeamDecision {
  request: StrategyRequest;
  options: Map<Team, CompoundPlanOption[]>;
  deadline: number;
}

const HUMPTY_LINES = [
  "I should like it noted that I remain the principal load.",
  "Both sides appear to be measuring me without permission.",
  "A little less competence would be considerably soothing.",
  "Please test the brakes before introducing me to gravity.",
] as const;

const QUEEN_LINES = [
  "Bring me timber, iron, and one excellent consequence.",
  "The tower has opinions. Strike them out of it.",
  "Let gravity serve the crown that understands it.",
  "Again. The egg remains offensively spherical.",
] as const;

const RULE_LINES: Record<Team, Record<string, string>> = {
  king: {
    "muster-footing": "Advance the rescue footing.",
    "muster-shaft": "Bring the keyed shaft into the rescue lane.",
    "muster-bearing": "Bring the bearing hub inward.",
    "survey-wheel": "Read the wheel stock before committing an axle.",
    "survey-sheave": "Read the sheave stock before committing a line.",
    "survey-line": "Inspect the rescue line and its approaches.",
    "survey-beam": "Inspect the beam stock for a receiving frame.",
    "hold-footing": "Hold the rescue footing ready.",
    "hold-shaft": "Hold the rescue shaft ready.",
    "hold-bearing": "Hold the rescue bearing ready.",
  },
  queen: {
    "muster-footing": "Advance the siege footing.",
    "muster-shaft": "Bring the keyed shaft into the pressure lane.",
    "muster-bearing": "Bring the bearing hub forward.",
    "survey-wheel": "Read the wheel stock before committing a drive.",
    "survey-sheave": "Watch the sheaves and the Red rope crew.",
    "survey-line": "Inspect the line stock for a counter-pull.",
    "survey-beam": "Inspect the beam stock for a striker.",
    "hold-footing": "Hold the siege footing ready.",
    "hold-shaft": "Hold the siege shaft ready.",
    "hold-bearing": "Hold the siege bearing ready.",
  },
};

const POSITION_RULES = [
  "survey-wheel",
  "survey-sheave",
  "survey-line",
  "survey-beam",
  "survey-tower",
] as const;
const GREEN_SHOT_TARGET = "tower-02-3";
const GREEN_TIMBER_SHIFT = .08;
const SIEGE_WAVE_COOLDOWN_TICKS = 120;

export class MockMatchDirector {
  private readonly reservedParts = new Set<string>();
  private readonly random: SeededRandom;
  private readonly strategyRandom: SeededRandom;
  private readonly ruleUseCounts = new Map<string, number>();
  private readonly activeRuleIds: Record<string, string> = {};
  private readonly nextDecisionTicks = new Map<string, number>();
  private readonly completedOpeningMoves = new Set<string>();
  private readonly recentlyBusyWorkers = new Set<string>();
  private readonly completedMachineTeams = new Set<Team>();
  private readonly machinePlanWasBusy = new Set<Team>();
  private readonly machineIdleStartTicks = new Map<Team, number>();
  private readonly machineEvidence = new Set<string>();
  private readonly machineStartPositions = new Map<string, Vec3>();
  private readonly machineStartRotations = new Map<string, Quat>();
  private readonly selectedMachinePlans = new Map<Team, CompoundPlanOption>();
  private readonly attemptedMachinePlans: Record<Team, Set<string>> = {
    king: new Set(),
    queen: new Set(),
  };
  private readonly recoveryCounts: Record<Team, number> = { king: 0, queen: 0 };
  private readonly machinePlanOptions: Record<Team, MachinePlanOptionState[]> = {
    king: [],
    queen: [],
  };
  private readonly machinePlans: Record<Team, string> = {
    king: "awaiting parts",
    queen: "awaiting parts",
  };
  private combatPlansStarted = false;
  private siegeWave = 0;
  private nextSiegeWaveTick: number | undefined;
  private readonly announcedPressure = new Set<number>();
  private pendingFigureDecision: PendingFigureDecision | undefined;
  private pendingTeamDecision: PendingTeamDecision | undefined;
  private strategySequence = 0;
  private greenShotArmed = false;
  private redClimbGain = 0;
  private greenShotTravel = 0;
  private greenTimberTravel = 0;
  private greenCounterweightTravel = 0;
  private status: CoreMatchState["status"];
  private phase: CoreMatchState["phase"];
  private moves = 0;
  private outcome: CoreMatchState["outcome"];
  private peakDownwardSpeed = 0;
  private safeFloorSeconds = 0;

  constructor(
    private readonly physics: CorePhysicsWorld,
    private readonly lanes: readonly AutonomousActionLane[],
    private readonly teamLanes: readonly AutonomousTeamLane[],
    private readonly emit: (event: ActionEvent) => void,
    seed: number,
    enabled: boolean,
    private readonly strategist?: AgentStrategist,
  ) {
    this.random = new SeededRandom(seed ^ 0x524f4f4b);
    this.strategyRandom = new SeededRandom(seed ^ 0x4d414348);
    this.status = enabled ? "waiting" : "manual";
    this.phase = enabled ? "muster" : "manual";
    for (const lane of lanes) {
      this.nextDecisionTicks.set(lane.workerId, enabled ? 60 : Number.POSITIVE_INFINITY);
    }
  }

  update(): void {
    if (this.status === "manual" || this.status === "complete") return;
    if (this.combatPlansStarted) this.observeCompoundMachines();
    const elapsed = this.physics.tick * CORE_FIXED_DT;
    this.updateObjectiveState();
    if (this.outcome !== undefined) return;
    this.updateSiegePressure(elapsed);
    if (evaluateSiegeClock(elapsed, this.physics.records.get("humpty")?.integrity ?? 100) === "king") {
      this.finish("king", "The ten-minute bell rings with Humpty uncracked. Red survives the siege and wins.");
      return;
    }
    if (this.status === "waiting") {
      if (this.physics.tick < 60) return;
      this.status = "active";
      this.emit({
        text: `The autonomous match begins. Six figures choose independently from ${AGENT_RULES.length} public rules.`,
        technical: `match:start:autonomous:${this.strategist?.enabled ? "llm" : "mock"}:rules:${AGENT_RULES.length}`,
      });
      this.emit({ text: HUMPTY_LINES[0], technical: "match:speech:humpty" });
      this.emit({ text: QUEEN_LINES[0], team: "queen", technical: "match:speech:queen" });
    }
    if (!this.combatPlansStarted && this.completedOpeningMoves.size === this.lanes.length) {
      if (this.lanes.every((lane) => !lane.actions.isBusy())) this.startCompoundPlans();
      return;
    }
    if (this.combatPlansStarted && this.updateCompoundPlans()) return;
    if (this.pendingFigureDecision) {
      this.resolveFigureDecision();
      return;
    }
    const dueLanes: AutonomousActionLane[] = [];
    for (const lane of this.lanes) {
      if (lane.actions.isBusy()) {
        this.recentlyBusyWorkers.add(lane.workerId);
        continue;
      }
      if (this.recentlyBusyWorkers.delete(lane.workerId)) {
        this.nextDecisionTicks.set(lane.workerId, this.physics.tick + 180);
        continue;
      }
      const nextTick = this.nextDecisionTicks.get(lane.workerId) ?? 0;
      if (this.physics.tick < nextTick) continue;
      dueLanes.push(lane);
    }
    if (dueLanes.length > 0) this.beginFigureDecision(dueLanes);
    this.updatePhase();
  }

  stopForManualControl(): void {
    if (this.status === "manual") return;
    for (const lane of this.lanes) lane.actions.cancelAll("", false);
    for (const lane of this.teamLanes) lane.actions.cancelAll("", false);
    if (this.pendingFigureDecision) this.strategist?.cancel(this.pendingFigureDecision.request.id);
    if (this.pendingTeamDecision) this.strategist?.cancel(this.pendingTeamDecision.request.id);
    this.pendingFigureDecision = undefined;
    this.pendingTeamDecision = undefined;
    this.status = "manual";
    this.phase = "manual";
    for (const lane of this.lanes) {
      this.nextDecisionTicks.set(lane.workerId, Number.POSITIVE_INFINITY);
    }
    this.emit({
      text: "All six autonomous figures yield the stage to the command desk.",
      technical: "match:manual",
    });
  }

  usesManualControl(): boolean {
    return this.status === "manual";
  }

  usesCompoundControl(): boolean {
    return this.combatPlansStarted && this.completedMachineTeams.size < this.teamLanes.length;
  }

  destroy(): void {
    if (this.pendingFigureDecision) this.strategist?.cancel(this.pendingFigureDecision.request.id);
    if (this.pendingTeamDecision) this.strategist?.cancel(this.pendingTeamDecision.request.id);
  }

  snapshot(): CoreMatchState {
    const compoundControl = this.usesCompoundControl();
    const applicableRuleIds = Object.fromEntries(this.lanes.map((lane) => [
      lane.workerId,
      this.status === "manual" || this.status === "complete"
        ? []
        : compoundControl
          ? [this.activeRuleIds[lane.workerId] ?? "test-assembly"]
        : this.applicableCandidates(lane.workerId).map((candidate) => candidate.id),
    ]));
    const idleCountdowns = this.lanes
      .filter((lane) => !lane.actions.isBusy())
      .map((lane) => Math.max(
        0,
        ((this.nextDecisionTicks.get(lane.workerId) ?? this.physics.tick) - this.physics.tick) * CORE_FIXED_DT,
      ));
    const state: CoreMatchState = {
      driver: this.status === "manual" ? "manual" : this.strategist?.enabled ? "llm" : "mock",
      status: this.status,
      phase: this.phase,
      urgency: siegeUrgency(this.physics.tick * CORE_FIXED_DT, this.status),
      timeRemaining: Math.max(0, CORE_MATCH_DURATION_SECONDS - this.physics.tick * CORE_FIXED_DT),
      moves: this.moves,
      busyWorkers: compoundControl
        ? this.teamLanes.flatMap((lane) => lane.actions.states()).filter((worker) => worker.phase !== "idle").length
        : this.lanes.filter((lane) => lane.actions.isBusy()).length,
      kingObjective: this.status === "manual"
        ? "Await orders from the command desk."
        : AGENT_OBJECTIVES.king.text,
      queenObjective: this.status === "manual"
        ? "Await orders from the command desk."
        : AGENT_OBJECTIVES.queen.text,
      rulebookSize: AGENT_RULES.length,
      activeRuleIds: { ...this.activeRuleIds },
      applicableRuleIds,
      machinePlans: { ...this.machinePlans },
      machinePlanOptions: {
        king: this.machinePlanOptions.king.map(clonePlanOptionState),
        queen: this.machinePlanOptions.queen.map(clonePlanOptionState),
      },
      selectedMachinePlanIds: Object.fromEntries(
        [...this.selectedMachinePlans].map(([team, plan]) => [team, plan.id]),
      ),
      machineEvidence: [...this.machineEvidence],
      queenAdvantage: this.physics.queenAdvantageState(),
      nextMoveIn: idleCountdowns.length > 0 ? Math.min(...idleCountdowns) : 0,
    };
    if (this.outcome) state.outcome = this.outcome;
    return state;
  }

  private updateObjectiveState(): void {
    const humpty = this.physics.records.get("humpty");
    const velocity = this.physics.bodyLinearVelocity("humpty");
    if (!humpty || !velocity) return;
    const floorContact = this.physics.contactCount("humpty", "stage-floor") > 0;
    if (!floorContact) {
      if (velocity.y < 0) this.peakDownwardSpeed = Math.max(this.peakDownwardSpeed, -velocity.y);
      else if (velocity.y > .2) this.peakDownwardSpeed = 0;
    }
    const impactSpeed = Math.max(this.peakDownwardSpeed, Math.max(0, -velocity.y));
    const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
    const decision = evaluateMatchObjective({
      integrity: humpty.integrity ?? 100,
      floorContact,
      impactSpeed,
      speed,
      safeFloorSeconds: this.safeFloorSeconds,
      dt: CORE_FIXED_DT,
    });
    this.safeFloorSeconds = decision.safeFloorSeconds;
    if (decision.reason === "hard-impact") {
      this.physics.applyDamage("humpty", 100);
      this.emit({
        text: `Humpty strikes the stage floor at ${impactSpeed.toFixed(1)} m/s and cracks.`,
        technical: `match:impact:${impactSpeed.toFixed(2)}`,
      });
      this.finish("queen", "Green wins: the siege breaks Humpty before the ten-minute bell.");
      return;
    }
    if (decision.reason === "zero-integrity") {
      this.finish("queen", "Green cracks Humpty before the ten-minute bell.");
      return;
    }
  }

  private startCompoundPlans(): void {
    this.physics.ensureQueenAdvantage();
    this.combatPlansStarted = true;
    this.siegeWave = 1;
    this.phase = "contest";
    for (const lane of this.lanes) lane.actions.cancelAll("", false);
    for (const timberId of this.physics.towerBlockIds()) {
      const timber = this.physics.bodyPosition(timberId);
      if (timber) this.machineStartPositions.set(`green-timber:${timberId}`, timber);
    }
    this.emit({
      text: "Siege wave one begins. Red fortifies the hill while Green commits its first war machine.",
      technical: "match:siege:wave:1",
    });
    this.beginTeamDecision(this.teamLanes, "scheduled");
  }

  private beginTeamDecision(
    teamLanes: readonly AutonomousTeamLane[],
    trigger: StrategyRequest["trigger"],
  ): void {
    const options = new Map<Team, CompoundPlanOption[]>();
    for (const teamLane of teamLanes) {
      const available = this.availableMachinePlans(teamLane.team);
      this.machinePlanOptions[teamLane.team] = available.map((plan) => ({
        id: plan.id,
        ruleId: plan.ruleId,
        label: plan.label,
        eligible: plan.eligible && !this.isAttempted(teamLane.team, plan),
        observedFacts: [...plan.observedFacts],
        missingFacts: plan.requiredFacts.filter((fact) => !plan.observedFacts.includes(fact)),
      }));
      options.set(teamLane.team, available.filter((plan) =>
        plan.eligible && !this.isAttempted(teamLane.team, plan)));
    }
    if (!this.strategist?.enabled) {
      for (const teamLane of teamLanes) {
        const teamOptions = options.get(teamLane.team) ?? [];
        this.launchMachinePlan(teamLane, teamOptions, this.chooseMachinePlan(teamOptions), "mock");
      }
      this.captureMachineStarts();
      return;
    }
    const request: StrategyRequest = {
      id: `team-${++this.strategySequence}-${this.physics.tick}`,
      phase: this.phase,
      trigger,
      repositoryContext: REPO_AGENT_CONTEXT_TEXT,
      teams: teamLanes.map((lane) => ({
        team: lane.team,
        objective: AGENT_OBJECTIVES[lane.team].text,
        observedFacts: this.machinePlanOptions[lane.team].flatMap((plan) => plan.observedFacts),
        attemptedPlanIds: [...this.attemptedMachinePlans[lane.team]],
        options: (options.get(lane.team) ?? []).map((plan) => ({
          id: plan.id,
          ruleId: plan.ruleId,
          label: plan.label,
          observedFacts: plan.observedFacts,
          missingFacts: plan.requiredFacts.filter((fact) => !plan.observedFacts.includes(fact)),
          capabilities: plan.capabilities,
          simpleMachines: plan.simpleMachines,
        })),
      })),
    };
    const decisionOptions = new Map([...options].filter(([, plans]) => plans.length > 0));
    for (const teamLane of teamLanes) {
      if ((options.get(teamLane.team) ?? []).length > 0) {
        this.machinePlans[teamLane.team] = trigger === "scheduled" ? "choosing from observed facts" : "reassessing the changed stage";
      } else {
        this.launchMachinePlan(teamLane, [], undefined, "llm");
      }
    }
    if (decisionOptions.size === 0) return;
    request.teams = (request.teams ?? []).filter((team) => decisionOptions.has(team.team));
    this.pendingTeamDecision = { request, options: decisionOptions, deadline: Date.now() + 8_200 };
    this.strategist.request(request);
  }

  private resolveTeamDecision(): void {
    const pending = this.pendingTeamDecision;
    if (!pending || !this.strategist) return;
    const poll = this.strategist.poll(pending.request.id);
    if (poll.state === "pending" && Date.now() < pending.deadline) return;
    if (poll.state === "pending") this.strategist.cancel(pending.request.id);
    const decision = poll.state === "ready" ? poll.decision : undefined;
    const source = decision ? "llm" : "mock";
    if (!decision) {
      this.emit({
        text: "The model strategist yields; the seeded field rules keep every figure moving.",
        technical: `match:strategy:fallback:${poll.state}`,
      });
    }
    for (const [team, teamOptions] of pending.options) {
      const lane = this.teamLanes.find((candidate) => candidate.team === team);
      if (!lane) continue;
      const selectedId = decision?.teams.find((choice) => choice.team === team)?.planId;
      const selected = teamOptions.find((plan) => plan.id === selectedId) ?? this.chooseMachinePlan(teamOptions);
      const say = decision?.teams.find((choice) => choice.team === team)?.say;
      this.launchMachinePlan(lane, teamOptions, selected, source, say);
    }
    this.pendingTeamDecision = undefined;
    this.captureMachineStarts();
  }

  private launchMachinePlan(
    teamLane: AutonomousTeamLane,
    options: readonly CompoundPlanOption[],
    plan: CompoundPlanOption | undefined,
    source: "llm" | "mock",
    say?: string,
  ): void {
    const team = teamLane.team;
    if (!plan) {
      this.completedMachineTeams.add(team);
      this.machinePlans[team] = "no fresh observed-fact plan is legal";
      this.emit({
        text: `${team === "king" ? "Red" : "Green"} finds no fresh legal machine plan in the current stage facts.`,
        team,
        technical: `match:machine:${team}:no-eligible-plan`,
      });
      return;
    }
    this.selectedMachinePlans.set(team, plan);
    this.attemptedMachinePlans[team].add(plan.id);
    this.attemptedMachinePlans[team].add(planBaseId(plan));
    this.machinePlanWasBusy.delete(team);
    this.machineIdleStartTicks.delete(team);
    for (const fact of plan.observedFacts) this.machineEvidence.add(`${team}:fact:${fact}`);
    const result = teamLane.actions.enqueue(plan.requests);
    if (!result.ok) {
      this.machinePlans[team] = `rejected: ${result.message ?? "illegal plan"}`;
      this.emit({
        text: `${team === "king" ? "Red" : "Green"} rejects an unsafe compound-machine plan and will reassess.`,
        team,
        technical: `match:machine:${team}:rejected:plan:${plan.id}`,
      });
      this.machinePlanWasBusy.add(team);
      return;
    }
    this.moves += 1;
    this.machinePlans[team] = plan.label;
    for (const workerId of this.physics.workerIds(team)) this.activeRuleIds[workerId] = plan.ruleId;
    this.emit({
      text: `${plan.announcement} It is chosen by ${source === "llm" ? "the model strategist" : "the seeded field rules"} from ${options.length} eligible plans.`,
      team,
      technical: `match:machine:${team}:begin:${plan.ruleId}:plan:${plan.id}:source:${source}`,
    });
    if (say) this.emit({
      text: say,
      team,
      technical: team === "queen" ? "match:speech:queen" : `match:speech:worker:${team}`,
    });
    if (team === "queen") {
      const line = QUEEN_LINES[(this.attemptedMachinePlans.queen.size - 1) % QUEEN_LINES.length] ?? QUEEN_LINES[0];
      this.emit({ text: line, team, technical: "match:speech:queen" });
    } else {
      const line = HUMPTY_LINES[this.attemptedMachinePlans.king.size % HUMPTY_LINES.length] ?? HUMPTY_LINES[0];
      this.emit({ text: line, technical: "match:speech:humpty" });
    }
  }

  private updateCompoundPlans(): boolean {
    if (this.pendingTeamDecision) {
      this.resolveTeamDecision();
      return this.pendingTeamDecision !== undefined || this.completedMachineTeams.size < this.teamLanes.length;
    }
    for (const lane of this.teamLanes) {
      if (lane.actions.isBusy()) {
        this.machinePlanWasBusy.add(lane.team);
        this.machineIdleStartTicks.delete(lane.team);
        continue;
      }
      if (!this.machinePlanWasBusy.has(lane.team) || this.completedMachineTeams.has(lane.team)) continue;
      const selected = this.selectedMachinePlans.get(lane.team);
      const selectedBaseId = selected ? planBaseId(selected) : undefined;
      const impactIsResolving = selected?.composition?.some((component) => component === "wheel-shot")
        ? this.greenShotTravel > 0 && this.greenTimberTravel < GREEN_TIMBER_SHIFT
        : selected?.composition?.some((component) => component === "counterweight-sling")
          ? this.machineEvidence.has("green:sling-projectile-contact") && this.greenTimberTravel < GREEN_TIMBER_SHIFT
          : selected?.composition?.some((component) => component === "pivoted-striker")
            ? this.machineEvidence.has("green:striker-contact") && this.greenTimberTravel < GREEN_TIMBER_SHIFT
            : selectedBaseId === "wheel-shot"
        ? this.machineEvidence.has("green:projectile-contact") && this.greenTimberTravel < GREEN_TIMBER_SHIFT
        : selectedBaseId === "counterweight-sling"
          ? this.machineEvidence.has("green:sling-projectile-contact") && this.greenTimberTravel < GREEN_TIMBER_SHIFT
          : selectedBaseId === "pivoted-striker"
            ? this.machineEvidence.has("green:striker-contact") && this.greenTimberTravel < GREEN_TIMBER_SHIFT
        : selectedBaseId === "compound-ram"
          ? this.machineEvidence.has("green:ram-contact") && this.greenTimberTravel < .4
          : false;
      if (impactIsResolving) {
        const idleStart = this.machineIdleStartTicks.get(lane.team) ?? this.physics.tick;
        this.machineIdleStartTicks.set(lane.team, idleStart);
        if (this.physics.tick - idleStart < 180) {
          this.machinePlans[lane.team] = "impact resolving";
          continue;
        }
      }
      const passed = this.finalizeMachinePlan(lane.team, lane.actions);
      if (passed || this.recoveryCounts[lane.team] >= 1) {
        this.completedMachineTeams.add(lane.team);
      } else {
        this.scheduleRecovery(lane, "impact");
      }
    }
    if (this.completedMachineTeams.size < this.teamLanes.length) return true;

    const freshLanes = this.teamLanes.filter((lane) =>
      this.availableMachinePlans(lane.team).some((plan) => plan.eligible && !this.isAttempted(lane.team, plan)));
    if (freshLanes.length === 0) {
      for (const lane of this.lanes) this.nextDecisionTicks.set(lane.workerId, this.physics.tick + 120);
      return false;
    }
    if (this.nextSiegeWaveTick === undefined) {
      this.nextSiegeWaveTick = this.physics.tick + SIEGE_WAVE_COOLDOWN_TICKS;
      for (const lane of freshLanes) this.machinePlans[lane.team] = "rearming for the next siege wave";
      return true;
    }
    if (this.physics.tick < this.nextSiegeWaveTick) return true;

    this.nextSiegeWaveTick = undefined;
    this.siegeWave += 1;
    for (const lane of freshLanes) {
      this.completedMachineTeams.delete(lane.team);
      this.selectedMachinePlans.delete(lane.team);
      this.machinePlanWasBusy.delete(lane.team);
      this.machineIdleStartTicks.delete(lane.team);
      this.recoveryCounts[lane.team] = 0;
      lane.actions.clearReservations();
    }
    this.emit({
      text: `Siege wave ${this.siegeWave} begins. The crews abandon restraint and commit another legal machine packet.`,
      technical: `match:siege:wave:${this.siegeWave}`,
    });
    this.beginTeamDecision(freshLanes, "impact");
    return true;
  }

  private availableMachinePlans(team: Team): CompoundPlanOption[] {
    return [
      ...expandContraptionPlans(observedCompoundPlans(this.physics, team)),
      ...specialPlans(this.physics, team),
    ];
  }

  private updateSiegePressure(elapsed: number): void {
    const thresholds = [300, 480, 540] as const;
    for (const threshold of thresholds) {
      if (elapsed < threshold || this.announcedPressure.has(threshold)) continue;
      this.announcedPressure.add(threshold);
      const text = threshold === 300
        ? "Five minutes remain. Green widens the bombardment while Red braces the hill."
        : threshold === 480
          ? "Two minutes remain. The siege turns desperate; every surviving machine is committed."
          : "Last minute. Green needs a crack now. Red needs only the bell.";
      this.emit({ text, technical: `match:siege:pressure:${threshold}` });
    }
  }

  private scheduleRecovery(
    lane: AutonomousTeamLane,
    trigger: StrategyRequest["trigger"],
  ): void {
    if (this.pendingTeamDecision || this.completedMachineTeams.has(lane.team)) return;
    this.recoveryCounts[lane.team] += 1;
    lane.actions.cancelAll("", false);
    lane.actions.clearReservations();
    this.selectedMachinePlans.delete(lane.team);
    this.machinePlanWasBusy.delete(lane.team);
    this.machineIdleStartTicks.delete(lane.team);
    this.emit({
      text: `${lane.team === "king" ? "Red" : "Green"} records the changed contacts and chooses a different machine.`,
      team: lane.team,
      technical: `match:machine:${lane.team}:recover:${trigger}:attempt:${this.recoveryCounts[lane.team]}`,
    });
    this.beginTeamDecision([lane], trigger);
  }

  private observeCompoundMachines(): void {
    for (const lane of this.teamLanes) {
      const plan = this.selectedMachinePlans.get(lane.team);
      if (!plan) continue;
      if (plan.composition?.length) {
        for (const component of plan.composition) this.observeMachineComponent(component, plan, lane.actions);
        continue;
      }
      const baseId = planBaseId(plan);
      if (baseId === "escalade-ramp") this.observeEscalade(plan);
      if (baseId === "rescue-hoist") this.observeRescueHoist(plan, lane.actions);
      if (baseId === "wheel-shot") this.observeWheelShot(plan);
      if (baseId === "compound-ram") this.observeCompoundRam(plan, lane.actions);
      if (baseId === "pivoted-striker") this.observePivotedStriker(plan);
      if (baseId === "counterweight-sling") this.observeCounterweightSling(plan, lane.actions);
    }
    for (const timberId of this.physics.towerBlockIds()) {
      const timberStart = this.machineStartPositions.get(`green-timber:${timberId}`);
      const timber = this.physics.bodyPosition(timberId);
      if (timberStart && timber) {
        this.greenTimberTravel = Math.max(this.greenTimberTravel, distance(timberStart, timber));
      }
    }
  }

  private observeMachineComponent(
    component: string,
    plan: CompoundPlanOption,
    actions: CoreActionSystem,
  ): void {
    const componentPlan = plan.componentParts?.[component]
      ? { ...plan, parts: plan.componentParts[component] }
      : plan;
    if (component === "escalade-ramp") this.observeEscalade(componentPlan);
    if (component === "rescue-hoist") this.observeRescueHoist(componentPlan, actions);
    if (component === "wheel-shot") this.observeWheelShot(componentPlan);
    if (component === "compound-ram") this.observeCompoundRam(componentPlan, actions);
    if (component === "pivoted-striker") this.observePivotedStriker(componentPlan);
    if (component === "counterweight-sling") this.observeCounterweightSling(componentPlan, actions);
  }

  private chooseMachinePlan(options: readonly CompoundPlanOption[]): CompoundPlanOption | undefined {
    const eligible = options.filter((option) => option.eligible);
    if (eligible.length === 0) return undefined;
    const canonical = eligible.filter((option) =>
      !option.id.includes(":") &&
      !option.composition?.length &&
      option.ruleId !== "fire-queen-crown-bolt" &&
      option.ruleId !== "strike-queen-command-post",
    );
    const choices = canonical.length > 0 ? canonical : eligible;
    const total = choices.reduce((sum, option) => sum + option.weight, 0);
    let roll = this.strategyRandom.range(0, total);
    for (const option of choices) {
      roll -= option.weight;
      if (roll <= 0) return option;
    }
    return choices.at(-1);
  }

  private captureMachineStarts(): void {
    const redPlan = this.selectedMachinePlans.get("king");
    if (redPlan && (planBaseId(redPlan) === "escalade-ramp" || redPlan.composition?.includes("escalade-ramp"))) {
      const climber = this.physics.bodyPosition("king-worker-3");
      if (climber) this.machineStartPositions.set("red-climber", climber);
    }
    const greenPlan = this.selectedMachinePlans.get("queen");
    if (greenPlan?.parts.target) {
      const target = this.physics.bodyPosition(greenPlan.parts.target);
      if (target) this.machineStartPositions.set("green-machine-target", target);
    }
    for (const component of greenPlan?.composition ?? []) {
      const targetId = greenPlan?.componentParts?.[component]?.target;
      const target = targetId ? this.physics.bodyPosition(targetId) : undefined;
      if (target) this.machineStartPositions.set(`green-machine-target:${component}`, target);
    }
    if (greenPlan) {
      this.greenShotArmed = false;
      this.greenShotTravel = 0;
      this.greenTimberTravel = 0;
      this.greenCounterweightTravel = 0;
      for (const timberId of this.physics.towerBlockIds()) {
        const timber = this.physics.bodyPosition(timberId);
        if (timber) this.machineStartPositions.set(`green-timber:${timberId}`, timber);
      }
    }
  }

  private observeEscalade(plan: CompoundPlanOption): void {
    const climbStart = this.machineStartPositions.get("red-climber");
    const climber = this.physics.bodyPosition("king-worker-3");
    if (climbStart && climber) {
      this.redClimbGain = Math.max(this.redClimbGain, climber.y - climbStart.y);
    }
    if (this.physics.contactCount(plan.parts.wedge ?? "", plan.parts.plank ?? "") > 0) {
      this.machineEvidence.add("red:ramp-supported");
    }
  }

  private observeRescueHoist(plan: CompoundPlanOption, actions: CoreActionSystem): void {
    if (actions.activeDescription()?.startsWith("tension:work") &&
      !this.machineStartPositions.has("red-hoist-load")) {
      const load = this.physics.bodyPosition(plan.parts.load ?? "");
      if (load) this.machineStartPositions.set("red-hoist-load", load);
    }
    const connections = actions.connectionStates();
    const ropeId = plan.parts.rope;
    const ropeConnections = connections.filter((connection) =>
      connection.class === "ROPE_ATTACH" &&
      (connection.bodyA === ropeId || connection.bodyB === ropeId));
    const receivers = new Set(ropeConnections.map((connection) => {
      const receiverId = connection.bodyA === ropeId ? connection.bodyB : connection.bodyA;
      return this.physics.records.get(receiverId)?.family;
    }));
    if (connections.some((connection) => connection.class === "KEYED_COAXIAL")) {
      this.machineEvidence.add("red:hoist-keyed");
    }
    if (receivers.has("sheave")) this.machineEvidence.add("red:line-reeved");
    if (receivers.has("plank")) this.machineEvidence.add("red:load-hooked");
    if (ropeConnections.some((connection) => (connection.tension ?? 0) > 0)) {
      this.machineEvidence.add("red:line-tensioned");
    }
  }

  private observeWheelShot(plan: CompoundPlanOption): void {
    const wedgeId = plan.parts.wedge ?? "";
    const railId = plan.parts.rail ?? "";
    const wheelId = plan.parts.projectile ?? "";
    const targetId = plan.parts.target ?? GREEN_SHOT_TARGET;
    if (this.physics.contactCount(wedgeId, railId) > 0) this.machineEvidence.add("green:ramp-supported");
    if (this.physics.contactCount(wheelId, targetId) > 0) this.machineEvidence.add("green:projectile-contact");
    const wheelRecord = this.physics.records.get(wheelId);
    if (!this.greenShotArmed && !wheelRecord?.carriedBy && this.physics.contactCount(wheelId, railId) > 0) {
      const armedPosition = this.physics.bodyPosition(wheelId);
      if (armedPosition) {
        this.greenShotArmed = true;
        this.machineStartPositions.set("green-wheel", armedPosition);
        this.machineEvidence.add("green:wheel-armed");
      }
    }
    const wheelStart = this.machineStartPositions.get("green-wheel");
    const wheel = this.physics.bodyPosition(wheelId);
    if (wheelStart && wheel) this.greenShotTravel = Math.max(this.greenShotTravel, distance(wheelStart, wheel));
  }

  private observeCompoundRam(plan: CompoundPlanOption, actions: CoreActionSystem): void {
    const targetId = plan.parts.target ?? "";
    const strikerId = plan.parts.striker ?? "";
    if (actions.activeDescription()?.startsWith("push:") && !this.machineEvidence.has("green:ram-push-started")) {
      this.machineEvidence.add("green:ram-push-started");
      for (const wheelId of [plan.parts.negativeWheel, plan.parts.positiveWheel]) {
        if (!wheelId) continue;
        const rotation = this.physics.bodyRotation(wheelId);
        if (rotation) this.machineStartRotations.set(wheelId, rotation);
      }
    }
    if (this.machineEvidence.has("green:ram-push-started")) {
      const wheelTurns = [plan.parts.negativeWheel, plan.parts.positiveWheel].map((wheelId) => {
        const initial = wheelId ? this.machineStartRotations.get(wheelId) : undefined;
        const current = wheelId ? this.physics.bodyRotation(wheelId) : undefined;
        return initial && current ? quaternionDistance(initial, current) : 0;
      });
      if (wheelTurns.length === 2 && wheelTurns.every((turn) => turn >= .6)) {
        this.machineEvidence.add("green:ram-wheels-rolling");
      }
    }
    if (this.physics.contactCount(strikerId, targetId) > 0) this.machineEvidence.add("green:ram-contact");
  }

  private observePivotedStriker(plan: CompoundPlanOption): void {
    const strikerId = plan.parts.striker ?? "";
    const fulcrumId = plan.parts.fulcrum ?? "";
    const targetId = plan.parts.target ?? "";
    if (this.physics.contactCount(strikerId, fulcrumId) > 0) {
      this.machineEvidence.add("green:striker-supported");
    }
    if (this.physics.contactCount(strikerId, targetId) > 0) {
      this.machineEvidence.add("green:striker-contact");
    }
  }

  private observeCounterweightSling(plan: CompoundPlanOption, actions: CoreActionSystem): void {
    const ropeId = plan.parts.rope ?? "";
    const projectileId = plan.parts.projectile ?? "";
    const counterweightId = plan.parts.counterweight ?? "";
    const targetId = plan.parts.target ?? GREEN_SHOT_TARGET;
    const connections = actions.connectionStates();
    const ropeConnections = connections.filter((connection) =>
      connection.class === "ROPE_ATTACH" &&
      (connection.bodyA === ropeId || connection.bodyB === ropeId));
    if (connections.some((connection) => connection.class === "KEYED_COAXIAL")) {
      this.machineEvidence.add("green:sling-keyed");
    }
    if (ropeConnections.length === 2) this.machineEvidence.add("green:sling-routed");
    if (ropeConnections.some((connection) => (connection.tension ?? 0) > 0)) {
      this.machineEvidence.add("green:sling-tensioned");
    }
    if (actions.activeDescription()?.startsWith("tension:work") &&
      !this.machineStartPositions.has("green-sling-counterweight")) {
      const position = this.physics.bodyPosition(counterweightId);
      if (position) this.machineStartPositions.set("green-sling-counterweight", position);
    }
    const counterweightStart = this.machineStartPositions.get("green-sling-counterweight");
    const counterweight = this.physics.bodyPosition(counterweightId);
    if (counterweightStart && counterweight) {
      this.greenCounterweightTravel = Math.max(
        this.greenCounterweightTravel,
        distance(counterweightStart, counterweight),
      );
    }
    if (this.physics.contactCount(projectileId, targetId) > 0) {
      this.machineEvidence.add("green:sling-projectile-contact");
    }
    if (!this.machineStartPositions.has("green-sling-projectile") &&
      actions.activeDescription()?.startsWith("pull:")) {
      const position = this.physics.bodyPosition(projectileId);
      if (position) this.machineStartPositions.set("green-sling-projectile", position);
    }
    const projectileStart = this.machineStartPositions.get("green-sling-projectile");
    const projectile = this.physics.bodyPosition(projectileId);
    if (projectileStart && projectile) {
      this.greenShotTravel = Math.max(this.greenShotTravel, distance(projectileStart, projectile));
    }
  }

  private finalizeMachinePlan(team: Team, actions: CoreActionSystem): boolean {
    const plan = this.selectedMachinePlans.get(team);
    if (!plan || this.completedMachineTeams.has(team)) return true;
    if (plan.composition?.length) return this.finalizeHybridMachinePlan(team, plan, actions);
    const baseId = planBaseId(plan);
    if (plan.ruleId === "fire-queen-crown-bolt") {
      const state = this.physics.queenAdvantageState();
      const passed = Boolean(plan.parts.bolt && state.firedBoltIds.includes(plan.parts.bolt));
      this.machinePlans.queen = passed ? "crown bolt fired" : "crown bolt misfired";
      if (passed) this.machineEvidence.add(`green:crown-bolt:${plan.parts.bolt}`);
      this.emit({
        text: passed
          ? "Green's mad Queen fires a physical crown bolt into the theatre."
          : "Green reaches the command post, but the crown bolt sequence fails.",
        team,
        technical: `match:machine:queen:${passed ? "pass" : "incomplete"}:plan:${plan.id}:bolt:${plan.parts.bolt ?? "none"}`,
      });
      return passed;
    }
    if (plan.ruleId === "strike-queen-command-post") {
      const state = this.physics.queenAdvantageState();
      const passed = state.disabled;
      this.machinePlans.king = passed ? "command post broken" : "command post damaged";
      if (passed) this.machineEvidence.add("red:queen-command-post-broken");
      this.emit({
        text: passed
          ? "Red's second strike breaks the Queen's command post before it can fire again."
          : `Red batters the command post to ${Math.round(state.deviceIntegrity)}% integrity, but it still threatens the stage.`,
        team,
        technical: `match:machine:king:${passed ? "pass" : "incomplete"}:plan:${plan.id}:integrity:${Math.round(state.deviceIntegrity)}`,
      });
      return passed;
    }
    if (baseId === "escalade-ramp") {
      const passed = this.redClimbGain >= .11 && this.machineEvidence.has("red:ramp-supported");
      if (this.redClimbGain >= .11) this.machineEvidence.add(`red:climbed:${this.redClimbGain.toFixed(2)}m`);
      this.machinePlans.king = passed ? "escalade climbed" : "escalade incomplete";
      this.emit({
        text: passed
          ? `Red climbs the compound ramp and gains ${this.redClimbGain.toFixed(2)} metres.`
          : `Red's ramp action ends after a ${this.redClimbGain.toFixed(2)} metre climb.`,
        team,
        technical: `match:machine:king:${passed ? "pass" : "incomplete"}:plan:${plan.id}:climb:${this.redClimbGain.toFixed(2)}`,
      });
      return passed;
    }
    if (baseId === "rescue-hoist") {
      const start = this.machineStartPositions.get("red-hoist-load");
      const end = this.physics.bodyPosition(plan.parts.load ?? "");
      const travel = start && end ? distance(start, end) : 0;
      const rise = start && end ? end.y - start.y : 0;
      const ropeId = plan.parts.rope;
      const ropeConnections = actions.connectionStates().filter((connection) =>
        connection.class === "ROPE_ATTACH" &&
        (connection.bodyA === ropeId || connection.bodyB === ropeId));
      const passed = ropeConnections.length === 2 &&
        this.machineEvidence.has("red:hoist-keyed") &&
        this.machineEvidence.has("red:line-reeved") &&
        this.machineEvidence.has("red:load-hooked") &&
        this.machineEvidence.has("red:line-tensioned") &&
        ropeConnections.every((connection) => connection.tested) &&
        ropeConnections.every((connection) => (connection.slack ?? 1) < .08) &&
        travel >= .2 && rise >= .04;
      if (travel >= .2) this.machineEvidence.add(`red:hoist-travel:${travel.toFixed(2)}m`);
      this.machinePlans.king = passed ? "routed hoist raised receiving load" : "routed hoist incomplete";
      this.emit({
        text: passed
          ? `Red's routed hoist raises and holds its receiving load through ${travel.toFixed(2)} metres of physical travel.`
          : `Red's routed hoist ends after ${travel.toFixed(2)} metres of load travel.`,
        team,
        technical: `match:machine:king:${passed ? "pass" : "incomplete"}:plan:${plan.id}:load:${travel.toFixed(2)}`,
      });
      return passed;
    }
    if (baseId === "wheel-shot") {
      const passed = this.machineEvidence.has("green:projectile-contact") && this.greenTimberTravel >= GREEN_TIMBER_SHIFT;
      if (this.greenShotTravel >= 1) this.machineEvidence.add(`green:shot-travel:${this.greenShotTravel.toFixed(2)}m`);
      if (this.greenTimberTravel >= GREEN_TIMBER_SHIFT) this.machineEvidence.add(`green:timber-travel:${this.greenTimberTravel.toFixed(2)}m`);
      this.machinePlans.queen = passed ? "wheel shot struck timber" : "wheel shot incomplete";
      this.emit({
        text: passed
          ? `Green's wheel shot strikes and shifts a tower timber ${this.greenTimberTravel.toFixed(2)} metres.`
          : `Green's wheel shot travels ${this.greenShotTravel.toFixed(2)} metres without a decisive timber shift.`,
        team,
        technical: `match:machine:queen:${passed ? "pass" : "incomplete"}:plan:${plan.id}:shot:${this.greenShotTravel.toFixed(2)}:timber:${this.greenTimberTravel.toFixed(2)}`,
      });
      return passed;
    }
    if (baseId === "pivoted-striker") {
      const targetStart = this.machineStartPositions.get("green-machine-target");
      const targetEnd = this.physics.bodyPosition(plan.parts.target ?? "");
      const targetTravel = targetStart && targetEnd ? distance(targetStart, targetEnd) : 0;
      const passed = this.machineEvidence.has("green:striker-supported") &&
        this.machineEvidence.has("green:striker-contact") && targetTravel >= GREEN_TIMBER_SHIFT;
      if (targetTravel >= GREEN_TIMBER_SHIFT) {
        this.machineEvidence.add(`green:striker-timber-travel:${targetTravel.toFixed(2)}m`);
      }
      this.machinePlans.queen = passed ? "pivoted striker drove timber" : "pivoted striker incomplete";
      this.emit({
        text: passed
          ? `Green's pivoted striker levers a tower timber ${targetTravel.toFixed(2)} metres.`
          : `Green's pivoted striker ends after ${targetTravel.toFixed(2)} metres of timber travel.`,
        team,
        technical: `match:machine:queen:${passed ? "pass" : "incomplete"}:plan:${plan.id}:timber:${targetTravel.toFixed(2)}`,
      });
      return passed;
    }
    if (baseId === "counterweight-sling") {
      const ropeId = plan.parts.rope;
      const ropeConnections = actions.connectionStates().filter((connection) =>
        connection.class === "ROPE_ATTACH" &&
        (connection.bodyA === ropeId || connection.bodyB === ropeId));
      const passed = ropeConnections.length === 2 &&
        ropeConnections.every((connection) => connection.tested) &&
        this.machineEvidence.has("green:sling-keyed") &&
        this.machineEvidence.has("green:sling-routed") &&
        this.machineEvidence.has("green:sling-tensioned") &&
        this.greenCounterweightTravel >= .1 &&
        this.machineEvidence.has("green:sling-projectile-contact") &&
        this.greenTimberTravel >= GREEN_TIMBER_SHIFT;
      if (this.greenCounterweightTravel >= .1) {
        this.machineEvidence.add(`green:counterweight-travel:${this.greenCounterweightTravel.toFixed(2)}m`);
      }
      if (this.greenShotTravel >= 1) {
        this.machineEvidence.add(`green:sling-shot-travel:${this.greenShotTravel.toFixed(2)}m`);
      }
      this.machinePlans.queen = passed ? "counterweight sling struck timber" : "counterweight sling incomplete";
      this.emit({
        text: passed
          ? `Green tensions the counterweight through ${this.greenCounterweightTravel.toFixed(2)} metres, then strikes a tower timber.`
          : `Green's sling releases after ${this.greenShotTravel.toFixed(2)} metres of projectile travel.`,
        team,
        technical: `match:machine:queen:${passed ? "pass" : "incomplete"}:plan:${plan.id}:weight:${this.greenCounterweightTravel.toFixed(2)}:shot:${this.greenShotTravel.toFixed(2)}`,
      });
      return passed;
    }
    const connections = actions.connectionStates();
    const targetStart = this.machineStartPositions.get("green-machine-target");
    const targetEnd = this.physics.bodyPosition(plan.parts.target ?? "");
    const targetTravel = targetStart && targetEnd ? distance(targetStart, targetEnd) : 0;
    const keyed = connections.filter((connection) => connection.class === "KEYED_COAXIAL").length;
    const passed = targetTravel >= .4 &&
      this.machineEvidence.has("green:ram-wheels-rolling") &&
      this.machineEvidence.has("green:ram-contact") &&
      keyed === 2 &&
      connections.some((connection) => connection.class === "AXLE_BEARING") &&
      connections.some((connection) => connection.class === "TENON_LOCK");
    this.greenTimberTravel = Math.max(this.greenTimberTravel, targetTravel);
    if (targetTravel >= .4) this.machineEvidence.add(`green:ram-timber-travel:${targetTravel.toFixed(2)}m`);
    this.machinePlans.queen = passed ? "wheeled ram drove timber clear" : "wheeled ram incomplete";
    this.emit({
      text: passed
        ? `Green's compound ram rolls, strikes, and drives a tower timber ${targetTravel.toFixed(2)} metres.`
        : `Green's compound ram ends after ${targetTravel.toFixed(2)} metres of timber travel.`,
      team,
      technical: `match:machine:queen:${passed ? "pass" : "incomplete"}:plan:${plan.id}:timber:${targetTravel.toFixed(2)}`,
    });
    return passed;
  }

  private finalizeHybridMachinePlan(
    team: Team,
    plan: CompoundPlanOption,
    actions: CoreActionSystem,
  ): boolean {
    const components = plan.composition ?? [];
    const componentPasses = components.map((component) => this.hybridComponentPassed(component, plan, actions));
    const passed = componentPasses.length > 0 && componentPasses.every(Boolean);
    const names = components.map((component) => component.replaceAll("-", " ")).join(" + ");
    this.machinePlans[team] = passed ? `hybrid ${names} landed` : `hybrid ${names} incomplete`;
    this.emit({
      text: passed
        ? `${team === "king" ? "Red" : "Green"} makes the improvised ${names} machine work as one compound sequence.`
        : `${team === "king" ? "Red" : "Green"}'s improvised ${names} machine ends with an unresolved contact.`,
      team,
      technical: `match:machine:${team}:${passed ? "pass" : "incomplete"}:plan:${plan.id}:hybrid`,
    });
    return passed;
  }

  private hybridComponentPassed(
    component: string,
    plan: CompoundPlanOption,
    actions: CoreActionSystem,
  ): boolean {
    const componentParts = plan.componentParts?.[component] ?? plan.parts;
    const componentPlan = { ...plan, parts: componentParts };
    if (component === "escalade-ramp") {
      return this.redClimbGain >= .11 && this.machineEvidence.has("red:ramp-supported");
    }
    if (component === "rescue-hoist") {
      const ropeId = componentPlan.parts.rope;
      const start = this.machineStartPositions.get("red-hoist-load");
      const end = this.physics.bodyPosition(componentPlan.parts.load ?? "");
      const ropeConnections = actions.connectionStates().filter((connection) =>
        connection.class === "ROPE_ATTACH" && (connection.bodyA === ropeId || connection.bodyB === ropeId));
      return ropeConnections.length === 2 &&
        this.machineEvidence.has("red:hoist-keyed") &&
        this.machineEvidence.has("red:line-reeved") &&
        this.machineEvidence.has("red:load-hooked") &&
        this.machineEvidence.has("red:line-tensioned") &&
        ropeConnections.every((connection) => connection.tested && (connection.slack ?? 1) < .08) &&
        Boolean(start && end && distance(start, end) >= .2 && end.y - start.y >= .04);
    }
    const targetStart = this.machineStartPositions.get(`green-machine-target:${component}`) ??
      this.machineStartPositions.get("green-machine-target");
    const targetEnd = this.physics.bodyPosition(componentPlan.parts.target ?? "");
    const targetTravel = targetStart && targetEnd ? distance(targetStart, targetEnd) : 0;
    if (component === "wheel-shot") {
      return this.machineEvidence.has("green:projectile-contact") && this.greenTimberTravel >= GREEN_TIMBER_SHIFT;
    }
    if (component === "pivoted-striker") {
      return this.machineEvidence.has("green:striker-supported") &&
        this.machineEvidence.has("green:striker-contact") && targetTravel >= GREEN_TIMBER_SHIFT;
    }
    if (component === "counterweight-sling") {
      const ropeId = componentPlan.parts.rope;
      const ropeConnections = actions.connectionStates().filter((connection) =>
        connection.class === "ROPE_ATTACH" && (connection.bodyA === ropeId || connection.bodyB === ropeId));
      return ropeConnections.length === 2 &&
        ropeConnections.every((connection) => connection.tested) &&
        this.machineEvidence.has("green:sling-keyed") &&
        this.machineEvidence.has("green:sling-routed") &&
        this.machineEvidence.has("green:sling-tensioned") &&
        this.greenCounterweightTravel >= .1 &&
        this.machineEvidence.has("green:sling-projectile-contact") &&
        this.greenTimberTravel >= GREEN_TIMBER_SHIFT;
    }
    if (component === "compound-ram") {
      const connections = actions.connectionStates();
      const keyed = connections.filter((connection) => connection.class === "KEYED_COAXIAL").length;
      return targetTravel >= .4 && this.machineEvidence.has("green:ram-wheels-rolling") &&
        this.machineEvidence.has("green:ram-contact") && keyed === 2 &&
        connections.some((connection) => connection.class === "AXLE_BEARING") &&
        connections.some((connection) => connection.class === "TENON_LOCK");
    }
    return false;
  }

  private beginFigureDecision(lanes: readonly AutonomousActionLane[]): void {
    if (!this.strategist?.enabled) {
      for (const lane of lanes) this.queueMove(lane);
      return;
    }
    const candidates = new Map(lanes.map((lane) => [lane.workerId, this.applicableCandidates(lane.workerId)]));
    const request: StrategyRequest = {
      id: `figures-${++this.strategySequence}-${this.physics.tick}`,
      phase: this.phase,
      trigger: this.machineEvidence.size > 0 ? "enemy-interference" : "scheduled",
      repositoryContext: REPO_AGENT_CONTEXT_TEXT,
      figures: lanes.map((lane) => ({
        workerId: lane.workerId,
        team: this.workerTeam(lane.workerId),
        objective: AGENT_OBJECTIVES[this.workerTeam(lane.workerId)].text,
        observedFacts: [
          `phase:${this.phase}`,
          `worker:idle`,
          ...[...this.machineEvidence].slice(-8),
        ],
        options: (candidates.get(lane.workerId) ?? []).map((candidate) => {
          const rule = AGENT_RULES_BY_ID.get(candidate.id);
          return {
            id: candidate.id,
            label: rule?.label ?? candidate.id,
            when: rule?.when ?? [],
          };
        }),
      })),
    };
    if ([...candidates.values()].some((choices) => choices.length === 0)) {
      for (const lane of lanes) this.queueMove(lane);
      return;
    }
    this.pendingFigureDecision = { request, candidates, deadline: Date.now() + 8_200 };
    this.strategist.request(request);
  }

  private resolveFigureDecision(): void {
    const pending = this.pendingFigureDecision;
    if (!pending || !this.strategist) return;
    const poll = this.strategist.poll(pending.request.id);
    if (poll.state === "pending" && Date.now() < pending.deadline) return;
    if (poll.state === "pending") this.strategist.cancel(pending.request.id);
    const decision = poll.state === "ready" ? poll.decision : undefined;
    if (!decision) {
      this.emit({
        text: "The model strategist yields; each figure falls back to its seeded rule weights.",
        technical: `match:strategy:figures:fallback:${poll.state}`,
      });
    }
    for (const [workerId, candidates] of pending.candidates) {
      const lane = this.lanes.find((candidate) => candidate.workerId === workerId);
      if (!lane) continue;
      const choice = decision?.figures.find((candidate) => candidate.workerId === workerId);
      const selected = candidates.find((candidate) => candidate.id === choice?.ruleId) ??
        this.chooseRuleFrom(workerId, candidates);
      this.queueMove(lane, selected, choice?.say);
    }
    this.pendingFigureDecision = undefined;
  }

  private queueMove(lane: AutonomousActionLane, selected?: RuleCandidate, say?: string): void {
    const candidate = selected ?? this.chooseRule(lane.workerId);
    if (!candidate) {
      this.nextDecisionTicks.set(lane.workerId, this.physics.tick + 60);
      return;
    }
    const result = lane.actions.enqueue(candidate.requests);
    if (!result.ok) {
      this.emit({
        text: `${this.workerName(lane.workerId)} rejects an illegal autonomous move: ${result.message ?? "unknown order"}`,
        actorId: lane.workerId,
        team: this.workerTeam(lane.workerId),
        technical: `match:move:rejected:${lane.workerId}:${candidate.id}`,
      });
      this.nextDecisionTicks.set(lane.workerId, this.physics.tick + 60);
      return;
    }
    this.moves += 1;
    this.commitChoice(lane.workerId, candidate);
    this.emitRule(lane.workerId, candidate);
    if (say) {
      this.emit({
        text: say,
        actorId: lane.workerId,
        team: this.workerTeam(lane.workerId),
        technical: `match:speech:worker:${lane.workerId}`,
      });
    }
    if (this.moves % 12 === 0) {
      const line = HUMPTY_LINES[Math.floor(this.moves / 12) % HUMPTY_LINES.length] ?? HUMPTY_LINES[0];
      this.emit({ text: line, technical: "match:speech:humpty" });
    }
    this.nextDecisionTicks.set(lane.workerId, this.physics.tick + 60);
  }

  private updatePhase(): void {
    const allWorkersBeyondMuster = this.lanes.every((lane) =>
      !this.activeRuleIds[lane.workerId]?.startsWith("muster-"));
    this.phase = allWorkersBeyondMuster
      ? this.moves < 24 ? "advance" : "contest"
      : "muster";
  }

  private chooseRule(workerId: string): RuleCandidate | undefined {
    const candidates = this.applicableCandidates(workerId);
    return this.chooseRuleFrom(workerId, candidates);
  }

  private chooseRuleFrom(workerId: string, candidates: readonly RuleCandidate[]): RuleCandidate | undefined {
    if (candidates.length === 0) return undefined;
    const weighted = candidates.map((candidate) => {
      const definition = AGENT_RULES_BY_ID.get(candidate.id);
      const previousPenalty = this.activeRuleIds[workerId] === candidate.id ? .22 : 1;
      const usePenalty = 1 / (1 + (this.ruleUseCounts.get(`${workerId}:${candidate.id}`) ?? 0) * .2);
      return {
        candidate,
        weight: (definition?.weight ?? 1) * previousPenalty * usePenalty,
      };
    });
    const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = this.random.range(0, total);
    for (const entry of weighted) {
      roll -= entry.weight;
      if (roll <= 0) return entry.candidate;
    }
    return weighted.at(-1)?.candidate;
  }

  private applicableCandidates(workerId: string): RuleCandidate[] {
    const team = this.workerTeam(workerId);
    const openingRule = this.openingRule(workerId);
    if (!this.completedOpeningMoves.has(workerId) && openingRule === "survey-tower") {
      return [this.positionCandidate(openingRule, team)];
    }
    const openingAssignment = this.assignmentForRule(team, openingRule);
    if (!this.completedOpeningMoves.has(workerId) && !this.reservedParts.has(openingAssignment.targetId)) {
      return [this.stageCandidate(openingRule, team, openingAssignment)];
    }
    return POSITION_RULES
      .map((ruleId) => this.positionCandidate(ruleId, team))
      .filter((candidate) => candidate.actorIds.includes(workerId));
  }

  private openingRule(workerId: string): "muster-beam" | "survey-tower" | "muster-bearing" {
    if (workerId.endsWith("-1")) return "muster-beam";
    if (workerId.endsWith("-2")) return "survey-tower";
    return "muster-bearing";
  }

  private stageCandidate(ruleId: string, team: Team, assignment: WorkAssignment): RuleCandidate {
    const direction = team === "king" ? -1 : 1;
    const baseX = ruleId === "muster-footing"
      ? 2.58
      : ruleId === "muster-shaft" ? 4.35
        : ruleId === "muster-beam" || ruleId === "muster-bearing" ? 1.5 : 3.35;
    const floorDestination: Vec3 = {
      x: direction * baseX,
      y: assignment.floorHeight,
      z: assignment.z,
    };
    const carryDestination = { ...floorDestination, y: assignment.carryHeight };
    const firstActor = assignment.actorIds[0] ?? `${team}-worker-1`;
    return {
      id: ruleId,
      actorIds: assignment.actorIds,
      requests: [
        { action: "reserve", actorIds: [firstActor], targetId: assignment.targetId },
        { action: "fetch", actorIds: assignment.actorIds, targetId: assignment.targetId },
        {
          action: "carry",
          actorIds: assignment.actorIds,
          targetId: assignment.targetId,
          ...(assignment.carryPort ? { targetPort: assignment.carryPort } : {}),
          destination: carryDestination,
        },
        {
          action: "release",
          actorIds: assignment.actorIds,
          targetId: assignment.targetId,
          targetPort: "stable-staging",
          destination: floorDestination,
        },
      ],
    };
  }

  private positionCandidate(ruleId: string, team: Team): RuleCandidate {
    const assignment = this.positionAssignment(team, ruleId);
    const isHold = ruleId.startsWith("hold-");
    return {
      id: ruleId,
      actorIds: assignment.actorIds,
      requests: [
        { action: "fetch", actorIds: assignment.actorIds, targetId: assignment.targetId },
        {
          action: isHold ? "hold" : "wait",
          actorIds: assignment.actorIds,
          targetId: assignment.targetId,
          magnitude: isHold ? 1.2 : .8,
        },
      ],
    };
  }

  private assignmentForRule(team: Team, ruleId: string): WorkAssignment {
    const ids = this.physics.inventoryIds(team);
    if (ruleId === "muster-beam") {
      return {
        actorIds: [`${team}-worker-1`],
        targetId: requiredPart(ids.filter((id) => id.includes("beam-medium")).at(1), `${team} medium beam`),
        carryHeight: .36,
        floorHeight: .09,
        z: -2.8,
        carryPort: "hold-front",
      };
    }
    if (ruleId === "muster-footing") {
      return {
        actorIds: [`${team}-worker-3`],
        targetId: requiredPart(ids.find((id) => id.includes("wedge")), `${team} wedge`),
        carryHeight: .36,
        floorHeight: .145,
        z: 2.35,
        carryPort: "hold-opposite",
      };
    }
    if (ruleId === "muster-shaft") {
      return {
        actorIds: [`${team}-worker-2`],
        targetId: requiredPart(ids.find((id) => id.includes("axle-long")), `${team} axle`),
        carryHeight: .42,
        floorHeight: .08,
        z: 0,
        carryPort: "hold-front",
      };
    }
    return {
      actorIds: [`${team}-worker-3`],
      targetId: requiredPart(ids.filter((id) => id.includes("hub")).at(0), `${team} hub`),
      carryHeight: .58,
      floorHeight: .28,
      z: 2.8,
    };
  }

  private positionAssignment(team: Team, ruleId: string): WorkAssignment {
    const ids = this.physics.inventoryIds(team);
    if (ruleId === "survey-wheel") {
      return this.patrolAssignment(team, `${team}-worker-2`, ids.filter((id) => id.includes("wheel")).at(1), "wheel");
    }
    if (ruleId === "survey-sheave") {
      return this.patrolAssignment(team, `${team}-worker-3`, ids.find((id) => id.includes("sheave")), "sheave");
    }
    if (ruleId === "survey-line") {
      return this.patrolAssignment(team, `${team}-worker-3`, ids.find((id) => id.includes("rope")), "rope");
    }
    if (ruleId === "survey-beam") {
      return this.patrolAssignment(team, `${team}-worker-1`, ids.filter((id) => id.includes("beam-medium")).at(1), "medium beam");
    }
    if (ruleId === "survey-tower") {
      return this.patrolAssignment(
        team,
        `${team}-worker-2`,
        team === "king" ? "tower-02-1" : "tower-02-3",
        "lower tower support",
      );
    }
    if (ruleId === "hold-footing") return this.assignmentForRule(team, "muster-footing");
    if (ruleId === "hold-shaft") return this.assignmentForRule(team, "muster-shaft");
    return this.assignmentForRule(team, "muster-bearing");
  }

  private patrolAssignment(team: Team, actorId: string, targetId: string | undefined, label: string): WorkAssignment {
    return {
      actorIds: [actorId],
      targetId: requiredPart(targetId, `${team} ${label}`),
      carryHeight: 0,
      floorHeight: 0,
      z: 0,
    };
  }

  private commitChoice(workerId: string, candidate: RuleCandidate): void {
    this.activeRuleIds[workerId] = candidate.id;
    this.completedOpeningMoves.add(workerId);
    this.ruleUseCounts.set(
      `${workerId}:${candidate.id}`,
      (this.ruleUseCounts.get(`${workerId}:${candidate.id}`) ?? 0) + 1,
    );
    if (candidate.id.startsWith("muster-")) {
      const targetId = candidate.requests.find((request) => request.action === "reserve")?.targetId;
      if (targetId) this.reservedParts.add(targetId);
    }
  }

  private emitRule(workerId: string, candidate: RuleCandidate): void {
    const team = this.workerTeam(workerId);
    const ruleLine = RULE_LINES[team][candidate.id] ?? AGENT_RULES_BY_ID.get(candidate.id)?.label ?? candidate.id;
    this.emit({
      text: `${this.workerName(workerId)} chooses ${candidate.id}: ${ruleLine}`,
      actorId: workerId,
      team,
      technical: `match:move:${this.moves}:${workerId}:rule:${candidate.id}`,
    });
  }

  private isAttempted(team: Team, plan: CompoundPlanOption): boolean {
    return this.attemptedMachinePlans[team].has(plan.id) ||
      this.attemptedMachinePlans[team].has(planBaseId(plan));
  }

  private workerName(workerId: string): string {
    return this.physics.records.get(workerId)?.variant ?? workerId;
  }

  private workerTeam(workerId: string): Team {
    const team = this.physics.records.get(workerId)?.team;
    if (!team) throw new Error(`Missing team for autonomous worker ${workerId}.`);
    return team;
  }

  private finish(outcome: NonNullable<CoreMatchState["outcome"]>, text: string): void {
    for (const lane of this.teamLanes) {
      if (!this.completedMachineTeams.has(lane.team) && this.selectedMachinePlans.has(lane.team)) {
        this.finalizeMachinePlan(lane.team, lane.actions);
      }
    }
    for (const lane of this.lanes) lane.actions.cancelAll("", false);
    for (const lane of this.teamLanes) lane.actions.cancelAll("", false);
    if (this.pendingFigureDecision) this.strategist?.cancel(this.pendingFigureDecision.request.id);
    if (this.pendingTeamDecision) this.strategist?.cancel(this.pendingTeamDecision.request.id);
    this.pendingFigureDecision = undefined;
    this.pendingTeamDecision = undefined;
    this.status = "complete";
    this.phase = "complete";
    this.outcome = outcome;
    this.machinePlans.king = outcome === "king" ? "hill held at the bell" : "defense broken";
    this.machinePlans.queen = outcome === "queen" ? "siege cracked Humpty" : "siege exhausted at the bell";
    this.emit({ text, technical: `match:complete:${outcome}` });
    this.emit({
      text: outcome === "queen" ? QUEEN_LINES[2] : HUMPTY_LINES[2],
      ...(outcome === "queen" ? { team: "queen" as const } : {}),
      technical: outcome === "queen" ? "match:speech:queen" : "match:speech:humpty",
    });
  }
}

export interface MatchObjectiveSample {
  integrity: number;
  floorContact: boolean;
  impactSpeed: number;
  speed: number;
  safeFloorSeconds: number;
  dt: number;
}

export interface MatchObjectiveDecision {
  safeFloorSeconds: number;
  outcome?: "queen";
  reason?: "hard-impact" | "zero-integrity";
}

export function evaluateMatchObjective(sample: MatchObjectiveSample): MatchObjectiveDecision {
  if (sample.integrity <= 0) {
    return { safeFloorSeconds: 0, outcome: "queen", reason: "zero-integrity" };
  }
  if (sample.floorContact && sample.impactSpeed >= 3) {
    return { safeFloorSeconds: 0, outcome: "queen", reason: "hard-impact" };
  }
  const safeFloorSeconds = sample.floorContact && sample.speed <= .45
    ? sample.safeFloorSeconds + sample.dt
    : 0;
  return { safeFloorSeconds };
}

export function siegeUrgency(
  elapsed: number,
  status: CoreMatchState["status"] = "active",
): CoreMatchState["urgency"] {
  if (status === "manual") return "manual";
  if (status === "complete") return "complete";
  if (elapsed >= 540) return "last-minute";
  if (elapsed >= 480) return "desperate";
  if (elapsed >= 60) return "siege";
  return "opening";
}

export function evaluateSiegeClock(
  elapsed: number,
  integrity: number,
): CoreMatchState["outcome"] | undefined {
  if (integrity <= 0) return "queen";
  return elapsed >= CORE_MATCH_DURATION_SECONDS ? "king" : undefined;
}

function clonePlanOptionState(option: MachinePlanOptionState): MachinePlanOptionState {
  return {
    ...option,
    observedFacts: [...option.observedFacts],
    missingFacts: [...option.missingFacts],
  };
}

function quaternionDistance(first: Quat, second: Quat): number {
  const dot = Math.min(1, Math.abs(
    first.x * second.x +
    first.y * second.y +
    first.z * second.z +
    first.w * second.w,
  ));
  return 2 * Math.acos(dot);
}

function distance(first: Vec3, second: Vec3): number {
  return Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z);
}

function requiredPart(id: string | undefined, label: string): string {
  if (!id) throw new Error(`Missing ${label} for the autonomous match.`);
  return id;
}
