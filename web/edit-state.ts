import type { Model, NodeType, Op } from "./types.ts";

export type EditMode = "idle" | "text" | "saving" | "conflict";
export type EditState = { mode: EditMode; pending: number[]; draft?: { id: string; text: string; original: string } };
export type EditEvent =
  | { type: "startText"; id: string; text: string }
  | { type: "typing"; text: string }
  | { type: "commitText" }
  | { type: "cancel" }
  | { type: "busy" }
  | { type: "idle" }
  | { type: "saved" }
  | { type: "conflict" }
  | { type: "reloadLatest" }
  | { type: "remoteVersion"; version: number };
export type Effect = { type: "save"; ops: Op[] } | { type: "reload"; reason: "remote" | "pending" | "conflict" } | { type: "error"; message: string };

export const initialEdit = (): EditState => ({ mode: "idle", pending: [] });

/**
 * The inline editor's state. While the person types (or drags an arrow: "busy"), redraws from others
 * wait in `pending`; they apply once the edit ends. A conflict keeps the draft text.
 */
export function reduce(s: EditState, e: EditEvent): { state: EditState; effects: Effect[] } {
  switch (e.type) {
    case "startText":
      return { state: { ...s, mode: "text", draft: { id: e.id, text: e.text, original: e.text } }, effects: [] };
    case "typing":
      return s.draft ? { state: { ...s, draft: { ...s.draft, text: e.text } }, effects: [] } : { state: s, effects: [] };
    case "commitText": {
      // Only from the open editor: Enter and the blur that follows it must not save twice.
      if (!s.draft || s.mode !== "text") return { state: s, effects: [] };
      const text = s.draft.text.replace(/\s*\n\s*/g, " ").trim();
      if (!text) return { state: s, effects: [{ type: "error", message: "付箋の文字を空にはできません。消すときはツールバーの「削除」を使ってください。" }] };
      if (text === s.draft.original) return finish({ ...s, draft: undefined });
      return { state: { ...s, mode: "saving", draft: { ...s.draft, text } }, effects: [{ type: "save", ops: [{ op: "updateNode", id: s.draft.id, patch: { text } }] }] };
    }
    case "cancel":
      return finish({ ...s, draft: undefined });
    case "busy":
      return { state: { ...s, mode: "saving" }, effects: [] };
    case "idle":
    case "saved":
      return finish({ ...s, draft: undefined });
    case "conflict":
      return { state: { ...s, mode: "conflict", pending: [] }, effects: [] };
    case "reloadLatest":
      return { state: { ...s, mode: s.draft ? "text" : "idle", pending: [] }, effects: [{ type: "reload", reason: "conflict" }] };
    case "remoteVersion":
      if (s.mode === "idle") return { state: s, effects: [{ type: "reload", reason: "remote" }] };
      return { state: { ...s, pending: [...s.pending, e.version] }, effects: [] };
  }
}

function finish(s: EditState): { state: EditState; effects: Effect[] } {
  const effects: Effect[] = s.pending.length ? [{ type: "reload", reason: "pending" }] : [];
  return { state: { mode: "idle", pending: [] }, effects };
}

export function edgeKindFor(from: NodeType, to: NodeType): "flow" | "result" {
  return from === "event" && to === "readModel" ? "result" : "flow";
}

/** How far to scroll so the edited sticky stays at the same place on screen after the board is laid out again. */
export function anchorShift(before: { x: number; y: number }, after: { x: number; y: number }, zoom: number): { dx: number; dy: number } {
  return { dx: (after.x - before.x) * zoom, dy: (after.y - before.y) * zoom };
}

/** True when the ops still apply as meant: the stickies exist and an edited text was not changed by someone else. */
export function canRebase(ops: Op[], latest: Model, original?: string): boolean {
  const nodes = new Map(latest["big-picture"].nodes.map((n) => [n.id, n]));
  return ops.every((o) => {
    if (o.op === "updateNode") return nodes.get(o.id)?.text === original;
    if (o.op === "addEdge" || o.op === "removeEdge") return nodes.has(o.from) && nodes.has(o.to);
    if (o.op === "removeNode") return false;
    return o.op === "addNode" && (!o.after || nodes.has(o.after));
  });
}

