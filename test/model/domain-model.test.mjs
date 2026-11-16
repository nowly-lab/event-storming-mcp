// Run: node --test .agents/skills/scrum-domain-modeling/scripts/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, readData } from '../../model/domain-model.mjs';
import { validateModel } from '../../model/lib/validate.mjs';
import { layoutBoard } from '../../model/lib/layout.mjs';
import { deriveEventCommandMap } from '../../model/lib/render.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE = join(here, 'fixtures', 'sample');
const REPO = join(here, 'fixtures', 'repo');

const sample = () => readData(SAMPLE).data;
function capture() {
  const lines = [];
  return { lines, out: { log: (s) => lines.push(String(s)), error: (s) => lines.push(String(s)) } };
}
function tempModel() {
  const dir = mkdtempSync(join(tmpdir(), 'domain-model-'));
  cpSync(SAMPLE, dir, { recursive: true });
  return dir;
}

test('the sample model is valid', () => {
  assert.deepEqual(validateModel(sample()), []);
});

test('a wrong attach target names the file, the JSON path and the closest id', () => {
  const d = sample();
  d['big-picture'].nodes.find((n) => n.id === 'no-price').attach.to = 'lookupp';
  const errors = validateModel(d);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^data\/big-picture\.json: nodes\[\d+\]\.attach\.to: "lookupp" という付箋はありません。.*近いもの: "lookup"/);
});

test('unknown keys and bad enum values are errors, not ignored', () => {
  const d = sample();
  d['big-picture'].nodes[0].colour = 'red';
  d['big-picture'].edges[0].kind = 'flw';
  const errors = validateModel(d).join('\n');
  assert.match(errors, /nodes\[0\]\.colour: この項目は形式にありません/);
  assert.match(errors, /edges\[0\]\.kind: "flw" は使えません。"flow"、"result" のどれか.*近いもの: "flow"/);
});

test('policies need an execution type, a triggering event and a command', () => {
  const d = sample();
  const bp = d['big-picture'];
  delete bp.nodes.find((n) => n.id === 'book').execution;
  bp.edges = bp.edges.filter((e) => !(e.from === 'book' && e.to === 'post'));
  const errors = validateModel(d).join('\n');
  assert.match(errors, /execution: ポリシーには実行方式が必要です/);
  assert.match(errors, /ポリシー "book" にはコマンドへの流れの矢印が必要です/);
  assert.match(errors, /コマンド "post" から流れの矢印でたどれるイベントがありません|ポリシー "book"/);
});

test('result edges go from an event to a read model, and attached stickies cannot be in the flow', () => {
  const d = sample();
  d['big-picture'].edges.push({ from: 'buyer', to: 'quote', kind: 'result' }, { from: 'no-price', to: 'book', kind: 'flow' });
  const errors = validateModel(d).join('\n');
  assert.match(errors, /点線（result）の矢印はイベントから始めてください/);
  assert.match(errors, /"no-price" は別の付箋に貼られた付箋なので、流れの矢印は出せません/);
});

test('a read model must lead to the actor or command that uses it', () => {
  const d = sample();
  d['big-picture'].nodes.push(
    { id: 'log', type: 'readModel', domain: 'accounting', text: '計上結果' },
    { id: 'stuck', type: 'readModel', domain: 'accounting', text: '締め結果', attach: { to: 'closed', pos: 'below' } },
  );
  d['big-picture'].edges.push({ from: 'posted', to: 'log', kind: 'result' });
  const errors = validateModel(d).join('\n');
  assert.match(errors, /リードモデル "log" を見て判断するアクターかコマンドへの流れの矢印が必要です/);
  assert.match(errors, /リードモデル "stuck" はアクターかコマンドに貼ってください（今は event）/);
  d['big-picture'].edges.push({ from: 'log', to: 'buyer2', kind: 'flow' });
  assert.doesNotMatch(validateModel(d).join('\n'), /リードモデル "log"/);
});

test('an actor cannot point into another domain', () => {
  const d = sample();
  d['big-picture'].edges.push({ from: 'buyer', to: 'post', kind: 'flow' });
  assert.match(validateModel(d).join('\n'), /アクター "buyer"（ドメイン "visit"）から別のドメインの "post" へは矢印を出せません/);
});

