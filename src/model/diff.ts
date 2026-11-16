import type { Edge, ModelData, Node } from "./engine.ts";
import type { ChangeSummary } from "../store/history.ts";

const FIELDS: (keyof Node)[] = ["text", "type", "domain", "execution", "invariants", "attach", "note", "evidence", "changed"];
const edgeKey = (e: Edge) => `${e.from}>${e.to}>${e.kind}`;

/** Which stickies were added, removed or changed between two versions, and which fields changed. */
export function diffModels(before: ModelData, after: ModelData): ChangeSummary & { updatedFields: Record<string, string[]> } {
  const a = new Map(before["big-picture"].nodes.map((n) => [n.id, n]));
  const b = new Map(after["big-picture"].nodes.map((n) => [n.id, n]));
  const updatedFields: Record<string, string[]> = {};
  for (const [id, n] of b) {
    const o = a.get(id);
    if (!o) continue;
    const changed = FIELDS.filter((f) => JSON.stringify(o[f]) !== JSON.stringify(n[f]));
    if (changed.length) updatedFields[id] = changed as string[];
  }
  const ea = new Set(before["big-picture"].edges.map(edgeKey));
  const eb = new Set(after["big-picture"].edges.map(edgeKey));
  return {
    added: [...b.keys()].filter((id) => !a.has(id)),
    removed: [...a.keys()].filter((id) => !b.has(id)),
    updated: Object.keys(updatedFields),
    edgesAdded: [...eb].filter((k) => !ea.has(k)).length,
    edgesRemoved: [...ea].filter((k) => !eb.has(k)).length,
    updatedFields,
  };
}

/** One line for the history list and the update toast, e.g. "付箋を2件追加、1件変更、矢印を1件追加". */
export function summaryText(s: ChangeSummary): string {
  const notes = [s.added.length && `${s.added.length}件追加`, s.updated.length && `${s.updated.length}件変更`, s.removed.length && `${s.removed.length}件削除`].filter(Boolean);
  const edges = [s.edgesAdded && `${s.edgesAdded}件追加`, s.edgesRemoved && `${s.edgesRemoved}件削除`].filter(Boolean);
  const parts = [notes.length && `付箋を${notes.join("、")}`, edges.length && `矢印を${edges.join("、")}`].filter(Boolean);
  return parts.length ? parts.join("、") : "変更なし";
}
