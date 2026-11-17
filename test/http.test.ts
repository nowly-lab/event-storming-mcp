import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { startServer } from "../src/server/http.ts";
import { ModelStore } from "../src/store/model-store.ts";
import { ProjectRegistry } from "../src/store/registry.ts";
import { HistoryStore } from "../src/store/history.ts";
import { main } from "../src/cli.ts";
import { sampleRepo, tmp } from "./helpers.ts";

const quiet = { out: () => {}, err: () => {} };

async function setup() {
  const t = tmp();
  const { modelDir } = sampleRepo(t.dir);
  await main(["render", modelDir], quiet);
  const dataDir = join(t.dir, "data");
  const registry = new ProjectRegistry(dataDir);
  const history = new HistoryStore(dataDir);
  const store = new ModelStore({ registry, history });
  const webRoot = join(t.dir, "web");
  const { mkdirSync, writeFileSync } = await import("node:fs");
  mkdirSync(webRoot);
  writeFileSync(join(webRoot, "index.html"), '<html><head><meta name="esm-nonce" content="__NONCE__"></head><body></body></html>');
  const server = await startServer({ store, registry, history, webRoot, port: 0, watchIntervalMs: 50 });
  const p = await registry.register(modelDir);
  return { t, modelDir, server, slug: p.slug, store, done: async () => { await server.close(); t.done(); } };
}

type Res = { status: number; body: string; headers: Record<string, string | string[] | undefined> };
function call(url: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: opts.method ?? "GET", headers: { "content-type": "application/json", ...opts.headers } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode!, body, headers: res.headers }));
    });
    req.on("error", reject);
    if (opts.body !== undefined) req.write(JSON.stringify(opts.body));
    req.end();
  });
}
async function nonceOf(url: string) {
  const r = await call(url);
  return /content="([^"]+)"/.exec(r.body)![1];
}

