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
}

interface PublicReplaySummary extends ReplaySummary {
  title: string;
  description: string;
  path: string;
}

const OUTPUT_DIR = resolve(process.cwd(), "public", "replays");
const BUILD_ID = "public-demo-0805";
const CREATED_AT = "2026-08-05T00:00:00.000Z";
const MAX_SECONDS = 120;
const FRAME_INTERVAL = 1.5;
const EVENT_LIMIT = 30;

const demos: DemoSpec[] = [
  {
    id: "red-hoist-vs-green-sling",
    seed: 1881,
    title: "Red Hoist vs Green Sling",
    description: "Red rigs a routed hoist while Green builds a counterweight sling.",
  },
  {
    id: "red-hoist-vs-wheel-shot",
    seed: 4199,
    title: "Red Hoist vs Wheel Shot",
    description: "Green answers the rescue line with a ramped wheel bombard.",
  },
  {
    id: "red-hoist-vs-pivot-striker",
    seed: 7331,
    title: "Red Hoist vs Pivot Striker",
    description: "A beam and fulcrum striker contests Red's rescue hoist.",
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
    frameInterval: FRAME_INTERVAL,
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

  try {
    while (simulation.snapshot().elapsed < MAX_SECONDS && simulation.snapshot().match.status !== "complete") {
      simulation.step();
      const snapshot = simulation.snapshot();
      if (snapshot.elapsed + 1e-6 >= nextCapture) {
        frames.push(compactSnapshot(snapshot));
        nextCapture += FRAME_INTERVAL;
      }
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
  return copy;
}
