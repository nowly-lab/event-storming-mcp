import { api } from "./api.ts";
import { Board } from "./board.ts";
import { connectLive, toastText, warningNodeIds } from "./live.ts";
import { reduce, initialEdit, edgeKindFor, canRebase, type Effect, type EditState } from "./edit-state.ts";
import { showHistory } from "./history.ts";
import { renderChanges } from "./session.ts";
import { baseFor, baseText, setBase, setShowChanges, showChanges } from "./session-logic.ts";
import type { ApplyResult, Model, NodeType, Op, Project, Removal, SessionDiff } from "./types.ts";

const PAGES: [string, string][] = [
  ["big-picture.html", "全体像"], ["domain-glossary.html", "用語集"], ["event-command-map.html", "イベントとコマンド"],
  ["workflow-models.html", "ワークフロー"], ["context-map.html", "コンテキスト"], ["history", "履歴"],
];
const TYPES: [NodeType, string, string][] = [
  ["event", "イベント", "#ff9f43"], ["command", "コマンド", "#9fd0ff"], ["actor", "アクター", "#fff3b0"], ["policy", "ポリシー", "#c9a7f5"],
  ["aggregate", "集約", "#ffd43b"], ["external", "外部システム", "#ffb3d9"], ["readModel", "リードモデル", "#c5ec7e"], ["hotspot", "ホットスポット", "#ff6b81"],
];
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let projects: Project[] = [];
let slug = "";
let page = "big-picture.html";
let version = 0;
let model: Model | null = null;
let warnings: string[] = [];
let edit: EditState = initialEdit();
let live: { close(): void } | null = null;
let lastAnchor: string | undefined;
let diff: SessionDiff | null = null;
const tabStore = (): Storage | { getItem(): null; setItem(): void } => {
  try {
    return window.sessionStorage;
  } catch {
    return { getItem: () => null, setItem: () => {} };
  }
};

const board = new Board($("stage"), {
  startText: (id, text) => dispatch({ type: "startText", id, text }),
  typing: (text) => dispatch({ type: "typing", text }),
  commitText: () => dispatch({ type: "commitText" }),
  cancel: () => dispatch({ type: "cancel" }),
  busy: () => dispatch({ type: "busy" }),
  idle: () => dispatch({ type: "idle" }),
  connect: (from, to) => void save([{ op: "addEdge", from, to, kind: edgeKindFor(board.nodeType(from)!, board.nodeType(to)!) }], to),
  removeEdge: (e) => void save([{ op: "removeEdge", from: e.from, to: e.to, kind: e.kind }]),
  removeNode: (id) => void confirmRemove(id),
  select: () => {},
  navigate: (p) => go(slug, p.split("#")[0]),
});

function dispatch(e: Parameters<typeof reduce>[1]): void {
  const r = reduce(edit, e);
  edit = r.state;
  $("pending").hidden = !edit.pending.length;
  $("pending").textContent = edit.pending.length ? `ほかの変更 ${edit.pending.length} 件を待機中（編集を終えると反映します）` : "";
  $("conflict").hidden = edit.mode !== "conflict";
  for (const f of r.effects) void run(f);
}

async function run(f: Effect): Promise<void> {
  if (f.type === "error") return toast(f.message, true);
  if (f.type === "reload") return reload();
  if (f.type === "save") {
    const anchor = edit.draft?.id;
    await save(f.ops, anchor, true, edit.draft?.original);
  }
}

