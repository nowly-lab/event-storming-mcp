import { stat } from "node:fs/promises";
import { join } from "node:path";
import { DATA_FILES } from "../model/engine.ts";
import type { ModelStore } from "./model-store.ts";
import { modelDirOf, type ProjectRegistry } from "./registry.ts";

/**
 * Watches a project's data files by polling their size and mtime (fs.watch misses renames and folder
 * swaps on macOS, which git checkouts and atomic saves cause). On a change it asks the store to
 * ingest the files; the store compares contents, so its own writes are not recorded twice.
 */
export function watchProject(store: ModelStore, registry: ProjectRegistry, slug: string, opts: { intervalMs?: number } = {}): { close(): void; ready: Promise<void> } {
  let last = "";
  let busy = false;
  let closed = false;
  const tick = async () => {
    if (busy || closed) return;
    busy = true;
    try {
      const p = await registry.get(slug);
      const dir = modelDirOf(p);
      const parts: string[] = [p.writeTarget];
      for (const f of DATA_FILES) {
        try {
          const s = await stat(join(dir, "data", `${f}.json`));
          parts.push(`${s.size}:${s.mtimeMs}`);
        } catch {
          parts.push("missing");
        }
      }
      const sig = parts.join("|");
      if (last && sig !== last) await store.ingest(slug);
      last = sig;
    } catch {
      // The project may have been removed; try again on the next tick.
    } finally {
      busy = false;
    }
  };
  const ready = tick();
  const timer = setInterval(tick, opts.intervalMs ?? 300);
  timer.unref();
  return { ready, close: () => { closed = true; clearInterval(timer); } };
}
