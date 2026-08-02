import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AgentAction,
  AgentState,
  AgentSubmission,
  MatchBeat,
  Team,
} from "../shared/protocol.js";
import { extractJson } from "./actions.js";

export interface AgentDefinition {
  id: string;
  name: string;
  team: Team;
  promptFile: string;
}

export type WorkerTeam = Exclude<Team, "humpty">;

export interface StagePose {
  p: [number, number, number];
  size: [number, number, number];
  rot: [number, number, number];
}

export interface TeamAgentState {
  space: {
    units: "stage_units";
    axes: "x left-right, y back-front, z height above floor";
    bounds: {
      x: [number, number];
      y: [number, number];
      z: [number, number];
    };
    landmarks: Array<
      StagePose & {
        id: string;
        kind: "structure" | "inventory" | "work_zone" | "landing_zone";
      }
    >;
  };
  time: {
    elapsed: number;
    remaining: number;
    urgency: "build" | "press" | "desperate";
    beat: MatchBeat;
    beatRule: string;
  };
  objective: string;
  humpty: {
    pose: StagePose;
    height: number;
    integrity: number;
    status: "perched" | "descending" | "floor" | "cracked";
  };
  tower: {
    blockCount: 36;
    disturbed: boolean;
    centerOfMass: [number, number, number];
    supportBounds: [number, number];
    signedSupportMargin: number;
    maximumTilt: number;
    topDisplacement: number;
    warnings: string[];
  };
  crew: Array<{
    id: string;
    pose: StagePose;
    integrity: number;
    activity: string;
    weapon?: string;
    task?: {
      phase: string;
      partId: string;
      targetId: string;
      progress: number;
    };
  }>;
  opponents: Array<{
    id: string;
    pose: StagePose;
    integrity: number;
    activity: string;
    weapon?: string;
  }>;
  publicSpeech: Array<{ name: string; text: string }>;
  stock: Array<{
    id: string;
    kind: string;
    mass: number;
    capabilities: string[];
    freePorts: string[];
    pose: StagePose;
    lifecycle: string;
  }>;
  assemblies: Array<{
    id: string;
    count: number;
    kinds: string[];
    capabilities: string[];
    stability: number;
    supportMargin: number;
    failureMargin: number;
    centerOfMass: [number, number, number];
    supportSpan: [number, number];
    signedTippingMargin: number;
    bindingRisk: number;
    bucklingRisk: number;
    jointUtilization: number;
    ropeState: "none" | "slack" | "tensioned" | "overloaded" | "frayed";
    warnings: string[];
    derivedCapabilities: Array<{
      id: string;
      confidence: number;
      ratio: number;
      inputPortId: string;
      outputPortId: string;
      failureMargin: number;
    }>;
    freePorts: number;
    pose: StagePose;
  }>;
  opponentAssemblies: Array<{
    id: string;
    count: number;
    capabilities: string[];
    stability: number;
    pose: StagePose;
  }>;
  joinOptions: Array<{
    partId: string;
    targetId: string;
    connection: string;
    gainedCapabilities: string[];
    completedFunctions: string[];
    resultSimpleMachines: string[];
    resultCapabilities: string[];
    resultStability: number;
    resultMass: number;
    travel: number;
    worksite: [number, number, number];
  }>;
  useOptions: Array<{
    partId: string;
    targetId: string;
    operation: "proof" | "fit" | "tension" | "execute";
    instruction: string;
    capabilities: string[];
    distance: number;
    from: [number, number, number];
    to: [number, number, number];
  }>;
  detachOptions: Array<{
    connectionId: string;
    partId: string;
    connectedTo: string;
    currentLoad: number;
    state: "locked" | "loaded" | "slipping" | "yielding" | "failed";
    distance: number;
    at: [number, number, number];
  }>;
  repairOptions: Array<{
    connectionId: string;
    partId: string;
    connectedTo: string;
    integrity: number;
    distance: number;
    at: [number, number, number];
  }>;
}

export interface TeamAgentSubmission {
  order?: string;
  intent?: string;
  actions: Array<{
    agentId: string;
    say?: string;
    action: AgentAction;
  }>;
}

export const AGENTS: readonly AgentDefinition[] = [
  {
    id: "king",
    name: "Humpty, the Egg King",
    team: "king",
    promptFile: "king.txt",
  },
  { id: "king_1", name: "Bell", team: "king", promptFile: "king_1.txt" },
  { id: "king_2", name: "March", team: "king", promptFile: "king_2.txt" },
  { id: "king_3", name: "Pike", team: "king", promptFile: "king_3.txt" },
  { id: "queen_1", name: "Vex", team: "queen", promptFile: "queen_1.txt" },
  { id: "queen_2", name: "Moth", team: "queen", promptFile: "queen_2.txt" },
  { id: "queen_3", name: "Knell", team: "queen", promptFile: "queen_3.txt" },
  { id: "queen", name: "The Queen", team: "queen", promptFile: "queen.txt" },
  {
    id: "humpty",
    name: "Humpty, the Egg King",
    team: "humpty",
    promptFile: "humpty.txt",
  },
] as const;

