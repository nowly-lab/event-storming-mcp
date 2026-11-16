// Renders the domain model pages. Output depends only on the data, so `check` can compare it.
import { layoutBoard, layoutGraph } from './layout.mjs';

const TYPE = {
  actor: { ja: 'アクター', en: 'Actor', hint: '人・役割' },
  command: { ja: 'コマンド', en: 'Command', hint: '依頼・操作' },
  event: { ja: 'イベント', en: 'Domain Event', hint: '起きたこと' },
  policy: { ja: 'ポリシー', en: 'Policy', hint: '〜されたら' },
  aggregate: { ja: '集約', en: 'Aggregate', hint: '一緒に更新するデータ' },
  external: { ja: '外部システム', en: 'External System', hint: '外のサービス' },
  readModel: { ja: 'リードモデル', en: 'Read Model', hint: '判断の前に見るもの' },
  hotspot: { ja: 'ホットスポット', en: 'Hotspot', hint: '未解決・懸念' },
};
const TYPE_ORDER = ['actor', 'command', 'event', 'policy', 'aggregate', 'external', 'readModel', 'hotspot'];
const EXEC = { sync: '同期', async: '非同期', scheduled: '定期', external: '外部' };

export const PAGES = [
  { file: 'big-picture', title: '全体像', desc: 'ドメインごとの付箋を、時間の流れに沿って矢印でつないだボード。' },
  { file: 'domain-glossary', title: '用語集', desc: '業務の言葉と、コード上の名前・関係する付箋・証拠。' },
  { file: 'event-command-map', title: 'コマンドとイベント', desc: '操作から出来事へ、出来事から次の操作へ。全体像から作る。' },
  { file: 'workflow-models', title: 'ワークフロー', desc: 'ライフサイクルごとの状態遷移図・遷移表・早見表。' },
  { file: 'context-map', title: 'コンテキスト', desc: '境界ごとの責任・持ち物・契約と、その関係。' },
];

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const jsonForScript = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

const CSS = `
:root {
  --wall: #fbfbf9; --wall-dot: #dcdcd4; --paper: #ffffff; --ink: #24241f; --ink-soft: #64645b;
  --line: #d9d9cf; --ring: #6d6d66; --accent: #2f5bd3; --focus: #2563eb; --row: #f4f4ef;
  --ok: #dbeafe; --bad: #fde2e4; --skip: #ececea; --undef: #fff4cc;
  --s-event: #ff9e4f; --s-command: #a9cdf1; --s-policy: #b985ca; --s-external: #eda1c6;
  --s-aggregate: #f4ce2c; --s-readModel: #c6e15c; --s-actor: #fdf6b6; --s-hotspot: #ef7088; --s-ink: #1c1a14; --hot: #ff4030;
  --f-note: "Klee One", "Hiragino Maru Gothic ProN", "Yu Gothic", cursive;
  --f-ui: "Zen Kaku Gothic New", "Hiragino Sans", "Yu Gothic", system-ui, sans-serif;
  --f-mono: "JetBrains Mono", ui-monospace, Menlo, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --wall: #1c1d1a; --wall-dot: #30312c; --paper: #24251f; --ink: #ecece6; --ink-soft: #a6a69c; --line: #3a3b35;
  --ring: #a8a89e; --accent: #8fb0ff; --focus: #93c5fd; --row: #2a2b25; --ok: #1e3a5f; --bad: #5b2530; --skip: #34352f; --undef: #4a4220; color-scheme: dark; } }
:root[data-theme="dark"] {
  --wall: #1c1d1a; --wall-dot: #30312c; --paper: #24251f; --ink: #ecece6; --ink-soft: #a6a69c; --line: #3a3b35;
  --ring: #a8a89e; --accent: #8fb0ff; --focus: #93c5fd; --row: #2a2b25; --ok: #1e3a5f; --bad: #5b2530; --skip: #34352f; --undef: #4a4220; color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--wall); color: var(--ink); font: 14px/1.65 var(--f-ui); }
a { color: var(--accent); }
.top { position: sticky; top: 0; z-index: 30; display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px max(16px, env(safe-area-inset-left, 0px)); background: var(--paper); border-bottom: 1px solid var(--line); }
.crumb { font-weight: 700; } .crumb span { color: var(--ink-soft); font-weight: 500; margin: 0 6px; }
.back { text-decoration: none; border: 1px solid var(--line); border-radius: 6px; padding: 3px 12px; color: var(--ink); background: var(--paper); }
main { padding: 24px max(16px, env(safe-area-inset-left, 0px)) 48px; display: grid; gap: 22px; min-width: 0; }
h1 { margin: 0; font-size: 26px; line-height: 1.3; text-wrap: balance; }
h2 { margin: 0; font-size: 18px; text-wrap: balance; }
h3 { margin: 0; font-size: 15px; }
.lede { margin: 4px 0 0; color: var(--ink-soft); max-width: 80ch; }
.meta { font-size: 12px; color: var(--ink-soft); font-family: var(--f-mono); }
.card { background: var(--paper); border: 1px solid var(--line); border-radius: 8px; padding: 16px; min-width: 0; }
.scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; background: var(--paper); }
th, td { border: 1px solid var(--line); padding: 7px 10px; text-align: left; vertical-align: top; }
th { background: var(--row); font-weight: 700; white-space: nowrap; }
code, .path { font-family: var(--f-mono); font-size: 12px; overflow-wrap: anywhere; }
.chip { display: inline-block; padding: 1px 8px; margin: 2px 4px 2px 0; border-radius: 4px; color: var(--s-ink); font-size: 12px; text-decoration: none; }
.code { display: inline-block; padding: 0 6px; margin: 2px 4px 2px 0; border-radius: 4px; background: var(--row); border: 1px solid var(--line); font: 12px var(--f-mono); }
.badge { display: inline-block; padding: 0 7px; border-radius: 999px; font-size: 11px; background: rgba(28,26,20,.14); color: var(--s-ink); margin-left: 6px; }
.legend { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; }
.legend i { display: inline-block; width: 18px; height: 18px; border-radius: 2px; vertical-align: -4px; margin-right: 6px; box-shadow: 0 1px 2px rgba(0,0,0,.25); }
.legend small { color: var(--ink-soft); margin-left: 4px; }
.foot { font-size: 12px; color: var(--ink-soft); }
ul.plain { margin: 0; padding-left: 18px; }
/* What the current plan changes: pulses while main has .show-changed (the toggle on each page). */
.changes { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; border-left: 4px solid var(--hot); }
.changes .list { flex: 1 1 320px; min-width: 0; }
.changes a.item { margin-right: 10px; white-space: nowrap; }
.toggle { font-size: 13px; white-space: nowrap; }
.new { display: inline-block; padding: 0 7px; margin-left: 6px; border-radius: 999px; background: var(--hot); color: #fff; font: 700 11px/1.6 var(--f-ui); vertical-align: 1px; }
@keyframes changed-ping {
  0% { box-shadow: 0 0 0 4px var(--ink), 0 0 0 4px rgba(255,64,48,.95), 0 10px 14px -6px rgba(0,0,0,.5); filter: brightness(1.15); }
  20% { filter: brightness(1); }
  70%, 100% { box-shadow: 0 0 0 4px var(--ink), 0 0 0 40px rgba(255,64,48,0), 0 10px 14px -6px rgba(0,0,0,.5); filter: brightness(1); } }
@keyframes chip-ping { 0% { box-shadow: 0 0 0 2px var(--ink), 0 0 0 2px rgba(255,64,48,.95); } 70%, 100% { box-shadow: 0 0 0 2px var(--ink), 0 0 0 12px rgba(255,64,48,0); } }
@keyframes row-flash { 0% { background-color: rgba(255,64,48,.38); } 60%, 100% { background-color: rgba(255,64,48,.1); } }
@keyframes svg-blink { 50% { stroke-opacity: .25; } }
.show-changed .chip.changed { box-shadow: 0 0 0 2px var(--ink); animation: chip-ping 1.2s ease-out infinite; }
.show-changed .is-changed > td, .show-changed .is-changed > th, .show-changed td.is-changed { animation: row-flash 1.2s ease-out infinite; }
.show-changed tr.is-changed > :first-child { box-shadow: inset 4px 0 0 var(--hot); }
.show-changed .lc.is-changed, .show-changed nav a.is-changed { outline: 3px solid var(--hot); outline-offset: 2px; }
.show-changed .gbox.is-changed { stroke: var(--hot); stroke-width: 4; animation: svg-blink 1.2s ease-in-out infinite; }
.show-changed .gedge.is-changed { stroke: var(--hot); stroke-width: 3; animation: svg-blink 1.2s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .show-changed .chip.changed, .show-changed .is-changed > td, .show-changed .is-changed > th, .show-changed td.is-changed, .show-changed .gbox.is-changed, .show-changed .gedge.is-changed { animation: none; }
  .show-changed .is-changed > td, .show-changed .is-changed > th, .show-changed td.is-changed { background-color: rgba(255,64,48,.18); } }
`;

