#!/usr/bin/env node
// Browser check against a running server: live redraw from MCP, inline edits, delete with its list,
// a draft surviving a remote change, and the history page. Needs Google Chrome.
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
await f.fill('.esm-input', '画面で直した');
await f.press('.esm-input', 'Enter');
await page.waitForTimeout(600);
check('ダブルクリックで直した文字が JSON に入る', bp().nodes.find((n) => n.id === ev.id).text === '画面で直した');

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
const fr = await page.locator('iframe').boundingBox();
await page.mouse.click(fr.x + pt.x, fr.y + pt.y);
await f.press('body', 'Delete');
await page.waitForTimeout(700);
check('矢印を選んで Delete で消える', !bp().edges.some((e) => e.from === added.id && e.to === target.id), pb && pt ? '' : 'no clickable point');

// 6. Delete a sticky: the list of what goes with it, then confirm.
await focus(added.id);
await f.click(`#n-${added.id}`);
await f.click('.esm-tools [data-a="remove"]');
await page.waitForSelector('#modal:not([hidden])');
const listText = await page.textContent('#modal-body');
await page.screenshot({ path: join(out, '04-remove-confirm.png') });
await page.click('#modal-actions [data-v="1"]');
await page.waitForTimeout(700);
check('付箋を消す前に一緒に消えるものが出て、消える', /矢印/.test(listText) && !bp().nodes.some((n) => n.id === added.id));

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
check('履歴に一覧が出て、この版に戻すと新しい版として記録される', rows >= 6 && /に戻した/.test(hist[0].summary), `${rows} 行`);
await page.screenshot({ path: join(out, '07-restored.png') });

check('画面にスクリプトエラーがない', errors.length === 0, errors.join(' / '));
await browser.close();
await mcp.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