export interface AgentDriver {
  readonly model: string;
  act(agent: AgentDefinition, state: AgentState): Promise<unknown>;
  actTeam?(team: WorkerTeam, state: TeamAgentState): Promise<unknown>;
}

const kingOrders = [
  "Establish stable ground before gaining height.",
  "Move heavy stock by wheel, ramp, and teamwork.",
  "Level the foundation before loading the frame.",
  "Protect builders while exposed joints remain loose.",
  "Use leverage before spending men on brute force.",
  "Finish each bearing before turning any axle.",
  "Raise only what the braced foundation can carry.",
  "Keep one man free to answer interference.",
  "Test every compound machine under a light load.",
  "Build upward only after the lower structure holds.",
  "Keep moving parts clear of hands and clothing.",
  "Guard the worksite; do not abandon unfinished joints.",
  "Prepare the lifting line after all bearings pass.",
  "Use the cantilever to control lateral movement.",
  "Keep the cart route open between stock and bench.",
  "Hold fire unless the builders need immediate cover.",
  "Recheck wedges whenever the frame changes load.",
  "Prepare the sling without touching Humpty's shell.",
  "Take up rope gradually and report every movement.",
  "Hold the brake whenever another team closes.",
  "Lower the load in short, controlled intervals.",
  "Protect the treadwheel while the sling bears weight.",
  "Correct swing with leverage, not sudden hauling.",
  "Keep the landing space clear and level.",
  "Ease the final descent under continuous control.",
  "Hold position until the machine settles.",
  "Inspect the complete system before releasing Humpty.",
  "Finish the rescue; preserve every living worker.",
] as const;

const queenOrders = [
  "Bring pears. Build cover before crossing open ground.",
  "Prepare spring force while their builders are occupied.",
  "Watch which machine presently carries the greatest load.",
  "Contest access without wasting soldiers against finished timber.",
  "Keep one heavy stone reserved for a clear opening.",
  "Pressure exposed builders, then return behind cover.",
  "Disrupt bearings before attacking massive wooden members.",
  "Overhear their command; answer where they are weakest.",
  "Hold the shot until their load begins moving.",
  "Force them to divide builders from guards.",
  "Test unfinished joints with controlled, observable pressure.",
  "Protect the spring catch until the arm is tensioned.",
  "Strike the lifting system when it changes direction.",
  "Keep their ladder crew below unfinished height.",
  "Aim at working hands, tools, and loose fittings.",
  "Bring grapes. Report their most vulnerable machine.",
  "Press the treadwheel whenever its brake is released.",
  "Fight only where conflict delays the rescue.",
  "Keep the launcher loaded behind the barricade.",
  "Loose one strong stone when Humpty becomes exposed.",
  "Crowd the rope crew before the lines carry tension.",
  "Break their rhythm, then withdraw before retaliation.",
  "Listen for the King's next general instruction.",
  "Strike where compound machines depend on one joint.",
  "Hold position while the spring arm is reset.",
  "Ready the final stone. Dessert may briefly wait.",
] as const;

const humptySpeech: readonly (string | undefined)[] = [
  "I should like a proper introduction.",
  "Has anyone measured the ground from up here?",
  "That timber looks reassuringly overqualified.",
  "Are the wedges supposed to squeak?",
  "I notice nobody consulted the principal load.",
  "The joinery is becoming uncomfortably relevant.",
  "That ladder appears distressingly ambitious.",
  "Pike, your left boot is judging me.",
  "The Queen seems remarkably comfortable.",
  "Could her grapes be used as ballast?",
  "I felt that stone in my future.",
  "Please distinguish fastening from enthusiastic hammering.",
  "The mast is taller when viewed personally.",
  "I hope the treadwheel understands discretion.",
  "That pulley has a very small opinion.",
  "Are brass sheaves considered reassuring?",
  "The sling and I require formal introductions.",
  "Mind the shell. It is the principal part.",
  "Is canvas meant to feel this personal?",
  "Equal eyes, gentlemen. I prefer balanced indignity.",
  "That rope is looking directly at me.",
  "Please test the brake before testing gravity.",
  "I detect a concerning amount of competence.",
  "I am heavier than your expressions suggest.",
  "The wall and I are reconsidering our arrangement.",
  "The ground has become alarmingly specific.",
  "Was that projectile addressed to me?",
  "I prefer applause before impact.",
  "A little slower would preserve my dramatic dignity.",
  "Someone tell the Queen I can see her.",
] as const;

