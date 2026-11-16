import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DATA_FILES, engine, productName, type DataFile, type ModelData } from "../model/engine.ts";
import { applyOps, OpError, type Op } from "../model/ops.ts";
import { diffModels, summaryText } from "../model/diff.ts";
import { writeAtomic } from "./fsutil.ts";
import type { Author, ChangeSummary, DataFiles, HistoryStore } from "./history.ts";
import { modelDirOf, type ProjectRegistry } from "./registry.ts";

export type ApplyResult =
  | { ok: true; version: number; warnings: string[]; htmlWritten: boolean; summary: ChangeSummary }
  | { ok: false; reason: "conflict"; current: { version: number; data: ModelData } }
  | { ok: false; reason: "invalid"; errors: string[] };

export type StoreEvent =
  | { type: "version"; slug: string; version: number; author: Author; summary: ChangeSummary; warnings: string[] }
  | { type: "file-error"; slug: string; errors: string[] };

type State = { version: number; files: DataFiles; data: ModelData; warnings: string[]; htmlCurrent: boolean };

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const serialize = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

/**
 * The single writer of every registered model. Each project has a version number; a write names the
 * version it was based on and is refused when that is no longer the latest. Structural errors are
 * refused; rule violations are saved as a draft and the committed pages are written only when the
 * whole model validates.
 */
export class ModelStore {
  private readonly registry: ProjectRegistry;
  private readonly history: HistoryStore;
  private readonly states = new Map<string, State>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly listeners = new Set<(e: StoreEvent) => void>();

  constructor(deps: { registry: ProjectRegistry; history: HistoryStore }) {
    this.registry = deps.registry;
    this.history = deps.history;
  }

