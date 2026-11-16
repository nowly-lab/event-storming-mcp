import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { z } from "zod";
import { engine, PAGE_FILES, productName, type ModelData, type PageFile } from "../model/engine.ts";
import { OpSchema, previewRemoveNode } from "../model/ops.ts";
import type { HistoryStore } from "../store/history.ts";
import type { ModelStore, StoreEvent } from "../store/model-store.ts";
import type { ProjectRegistry } from "../store/registry.ts";
import { VERSION } from "../version.ts";

export type ServerDeps = {
  store: ModelStore;
  registry: ProjectRegistry;
  history: HistoryStore;
  webRoot: string;
  port?: number;
  watchIntervalMs?: number;
  /** How often to look for projects registered outside the server (the CLI's add). */
  registryScanMs?: number;
  /** Handles /mcp (Streamable HTTP); attached by the MCP module. */
  mcp?: (req: IncomingMessage, res: ServerResponse, body: unknown) => Promise<void>;
};
export type RunningServer = { url: string; port: number; close(): Promise<void> };

const MAX_BODY = 5_000_000;
const HEARTBEAT_MS = 15_000;
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

const ChangesBody = z.object({ nonce: z.string(), baseVersion: z.number().int(), ops: z.array(OpSchema) });
const NonceBody = z.object({ nonce: z.string() });
const RemoveBody = NonceBody.extend({ id: z.string() });
const RestoreBody = NonceBody.extend({ version: z.number().int().positive(), baseVersion: z.number().int() });
const TargetBody = NonceBody.extend({ checkoutRoot: z.string() });
const RegisterBody = NonceBody.extend({ modelDir: z.string() });

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** The one local server: page, page API, live events and /mcp, bound to 127.0.0.1. */
export async function startServer(deps: ServerDeps): Promise<RunningServer> {
  const { store, registry, history } = deps;
  const webRoot = resolve(deps.webRoot);
  const nonce = randomBytes(24).toString("hex");
  const streams = new Map<string, Set<ServerResponse>>();
  store.startWatching(deps.watchIntervalMs ?? 300);
  const scan = async () => {
    for (const p of await registry.list().catch(() => [])) if (!store.watching(p.slug)) await store.read(p.slug).catch(() => undefined);
  };
  await scan();
  const scanTimer = setInterval(scan, deps.registryScanMs ?? 2000);
  scanTimer.unref();

  const off = store.on((e: StoreEvent) => {
    const name = e.type;
    const { slug, ...payload } = e;
    for (const res of streams.get(slug) ?? []) res.write(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`);
  });

  let port = 0;
  const hostOk = (h: string | undefined) => h === `127.0.0.1:${port}` || h === `localhost:${port}`;

  const server = createServer(async (req, res) => {
    try {
      if (!hostOk(req.headers.host)) throw new HttpError(403, "Host が違います。");
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
      if (url.pathname === "/mcp") {
        if (req.headers.origin) throw new HttpError(403, "/mcp はブラウザからは使えません。");
        if (!deps.mcp) throw new HttpError(404, "MCP は有効ではありません。");
        const body = req.method === "POST" ? await readJson(req) : undefined;
        return await deps.mcp(req, res, body);
      }
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        const html = await readFile(join(webRoot, "index.html"), "utf8");
        return send(res, 200, html.replaceAll("__NONCE__", nonce), TYPES[".html"]);
      }
      if (parts[0] !== "api") {
        if (req.method !== "GET") throw new HttpError(405, "使えない方法です。");
        return await serveStatic(webRoot, url.pathname, res);
      }
      if (req.method === "POST") {
        const body = await readJson(req);
        if (NonceBody.safeParse(body).data?.nonce !== nonce) throw new HttpError(403, "画面を開き直してください（nonce が違います）。");
        return json(res, 200, await post(parts, body));
      }
      if (req.method !== "GET") throw new HttpError(405, "使えない方法です。");
      if (parts[1] === "health") return json(res, 200, { ok: true, version: VERSION, pid: process.pid });
      if (parts[1] === "projects" && parts.length === 2) return json(res, 200, await listProjects());
      if (parts[1] === "projects" && parts.length >= 4) {
        const slug = (await registry.get(parts[2])).slug;
        switch (parts[3]) {
          case "model":
            return json(res, 200, await store.read(slug));
          case "history":
            return json(res, 200, await history.list(slug, { limit: Number(url.searchParams.get("limit")) || undefined }));
          case "events":
            return openStream(slug, req, res);
          case "pages": {
            const page = parts[4] as PageFile;
            if (!PAGE_FILES.includes(page)) throw new HttpError(404, "そのページはありません。");
            const v = url.searchParams.get("version");
            const data = v ? parse(await history.read(slug, Number(v))) : (await store.read(slug)).data;
            return send(res, 200, await renderPage(data, page), TYPES[".html"]);
          }
        }
      }
      throw new HttpError(404, "見つかりません。");
    } catch (e) {
      if (res.headersSent) return void res.end();
      const status = e instanceof HttpError ? e.status : e instanceof z.ZodError ? 400 : /登録されていません|ありません/.test((e as Error).message) ? 404 : 500;
      json(res, status, { error: e instanceof z.ZodError ? z.prettifyError(e) : (e as Error).message });
    }
  });

  async function post(parts: string[], body: unknown): Promise<unknown> {
    if (parts[1] === "projects" && parts.length === 2) {
      const p = await registry.register(RegisterBody.parse(body).modelDir);
      await store.read(p.slug);
      return p;
    }
    const slug = (await registry.get(parts[2] ?? "")).slug;
    switch (parts[3]) {
      case "changes": {
        const b = ChangesBody.parse(body);
        return store.apply(slug, { baseVersion: b.baseVersion, ops: b.ops, author: { kind: "person" } });
      }
      case "preview-remove":
        return previewRemoveNode((await store.read(slug)).data, RemoveBody.parse(body).id);
      case "restore":
      {
        const b = RestoreBody.parse(body);
        return store.restore(slug, b.version, { kind: "person" }, b.baseVersion);
      }
      case "write-target": {
        const p = await registry.setWriteTarget(slug, TargetBody.parse(body).checkoutRoot);
        await store.ingest(slug);
        return p;
      }
    }
    throw new HttpError(404, "見つかりません。");
  }

  async function listProjects() {
    const out = [];
    for (const p of await registry.list()) {
      const latest = await history.latest(p.slug);
      out.push({ ...p, version: latest?.version ?? null });
    }
    return out;
  }

  function openStream(slug: string, req: IncomingMessage, res: ServerResponse) {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    res.write(`event: hello\ndata: {}\n\n`);
    const set = streams.get(slug) ?? streams.set(slug, new Set()).get(slug)!;
    set.add(res);
    const beat = setInterval(() => res.write(`: beat\n\n`), HEARTBEAT_MS);
    req.on("close", () => {
      clearInterval(beat);
      set.delete(res);
    });
  }

  await new Promise<void>((r) => server.listen(deps.port ?? 0, "127.0.0.1", r));
  port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    close: async () => {
      off();
      clearInterval(scanTimer);
      store.stopWatching();
      for (const set of streams.values()) for (const r of set) r.end();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

/** Renders one page. A draft that the renderer cannot draw shows its problems instead of failing. */
export async function renderPage(data: ModelData, page: PageFile): Promise<string> {
  const { renderModel, validateModel } = await engine();
  try {
    return (await renderModel(data, { product: productName(data) }))[page];
  } catch (e) {
    const items = validateModel(data).map((x) => `<li>${esc(x)}</li>`).join("");
    return `<!doctype html><meta charset="utf-8"><main id="main" class="draw-error"><h1>この版は描けません</h1><p>${esc((e as Error).message)}</p><ul>${items}</ul></main>`;
  }
}

function parse(files: Record<string, string>): ModelData {
  return Object.fromEntries(Object.entries(files).map(([k, v]) => [k, JSON.parse(v)])) as ModelData;
}

async function serveStatic(root: string, path: string, res: ServerResponse) {
  const file = normalize(join(root, path));
  if (!file.startsWith(root + sep) || !existsSync(file)) throw new HttpError(404, "見つかりません。");
  send(res, 200, await readFile(file), TYPES[extname(file)] ?? "application/octet-stream");
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "送られた内容が大きすぎます。");
    chunks.push(c as Buffer);
  }
  if (!chunks.length) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "JSON として読めません。");
  }
}

function send(res: ServerResponse, status: number, body: string | Buffer, type: string) {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(body);
}
function json(res: ServerResponse, status: number, v: unknown) {
  send(res, status, JSON.stringify(v), "application/json; charset=utf-8");
}
function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
