import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyOps, newNodeId, previewRemoveNode } from "../src/model/ops.ts";
import { diffModels, summaryText } from "../src/model/diff.ts";
import { engine, type ModelData } from "../src/model/engine.ts";
import { SAMPLE } from "./helpers.ts";

function sample(): ModelData {
  const r = (f: string) => JSON.parse(readFileSync(join(SAMPLE, "data", `${f}.json`), "utf8"));
  return { "big-picture": r("big-picture"), "domain-glossary": r("domain-glossary"), "workflow-models": r("workflow-models"), "context-map": r("context-map") };
}

test("addNode after links flow edge and inherits domain", () => {
  const d = sample();
  const host = d["big-picture"].nodes.find((n) => n.type === "event" && !n.attach)!;
  const { data, summary } = applyOps(d, [{ op: "addNode", node: { type: "policy", text: "在庫が尽きたら", execution: "async" }, after: host.id }]);
  const added = data["big-picture"].nodes.at(-1)!;
  assert.equal(added.domain, host.domain);
  assert.match(added.id, /^policy-[0-9a-f]{4}$/);
  assert.ok(data["big-picture"].edges.some((e) => e.from === host.id && e.to === added.id && e.kind === "flow"));
  assert.deepEqual(summary.added, [added.id]);
  assert.equal(summary.edgesAdded, 1);
  assert.equal(d["big-picture"].nodes.includes(added), false, "input is not mutated");
});

test("addNode without after or domain is refused", () => {
  assert.throws(() => applyOps(sample(), [{ op: "addNode", node: { type: "event", text: "x" } }]), /ドメイン/);
});

test("removeNode cascades edges, attached notes, glossary refs, transitions and rejections", () => {
  const d = sample();
  const used = d["workflow-models"].lifecycles.flatMap((l) => l.transitions.map((t) => t.on))[0];
  const preview = previewRemoveNode(d, used);
  const { data, removed } = applyOps(d, [{ op: "removeNode", id: used }]);
  const bp = data["big-picture"];
  assert.equal(bp.nodes.some((n) => n.id === used || preview.attached.includes(n.id)), false);
  assert.equal(bp.edges.some((e) => e.from === used || e.to === used), false);
  assert.equal(data["domain-glossary"].terms.some((t) => t.nodes?.includes(used)), false);
  assert.equal(data["workflow-models"].lifecycles.some((l) => l.transitions.some((t) => t.on === used) || l.rejections.some((r) => r.on === used)), false);
  assert.ok(preview.transitions.length >= 1);
  assert.deepEqual(removed[0], preview, "previewRemoveNode lists exactly what removeNode removes");
});

test("newNodeId never collides", () => {
  const d = sample();
  const ids = new Set(d["big-picture"].nodes.map((n) => n.id));
  for (let i = 0; i < 200; i++) {
    const id = newNodeId(d, "event", () => 0.5); // a fixed random source forces the collision path
    assert.equal(ids.has(id), false);
    d["big-picture"].nodes.push({ id, type: "event", domain: d["big-picture"].domains[0].id, text: "x" });
    ids.add(id);
  }
});

test("addEdge to attached note is refused by validateStructure except result→readModel", async () => {
  const { validateStructure, validateModel } = await engine();
  const d = sample();
  const attached = d["big-picture"].nodes.find((n) => n.attach)!;
  const src = d["big-picture"].nodes.find((n) => n.type === "command" && !n.attach)!;
  const { data } = applyOps(d, [{ op: "addEdge", from: src.id, to: attached.id, kind: "flow" }]);
  // Edges into an attached note break a modeling rule, not the structure: saved as a draft with a warning.
  assert.deepEqual(validateStructure(data), []);
  assert.match(validateModel(data).join("\n"), /貼られた付箋なので、流れの矢印は向けられません/);
  const unknown = applyOps(d, [{ op: "addEdge", from: src.id, to: "nope", kind: "flow" }]).data;
  assert.match(validateStructure(unknown).join("\n"), /"nope" という付箋はありません/);
});

