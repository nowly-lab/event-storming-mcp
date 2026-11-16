import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { HistoryStore } from "../src/store/history.ts";
import { tmp } from "./helpers.ts";

const files = (g: string) => ({ "big-picture": `{"bp":1,"g":"${g}"}\n`, "domain-glossary": "{\"g\":1}\n", "workflow-models": "{}\n", "context-map": "{}\n" });
const diff = { added: [], removed: [], updated: [], edgesAdded: 0, edgesRemoved: 0 };

test("append dedups unchanged file blobs", async () => {
  const t = tmp();
  try {
    const h = new HistoryStore(t.dir);
    await h.append("p", { author: { kind: "person" }, summary: "a", files: files("1"), diff });
    const n1 = readdirSync(join(t.dir, "blobs")).length;
    await h.append("p", { author: { kind: "person" }, summary: "b", files: files("2"), diff });
    assert.equal(n1, 3); // workflow-models and context-map share one blob
    assert.equal(readdirSync(join(t.dir, "blobs")).length, 4);
  } finally {
    t.done();
  }
});

test("read returns exact bytes of a past version", async () => {
  const t = tmp();
  try {
    const h = new HistoryStore(t.dir);
    await h.append("p", { author: { kind: "file" }, summary: "a", files: files("1"), diff });
    await h.append("p", { author: { kind: "agent", name: "claude-code" }, summary: "b", files: files("2"), diff });
    assert.deepEqual(await h.read("p", 1), files("1"));
    assert.deepEqual(await h.read("p", 2), files("2"));
    await assert.rejects(h.read("p", 9), /版 9 はありません/);
  } finally {
    t.done();
  }
});

test("version numbers are contiguous per project", async () => {
  const t = tmp();
  try {
    const h = new HistoryStore(t.dir);
    const v = [];
    for (const s of ["a", "b", "c"]) v.push((await h.append("p", { author: { kind: "person" }, summary: s, files: files(s), diff })).version);
    const w = (await h.append("q", { author: { kind: "person" }, summary: "x", files: files("x"), diff })).version;
    assert.deepEqual(v, [1, 2, 3]);
    assert.equal(w, 1);
    assert.deepEqual((await h.list("p")).map((e) => e.version), [3, 2, 1]);
    assert.equal((await h.list("p", { limit: 1 }))[0].summary, "c");
    assert.equal((await h.latest("p"))?.version, 3);
    assert.equal(await h.latest("none"), null);
  } finally {
    t.done();
  }
});

test("truncated last jsonl line is ignored on read", async () => {
  const t = tmp();
  try {
    const h = new HistoryStore(t.dir);
    await h.append("p", { author: { kind: "person" }, summary: "a", files: files("a"), diff });
    appendFileSync(join(t.dir, "projects", "p", "history.jsonl"), '{"version":2,"at":"20');
    assert.equal((await h.latest("p"))?.version, 1);
    assert.equal((await h.append("p", { author: { kind: "person" }, summary: "b", files: files("b"), diff })).version, 2);
    assert.deepEqual((await h.list("p")).map((e) => e.version), [2, 1]);
  } finally {
    t.done();
  }
});
