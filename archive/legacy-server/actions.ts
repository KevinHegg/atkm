import type { AgentSubmission } from "../shared/protocol.js";

const MAX_SAY = 80;
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const id = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 80;

export interface ValidationResult {
  accepted: boolean;
  submission: AgentSubmission;
  reason?: string;
}

const wait = (say?: string): AgentSubmission => ({
  ...(say ? { say } : {}),
  action: { type: "wait" },
});

export function validateSubmission(raw: unknown): ValidationResult {
  if (typeof raw !== "object" || raw === null) {
    return { accepted: false, submission: wait(), reason: "Submission is not an object" };
  }

  const candidate = raw as Record<string, unknown>;
  const say =
    typeof candidate.say === "string"
      ? candidate.say
          .trim()
          .slice(0, MAX_SAY)
          .split(/\s+/)
          .slice(0, 10)
          .join(" ")
      : undefined;
  const action = candidate.action;
  if (typeof action !== "object" || action === null) {
    return {
      accepted: false,
      submission: wait(say),
      reason: "Missing action object",
    };
  }

  const data = action as Record<string, unknown>;
  switch (data.type) {
    case "move":
      if (finite(data.x)) {
        return {
          accepted: true,
          submission: {
            ...(say ? { say } : {}),
            action: {
              type: "move",
              x: data.x,
              ...(finite(data.y) ? { y: data.y } : {}),
            },
          },
        };
      }
      break;
    case "climb":
      if (id(data.targetId)) {
        return { accepted: true, submission: { ...(say ? { say } : {}), action: { type: "climb", targetId: data.targetId } } };
      }
      break;
    case "place_plank":
      if (finite(data.x) && finite(data.y) && finite(data.angle)) {
        return {
          accepted: true,
          submission: {
            ...(say ? { say } : {}),
            action: {
              type: "place_plank",
              x: data.x,
              y: data.y,
              angle: data.angle,
            },
          },
        };
      }
      break;
    case "place_item":
      if (
        id(data.itemId) &&
        finite(data.x) &&
        finite(data.y) &&
        finite(data.angle)
      ) {
        return {
          accepted: true,
          submission: {
            ...(say ? { say } : {}),
            action: {
              type: "place_item",
              itemId: data.itemId,
              x: data.x,
              y: data.y,
              angle: data.angle,
            },
          },
        };
      }
      break;
    case "start_project":
      if (
        data.blueprintId === "skid" ||
        data.blueprintId === "cart" ||
        data.blueprintId === "lever" ||
        data.blueprintId === "screw_jack" ||
        data.blueprintId === "mast" ||
        data.blueprintId === "brace" ||
        data.blueprintId === "ladder" ||
        data.blueprintId === "winch" ||
        data.blueprintId === "pulley" ||
        data.blueprintId === "sling" ||
        data.blueprintId === "spring_trap" ||
        data.blueprintId === "barricade"
      ) {
        return {
          accepted: true,
          submission: {
            ...(say ? { say } : {}),
            action: {
              type: "start_project",
              blueprintId: data.blueprintId,
            },
          },
        };
      }
      break;
    case "fit_item":
      if (id(data.itemId) && id(data.targetId)) {
        return {
          accepted: true,
          submission: {
            ...(say ? { say } : {}),
            action: {
              type: "fit_item",
              itemId: data.itemId,
              targetId: data.targetId,
            },
          },
        };
      }
      break;
    case "operate":
      if (
        id(data.targetId) &&
        finite(data.effort) &&
        data.effort >= 0 &&
        data.effort <= 1
      ) {
        return {
          accepted: true,
          submission: {
            ...(say ? { say } : {}),
            action: {
              type: "operate",
              targetId: data.targetId,
              effort: data.effort,
            },
          },
        };
      }
      break;
    case "shift_weight":
      if (
        (data.direction === -1 || data.direction === 0 || data.direction === 1) &&
        finite(data.effort) &&
        data.effort >= 0 &&
        data.effort <= 1
      ) {
        return {
          accepted: true,
          submission: {
            ...(say ? { say } : {}),
            action: {
              type: "shift_weight",
              direction: data.direction,
              effort: data.effort,
            },
          },
        };
      }
      break;
    case "attach_rope":
      if (id(data.fromId) && id(data.toId)) {
        return {
          accepted: true,
          submission: {
            ...(say ? { say } : {}),
            action: {
              type: "attach_rope",
              fromId: data.fromId,
              toId: data.toId,
            },
          },
        };
      }
      break;
    case "cut_rope":
      if (id(data.ropeId)) {
        return { accepted: true, submission: { ...(say ? { say } : {}), action: { type: "cut_rope", ropeId: data.ropeId } } };
      }
      break;
    case "carry":
      if (id(data.targetId)) {
        return { accepted: true, submission: { ...(say ? { say } : {}), action: { type: "carry", targetId: data.targetId } } };
      }
      break;
    case "push":
      if (id(data.targetId) && (data.dir === -1 || data.dir === 1)) {
        return {
          accepted: true,
          submission: {
            ...(say ? { say } : {}),
            action: { type: "push", targetId: data.targetId, dir: data.dir },
          },
        };
      }
      break;
    case "throw":
      if (
        id(data.targetId) &&
        finite(data.angle) &&
        finite(data.power) &&
        data.power >= 0 &&
        data.power <= 1
      ) {
        return {
          accepted: true,
          submission: {
            ...(say ? { say } : {}),
            action: {
              type: "throw",
              targetId: data.targetId,
              angle: data.angle,
              power: data.power,
            },
          },
        };
      }
      break;
    case "use_weapon":
      if (
        (data.weapon === "pike" || data.weapon === "crossbow") &&
        id(data.targetId)
      ) {
        return {
          accepted: true,
          submission: {
            ...(say ? { say } : {}),
            action: {
              type: "use_weapon",
              weapon: data.weapon,
              targetId: data.targetId,
            },
          },
        };
      }
      break;
    case "snap":
    case "connect":
      if (id(data.partId) && id(data.targetId) && data.partId !== data.targetId) {
        return {
          accepted: true,
          submission: {
            ...(say ? { say } : {}),
            action: {
              type: data.type,
              partId: data.partId,
              targetId: data.targetId,
            },
          },
        };
      }
      break;
    case "test":
      if (id(data.partId) && finite(data.effort) && data.effort >= 0 && data.effort <= 1) {
        return {
          accepted: true,
          submission: {
            ...(say ? { say } : {}),
            action: { type: "test", partId: data.partId, effort: data.effort },
          },
        };
      }
      break;
    case "sabotage":
      if (
        id(data.connectionId) &&
        (data.method === "pull" || data.method === "strike" || data.method === "cut" || data.method === "jam")
      ) {
        return {
          accepted: true,
          submission: {
            ...(say ? { say } : {}),
            action: { type: "sabotage", connectionId: data.connectionId, method: data.method },
          },
        };
      }
      break;
    case "repair":
      if (id(data.connectionId)) {
        return {
          accepted: true,
          submission: { ...(say ? { say } : {}), action: { type: "repair", connectionId: data.connectionId } },
        };
      }
      break;
    case "recover":
      if (id(data.partId)) {
        return {
          accepted: true,
          submission: { ...(say ? { say } : {}), action: { type: "recover", partId: data.partId } },
        };
      }
      break;
    case "detach":
      if (id(data.partId)) {
        return {
          accepted: true,
          submission: {
            ...(say ? { say } : {}),
            action: { type: "detach", partId: data.partId },
          },
        };
      }
      break;
    case "use_assembly":
      if (
        id(data.partId) &&
        id(data.targetId) &&
        finite(data.effort) &&
        data.effort >= 0 &&
        data.effort <= 1
      ) {
        return {
          accepted: true,
          submission: {
            ...(say ? { say } : {}),
            action: {
              type: "use_assembly",
              partId: data.partId,
              targetId: data.targetId,
              effort: data.effort,
            },
          },
        };
      }
      break;
    case "wait":
      return { accepted: true, submission: wait(say) };
    default:
      break;
  }

  return {
    accepted: false,
    submission: wait(say),
    reason: `Malformed ${String(data.type ?? "unknown")} action`,
  };
}

export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced?.[1] ?? text;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("Model response did not contain a JSON object");
  }
  return JSON.parse(source.slice(start, end + 1));
}
