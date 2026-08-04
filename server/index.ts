import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import {
  createServer as createViteServer,
  type ViteDevServer,
} from "vite";
import { WebSocket, WebSocketServer } from "ws";
import {
  CORE_FIXED_DT,
  CORE_MODE,
  CORE_SNAPSHOT_HZ,
  type CoreClientCommand,
  type Team,
} from "../shared/core-protocol.js";
import { AGENT_OBJECTIVES, AGENT_RULES } from "../shared/agent-rules.js";
import { OpenAiAgentStrategist } from "./core/agent-strategist.js";
import { expandContraptionPlans } from "./core/contraption-grammar.js";
import { observedCompoundPlans } from "./core/compound-plans.js";
import { REPO_AGENT_CONTEXT } from "./core/repo-context.js";
import { ReplayArchive } from "./core/replay-archive.js";
import { CoreSimulation } from "./core/simulation.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: resolve(root, ".env") });

const port = Number(process.env.PORT ?? 5173);
const host = process.env.HOST ?? "127.0.0.1";
const seed = Number(process.env.SEED ?? 1881);
const agentDriver = process.env.AGENT_DRIVER ?? "mock";
const autoMatch = agentDriver !== "off";
const llmEnabled = agentDriver === "llm" && Boolean(process.env.OPENAI_API_KEY);
const agentModel = process.env.OPENAI_MODEL ?? "gpt-5.4";
const buildId = new Date().toISOString().replace(/\D/g, "").slice(4, 14);
const noCacheHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  "X-Humpty-Build": buildId,
};

const createStrategist = () => llmEnabled
  ? new OpenAiAgentStrategist(process.env.OPENAI_API_KEY!, agentModel)
  : undefined;
let simulation = await CoreSimulation.create({
  seed,
  build: buildId,
  autoMatch,
  strategist: createStrategist(),
});
const replayArchive = new ReplayArchive(resolve(root, ".local", "replays"));
await replayArchive.load();
const initialSnapshot = simulation.snapshot();
replayArchive.start(initialSnapshot);
let latestSnapshotPayload = JSON.stringify(initialSnapshot);
let accumulator = 0;
let previousTime = performance.now();

let vite: ViteDevServer;
const httpServer = createServer((request, response) => {
  const requestUrl = new URL(request.url ?? "/", `http://${host}:${port}`);
  if (requestUrl.pathname === "/health") {
    response.writeHead(200, {
      "Content-Type": "application/json",
      ...noCacheHeaders,
    });
    response.end(
      JSON.stringify({
        ok: true,
        driver: autoMatch ? llmEnabled ? "llm" : "mock" : "manual-legality-lab",
        llm: llmEnabled,
        physics: "rapier3d",
        worlds: 1,
        mode: CORE_MODE,
        seed: simulation.seed,
        build: buildId,
        tick: simulation.physics.tick,
      }),
    );
    return;
  }
  if (requestUrl.pathname === "/snapshot") {
    response.writeHead(200, {
      "Content-Type": "application/json",
      ...noCacheHeaders,
    });
    response.end(latestSnapshotPayload);
    return;
  }
  if (requestUrl.pathname === "/rules") {
    response.writeHead(200, {
      "Content-Type": "application/json",
      ...noCacheHeaders,
    });
    response.end(JSON.stringify({ objectives: AGENT_OBJECTIVES, rules: AGENT_RULES }));
    return;
  }
  if (requestUrl.pathname === "/agent-context") {
    response.writeHead(200, {
      "Content-Type": "application/json",
      ...noCacheHeaders,
    });
    response.end(JSON.stringify({
      ...REPO_AGENT_CONTEXT,
      agentsMd: readFileSync(resolve(root, "AGENTS.md"), "utf8"),
      endpoints: ["/rules", "/contraptions", "/archive"],
    }));
    return;
  }
  if (requestUrl.pathname === "/contraptions") {
    const requestedTeam = requestUrl.searchParams.get("team");
    const teams: Team[] = requestedTeam === "king" || requestedTeam === "queen"
      ? [requestedTeam]
      : ["king", "queen"];
    const contraptions = teams.flatMap((team) =>
      expandContraptionPlans(observedCompoundPlans(simulation.physics, team)).map((plan) => ({
        id: plan.id,
        basePlanId: plan.baseId ?? plan.id,
        composition: plan.composition ?? [],
        hybrid: Boolean(plan.composition?.length),
        team,
        label: plan.label,
        ruleId: plan.ruleId,
        eligible: plan.eligible,
        observedFacts: plan.observedFacts,
        missingFacts: plan.requiredFacts.filter((fact) => !plan.observedFacts.includes(fact)),
        simpleMachines: plan.simpleMachines,
        capabilities: plan.capabilities,
        parts: plan.parts,
        publicActionCount: plan.requests.length,
      })));
    response.writeHead(200, {
      "Content-Type": "application/json",
      ...noCacheHeaders,
    });
    response.end(JSON.stringify({ contractVersion: REPO_AGENT_CONTEXT.contractVersion, contraptions }));
    return;
  }
  if (requestUrl.pathname === "/archive") {
    response.writeHead(200, {
      "Content-Type": "application/json",
      ...noCacheHeaders,
    });
    response.end(JSON.stringify({ durable: replayArchive.durable, replays: replayArchive.summaries() }));
    return;
  }
  if (requestUrl.pathname.startsWith("/archive/")) {
    const id = decodeURIComponent(requestUrl.pathname.slice("/archive/".length));
    const entry = replayArchive.entry(id);
    if (!entry) {
      response.writeHead(404, { "Content-Type": "application/json", ...noCacheHeaders });
      response.end(JSON.stringify({ error: "Replay not found" }));
      return;
    }
    response.writeHead(200, {
      "Content-Type": "application/json",
      ...noCacheHeaders,
    });
    response.end(JSON.stringify(entry));
    return;
  }
  if (requestUrl.pathname === "/command" && request.method === "POST") {
    readJsonBody(request)
      .then(async (command) => {
        if (command.type === "reset") {
          replayArchive.finalize(simulation.snapshot());
          await replayArchive.flush();
          simulation.destroy();
          simulation = await CoreSimulation.create({
            seed: command.seed ?? seed,
            build: buildId,
            autoMatch,
            strategist: createStrategist(),
          });
          accumulator = 0;
          previousTime = performance.now();
          const resetSnapshot = simulation.snapshot();
          replayArchive.start(resetSnapshot);
          latestSnapshotPayload = JSON.stringify(resetSnapshot);
          response.writeHead(204, noCacheHeaders);
          response.end();
          return;
        }
        const result = simulation.handleCommand(command);
        response.writeHead(result.ok ? 200 : 409, {
          "Content-Type": "application/json",
          ...noCacheHeaders,
        });
        response.end(JSON.stringify(result));
      })
      .catch(() => {
        response.writeHead(400, {
          "Content-Type": "application/json",
          ...noCacheHeaders,
        });
        response.end(JSON.stringify({ error: "Malformed command" }));
      });
    return;
  }
  if (requestUrl.pathname === "/favicon.ico") {
    response.writeHead(204);
    response.end();
    return;
  }
  if (requestUrl.pathname === "/") {
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      ...noCacheHeaders,
    });
    response.end(
      readFileSync(resolve(root, "index.html"), "utf8").replaceAll(
        "__BUILD_ID__",
        buildId,
      ),
    );
    return;
  }
  if (requestUrl.pathname === "/client/style.css") {
    response.writeHead(200, {
      "Content-Type": "text/css; charset=utf-8",
      ...noCacheHeaders,
    });
    response.end(readFileSync(resolve(root, "client/style.css"), "utf8"));
    return;
  }
  for (const [name, value] of Object.entries(noCacheHeaders)) {
    response.setHeader(name, value);
  }
  vite.middlewares(request, response, () => {
    response.statusCode = 404;
    response.end("Not found");
  });
});

