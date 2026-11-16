import type { Author, ChangeSummary } from "./types.ts";

export function authorLabel(a: Author): string {
  if (a.kind === "person") return "人";
  if (a.kind === "file") return "ファイル";
  if (/claude/i.test(a.name)) return "Claude";
  if (/codex/i.test(a.name)) return "Codex";
  return a.name;
}

export function changeCount(s: ChangeSummary): number {
  return s.added.length + s.updated.length + s.removed.length + s.edgesAdded + s.edgesRemoved;
}

/** The toast after a redraw, e.g. "自動更新: Claude が 3 件変更". */
export function toastText(a: Author, s: ChangeSummary): string {
  const n = changeCount(s);
  return n ? `自動更新: ${authorLabel(a)} が ${n} 件変更` : `自動更新: ${authorLabel(a)} が変更`;
}

export type Viewport = { zoom: number; scrollLeft: number; scrollTop: number; width: number; height: number };
/** Keeps the zoom and the content point at the centre when the board is redrawn. */
export function keepViewport(prev: Viewport, next: Viewport): Viewport {
  const cx = (prev.scrollLeft + prev.width / 2) / prev.zoom;
  const cy = (prev.scrollTop + prev.height / 2) / prev.zoom;
  return { zoom: prev.zoom, width: next.width, height: next.height, scrollLeft: Math.max(0, cx * prev.zoom - next.width / 2), scrollTop: Math.max(0, cy * prev.zoom - next.height / 2) };
}

/** Sticky ids that rule warnings point at, from "nodes[i]" paths and quoted ids. */
export function warningNodeIds(warnings: string[], nodeIds: string[]): Set<string> {
  const out = new Set<string>();
  const known = new Set(nodeIds);
  for (const w of warnings) {
    if (!w.startsWith("data/big-picture.json")) continue;
    const m = /nodes\[(\d+)\]/.exec(w);
    if (m && nodeIds[Number(m[1])]) out.add(nodeIds[Number(m[1])]);
    for (const q of w.matchAll(/"([a-z][a-z0-9-]*)"/g)) if (known.has(q[1])) out.add(q[1]);
  }
  return out;
}

export type LiveStatus = "connecting" | "live" | "retrying";
/** Opens the project's event stream; the browser's EventSource retries by itself. */
export function connectLive(slug: string, on: { version(e: { version: number; author: Author; summary: ChangeSummary; warnings: string[] }): void; fileError(errors: string[]): void; status(s: LiveStatus): void }): { close(): void } {
  const es = new EventSource(`/api/projects/${encodeURIComponent(slug)}/events`);
  on.status("connecting");
  es.addEventListener("hello", () => on.status("live"));
  es.addEventListener("version", (m) => on.version(JSON.parse((m as MessageEvent).data)));
  es.addEventListener("file-error", (m) => on.fileError(JSON.parse((m as MessageEvent).data).errors));
  es.onerror = () => on.status("retrying");
  return { close: () => es.close() };
}