/** Sends ops based on the version on screen. A conflict keeps the draft; an invalid op shows why. */
async function save(ops: Op[], anchor?: string, fromText = false, original?: string, baseVersion = version): Promise<ApplyResult | null> {
  try {
    let r = await api.apply(slug, baseVersion, ops);
    if (!r.ok && r.reason === "conflict") {
      // Someone else saved meanwhile. Redo the edit on the latest version when it does not touch what they changed.
      const latest = await api.model(slug);
      if (canRebase(ops, latest.data, original)) {
        version = latest.version;
        r = await api.apply(slug, version, ops);
      }
    }
    if (r.ok) {
      lastAnchor = anchor;
      if (fromText) board.closeEditor();
      dispatch({ type: "saved" });
      await reload(anchor);
      board.mark([...r.summary.added, ...r.summary.updated], warningNodeIds(r.warnings, model!["big-picture"].nodes.map((n) => n.id)));
      if (r.warnings.length) toast(`保存しました（決まりの違反 ${r.warnings.length} 件。HTML はまだ書いていません）`);
      return r;
    }
    if (r.reason === "conflict") {
      if (ops.some((o) => o.op === "removeNode")) return r; // the caller asks again with a fresh list
      dispatch({ type: "conflict" });
      return r;
    }
    toast(r.errors.join(" / "), true);
    if (!fromText) dispatch({ type: "idle" });
    return r;
  } catch (e) {
    toast((e as Error).message, true);
    dispatch({ type: "idle" });
    return null;
  }
}

async function reload(anchor = lastAnchor): Promise<void> {
  lastAnchor = undefined;
  if (!slug) return;
  const m = await api.model(slug);
  version = m.version;
  model = m.data;
  setWarnings(m.warnings, m.htmlCurrent);
  if (page === "history") return renderHistory();
  await board.refresh(api.pageUrl(slug, page), m.data, { anchor });
  board.mark([], warningNodeIds(warnings, m.data["big-picture"].nodes.map((n) => n.id)));
  await refreshSession();
  if (edit.mode === "text" && edit.draft) board.editText(edit.draft.id, edit.draft.text);
}

function setWarnings(w: string[], htmlCurrent: boolean): void {
  warnings = w;
  const el = $("rules") as HTMLDetailsElement;
  el.hidden = !w.length && htmlCurrent;
  el.querySelector("summary")!.textContent = w.length ? `HTML は未更新（決まりの違反 ${w.length} 件）` : "HTML がデータと一致していません（render で書き出せます）";
  el.querySelector("ul")!.replaceChildren(...w.map((x) => Object.assign(document.createElement("li"), { textContent: x })));
}

async function confirmRemove(id: string, again = false): Promise<void> {
  let preview: { version: number; removal: Removal };
  try {
    preview = await api.previewRemove(slug, id);
  } catch (e) {
    return toast((e as Error).message, true);
  }
  const r = preview.removal;
  const text = (nid: string) => model?.["big-picture"].nodes.find((n) => n.id === nid)?.text ?? nid;
  const items = [
    ...r.attached.map((x) => `貼られた付箋「${text(x)}」`),
    ...r.edges.map((e) => `矢印 ${text(e.from)} → ${text(e.to)}`),
    ...r.glossaryRefs.map((g) => `用語「${g.term}」の関連付箋`),
    ...r.transitions.map((t) => `状態遷移 ${t.lifecycle}: ${t.from} → ${t.to}`),
    ...r.rejections.map((x) => `拒否 ${x.lifecycle}: ${x.state}`),
  ];
  const lead = again ? "<p><b>確認している間にモデルが変わったので、もう一度確かめてください。</b></p>" : "";
  const ok = await modal(`付箋「${text(id)}」を消します`, lead + (items.length ? `<p>一緒に消えるもの（${items.length}）:</p><ul>${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul><p>履歴から戻せます。</p>` : "<p>一緒に消えるものはありません。履歴から戻せます。</p>"), "消す");
  if (!ok) return;
  // The delete goes against the version the list was made from; if anything changed, show the new list.
  const res = await save([{ op: "removeNode", id }], undefined, false, undefined, preview.version);
  if (res && !res.ok && res.reason === "conflict") {
    await reload();
    if (model?.["big-picture"].nodes.some((n) => n.id === id)) await confirmRemove(id, true);
  }
}