type TeamOrder =
  | "build"
  | "guard"
  | "push"
  | "throw"
  | "rope"
  | "siege"
  | "hold"
  | null;

function latestOrder(
  state: AgentState,
  commanders: readonly string[],
): TeamOrder {
  for (const line of [...state.speech].reverse()) {
    if (
      line.turn >= state.turn ||
      line.turn < state.turn - 4 ||
      !commanders.includes(line.name)
    ) {
      continue;
    }
    const text = line.text.toLowerCase();
    if (/^(hold|stop|break)\b/.test(text)) return "hold";
    if (/(rope|line|haul|lower|sling)/.test(text)) return "rope";
    if (
      /(stone|volley|launcher)/.test(text) ||
      text.startsWith("loose ")
    ) {
      return "throw";
    }
    if (/(push|pressure|contest|fight|crowd|disrupt)/.test(text)) return "push";
    if (
      /(crack|strike|shot|heavy|aim)/.test(text)
    ) {
      return "siege";
    }
    if (/(protect|guard|cover)/.test(text)) return "guard";
    if (/(build|finish|prepare|level|raise|machine)/.test(text)) return "build";
  }
  return null;
}

function teamSpeech(
  agent: AgentDefinition,
  state: AgentState,
  action: AgentSubmission["action"],
): string | undefined {
  const speakerOffset = [...agent.id].reduce(
    (total, character) => total + character.charCodeAt(0),
    0,
  );
  const choose = (lines: readonly string[]): string =>
    lines[(state.turn + speakerOffset) % lines.length] ?? lines[0] ?? "";
  if (agent.id === "king") {
    return state.turn % 4 === 1
      ? kingOrders[Math.floor((state.turn - 1) / 4) % kingOrders.length]
      : undefined;
  }
  if (agent.id === "queen") {
    return state.turn % 4 === 3
      ? queenOrders[Math.floor((state.turn - 3) / 4) % queenOrders.length]
      : undefined;
  }
  const workerSpeechSlots: Record<string, number> = {
    king_1: 0,
    queen_1: 1,
    king_2: 2,
    queen_2: 3,
    king_3: 4,
    queen_3: 5,
  };
  const workerSpeechTurn =
    state.turn % 6 === (workerSpeechSlots[agent.id] ?? -1);
  if (state.currentTask && workerSpeechTurn) {
    const noun = state.currentTask.componentLabel;
    const subject = noun.charAt(0).toUpperCase() + noun.slice(1);
    const operationLines: Partial<
      Record<typeof state.currentTask.operation, readonly string[]>
    > = {
      fetch: [`Fetching ${noun}.`, `Where is ${noun}?`, `${subject}, coming through.`],
      carry: [
        `Bringing ${noun} to the bench.`,
        `Clear the path for ${noun}.`,
        `${noun} is balanced.`,
      ],
      measure: [
        `Marking ${noun} twice.`,
        `Check my mark on ${noun}.`,
        `${noun} reads square.`,
      ],
      saw: [
        `Sawing ${noun} to the mark.`,
        `Hold ${noun}; finishing the cut.`,
        `Keep the kerf straight.`,
      ],
      bore: [
        `Boring ${noun}; keep it steady.`,
        `Brace the ${noun}.`,
        `The bit is nearly through.`,
      ],
      position: [
        `Setting ${noun} against the marks.`,
        `Ease ${noun} left.`,
        `Hold ${noun} exactly there.`,
      ],
      peg: [
        `Driving the peg through ${noun}.`,
        `Peg is entering cleanly.`,
        `One more blow on ${noun}.`,
      ],
      lash: [
        `Lashing ${noun}; hold the crossing.`,
        `Take slack from ${noun}.`,
        `This lashing needs another turn.`,
      ],
      wedge: [
        `Seating the wedge at ${noun}.`,
        `Tap ${noun} tight.`,
        `Wedge holds; test it.`,
      ],
      mount: [
        `Mounting ${noun}; take the weight.`,
        `Lift ${noun} on my count.`,
        `${noun} is entering its seat.`,
      ],
      raise: [
        `Raising ${noun} from the foot.`,
        `Keep ${noun} moving together.`,
        `Check the foot while we raise.`,
      ],
      inspect: [
        `Checking ${noun} for movement.`,
        `${noun} holds under hand pressure.`,
        `Watch ${noun} while I test it.`,
      ],
      stitch: [
        `Stitching ${noun} through both layers.`,
        `Hold the seam on ${noun}.`,
        `Waxed thread is drawing tight.`,
      ],
      grease: [
        `Greasing ${noun}; turn it slowly.`,
        `${noun} still binds.`,
        `Work the tallow into ${noun}.`,
      ],
      shape: [
        `Shaping ${noun} to the template.`,
        `Check the curve on ${noun}.`,
        `${subject} needs one finer pass.`,
      ],
      forge: [
        `Forging ${noun}; keep the heat even.`,
        `${subject} is nearly at color.`,
        `Turning ${noun} beneath the hammer.`,
      ],
      temper: [
        `Tempering ${noun}; watch the color.`,
        `${subject} is cooling evenly.`,
        `Keep water ready for ${noun}.`,
      ],
      thread: [
        `Cutting threads into ${noun}.`,
        `Turn ${noun}; keep the pitch even.`,
        `${subject} advances without binding.`,
      ],
      tension: [
        `Tensioning ${noun} one turn.`,
        `Hold the catch while ${noun} loads.`,
        `${subject} stores force evenly.`,
      ],
      reeve: [
        `Reeving ${noun} through the fairlead.`,
        `Feed ${noun} without twisting.`,
        `Line is entering the fairlead.`,
      ],
    };
    const lines = operationLines[state.currentTask.operation];
    return lines
      ? lines[
          (state.turn +
            state.currentTask.componentId.length +
            speakerOffset) %
            lines.length
        ]
      : undefined;
  }
  if (!workerSpeechTurn) return undefined;
  if (action.type === "start_project") {
    return `Laying out ${action.blueprintId.replaceAll("_", " ")} stock.`;
  }
  if (action.type === "push") {
    return choose([
      "Engaging now. Keep working.",
      "I have them. Finish that joint.",
      "Pressure here. Do not leave the bench.",
    ]);
  }
  if (action.type === "throw") {
    return choose([
      "Shot away. Watch its path.",
      "Stone moving. Stay clear.",
      "Loose. Report the strike.",
    ]);
  }
  if (action.type === "use_weapon") {
    return action.weapon === "pike"
      ? choose([
          "Pike forward. Hold the line.",
          "Point steady. I am closing.",
          "Keep clear of my shaft.",
        ])
      : choose([
          "Crossbow spanned. Marking that target.",
          "Bolt seated. Keep the path clear.",
          "Loose. I need time to span again.",
        ]);
  }
  if (action.type === "attach_rope") {
    return choose([
      "Feeding line through. Take the end.",
      "Line coming through the tackle.",
      "Take this end without twisting.",
    ]);
  }
  if (action.type === "operate") {
    return choose([
      "Walking the treadwheel. Watch the brake.",
      "Treadwheel moving. Call the height.",
      "Holding the pawl between turns.",
    ]);
  }
  if (action.type === "move") {
    return choose([
      "Changing position. I still have sight.",
      "Crossing behind cover now.",
      "Moving wide. Keep my path open.",
    ]);
  }
  const mechanismProject = state.projects.find(
    (project) =>
      project.team === agent.team &&
      project.workerId === agent.id &&
      project.mechanisms?.some((mechanism) => mechanism.ready),
  );
  const latestMechanism = [...(mechanismProject?.mechanisms ?? [])]
    .reverse()
    .find((mechanism) => mechanism.ready);
  if (latestMechanism) {
    const mechanismReports: Record<string, readonly string[]> = {
      support: [
        "Load path holds. Add the moving parts.",
        "Frame is grounded and taking reaction.",
      ],
      guide: [
        "Guide is aligned. Travel stays on course.",
        "Bearing surfaces agree under hand pressure.",
      ],
      transport: [
        "Axles turn freely. The carriage can move.",
        "Rolling train carries load without scrubbing.",
      ],
      multiply_force: [
        "Force multiplier turns freely under light load.",
        "Long input travel produces the stronger output.",
      ],
      convert_motion: [
        "Drum converts rotation into steady line travel.",
        "Input motion reaches the next mechanism.",
      ],
      redirect_force: [
        "Fixed block redirects the pull cleanly.",
        "The line changes direction without leaving its groove.",
      ],
      store_energy: [
        "Stored energy is contained by the frame.",
        "The spring accepts another controlled turn.",
      ],
      hold_load: [
        "Pawl holds. The drum cannot reverse.",
        "Ratchet holds between input strokes.",
      ],
      release_energy: [
        "Catch holds. Trigger path remains clear.",
        "Release train moves without disturbing the frame.",
      ],
      control_motion: [
        "Brake answers smoothly under hand pressure.",
        "Travel stop contains the moving arm.",
      ],
      interface_load: [
        "Load interface spreads force across its bearing.",
        "Both attachment points carry equal tension.",
      ],
    };
    const reportsForCapability =
      mechanismReports[latestMechanism.capability];
    if (reportsForCapability) return choose(reportsForCapability);
  }
  const subjects: Record<string, readonly string[]> = {
    king_1: ["Cart route", "Jack saddle", "Lever arm", "Worksite guard", "Brake crew", "Landing ground"],
    king_2: ["Skid", "Mast heel", "Brace foot", "Left dog", "Oak wedge", "Capstan drum"],
    king_3: ["Ladder rail", "Upper rung", "Pulley cheek", "Iron pin", "Canvas eye", "Lift line"],
    queen_1: ["King's left", "Bell", "Worksite edge", "Open flank", "Brake crew", "High shot"],
    queen_2: ["Barricade", "Shot rack", "Low stone", "March's path", "Capstan side", "Retreat lane"],
    queen_3: ["Pike's ladder", "Upper fitting", "Loose wedge", "Moving load", "Sling eye", "Tower side"],
  };
  const reports: Record<string, readonly string[]> = {
    king_1: ["is clear.", "takes load.", "needs cover.", "is holding.", "has shifted.", "is ready."],
    king_2: ["is square.", "holds level.", "needs another pass.", "shows no twist.", "is taking load.", "is ready."],
    king_3: ["is lashed.", "has firm bearing.", "still binds.", "is seated.", "needs equal tension.", "runs freely."],
    queen_1: ["is guarded.", "is exposed.", "has shifted.", "is closing.", "needs pressure.", "is in range."],
    queen_2: ["is stable.", "is moving.", "has one shot.", "is blocked.", "is vulnerable.", "remains clear."],
    queen_3: ["is unfinished.", "is above reach.", "has loosened.", "is descending.", "looks uneven.", "is open."],
  };
  const subjectSet = subjects[agent.id];
  const reportSet = reports[agent.id];
  if (!subjectSet || !reportSet) return undefined;
  const speechIndex = Math.floor((state.turn - 1) / 4);
  const subject = subjectSet[speechIndex % subjectSet.length];
  const report =
    reportSet[Math.floor(speechIndex / subjectSet.length) % reportSet.length];
  return `${subject} ${report}`;
}