test('cross-file references are checked', () => {
  const d = sample();
  d['domain-glossary'].terms[0].nodes.push('nope');
  d['context-map'].relations[0].to = 'apii';
  d['workflow-models'].lifecycles[0].transitions[0].on = 'fech';
  d['workflow-models'].lifecycles[0].transitions[1].on = 'buyer2';
  const errors = validateModel(d).join('\n');
  assert.match(errors, /data\/domain-glossary\.json: terms\[0\]\.nodes\[2\]: "nope" という付箋（big-picture）はありません/);
  assert.match(errors, /data\/context-map\.json: relations\[0\]\.to: "apii" .*近いもの: "api"/);
  assert.match(errors, /data\/workflow-models\.json: lifecycles\[0\]\.transitions\[0\]\.on: "fech" .*近いもの: "fetch"/);
  assert.match(errors, /lifecycles\[0\]\.transitions\[1\]\.on: "buyer2" はactorの付箋です。状態を動かすコマンドかイベント/);
});

test('the old trigger list is reported with how to migrate', () => {
  const d = sample();
  const lc = d['workflow-models'].lifecycles[0];
  lc.triggers = [{ id: 'fetch', name: '相場を取得する' }];
  lc.transitions[0].trigger = lc.transitions[0].on;
  delete lc.transitions[0].on;
  const errors = validateModel(d).join('\n');
  assert.match(errors, /lifecycles\[0\]\.triggers: 「きっかけ」の一覧はなくなりました/);
  assert.match(errors, /lifecycles\[0\]\.transitions\[0\]\.trigger: "trigger" は "on" に変わりました/);
});

test('aggregates sit in the flow between a command and an event and carry invariants', () => {
  const d = sample();
  const bp = d['big-picture'];
  bp.nodes.find((n) => n.id === 'margin').attach = { to: 'decided', pos: 'below' };
  bp.edges = bp.edges.filter((e) => e.from !== 'margin' && e.to !== 'margin');
  bp.edges.push({ from: 'decide', to: 'decided', kind: 'flow' });
  bp.nodes.find((n) => n.id === 'in-store').invariants = undefined;
  bp.nodes.find((n) => n.id === 'decide').invariants = ['x'];
  bp.edges = bp.edges.filter((e) => !(e.from === 'in-store' && e.to === 'typed'));
  bp.edges.push({ from: 'type', to: 'typed', kind: 'flow' });
  const errors = validateModel(d).join('\n');
  assert.match(errors, /nodes\[\d+\]\.attach: 集約は貼らずに、コマンド → 集約 → イベントの並びで流れの中に置いてください/);
  assert.match(errors, /不変条件は集約の付箋にだけ書けます/);
  assert.match(errors, /集約 "in-store" にはイベントへの流れの矢印が必要です/);
});

test('a scheduled policy may start from the clock; a manual policy goes through an actor', () => {
  const d = sample();
  const bp = d['big-picture'];
  assert.equal(bp.nodes.find((n) => n.id === 'monthly').execution, 'scheduled');
  bp.nodes.find((n) => n.id === 'monthly').execution = 'async';
  bp.nodes.push({ id: 'clerk', type: 'actor', domain: 'accounting', text: '経理' });
  bp.edges = bp.edges.filter((e) => !(e.from === 'book' && e.to === 'post'));
  bp.edges.push({ from: 'book', to: 'clerk', kind: 'flow' }, { from: 'clerk', to: 'post', kind: 'flow' });
  const errors = validateModel(d);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /ポリシー "monthly" にはイベントからの流れの矢印が必要です.*"scheduled"/);
  const book = deriveEventCommandMap(bp).policies.find((p) => p.policy.id === 'book');
  assert.deepEqual(book.actors.map((n) => n.id), ['clerk']);
  assert.deepEqual(book.commands.map((n) => n.id), ['post']);
});

test('a state and trigger pair cannot be both a transition and a rejection; one initial state', () => {
  const d = sample();
  const lc = d['workflow-models'].lifecycles[0];
  lc.rejections.push({ state: 'found', on: 'fetch', kind: 'ignored', reason: 'x' });
  lc.states[1].initial = true;
  const errors = validateModel(d).join('\n');
  assert.match(errors, /この組は lifecycles\[0\]\.transitions\[0\] で遷移として書かれています/);
  assert.match(errors, /最初の状態（"initial": true）はちょうど1つにしてください（今は 2 個）/);
});

