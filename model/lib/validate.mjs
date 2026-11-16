// Validates the domain model data. Every problem becomes one line:
//   data/<file>.json: <json path>: <what is wrong and how to fix it>
// The format is documented in ../../references/data-format.md.

export const DATA_FILES = ['big-picture', 'domain-glossary', 'workflow-models', 'context-map'];
export const NODE_TYPES = ['actor', 'command', 'event', 'policy', 'readModel', 'aggregate', 'external', 'hotspot'];
export const ATTACH_POS = ['above', 'below', 'above-left', 'above-right', 'below-left', 'below-right'];
export const EXECUTIONS = ['sync', 'async', 'scheduled', 'external'];
export const EDGE_KINDS = ['flow', 'result'];
export const ROLES = ['entry', 'rule', 'contract', 'persistence', 'consumer', 'ui', 'test', 'source'];

const ID = /^[a-z][a-z0-9-]*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---- tiny schema language ----------------------------------------------
const T = {
  str: { t: 'str' },
  id: { t: 'id' },
  bool: { t: 'bool' },
  date: { t: 'date' },
  enum: (vals) => ({ t: 'enum', vals }),
  list: (item) => ({ t: 'list', item }),
  // fields: { key: [spec, required] }; moved: { oldKey: message } for keys an earlier format used
  obj: (fields, moved = {}) => ({ t: 'obj', fields, moved }),
};
const req = (s) => [s, true];
const opt = (s) => [s, false];

const EVIDENCE = T.list(T.obj({ path: req(T.str), symbol: opt(T.str), role: opt(T.enum(ROLES)), note: opt(T.str) }));
const MOVED_TRIGGER = '"trigger" は "on" に変わりました。全体像（big-picture）のコマンドかイベントの付箋 id を "on" に書いてください。';
const common = (fields) => T.obj({
  schema: req(T.str), title: req(T.str), summary: opt(T.str),
  checked: req(T.obj({ revision: req(T.str), date: req(T.date) })),
  ...fields,
});

export const SPECS = {
  'big-picture': common({
    product: opt(T.str),
    domains: req(T.list(T.obj({ id: req(T.id), name: req(T.str), note: opt(T.str) }))),
    nodes: req(T.list(T.obj({
      id: req(T.id), type: req(T.enum(NODE_TYPES)), domain: req(T.id), text: req(T.str),
      execution: opt(T.enum(EXECUTIONS)),
      invariants: opt(T.list(T.str)),
      attach: opt(T.obj({ to: req(T.id), pos: req(T.enum(ATTACH_POS)) })),
      changed: opt(T.bool), note: opt(T.str), evidence: opt(EVIDENCE),
    }))),
    edges: req(T.list(T.obj({ from: req(T.id), to: req(T.id), kind: req(T.enum(EDGE_KINDS)) }))),
  }),
  'domain-glossary': common({
    terms: req(T.list(T.obj({
      term: req(T.str), meaning: req(T.str), code: opt(T.list(T.str)), nodes: opt(T.list(T.id)), changed: opt(T.bool), evidence: opt(EVIDENCE),
    }))),
  }),
  'workflow-models': common({
    lifecycles: req(T.list(T.obj({
      id: req(T.id), name: req(T.str), domain: opt(T.id), summary: opt(T.str),
      states: req(T.list(T.obj({ id: req(T.id), name: req(T.str), initial: opt(T.bool), final: opt(T.bool), changed: opt(T.bool) }))),
      transitions: req(T.list(T.obj({
        from: req(T.id), on: req(T.id), to: req(T.id), guard: opt(T.str), effect: opt(T.str), changed: opt(T.bool), evidence: opt(EVIDENCE),
      }, { trigger: MOVED_TRIGGER }))),
      rejections: opt(T.list(T.obj({
        state: req(T.id), on: req(T.id), kind: req(T.enum(['invalid', 'ignored'])), reason: req(T.str), changed: opt(T.bool),
      }, { trigger: MOVED_TRIGGER }))),
      evidence: opt(EVIDENCE),
    }, {
      triggers: '「きっかけ」の一覧はなくなりました。この項目を消し、transitions と rejections の "trigger" を "on" に変えて、全体像（big-picture）のコマンドかイベントの付箋 id を直接書いてください。',
    }))),
  }),
  'context-map': common({
    contexts: req(T.list(T.obj({
      id: req(T.id), name: req(T.str), tech: opt(T.str), responsibility: req(T.str),
      owns: req(T.list(T.str)), contract: req(T.list(T.str)), guarantees: opt(T.list(T.str)),
      domains: opt(T.list(T.id)), changed: opt(T.bool), evidence: opt(EVIDENCE),
    }))),
    relations: req(T.list(T.obj({ from: req(T.id), to: req(T.id), label: req(T.str), changed: opt(T.bool) }))),
  }),
};

