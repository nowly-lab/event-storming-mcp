import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startServer } from "../src/server/http.ts";
import { attachMcp } from "../src/mcp/http.ts";
import { ModelStore } from "../src/store/model-store.ts";
import { ProjectRegistry } from "../src/store/registry.ts";
import { HistoryStore } from "../src/store/history.ts";
import { stopServer } from "../src/server/daemon.ts";
import { sampleRepo, tmp } from "./helpers.ts";

type Text = { content: { type: string; text: string }[]; isError?: boolean };
const body = (r: unknown) => JSON.parse((r as Text).content[0].text);

async function setup(name = "claude-code") {
  const t = tmp();
  const { modelDir } = sampleRepo(t.dir);
  const dataDir = join(t.dir, "data");
  const registry = new ProjectRegistry(dataDir);
  const history = new HistoryStore(dataDir);
  const store = new ModelStore({ registry, history });
  const deps = { store, registry, history, webRoot: t.dir };
  let url = "";
  const server = await startServer({ ...deps, port: 0, mcp: attachMcp(deps, () => url) });
  url = server.url;
  const client = new Client({ name, version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`)));
  return { t, modelDir, server, client, store, history, done: async () => { await client.close(); await server.close(); t.done(); } };
}

test("tools/list returns the 10 tools", async () => {
  const s = await setup();
  try {
    const names = (await s.client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(names, ["apply_changes", "find_nodes", "get_model", "get_version", "list_history", "list_projects", "open_page", "register_project", "restore_version", "validate"]);
  } finally {
    await s.done();
  }
});

test("apply_changes records agent name from clientInfo and triggers a version event", async () => {
  const s = await setup("codex");
  try {
    const p = body(await s.client.callTool({ name: "register_project", arguments: { model_dir: s.modelDir } }));
    const m = body(await s.client.callTool({ name: "get_model", arguments: { project: p.name } }));
    const events: number[] = [];
    s.store.on((e) => e.type === "version" && events.push(e.version));
    const id = m.data["big-picture"].nodes[0].id;
    const r = body(await s.client.callTool({ name: "apply_changes", arguments: { project: p.slug, base_version: m.version, ops: [{ op: "updateNode", id, patch: { text: "MCPで" } }] } }));
    assert.equal(r.ok, true);
    assert.deepEqual(events, [2]);
    const h = body(await s.client.callTool({ name: "list_history", arguments: { project: p.slug, limit: 1 } }));
    assert.deepEqual(h[0].author, { kind: "agent", name: "codex" });
  } finally {
    await s.done();
  }
});

test("apply_changes with stale base_version returns conflict and current version", async () => {
  const s = await setup();
  try {
    const p = body(await s.client.callTool({ name: "register_project", arguments: { model_dir: s.modelDir } }));
    const m = body(await s.client.callTool({ name: "get_model", arguments: { project: p.slug } }));
    const id = m.data["big-picture"].nodes[0].id;
    await s.client.callTool({ name: "apply_changes", arguments: { project: p.slug, base_version: 1, ops: [{ op: "updateNode", id, patch: { text: "a" } }] } });
    const r = (await s.client.callTool({ name: "apply_changes", arguments: { project: p.slug, base_version: 1, ops: [{ op: "updateNode", id, patch: { text: "b" } }] } })) as Text;
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /conflict: 版 1 は最新ではありません（最新は版 2）/);
  } finally {
    await s.done();
  }
});

test("find_nodes matches text substring and type", async () => {
  const s = await setup();
  try {
    const p = body(await s.client.callTool({ name: "register_project", arguments: { model_dir: s.modelDir } }));
    const m = body(await s.client.callTool({ name: "get_model", arguments: { project: p.slug } }));
    const ev = m.data["big-picture"].nodes.find((n: { type: string }) => n.type === "event");
    const r = body(await s.client.callTool({ name: "find_nodes", arguments: { project: p.slug, text: ev.text.slice(1, 4), type: "event" } }));
    assert.ok(r.nodes.some((n: { id: string }) => n.id === ev.id));
    assert.ok(r.nodes.every((n: { type: string }) => n.type === "event"));
    const v = body(await s.client.callTool({ name: "validate", arguments: { project: p.slug } }));
    assert.deepEqual(v, { structural: [], rules: [] });
    const o = body(await s.client.callTool({ name: "open_page", arguments: { project: p.slug } }));
    assert.equal(o.url, `${s.server.url}/#/${p.slug}/big-picture.html`);
    const unknown = (await s.client.callTool({ name: "get_model", arguments: { project: "nope" } })) as Text;
    assert.equal(unknown.isError, true);
  } finally {
    await s.done();
  }
});

test("stdio mcp starts the server when none is running", async () => {
  const t = tmp();
  try {
    const { modelDir } = sampleRepo(t.dir);
    const dataDir = join(t.dir, "data");
    const client = new Client({ name: "stdio-test", version: "1.0.0" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [new URL("../src/cli.ts", import.meta.url).pathname, "mcp"], env: { ...process.env, EVENT_STORMING_MCP_DATA_DIR: dataDir } as Record<string, string> }));
    const p = body(await client.callTool({ name: "register_project", arguments: { model_dir: modelDir } }));
    assert.equal(p.name, "sample");
    const list = body(await client.callTool({ name: "list_projects", arguments: {} }));
    assert.equal(list[0].version, 1);
    await client.close();
    assert.equal(await stopServer(dataDir), true);
  } finally {
    t.done();
  }
});
