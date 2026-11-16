import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { DATA_FILES, type DataFile } from "../model/engine.ts";
import { writeAtomic } from "./fsutil.ts";

export type Author = { kind: "agent"; name: string } | { kind: "person" } | { kind: "file" };
/** Sticky ids added, removed or changed, and how many arrows were added or removed. */
export type ChangeSummary = { added: string[]; removed: string[]; updated: string[]; edgesAdded: number; edgesRemoved: number };
export type VersionEntry = { version: number; at: string; author: Author; summary: string; blobs: Record<DataFile, string>; diff: ChangeSummary };
export type DataFiles = Record<DataFile, string>;

/**
 * Per-project version history, kept like the Plannotator Inbox: projects/<slug>/history.jsonl gets one
 * line per version, and file contents live once in blobs/<sha256>.
 */
export class HistoryStore {
  readonly dataDir: string;
  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  async append(slug: string, e: { author: Author; summary: string; files: DataFiles; diff: ChangeSummary; at?: Date }): Promise<VersionEntry> {
    const blobs = {} as Record<DataFile, string>;
    for (const f of DATA_FILES) blobs[f] = await this.putBlob(e.files[f]);
    const prev = await this.latest(slug);
    const entry: VersionEntry = { version: (prev?.version ?? 0) + 1, at: (e.at ?? new Date()).toISOString(), author: e.author, summary: e.summary, blobs, diff: e.diff };
    const file = this.file(slug);
    await mkdir(join(this.dataDir, "projects", slug), { recursive: true });
    // A crash can leave a partial last line; start a fresh line so the new entry stays readable.
    let lead = "";
    if (existsSync(file)) {
      const text = await readFile(file, "utf8");
      if (text.length && !text.endsWith("\n")) lead = "\n";
    }
    await appendFile(file, `${lead}${JSON.stringify(entry)}\n`);
    return entry;
  }

  /** Newest first. */
  async list(slug: string, opts: { limit?: number } = {}): Promise<VersionEntry[]> {
    const all = (await this.entries(slug)).reverse();
    return opts.limit ? all.slice(0, opts.limit) : all;
  }

  async latest(slug: string): Promise<VersionEntry | null> {
    const all = await this.entries(slug);
    return all.at(-1) ?? null;
  }

  async entry(slug: string, version: number): Promise<VersionEntry> {
    const e = (await this.entries(slug)).find((x) => x.version === version);
    if (!e) throw new Error(`版 ${version} はありません。list_history で版番号を確かめてください。`);
    return e;
  }

  async read(slug: string, version: number): Promise<DataFiles> {
    const e = await this.entry(slug, version);
    const out = {} as DataFiles;
    for (const f of DATA_FILES) out[f] = await readFile(join(this.dataDir, "blobs", e.blobs[f]), "utf8");
    return out;
  }

  private file(slug: string): string {
    return join(this.dataDir, "projects", slug, "history.jsonl");
  }

  private async entries(slug: string): Promise<VersionEntry[]> {
    const f = this.file(slug);
    if (!existsSync(f)) return [];
    const out: VersionEntry[] = [];
    for (const line of (await readFile(f, "utf8")).split("\n")) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line) as VersionEntry;
        if (typeof e.version === "number" && e.blobs) out.push(e);
      } catch {
        // A line cut off by a crash: skip it.
      }
    }
    return out;
  }

  private async putBlob(content: string): Promise<string> {
    const sha = createHash("sha256").update(content).digest("hex");
    const p = join(this.dataDir, "blobs", sha);
    if (!existsSync(p)) await writeAtomic(p, content);
    return sha;
  }
}
