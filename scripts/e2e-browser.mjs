#!/usr/bin/env node
// Browser check against a running server: drag to pan, live redraw from MCP, inline edits, delete with its
// list, a draft surviving a remote change, the history page, and drag to pan on the generated pages. Needs Google Chrome.
//   node scripts/e2e-browser.mjs <server-url> <project-slug> <model-dir> <screenshot-dir>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const [url, slug, modelDir, out] = process.argv.slice(2);
const bp = () => JSON.parse(readFileSync(join(modelDir, 'data', 'big-picture.json'), 'utf8'));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };

const mcp = new Client({ name: 'claude-code', version: '1.0.0' });
await mcp.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`)));
const call = async (name, args) => JSON.parse((await mcp.callTool({ name, arguments: args })).content[0].text);

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.text().startsWith('esm-') && console.log(m.text()));
await page.goto(`${url}/#/${slug}/big-picture.html`);
const frame = () => page.frames().find((f) => f.url().includes('/pages/big-picture.html'));
await page.waitForFunction(() => document.querySelector('iframe')?.contentDocument?.getElementById('board'));
await page.waitForTimeout(500);
const f = frame();
// Zoom to 100% and bring a sticky into view.
await f.click('.zoom-ctrl [data-z="one"]');
const focus = async (id) => f.evaluate((id) => document.getElementById('n-' + id).scrollIntoView({ block: 'center', inline: 'center' }), id);
const fr0 = await page.locator('iframe').boundingBox();
const scroll = () => f.evaluate(() => { const v = document.querySelector('.zoom-view'); return { x: v.scrollLeft, y: v.scrollTop }; });

// 0. Drag on empty canvas pans the board; stickies, the handle and editing keep their own drags.
// Zoom in so the board scrolls both ways.
await f.click('.zoom-ctrl [data-z="in"]');
await f.click('.zoom-ctrl [data-z="in"]');
await f.evaluate(() => { const v = document.querySelector('.zoom-view'); v.scrollLeft = (v.scrollWidth - v.clientWidth) / 2; v.scrollTop = (v.scrollHeight - v.clientHeight) / 2; });
const emptyPoint = () => f.evaluate(() => {
  const r = document.querySelector('.zoom-view').getBoundingClientRect();
  for (let dy = 0; dy < r.height / 2; dy += 8) for (let dx = 0; dx < r.width / 2; dx += 8) for (const [x, y] of [[r.left + r.width / 2 + dx, r.top + r.height / 2 + dy], [r.left + r.width / 2 - dx, r.top + r.height / 2 - dy]]) {
    if (!document.elementsFromPoint(x, y).some((e) => e.closest('.note, .zoom-ctrl, .esm-tools, .esm-handle, path.edge'))) return { x, y };
  }
  return null;
});
const empty = await emptyPoint();
const s0 = await scroll();
await page.mouse.move(fr0.x + empty.x, fr0.y + empty.y);
await page.mouse.down();
await page.mouse.move(fr0.x + empty.x - 160, fr0.y + empty.y - 90, { steps: 10 });
await page.mouse.up();
const s1 = await scroll();
const selected = await f.evaluate(() => String(getSelection()));
check('何もない所をドラッグすると全体像が動く', Math.abs(s1.x - s0.x - 160) <= 3 && Math.abs(s1.y - s0.y - 90) <= 3 && selected === '', `${s0.x},${s0.y} → ${s1.x},${s1.y}`);
// Drag back from another empty point; the press that ends a pan selects nothing even over a sticky.
const back = await emptyPoint();
await page.mouse.move(fr0.x + back.x, fr0.y + back.y);
await page.mouse.down();
await page.mouse.move(fr0.x + back.x + 160, fr0.y + back.y + 90, { steps: 10 });
await page.mouse.up();
const s2 = await scroll();
check('動かした後に付箋の選択や矢印の選択が起きない', Math.abs(s2.x - s0.x) <= 3 && Math.abs(s2.y - s0.y) <= 3 && await f.locator('.esm-tools').count() === 0 && await f.locator('.edge.esm-sel').count() === 0);
// The guard against the click that ends a pan must not eat a later keyboard click.
const zoomBefore = await f.textContent('.zoom-ctrl output');
await f.focus('.zoom-ctrl [data-z="fit"]');
await f.press('.zoom-ctrl [data-z="fit"]', 'Enter');
const zoomText = await f.textContent('.zoom-ctrl output');
check('動かした後もキーボードで「全体」が押せる', zoomText !== zoomBefore, `${zoomBefore} → ${zoomText}`);
await f.click('.zoom-ctrl [data-z="one"]');

