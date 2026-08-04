import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { config as loadEnv } from "dotenv";
import {
  createServer as createViteServer,
  type ViteDevServer,
} from "vite";
import { WebSocket, WebSocketServer } from "ws";
import type { ClientCommand } from "../shared/protocol.js";
import { LlmAgentDriver, MockAgentDriver } from "./agents.js";
import { GameSimulation } from "./simulation.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: resolve(root, ".env") });

const port = Number(process.env.PORT ?? 5173);
const host = process.env.HOST ?? "127.0.0.1";
const buildId = new Date()
  .toISOString()
  .replace(/\D/g, "")
  .slice(4, 14);
const noCacheHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  "X-Humpty-Build": buildId,
};
const driver =
  process.env.AGENT_DRIVER === "llm"
    ? new LlmAgentDriver(root)
    : new MockAgentDriver();

const simulation = new GameSimulation({
  root,
  driver,
  ...(process.env.SEED ? { seed: Number(process.env.SEED) } : {}),
});
await simulation.initialize();
const fixtureScenario = process.env.FIXTURE_SCENARIO;
let fixtureScenarioStarted = false;
let latestSnapshotPayload = JSON.stringify(simulation.snapshot());

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
        driver: driver.model,
        seed: simulation.getSeed(),
        build: buildId,
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
  if (requestUrl.pathname === "/replays") {
    response.writeHead(200, {
      "Content-Type": "application/json",
      ...noCacheHeaders,
    });
    response.end(JSON.stringify(simulation.replayManifest()));
    return;
  }
  if (requestUrl.pathname.startsWith("/replays/")) {
    const runId = decodeURIComponent(requestUrl.pathname.slice("/replays/".length));
    const replay = simulation.replayBundle(runId);
    if (!replay) {
      response.writeHead(404, noCacheHeaders);
      response.end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Encoding": "gzip",
      ...noCacheHeaders,
    });
    response.end(gzipSync(JSON.stringify(replay), { level: 6 }));
    return;
  }
  if (requestUrl.pathname === "/command" && request.method === "POST") {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      try {
        simulation.handleCommand(JSON.parse(body) as ClientCommand);
        response.writeHead(204, noCacheHeaders);
        response.end();
      } catch {
        response.writeHead(400, {
          "Content-Type": "application/json",
          ...noCacheHeaders,
        });
        response.end(JSON.stringify({ error: "Malformed command" }));
      }
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
  const pathname = new URL(
    request.url ?? "/",
    `http://${host}:${port}`,
  ).pathname;
  if (pathname !== "/ws") {
    socket.destroy();
    return;
  }
  sockets.handleUpgrade(request, socket, head, (webSocket) => {
    sockets.emit("connection", webSocket, request);
  });
});

sockets.on("connection", (socket) => {
  if (!fixtureScenarioStarted && fixtureScenario === "rescue") {
    const fixture = simulation.debugArrangeRescueFixture();
    simulation.debugStartRescueFixture(fixture.assemblyId);
    fixtureScenarioStarted = true;
  }
  socket.send(JSON.stringify(simulation.snapshot()));
  socket.on("message", (payload) => {
    try {
      const command = JSON.parse(payload.toString()) as ClientCommand;
      simulation.handleCommand(command);
    } catch {
      socket.send(JSON.stringify({ type: "error", message: "Malformed command" }));
    }
  });
});

const physicsTimer = setInterval(() => simulation.tick(), 8);
const broadcastTimer = setInterval(() => {
  latestSnapshotPayload = JSON.stringify(simulation.snapshot());
  for (const client of sockets.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(latestSnapshotPayload);
  }
}, 50);

httpServer.listen(port, host, () => {
  console.log("");
  console.log("  ALL THE KING'S MEN");
  console.log(`  Local theatre: http://${host}:${port}`);
  console.log(`  Agent driver:  ${driver.model}`);
  console.log(`  Tower seed:    ${simulation.getSeed()}`);
  console.log(`  Live build:    ${buildId}`);
  console.log("");
});

async function shutdown(): Promise<void> {
  clearInterval(physicsTimer);
  clearInterval(broadcastTimer);
  sockets.close();
  await vite.close();
  httpServer.close();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
