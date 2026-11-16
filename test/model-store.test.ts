import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ModelStore } from "../src/store/model-store.ts";
import { ProjectRegistry } from "../src/store/registry.ts";
import { HistoryStore } from "../src/store/history.ts";
import { main } from "../src/cli.ts";
import { sampleRepo, tmp } from "./helpers.ts";

const person = { kind: "person" } as const;
const quiet = { out: () => {}, err: () => {} };

async function setup() {
  const t = tmp();
  const { modelDir } = sampleRepo(t.dir);
  await main(["render", modelDir], quiet);
  const registry = new ProjectRegistry(join(t.dir, "data"));
  const history = new HistoryStore(join(t.dir, "data"));
  const store = new ModelStore({ registry, history });
  const p = await registry.register(modelDir);
  return { t, modelDir, store, history, slug: p.slug };
}

test("first read records the files as version 1 by file", async () => {
  const s = await setup();
  try {
    const r = await s.store.read(s.slug);
    assert.equal(r.version, 1);
    assert.deepEqual(r.warnings, []);
    assert.equal((await s.history.latest(s.slug))?.author.kind, "file");
    assert.equal((await s.store.read(s.slug)).version, 1, "reading again adds nothing");
  } finally {
    s.t.done();
  }
});

test("stale baseVersion returns conflict with current data", async () => {
  const s = await setup();
  try {
    const r = await s.store.read(s.slug);
    const id = r.data["big-picture"].nodes[0].id;
    const ok = await s.store.apply(s.slug, { baseVersion: 1, ops: [{ op: "updateNode", id, patch: { text: "一" } }], author: person });
    assert.equal(ok.ok, true);
    const stale = await s.store.apply(s.slug, { baseVersion: 1, ops: [{ op: "updateNode", id, patch: { text: "二" } }], author: person });
    assert.equal(stale.ok, false);
    assert.ok(!stale.ok && stale.reason === "conflict" && stale.current.version === 2 && stale.current.data["big-picture"].nodes[0].text === "一");
  } finally {
    s.t.done();
  }
});

test("structural error writes nothing", async () => {
  const s = await setup();
  try {
    const before = readFileSync(join(s.modelDir, "data", "big-picture.json"), "utf8");
    const r = await s.store.read(s.slug);
    const res = await s.store.apply(s.slug, { baseVersion: r.version, ops: [{ op: "addEdge", from: r.data["big-picture"].nodes[0].id, to: "nope", kind: "flow" }], author: person });
    assert.ok(!res.ok && res.reason === "invalid" && /"nope" という付箋はありません/.test(res.errors.join("\n")));
    assert.equal(readFileSync(join(s.modelDir, "data", "big-picture.json"), "utf8"), before);
    assert.equal((await s.history.latest(s.slug))?.version, 1);
    const unknown = await s.store.apply(s.slug, { baseVersion: 1, ops: [{ op: "removeNode", id: "nope" }], author: person });
    assert.ok(!unknown.ok && unknown.reason === "invalid");
  } finally {
    s.t.done();
  }
});

test("rule violation saves JSON, keeps HTML untouched, returns warnings", async () => {
  const s = await setup();
  try {
    const html = readFileSync(join(s.modelDir, "big-picture.html"), "utf8");
    const r = await s.store.read(s.slug);
    const domain = r.data["big-picture"].domains[0].id;
    const res = await s.store.apply(s.slug, { baseVersion: 1, ops: [{ op: "addNode", node: { type: "aggregate", text: "ぽつんと集約", domain } }], author: person });
    assert.ok(res.ok && !res.htmlWritten && res.warnings.some((w) => /集約/.test(w)));
    assert.match(readFileSync(join(s.modelDir, "data", "big-picture.json"), "utf8"), /ぽつんと集約/);
    assert.equal(readFileSync(join(s.modelDir, "big-picture.html"), "utf8"), html);
    assert.equal((await s.store.read(s.slug)).htmlCurrent, false);
  } finally {
    s.t.done();
  }
});

test("clean version writes HTML identical to render CLI", async () => {
  const s = await setup();
  try {
    const r = await s.store.read(s.slug);
    const n = r.data["big-picture"].nodes.find((x) => x.type === "event")!;
    const res = await s.store.apply(s.slug, { baseVersion: 1, ops: [{ op: "updateNode", id: n.id, patch: { text: "名前を変えた" } }], author: { kind: "agent", name: "claude-code" } });
    assert.ok(res.ok && res.htmlWritten);
    const c: string[] = [];
    assert.equal(await main(["check", s.modelDir], { out: (x) => c.push(x), err: (x) => c.push(x) }), 0, c.join(""));
    assert.equal((await s.history.latest(s.slug))?.author.kind, "agent");
  } finally {
    s.t.done();
  }
});

