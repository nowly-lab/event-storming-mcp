import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ModelStore, type StoreEvent } from "../src/store/model-store.ts";
import { ProjectRegistry } from "../src/store/registry.ts";
import { HistoryStore } from "../src/store/history.ts";
import { watchProject } from "../src/store/watch.ts";
import { sampleRepo, tmp } from "./helpers.ts";

async function setup() {
  const t = tmp();
  const { modelDir } = sampleRepo(t.dir);
  const registry = new ProjectRegistry(join(t.dir, "data"));
  const history = new HistoryStore(join(t.dir, "data"));
  const store = new ModelStore({ registry, history });
  const p = await registry.register(modelDir);
  await store.read(p.slug);
  const events: StoreEvent[] = [];
  store.on((e) => events.push(e));
  const w = watchProject(store, registry, p.slug, { intervalMs: 50 });
  await w.ready;
  return { t, modelDir, store, history, slug: p.slug, events, done: () => { w.close(); t.done(); } };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(f: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!f()) { if (Date.now() > end) throw new Error("timed out"); await wait(20); }
}
const bpPath = (d: string) => join(d, "data", "big-picture.json");
function editText(dir: string, text: string) {
  const bp = JSON.parse(readFileSync(bpPath(dir), "utf8"));
  bp.nodes[0].text = text;
  writeFileSync(bpPath(dir), `${JSON.stringify(bp, null, 2)}\n`);
}

test("external edit becomes a file-authored version", async () => {
  const s = await setup();
  try {
    editText(s.modelDir, "外から直した");
    await until(() => s.events.some((e) => e.type === "version"));
    const e = s.events.find((x) => x.type === "version")!;
    assert.ok(e.type === "version" && e.author.kind === "file" && e.version === 2 && e.summary.updated.length === 1);
  } finally {
    s.done();
  }
});

test("own write is not re-recorded", async () => {
  const s = await setup();
  try {
    const r = await s.store.read(s.slug);
    await s.store.apply(s.slug, { baseVersion: r.version, ops: [{ op: "updateNode", id: r.data["big-picture"].nodes[0].id, patch: { text: "画面で" } }], author: { kind: "person" } });
    await wait(300);
    assert.equal((await s.history.latest(s.slug))?.version, 2);
    assert.equal(s.events.filter((e) => e.type === "version").length, 1);
  } finally {
    s.done();
  }
});

test("external edit during pending UI write yields conflict, not overwrite", async () => {
  const s = await setup();
  try {
    const r = await s.store.read(s.slug);
    editText(s.modelDir, "エージェントがファイルで");
    await until(() => s.events.some((e) => e.type === "version"));
    const res = await s.store.apply(s.slug, { baseVersion: r.version, ops: [{ op: "updateNode", id: r.data["big-picture"].nodes[0].id, patch: { text: "人が画面で" } }], author: { kind: "person" } });
    assert.ok(!res.ok && res.reason === "conflict");
    assert.match(readFileSync(bpPath(s.modelDir), "utf8"), /エージェントがファイルで/);
  } finally {
    s.done();
  }
});

test("unparsable file keeps last good version and reports", async () => {
  const s = await setup();
  try {
    writeFileSync(bpPath(s.modelDir), "{ <<<<<<< HEAD");
    await until(() => s.events.some((e) => e.type === "file-error"));
    const e = s.events.find((x) => x.type === "file-error")!;
    assert.ok(e.type === "file-error" && /big-picture.json: JSON として読めません/.test(e.errors.join("\n")));
    assert.equal((await s.store.read(s.slug)).version, 1);
  } finally {
    s.done();
  }
});

test("model dir removed then restored", async () => {
  const s = await setup();
  try {
    const data = join(s.modelDir, "data");
    renameSync(data, `${data}.away`);
    await until(() => s.events.some((e) => e.type === "file-error" && /モデルが見つかりません/.test(e.errors.join(""))));
    renameSync(`${data}.away`, data);
    editText(s.modelDir, "戻ってきた");
    await until(() => s.events.some((e) => e.type === "version"));
    assert.equal((await s.history.latest(s.slug))?.version, 2);
  } finally {
    s.done();
  }
});
