import type { Edge, ModelData, NodeType } from "./engine.ts";
import type { Author, VersionEntry } from "../store/history.ts";
import { diffModels } from "./diff.ts";

export type SessionChange = { kind: "added" | "updated" | "removed"; id: string; type: NodeType; text: string; domain: string; authors: Author[]; fields?: string[] };
export type SessionDiff = { from: number; to: number; changes: SessionChange[]; edgesAdded: Edge[]; edgesRemoved: Edge[] };

const edgeKey = (e: Edge) => `${e.from}>${e.to}>${e.kind}`;
const authorKey = (a: Author) => (a.kind === "agent" ? `agent:${a.name}` : a.kind);

/**
 * What changed between the base version (`before`, version `from`) and now (`after`, version `to`): the net change
 * only, so a sticky added and removed in between is not listed. `entries` are the versions after `from` up to `to`;
 * each change names everyone whose version touched that sticky, oldest first.
 */
export function sessionDiff(before: ModelData, after: ModelData, entries: VersionEntry[], from: number, to: number): SessionDiff {
  const d = diffModels(before, after);
  const authorsOf = (id: string) => {
    const seen = new Map<string, Author>();
    for (const e of [...entries].sort((a, b) => a.version - b.version)) {
      if ([e.diff.added, e.diff.updated, e.diff.removed].some((l) => l.includes(id)) && !seen.has(authorKey(e.author))) seen.set(authorKey(e.author), e.author);
    }
    return [...seen.values()];
  };
  const nodes = (m: ModelData) => new Map(m["big-picture"].nodes.map((n) => [n.id, n]));
  const a = nodes(before), b = nodes(after);
  const change = (kind: SessionChange["kind"], id: string): SessionChange => {
    const n = (kind === "removed" ? a : b).get(id)!;
    return { kind, id, type: n.type, text: n.text, domain: n.domain, authors: authorsOf(id), ...(kind === "updated" ? { fields: d.updatedFields[id] } : {}) };
  };
  const ea = new Set(before["big-picture"].edges.map(edgeKey));
  const eb = new Set(after["big-picture"].edges.map(edgeKey));
  return {
    from,
    to,
    changes: [...d.added.map((id) => change("added", id)), ...d.updated.map((id) => change("updated", id)), ...d.removed.map((id) => change("removed", id))],
    edgesAdded: after["big-picture"].edges.filter((e) => !ea.has(edgeKey(e))),
    edgesRemoved: before["big-picture"].edges.filter((e) => !eb.has(edgeKey(e))),
  };
}