function modal(title: string, body: string, okLabel: string): Promise<boolean> {
  $("modal-title").textContent = title;
  $("modal-body").innerHTML = body;
  const actions = $("modal-actions");
  actions.innerHTML = `<button type="button" class="btn" data-v="0">やめる</button><button type="button" class="btn danger" data-v="1">${esc(okLabel)}</button>`;
  $("modal").hidden = false;
  return new Promise((resolve) => {
    actions.onclick = (e) => {
      const v = (e.target as HTMLElement).dataset.v;
      if (v === undefined) return;
      $("modal").hidden = true;
      resolve(v === "1");
    };
  });
}

let toastTimer = 0;
function toast(text: string, bad = false): void {
  const t = $("toast");
  t.textContent = text;
  t.style.borderColor = bad ? "#d64545" : "";
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), bad ? 8000 : 4000);
}

function renderPalette(): void {
  const p = $("palette");
  const domains = model?.["big-picture"].domains ?? [];
  const sel = board.selection;
  p.innerHTML = TYPES.map(([t, ja, c]) => `<button type="button" data-t="${t}"><i style="background:${c}"></i>${ja}</button>`).join("") +
    (sel ? '<span class="foot">選んでいる付箋の後ろにつなげて追加します</span>' : `<label>ドメイン <select id="add-domain">${domains.map((d) => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join("")}</select></label>`);
  p.onclick = async (e) => {
    const t = (e.target as HTMLElement).closest("button")?.dataset.t as NodeType | undefined;
    if (!t) return;
    p.hidden = true;
    const domain = sel ? undefined : ($("add-domain") as HTMLSelectElement | null)?.value;
    const before = new Set(model!["big-picture"].nodes.map((n) => n.id));
    await save([{ op: "addNode", node: { type: t, text: TYPES.find((x) => x[0] === t)![1], domain, ...(t === "policy" ? { execution: "async" as const } : {}) }, ...(sel ? { after: sel } : {}) }], sel ?? undefined);
    const added = model!["big-picture"].nodes.find((n) => !before.has(n.id));
    if (added) board.editText(added.id);
  };
}

async function go(s: string, p: string): Promise<void> {
  if (location.hash !== `#/${s}/${p}`) history.replaceState(null, "", `#/${encodeURIComponent(s)}/${p}`);
  const changedProject = s !== slug;
  slug = s;
  page = p;
  edit = initialEdit();
  renderNav();
  if (!slug) return;
  if (changedProject) {
    live?.close();
    live = connectLive(slug, {
      status: (st) => {
        $("live").classList.toggle("on", st === "live");
        $("live").querySelector("span")!.textContent = st === "live" ? "ライブ接続" : st === "retrying" ? "再接続中…" : "接続中…";
      },
      version: (e) => {
        if (e.version === version) return;
        $("file-error").hidden = true;
        if (e.author.kind !== "person" || edit.mode !== "idle") toast(toastText(e.author, e.summary));
        const recent = [...e.summary.added, ...e.summary.updated];
        if (edit.mode === "idle") void reload().then(() => board.mark(recent, warningNodeIds(warnings, model!["big-picture"].nodes.map((n) => n.id))));
        else dispatch({ type: "remoteVersion", version: e.version });
      },
      fileError: (errors) => {
        $("file-error").hidden = false;
        $("file-error").textContent = `ファイルを読めません（前の版を表示しています）: ${errors.join(" / ")}`;
      },
    });
  }
  const m = await api.model(slug);
  version = m.version;
  model = m.data;
  setWarnings(m.warnings, m.htmlCurrent);
  $("bar").hidden = page !== "big-picture.html";
  $("session-bar").hidden = page !== "big-picture.html";
  ($("stage").parentElement as HTMLElement).hidden = page === "history";
  $("history").hidden = page !== "history";
  if (page === "history") return renderHistory();
  await board.load(api.pageUrl(slug, page), page, m.data);
  board.mark([], warningNodeIds(warnings, m.data["big-picture"].nodes.map((n) => n.id)));
  await refreshSession();
}