test("updateNode changes text; removeEdge drops one arrow", () => {
  const d = sample();
  const e = d["big-picture"].edges[0];
  const { data, summary } = applyOps(d, [{ op: "updateNode", id: e.from, patch: { text: "直した" } }, { op: "removeEdge", from: e.from, to: e.to }]);
  assert.equal(data["big-picture"].nodes.find((n) => n.id === e.from)!.text, "直した");
  assert.equal(data["big-picture"].edges.some((x) => x.from === e.from && x.to === e.to), false);
  assert.deepEqual(summary.updated, [e.from]);
  assert.equal(summary.edgesRemoved, 1);
  assert.throws(() => applyOps(d, [{ op: "updateNode", id: "nope", patch: { text: "x" } }]), /"nope" という付箋はありません/);
});

test("diffModels detects added, removed, text-updated nodes and edge counts", () => {
  const before = sample();
  const n0 = before["big-picture"].nodes[0];
  const { data: after } = applyOps(before, [
    { op: "updateNode", id: n0.id, patch: { text: "変えた" } },
    { op: "addNode", node: { type: "event", text: "新しい", domain: n0.domain } },
    { op: "addNode", node: { type: "event", text: "新しい2", domain: n0.domain } },
  ]);
  const s = diffModels(before, after);
  assert.equal(s.added.length, 2);
  assert.deepEqual(s.updated, [n0.id]);
  assert.deepEqual(s.updatedFields[n0.id], ["text"]);
  assert.equal(summaryText({ ...s, edgesAdded: 1 }), "付箋を2件追加、1件変更、矢印を1件追加");
  assert.equal(summaryText({ added: [], removed: [], updated: [], edgesAdded: 0, edgesRemoved: 0 }), "変更なし");
});

function timeline(): ModelData {
  const dir = join(SAMPLE, "..", "timeline", "data");
  const r = (f: string) => JSON.parse(readFileSync(join(dir, `${f}.json`), "utf8"));
  return { "big-picture": r("big-picture"), "domain-glossary": r("domain-glossary"), "workflow-models": r("workflow-models"), "context-map": r("context-map") };
}

test("setPhases replaces the phases; removing one still in use is a structural error", async () => {
  const d = timeline();
  const { data } = applyOps(d, [{ op: "setPhases", phases: [{ id: "store", name: "店" }, { id: "decide", name: "決める" }, { id: "books", name: "帳簿" }, { id: "later", name: "あと" }] }]);
  assert.deepEqual(data["big-picture"].phases!.map((p) => p.id), ["store", "decide", "books", "later"]);
  const { validateStructure } = await engine();
  const { data: broken } = applyOps(d, [{ op: "setPhases", phases: [{ id: "store", name: "店" }] }]);
  assert.ok(validateStructure(broken).some((e) => /decide|books/.test(e)));
});

test("addNode after a sticky with a phase takes that phase (not when attached)", () => {
  const d = timeline();
  const { data } = applyOps(d, [
    { op: "addNode", node: { id: "rechecked", type: "event", text: "相場を確かめ直した" }, after: "priced" },
    { op: "addNode", node: { id: "q", type: "hotspot", domain: "visit", text: "いつ確かめ直す？", attach: { to: "priced", pos: "below" } } },
  ]);
  const by = (id: string) => data["big-picture"].nodes.find((n) => n.id === id)!;
  assert.equal(by("rechecked").phase, "store");
  assert.equal(by("q").phase, undefined);
});

test("updateNode can move an event to another phase, and the diff says so", () => {
  const d = timeline();
  const { data } = applyOps(d, [{ op: "updateNode", id: "decided", patch: { phase: "books" } }]);
  assert.equal(data["big-picture"].nodes.find((n) => n.id === "decided")!.phase, "books");
  assert.deepEqual(diffModels(d, data).updatedFields.decided, ["phase"]);
});
