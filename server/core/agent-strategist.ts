import type { Team } from "../../shared/core-protocol.js";

export interface FigureStrategyOption {
  id: string;
  label: string;
  when: readonly string[];
}

export interface FigureStrategyChoice {
  workerId: string;
  team: Team;
  objective: string;
  observedFacts: readonly string[];
  options: readonly FigureStrategyOption[];
}

export interface TeamStrategyOption {
  id: string;
  ruleId: string;
  label: string;
  utility?: number;
  observedFacts: readonly string[];
  missingFacts: readonly string[];
  capabilities: readonly string[];
  simpleMachines: readonly string[];
}

export interface TeamStrategyChoice {
  team: Team;
  objective: string;
  observedFacts: readonly string[];
  attemptedPlanIds: readonly string[];
  options: readonly TeamStrategyOption[];
}

export interface StrategyRequest {
  id: string;
  phase: string;
  trigger: "scheduled" | "impact" | "blocked-route" | "dropped-part" | "enemy-interference";
  figures?: readonly FigureStrategyChoice[];
  teams?: readonly TeamStrategyChoice[];
  repositoryContext?: string;
}

export interface StrategyDecision {
  figures: Array<{ workerId: string; ruleId: string; say?: string }>;
  teams: Array<{ team: Team; planId: string; say?: string }>;
}

export type StrategyPoll =
  | { state: "missing" | "pending" }
  | { state: "ready"; decision: StrategyDecision }
  | { state: "failed"; reason: string };

export interface AgentStrategist {
  readonly enabled: boolean;
  readonly name: string;
  request(request: StrategyRequest): void;
  poll(requestId: string): StrategyPoll;
  cancel(requestId: string): void;
}

interface PendingRequest {
  controller: AbortController;
}

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["figures", "teams"],
  properties: {
    figures: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["workerId", "ruleId", "say"],
        properties: {
          workerId: { type: "string" },
          ruleId: { type: "string" },
          say: { type: "string", maxLength: 120 },
        },
      },
    },
    teams: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["team", "planId", "say"],
        properties: {
          team: { type: "string", enum: ["king", "queen"] },
          planId: { type: "string" },
          say: { type: "string", maxLength: 120 },
        },
      },
    },
  },
} as const;

export class OpenAiAgentStrategist implements AgentStrategist {
  readonly enabled = true;
  readonly name = "llm";
  private readonly pending = new Map<string, PendingRequest>();
  private readonly completed = new Map<string, StrategyPoll>();

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly timeoutMs = 8_000,
  ) {}

  request(request: StrategyRequest): void {
    if (this.pending.has(request.id) || this.completed.has(request.id)) return;
    const controller = new AbortController();
    this.pending.set(request.id, { controller });
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    void this.run(request, controller.signal)
      .then((decision) => {
        this.completed.set(request.id, { state: "ready", decision });
      })
      .catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : "unknown strategy error";
        this.completed.set(request.id, { state: "failed", reason });
      })
      .finally(() => {
        clearTimeout(timeout);
        this.pending.delete(request.id);
      });
  }

  poll(requestId: string): StrategyPoll {
    const complete = this.completed.get(requestId);
    if (complete) {
      this.completed.delete(requestId);
      return complete;
    }
    return { state: this.pending.has(requestId) ? "pending" : "missing" };
  }

  cancel(requestId: string): void {
    this.pending.get(requestId)?.controller.abort();
    this.pending.delete(requestId);
    this.completed.delete(requestId);
  }

  private async run(request: StrategyRequest, signal: AbortSignal): Promise<StrategyDecision> {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        store: false,
        instructions: [
          "You direct autonomous medieval stage figures in a deterministic physics game.",
          "Choose exactly one listed option for every supplied figure or team.",
          "Use only IDs present in that figure or team's options. Never invent an action, body, transform, force, or part.",
          "Prefer choices that advance the team's stated objective and respond to the trigger and observed facts.",
          "When options include utility scores, treat them as the team's current tactical estimate and prefer the highest score unless another visible fact clearly dominates.",
          "The repository context is a contract, not a source of hidden powers: stay inside its public action and connection rules.",
          "The say field is optional in spirit but required by the schema: use an empty string or one brief in-character order.",
          "Return only the requested structured decision.",
        ].join(" "),
        input: JSON.stringify(request),
        text: {
          format: {
            type: "json_schema",
            name: "agent_strategy_decision",
            strict: true,
            schema: RESPONSE_SCHEMA,
          },
        },
      }),
      signal,
    });
    if (!response.ok) {
      throw new Error(`strategy service returned ${response.status}`);
    }
    const payload = await response.json() as {
      output_text?: string;
      output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
    };
    const text = payload.output_text ?? payload.output
      ?.flatMap((item) => item.content ?? [])
      .find((item) => item.type === "output_text")?.text;
    if (!text) throw new Error("strategy service returned no structured decision");
    return validateDecision(request, JSON.parse(text) as unknown);
  }
}

export function validateDecision(request: StrategyRequest, value: unknown): StrategyDecision {
  const source = asRecord(value);
  const requestedFigures = new Map((request.figures ?? []).map((figure) => [figure.workerId, figure]));
  const requestedTeams = new Map((request.teams ?? []).map((team) => [team.team, team]));
  const figures = arrayOfRecords(source.figures).map((choice) => {
    const workerId = requiredString(choice.workerId, "workerId");
    const ruleId = requiredString(choice.ruleId, "ruleId");
    const figure = requestedFigures.get(workerId);
    if (!figure?.options.some((option) => option.id === ruleId)) {
      throw new Error(`unlisted rule ${ruleId} for ${workerId}`);
    }
    return { workerId, ruleId, ...optionalSpeech(choice.say) };
  });
  const teams = arrayOfRecords(source.teams).map((choice) => {
    const team = requiredString(choice.team, "team") as Team;
    const planId = requiredString(choice.planId, "planId");
    const teamRequest = requestedTeams.get(team);
    if (!teamRequest?.options.some((option) => option.id === planId)) {
      throw new Error(`unlisted plan ${planId} for ${team}`);
    }
    return { team, planId, ...optionalSpeech(choice.say) };
  });
  if (new Set(figures.map((choice) => choice.workerId)).size !== requestedFigures.size) {
    throw new Error("strategy response omitted or duplicated a figure");
  }
  if (new Set(teams.map((choice) => choice.team)).size !== requestedTeams.size) {
    throw new Error("strategy response omitted or duplicated a team");
  }
  return { figures, teams };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("strategy response is not an object");
  }
  return value as Record<string, unknown>;
}

function arrayOfRecords(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) throw new Error("strategy response is missing an array");
  return value.map(asRecord);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`strategy response has no ${field}`);
  return value;
}

function optionalSpeech(value: unknown): { say?: string } {
  if (typeof value !== "string") return {};
  const say = value.trim().slice(0, 120);
  return say ? { say } : {};
}