const typeName = (v) => (v === null ? 'null' : Array.isArray(v) ? '配列' : typeof v === 'object' ? 'オブジェクト' : typeof v === 'string' ? '文字列' : typeof v === 'boolean' ? '真偽値' : typeof v === 'number' ? '数値' : typeof v);
const join = (path, key) => (typeof key === 'number' ? `${path}[${key}]` : path ? `${path}.${key}` : key);

function checkShape(v, spec, path, err) {
  switch (spec.t) {
    case 'str':
      if (typeof v !== 'string' || v.trim() === '') err(path, `空でない文字列を書いてください（今は ${typeName(v)}）。`);
      return;
    case 'id':
      if (typeof v !== 'string' || !ID.test(v)) err(path, `${JSON.stringify(v)} は id に使えません。英小文字で始め、英小文字・数字・ハイフンだけで書いてください。`);
      return;
    case 'bool':
      if (typeof v !== 'boolean') err(path, `true か false を書いてください（今は ${typeName(v)}）。`);
      return;
    case 'date':
      if (typeof v !== 'string' || !DATE.test(v)) err(path, `日付は "YYYY-MM-DD" の形で書いてください（今は ${JSON.stringify(v)}）。`);
      return;
    case 'enum':
      if (!spec.vals.includes(v)) err(path, `${JSON.stringify(v)} は使えません。${spec.vals.map((x) => `"${x}"`).join('、')} のどれかを書いてください${hint(v, spec.vals)}。`);
      return;
    case 'list':
      if (!Array.isArray(v)) { err(path, `配列を書いてください（今は ${typeName(v)}）。`); return; }
      v.forEach((item, i) => checkShape(item, spec.item, join(path, i), err));
      return;
    case 'obj': {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) { err(path, `オブジェクトを書いてください（今は ${typeName(v)}）。`); return; }
      const keys = Object.keys(spec.fields);
      for (const k of Object.keys(v)) {
        if (spec.moved[k]) err(join(path, k), spec.moved[k]);
        else if (!keys.includes(k)) err(join(path, k), `この項目は形式にありません。消すか、${keys.map((x) => `"${x}"`).join('、')} のどれかに直してください${hint(k, keys)}。`);
      }
      for (const [k, [s, required]] of Object.entries(spec.fields)) {
        if (v[k] === undefined) { if (required) err(join(path, k), `必須の項目がありません。`); continue; }
        checkShape(v[k], s, join(path, k), err);
      }
      return;
    }
    default:
      throw new Error(`unknown spec ${spec.t}`);
  }
}

// ---- suggestions ---------------------------------------------------------
function distance(a, b) {
  a = String(a); b = String(b);
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}
function closest(v, candidates) {
  let best = null, bestD = Infinity;
  for (const c of candidates) { const dd = distance(v, c); if (dd < bestD) { bestD = dd; best = c; } }
  return best !== null && bestD <= Math.max(2, Math.floor(String(v).length / 3)) ? best : null;
}
function hint(v, candidates) {
  const c = typeof v === 'string' ? closest(v, candidates) : null;
  return c ? `（近いもの: "${c}"）` : '';
}