  on(listener: (e: StoreEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async read(slug: string): Promise<{ version: number; data: ModelData; warnings: string[]; htmlCurrent: boolean }> {
    const s = await this.serial(slug, () => this.load(slug));
    return { version: s.version, data: structuredClone(s.data), warnings: s.warnings, htmlCurrent: s.htmlCurrent };
  }

  apply(slug: string, req: { baseVersion: number; ops: Op[]; author: Author }): Promise<ApplyResult> {
    return this.serial(slug, async () => {
      const s = await this.load(slug);
      if (req.baseVersion !== s.version) return { ok: false, reason: "conflict", current: { version: s.version, data: structuredClone(s.data) } };
      let next: ModelData;
      try {
        next = applyOps(s.data, req.ops).data;
      } catch (e) {
        if (e instanceof OpError) return { ok: false, reason: "invalid", errors: [e.message] };
        throw e;
      }
      return this.commit(slug, s, next, req.author);
    });
  }

  restore(slug: string, version: number, author: Author): Promise<ApplyResult> {
    return this.serial(slug, async () => {
      const s = await this.load(slug);
      const files = await this.history.read(slug, version);
      return this.commit(slug, s, parseFiles(files), author, `版 ${version} に戻した`);
    });
  }

  /**
   * Reads the files on disk and records them as a new version when they differ from the latest one
   * (an agent edited the JSON, git switched branches). Called by the watcher.
   */
  ingest(slug: string): Promise<void> {
    return this.serial(slug, async () => {
      const prev = this.states.get(slug);
      if (!prev) return void (await this.load(slug));
      const p = await this.registry.get(slug);
      const read = await readFiles(modelDirOf(p));
      if ("errors" in read) return this.emit({ type: "file-error", slug, errors: read.errors });
      if (DATA_FILES.every((f) => read.files[f] === prev.files[f])) return;
      const data = parseFiles(read.files);
      const { structural, warnings } = await check(data);
      if (structural.length) return this.emit({ type: "file-error", slug, errors: structural });
      const diff = stripFields(diffModels(prev.data, data));
      const entry = await this.history.append(slug, { author: { kind: "file" }, summary: `ファイルが変わった: ${summaryText(diff)}`, files: read.files, diff });
      const htmlCurrent = await pagesCurrent(modelDirOf(p), data, warnings);
      this.states.set(slug, { version: entry.version, files: read.files, data, warnings, htmlCurrent });
      this.emit({ type: "version", slug, version: entry.version, author: { kind: "file" }, summary: diff, warnings });
    });
  }

  private async commit(slug: string, s: State, next: ModelData, author: Author, label?: string): Promise<ApplyResult> {
    const { structural, warnings } = await check(next);
    if (structural.length) return { ok: false, reason: "invalid", errors: structural };
    const p = await this.registry.get(slug);
    const dir = modelDirOf(p);
    const files = {} as DataFiles;
    for (const f of DATA_FILES) files[f] = serialize(next[f]);
    for (const f of DATA_FILES) {
      if (files[f] !== s.files[f]) await writeAtomic(join(dir, "data", `${f}.json`), files[f]);
    }
    let htmlWritten = false;
    if (!warnings.length) {
      const { renderModel } = await engine();
      const pages = await renderModel(next, { product: productName(next) });
      for (const [file, html] of Object.entries(pages)) await writeAtomic(join(dir, file), html);
      htmlWritten = true;
    }
    const diff = stripFields(diffModels(s.data, next));
    const entry = await this.history.append(slug, { author, summary: label ?? summaryText(diff), files, diff });
    this.states.set(slug, { version: entry.version, files, data: next, warnings, htmlCurrent: htmlWritten });
    this.emit({ type: "version", slug, version: entry.version, author, summary: diff, warnings });
    return { ok: true, version: entry.version, warnings, htmlWritten, summary: diff };
  }

  private async load(slug: string): Promise<State> {
    const cached = this.states.get(slug);
    if (cached) return cached;
    const p = await this.registry.get(slug);
    const dir = modelDirOf(p);
    const read = await readFiles(dir);
    if ("errors" in read) throw new Error(read.errors.join("\n"));
    const data = parseFiles(read.files);
    const { warnings } = await check(data);
    const latest = await this.history.latest(slug);
    let version = latest?.version ?? 0;
    const same = latest && DATA_FILES.every((f) => latest.blobs[f] === sha(read.files[f]));
    if (!same) {
      const prev = latest ? parseFiles(await this.history.read(slug, latest.version)) : null;
      const diff = prev ? stripFields(diffModels(prev, data)) : { added: [], removed: [], updated: [], edgesAdded: 0, edgesRemoved: 0 };
      version = (await this.history.append(slug, { author: { kind: "file" }, summary: latest ? `ファイルが変わった: ${summaryText(diff)}` : "登録時の状態", files: read.files, diff })).version;
    }
    const state = { version, files: read.files, data, warnings, htmlCurrent: await pagesCurrent(dir, data, warnings) };
    this.states.set(slug, state);
    return state;
  }

  /** Runs one task per project at a time, in order. */
  private serial<T>(slug: string, task: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(slug) ?? Promise.resolve();
    const run = prev.then(task, task);
    this.queues.set(slug, run.catch(() => undefined));
    return run;
  }

  private emit(e: StoreEvent): void {
    for (const l of this.listeners) l(e);
  }
}

async function readFiles(dir: string): Promise<{ files: DataFiles } | { errors: string[] }> {
  const files = {} as DataFiles;
  const errors: string[] = [];
  if (!existsSync(join(dir, "data"))) return { errors: [`${dir} にモデルが見つかりません（data フォルダがありません）。`] };
  for (const f of DATA_FILES) {
    const p = join(dir, "data", `${f}.json`);
    try {
      files[f] = await readFile(p, "utf8");
      JSON.parse(files[f]);
    } catch (e) {
      errors.push(existsSync(p) ? `data/${f}.json: JSON として読めません: ${(e as Error).message}` : `data/${f}.json: ファイルがありません。`);
    }
  }
  return errors.length ? { errors } : { files };
}

function parseFiles(files: DataFiles): ModelData {
  const out = {} as Record<DataFile, unknown>;
  for (const f of DATA_FILES) out[f] = JSON.parse(files[f]);
  return out as ModelData;
}

async function check(data: ModelData): Promise<{ structural: string[]; warnings: string[] }> {
  const { validateModel, validateStructure } = await engine();
  const structural = validateStructure(data);
  const s = new Set(structural);
  return { structural, warnings: validateModel(data).filter((e) => !s.has(e)) };
}

async function pagesCurrent(dir: string, data: ModelData, warnings: string[]): Promise<boolean> {
  if (warnings.length) return false;
  const { renderModel } = await engine();
  const pages = await renderModel(data, { product: productName(data) });
  for (const [file, html] of Object.entries(pages)) {
    const p = join(dir, file);
    if (!existsSync(p) || (await readFile(p, "utf8")) !== html) return false;
  }
  return true;
}

function stripFields(d: ReturnType<typeof diffModels>): ChangeSummary {
  const { updatedFields: _, ...rest } = d;
  return rest;
}