// 1. MCP change redraws within 1 s, with a toast.
const m = await call('get_model', { project: slug });
const ev = m.data['big-picture'].nodes.find((n) => n.type === 'event' && !n.attach);
await focus(ev.id);
const t0 = Date.now();
await call('apply_changes', { project: slug, base_version: m.version, ops: [{ op: 'updateNode', id: ev.id, patch: { text: 'MCPから直した' } }] });
await f.waitForFunction((id) => document.querySelector('#n-' + id + ' .txt')?.textContent === 'MCPから直した', ev.id, { timeout: 3000 });
const dt = Date.now() - t0;
check('MCP の変更が 1 秒以内に描き直される', dt < 1000, `${dt}ms`);
check('通知「自動更新: Claude が 1 件変更」', (await page.textContent('#toast')) === '自動更新: Claude が 1 件変更');
await page.screenshot({ path: join(out, '01-live-redraw.png') });

// 2. Double-click to edit text.
await f.dblclick(`#n-${ev.id}`);
{
  await f.fill('.esm-input', 'ドラッグで選ぶ文字');
  const ib = await f.locator('.esm-input').boundingBox();
  const before = await scroll();
  // A locator's box is already in page coordinates.
  await page.mouse.move(ib.x + 6, ib.y + 12);
  await page.mouse.down();
  await page.mouse.move(ib.x + ib.width * 0.6, ib.y + 12, { steps: 8 });
  await page.mouse.up();
  const sel = await f.evaluate(() => { const t = document.querySelector('.esm-input'); return t ? t.selectionEnd - t.selectionStart : -1; });
  const after = await scroll();
  check('入力中はドラッグで文字を選べて、図は動かない', sel > 0 && before.x === after.x && before.y === after.y, `選択 ${sel} 文字`);
}
await f.fill('.esm-input', '画面で直した');
await f.press('.esm-input', 'Enter');
await page.waitForTimeout(600);
check('ダブルクリックで直した文字が JSON に入り、競合の表示は出ない', bp().nodes.find((n) => n.id === ev.id).text === '画面で直した' && await page.locator('#conflict').isHidden());

// 3. Add a sticky after the selected one.
await f.click(`#n-${ev.id}`);
await page.click('#add');
await page.click('#palette button[data-t="policy"]');
await f.waitForSelector('.esm-input');
await f.fill('.esm-input', '在庫が尽きたら');
await f.press('.esm-input', 'Enter');
await page.waitForTimeout(600);
const added = bp().nodes.find((n) => n.text === '在庫が尽きたら');
check('「+ 付箋」で選んだ付箋の後ろに追加される', !!added && bp().edges.some((e) => e.from === ev.id && e.to === added.id));
await page.screenshot({ path: join(out, '02-added.png') });

// 4. Drag from the handle to another sticky to add an arrow.
const pos = await f.evaluate(() => Object.fromEntries([...document.querySelectorAll('.note')].map((n) => [n.dataset.id, [parseFloat(n.style.left), parseFloat(n.style.top)]])));
const [ax, ay] = pos[added.id];
const target = bp().nodes.filter((n) => n.id !== added.id && n.type === 'command' && !n.attach && !bp().edges.some((e) => e.from === added.id && e.to === n.id))
  .sort((a, b) => Math.hypot(pos[a.id][0] - ax, pos[a.id][1] - ay) - Math.hypot(pos[b.id][0] - ax, pos[b.id][1] - ay))[0];