// ---- references and rules --------------------------------------------------
function uniqueIds(list, key, path, label, err) {
  const seen = new Map();
  (list || []).forEach((item, i) => {
    const v = item?.[key];
    if (typeof v !== 'string') return;
    if (seen.has(v)) err(`${path}[${i}].${key}`, `${label} ${JSON.stringify(v)} が ${path}[${seen.get(v)}] と重複しています。別の名前にしてください。`);
    else seen.set(v, i);
  });
  return new Set(seen.keys());
}
function ref(v, set, path, label, err) {
  if (typeof v !== 'string' || set.has(v)) return;
  err(path, `${JSON.stringify(v)} という${label}はありません。定義済みの id を指定してください${hint(v, [...set])}。`);
}

function checkBigPicture(bp, err) {
  const domains = uniqueIds(bp.domains, 'id', 'domains', 'ドメイン id', err);
  const nodeIds = uniqueIds(bp.nodes, 'id', 'nodes', '付箋 id', err);
  const byId = new Map((bp.nodes || []).map((n) => [n.id, n]));
  (bp.nodes || []).forEach((n, i) => {
    const p = `nodes[${i}]`;
    ref(n.domain, domains, `${p}.domain`, 'ドメイン', err);
    if (n.type === 'policy' && n.execution === undefined) err(`${p}.execution`, `ポリシーには実行方式が必要です。${EXECUTIONS.map((x) => `"${x}"`).join('、')} のどれかを書いてください。`);
    if (n.type !== 'policy' && n.execution !== undefined) err(`${p}.execution`, `実行方式はポリシーの付箋にだけ書けます。消してください。`);
    if (n.type !== 'aggregate' && n.invariants !== undefined) err(`${p}.invariants`, `不変条件は集約の付箋にだけ書けます。消すか、この付箋の流れの先にある集約に移してください。`);
    if (n.type === 'aggregate' && n.attach) err(`${p}.attach`, `集約は貼らずに、コマンド → 集約 → イベントの並びで流れの中に置いてください。attach を消し、edges に { "from": "<コマンド>", "to": "${n.id}", "kind": "flow" } と { "from": "${n.id}", "to": "<イベント>", "kind": "flow" } を足してください。ルールは付箋の文ではなく invariants（不変条件）に書きます。`);
    if (n.attach) {
      ref(n.attach.to, nodeIds, `${p}.attach.to`, '付箋', err);
      const host = byId.get(n.attach.to);
      if (n.attach.to === n.id) err(`${p}.attach.to`, `付箋を自分自身には貼れません。別の付箋の id を指定してください。`);
      else if (host?.attach) err(`${p}.attach.to`, `${JSON.stringify(n.attach.to)} は別の付箋に貼られた付箋なので、その上には貼れません。流れの中の付箋を指定してください。`);
    }
  });
  const seenEdge = new Set();
  const out = new Map(), inc = new Map();
  (bp.edges || []).forEach((e, i) => {
    const p = `edges[${i}]`;
    ref(e.from, nodeIds, `${p}.from`, '付箋', err);
    ref(e.to, nodeIds, `${p}.to`, '付箋', err);
    const a = byId.get(e.from), b = byId.get(e.to);
    if (!a || !b) return;
    const key = `${e.from}>${e.to}>${e.kind}`;
    if (seenEdge.has(key)) err(p, `同じ矢印（${e.from} → ${e.to}）が二度書かれています。片方を消してください。`);
    seenEdge.add(key);
    if (e.from === e.to) err(p, `付箋から自分自身への矢印は書けません。`);
    if (e.kind === 'result') {
      if (a.type !== 'event') err(`${p}.from`, `点線（result）の矢印はイベントから始めてください（今は ${a.type}）。`);
      if (b.type !== 'readModel') err(`${p}.to`, `点線（result）の矢印はリードモデルに向けてください（今は ${b.type}）。`);
    } else {
      if (a.attach) err(`${p}.from`, `${JSON.stringify(e.from)} は別の付箋に貼られた付箋なので、流れの矢印は出せません。貼るのをやめるか、矢印を貼り先の付箋から出してください。`);
      if (b.attach) err(`${p}.to`, `${JSON.stringify(e.to)} は別の付箋に貼られた付箋なので、流れの矢印は向けられません。貼るのをやめるか、矢印を貼り先の付箋に向けてください。`);
    }
    if (a.attach && e.kind === 'result') err(`${p}.from`, `${JSON.stringify(e.from)} は別の付箋に貼られた付箋なので、矢印は出せません。`);
    if (e.kind === 'flow' && a.type === 'actor' && a.domain !== b.domain) {
      err(p, `アクター ${JSON.stringify(e.from)}（ドメイン ${JSON.stringify(a.domain)}）から別のドメインの ${JSON.stringify(e.to)} へは矢印を出せません。アクターは流れの起点なので、ドメイン ${JSON.stringify(b.domain)} にも同じ人のアクターの付箋を置き、そこから矢印を出してください。`);
    }
    if (e.kind === 'flow') {
      (out.get(e.from) || out.set(e.from, []).get(e.from)).push(b);
      (inc.get(e.to) || inc.set(e.to, []).get(e.to)).push(a);
    }
  });
  (bp.nodes || []).forEach((n, i) => {
    if (n.type === 'policy' && !n.attach) {
      // A scheduled policy may start from the clock ("毎日7時に") instead of an event.
      if (n.execution !== 'scheduled' && !(inc.get(n.id) || []).some((x) => x.type === 'event')) err(`nodes[${i}]`, `ポリシー ${JSON.stringify(n.id)} にはイベントからの流れの矢印が必要です（「〜されたら」の元になる出来事）。edges に { "from": "<イベント>", "to": "${n.id}", "kind": "flow" } を足してください。時刻で動くポリシーなら execution を "scheduled" にしてください。`);
      // A manual policy goes through the person who decides: policy → actor → command.
      const next = out.get(n.id) || [];
      if (!next.some((x) => x.type === 'command' || (x.type === 'actor' && (out.get(x.id) || []).some((y) => y.type === 'command')))) err(`nodes[${i}]`, `ポリシー ${JSON.stringify(n.id)} にはコマンドへの流れの矢印が必要です（次に何をするか）。edges に { "from": "${n.id}", "to": "<コマンド>", "kind": "flow" } を足してください。人が判断するなら ポリシー → アクター → コマンド とつないでください。`);
    }
    if (n.type === 'readModel') {
      // A read model is what an actor looks at to decide the next command, not a log of results.
      const use = 'リードモデルはアクターが次のコマンドを決めるために見るものです。誰も判断に使わない結果・ログ・出力なら、付箋ごと消してください';
      if (n.attach) {
        const host = byId.get(n.attach.to);
        if (host && host.type !== 'actor' && host.type !== 'command') err(`nodes[${i}].attach.to`, `リードモデル ${JSON.stringify(n.id)} はアクターかコマンドに貼ってください（今は ${host.type}）。${use}。`);
      } else {
        if (!(bp.edges || []).some((e) => e.kind === 'result' && e.to === n.id)) err(`nodes[${i}]`, `リードモデル ${JSON.stringify(n.id)} には、それを更新するイベントからの点線の矢印が必要です。edges に { "from": "<イベント>", "to": "${n.id}", "kind": "result" } を足してください。`);
        const next = out.get(n.id) || [];
        if (!next.some((x) => x.type === 'actor' || x.type === 'command')) err(`nodes[${i}]`, `リードモデル ${JSON.stringify(n.id)} を見て判断するアクターかコマンドへの流れの矢印が必要です。edges に { "from": "${n.id}", "to": "<アクター>", "kind": "flow" } を足してください。${use}。`);
        for (const x of next) if (x.type !== 'actor' && x.type !== 'command') err(`nodes[${i}]`, `リードモデル ${JSON.stringify(n.id)} からの流れの矢印はアクターかコマンドに向けてください（${JSON.stringify(x.id)} は ${x.type}）。`);
      }
    }
    if (n.type === 'aggregate' && !n.attach) {
      if (!(inc.get(n.id) || []).some((x) => x.type === 'command')) err(`nodes[${i}]`, `集約 ${JSON.stringify(n.id)} にはコマンドからの流れの矢印が必要です。edges に { "from": "<コマンド>", "to": "${n.id}", "kind": "flow" } を足してください。`);
      if (!(out.get(n.id) || []).some((x) => x.type === 'event')) err(`nodes[${i}]`, `集約 ${JSON.stringify(n.id)} にはイベントへの流れの矢印が必要です（集約が更新されて起きたこと）。edges に { "from": "${n.id}", "to": "<イベント>", "kind": "flow" } を足してください。`);
    }
    if (n.type === 'command' && !n.attach) {
      // A command must reach an event through flow edges (it may pass through an external system).
      const seen = new Set([n.id]); let frontier = [n.id], found = false;
      for (let depth = 0; depth < 3 && !found && frontier.length; depth++) {
        const next = [];
        for (const id of frontier) for (const m of out.get(id) || []) {
          if (m.type === 'event') found = true;
          else if (!seen.has(m.id) && m.type !== 'command' && m.type !== 'policy') { seen.add(m.id); next.push(m.id); }
        }
        frontier = next;
      }
      if (!found) err(`nodes[${i}]`, `コマンド ${JSON.stringify(n.id)} から流れの矢印でたどれるイベントがありません。コマンドが起こすイベントへの矢印を edges に足してください。`);
    }
  });
  return { domains, nodeIds, byId };
}

