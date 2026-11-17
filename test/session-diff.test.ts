import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionDiff } from "../src/model/session-diff.ts";
import type { ModelData, Node, Edge } from "../src/model/engine.ts";
import type { VersionEntry } from "../src/store/history.ts";

const n = (id: string, text = id, type: Node["type"] = "event"): Node => ({ id, type, domain: "d", text });
const model = (nodes: Node[], edges: Edge[] = []) => ({ "big-picture": { domains: [{ id: "d", name: "D" }], nodes, edges } }) as unknown as ModelData;
const entry = (version: number, author: VersionEntry["author"], diff: Partial<VersionEntry["diff"]>): VersionEntry =>
  ({ version, at: "", author, summary: "", blobs: {} as VersionEntry["blobs"], diff: { added: [], removed: [], updated: [], edgesAdded: 0, edgesRemoved: 0, ...diff } });
const claude = { kind: "agent" as const, name: "claude-code" };
const person = { kind: "person" as const };

test("net change only: a sticky added and removed inside the range is not listed", () => {
  const d = sessionDiff(model([n("a")]), model([n("a")]), [entry(2, claude, { added: ["x"] }), entry(3, person, { removed: ["x"] })], 1, 3);
  assert.deepEqual(d.changes, []);
});

test("added, updated and removed stickies with who changed them", () => {
  const before = model([n("a", "古い"), n("gone", "消えた付箋", "hotspot")]);
  const after = model([n("a", "新しい"), n("new", "足した付箋")]);
  const d = sessionDiff(before, after, [
    entry(2, claude, { updated: ["a"], added: ["new"] }),
    entry(3, person, { updated: ["a"], removed: ["gone"] }),
    entry(4, claude, { updated: ["a"] }),
  ], 1, 4);
  assert.equal(d.from, 1);
  assert.equal(d.to, 4);
  const by = Object.fromEntries(d.changes.map((c) => [c.id, c]));
  assert.equal(by.new!.kind, "added");
  assert.equal(by.new!.text, "足した付箋");
  assert.deepEqual(by.new!.authors, [claude]);
  assert.equal(by.a!.kind, "updated");
  assert.deepEqual(by.a!.fields, ["text"]);
  assert.deepEqual(by.a!.authors, [claude, person], "each author once, oldest first");
  assert.equal(by.gone!.kind, "removed");
  assert.equal(by.gone!.text, "消えた付箋", "a removed sticky keeps its old text");
  assert.equal(by.gone!.type, "hotspot");
});

test("arrows added and removed come back as edges", () => {
  const d = sessionDiff(model([n("a"), n("b")], [{ from: "a", to: "b", kind: "flow" }]), model([n("a"), n("b")], [{ from: "b", to: "a", kind: "flow" }]), [entry(2, person, { edgesAdded: 1, edgesRemoved: 1 })], 1, 2);
  assert.deepEqual(d.edgesAdded, [{ from: "b", to: "a", kind: "flow" }]);
  assert.deepEqual(d.edgesRemoved, [{ from: "a", to: "b", kind: "flow" }]);
});

test("no entries means no change", () => {
  const m = model([n("a")]);
  assert.deepEqual(sessionDiff(m, m, [], 3, 3), { from: 3, to: 3, changes: [], edgesAdded: [], edgesRemoved: [] });
});