// ---- pinch zoom ----------------------------------------------------------------
// Large diagrams sit in a zoom box: pinch (trackpad, touch, Safari gestures), Ctrl/⌘ + wheel,
// the +/− buttons or the + − 0 keys zoom around the pointer; scrolling pans as usual.
// CSS zoom (not transform) keeps text sharp and lets the scroll area follow the zoomed size.
const zoomBox = (inner, { cls = '', fit = 'none' } = {}) => `<div class="zoomable" data-fit="${fit}">
<div class="zoom-ctrl" role="toolbar" aria-label="拡大縮小"><button type="button" data-z="out" aria-label="縮小">−</button><output aria-live="polite">100%</output><button type="button" data-z="in" aria-label="拡大">＋</button><button type="button" data-z="fit">全体</button><button type="button" data-z="one">等倍</button></div>
<div class="zoom-view ${cls}" tabindex="0" aria-label="ピンチまたは Ctrl/⌘ + ホイールで拡大縮小"><div class="zoom-content">${inner}</div></div>
</div>`;

const ZOOM_CSS = `
.zoomable { position: relative; min-width: 0; }
.zoom-view { overflow: auto; overscroll-behavior: contain; touch-action: pan-x pan-y; max-height: 80vh; }
.zoom-view:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.zoom-content { width: max-content; }
.zoom-ctrl { position: absolute; top: 8px; right: 8px; z-index: 25; display: flex; align-items: center; gap: 2px; padding: 3px;
  background: var(--paper); border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 2px 6px rgba(0,0,0,.12); }
.zoom-ctrl button { min-width: 32px; height: 30px; padding: 0 8px; border: 0; border-radius: 6px; background: transparent; color: var(--ink); font: 500 14px var(--f-ui); cursor: pointer; }
.zoom-ctrl button:hover { background: var(--row); }
.zoom-ctrl button:focus-visible { outline: 2px solid var(--focus); }
.zoom-ctrl output { min-width: 3.4em; text-align: center; font: 12px var(--f-mono); color: var(--ink-soft); }`;

