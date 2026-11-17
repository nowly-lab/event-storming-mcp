// Timeline phases: events placed left to right by business time, domains as lanes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readData } from '../../model/domain-model.mjs';
import { validateModel, validateStructure } from '../../model/lib/validate.mjs';
import { layoutBoard } from '../../model/lib/layout.mjs';
import { renderModel } from '../../model/lib/render.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const timeline = () => readData(join(here, 'fixtures', 'timeline')).data;
const sample = () => readData(join(here, 'fixtures', 'sample')).data;
const node = (m, id) => m['big-picture'].nodes.find((n) => n.id === id);

test('the timeline fixture is valid', () => {
  assert.deepEqual(validateModel(timeline()), []);
});

test('an unknown or repeated phase id is a structural error', () => {
  const m = timeline();
  node(m, 'priced').phase = 'nowhere';
  assert.ok(validateStructure(m).some((e) => /phase/.test(e) && /nowhere/.test(e)));
  const d = timeline();
  d['big-picture'].phases.push({ id: 'store', name: '二つ目' });
  assert.ok(validateStructure(d).some((e) => /phases/.test(e)));
});

test('with phases, an event without one breaks a rule but can still be saved', () => {
  const m = timeline();
  delete node(m, 'decided').phase;
  assert.ok(validateModel(m).some((e) => /decided/.test(e) && /phase/.test(e)));
  assert.deepEqual(validateStructure(m), []);
});

test('a flow that goes back in time breaks a rule', () => {
  const m = timeline();
  node(m, 'decided').phase = 'store';
  node(m, 'priced').phase = 'decide';
  assert.ok(validateModel(m).some((e) => /priced/.test(e) && /decided/.test(e) && /時系列/.test(e)));
});

test('an attached sticky cannot carry a phase (it follows its host)', () => {
  const m = timeline();
  node(m, 'no-price').phase = 'store';
  assert.ok(validateModel(m).some((e) => /no-price/.test(e) && /phase/.test(e)));
});

test('lanes: events sit left to right by phase, every sticky inside its lane and column, nothing overlaps', async () => {
  const m = timeline();
  const bp = m['big-picture'];
  const L = await layoutBoard(bp);
  assert.deepEqual(L.rings, []);
  assert.deepEqual(L.lanes.map((l) => l.domain), ['visit', 'sourcing', 'accounting']);
  assert.deepEqual(L.phases.map((p) => p.id), ['store', 'decide', 'books']);
  for (let i = 1; i < L.phases.length; i++) assert.ok(L.phases[i].x >= L.phases[i - 1].x + L.phases[i - 1].w, 'columns do not overlap');
  for (let i = 1; i < L.lanes.length; i++) assert.ok(L.lanes[i].y >= L.lanes[i - 1].y + L.lanes[i - 1].h, 'lanes do not overlap');
  const r = new Map(L.stickies.map((s) => [s.node.id, s]));
  const col = (id) => L.phases.find((p) => p.id === id);
  const order = bp.phases.map((p) => p.id);
  const events = bp.nodes.filter((n) => n.type === 'event');
  for (const a of events) for (const b of events) {
    if (order.indexOf(a.phase) < order.indexOf(b.phase)) assert.ok(r.get(a.id).r.x + r.get(a.id).r.w <= r.get(b.id).r.x, `${a.id} is left of ${b.id}`);
  }
  for (const s of L.stickies) {
    const host = s.node.attach ? bp.nodes.find((n) => n.id === s.node.attach.to) : s.node;
    const lane = L.lanes.find((l) => l.domain === host.domain);
    assert.ok(s.r.y >= lane.y && s.r.y + s.r.h <= lane.y + lane.h, `${s.node.id} inside lane ${lane.domain}`);
  }
  for (const e of events) {
    const c = col(e.phase), s = r.get(e.id).r;
    assert.ok(s.x >= c.x && s.x + s.w <= c.x + c.w, `${e.id} inside column ${e.phase}`);
  }
  const all = L.stickies;
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const a = all[i].r, b = all[j].r;
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    assert.ok(ox <= 0 || oy <= 0, `${all[i].node.id} overlaps ${all[j].node.id}`);
  }
});

test('stickies without a phase take the next event\'s column along the flow (else the previous one)', async () => {
  const bp = timeline()['big-picture'];
  const L = await layoutBoard(bp);
  const inCol = (id, phase) => { const s = L.stickies.find((x) => x.node.id === id).r, c = L.phases.find((p) => p.id === phase); return s.x >= c.x && s.x + s.w <= c.x + c.w; };
  assert.ok(inCol('fetch', 'store'), 'command → its event');
  assert.ok(inCol('buyer2', 'decide'), 'actor → the event its command leads to');
  assert.ok(inCol('book', 'books'), 'policy → the next event');
  assert.ok(inCol('monthly', 'books'), 'a scheduled policy with no event before it → the next event');
});

test('a model without phases is drawn with ellipses as before', async () => {
  const L = await layoutBoard(sample()['big-picture']);
  assert.ok(L.rings.length > 0);
  assert.equal(L.lanes, undefined);
});

test('the page draws lane names and phase headings', async () => {
  const html = (await renderModel(timeline(), { product: 'Timeline' }))['big-picture.html'];
  assert.match(html, /class="lane-label"[^>]*>店舗訪問/);
  assert.match(html, /class="phase-head"[^>]*>店で調べる/);
  assert.doesNotMatch(html, /<ellipse class="ring"/);
});
