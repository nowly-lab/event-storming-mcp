import { test } from "node:test";
import assert from "node:assert/strict";
import { toastText, authorLabel, keepViewport, warningNodeIds } from "../web/live.ts";
import { reduce, initialEdit, edgeKindFor, anchorShift, canRebase } from "../web/edit-state.ts";
import { frameClass } from "../web/history-logic.ts";

const s3 = { added: ["a"], removed: [], updated: ["b", "c"], edgesAdded: 0, edgesRemoved: 0 };

test("toastText: agent 3 changes → \"自動更新: Claude が 3 件変更\"", () => {
  assert.equal(toastText({ kind: "agent", name: "claude-code" }, s3), "自動更新: Claude が 3 件変更");
  assert.equal(toastText({ kind: "agent", name: "codex-mcp-client" }, s3), "自動更新: Codex が 3 件変更");
  assert.equal(toastText({ kind: "agent", name: "my-bot" }, s3), "自動更新: my-bot が 3 件変更");
  assert.equal(toastText({ kind: "person" }, { ...s3, edgesAdded: 1 }), "自動更新: 人 が 4 件変更");
  assert.equal(toastText({ kind: "file" }, { added: [], removed: [], updated: [], edgesAdded: 0, edgesRemoved: 0 }), "自動更新: ファイル が変更");
  assert.equal(authorLabel({ kind: "agent", name: "Claude Code" }), "Claude");
});

test("keepViewport keeps zoom and centre", () => {
  const prev = { zoom: 0.5, scrollLeft: 100, scrollTop: 40, width: 800, height: 600 };
  assert.deepEqual(keepViewport(prev, { zoom: 1, scrollLeft: 0, scrollTop: 0, width: 800, height: 600 }), prev);
  // A wider view keeps the same content point in the middle.
  const r = keepViewport(prev, { zoom: 1, scrollLeft: 0, scrollTop: 0, width: 1000, height: 600 });
  assert.equal(r.zoom, 0.5);
  assert.equal(r.scrollLeft, 0);
});

test("warningNodeIds maps nodes[i] paths and quoted ids to sticky ids", () => {
  const ids = ["a1", "agg-x", "c3"];
  const w = ['data/big-picture.json: nodes[1]: 集約 "agg-x" にはコマンドからの流れの矢印が必要です。', "data/workflow-models.json: lifecycles[0]: 何か"];
  assert.deepEqual([...warningNodeIds(w, ids)], ["agg-x"]);
});

test("version events are queued while editing and flushed on save", () => {
  let s = initialEdit();
  s = reduce(s, { type: "startText", id: "n1", text: "前" }).state;
  const q = reduce(s, { type: "remoteVersion", version: 5 });
  assert.deepEqual(q.effects, []);
  assert.equal(q.state.pending.length, 1);
  s = reduce(q.state, { type: "typing", text: "後" }).state;
  const saved = reduce(s, { type: "commitText" });
  assert.deepEqual(saved.effects, [{ type: "save", ops: [{ op: "updateNode", id: "n1", patch: { text: "後" } }] }]);
  const done = reduce(saved.state, { type: "saved" });
  assert.equal(done.state.mode, "idle");
  assert.deepEqual(done.effects, [{ type: "reload", reason: "pending" }]);
  // Idle: a remote version reloads at once.
  assert.deepEqual(reduce(initialEdit(), { type: "remoteVersion", version: 2 }).effects, [{ type: "reload", reason: "remote" }]);
});

test("conflict keeps draft text", () => {
  let s = reduce(initialEdit(), { type: "startText", id: "n1", text: "前" }).state;
  s = reduce(s, { type: "typing", text: "書きかけ" }).state;
  s = reduce(s, { type: "commitText" }).state;
  const c = reduce(s, { type: "conflict" });
  assert.equal(c.state.mode, "conflict");
  assert.equal(c.state.draft?.text, "書きかけ");
  const reloaded = reduce(c.state, { type: "reloadLatest" });
  assert.equal(reloaded.state.mode, "text");
  assert.equal(reloaded.state.draft?.text, "書きかけ");
  assert.deepEqual(reloaded.effects, [{ type: "reload", reason: "conflict" }]);
});