const ZOOM_JS = `(function(){
var MIN = 0.1, MAX = 4;
document.querySelectorAll('.zoomable').forEach(function (box) {
  var view = box.querySelector('.zoom-view'), content = box.querySelector('.zoom-content'), out = box.querySelector('output');
  var s = 1, w = content.offsetWidth, h = content.offsetHeight;
  function clamp(v) { return Math.min(MAX, Math.max(Math.min(MIN, fitAll()), v)); }
  function fitAll() { return Math.min(view.clientWidth / w, view.clientHeight / h); }
  function anchor(cx, cy) {
    var r = view.getBoundingClientRect();
    if (cx == null) { cx = r.left + view.clientWidth / 2; cy = r.top + view.clientHeight / 2; }
    var px = cx - r.left, py = cy - r.top;
    return { px: px, py: py, x: (view.scrollLeft + px) / s, y: (view.scrollTop + py) / s };
  }
  // Scale to v, keeping content point a.x/a.y under the screen point a.px/a.py.
  function set(v, a) {
    s = clamp(v); content.style.zoom = s; out.textContent = Math.round(s * 100) + '%';
    if (a) { view.scrollLeft = a.x * s - a.px; view.scrollTop = a.y * s - a.py; }
  }
  function zoomAt(v, cx, cy) { set(v, anchor(cx, cy)); }
  box.querySelector('.zoom-ctrl').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var z = b.dataset.z;
    if (z === 'in') zoomAt(s * 1.25); else if (z === 'out') zoomAt(s / 1.25);
    else if (z === 'one') zoomAt(1); else if (z === 'fit') { set(fitAll()); view.scrollLeft = 0; view.scrollTop = 0; }
  });
  view.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '+' || e.key === '=') zoomAt(s * 1.25); else if (e.key === '-') zoomAt(s / 1.25); else if (e.key === '0') zoomAt(1); else return;
    e.preventDefault();
  });
  // Trackpad pinch in Chrome, Edge and Firefox arrives as wheel + ctrlKey; so does Ctrl/⌘ + wheel.
  view.addEventListener('wheel', function (e) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    var d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomAt(s * Math.exp(-Math.max(-50, Math.min(50, d)) * 0.01), e.clientX, e.clientY);
  }, { passive: false });
  // Safari trackpad pinch arrives as gesture events.
  var touching = false, g = null;
  view.addEventListener('gesturestart', function (e) { e.preventDefault(); if (!touching) g = { s: s, a: anchor(e.clientX, e.clientY) }; });
  view.addEventListener('gesturechange', function (e) { e.preventDefault(); if (!touching && g) set(g.s * e.scale, g.a); });
  view.addEventListener('gestureend', function (e) { e.preventDefault(); g = null; });
  // Two-finger touch pinch: zoom and pan with the fingers' midpoint.
  var t = null;
  function mid(ts) { return { x: (ts[0].clientX + ts[1].clientX) / 2, y: (ts[0].clientY + ts[1].clientY) / 2, d: Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY) || 1 }; }
  view.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 2) return;
    touching = true; var m = mid(e.touches); t = { s: s, d: m.d, a: anchor(m.x, m.y) };
  }, { passive: true });
  view.addEventListener('touchmove', function (e) {
    if (!t || e.touches.length !== 2) return;
    e.preventDefault();
    var m = mid(e.touches), r = view.getBoundingClientRect();
    set(t.s * m.d / t.d, { x: t.a.x, y: t.a.y, px: m.x - r.left, py: m.y - r.top });
  }, { passive: false });
  view.addEventListener('touchend', function (e) { if (e.touches.length < 2) { t = null; touching = false; } });
  view.addEventListener('touchcancel', function () { t = null; touching = false; });
  // Start: fit the width (never above 100%) for wide boards; otherwise 100%.
  var fit = box.dataset.fit;
  set(fit === 'width' ? Math.min(1, view.clientWidth / w) : fit === 'all' ? Math.min(1, fitAll()) : 1);
});
// Bring a linked sticky into view at the current zoom.
var target = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
if (target && target.closest('.zoom-view')) target.scrollIntoView({ block: 'center', inline: 'center' });
})();`;

const shell = ({ file, title, product, body, extraCss = '', script = '' }) => `<!doctype html>
<!-- 生成物: 直接編集しないでください。元データ: data/*.json。scrum-domain-modeling の scripts/domain-model.mjs render で作り直します。 -->
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="generator" content="scrum-domain-modeling/domain-model.mjs">
<title>${esc(title)} · ${esc(product)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Klee+One:wght@600&family=Zen+Kaku+Gothic+New:wght@400;500;700&family=JetBrains+Mono:wght@400&display=swap">
<style>${CSS}${body.includes('class="zoomable"') ? ZOOM_CSS : ''}${extraCss}</style>
</head>
<body>
<header class="top"><div class="crumb">${esc(product)}<span>/</span>ドメインモデル${file === 'index' ? '' : `<span>/</span>${esc(title)}`}</div>${file === 'index' ? '' : '<a class="back" href="index.html">← 一覧へ</a>'}</header>
<main class="show-changed" id="main">
${body}
</main>
${body.includes('id="show-changed"') ? `<script>${CHANGED_JS}</script>` : ''}
${script ? `<script>${script}</script>` : ''}
${body.includes('class="zoomable"') ? `<script>${ZOOM_JS}</script>` : ''}
</body>
</html>
`;

const chipFor = (node) => `<a class="chip${node.changed ? ' changed' : ''}" href="big-picture.html#n-${esc(node.id)}" style="background:var(--s-${node.type})" title="${esc(TYPE[node.type].ja)}">${esc(node.text)}</a>`;
const evidenceList = (ev) => (ev && ev.length ? ev.map((e) => `<div class="path">${esc(e.path)}${e.symbol ? ` <span class="code">${esc(e.symbol)}</span>` : ''}</div>`).join('') : '<span class="foot">—</span>');
const checkedLine = (d) => `<div class="meta">確認したリビジョン ${esc(d.checked.revision)} · ${esc(d.checked.date)}</div>`;
const CHANGED_JS = `document.getElementById('show-changed').addEventListener('change', function (e) { document.getElementById('main').classList.toggle('show-changed', e.target.checked); });`;
const NEW = '<span class="new">変更</span>';
const isChanged = (on) => (on ? ' is-changed' : '');
// A card listing what the current plan changes on this page, with the toggle. Empty when nothing changes.
const changesBar = (items, what) => (items.length ? `<section class="card changes"><h2>今回の計画で変わる${what}（${items.length}）</h2><div class="list">${items.map((x) => `<a class="item" href="#${esc(x.id)}">${esc(x.label)}</a>`).join('')}</div><label class="toggle"><input type="checkbox" id="show-changed" checked> 光らせて示す</label></section>` : '');
const legend = () => `<div class="legend">${TYPE_ORDER.map((t) => `<span><i style="background:var(--s-${t})"></i>${TYPE[t].ja}<small>${TYPE[t].hint}</small></span>`).join('')}</div>`;

