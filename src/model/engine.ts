// Typed access to the domain model engine in ../../model (plain JavaScript, shared with the CLI so
// the pages stay byte-identical to what `render` writes). The same relative path works from src/ and dist/.
export const DATA_FILES = ["big-picture", "domain-glossary", "workflow-models", "context-map"] as const;
export type DataFile = (typeof DATA_FILES)[number];
export const PAGE_FILES = ["index.html", "big-picture.html", "domain-glossary.html", "event-command-map.html", "workflow-models.html", "context-map.html"] as const;
export type PageFile = (typeof PAGE_FILES)[number];

export type Evidence = { path: string; symbol?: string; role?: string; note?: string };
export type NodeType = "actor" | "command" | "event" | "policy" | "readModel" | "aggregate" | "external" | "hotspot";
export type AttachPos = "above" | "below" | "above-left" | "above-right" | "below-left" | "below-right";
export type Node = {
  id: string; type: NodeType; domain: string; text: string;
  execution?: "sync" | "async" | "scheduled" | "external"; invariants?: string[];
  attach?: { to: string; pos: AttachPos }; changed?: boolean; note?: string; evidence?: Evidence[];
};
export type Edge = { from: string; to: string; kind: "flow" | "result" };
export type Domain = { id: string; name: string; note?: string };
export type Checked = { revision: string; date: string };
export type BigPicture = { schema: string; title: string; summary?: string; checked: Checked; product?: string; domains: Domain[]; nodes: Node[]; edges: Edge[] };
export type Term = { term: string; meaning: string; code?: string[]; nodes?: string[]; changed?: boolean; evidence?: Evidence[] };
export type Glossary = { schema: string; title: string; summary?: string; checked: Checked; terms: Term[] };
export type Transition = { from: string; on: string; to: string; guard?: string; effect?: string; changed?: boolean; evidence?: Evidence[] };
export type Rejection = { state: string; on: string; kind: "invalid" | "ignored"; reason: string; changed?: boolean };
export type Lifecycle = { id: string; name: string; domain?: string; summary?: string; states: { id: string; name: string; initial?: boolean; final?: boolean; changed?: boolean }[]; transitions: Transition[]; rejections: Rejection[] };
export type Workflows = { schema: string; title: string; summary?: string; checked: Checked; lifecycles: Lifecycle[] };
export type Context = { id: string; name: string; responsibility: string; owns: string[]; contract: string[]; tech?: string; guarantees?: string[]; domains?: string[]; changed?: boolean; evidence?: Evidence[] };
export type ContextMap = { schema: string; title: string; summary?: string; checked: Checked; contexts: Context[]; relations: { from: string; to: string; label: string; changed?: boolean }[] };
export type ModelData = { "big-picture": BigPicture; "domain-glossary": Glossary; "workflow-models": Workflows; "context-map": ContextMap };

type Out = { log: (s: string) => void; error: (s: string) => void };
type Engine = {
  run(argv: string[], out: Out): Promise<number>;
  readData(dir: string): { data: Partial<ModelData>; errors: string[] };
  checkEvidence(data: ModelData, repo: string): string[];
};
type Validate = { validateModel(data: unknown): string[]; validateStructure(data: unknown): string[] };
type Render = { renderModel(data: ModelData, opts: { product: string }): Promise<Record<PageFile, string>> };

const base = new URL("../../model/", import.meta.url);
let cache: Promise<Engine & Validate & Render> | null = null;
export function engine(): Promise<Engine & Validate & Render> {
  cache ??= Promise.all([
    import(new URL("domain-model.mjs", base).href) as Promise<Engine>,
    import(new URL("lib/validate.mjs", base).href) as Promise<Validate>,
    import(new URL("lib/render.mjs", base).href) as Promise<Render>,
  ]).then(([e, v, r]) => ({ ...e, ...v, ...r }));
  return cache;
}

export function productName(data: ModelData): string {
  return data["big-picture"].product || data["big-picture"].title;
}