/** Re-reads what changed since this tab's base and shows it on the board and in 「このセッションの変更」. */
async function refreshSession(): Promise<void> {
  const on = page === "big-picture.html" && !!slug;
  $("session-bar").hidden = !on;
  $("changes").hidden = true;
  if (!on) return;
  const store = tabStore();
  const base = baseFor(store, slug, version);
  $("base-label").textContent = baseText(store, slug, base);
  const show = showChanges(store);
  ($("show-changes") as HTMLInputElement).checked = show;
  try {
    diff = await api.sessionDiff(slug, base);
  } catch (e) {
    diff = null;
    return toast((e as Error).message, true);
  }
  const textOf = (id: string) => model?.["big-picture"].nodes.find((n) => n.id === id)?.text ?? id;
  renderChanges($("changes"), diff, textOf, (id) => board.focusNode(id));
  $("changes").hidden = !show;
  board.markSession(show ? diff : null);
}

function renderHistory(): Promise<void> {
  const compare = (v: number) => {
    setBase(tabStore(), slug, v);
    location.hash = `#/${encodeURIComponent(slug)}/big-picture.html`;
  };
  return showHistory(slug, { list: $("h-items"), detail: $("h-detail") }, compare, async (v) => {
    const seen = version;
    const ok = await modal(`版 ${v} に戻します`, "<p>今の版は履歴に残ります。戻すことも新しい版として記録します。</p>", "戻す");
    if (!ok) return;
    const r = await api.restore(slug, v, seen);
    if (!r.ok) toast(r.reason === "invalid" ? r.errors.join(" / ") : "確認している間に別の変更が入りました。履歴を確かめてから、もう一度戻してください。", true);
    await reload();
  });
}

function renderNav(): void {
  $("projects").replaceChildren(...projects.map((p) => {
    const a = document.createElement("a");
    a.href = `#/${encodeURIComponent(p.slug)}/${page}`;
    a.textContent = p.name;
    a.setAttribute("aria-current", String(p.slug === slug));
    return a;
  }));
  const p = projects.find((x) => x.slug === slug);
  document.title = p ? `${p.name} · ライブボード · event-storming-mcp` : "event-storming-mcp";
  $("title").textContent = p ? p.name : projects.length ? "プロジェクトを選んでください" : "プロジェクトがありません（event-storming-mcp add <model-dir> か MCP の register_project で登録）";
  $("tabs").replaceChildren(...(p ? PAGES : []).map(([f, ja]) => {
    const a = document.createElement("a");
    a.href = `#/${encodeURIComponent(slug)}/${f}`;
    a.textContent = ja;
    if (f === page) a.setAttribute("aria-current", "page");
    return a;
  }));
  const sel = $("target") as HTMLSelectElement;
  $("target-wrap").hidden = !p || p.checkouts.length < 2;
  if (p) {
    sel.innerHTML = p.checkouts.map((c) => `<option ${c.root === p.writeTarget ? "selected" : ""}>${esc(c.root)}</option>`).join("");
    sel.onchange = async () => {
      await api.writeTarget(slug, sel.value);
      projects = await api.projects();
      await reload();
    };
  }
}

function route(): void {
  const m = /^#\/([^/]+)\/(.+)$/.exec(location.hash);
  const s = m ? decodeURIComponent(m[1]) : projects[0]?.slug ?? "";
  void go(s, m?.[2] ?? "big-picture.html");
}

$("add").addEventListener("click", () => {
  renderPalette();
  $("palette").hidden = !$("palette").hidden;
});
$("reload-latest").addEventListener("click", () => dispatch({ type: "reloadLatest" }));
$("rebase").addEventListener("click", () => {
  setBase(tabStore(), slug, version);
  void refreshSession();
});
$("show-changes").addEventListener("change", (e) => {
  setShowChanges(tabStore(), (e.target as HTMLInputElement).checked);
  void refreshSession();
});
window.addEventListener("hashchange", route);

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

projects = await api.projects();
route();
setInterval(async () => {
  const next = await api.projects().catch(() => projects);
  if (next.length !== projects.length) {
    projects = next;
    renderNav();
  }
}, 5000);
