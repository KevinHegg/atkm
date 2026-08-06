import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  CoreSnapshot,
  ReplayArchiveEntry,
  ReplaySummary,
} from "../shared/core-protocol.js";
import { CoreSimulation } from "../server/core/simulation.js";

interface DemoSpec {
  id: string;
  seed: number;
  title: string;
  description: string;
  frameInterval: number;
}

interface PublicReplaySummary extends ReplaySummary {
  title: string;
  description: string;
  path: string;
}

const OUTPUT_DIR = resolve(process.cwd(), "public", "replays");
const BUILD_ID = "siege-machines-0806";
const CREATED_AT = "2026-08-06T21:00:00.000Z";
const MAX_SECONDS = 200;
const EVENT_LIMIT = 18;
const ACTION_FRAME_INTERVAL = .2;

const demos: DemoSpec[] = [
  {
    id: "the-sledgebreaker",
    seed: 10,
    title: "The Counterbattery Duel",
    description: "Red raids the siege train while Green's bombardment doctrine searches for a path through the defenses.",
    frameInterval: 1,
  },
  {
    id: "the-ten-minute-hold",
    seed: 4198,
    title: "The Broken Foundation",
    description: "Green brings down the tower base, but Red's rescue doctrine carries a battered Humpty through the final bell.",
    frameInterval: 1,
  },
  {
    id: "the-king-shot",
    seed: 1881,
    title: "The Last Bolt",
    description: "A decapitation duel spends the catch net early and comes down to Green's final precision shot.",
    frameInterval: 1,
  },
];

await mkdir(OUTPUT_DIR, { recursive: true });

const summaries: PublicReplaySummary[] = [];
for (const demo of demos) {
  const entry = await createReplay(demo);
  const path = `${demo.id}.json`;
  await writeFile(resolve(OUTPUT_DIR, path), `${JSON.stringify(entry)}\n`, "utf8");
  summaries.push({
    ...entry.summary,
    title: demo.title,
    description: demo.description,
    path,
  });
}

await writeFile(
  resolve(OUTPUT_DIR, "manifest.json"),
  `${JSON.stringify({
    generatedAt: CREATED_AT,
    build: BUILD_ID,
    frameIntervals: Object.fromEntries(demos.map((demo) => [demo.id, demo.frameInterval])),
    actionFrameInterval: ACTION_FRAME_INTERVAL,
    replays: summaries,
  }, null, 2)}\n`,
  "utf8",
);

async function createReplay(demo: DemoSpec): Promise<ReplayArchiveEntry> {
  const simulation = await CoreSimulation.create({
    seed: demo.seed,
    build: BUILD_ID,
    autoMatch: true,
  });
  const frames: CoreSnapshot[] = [];
  let nextCapture = 0;
  let previousPhase = "";

  try {
    simulation.handleCommand({ type: "time-scale", value: 8 });
    while (simulation.snapshot().elapsed <= MAX_SECONDS + 1 && simulation.snapshot().match.status !== "complete") {
      simulation.step();
      const snapshot = simulation.snapshot();
      const phase = snapshot.match.battle?.phase ?? "";
      if (phase === "resolving" && previousPhase !== "resolving") nextCapture = snapshot.elapsed;
      const interval = phase === "resolving" ? ACTION_FRAME_INTERVAL : demo.frameInterval;
      if (snapshot.elapsed + 1e-6 >= nextCapture) {
        frames.push(compactSnapshot(snapshot));
        nextCapture = snapshot.elapsed + interval;
      }
      previousPhase = phase;
    }

    const finalSnapshot = compactSnapshot(simulation.snapshot());
    if (frames.at(-1)?.tick !== finalSnapshot.tick) frames.push(finalSnapshot);

    const summary: ReplaySummary = {
      id: demo.id,
      seed: demo.seed,
      build: BUILD_ID,
      driver: finalSnapshot.match.driver,
      status: finalSnapshot.match.status,
      ...(finalSnapshot.match.outcome ? { outcome: finalSnapshot.match.outcome } : {}),
      duration: finalSnapshot.elapsed,
      frameCount: frames.length,
      createdAt: CREATED_AT,
      live: false,
    };

    return { summary, frames };
  } finally {
    simulation.destroy();
  }
}

function compactSnapshot(snapshot: CoreSnapshot): CoreSnapshot {
  const copy = structuredClone(snapshot);
  copy.events = copy.events.slice(0, EVENT_LIMIT);
  copy.completedFixtures = [];
  copy.match.activeRuleIds = {};
  copy.match.applicableRuleIds = {};
  copy.match.machineEvidence = [];
  copy.match.machinePlanOptions = { king: [], queen: [] };
  copy.match.selectedMachinePlanIds = {};
  return copy;
}