await focus(added.id);
await f.click(`#n-${added.id}`);
const h2 = await f.locator('.esm-handle').boundingBox();
const tb = await f.locator(`#n-${target.id}`).boundingBox();
console.log('drag', added.id, '->', target.id, JSON.stringify(h2), JSON.stringify(tb));
await page.mouse.move(h2.x + h2.width / 2, h2.y + h2.height / 2);
await page.mouse.down();
await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(700);
check('付箋の丸から引っぱって矢印がつながる', bp().edges.some((e) => e.from === added.id && e.to === target.id));
await page.screenshot({ path: join(out, '03-arrow.png') });

// 5. Select that arrow and delete it.
const path = f.locator(`path.edge[data-from="${added.id}"][data-to="${target.id}"]`);
const pb = await path.boundingBox();
// A point on the arrow that no sticky covers, in the frame's coordinates.
const pt = await path.evaluate((p) => {
  const board = document.getElementById('board'), b = board.getBoundingClientRect(), z = b.width / board.offsetWidth;
  const sh = Number(/translate\(([-\d.]+)/.exec(p.parentElement.getAttribute('transform'))?.[1] ?? 0);
  const l = p.getTotalLength();
  for (let t = 0.1; t < 0.95; t += 0.05) {
    const q = p.getPointAtLength(l * t), x = b.left + (q.x + sh) * z, y = b.top + q.y * z;
    if (!document.elementsFromPoint(x, y).some((e) => e.closest('.note, .esm-tools, .esm-handle'))) return { x, y };
  }
  return null;
});
const edgesBefore = bp().edges.length;
const fr = await page.locator('iframe').boundingBox();
await page.mouse.click(fr.x + pt.x, fr.y + pt.y);
await f.press('body', 'Delete');
await page.waitForTimeout(700);
const edgesAfter = bp().edges.length;
check('矢印を選んで Delete で、その矢印だけが消える', !bp().edges.some((e) => e.from === added.id && e.to === target.id) && edgesAfter === edgesBefore - 1 && bp().edges.some((e) => e.from === ev.id && e.to === added.id), pb && pt ? `${edgesBefore}→${edgesAfter}` : 'no clickable point');

// 6. Delete a sticky: the list of what goes with it, then confirm.
await focus(added.id);
await f.click(`#n-${added.id}`);
await f.click('.esm-tools [data-a="remove"]');
await page.waitForSelector('#modal:not([hidden])');
const listText = await page.textContent('#modal-body');
await page.screenshot({ path: join(out, '04-remove-confirm.png') });
// While the list is open, an agent attaches a new note to the sticky: confirming must ask again with it listed.
const m3 = await call('get_model', { project: slug });
await call('apply_changes', { project: slug, base_version: m3.version, ops: [{ op: 'addNode', node: { id: 'unseen-note', type: 'hotspot', domain: added.domain, text: 'UNSEEN CASCADE', attach: { to: added.id, pos: 'below' } } }] });
await page.waitForTimeout(600);
await page.click('#modal-actions [data-v="1"]');
await page.waitForFunction(() => /もう一度確かめて/.test(document.getElementById('modal-body')?.textContent ?? '') && !document.getElementById('modal').hidden, null, { timeout: 4000 });
const second = await page.textContent('#modal-body');
const stillThere = bp().nodes.some((n) => n.id === added.id);
check('確認中に増えたものは黙って消さず、一覧を出し直す', stillThere && /UNSEEN CASCADE/.test(second));
await page.click('#modal-actions [data-v="1"]');
await page.waitForTimeout(700);
check('付箋を消す前に一緒に消えるものが出て、消える', /矢印/.test(listText) && !bp().nodes.some((n) => n.id === added.id || n.id === 'unseen-note'));

// 7. A draft survives a remote change, and the change waits.
await focus(ev.id);
await f.dblclick(`#n-${ev.id}`);
await f.fill('.esm-input', '入力中の文字');
const m2 = await call('get_model', { project: slug });
const other = m2.data['big-picture'].nodes.find((n) => n.type === 'command' && !n.attach);
await call('apply_changes', { project: slug, base_version: m2.version, ops: [{ op: 'updateNode', id: other.id, patch: { text: '裏で変わった' } }] });
await page.waitForTimeout(800);
const kept = await f.inputValue('.esm-input');
const pendingShown = !(await page.locator('#pending').isHidden());
await page.screenshot({ path: join(out, '05-pending.png') });
check('入力中に届いた変更は待たされ、書きかけが残る', kept === '入力中の文字' && pendingShown);
await f.press('.esm-input', 'Enter');
await page.waitForTimeout(900);
const cur = bp();
check('編集を終えると待っていた変更も反映される', cur.nodes.find((n) => n.id === ev.id).text === '入力中の文字' && await f.evaluate((id) => document.querySelector('#n-' + id + ' .txt').textContent, other.id) === '裏で変わった');

// 8. History: list, before/after, restore.
await page.click('#tabs a:has-text("履歴")');
await page.waitForSelector('#h-items li');
await page.waitForTimeout(1200);
await page.screenshot({ path: join(out, '06-history.png') });
const rows = await page.locator('#h-items li').count();
await page.locator('#h-items li button').nth(2).click();
await page.waitForTimeout(800);
await page.click('[data-restore]');
await page.click('#modal-actions [data-v="1"]');
await page.waitForTimeout(800);
const hist = await call('list_history', { project: slug, limit: 1 });
check('履歴に一覧が出て、この版に戻すと新しい版として記録される', rows >= 7 && /に戻した/.test(hist[0].summary), `${rows} 行`);
await page.screenshot({ path: join(out, '07-restored.png') });

// 9. The generated pages opened from disk pan the same way, also when the pointer leaves the box early.
for (const file of ['big-picture', 'workflow-models', 'context-map']) {
  await page.goto(`file://${join(modelDir, file + '.html')}`);
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const v = document.querySelector('.zoom-view');
    v.scrollIntoView({ block: 'start' });
    v.querySelector('.zoom-content').style.zoom = 6; // big enough to scroll both ways
    v.scrollLeft = 200; v.scrollTop = Math.min(200, v.scrollHeight - v.clientHeight);
    const b = v.getBoundingClientRect();
    for (let dy = 20; dy < b.height - 20; dy += 8) for (let dx = 20; dx < b.width - 20; dx += 8) {
      const els = document.elementsFromPoint(b.left + dx, b.top + dy);
      if (els[0]?.closest('.zoom-view') && !els.some((e) => e.closest('.note, .zoom-ctrl, a, button, .gbox, text'))) return { x: b.left + dx, y: b.top + dy, left: v.scrollLeft, top: v.scrollTop, maxTop: v.scrollHeight - v.clientHeight };
    }
    return null;
  });
  await page.mouse.move(r.x, r.y);
  await page.mouse.down();
  await page.mouse.move(r.x - 100, r.y - 60, { steps: 8 });
  await page.mouse.up();
  const after = await page.evaluate(() => { const v = document.querySelector('.zoom-view'); return { left: v.scrollLeft, top: v.scrollTop }; });
  const dy = Math.min(60, r.maxTop - r.top);
  check(`生成ページ ${file}.html もドラッグで動く`, Math.abs(after.left - r.left - 100) <= 3 && Math.abs(after.top - r.top - dy) <= 3, `${r.left},${r.top} → ${after.left},${after.top}`);
}

check('画面にスクリプトエラーがない', errors.length === 0, errors.join(' / '));
await browser.close();
await mcp.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
