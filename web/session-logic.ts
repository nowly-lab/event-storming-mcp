import { authorLabel } from "./live.ts";
import type { SessionDiff } from "./types.ts";

type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void };
const KIND_LABEL = { added: "追加", updated: "変更", removed: "削除" } as const;

function read(s: Store, k: string): string | null {
  try {
    return s.getItem(k);
  } catch {
    return null;
  }
}
function write(s: Store, k: string, v: string): void {
  try {
    s.setItem(k, v);
  } catch {
    // Private windows and blocked storage: the base then lasts only as long as the page.
  }
}

/** The version this tab compares against: set the first time the project is opened here, kept across reloads. */
export function baseFor(s: Store, slug: string, latest: number): number {
  const raw = read(s, `esm-base:${slug}`);
  const v = raw === null ? NaN : Number(raw);
  if (Number.isInteger(v) && v > 0 && v <= latest) return v;
  write(s, `esm-base:${slug}`, String(latest));
  write(s, `esm-base-src:${slug}`, "opened");
  return latest;
}

/** Changes the base (「ここから比べ直す」 or the history's 「この版から比べる」). */
export function setBase(s: Store, slug: string, version: number): void {
  write(s, `esm-base:${slug}`, String(version));
  write(s, `esm-base-src:${slug}`, "picked");
}

/** The bar's text for the current base. */
export function baseText(s: Store, slug: string, base: number): string {
  return read(s, `esm-base-src:${slug}`) === "picked" ? `比べる基準：選んだ版（版 ${base}）` : `比べる基準：ボードを開いた時点（版 ${base}）`;
}

export function showChanges(s: Store): boolean {
  return read(s, "esm-show-changes") !== "0";
}

export function setShowChanges(s: Store, on: boolean): void {
  write(s, "esm-show-changes", on ? "1" : "0");
}

export type ChangeRow = { kind: "added" | "updated" | "removed"; label: string; text: string; who: string; jump: string | null };

/** The rows of 「このセッションの変更」: stickies (added, changed, removed), then arrows. A removed sticky cannot be jumped to. */
export function changeRows(d: SessionDiff, textOf: (id: string) => string): ChangeRow[] {
  const order = { added: 0, updated: 1, removed: 2 };
  const notes = [...d.changes].sort((a, b) => order[a.kind] - order[b.kind]).map((c) => ({
    kind: c.kind,
    label: KIND_LABEL[c.kind],
    text: c.text,
    who: [...new Set(c.authors.map(authorLabel))].join("・"),
    jump: c.kind === "removed" ? null : c.id,
  }));
  const arrow = (kind: "added" | "removed", e: { from: string; to: string }): ChangeRow => ({
    kind, label: KIND_LABEL[kind], text: `矢印 ${textOf(e.from)} → ${textOf(e.to)}`, who: "", jump: kind === "added" ? e.from : null,
  });
  return [...notes, ...d.edgesAdded.map((e) => arrow("added", e)), ...d.edgesRemoved.map((e) => arrow("removed", e))];
}