function livingOpponent(
  state: AgentState,
  index: number,
): AgentState["opponents"][number] | undefined {
  const living = state.opponents.filter((opponent) => opponent.integrity > 0);
  return living[index % Math.max(1, living.length)];
}

function nearestOpponent(
  state: AgentState,
): AgentState["opponents"][number] | undefined {
  return state.opponents
    .filter((opponent) => opponent.integrity > 0)
    .sort(
      (a, b) =>
        Math.hypot(a.x - state.self.x, a.y - state.self.y) -
        Math.hypot(b.x - state.self.x, b.y - state.self.y),
    )[0];
}

function throwAt(
  state: AgentState,
  team: "king" | "queen",
  stoneIndex: number,
  opponentIndex: number,
  power = 0.84,
): AgentSubmission["action"] {
  const target = livingOpponent(state, opponentIndex);
  const fallbackX = team === "king" ? 900 : 300;
  const targetX = target?.x ?? fallbackX;
  const targetY = (target?.y ?? 62) + 8;
  return {
    type: "throw",
    targetId: `stone_${team}_${stoneIndex}`,
    angle: Math.atan2(targetY - (state.self.y + 26), targetX - state.self.x),
    power,
  };
}

function throwAtHumpty(
  state: AgentState,
  team: "king" | "queen",
  stoneIndex: number,
  power = 1,
): AgentSubmission["action"] {
  const speed = team === "queen" ? 1180 : 900;
  return {
    type: "throw",
    targetId: `stone_${team}_${stoneIndex}`,
    angle: ballisticAngle(
      state,
      state.humpty.x,
      state.humpty.y - 18,
      speed,
    ),
    power,
  };
}