// ---- big picture -------------------------------------------------------------
async function bigPicture(m, product) {
  const bp = m['big-picture'];
  const L = await layoutBoard(bp);
  const domainName = new Map(bp.domains.map((d) => [d.id, d.name]));
  const byId = new Map(bp.nodes.map((n) => [n.id, n]));
  const changedCount = bp.nodes.filter((n) => n.changed).length;
  let svg = `<svg class="layer" width="${L.width}" height="${L.height}" aria-hidden="true"><defs><marker id="head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 1L10 5L0 9z" class="headfill"/></marker></defs>`;
  svg += `<text class="timeline" x="40" y="44">時間の流れ</text><path class="edge" d="M40 60 H200" marker-end="url(#head)" style="stroke-width:3"/>`;
  for (const g of L.rings) {
    svg += `<ellipse class="ring" cx="${g.cx}" cy="${g.cy}" rx="${g.rx}" ry="${g.ry}"/><text class="ring-label" x="${g.cx}" y="${g.top + 38}" text-anchor="middle">${esc(domainName.get(g.domain) || g.domain)}</text>`;
  }
  const shift = L.edges[0]?.shift || 0;
  svg += `<g transform="translate(${shift},0)">`;
  for (const e of L.edges) svg += `<path class="edge${e.kind === 'result' ? ' result' : ''}" data-from="${esc(e.from)}" data-to="${esc(e.to)}" d="${e.d}" marker-end="url(#head)"/>`;
  svg += '</g></svg>';
  const notes = L.stickies.map((s) => {
    const n = s.node;
    const badge = n.type === 'policy' ? `<span class="badge">${EXEC[n.execution]}</span>` : '';
    return `<button type="button" class="note n-${n.type}${n.changed ? ' changed' : ''}" id="n-${esc(n.id)}" data-id="${esc(n.id)}" style="left:${s.r.x}px;top:${s.r.y}px;width:${s.r.w}px;height:${s.r.h}px;z-index:${s.z}" aria-label="${esc(`${TYPE[n.type].ja}: ${n.text}（${domainName.get(n.domain) || ''}）`)}">${n.type === 'actor' ? '' : `<span class="kind">${TYPE[n.type].en}</span>`}<span class="txt">${esc(n.text)}</span>${badge}</button>`;
  }).join('');

  const flowIn = new Map(), flowOut = new Map();
  for (const e of bp.edges) {
    (flowOut.get(e.from) || flowOut.set(e.from, []).get(e.from)).push(e.to);
    (flowIn.get(e.to) || flowIn.set(e.to, []).get(e.to)).push(e.from);
  }
  const panelData = Object.fromEntries(bp.nodes.map((n) => [n.id, {
    type: TYPE[n.type].ja, color: n.type, domain: domainName.get(n.domain) || n.domain, text: n.text,
    execution: n.execution ? EXEC[n.execution] : null, invariants: n.invariants || [], note: n.note || null, changed: !!n.changed,
    attachedTo: n.attach ? byId.get(n.attach.to)?.text || null : null,
    from: (flowIn.get(n.id) || []).map((id) => byId.get(id)?.text).filter(Boolean),
    to: (flowOut.get(n.id) || []).map((id) => byId.get(id)?.text).filter(Boolean),
    evidence: (n.evidence || []).map((e) => ({ path: e.path, symbol: e.symbol || null, note: e.note || null })),
  }]));

  const body = `<div><h1>${esc(bp.title)}</h1>${bp.summary ? `<p class="lede">${esc(bp.summary)}</p>` : ''}${checkedLine(bp)}</div>
<div class="toolbar card">${legend()}${changedCount ? `<label class="toggle"><input type="checkbox" id="show-changed" checked> 今回の計画で変わる付箋（${changedCount}）を光らせて示す</label>` : ''}</div>
<div class="board-wrap">
  ${zoomBox(`<div class="board" id="board" style="width:${L.width}px;height:${L.height}px">${svg}${notes}</div>`, { cls: 'wall', fit: 'width' })}
  <aside class="panel card" id="panel" aria-live="polite"><h2>付箋の詳細</h2><p class="foot">付箋を選ぶと、種類・ドメイン・つながり・コードの場所が出ます。</p></aside>
</div>
<p class="foot">ピンチ（または Ctrl/⌘ + ホイール、右上のボタン）で拡大縮小できます。実線は流れ、点線はイベントがリードモデルに反映されることを表します。重ねて貼った付箋は、その下の付箋に付く外部システム・懸念などです。</p>
<script type="application/json" id="nodes">${jsonForScript(panelData)}</script>`;

  const extraCss = `
.toolbar { display: flex; flex-wrap: wrap; gap: 10px 24px; align-items: center; justify-content: space-between; padding: 10px 14px; }

.board-wrap { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 16px; align-items: start; }
@media (max-width: 900px) { .board-wrap { grid-template-columns: minmax(0, 1fr); } }
.wall { border: 1px solid var(--line); border-radius: 8px; background-color: var(--wall); background-image: radial-gradient(var(--wall-dot) 1px, transparent 1px); background-size: 20px 20px; }
.board { position: relative; }
.layer { position: absolute; left: 0; top: 0; overflow: visible; }
.ring { fill: none; stroke: var(--ring); stroke-width: 1.6; }
.ring-label { font: 700 20px var(--f-ui); fill: var(--ink); paint-order: stroke; stroke: var(--wall); stroke-width: 6px; }
.timeline { font: 700 16px var(--f-ui); fill: var(--ink); }
.edge { fill: none; stroke: var(--ink); stroke-width: 2; }
.edge.result { stroke-width: 2.4; stroke-dasharray: 0.1 6; stroke-linecap: round; }
.edge.dim { opacity: .15; }
.headfill { fill: var(--ink); }
.note { position: absolute; border: 0; margin: 0; padding: 7px 8px; color: var(--s-ink); font: 600 13px/1.4 var(--f-note); text-align: center;
  display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer; overflow: hidden; overflow-wrap: anywhere;
  box-shadow: 0 1px 1px rgba(0,0,0,.1), 0 8px 10px -7px rgba(0,0,0,.45); transition: transform .12s ease; }
.note:hover, .note:focus-visible, .note.sel { transform: translateY(-3px); z-index: 20 !important; }
.note:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.note.sel { outline: 3px solid var(--accent); outline-offset: 2px; }
.note .kind { font: 500 10px var(--f-ui); letter-spacing: .04em; opacity: .6; margin-bottom: 2px; }
.n-actor { font: 500 12px/1.3 var(--f-ui); box-shadow: 0 0 0 1px rgba(0,0,0,.45), 0 6px 8px -6px rgba(0,0,0,.5); }
${TYPE_ORDER.map((t) => `.n-${t} { background: var(--s-${t}); }`).join('\n')}
.show-changed .note.changed { box-shadow: 0 0 0 4px var(--ink), 0 10px 14px -6px rgba(0,0,0,.5); animation: changed-ping 1.2s ease-out infinite; }
@media (prefers-reduced-motion: reduce) { .note { transition: none; } .show-changed .note.changed { animation: none; box-shadow: 0 0 0 4px var(--ink), 0 0 0 8px rgba(255,64,48,.9), 0 10px 14px -6px rgba(0,0,0,.5); } }`;

  const script = `(function(){
var data = JSON.parse(document.getElementById('nodes').textContent);
var board = document.getElementById('board'), panel = document.getElementById('panel');
var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); };
function row(k, v) { return v ? '<dt>' + k + '</dt><dd>' + v + '</dd>' : ''; }
function show(id) {
  var d = data[id]; if (!d) return;
  board.querySelectorAll('.note.sel').forEach(function (n) { n.classList.remove('sel'); });
  var el = document.getElementById('n-' + id); if (el) el.classList.add('sel');
  board.querySelectorAll('.edge[data-from]').forEach(function (p) { p.classList.toggle('dim', p.dataset.from !== id && p.dataset.to !== id); });
  var ev = d.evidence.map(function (e) { return '<div class="path">' + esc(e.path) + (e.symbol ? ' <span class="code">' + esc(e.symbol) + '</span>' : '') + (e.note ? '<div class="foot">' + esc(e.note) + '</div>' : '') + '</div>'; }).join('');
  panel.innerHTML = '<h2>付箋の詳細</h2><div class="head" style="background:var(--s-' + d.color + ')">' + esc(d.text) + '</div><dl>' +
    row('種類', esc(d.type)) + row('ドメイン', esc(d.domain)) + row('実行', d.execution && esc(d.execution)) + row('不変条件', d.invariants.map(esc).join('<br>')) + row('貼り先', d.attachedTo && esc(d.attachedTo)) +
    row('前', d.from.map(esc).join('<br>')) + row('次', d.to.map(esc).join('<br>')) + row('メモ', d.note && esc(d.note)) +
    row('今回の計画', d.changed ? '変わる' : '') + row('証拠', ev || '—') + '</dl>';
}
board.addEventListener('click', function (e) { var n = e.target.closest('.note'); if (n) show(n.dataset.id); });
if (location.hash.indexOf('#n-') === 0) show(location.hash.slice(3));
})();`;
  return shell({ file: 'big-picture', title: PAGES[0].title, product, body, extraCss, script });
}

