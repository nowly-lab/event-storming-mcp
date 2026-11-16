import { z } from "zod";
import type { Edge, ModelData, Node, NodeType } from "./engine.ts";
import type { ChangeSummary } from "../store/history.ts";
import { diffModels } from "./diff.ts";

const NODE_TYPES = ["actor", "command", "event", "policy", "readModel", "aggregate", "external", "hotspot"] as const;
const EvidenceSchema = z.object({ path: z.string(), symbol: z.string().optional(), role: z.string().optional(), note: z.string().optional() });
const NodeFields = {
  type: z.enum(NODE_TYPES),
  domain: z.string().optional(),
  text: z.string().min(1),
  execution: z.enum(["sync", "async", "scheduled", "external"]).optional(),
  invariants: z.array(z.string()).optional(),
  attach: z.object({ to: z.string(), pos: z.enum(["above", "below", "above-left", "above-right", "below-left", "below-right"]) }).optional(),
  note: z.string().optional(),
  evidence: z.array(EvidenceSchema).optional(),
};

/** One edit to the model. The MCP tool and the page send lists of these; both are parsed with this schema. */
export const OpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("addNode"), node: z.object({ id: z.string().optional(), ...NodeFields }), after: z.string().optional() }),
  z.object({ op: z.literal("updateNode"), id: z.string(), patch: z.object(NodeFields).partial() }),
  z.object({ op: z.literal("removeNode"), id: z.string() }),
  z.object({ op: z.literal("addEdge"), from: z.string(), to: z.string(), kind: z.enum(["flow", "result"]) }),
  z.object({ op: z.literal("removeEdge"), from: z.string(), to: z.string(), kind: z.enum(["flow", "result"]).optional() }),
  z.object({ op: z.literal("upsertDomain"), domain: z.object({ id: z.string(), name: z.string(), note: z.string().optional() }) }),
  z.object({ op: z.literal("replaceFile"), file: z.enum(["domain-glossary", "workflow-models", "context-map"]), content: z.unknown() }),
]);
export type Op = z.infer<typeof OpSchema>;

/** Everything removeNode takes with the sticky; the page shows it before the person confirms. */
export type Removal = {
  node: string;
  edges: Edge[];
  attached: string[];
  glossaryRefs: { term: string }[];
  transitions: { lifecycle: string; from: string; on: string; to: string }[];
  rejections: { lifecycle: string; state: string; on: string }[];
};

/** A user-facing refusal of an op (unknown id, missing domain); the store returns it as `invalid`. */
export class OpError extends Error {}

export function previewRemoveNode(data: ModelData, id: string): Removal {
  const bp = data["big-picture"];
  if (!bp.nodes.some((n) => n.id === id)) throw new OpError(`"${id}" という付箋はありません。`);
  const attached = bp.nodes.filter((n) => n.attach?.to === id).map((n) => n.id);
  const gone = new Set([id, ...attached]);
  return {
    node: id,
    edges: bp.edges.filter((e) => gone.has(e.from) || gone.has(e.to)),
    attached,
    glossaryRefs: data["domain-glossary"].terms.filter((t) => t.nodes?.some((n) => gone.has(n))).map((t) => ({ term: t.term })),
    transitions: data["workflow-models"].lifecycles.flatMap((l) => l.transitions.filter((t) => gone.has(t.on)).map((t) => ({ lifecycle: l.id, from: t.from, on: t.on, to: t.to }))),
    rejections: data["workflow-models"].lifecycles.flatMap((l) => (l.rejections ?? []).filter((r) => gone.has(r.on)).map((r) => ({ lifecycle: l.id, state: r.state, on: r.on }))),
  };
}

export function newNodeId(data: ModelData, type: NodeType, random: () => number = Math.random): string {
  const taken = new Set(data["big-picture"].nodes.map((n) => n.id));
  const prefix = type.toLowerCase().replace(/[^a-z]/g, "");
  for (let i = 0; ; i++) {
    const r = Math.floor(random() * 0x10000) + i;
    const id = `${prefix}-${(r % 0x10000).toString(16).padStart(4, "0")}`;
    if (!taken.has(id)) return id;
  }
}

/** Applies ops to a copy of the data. Throws OpError for an op that cannot apply at all. */
export function applyOps(input: ModelData, ops: Op[]): { data: ModelData; summary: ChangeSummary; removed: Removal[] } {
  const data = structuredClone(input);
  const bp = data["big-picture"];
  const removed: Removal[] = [];
  const node = (id: string) => {
    const n = bp.nodes.find((x) => x.id === id);
    if (!n) throw new OpError(`"${id}" という付箋はありません。find_nodes か get_model で id を確かめてください。`);
    return n;
  };
  for (const op of ops) {
    switch (op.op) {
      case "addNode": {
        const after = op.after ? node(op.after) : null;
        const domain = op.node.domain ?? after?.domain;
        if (!domain) throw new OpError("新しい付箋のドメインがありません。node.domain を書くか、after でつなぐ付箋を指定してください。");
        const id = op.node.id ?? newNodeId(data, op.node.type);
        if (bp.nodes.some((n) => n.id === id)) throw new OpError(`付箋 id "${id}" はもう使われています。`);
        const n: Node = { ...stripUndefined({ ...op.node, id, domain }) } as Node;
        bp.nodes.push(n);
        if (after) bp.edges.push({ from: after.id, to: id, kind: after.type === "event" && n.type === "readModel" ? "result" : "flow" });
        break;
      }
      case "updateNode": {
        const n = node(op.id);
        Object.assign(n, stripUndefined(op.patch));
        break;
      }
      case "removeNode": {
        const r = previewRemoveNode(data, op.id);
        const gone = new Set([r.node, ...r.attached]);
        bp.nodes = bp.nodes.filter((n) => !gone.has(n.id));
        bp.edges = bp.edges.filter((e) => !gone.has(e.from) && !gone.has(e.to));
        for (const t of data["domain-glossary"].terms) if (t.nodes) t.nodes = t.nodes.filter((x) => !gone.has(x));
        for (const t of data["domain-glossary"].terms) if (t.nodes?.length === 0) delete t.nodes;
        for (const l of data["workflow-models"].lifecycles) {
          l.transitions = l.transitions.filter((t) => !gone.has(t.on));
          if (l.rejections) l.rejections = l.rejections.filter((x) => !gone.has(x.on));
        }
        removed.push(r);
        break;
      }
      case "addEdge":
        bp.edges.push({ from: op.from, to: op.to, kind: op.kind });
        break;
      case "removeEdge": {
        const before = bp.edges.length;
        bp.edges = bp.edges.filter((e) => !(e.from === op.from && e.to === op.to && (!op.kind || e.kind === op.kind)));
        if (bp.edges.length === before) throw new OpError(`${op.from} → ${op.to} の矢印はありません。`);
        break;
      }
      case "upsertDomain": {
        const d = bp.domains.find((x) => x.id === op.domain.id);
        if (d) Object.assign(d, stripUndefined(op.domain));
        else bp.domains.push(stripUndefined(op.domain) as typeof op.domain);
        break;
      }
      case "replaceFile":
        (data as Record<string, unknown>)[op.file] = structuredClone(op.content);
        break;
    }
  }
  const { updatedFields: _, ...summary } = diffModels(input, data);
  return { data, summary, removed };
}

function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}