function ballisticAngle(
  state: AgentState,
  targetX: number,
  targetY: number,
  speed: number,
): number {
  const dx = targetX - state.self.x;
  const distanceX = Math.max(1, Math.abs(dx));
  const dy = targetY - (state.self.y + 26);
  const gravity = 650;
  const speedSquared = speed * speed;
  const discriminant =
    speedSquared * speedSquared -
    gravity * (gravity * distanceX * distanceX + 2 * dy * speedSquared);
  if (discriminant <= 0) {
    return Math.atan2(dy, dx);
  }
  const lowArc = Math.atan(
    (speedSquared - Math.sqrt(discriminant)) / (gravity * distanceX),
  );
  return dx >= 0 ? lowArc : Math.PI - lowArc;
}

function engage(
  state: AgentState,
  dir: -1 | 1,
): AgentSubmission["action"] {
  const target = nearestOpponent(state);
  if (!target) return { type: "wait" };
  const distance = Math.hypot(target.x - state.self.x, target.y - state.self.y);
  const pikeAvailable =
    state.self.weapon === "pike" ||
    state.inventory.some((item) => item.id === "pike" && item.quantity > 0);
  const crossbowAvailable =
    state.supply.bolts > 0 &&
    (state.self.weapon === "crossbow" ||
      state.inventory.some(
        (item) => item.id === "crossbow" && item.quantity > 0,
      ));
  if (
    distance <= 340 &&
    pikeAvailable &&
    state.self.weapon !== "crossbow"
  ) {
    return { type: "use_weapon", weapon: "pike", targetId: target.id };
  }
  if (
    distance > 180 &&
    crossbowAvailable &&
    state.self.weapon !== "pike"
  ) {
    return { type: "use_weapon", weapon: "crossbow", targetId: target.id };
  }
  if (distance <= 280) {
    return { type: "push", targetId: target.id, dir };
  }
  return {
    type: "move",
    x: target.x - dir * 55,
  };
}