test("restore creates a new version equal to the old files", async () => {
  const s = await setup();
  try {
    const v1 = readFileSync(join(s.modelDir, "data", "big-picture.json"), "utf8");
    const r = await s.store.read(s.slug);
    await s.store.apply(s.slug, { baseVersion: 1, ops: [{ op: "updateNode", id: r.data["big-picture"].nodes[0].id, patch: { text: "変" } }], author: person });
    const res = await s.store.restore(s.slug, 1, person, 2);
    assert.ok(res.ok && res.version === 3);
    assert.equal(readFileSync(join(s.modelDir, "data", "big-picture.json"), "utf8"), v1);
    assert.match((await s.history.latest(s.slug))!.summary, /版 1 に戻した/);
  } finally {
    s.t.done();
  }
});

test("concurrent applies are serialized", async () => {
  const s = await setup();
  try {
    const r = await s.store.read(s.slug);
    const id = r.data["big-picture"].nodes[0].id;
    const results = await Promise.all([1, 2, 3].map((i) => s.store.apply(s.slug, { baseVersion: 1, ops: [{ op: "updateNode", id, patch: { text: `t${i}` } }], author: person })));
    assert.equal(results.filter((x) => x.ok).length, 1);
    assert.equal(results.filter((x) => !x.ok && x.reason === "conflict").length, 2);
    assert.equal((await s.history.latest(s.slug))?.version, 2);
  } finally {
    s.t.done();
  }
});

test("events are emitted for each new version", async () => {
  const s = await setup();
  try {
    const r = await s.store.read(s.slug);
    const seen: number[] = [];
    const off = s.store.on((e) => e.type === "version" && seen.push(e.version));
    await s.store.apply(s.slug, { baseVersion: r.version, ops: [{ op: "updateNode", id: r.data["big-picture"].nodes[0].id, patch: { text: "x" } }], author: person });
    off();
    assert.deepEqual(seen, [2]);
    assert.equal(existsSync(join(s.modelDir, "data", "big-picture.json")), true);
  } finally {
    s.t.done();
  }
});

test("external edit right before apply (no watcher) yields conflict and is kept in history", async () => {
  const s = await setup();
  try {
    const r = await s.store.read(s.slug);
    const p = join(s.modelDir, "data", "big-picture.json");
    const bp = JSON.parse(readFileSync(p, "utf8"));
    bp.nodes[0].text = "EXTERNAL NOT YET POLLED";
    writeFileSync(p, JSON.stringify(bp, null, 2) + "\n");
    const res = await s.store.apply(s.slug, { baseVersion: r.version, ops: [{ op: "updateNode", id: bp.nodes[0].id, patch: { text: "UI overwrites" } }], author: person });
    assert.ok(!res.ok && res.reason === "conflict");
    assert.match(readFileSync(p, "utf8"), /EXTERNAL NOT YET POLLED/);
    const latest = await s.history.latest(s.slug);
    assert.equal(latest?.author.kind, "file");
    assert.equal(latest?.version, 2);
  } finally {
    s.t.done();
  }
});

test("an unreadable or structurally broken file on disk blocks writes", async () => {
  const s = await setup();
  try {
    const r = await s.store.read(s.slug);
    const p = join(s.modelDir, "data", "big-picture.json");
    writeFileSync(p, "{ broken");
    const res = await s.store.apply(s.slug, { baseVersion: r.version, ops: [{ op: "updateNode", id: r.data["big-picture"].nodes[0].id, patch: { text: "x" } }], author: person });
    assert.ok(!res.ok && res.reason === "invalid" && /JSON として読めません/.test(res.errors.join("")));
    assert.equal(readFileSync(p, "utf8"), "{ broken");
    assert.equal((await s.store.read(s.slug)).version, 1, "reads keep the last good version");
  } finally {
    s.t.done();
  }
});

test("restore with a stale baseVersion is a conflict", async () => {
  const s = await setup();
  try {
    const r = await s.store.read(s.slug);
    await s.store.apply(s.slug, { baseVersion: 1, ops: [{ op: "updateNode", id: r.data["big-picture"].nodes[0].id, patch: { text: "v2" } }], author: person });
    const stale = await s.store.restore(s.slug, 1, person, 1);
    assert.ok(!stale.ok && stale.reason === "conflict");
    const ok = await s.store.restore(s.slug, 1, person, 2);
    assert.ok(ok.ok && ok.version === 3);
  } finally {
    s.t.done();
  }
});