function checkGlossary(g, bp, err) {
  uniqueIds(g.terms, 'term', 'terms', '用語', err);
  (g.terms || []).forEach((t, i) => (t.nodes || []).forEach((id, j) => ref(id, bp.nodeIds, `terms[${i}].nodes[${j}]`, '付箋（big-picture）', err)));
}

function checkWorkflows(w, bp, err) {
  uniqueIds(w.lifecycles, 'id', 'lifecycles', 'ライフサイクル id', err);
  // Transitions are driven by the big picture's own commands and events.
  const onRef = (v, path) => {
    const n = bp.byId.get(v);
    if (typeof v !== 'string') return;
    if (!n) ref(v, new Set([...bp.byId.values()].filter((x) => x.type === 'command' || x.type === 'event').map((x) => x.id)), path, 'コマンドかイベントの付箋（big-picture）', err);
    else if (n.type !== 'command' && n.type !== 'event') err(path, `${JSON.stringify(v)} は${n.type}の付箋です。状態を動かすコマンドかイベントの付箋 id を書いてください。時刻で動くなら、scheduled のポリシーから出るコマンドを指定します。`);
  };
  (w.lifecycles || []).forEach((lc, i) => {
    const p = `lifecycles[${i}]`;
    if (lc.domain !== undefined) ref(lc.domain, bp.domains, `${p}.domain`, 'ドメイン（big-picture）', err);
    const states = uniqueIds(lc.states, 'id', `${p}.states`, '状態 id', err);
    const initials = (lc.states || []).filter((s) => s.initial === true).length;
    if (Array.isArray(lc.states) && initials !== 1) err(`${p}.states`, `最初の状態（"initial": true）はちょうど1つにしてください（今は ${initials} 個）。`);
    const pairs = new Map();
    (lc.transitions || []).forEach((t, j) => {
      const q = `${p}.transitions[${j}]`;
      ref(t.from, states, `${q}.from`, '状態', err);
      ref(t.to, states, `${q}.to`, '状態', err);
      onRef(t.on, `${q}.on`);
      const key = `${t.from}|${t.on}`;
      if (pairs.has(key) && !t.guard) err(q, `状態 ${JSON.stringify(t.from)} と ${JSON.stringify(t.on)} の遷移が ${pairs.get(key)} と重なっています。条件（guard）で分けるか、片方を消してください。`);
      if (!pairs.has(key)) pairs.set(key, q);
    });
    const rejected = new Set();
    (lc.rejections || []).forEach((r, j) => {
      const q = `${p}.rejections[${j}]`;
      ref(r.state, states, `${q}.state`, '状態', err);
      onRef(r.on, `${q}.on`);
      const key = `${r.state}|${r.on}`;
      if (rejected.has(key)) err(q, `状態 ${JSON.stringify(r.state)} と ${JSON.stringify(r.on)} の組が二度書かれています。片方を消してください。`);
      rejected.add(key);
      if (pairs.has(key)) err(q, `この組は ${pairs.get(key)} で遷移として書かれています。遷移と無効・無視のどちらかにしてください。`);
    });
  });
}