function projectFor(
  state: AgentState,
  blueprintId: string,
): AgentState["projects"][number] | undefined {
  return projectForTeam(state, blueprintId, "king");
}

function projectForTeam(
  state: AgentState,
  blueprintId: string,
  team: "king" | "queen",
): AgentState["projects"][number] | undefined {
  return state.projects.find(
    (project) => project.blueprintId === blueprintId && project.team === team,
  );
}

function ownsActiveProject(state: AgentState): boolean {
  return state.projects.some(
    (project) => project.workerId === state.self.id && !project.complete,
  );
}

function hasConnection(
  state: AgentState,
  fromId: string,
  toId: string,
): boolean {
  return (
    state.connections.includes(`${fromId}>${toId}`) ||
    state.connections.includes(`${toId}>${fromId}`)
  );
}

function allRescueProjectsComplete(state: AgentState): boolean {
  return [
    "skid",
    "cart",
    "screw_jack",
    "mast",
    "lever",
    "brace",
    "ladder",
    "winch",
    "pulley",
    "sling",
  ].every((id) => projectFor(state, id)?.complete);
}

const RESCUE_BLUEPRINTS = [
  "skid",
  "cart",
  "screw_jack",
  "mast",
  "ladder",
  "lever",
  "winch",
  "brace",
  "pulley",
  "sling",
] as const;

function projectReady(
  state: AgentState,
  blueprintId: (typeof RESCUE_BLUEPRINTS)[number],
): boolean {
  if (projectFor(state, blueprintId)) return false;
  if (blueprintId === "screw_jack") return projectFor(state, "skid")?.complete === true;
  if (blueprintId === "winch") return projectFor(state, "cart")?.complete === true;
  if (blueprintId === "mast") return projectFor(state, "screw_jack")?.complete === true;
  if (blueprintId === "lever") return projectFor(state, "mast")?.complete === true;
  if (blueprintId === "brace") return projectFor(state, "mast")?.complete === true;
  if (blueprintId === "pulley") return projectFor(state, "mast")?.complete === true;
  return true;
}

function ropeAction(
  state: AgentState,
  agent: AgentDefinition,
): AgentSubmission["action"] | undefined {
  if (!allRescueProjectsComplete(state)) return undefined;
  const livingWorkers = [
    state.self,
    ...state.teammates.filter((teammate) => teammate.integrity > 0),
  ]
    .map((worker) => worker.id)
    .sort();
  const hasOperatorLine = state.connections.some(
    (connection) =>
      connection.endsWith(">machine_winch") &&
      !connection.startsWith("machine_pulley>"),
  );
  const missing = [
    ...(!hasOperatorLine
      ? [
          {
            type: "attach_rope" as const,
            fromId: livingWorkers[0] ?? agent.id,
            toId: "machine_winch",
          },
        ]
      : []),
    ...(!hasConnection(state, "machine_winch", "machine_pulley")
      ? [
          {
            type: "attach_rope" as const,
            fromId: "machine_winch",
            toId: "machine_pulley",
          },
        ]
      : []),
    ...(!hasConnection(state, "machine_pulley", "humpty")
      ? [
          {
            type: "attach_rope" as const,
            fromId: "machine_pulley",
            toId: "humpty",
          },
        ]
      : []),
  ];
  return missing.find(
    (_line, index) =>
      livingWorkers[index % Math.max(1, livingWorkers.length)] === agent.id,
  );
}

function isLeadingLivingWorker(state: AgentState): boolean {
  return (
    [state.self, ...state.teammates.filter((teammate) => teammate.integrity > 0)]
      .map((worker) => worker.id)
      .sort()[0] === state.self.id
  );
}

