import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  CoreSnapshot,
  ReplayArchiveEntry,
  ReplaySummary,
} from "../../shared/core-protocol.js";

const FRAME_INTERVAL = .5;
const PERSIST_INTERVAL = 10;
const MAX_FRAMES = 1_320;
const MAX_ARCHIVES = 12;

interface StoredReplay {
  summary: ReplaySummary;
  frames: CoreSnapshot[];
}

/** Public replay history. Snapshots are safe to persist; engine handles never leave the server. */
export class ReplayArchive {
  private readonly archives: StoredReplay[] = [];
  private readonly pendingWrites = new Set<Promise<void>>();
  private readonly writeChains = new Map<string, Promise<void>>();
  private current: StoredReplay | undefined;
  private sequence = 0;
  private persistedFrameCount = 0;

  constructor(private readonly directory?: string) {}

  get durable(): boolean {
    return Boolean(this.directory);
  }

  async load(): Promise<void> {
    if (!this.directory) return;
    await mkdir(this.directory, { recursive: true });
    const names = (await readdir(this.directory)).filter((name) => name.endsWith(".json"));
    const loaded = await Promise.all(names.map(async (name) => {
      try {
        const parsed: unknown = JSON.parse(await readFile(resolve(this.directory!, name), "utf8"));
        if (!isStoredReplay(parsed)) return undefined;
        const stored: StoredReplay = {
          summary: { ...parsed.summary, live: false },
          frames: parsed.frames.map((frame) => structuredClone(frame)),
        };
        const match = stored.summary.id.match(/^match-(\d+)-/);
        if (match?.[1]) this.sequence = Math.max(this.sequence, Number(match[1]));
        return stored;
      } catch {
        return undefined;
      }
    }));
    this.archives.push(...loaded.filter((entry): entry is StoredReplay => Boolean(entry)));
    this.archives.sort((first, second) => second.summary.createdAt.localeCompare(first.summary.createdAt));
    this.archives.splice(MAX_ARCHIVES);
  }

  start(snapshot: CoreSnapshot): void {
    const summary: ReplaySummary = {
      id: `match-${++this.sequence}-${snapshot.seed}`,
      seed: snapshot.seed,
      build: snapshot.build,
      driver: snapshot.match.driver,
      status: snapshot.match.status,
      ...(snapshot.match.outcome ? { outcome: snapshot.match.outcome } : {}),
      duration: snapshot.elapsed,
      frameCount: 0,
      createdAt: new Date().toISOString(),
      live: true,
    };
    this.current = { summary, frames: [] };
    this.persistedFrameCount = 0;
    this.capture(snapshot, true);
  }

  capture(snapshot: CoreSnapshot, force = false): void {
    if (!this.current || snapshot.seed !== this.current.summary.seed) this.start(snapshot);
    if (!this.current) return;
    const last = this.current.frames.at(-1);
    if (!force && last && snapshot.elapsed - last.elapsed < FRAME_INTERVAL) {
      this.updateSummary(snapshot);
      return;
    }
    this.current.frames.push(structuredClone(snapshot));
    if (this.current.frames.length > MAX_FRAMES) this.current.frames.shift();
    this.updateSummary(snapshot);
    if (this.current.frames.length === 1 || this.current.frames.length - this.persistedFrameCount >= PERSIST_INTERVAL) {
      this.persistedFrameCount = this.current.frames.length;
      this.schedulePersist(this.current);
    }
  }

  finalize(snapshot: CoreSnapshot): void {
    if (!this.current) {
      this.start(snapshot);
      return;
    }
    this.capture(snapshot, true);
    this.current.summary.live = false;
    this.archives.unshift(this.current);
    while (this.archives.length > MAX_ARCHIVES) this.archives.pop();
    this.schedulePersist(this.current);
    this.current = undefined;
    this.persistedFrameCount = 0;
  }

  async flush(): Promise<void> {
    await Promise.all(this.pendingWrites);
  }

  summaries(): ReplaySummary[] {
    return [
      ...(this.current ? [{ ...this.current.summary, live: true }] : []),
      ...this.archives.map((archive) => ({ ...archive.summary, live: false })),
    ];
  }

  entry(id: string): ReplayArchiveEntry | undefined {
    const stored = this.current?.summary.id === id
      ? this.current
      : this.archives.find((archive) => archive.summary.id === id);
    if (!stored) return undefined;
    return {
      summary: { ...stored.summary },
      frames: stored.frames.map((frame) => structuredClone(frame)),
    };
  }

  private updateSummary(snapshot: CoreSnapshot): void {
    if (!this.current) return;
    this.current.summary = {
      ...this.current.summary,
      driver: snapshot.match.driver,
      status: snapshot.match.status,
      ...(snapshot.match.outcome ? { outcome: snapshot.match.outcome } : {}),
      duration: snapshot.elapsed,
      frameCount: this.current.frames.length,
    };
  }

  private schedulePersist(stored: StoredReplay): void {
    if (!this.directory) return;
    const copy: StoredReplay = {
      summary: { ...stored.summary },
      frames: stored.frames.map((frame) => structuredClone(frame)),
    };
    const id = copy.summary.id;
    const prior = this.writeChains.get(id) ?? Promise.resolve();
    const write = prior.catch(() => undefined).then(() => this.persist(copy));
    this.writeChains.set(id, write);
    const pending = write.finally(() => {
      this.pendingWrites.delete(pending);
      if (this.writeChains.get(id) === write) this.writeChains.delete(id);
    });
    this.pendingWrites.add(pending);
  }

  private async persist(stored: StoredReplay): Promise<void> {
    if (!this.directory) return;
    await mkdir(this.directory, { recursive: true });
    const path = resolve(this.directory, `${stored.summary.id}.json`);
    const temporary = resolve(
      this.directory,
      `.${stored.summary.id}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
    );
    await writeFile(temporary, JSON.stringify(stored), "utf8");
    await rename(temporary, path);
  }
}

function isStoredReplay(value: unknown): value is StoredReplay {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StoredReplay>;
  return Boolean(candidate.summary && typeof candidate.summary === "object" &&
    Array.isArray(candidate.frames) && candidate.frames.length > 0);
}
