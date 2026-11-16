import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DATA_FILES, type ModelData } from "../model/engine.ts";
import { OpSchema } from "../model/ops.ts";
import type { Author, HistoryStore } from "../store/history.ts";
import type { ModelStore } from "../store/model-store.ts";
import type { ProjectRegistry } from "../store/registry.ts";
import { engine } from "../model/engine.ts";

export type ToolDeps = { store: ModelStore; registry: ProjectRegistry; history: HistoryStore; baseUrl: () => string; openBrowser?: (url: string) => void };

const ok = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });
const fail = (msg: string) => ({ content: [{ type: "text" as const, text: msg }], isError: true });
const project = z.string().describe("Project slug or name from list_projects");
const PAGES = ["index.html", "big-picture.html", "domain-glossary.html", "event-command-map.html", "workflow-models.html", "context-map.html"] as const;

/** Registers the ten tools. `author` names who made a change (the MCP client's name). */
export function registerTools(server: McpServer, deps: ToolDeps, author: () => Author): void {
  const { store, registry, history } = deps;
  const slugOf = async (p: string) => (await registry.get(p)).slug;
  const guard = <A,>(fn: (a: A) => Promise<ReturnType<typeof ok>>) => async (a: A) => {
    try {
      return await fn(a);
    } catch (e) {
      return fail((e as Error).message);
    }
  };

  server.registerTool("list_projects", {
    description: "List registered domain model projects (a repository's model folder) with their latest version and how many modeling-rule warnings they have.",
    inputSchema: {},
  }, guard(async () => {
    const out = [];
    for (const p of await registry.list()) {
      const r = await store.read(p.slug).catch(() => null);
      out.push({ slug: p.slug, name: p.name, modelPath: p.modelPath, writeTarget: p.writeTarget, checkouts: p.checkouts.map((c) => c.root), version: r?.version ?? null, warnings: r?.warnings.length ?? null });
    }
    return ok(out);
  }));

  server.registerTool("register_project", {
    description: "Register a scrum-domain-modeling model folder (the folder that holds data/big-picture.json). Several checkouts of one repository become one project; the latest registered checkout receives writes.",
    inputSchema: { model_dir: z.string().describe("Absolute path of the model folder") },
  }, guard(async ({ model_dir }) => ok(await registry.register(model_dir))));

  server.registerTool("get_model", {
    description: "Read a project's model data and its version. Pass that version as base_version to apply_changes. Optionally one file only.",
    inputSchema: { project, file: z.enum(DATA_FILES).optional() },
  }, guard(async ({ project: p, file }) => {
    const r = await store.read(await slugOf(p));
    return ok({ version: r.version, warnings: r.warnings, htmlCurrent: r.htmlCurrent, data: file ? r.data[file] : r.data });
  }));

  server.registerTool("find_nodes", {
    description: "Find stickies on the big picture by text (substring), type or domain, with their incoming and outgoing arrows.",
    inputSchema: { project, text: z.string().optional(), type: z.string().optional(), domain: z.string().optional() },
  }, guard(async ({ project: p, text, type, domain }) => {
    const { data, version } = await store.read(await slugOf(p));
    const bp = data["big-picture"];
    const hits = bp.nodes.filter((n) => (!text || n.text.includes(text)) && (!type || n.type === type) && (!domain || n.domain === domain));
    return ok({ version, nodes: hits.map((n) => ({ ...n, in: bp.edges.filter((e) => e.to === n.id), out: bp.edges.filter((e) => e.from === n.id) })) });
  }));

  server.registerTool("apply_changes", {
    description: "Apply edits to a project's model, based on the version you read. Ops: addNode (after: link from a sticky; domain defaults to it), updateNode, removeNode (also removes its arrows, attached notes, glossary references and transitions that use it), addEdge, removeEdge, upsertDomain, replaceFile (domain-glossary, workflow-models or context-map). Structural errors are refused; modeling-rule violations are saved with warnings and the committed HTML waits until the model validates. A stale base_version returns conflict: read again with get_model and redo the change. Every open board redraws at once.",
    inputSchema: { project, base_version: z.number().int(), ops: z.array(OpSchema).min(1) },
  }, guard(async ({ project: p, base_version, ops }) => {
    const r = await store.apply(await slugOf(p), { baseVersion: base_version, ops, author: author() });
    if (!r.ok && r.reason === "conflict") return fail(`conflict: 版 ${base_version} は最新ではありません（最新は版 ${r.current.version}）。get_model で読み直してから、もう一度変更してください。`);
    if (!r.ok) return fail(`invalid: ${r.errors.join("\n")}`);
    return ok(r);
  }));

  server.registerTool("validate", {
    description: "Validate a project's current model: structural errors (never saved) and modeling-rule warnings (allowed while drafting).",
    inputSchema: { project },
  }, guard(async ({ project: p }) => {
    const { data } = await store.read(await slugOf(p));
    const { validateModel, validateStructure } = await engine();
    const structural = validateStructure(data);
    return ok({ structural, rules: validateModel(data).filter((e) => !structural.includes(e)) });
  }));

  server.registerTool("list_history", {
    description: "List a project's versions, newest first: who changed it (person, agent name or file), when, and a summary.",
    inputSchema: { project, limit: z.number().int().positive().optional() },
  }, guard(async ({ project: p, limit }) => ok(await history.list(await slugOf(p), { limit }))));

  server.registerTool("get_version", {
    description: "Read the model data of a past version.",
    inputSchema: { project, version: z.number().int().positive() },
  }, guard(async ({ project: p, version }) => {
    const files = await history.read(await slugOf(p), version);
    return ok({ version, data: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, JSON.parse(v)])) as ModelData });
  }));

  server.registerTool("restore_version", {
    description: "Restore a past version. The restore is recorded as a new version.",
    inputSchema: { project, version: z.number().int().positive() },
  }, guard(async ({ project: p, version }) => {
    const r = await store.restore(await slugOf(p), version, author());
    return r.ok ? ok(r) : fail(r.reason === "invalid" ? `invalid: ${r.errors.join("\n")}` : "conflict");
  }));

  server.registerTool("open_page", {
    description: "Get the URL of a project's live board (optionally a page), and open it in the browser when open_browser is true.",
    inputSchema: { project, page: z.enum(PAGES).optional(), open_browser: z.boolean().optional() },
  }, guard(async ({ project: p, page, open_browser }) => {
    const slug = await slugOf(p);
    const url = `${deps.baseUrl()}/#/${encodeURIComponent(slug)}/${page ?? "big-picture.html"}`;
    if (open_browser) deps.openBrowser?.(url);
    return ok({ url });
  }));
}