test("binds 127.0.0.1 only", async () => {
  const s = await setup();
  try {
    assert.match(s.server.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal((await call(`${s.server.url}/api/health`)).status, 200);
  } finally {
    await s.done();
  }
});

test("wrong Host is 403", async () => {
  const s = await setup();
  try {
    assert.equal((await call(`${s.server.url}/api/health`, { headers: { host: "evil.example.com" } })).status, 403);
  } finally {
    await s.done();
  }
});

test("POST without nonce is 403", async () => {
  const s = await setup();
  try {
    const r = await call(`${s.server.url}/api/projects/${s.slug}/changes`, { method: "POST", body: { baseVersion: 1, ops: [] } });
    assert.equal(r.status, 403);
    const nonce = await nonceOf(s.server.url);
    assert.notEqual(nonce, "__NONCE__");
    const ok = await call(`${s.server.url}/api/projects/${s.slug}/changes`, { method: "POST", body: { nonce, baseVersion: 1, ops: [] } });
    assert.equal(ok.status, 200, ok.body);
  } finally {
    await s.done();
  }
});

test("/mcp with Origin is 403", async () => {
  const s = await setup();
  try {
    assert.equal((await call(`${s.server.url}/mcp`, { method: "POST", body: {}, headers: { origin: "https://evil.example.com" } })).status, 403);
  } finally {
    await s.done();
  }
});

test("SSE receives version event within 1s after apply", async () => {
  const s = await setup();
  try {
    const m = await (await fetch(`${s.server.url}/api/projects/${s.slug}/model`)).json();
    const ctrl = new AbortController();
    const res = await fetch(`${s.server.url}/api/projects/${s.slug}/events`, { signal: ctrl.signal });
    const reader = res.body!.getReader();
    const started = Date.now();
    const id = m.data["big-picture"].nodes[0].id;
    const nonce = await nonceOf(s.server.url);
    await call(`${s.server.url}/api/projects/${s.slug}/changes`, { method: "POST", body: { nonce, baseVersion: m.version, ops: [{ op: "updateNode", id, patch: { text: "SSE" } }] } });
    let text = "";
    while (!/event: version/.test(text)) text += new TextDecoder().decode((await reader.read()).value);
    assert.ok(Date.now() - started < 1000);
    assert.match(text, /"version":2/);
    ctrl.abort();
  } finally {
    await s.done();
  }
});

test("pages endpoint returns renderModel output byte-identical to CLI for a clean model", async () => {
  const s = await setup();
  try {
    const r = await call(`${s.server.url}/api/projects/${s.slug}/pages/big-picture.html`);
    assert.equal(r.status, 200);
    assert.equal(r.body, readFileSync(join(s.modelDir, "big-picture.html"), "utf8"));
  } finally {
    await s.done();
  }
});

test("pages endpoint still renders a model with rule violations", async () => {
  const s = await setup();
  try {
    const m = await (await fetch(`${s.server.url}/api/projects/${s.slug}/model`)).json();
    const nonce = await nonceOf(s.server.url);
    const domain = m.data["big-picture"].domains[0].id;
    const res = await call(`${s.server.url}/api/projects/${s.slug}/changes`, { method: "POST", body: { nonce, baseVersion: m.version, ops: [{ op: "addNode", node: { type: "aggregate", text: "ぽつん", domain } }] } });
    assert.equal(JSON.parse(res.body).ok, true);
    const r = await call(`${s.server.url}/api/projects/${s.slug}/pages/big-picture.html`);
    assert.equal(r.status, 200);
    assert.match(r.body, /ぽつん/);
    const old = await call(`${s.server.url}/api/projects/${s.slug}/pages/big-picture.html?version=1`);
    assert.doesNotMatch(old.body, /ぽつん/);
  } finally {
    await s.done();
  }
});

test("model edits on disk reach the page through the watcher", async () => {
  const s = await setup();
  try {
    await (await fetch(`${s.server.url}/api/projects/${s.slug}/model`)).json();
    const { writeFileSync } = await import("node:fs");
    const p = join(s.modelDir, "data", "big-picture.json");
    const bp = JSON.parse(readFileSync(p, "utf8"));
    bp.nodes[0].text = "ファイルから";
    writeFileSync(p, JSON.stringify(bp, null, 2) + "\n");
    const end = Date.now() + 2000;
    let v = 1;
    while (v === 1 && Date.now() < end) {
      await new Promise((r) => setTimeout(r, 50));
      v = (await (await fetch(`${s.server.url}/api/projects/${s.slug}/model`)).json()).version;
    }
    assert.equal(v, 2);
  } finally {
    await s.done();
  }
});

test("session-diff lists what changed since a version, and refuses bad versions", async () => {
  const s = await setup();
  try {
    const base = `${s.server.url}/api/projects/${s.slug}/session-diff`;
    const m = await (await fetch(`${s.server.url}/api/projects/${s.slug}/model`)).json();
    const id = m.data["big-picture"].nodes[0].id;
    const nonce = await nonceOf(s.server.url);
    await call(`${s.server.url}/api/projects/${s.slug}/changes`, { method: "POST", body: { nonce, baseVersion: m.version, ops: [{ op: "updateNode", id, patch: { text: "会議で直した" } }] } });
    const r = await call(`${base}?from=${m.version}`);
    assert.equal(r.status, 200);
    const d = JSON.parse(r.body);
    assert.equal(d.from, m.version);
    assert.equal(d.to, m.version + 1);
    assert.deepEqual(d.changes.map((c: { id: string; kind: string; authors: unknown[] }) => [c.id, c.kind, c.authors]), [[id, "updated", [{ kind: "person" }]]]);
    assert.equal((await call(`${base}?from=${m.version + 1}`)).status, 200);
    assert.equal((await call(base)).status, 400);
    assert.equal((await call(`${base}?from=abc`)).status, 400);
    assert.equal((await call(`${base}?from=${m.version + 5}`)).status, 400);
  } finally {
    await s.done();
  }
});