// ---- glossary -------------------------------------------------------------------
function glossary(m, product) {
  const g = m['domain-glossary'];
  const byId = new Map(m['big-picture'].nodes.map((n) => [n.id, n]));
  const termChanged = (t) => !!t.changed || (t.nodes || []).some((id) => byId.get(id)?.changed);
  const rows = g.terms.map((t, i) => `<tr id="term-${i}" class="${isChanged(termChanged(t))}"><th scope="row">${esc(t.term)}${t.changed ? NEW : ''}</th><td>${esc(t.meaning)}</td><td>${(t.code || []).map((c) => `<span class="code">${esc(c)}</span>`).join('') || '—'}</td><td>${(t.nodes || []).map((id) => chipFor(byId.get(id))).join('') || '—'}</td><td>${evidenceList(t.evidence)}</td></tr>`).join('');
  const body = `<div><h1>${esc(g.title)}</h1>${g.summary ? `<p class="lede">${esc(g.summary)}</p>` : ''}${checkedLine(g)}</div>
${changesBar(g.terms.map((t, i) => ({ t, id: `term-${i}`, label: t.term })).filter((x) => termChanged(x.t)), '用語')}
<div class="scroll"><table><thead><tr><th>用語</th><th>意味</th><th>コード上の名前</th><th>関係する付箋</th><th>証拠</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  return shell({ file: 'domain-glossary', title: PAGES[1].title, product, body, extraCss: 'th[scope=row]{background:var(--paper);white-space:normal;min-width:7em}' });
}

// ---- event / command map (derived from the big picture) ----------------------------
export function deriveEventCommandMap(bp) {
  const byId = new Map(bp.nodes.map((n) => [n.id, n]));
  const out = new Map(), inc = new Map();
  for (const e of bp.edges) if (e.kind === 'flow') {
    (out.get(e.from) || out.set(e.from, []).get(e.from)).push(byId.get(e.to));
    (inc.get(e.to) || inc.set(e.to, []).get(e.to)).push(byId.get(e.from));
  }
  const attachedTo = (id, type) => bp.nodes.filter((n) => n.attach?.to === id && n.type === type);
  const commands = bp.nodes.filter((n) => n.type === 'command' && !n.attach).map((c) => {
    // command → (aggregate | external) → event
    const events = [];
    const walk = (id, depth) => { for (const x of out.get(id) || []) { if (x.type === 'event') { if (!events.includes(x)) events.push(x); } else if (depth < 2 && (x.type === 'external' || x.type === 'aggregate')) walk(x.id, depth + 1); } };
    walk(c.id, 0);
    const next = out.get(c.id) || [];
    return {
      domain: c.domain,
      actors: (inc.get(c.id) || []).filter((x) => x.type === 'actor'),
      // read models looked at before the command: into the command, into its actor, or stuck on it
      readModels: [...new Set([...(inc.get(c.id) || []), ...(inc.get(c.id) || []).filter((x) => x.type === 'actor').flatMap((a) => inc.get(a.id) || [])]
        .filter((x) => x.type === 'readModel').concat(attachedTo(c.id, 'readModel')))],
      policies: (inc.get(c.id) || []).filter((x) => x.type === 'policy'),
      command: c,
      aggregates: next.filter((x) => x.type === 'aggregate'),
      externals: next.filter((x) => x.type === 'external').concat(attachedTo(c.id, 'external')),
      events,
    };
  });
  const policies = bp.nodes.filter((n) => n.type === 'policy' && !n.attach).map((p) => {
    // event → policy → command, or policy → actor → command when a person decides.
    const next = out.get(p.id) || [];
    const actors = next.filter((x) => x.type === 'actor');
    return {
      domain: p.domain,
      events: (inc.get(p.id) || []).filter((x) => x.type === 'event'),
      policy: p,
      actors,
      commands: [...next.filter((x) => x.type === 'command'), ...actors.flatMap((a) => (out.get(a.id) || []).filter((x) => x.type === 'command'))],
    };
  });
  return { commands, policies };
}

function eventCommandMap(m, product) {
  const bp = m['big-picture'];
  const { commands, policies } = deriveEventCommandMap(bp);
  const cell = (list) => list.length ? list.map(chipFor).join('') : '<span class="foot">—</span>';
  const byDomain = (rows) => bp.domains.map((d) => [d, rows.filter((r) => r.domain === d.id)]).filter(([, r]) => r.length);
  const withInvariants = (n) => chipFor(n) + (n.invariants?.length ? `<ul class="inv">${n.invariants.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
  const owners = (list) => list.length ? list.map(withInvariants).join('') : '<span class="foot">—</span>';
  const cmdChanged = (r) => [r.command, ...r.readModels, ...r.policies, ...r.actors, ...r.aggregates, ...r.externals, ...r.events].some((n) => n.changed);
  const polChanged = (r) => [r.policy, ...r.events, ...r.actors, ...r.commands].some((n) => n.changed);
  const t1 = byDomain(commands).map(([d, rows]) => `<tr class="group"><th colspan="5">${esc(d.name)}</th></tr>` + rows.map((r) => `<tr id="c-${esc(r.command.id)}" class="${isChanged(cmdChanged(r))}"><td>${r.readModels.length ? `${cell(r.readModels)}<span class="foot"> を見て</span><br>` : ''}${cell([...r.policies, ...r.actors])}</td><td>${chipFor(r.command)}</td><td>${owners([...r.aggregates, ...r.externals])}</td><td>${cell(r.events)}</td><td>${evidenceList(r.command.evidence)}</td></tr>`).join('')).join('');
  const t2 = byDomain(policies).map(([d, rows]) => `<tr class="group"><th colspan="4">${esc(d.name)}</th></tr>` + rows.map((r) => `<tr id="p-${esc(r.policy.id)}" class="${isChanged(polChanged(r))}"><td>${r.events.length ? cell(r.events) : '<span class="foot">（定期）</span>'}</td><td>${chipFor(r.policy)}<span class="badge">${EXEC[r.policy.execution]}</span></td><td>${r.actors.length ? `${cell(r.actors)}<span class="foot"> が判断して</span><br>` : ''}${cell(r.commands)}</td><td>${evidenceList(r.policy.evidence)}</td></tr>`).join('')).join('');
  const body = `<div><h1>コマンドとイベント</h1><p class="lede">全体像の付箋と矢印から作った表です。直すときは data/big-picture.json を直します。</p>${checkedLine(bp)}</div>
${changesBar([...commands.filter(cmdChanged).map((r) => ({ id: `c-${r.command.id}`, label: r.command.text })), ...policies.filter(polChanged).map((r) => ({ id: `p-${r.policy.id}`, label: r.policy.text }))], '行')}
<section class="card"><h2>操作から出来事へ</h2><p class="foot">（リードモデルを見て）アクター（またはポリシー） → コマンド → 集約・外部システム → イベント。集約は一緒に更新しないと整合性が崩れるデータのまとまりで、その下にいつでも守るルール（不変条件）を並べています。</p>
<div class="scroll"><table><thead><tr><th>だれが</th><th>コマンド</th><th>集約・外部システム</th><th>イベント</th><th>証拠</th></tr></thead><tbody>${t1}</tbody></table></div></section>
<section class="card"><h2>出来事から次の操作へ</h2><p class="foot">イベント → ポリシー（実行方式） → コマンド。ポリシーは、イベントが起きたときに次に何をするかを決めるルールです。人が判断するときはアクターをはさみます。</p>
<div class="scroll"><table><thead><tr><th>イベント</th><th>ポリシー</th><th>コマンド</th><th>証拠</th></tr></thead><tbody>${t2 || '<tr><td colspan="4" class="foot">ポリシーはまだありません。</td></tr>'}</tbody></table></div></section>
<div class="card">${legend()}</div>`;
  return shell({ file: 'event-command-map', title: PAGES[2].title, product, body, extraCss: 'tr.group th{background:var(--paper);font-size:15px;border-left:4px solid var(--ring)} ul.inv{margin:4px 0 6px;padding-left:18px;font-size:12px;color:var(--ink-soft)}' });
}

// ---- generic SVG for laid-out graphs ------------------------------------------------
function graphSvg(G, { boxClass = () => 'gbox', title }) {
  let s = `<svg class="graph" viewBox="0 0 ${G.width} ${G.height}" width="${G.width}" height="${G.height}" role="img" aria-label="${esc(title)}"><defs><marker id="gh-${esc(title.length)}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 1L10 5L0 9z" class="headfill"/></marker></defs>`;
  const mid = `gh-${esc(title.length)}`;
  for (const e of G.edges) {
    if (!e.points.length) continue;
    s += `<polyline class="gedge${isChanged(e.changed)}" points="${e.points.map((p) => p.join(',')).join(' ')}" marker-end="url(#${mid})"/>`;
    if (e.labelBox) s += `<rect class="glabel-bg" x="${e.labelBox.x}" y="${e.labelBox.y}" width="${e.labelBox.w}" height="${e.labelBox.h}" rx="3"/><text class="glabel" x="${e.labelBox.x + e.labelBox.w / 2}" y="${e.labelBox.y + 13}" text-anchor="middle">${esc(e.label)}</text>`;
  }
  for (const n of G.nodes) {
    s += `<rect class="${boxClass(n)}" x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="8"/><text class="gtext" x="${n.x + n.w / 2}" y="${n.y + (n.sub ? 24 : 27)}" text-anchor="middle">${esc(n.label)}</text>`;
    if (n.sub) s += `<text class="gsub" x="${n.x + n.w / 2}" y="${n.y + 43}" text-anchor="middle">${esc(n.sub)}</text>`;
  }
  return `${s}</svg>`;
}
const GRAPH_CSS = `
.graph { display: block; max-width: none; }
.gbox { fill: var(--paper); stroke: var(--ring); stroke-width: 1.5; }
.gbox.initial { stroke-width: 3; } .gbox.final { stroke-dasharray: 5 3; }
.gtext { font: 700 15px var(--f-ui); fill: var(--ink); } .gsub { font: 11px var(--f-mono); fill: var(--ink-soft); }
.gedge { fill: none; stroke: var(--ink); stroke-width: 1.6; }
.glabel { font: 12px var(--f-ui); fill: var(--ink); } .glabel-bg { fill: var(--wall); }
.headfill { fill: var(--ink); }`;

// ---- workflow models -------------------------------------------------------------
async function workflows(m, product) {
  const w = m['workflow-models'];
  const bpNodes = new Map(m['big-picture'].nodes.map((n) => [n.id, n]));
  const domainName = new Map(m['big-picture'].domains.map((d) => [d.id, d.name]));
  const sections = [], changedLcs = [];
  for (const lc of w.lifecycles) {
    const onChanged = (id) => !!bpNodes.get(id)?.changed;
    const trChanged = (t) => !!t.changed || onChanged(t.on);
    const rjChanged = (r) => !!r.changed || onChanged(r.on);
    const nChanged = lc.states.filter((s) => s.changed).length + lc.transitions.filter(trChanged).length + (lc.rejections || []).filter(rjChanged).length;
    if (nChanged) changedLcs.push({ id: `lc-${lc.id}`, label: `${lc.name}（${nChanged}）` });
    const st = new Map(lc.states.map((s) => [s.id, s]));
    // Columns are the big picture's commands and events that drive this lifecycle, in order of first use.
    const ons = [...new Set([...lc.transitions.map((t) => t.on), ...(lc.rejections || []).map((r) => r.on)])].map((id) => bpNodes.get(id));
    const G = await layoutGraph(
      lc.states.map((s) => ({ id: s.id, label: s.name, initial: s.initial, final: s.final, changed: !!s.changed })),
      lc.transitions.map((t) => ({ from: t.from, to: t.to, label: bpNodes.get(t.on)?.text || t.on, changed: trChanged(t) })),
    );
    const diagram = graphSvg(G, { title: lc.name, boxClass: (n) => `gbox${n.initial ? ' initial' : ''}${n.final ? ' final' : ''}${isChanged(n.changed)}` });
    const rejections = lc.rejections || [];
    const trRows = lc.transitions.map((t) => `<tr class="${isChanged(trChanged(t))}"><td>${esc(st.get(t.from).name)}</td><td>${chipFor(bpNodes.get(t.on))}</td><td>${esc(t.guard || '—')}</td><td>${esc(st.get(t.to).name)}</td><td>${esc(t.effect || '—')}</td><td>${evidenceList(t.evidence)}</td></tr>`).join('');
    let undefinedCount = 0;
    const matrix = `<table class="matrix"><thead><tr><th>状態 ＼ コマンド・イベント</th>${ons.map((n) => `<th>${chipFor(n)}</th>`).join('')}</tr></thead><tbody>${lc.states.map((s) => `<tr><th scope="row" class="${isChanged(s.changed)}">${esc(s.name)}${s.changed ? NEW : ''}</th>${ons.map((n) => {
      const ts = lc.transitions.filter((x) => x.from === s.id && x.on === n.id);
      const rj = rejections.find((x) => x.state === s.id && x.on === n.id);
      if (ts.length) return `<td class="m-ok${isChanged(ts.some(trChanged))}" title="${esc(ts.map((x) => x.guard || '').join(' / '))}">${ts.map((x) => `→ ${esc(st.get(x.to).name)}${x.guard ? '<small>（条件あり）</small>' : ''}`).join('<br>')}</td>`;
      if (rj) return `<td class="m-${rj.kind === 'invalid' ? 'bad' : 'skip'}${isChanged(rjChanged(rj))}" title="${esc(rj.reason)}">${rj.kind === 'invalid' ? '無効' : '無視'}<small>${esc(rj.reason)}</small></td>`;
      undefinedCount++;
      return '<td class="m-undef">未定義</td>';
    }).join('')}</tr>`).join('')}</tbody></table>`;
    sections.push(`<section class="card lc${isChanged(nChanged)}" id="lc-${esc(lc.id)}"><h2>${esc(lc.name)}${nChanged ? NEW : ''}</h2>${lc.domain ? `<div class="meta">ドメイン: ${esc(domainName.get(lc.domain) || lc.domain)}</div>` : ''}${lc.summary ? `<p class="lede">${esc(lc.summary)}</p>` : ''}
<h3>状態遷移図</h3>${zoomBox(diagram, { cls: 'diagram', fit: 'width' })}
<h3>遷移表</h3><div class="scroll"><table><thead><tr><th>遷移前</th><th>コマンド・イベント</th><th>条件</th><th>遷移後</th><th>起きること</th><th>証拠</th></tr></thead><tbody>${trRows}</tbody></table></div>
<h3>早見表（状態 × コマンド・イベント）</h3><div class="scroll">${matrix}</div>
<div class="legend mlegend"><span><i class="m-ok"></i>遷移</span><span><i class="m-bad"></i>無効（受け付けない）</span><span><i class="m-skip"></i>無視（受け付けるが変わらない）</span><span><i class="m-undef"></i>未定義（${undefinedCount} マス）</span></div>
${lc.evidence?.length ? `<div><h3>証拠</h3>${evidenceList(lc.evidence)}</div>` : ''}</section>`);
  }
  const body = `<div><h1>${esc(w.title)}</h1>${w.summary ? `<p class="lede">${esc(w.summary)}</p>` : ''}${checkedLine(w)}</div>
${changesBar(changedLcs, 'ライフサイクル')}
<nav class="card"><b>ライフサイクル</b>: ${w.lifecycles.map((lc) => `<a class="${isChanged(changedLcs.some((x) => x.id === `lc-${lc.id}`))}" href="#lc-${esc(lc.id)}">${esc(lc.name)}</a>`).join(' · ')}</nav>
${sections.join('\n')}`;
  const extraCss = `${GRAPH_CSS}
.lc { display: grid; gap: 12px; } .diagram { background: var(--wall); border: 1px solid var(--line); border-radius: 6px; }
.matrix td, .matrix th { text-align: center; } .matrix th[scope=row] { text-align: left; }
.m-ok { background: var(--ok); } .m-bad { background: var(--bad); } .m-skip { background: var(--skip); } .m-undef { background: var(--undef); color: var(--ink-soft); }
.show-changed .matrix td.is-changed { box-shadow: inset 0 0 0 3px var(--hot); }
.matrix small { display: block; font-size: 11px; color: var(--ink-soft); }
.mlegend i { box-shadow: none; border: 1px solid var(--line); }`;
  return shell({ file: 'workflow-models', title: PAGES[3].title, product, body, extraCss });
}

// ---- context map ------------------------------------------------------------------
async function contextMap(m, product) {
  const c = m['context-map'];
  const domainName = new Map(m['big-picture'].domains.map((d) => [d.id, d.name]));
  const G = await layoutGraph(c.contexts.map((x) => ({ id: x.id, label: x.name, sub: x.tech, changed: !!x.changed })), c.relations.map((r) => ({ from: r.from, to: r.to, label: r.label, changed: !!r.changed })));
  const ctxName = new Map(c.contexts.map((x) => [x.id, x.name]));
  const list = (xs) => (xs && xs.length ? `<ul class="plain">${xs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '—');
  const rows = c.contexts.map((x) => `<tr id="ctx-${esc(x.id)}" class="${isChanged(x.changed)}"><th scope="row">${esc(x.name)}${x.changed ? NEW : ''}${x.tech ? `<div class="meta">${esc(x.tech)}</div>` : ''}</th><td>${esc(x.responsibility)}</td><td>${list(x.owns)}</td><td>${list(x.contract)}</td><td>${list(x.guarantees)}</td><td>${(x.domains || []).map((d) => `<span class="code">${esc(domainName.get(d) || d)}</span>`).join('') || '—'}</td><td>${evidenceList(x.evidence)}</td></tr>`).join('');
  const body = `<div><h1>${esc(c.title)}</h1>${c.summary ? `<p class="lede">${esc(c.summary)}</p>` : ''}${checkedLine(c)}</div>
${changesBar([...c.contexts.filter((x) => x.changed).map((x) => ({ id: `ctx-${x.id}`, label: x.name })), ...c.relations.filter((r) => r.changed).map((r) => ({ id: 'relations', label: `${ctxName.get(r.from)} → ${ctxName.get(r.to)}：${r.label}` }))], '境界と関係')}
<section class="card" id="relations"><h2>関係図</h2>${zoomBox(graphSvg(G, { title: c.title, boxClass: (n) => `gbox${isChanged(n.changed)}` }), { cls: 'diagram', fit: 'width' })}</section>
<section class="card"><h2>責任と契約</h2><div class="scroll"><table><thead><tr><th>境界</th><th>責任</th><th>持っている状態</th><th>契約</th><th>保証すること</th><th>ドメイン</th><th>証拠</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  return shell({ file: 'context-map', title: PAGES[4].title, product, body, extraCss: `${GRAPH_CSS}.diagram{background:var(--wall);border:1px solid var(--line);border-radius:6px}th[scope=row]{background:var(--paper);white-space:normal;min-width:8em}` });
}

// How many items on each page the current plan changes (the same rules the pages use to highlight).
export function changeCounts(m) {
  const bp = m['big-picture'];
  const byId = new Map(bp.nodes.map((n) => [n.id, n]));
  const ch = (id) => !!byId.get(id)?.changed;
  const { commands, policies } = deriveEventCommandMap(bp);
  return {
    'big-picture': bp.nodes.filter((n) => n.changed).length,
    'domain-glossary': m['domain-glossary'].terms.filter((t) => t.changed || (t.nodes || []).some(ch)).length,
    'event-command-map': commands.filter((r) => [r.command, ...r.readModels, ...r.policies, ...r.actors, ...r.aggregates, ...r.externals, ...r.events].some((n) => n.changed)).length
      + policies.filter((r) => [r.policy, ...r.events, ...r.actors, ...r.commands].some((n) => n.changed)).length,
    'workflow-models': m['workflow-models'].lifecycles.reduce((a, lc) => a + lc.states.filter((s) => s.changed).length
      + lc.transitions.filter((t) => t.changed || ch(t.on)).length + (lc.rejections || []).filter((r) => r.changed || ch(r.on)).length, 0),
    'context-map': m['context-map'].contexts.filter((x) => x.changed).length + m['context-map'].relations.filter((r) => r.changed).length,
  };
}

// ---- index ----------------------------------------------------------------------
function index(m, product) {
  const bp = m['big-picture'];
  const counts = {
    'big-picture': `ドメイン ${bp.domains.length} · 付箋 ${bp.nodes.length} · 矢印 ${bp.edges.length}`,
    'domain-glossary': `用語 ${m['domain-glossary'].terms.length}`,
    'event-command-map': `コマンド ${bp.nodes.filter((n) => n.type === 'command').length} · ポリシー ${bp.nodes.filter((n) => n.type === 'policy').length}`,
    'workflow-models': `ライフサイクル ${m['workflow-models'].lifecycles.length}`,
    'context-map': `コンテキスト ${m['context-map'].contexts.length} · 関係 ${m['context-map'].relations.length}`,
  };
  const changes = changeCounts(m);
  const hot = bp.nodes.filter((n) => n.type === 'hotspot');
  const changed = bp.nodes.filter((n) => n.changed);
  const cards = PAGES.map((p) => `<a class="card doc" href="${p.file}.html"><h2>${esc(p.title)}</h2><p>${esc(p.desc)}</p><div class="meta">${esc(counts[p.file])}</div>${changes[p.file] ? `<div><span class="new">今回の変更 ${changes[p.file]}</span></div>` : ''}</a>`).join('');
  const body = `<div><h1>${esc(product)} ドメインモデル</h1>${bp.summary ? `<p class="lede">${esc(bp.summary)}</p>` : ''}${checkedLine(bp)}</div>
<div class="docs">${cards}</div>
<section class="card"><h2>ホットスポット（${hot.length}）</h2>${hot.length ? hot.map(chipFor).join('') : '<p class="foot">ありません。</p>'}</section>
${changed.length ? `<section class="card"><h2>今回の計画で変わる付箋（${changed.length}）</h2>${changed.map(chipFor).join('')}</section>` : ''}
<div class="card">${legend()}</div>
<p class="foot">このページと各文書は data/*.json から作った生成物です。直すときはデータを直し、scrum-domain-modeling の <code>scripts/domain-model.mjs render</code> を実行します。</p>`;
  return shell({ file: 'index', title: 'ドメインモデル', product, body, extraCss: `.docs{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}.doc{text-decoration:none;color:var(--ink);display:grid;gap:6px}.doc:hover{border-color:var(--accent)}.doc p{margin:0;color:var(--ink-soft)}` });
}

/** @returns {Promise<Record<string,string>>} file name → HTML */
export async function renderModel(m, { product }) {
  return {
    'index.html': index(m, product),
    'big-picture.html': await bigPicture(m, product),
    'domain-glossary.html': glossary(m, product),
    'event-command-map.html': eventCommandMap(m, product),
    'workflow-models.html': await workflows(m, product),
    'context-map.html': await contextMap(m, product),
  };
}
