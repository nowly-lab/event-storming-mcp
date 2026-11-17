// Shapes shared with the server (kept structural so the page bundle does not import server code).
export type Author = { kind: "agent"; name: string } | { kind: "person" } | { kind: "file" };
export type ChangeSummary = { added: string[]; removed: string[]; updated: string[]; edgesAdded: number; edgesRemoved: number };
export type NodeType = "actor" | "command" | "event" | "policy" | "readModel" | "aggregate" | "external" | "hotspot";
export type Node = { id: string; type: NodeType; domain: string; text: string; attach?: { to: string; pos: string } };
export type Edge = { from: string; to: string; kind: "flow" | "result" };
export type Model = { "big-picture": { domains: { id: string; name: string }[]; nodes: Node[]; edges: Edge[] } } & Record<string, unknown>;
export type Op =
  | { op: "addNode"; node: { type: NodeType; text: string; domain?: string; execution?: "sync" | "async" | "scheduled" | "external" }; after?: string }
  | { op: "updateNode"; id: string; patch: { text: string } }
  | { op: "removeNode"; id: string }
  | { op: "addEdge"; from: string; to: string; kind: "flow" | "result" }
  | { op: "removeEdge"; from: string; to: string; kind?: "flow" | "result" };
export type ApplyResult =
  | { ok: true; version: number; warnings: string[]; htmlWritten: boolean; summary: ChangeSummary }
  | { ok: false; reason: "conflict"; current: { version: number } }
  | { ok: false; reason: "invalid"; errors: string[] };
export type Removal = { node: string; edges: Edge[]; attached: string[]; glossaryRefs: { term: string }[]; transitions: { lifecycle: string; from: string; on: string; to: string }[]; rejections: { lifecycle: string; state: string; on: string }[] };
export type VersionEntry = { version: number; at: string; author: Author; summary: string; diff: ChangeSummary };
export type Project = { slug: string; name: string; modelPath: string; checkouts: { root: string }[]; writeTarget: string; version: number | null };
export type SessionChange = { kind: "added" | "updated" | "removed"; id: string; type: NodeType; text: string; domain: string; authors: Author[]; fields?: string[] };
export type SessionDiff = { from: number; to: number; changes: SessionChange[]; edgesAdded: Edge[]; edgesRemoved: Edge[] };
