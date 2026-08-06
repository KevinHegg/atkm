import type {
  ConnectionClass,
  LegalActionName,
  Team,
} from "./core-protocol.js";

export type AgentObjectiveId = "red-hold" | "green-crack";
export type AgentRulePhase = "muster" | "advance" | "contest";
export type AgentRuleCategory =
  | "logistics"
  | "position"
  | "connection"
  | "compound"
  | "operation"
  | "recovery";
export type SimpleMachineId =
  | "lever"
  | "wheel-and-axle"
  | "pulley"
  | "inclined-plane"
  | "wedge";
export type MachineCapability =
  | "climb"
  | "launch"
  | "strike"
  | "dislodge-timber"
  | "lift"
  | "lower";

export interface AgentObjectiveDefinition {
  id: AgentObjectiveId;
  team: Team;
  color: "red" | "green";
  text: string;
  winningFact: string;
}

export interface AgentRuleDefinition {
  id: string;
  label: string;
  category: AgentRuleCategory;
  teams: readonly Team[];
  objectiveIds: readonly AgentObjectiveId[];
  phases: readonly AgentRulePhase[];
  weight: number;
  when: readonly string[];
  actions: readonly LegalActionName[];
  connectionClass?: ConnectionClass;
  simpleMachines?: readonly SimpleMachineId[];
  capabilities?: readonly MachineCapability[];
}

export const AGENT_OBJECTIVES: Record<Team, AgentObjectiveDefinition> = {
  king: {
    id: "red-hold",
    team: "king",
    color: "red",
    text: "Keep Humpty uncracked until the ten-minute bell.",
    winningFact: "Humpty has positive integrity when the ten-minute siege clock expires.",
  },
  queen: {
    id: "green-crack",
    team: "queen",
    color: "green",
    text: "Crack Humpty before the ten-minute bell.",
    winningFact: "Humpty reaches zero integrity at any point before the siege clock expires.",
  },
};

const BOTH_TEAMS = ["king", "queen"] as const satisfies readonly Team[];
const BOTH_OBJECTIVES = ["red-hold", "green-crack"] as const satisfies readonly AgentObjectiveId[];
const ALL_PHASES = ["muster", "advance", "contest"] as const satisfies readonly AgentRulePhase[];