function mockKing(agent: AgentDefinition, state: AgentState): AgentSubmission {
  const index = Number(agent.id.at(-1)) - 1;
  const order = latestOrder(state, ["Humpty, the Egg King", "Bell"]);
  const overheard = latestOrder(state, ["The Queen"]);
  const preferences = [
    ["skid", "screw_jack", "winch", "sling"],
    ["cart", "mast", "pulley", "brace"],
    ["ladder", "lever"],
  ] as const;
  const inheritedPreferences = state.teammates
    .filter((teammate) => teammate.integrity <= 0)
    .flatMap((teammate) => {
      const teammateIndex = Number(teammate.id.at(-1)) - 1;
      return preferences[teammateIndex] ?? [];
    });
  const availablePreferences = [
    ...(preferences[index] ?? RESCUE_BLUEPRINTS),
    ...inheritedPreferences,
  ];
  let action: AgentSubmission["action"];
  if (ownsActiveProject(state) || state.currentTask) {
    action = { type: "wait" };
  } else if (order === "hold") {
    action = { type: "wait" };
  } else if (
    allRescueProjectsComplete(state) &&
    state.connections.length >= 3 &&
    isLeadingLivingWorker(state)
  ) {
    action = { type: "operate", targetId: "machine_winch", effort: 0.74 };
  } else if (order === "rope" && ropeAction(state, agent)) {
    action = ropeAction(state, agent) ?? { type: "wait" };
  } else {
    const preferred = availablePreferences.find(
      (blueprintId) => projectReady(state, blueprintId),
    );
    const nextProject = preferred;
    const line = ropeAction(state, agent);
    if (nextProject) {
      action = { type: "start_project", blueprintId: nextProject };
    } else if (line) {
      action = line;
    } else if (
      order === "push" ||
      order === "guard" ||
      (index === 0 &&
        state.elapsed > 150 &&
        (overheard === "siege" || overheard === "throw"))
    ) {
      action = engage(state, 1);
    } else {
      action = { type: "wait" };
    }
  }
  if (
    (order === "push" || order === "guard") &&
    !ownsActiveProject(state) &&
    !state.currentTask
  ) {
    action = engage(state, 1);
  }
  const say = teamSpeech(agent, state, action);
  return { ...(say ? { say } : {}), action };
}

function mockQueen(agent: AgentDefinition, state: AgentState): AgentSubmission {
  const index = Number(agent.id.at(-1)) - 1;
  const order = latestOrder(state, ["The Queen"]);
  const overheard = latestOrder(state, ["Humpty, the Egg King"]);
  const assignedOrder = index === state.turn % 3;
  const assignedMachine = ["spring_trap", "cart", "lever"][index] as
    | "spring_trap"
    | "cart"
    | "lever";
  const assignedProject = projectForTeam(state, assignedMachine, "queen");
  const weaponReady = ["spring_trap", "cart", "lever"].every(
    (blueprintId) => projectForTeam(state, blueprintId, "queen")?.complete,
  );
  const ownBarricade = state.projects.find(
    (project) =>
      project.blueprintId === "barricade" && project.workerId === agent.id,
  );
  let action: AgentSubmission["action"];
  if (state.currentTask || ownsActiveProject(state)) {
    action = { type: "wait" };
  } else if (order === "hold" && assignedOrder) {
    action = { type: "wait" };
  } else if (assignedOrder && (order === "throw" || order === "siege")) {
    action =
      order === "siege" &&
      index === 0 &&
      weaponReady &&
      state.humpty.height < 470
        ? throwAtHumpty(state, "queen", 9, 0.96)
        : throwAt(state, "queen", (state.turn + index) % 9, 2 - index, 0.64);
  } else if (
    !assignedProject &&
    assignedMachine === "lever" &&
    projectForTeam(state, "cart", "queen")?.complete !== true &&
    !ownBarricade
  ) {
    action = { type: "start_project", blueprintId: "barricade" };
  } else if (
    !assignedProject &&
    (assignedMachine !== "spring_trap" || state.elapsed < 260)
  ) {
    action = { type: "start_project", blueprintId: assignedMachine };
  } else if (
    assignedOrder &&
    (order === "push" ||
      (state.elapsed > 140 && (overheard === "rope" || overheard === "guard")))
  ) {
    action = engage(state, -1);
  } else if ([36, 44].includes(state.turn)) {
    const volley = [36, 44].indexOf(state.turn);
    action = throwAt(
      state,
      "queen",
      volley * 3 + index,
      2 - index,
      0.58 + index * 0.04,
    );
  } else if (
    state.turn === 52 &&
    index === 0 &&
    weaponReady &&
    state.humpty.height < 470
  ) {
    action = throwAtHumpty(state, "queen", 9, 0.96);
  } else if (state.elapsed > 110 && (state.turn + index * 2) % 4 === 0) {
    action = engage(state, -1);
  } else {
    action = { type: "wait" };
  }
  const say = teamSpeech(agent, state, action);
  return { ...(say ? { say } : {}), action };
}

export class MockAgentDriver implements AgentDriver {
  readonly model = "mock";