function checkContexts(c, bp, err) {
  const ids = uniqueIds(c.contexts, 'id', 'contexts', 'コンテキスト id', err);
  (c.contexts || []).forEach((x, i) => (x.domains || []).forEach((d, j) => ref(d, bp.domains, `contexts[${i}].domains[${j}]`, 'ドメイン（big-picture）', err)));
  (c.relations || []).forEach((r, i) => {
    ref(r.from, ids, `relations[${i}].from`, 'コンテキスト', err);
    ref(r.to, ids, `relations[${i}].to`, 'コンテキスト', err);
  });
}

/**
 * @param {Record<string, unknown>} data parsed JSON keyed by file name (without .json)
 * @returns {string[]} error lines; empty when valid
 */
export function validateModel(data) {
  const errors = [];
  const errFor = (file) => (path, msg) => errors.push(`data/${file}.json: ${path ? `${path}: ` : ''}${msg}`);
  const shapeOk = {};
  for (const file of DATA_FILES) {
    const err = errFor(file);
    if (!(file in data)) { err('', `ファイルがありません。\`domain-model.mjs init\` で雛形を作れます。`); continue; }
    const before = errors.length;
    const v = data[file];
    checkShape(v, SPECS[file], '', err);
    if (v && typeof v === 'object' && v.schema !== undefined && v.schema !== `${file}/v1`) err('schema', `${JSON.stringify(v.schema)} ではなく "${file}/v1" と書いてください。`);
    shapeOk[file] = errors.length === before;
  }
  // Cross-file checks need big-picture's ids; skip them when its shape is broken.
  if (!shapeOk['big-picture']) return errors;
  const bp = checkBigPicture(data['big-picture'], errFor('big-picture'));
  if (shapeOk['domain-glossary']) checkGlossary(data['domain-glossary'], bp, errFor('domain-glossary'));
  if (shapeOk['workflow-models']) checkWorkflows(data['workflow-models'], bp, errFor('workflow-models'));
  if (shapeOk['context-map']) checkContexts(data['context-map'], bp, errFor('context-map'));
  return errors;
}

/** Every evidence entry in the model, with where it was found. */
export function collectEvidence(data) {
  const found = [];
  const walk = (v, where) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${where}[${i}]`));
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (k === 'evidence' && Array.isArray(x)) x.forEach((e, i) => found.push({ ...e, where: `${where ? `${where}.` : ''}evidence[${i}]` }));
        else walk(x, where ? `${where}.${k}` : k);
      }
    }
  };
  for (const file of DATA_FILES) {
    const start = found.length;
    if (data[file]) walk(data[file], '');
    for (let i = start; i < found.length; i++) found[i].file = file;
  }
  return found;
}