vite = await createViteServer({
  root,
  appType: "spa",
  server: {
    middlewareMode: true,
    hmr: false,
    headers: noCacheHeaders,
  },
});

const sockets = new WebSocketServer({ noServer: true });
httpServer.on("upgrade", (request, socket, head) => {
  const pathname = new URL(request.url ?? "/", `http://${host}:${port}`).pathname;
  if (pathname !== "/ws") {
    socket.destroy();
    return;
  }
  sockets.handleUpgrade(request, socket, head, (webSocket) => {
    sockets.emit("connection", webSocket, request);
  });
});

sockets.on("connection", (socket) => {
  socket.send(latestSnapshotPayload);
  socket.on("message", (payload) => {
    try {
      const command = JSON.parse(payload.toString()) as CoreClientCommand;
      const result = simulation.handleCommand(command);
      if (!result.ok) socket.send(JSON.stringify({ type: "command-error", ...result }));
    } catch {
      socket.send(JSON.stringify({ type: "command-error", message: "Malformed command" }));
    }
  });
});

const physicsTimer = setInterval(() => {
  const now = performance.now();
  accumulator += Math.min(0.1, (now - previousTime) / 1000);
  previousTime = now;
  let steps = 0;
  while (accumulator >= CORE_FIXED_DT && steps < 6) {
    simulation.step();
    accumulator -= CORE_FIXED_DT;
    steps += 1;
  }
  if (steps === 6) accumulator = Math.min(accumulator, CORE_FIXED_DT);
}, 8);

const broadcastTimer = setInterval(() => {
  const snapshot = simulation.snapshot();
  replayArchive.capture(snapshot);
  latestSnapshotPayload = JSON.stringify(snapshot);
  for (const client of sockets.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(latestSnapshotPayload);
  }
}, 1000 / CORE_SNAPSHOT_HZ);

httpServer.listen(port, host, () => {
  console.log("");
  console.log("  ALL THE KING'S MEN / CORE LEGIBILITY LAB");
  console.log(`  Local theatre: http://${host}:${port}/?mode=${CORE_MODE}&seed=${seed}`);
  console.log("  Physics:       Rapier 3D, server authoritative, 60 Hz");
  console.log(`  Agent driver:  ${autoMatch ? llmEnabled ? `llm (${agentModel})` : "mock (automatic)" : "manual"}`);
  if (agentDriver === "llm" && !llmEnabled) console.log("  LLM agents:    credential unavailable; using the seeded fallback");
  console.log(`  Live build:    ${buildId}`);
  console.log("");
});

async function readJsonBody(request: import("node:http").IncomingMessage): Promise<CoreClientCommand> {
  let body = "";
  for await (const chunk of request) body += chunk.toString();
  return JSON.parse(body) as CoreClientCommand;
}

async function shutdown(): Promise<void> {
  clearInterval(physicsTimer);
  clearInterval(broadcastTimer);
  sockets.close();
  replayArchive.finalize(simulation.snapshot());
  await replayArchive.flush();
  simulation.destroy();
  await vite.close();
  httpServer.close();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