  async act(agent: AgentDefinition, state: AgentState): Promise<AgentSubmission> {
    if (agent.id === "king" || agent.id === "queen") {
      const say = teamSpeech(agent, state, { type: "wait" });
      return {
        ...(say ? { say } : {}),
        action: { type: "wait" },
      };
    }
    if (agent.id === "humpty") {
      const say =
        state.turn % 3 === 1
          ? humptySpeech[
              Math.floor((state.turn - 1) / 3) % humptySpeech.length
            ]
          : undefined;
      return {
        ...(say ? { say } : {}),
        action: {
          type: "shift_weight",
          direction: state.turn % 11 === 0 ? -1 : state.turn % 7 === 0 ? 1 : 0,
          effort: state.turn % 7 === 0 || state.turn % 11 === 0 ? 0.08 : 0,
        },
      };
    }
    return agent.team === "king"
      ? mockKing(agent, state)
      : mockQueen(agent, state);
  }
}

interface ResponsesPayload {
  model?: string;
  status?: string;
  incomplete_details?: {
    reason?: string;
  };
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  error?: {
    message?: string;
  };
}

export class LlmAgentDriver implements AgentDriver {
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly reasoningEffort: "none" | "low" | "medium" | "high" | "xhigh";
  private readonly temperature: number;
  private readonly promptDirectory: string;
  private readonly prompts = new Map<string, string>();
  private unavailableUntil = 0;

  constructor(root: string) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      throw new Error(
        "AGENT_DRIVER=llm requires OPENAI_API_KEY in .env or the environment.",
      );
    }
    this.apiKey = key;
    this.baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(
      /\/$/,
      "",
    );
    this.model = process.env.OPENAI_MODEL ?? "gpt-5.4";
    const configuredEffort = process.env.OPENAI_REASONING_EFFORT ?? "none";
    this.reasoningEffort =
      configuredEffort === "low" ||
      configuredEffort === "medium" ||
      configuredEffort === "high" ||
      configuredEffort === "xhigh"
        ? configuredEffort
        : "none";
    const configuredTemperature = Number(process.env.OPENAI_TEMPERATURE ?? 0.9);
    this.temperature = Number.isFinite(configuredTemperature)
      ? Math.max(0, Math.min(2, configuredTemperature))
      : 0.9;
    this.promptDirectory = join(root, "prompts");
  }

  private async promptFile(filename: string): Promise<string> {
    const cached = this.prompts.get(filename);
    if (cached) return cached;
    const value = await readFile(join(this.promptDirectory, filename), "utf8");
    this.prompts.set(filename, value);
    return value;
  }

  private async request(prompt: string, maxOutputTokens: number): Promise<unknown> {
    if (Date.now() < this.unavailableUntil) {
      return {
        action: { type: "wait" },
        actions: [],
      };
    }
    const response = await fetch(`${this.baseUrl}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        reasoning: { effort: this.reasoningEffort },
        ...(this.reasoningEffort === "none"
          ? { temperature: this.temperature }
          : {}),
        max_output_tokens: maxOutputTokens,
        store: false,
        text: {
          verbosity: "low",
          format: { type: "json_object" },
        },
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: prompt }],
          },
        ],
      }),
    });

    const payload = (await response.json()) as ResponsesPayload;
    if (!response.ok) {
      if (response.status === 429) {
        const message = payload.error?.message ?? "";
        this.unavailableUntil =
          Date.now() +
          (/no credits remaining/i.test(message) ? 10 * 60_000 : 60_000);
      }
      throw new Error(
        `Agent endpoint returned ${response.status}: ${
          payload.error?.message ?? "unknown error"
        }`,
      );
    }
    const content = payload.output
      ?.flatMap((item) => item.content ?? [])
      .find((item) => item.type === "output_text")
      ?.text;
    if (!content) {
      const outputTypes = payload.output
        ?.map((item) => item.type ?? "unknown")
        .join(",");
      throw new Error(
        `Agent endpoint returned no playable JSON (status=${payload.status ?? "unknown"}, reason=${payload.incomplete_details?.reason ?? "unknown"}, output=${outputTypes ?? "none"})`,
      );
    }
    return extractJson(content);
  }

  async act(agent: AgentDefinition, state: AgentState): Promise<unknown> {
    const template = await this.promptFile(agent.promptFile);
    return this.request(
      template.replace("{{state}}", JSON.stringify(state)),
      500,
    );
  }

  async actTeam(team: WorkerTeam, state: TeamAgentState): Promise<unknown> {
    const template = await this.promptFile(`${team}_team.txt`);
    const neutralState = {
      ...state,
      joinOptions: state.joinOptions.map(
        ({ completedFunctions: _completedFunctions, ...option }) => option,
      ),
    };
    return this.request(
      template.replace("{{state}}", JSON.stringify(neutralState)),
      2_200,
    );
  }
}