test('validate exits 1 and prints every problem; a broken JSON file is reported once', async () => {
  const dir = tempModel();
  try {
    writeFileSync(join(dir, 'data', 'context-map.json'), '{ broken');
    const bp = JSON.parse(readFileSync(join(dir, 'data', 'big-picture.json'), 'utf8'));
    bp.schema = 'big-picture/v2';
    writeFileSync(join(dir, 'data', 'big-picture.json'), JSON.stringify(bp));
    const { lines, out } = capture();
    assert.equal(await run(['validate', dir], out), 1);
    const text = lines.join('\n');
    assert.match(text, /data\/context-map\.json: JSON として読めません/);
    assert.doesNotMatch(text, /context-map\.json: ファイルがありません/);
    assert.match(text, /data\/big-picture\.json: schema: "big-picture\/v2" ではなく "big-picture\/v1"/);
    assert.match(lines[0], /^データに \d+ 件の問題があります/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('render writes nothing when the data is invalid', async () => {
  const dir = tempModel();
  try {
    const p = join(dir, 'data', 'big-picture.json');
    const bp = JSON.parse(readFileSync(p, 'utf8'));
    bp.nodes[0].type = 'person';
    writeFileSync(p, JSON.stringify(bp));
    assert.equal(await run(['render', dir], capture().out), 1);
    assert.equal(existsSync(join(dir, 'index.html')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('render writes six pages; check passes, then fails after a hand edit', async () => {
  const dir = tempModel();
  try {
    assert.equal(await run(['render', dir], capture().out), 0);
    for (const f of ['index', 'big-picture', 'domain-glossary', 'event-command-map', 'workflow-models', 'context-map']) {
      const html = readFileSync(join(dir, `${f}.html`), 'utf8');
      assert.match(html, /^<!doctype html>\n<!-- 生成物: 直接編集しないでください/);
    }
    assert.equal(await run(['check', dir], capture().out), 0);
    const g = join(dir, 'domain-glossary.html');
    writeFileSync(g, readFileSync(g, 'utf8').replace('用語集', '用語集（手で直した）'));
    const { lines, out } = capture();
    assert.equal(await run(['check', dir], out), 1);
    assert.match(lines.join('\n'), /domain-glossary\.html: データと一致しません。HTML を手で直さず/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('render is deterministic', async () => {
  const a = tempModel(), b = tempModel();
  try {
    await run(['render', a], capture().out);
    await run(['render', b], capture().out);
    for (const f of ['big-picture', 'workflow-models', 'context-map']) {
      assert.equal(readFileSync(join(a, `${f}.html`), 'utf8'), readFileSync(join(b, `${f}.html`), 'utf8'));
    }
  } finally { rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true }); }
});

test('check --repo proves evidence paths and symbols exist', async () => {
  const dir = tempModel();
  try {
    await run(['render', dir], capture().out);
    assert.equal(await run(['check', dir, '--repo', REPO], capture().out), 0);
    const p = join(dir, 'data', 'domain-glossary.json');
    const g = JSON.parse(readFileSync(p, 'utf8'));
    g.terms[0].evidence = [{ path: 'src/missing.ts' }, { path: 'src/sourcing.ts', symbol: 'recordDecisionLater' }];
    writeFileSync(p, JSON.stringify(g));
    await run(['render', dir], capture().out);
    const { lines, out } = capture();
    assert.equal(await run(['check', dir, '--repo', REPO], out), 1);
    const text = lines.join('\n');
    assert.match(text, /data\/domain-glossary\.json: terms\[0\]\.evidence\[0\]\.path: "src\/missing\.ts" が .* にありません/);
    assert.match(text, /terms\[0\]\.evidence\[1\]\.symbol: "recordDecisionLater" が src\/sourcing\.ts にありません/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('flow stickies on the board never overlap', async () => {
  const L = await layoutBoard(sample()['big-picture']);
  const flow = L.stickies.filter((s) => !s.node.attach);
  for (let i = 0; i < flow.length; i++) for (let j = i + 1; j < flow.length; j++) {
    const a = flow[i].r, b = flow[j].r;
    const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    assert.equal(overlap, false, `${flow[i].node.id} overlaps ${flow[j].node.id}`);
  }
  assert.ok(L.stickies.every((s) => s.r.x >= 0 && s.r.y >= 0 && s.r.x + s.r.w <= L.width && s.r.y + s.r.h <= L.height));
});

test('the event and command map is derived from the board', () => {
  const { commands, policies } = deriveEventCommandMap(sample()['big-picture']);
  const decide = commands.find((c) => c.command.id === 'decide');
  assert.deepEqual(decide.actors.map((n) => n.id), ['buyer2']);
  assert.deepEqual(decide.events.map((n) => n.id), ['decided']);
  assert.deepEqual(decide.aggregates.map((n) => n.id), ['margin']);
  const fetch = commands.find((c) => c.command.id === 'fetch');
  assert.deepEqual(fetch.policies.map((n) => n.id), ['lookup']);
  assert.deepEqual(fetch.externals.map((n) => n.id), ['price-svc']);
  const type = commands.find((c) => c.command.id === 'type');
  assert.deepEqual(type.aggregates.map((n) => n.id), ['in-store']);
  assert.deepEqual(type.events.map((n) => n.id), ['typed']);
  const lookup = policies.find((p) => p.policy.id === 'lookup');
  assert.deepEqual(lookup.events.map((n) => n.id).sort(), ['scanned', 'typed']);
  assert.deepEqual(policies.find((p) => p.policy.id === 'monthly').events, []);
});

test('init creates the four data files and never overwrites', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'domain-model-init-'));
  try {
    assert.equal(await run(['init', dir], capture().out), 0);
    writeFileSync(join(dir, 'data', 'big-picture.json'), '{"keep":true}');
    assert.equal(await run(['init', dir], capture().out), 0);
    assert.equal(readFileSync(join(dir, 'data', 'big-picture.json'), 'utf8'), '{"keep":true}');
    const { data } = readData(dir);
    assert.deepEqual(Object.keys(data).sort(), ['big-picture', 'context-map', 'domain-glossary', 'workflow-models']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('usage errors exit 2', async () => {
  assert.equal(await run([], capture().out), 2);
  assert.equal(await run(['render', SAMPLE, '--repo', REPO], capture().out), 2);
  assert.equal(await run(['check', SAMPLE, '--nope'], capture().out), 2);
});

test('the board and the diagrams can be pinch-zoomed; the page scripts parse', async () => {
  const dir = tempModel();
  try {
    await run(['render', dir], capture().out);
    for (const f of ['big-picture', 'workflow-models', 'context-map']) {
      const html = readFileSync(join(dir, `${f}.html`), 'utf8');
      assert.match(html, /class="zoomable"/, f);
      assert.match(html, /addEventListener\('wheel'/, f);
      assert.match(html, /addEventListener\('gesturechange'/, f);
      assert.match(html, /addEventListener\('touchmove'/, f);
      for (const [, js] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(js), f);
    }
    assert.doesNotMatch(readFileSync(join(dir, 'domain-glossary.html'), 'utf8'), /zoomable/);
    const wf = readFileSync(join(dir, 'workflow-models.html'), 'utf8');
    assert.doesNotMatch(wf, /きっかけ|<h3>無効・無視<\/h3>/);
    assert.match(wf, /早見表（状態 × コマンド・イベント）/);
    assert.match(readFileSync(join(dir, 'event-command-map.html'), 'utf8'), /利益率が基準以上の商品だけ仕入れる/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('every page lights up what the current plan changes, from the stickies and from its own changed marks', async () => {
  const dir = tempModel();
  try {
    await run(['render', dir], capture().out);
    const page = (f) => readFileSync(join(dir, `${f}.html`), 'utf8');
    for (const f of ['big-picture', 'domain-glossary', 'event-command-map', 'workflow-models', 'context-map']) {
      assert.match(page(f), /id="show-changed" checked/, f);
      assert.match(page(f), /<main class="show-changed" id="main">/, f);
      for (const [, js] of page(f).matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(js), f);
    }
    // Glossary: "仕入れ判断" names the changed sticky "decide"; "相場" does not.
    assert.match(page('domain-glossary'), /<tr id="term-0" class=" is-changed">/);
    assert.match(page('domain-glossary'), /<tr id="term-1" class="">/);
    assert.match(page('domain-glossary'), /<a class="chip changed" href="big-picture.html#n-decide"/);
    // Event / command map: the row of the changed command.
    assert.match(page('event-command-map'), /<tr id="c-decide" class=" is-changed">/);
    // Workflow: the transition on "decide", the state marked changed, and the lifecycle.
    const wf = page('workflow-models');
    assert.match(wf, /class="gbox is-changed"/);
    assert.match(wf, /class="gedge is-changed"/);
    assert.match(wf, /<section class="card lc is-changed" id="lc-item">/);
    // Context map: only its own marks.
    assert.match(page('context-map'), /今回の計画で変わる境界と関係（2）/);
    assert.match(page('index'), /今回の変更 2/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('with no changed marks, no page shows the changes card or the toggle', async () => {
  const dir = tempModel();
  try {
    for (const f of ['big-picture', 'domain-glossary', 'workflow-models', 'context-map']) {
      const p = join(dir, 'data', `${f}.json`);
      writeFileSync(p, readFileSync(p, 'utf8').replace(/,\s*"changed": true/g, ''));
    }
    const { lines } = capture();
    assert.equal(await run(['render', dir], capture().out), 0, lines.join('\n'));
    for (const f of ['big-picture', 'domain-glossary', 'event-command-map', 'workflow-models', 'context-map', 'index']) {
      const html = readFileSync(join(dir, `${f}.html`), 'utf8');
      assert.doesNotMatch(html, /id="show-changed"|class="[^"]*(is-changed|chip changed)|class="new"/, f);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