export const AGENT_RULES = [
  {
    id: "muster-footing",
    label: "Advance a footing",
    category: "logistics",
    teams: BOTH_TEAMS,
    objectiveIds: BOTH_OBJECTIVES,
    phases: ["muster"],
    weight: 1.2,
    when: ["The team's wedge is uncommitted.", "A worker has a legal route to the wedge."],
    actions: ["reserve", "fetch", "carry", "release"],
  },
  {
    id: "muster-shaft",
    label: "Advance a keyed shaft",
    category: "logistics",
    teams: BOTH_TEAMS,
    objectiveIds: BOTH_OBJECTIVES,
    phases: ["muster"],
    weight: 1,
    when: ["The team's long axle is uncommitted.", "A worker has a legal route to the axle."],
    actions: ["reserve", "fetch", "carry", "release"],
  },
  {
    id: "muster-bearing",
    label: "Advance a bearing hub",
    category: "logistics",
    teams: BOTH_TEAMS,
    objectiveIds: BOTH_OBJECTIVES,
    phases: ["muster"],
    weight: 1.1,
    when: ["The team's second hub is uncommitted.", "A worker has a legal route to the hub."],
    actions: ["reserve", "fetch", "carry", "release"],
  },
  {
    id: "muster-beam",
    label: "Advance a frame beam",
    category: "logistics",
    teams: BOTH_TEAMS,
    objectiveIds: BOTH_OBJECTIVES,
    phases: ["muster"],
    weight: 1.1,
    when: ["A medium beam is uncommitted.", "Its rack aisle and receiving bay are clear."],
    actions: ["reserve", "fetch", "carry", "release"],
  },
  {
    id: "survey-tower",
    label: "Read the tower supports",
    category: "position",
    teams: BOTH_TEAMS,
    objectiveIds: BOTH_OBJECTIVES,
    phases: ALL_PHASES,
    weight: 1.05,
    when: ["An exposed lower support is visible.", "The worker has a collision-clear approach."],
    actions: ["fetch", "wait"],
  },
  {
    id: "survey-wheel",
    label: "Survey the wheel stock",
    category: "position",
    teams: BOTH_TEAMS,
    objectiveIds: BOTH_OBJECTIVES,
    phases: ["advance", "contest"],
    weight: .9,
    when: ["A wheel is visible.", "The assigned worker is free."],
    actions: ["fetch", "wait"],
  },
  {
    id: "survey-sheave",
    label: "Survey the sheave stock",
    category: "position",
    teams: BOTH_TEAMS,
    objectiveIds: BOTH_OBJECTIVES,
    phases: ["advance", "contest"],
    weight: 1,
    when: ["A sheave is visible.", "The assigned worker is free."],
    actions: ["fetch", "wait"],
  },
  {
    id: "survey-line",
    label: "Survey the rope stock",
    category: "position",
    teams: BOTH_TEAMS,
    objectiveIds: BOTH_OBJECTIVES,
    phases: ["advance", "contest"],
    weight: 1,
    when: ["A rope is visible.", "The assigned worker is free."],
    actions: ["fetch", "wait"],
  },
  {
    id: "survey-beam",
    label: "Survey the beam stock",
    category: "position",
    teams: BOTH_TEAMS,
    objectiveIds: BOTH_OBJECTIVES,
    phases: ["advance", "contest"],
    weight: .9,
    when: ["A medium beam is visible.", "The assigned worker is free."],
    actions: ["fetch", "wait"],
  },
  {
    id: "hold-footing",
    label: "Hold the advanced footing",
    category: "position",
    teams: BOTH_TEAMS,
    objectiveIds: BOTH_OBJECTIVES,
    phases: ["advance", "contest"],
    weight: .75,
    when: ["The wedge has been advanced.", "The assigned worker is free."],
    actions: ["fetch", "hold", "wait"],
  },
  {
    id: "hold-shaft",
    label: "Hold the advanced shaft",
    category: "position",
    teams: BOTH_TEAMS,
    objectiveIds: BOTH_OBJECTIVES,
    phases: ["advance", "contest"],
    weight: .75,
    when: ["The axle has been advanced.", "The assigned worker is free."],
    actions: ["fetch", "hold", "wait"],
  },
  {
    id: "hold-bearing",
    label: "Hold the advanced bearing",
    category: "position",
    teams: BOTH_TEAMS,
    objectiveIds: BOTH_OBJECTIVES,
    phases: ["advance", "contest"],
    weight: .75,
    when: ["The hub has been advanced.", "The assigned worker is free."],
    actions: ["fetch", "hold", "wait"],
  },
  {
    id: "lock-beam-in-hub",
    label: "Lock a beam into a hub",
    category: "connection",
    teams: BOTH_TEAMS,
    objectiveIds: BOTH_OBJECTIVES,
    phases: ["advance", "contest"],
    weight: 1.1,
    when: ["A beam peg and hub socket are aligned.", "A supporting worker is in place."],
    actions: ["hold", "align", "connect", "test"],
    connectionClass: "TENON_LOCK",
  },
  {
    id: "seat-axle-in-hub",
    label: "Seat an axle in a bearing",
    category: "connection",
    teams: BOTH_TEAMS,
    objectiveIds: BOTH_OBJECTIVES,
    phases: ["advance", "contest"],
    weight: 1.1,
    when: ["An axle shaft and bearing bore are aligned.", "The hub is supported."],
    actions: ["hold", "align", "connect", "test"],
    connectionClass: "AXLE_BEARING",
  },
  {
    id: "key-wheel-to-axle",
    label: "Key a wheel to an axle",
    category: "connection",
    teams: BOTH_TEAMS,
    objectiveIds: BOTH_OBJECTIVES,
    phases: ["advance", "contest"],
    weight: 1,
    when: ["A wheel keyway and axle flat are aligned.", "The axle is supported."],
    actions: ["hold", "align", "connect", "test"],
    connectionClass: "KEYED_COAXIAL",
  },
  {
    id: "key-sheave-to-axle",
    label: "Key a sheave to an axle",
    category: "connection",
    teams: BOTH_TEAMS,
    objectiveIds: BOTH_OBJECTIVES,
    phases: ["advance", "contest"],
    weight: 1,
    when: ["A sheave keyway and axle flat are aligned.", "The axle is supported."],
    actions: ["hold", "align", "connect", "test"],
    connectionClass: "KEYED_COAXIAL",
  },
  {
    id: "attach-line-to-load",
    label: "Attach a line to a load eye",
    category: "connection",
    teams: BOTH_TEAMS,
    objectiveIds: BOTH_OBJECTIVES,
    phases: ["advance", "contest"],
    weight: 1,
    when: ["A rope end and load eye are within fastening tolerance.", "The load is supported."],
    actions: ["hold", "align", "hookRope", "test"],
    connectionClass: "ROPE_ATTACH",
  },
  {
    id: "reeve-line-through-sheave",
    label: "Reeve a line through a sheave",
    category: "connection",
    teams: BOTH_TEAMS,
    objectiveIds: BOTH_OBJECTIVES,
    phases: ["advance", "contest"],
    weight: 1,
    when: ["A rope and sheave groove are aligned.", "The sheave is connected and tested."],
    actions: ["hold", "align", "reeveRope", "test"],
    connectionClass: "ROPE_ATTACH",
  },
  {
    id: "test-assembly",
    label: "Proof-test a connected assembly",
    category: "operation",
    teams: BOTH_TEAMS,
    objectiveIds: BOTH_OBJECTIVES,
    phases: ["advance", "contest"],
    weight: 1.15,
    when: ["An untested connection exists.", "No worker is inside the load path."],
    actions: ["hold", "test", "release"],
  },
  {
    id: "raise-escalade-ramp",
    label: "Raise an escalade ramp",
    category: "compound",
    teams: BOTH_TEAMS,
    objectiveIds: BOTH_OBJECTIVES,
    phases: ["advance", "contest"],
    weight: 1.35,
    when: ["A wedge, broad plank, and clear tower approach are available.", "Two carriers and one footing worker are free."],
    actions: ["reserve", "fetch", "carry", "align", "release", "test"],
    simpleMachines: ["wedge", "inclined-plane"],
    capabilities: ["climb"],
  },
  {
    id: "climb-escalade-ramp",
    label: "Climb an inclined assault surface",
    category: "operation",
    teams: BOTH_TEAMS,
    objectiveIds: BOTH_OBJECTIVES,
    phases: ["advance", "contest"],
    weight: 1.45,
    when: ["A tested inclined surface has a reachable low end.", "Its high end remains supported and clear."],
    actions: ["fetch", "climb", "hold"],
    simpleMachines: ["inclined-plane", "wedge"],
    capabilities: ["climb"],
  },
  {
    id: "launch-wheel-shot",
    label: "Drive a wheel shot down an assault ramp",
    category: "compound",
    teams: BOTH_TEAMS,
    objectiveIds: BOTH_OBJECTIVES,
    phases: ["contest"],
    weight: 1.55,
    when: ["A tested ramp points at an exposed lower timber.", "A loose wheel and a clear firing lane are available."],
    actions: ["reserve", "fetch", "carry", "align", "release", "push", "test"],
    simpleMachines: ["wedge", "inclined-plane", "wheel-and-axle"],
    capabilities: ["launch", "strike", "dislodge-timber"],
  },
  {
    id: "operate-pivoted-striker",
    label: "Swing a supported striker",
    category: "compound",
    teams: BOTH_TEAMS,
    objectiveIds: BOTH_OBJECTIVES,
    phases: ["contest"],
    weight: 1.35,
    when: ["A beam has separated fulcrum, effort, and impact contacts.", "The swing path is clear of figures."],
    actions: ["hold", "push", "turn", "test", "release"],
    simpleMachines: ["lever", "wedge"],
    capabilities: ["strike", "dislodge-timber"],
  },
  {
    id: "drive-compound-ram",
    label: "Drive a wheeled battering ram",
    category: "compound",
    teams: ["queen"],
    objectiveIds: ["green-crack"],
    phases: ["contest"],
    weight: 1.5,
    when: ["A tested beam chassis turns on a keyed wheelset.", "Its striker line reaches a lower tower course."],
    actions: ["hold", "turn", "push", "test", "release"],
    simpleMachines: ["lever", "wheel-and-axle"],
    capabilities: ["strike", "dislodge-timber"],
  },
  {
    id: "fire-counterweight-sling",
    label: "Fire a counterweight sling",
    category: "compound",
    teams: ["queen"],
    objectiveIds: ["green-crack"],
    phases: ["contest"],
    weight: 1.4,
    when: ["A lever arm, routed line, projectile, and falling counterweight are tested.", "The release arc and landing lane are clear."],
    actions: ["reserve", "fetch", "carry", "align", "connect", "reeveRope", "hookRope", "tension", "test", "pull", "release", "wait"],
    simpleMachines: ["lever", "pulley", "wheel-and-axle"],
    capabilities: ["launch", "strike"],
  },
  {
    id: "operate-rescue-crane",
    label: "Operate a rescue crane",
    category: "compound",
    teams: ["king"],
    objectiveIds: ["red-hold"],
    phases: ["contest"],
    weight: 1.45,
    when: ["A tested boom, wheel-and-axle, and reeved line support the cradle.", "A receiving lane is clear below."],
    actions: ["hold", "tension", "turn", "pull", "release"],
    simpleMachines: ["lever", "wheel-and-axle", "pulley"],
    capabilities: ["lift", "lower"],
  },
  {
    id: "tension-rescue-line",
    label: "Tension the rescue line",
    category: "operation",
    teams: ["king"],
    objectiveIds: ["red-hold"],
    phases: ["contest"],
    weight: 1.3,
    when: ["A tested rope path reaches the rescue load.", "The receiving surface is ready."],
    actions: ["hold", "tension", "test"],
  },
  {
    id: "lower-rescue-load",
    label: "Lower the rescue load",
    category: "operation",
    teams: ["king"],
    objectiveIds: ["red-hold"],
    phases: ["contest"],
    weight: 1.5,
    when: ["A tested rescue machine supports Humpty.", "The floor receiving lane is clear."],
    actions: ["hold", "turn", "pull", "release"],
  },
  {
    id: "pressure-tower-support",
    label: "Pressure a tower support",
    category: "operation",
    teams: ["queen"],
    objectiveIds: ["green-crack"],
    phases: ["contest"],
    weight: 1.35,
    when: ["A tested siege assembly reaches a tower support.", "Humpty has not established a safe floor stand."],
    actions: ["hold", "push", "test", "release"],
  },
  {
    id: "turn-siege-axle",
    label: "Drive a siege axle",
    category: "operation",
    teams: ["queen"],
    objectiveIds: ["green-crack"],
    phases: ["contest"],
    weight: 1.2,
    when: ["A tested wheel-and-axle assembly faces the tower.", "Its travel lane is clear."],
    actions: ["hold", "turn", "push", "release"],
  },
  {
    id: "recover-loose-part",
    label: "Recover a loose part",
    category: "recovery",
    teams: BOTH_TEAMS,
    objectiveIds: BOTH_OBJECTIVES,
    phases: ALL_PHASES,
    weight: 1.25,
    when: ["An owned part is dropped and reachable.", "The required handling crew is free."],
    actions: ["fetch", "recover", "carry", "release"],
  },
  {
    id: "fire-queen-crown-bolt",
    label: "Fire the Queen's crown bolt",
    category: "operation",
    teams: ["queen"],
    objectiveIds: ["green-crack"],
    phases: ["contest"],
    weight: 1.55,
    when: ["The Queen's command post is intact and armed.", "A crown bolt remains and Humpty is still aloft."],
    actions: ["fetch", "hold", "operate"],
    simpleMachines: ["wheel-and-axle", "lever"],
    capabilities: ["launch", "strike"],
  },
  {
    id: "strike-queen-command-post",
    label: "Strike the Queen's command post",
    category: "operation",
    teams: ["king"],
    objectiveIds: ["red-hold"],
    phases: ["contest"],
    weight: 1.5,
    when: ["The Queen's command post is exposed.", "Red can reach it before the crown bolt is fired."],
    actions: ["fetch", "strike", "wait"],
    simpleMachines: ["lever", "wedge"],
    capabilities: ["strike"],
  },
] as const satisfies readonly AgentRuleDefinition[];

export const AGENT_RULES_BY_ID: ReadonlyMap<string, AgentRuleDefinition> = new Map(
  AGENT_RULES.map((rule) => [rule.id, rule] as const),
);