test("empty text is not saved; Esc cancels", () => {
  let s = reduce(initialEdit(), { type: "startText", id: "n1", text: "前" }).state;
  s = reduce(s, { type: "typing", text: "   " }).state;
  assert.deepEqual(reduce(s, { type: "commitText" }).effects, [{ type: "error", message: "付箋の文字を空にはできません。消すときはツールバーの「削除」を使ってください。" }]);
  assert.equal(reduce(s, { type: "cancel" }).state.mode, "idle");
  const same = reduce(reduce(initialEdit(), { type: "startText", id: "n1", text: "同じ" }).state, { type: "commitText" });
  assert.equal(same.state.mode, "idle");
  assert.deepEqual(same.effects, []);
});

test("edgeKindFor event→readModel is result", () => {
  assert.equal(edgeKindFor("event", "readModel"), "result");
  assert.equal(edgeKindFor("command", "aggregate"), "flow");
  assert.equal(edgeKindFor("readModel", "actor"), "flow");
});

test("anchorShift keeps edited note on screen", () => {
  assert.deepEqual(anchorShift({ x: 100, y: 50 }, { x: 160, y: 20 }, 0.5), { dx: 30, dy: -15 });
});

test("inline edit escapes markup and keeps newlines out of ids", () => {
  let s = reduce(initialEdit(), { type: "startText", id: "n1", text: "前" }).state;
  s = reduce(s, { type: "typing", text: "<script>x</script>\n改行" }).state;
  const r = reduce(s, { type: "commitText" });
  assert.deepEqual(r.effects, [{ type: "save", ops: [{ op: "updateNode", id: "n1", patch: { text: "<script>x</script> 改行" } }] }]);
});

test("frameClass marks added green, removed red, updated yellow", () => {
  const s = { added: ["a"], removed: ["r"], updated: ["u"], edgesAdded: 0, edgesRemoved: 0 };
  assert.equal(frameClass("a", s), "added");
  assert.equal(frameClass("r", s), "removed");
  assert.equal(frameClass("u", s), "updated");
  assert.equal(frameClass("z", s), null);
});

test("canRebase redoes an edit only when nobody changed the same sticky", () => {
  const m = { "big-picture": { domains: [], edges: [], nodes: [{ id: "a", type: "event", domain: "d", text: "元" }, { id: "b", type: "command", domain: "d", text: "x" }] } } as never;
  assert.equal(canRebase([{ op: "updateNode", id: "a", patch: { text: "新" } }], m, "元"), true);
  assert.equal(canRebase([{ op: "updateNode", id: "a", patch: { text: "新" } }], m, "別の人が先に"), false);
  assert.equal(canRebase([{ op: "addEdge", from: "a", to: "b", kind: "flow" }], m), true);
  assert.equal(canRebase([{ op: "addEdge", from: "a", to: "gone", kind: "flow" }], m), false);
  assert.equal(canRebase([{ op: "removeNode", id: "gone" }], m), false);
  // A delete was confirmed against a list of what goes with it; never redo it on a newer version.
  assert.equal(canRebase([{ op: "removeNode", id: "a" }], m), false);
});

import { distanceToPath } from "../web/board.ts";
test("distanceToPath measures the closest point of a path", () => {
  const line = (x1: number, y1: number, x2: number, y2: number) => ({ getTotalLength: () => Math.hypot(x2 - x1, y2 - y1), getPointAtLength: (l: number) => { const t = l / Math.hypot(x2 - x1, y2 - y1); return { x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t }; } });
  const a = line(0, 0, 100, 0), b = line(0, 6, 100, 6);
  // A click at y=2 is nearer to a than to b, although both are within an 8px tolerance.
  assert.ok(distanceToPath(a, 50, 2) < distanceToPath(b, 50, 2));
  assert.ok(Math.abs(distanceToPath(a, 50, 2) - 2) < 0.1);
});
