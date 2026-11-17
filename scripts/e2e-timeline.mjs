#!/usr/bin/env node
// Browser check of timeline lanes on the live board (needs Google Chrome). Use a copy of test/model/fixtures/timeline.
//   node scripts/e2e-timeline.mjs <server-url> <project-slug> <screenshot-dir>
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const [url, slug, out] = process.argv.slice(2);
let fails = 0;
const ok = (n, c, d = '') => { if (!c) fails++; console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${d ? ` — ${d}` : ''}`); };
const mcp = new Client({ name: 'claude-code', version: 'e2e' });
await mcp.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`)));
const call = async (name, args) => JSON.parse((await mcp.callTool({ name, arguments: args })).content[0].text);
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto(`${url}/#/${slug}/big-picture.html`);
await p.waitForFunction(() => document.querySelector('iframe')?.contentDocument?.getElementById('board'));
await p.waitForTimeout(700);
const f = () => p.frames().find((x) => x.url().endsWith('/pages/big-picture.html'));
ok('lanes and phase headings are drawn', (await f().locator('.lane-label').count()) === 3 && (await f().locator('.phase-head').count()) === 3);
const m = await call('get_model', { project: slug });
await call('apply_changes', { project: slug, base_version: m.version, ops: [{ op: 'addNode', after: 'decided', node: { id: 'reviewed', type: 'event', text: '仕入れを見直した' } }] });
await p.waitForTimeout(1500);
const inColumn = await f().evaluate(() => {
  const n = document.getElementById('n-reviewed'), decided = document.getElementById('n-decided');
  const heads = [...document.querySelectorAll('.phase-head')].map((t) => ({ name: t.textContent, x: Number(t.getAttribute('x')) }));
  return n && decided ? { x: n.offsetLeft, decidedX: decided.offsetLeft, heads } : null;
});
ok('a new event after 仕入れを決めた lands in its phase, to its right', !!inColumn && inColumn.x > inColumn.decidedX, JSON.stringify(inColumn));
ok('the new event is framed as added', await f().evaluate(() => document.getElementById('n-reviewed')?.classList.contains('esm-s-added')));
await p.screenshot({ path: join(out, 'lanes-live.png') });
await b.close(); await mcp.close();
console.log(fails ? `${fails} failed` : 'all ok');
process.exit(fails ? 1 : 0);
