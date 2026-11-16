// Diagram layout with the vendored ELK bundle. Runs at render time, so the HTML is static.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ELK = require('../vendor/elk.bundled.js');
const elk = new ELK();

const r1 = (n) => Math.round(n * 10) / 10;

/** Rough text width for a mix of Japanese and ASCII at the given font size. */
export function textWidth(text, size) {
  let w = 0;
  for (const ch of String(text)) w += ch.charCodeAt(0) > 0x2e7f ? size : size * 0.58;
  return w;
}

// ---- big picture board --------------------------------------------------------
export const STICKY_W = 112;
const STICKY_MIN_H = 96;
const ACTOR = [78, 54];
// Attachments overlap only the edge of their host, so both texts stay readable.
const ATTACH = {
  'above': [0.12, -0.84], 'below': [0.16, 0.86],
  'above-right': [0.62, -0.8], 'below-right': [0.62, 0.84],
  'above-left': [-0.58, -0.8], 'below-left': [-0.54, 0.84],
};

function stickySize(node) {
  if (node.type === 'actor') return [ACTOR[0], Math.max(ACTOR[1], 22 + Math.ceil(textWidth(node.text, 12) / (ACTOR[0] - 12)) * 16)];
  const lines = Math.ceil(textWidth(node.text, 13) / (STICKY_W - 20));
  return [STICKY_W, Math.max(STICKY_MIN_H, 40 + lines * 19)];
}

/**
 * Lays out the board: domains become ELK compound nodes, flow stickies are laid out left to right,
 * attached stickies are placed relative to their host.
 */
export async function layoutBoard(bp) {
  const byId = new Map(bp.nodes.map((n) => [n.id, n]));
  const attached = new Map();
  for (const n of bp.nodes) if (n.attach) (attached.get(n.attach.to) || attached.set(n.attach.to, []).get(n.attach.to)).push(n);
  const size = new Map(bp.nodes.map((n) => [n.id, stickySize(n)]));
  const STD_H = STICKY_MIN_H;

  const box = new Map();
  for (const n of bp.nodes) {
    if (n.attach) continue;
    const [w, h] = size.get(n.id);
    let minX = 0, minY = 0, maxX = w, maxY = h;
    for (const a of attached.get(n.id) || []) {
      const [ox, oy] = ATTACH[a.attach.pos];
      const [aw, ah] = size.get(a.id);
      const x = ox * STICKY_W, y = oy >= 0 ? h + (oy - 1) * STD_H : oy * STD_H;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + aw); maxY = Math.max(maxY, y + ah);
    }
    // Keep the host vertically centred so rows line up along the timeline.
    const pad = Math.max(-minY, maxY - h);
    box.set(n.id, { w: maxX - minX, h: h + 2 * pad, ox: -minX, oy: pad });
  }

  const flowEdges = bp.edges.filter((e) => box.has(e.from) && box.has(e.to));
  const domainOf = new Map(bp.nodes.map((n) => [n.id, n.domain]));

  // Step 1: lay out each domain on its own, left to right.
  const blocks = [];
  for (const d of bp.domains) {
    const members = bp.nodes.filter((n) => !n.attach && n.domain === d.id);
    if (!members.length) continue;
    const inner = await elk.layout({
      id: d.id,
      layoutOptions: {
        'elk.algorithm': 'layered', 'elk.direction': 'RIGHT',
        'elk.layered.spacing.nodeNodeBetweenLayers': '46', 'elk.spacing.nodeNode': '24',
        'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF', 'elk.spacing.componentComponent': '40',
        'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES', 'elk.randomSeed': '1',
      },
      children: members.map((n) => ({ id: n.id, width: box.get(n.id).w, height: box.get(n.id).h })),
      edges: flowEdges.filter((e) => domainOf.get(e.from) === d.id && domainOf.get(e.to) === d.id)
        .map((e, i) => ({ id: `${d.id}-e${i}`, sources: [e.from], targets: [e.to] })),
    });
    // The ellipse is the block: wide enough around the stickies, with room for the label on top.
    const rx = inner.width / 2 * 1.22 + 40, ry = inner.height / 2 * 1.3 + 56;
    blocks.push({ domain: d.id, inner, rx, ry, w: 2 * rx, h: 2 * ry });
  }

  // Step 2: arrange the domains along the timeline by the flow between them.
  const pairs = new Set();
  const domainEdges = [];
  for (const e of flowEdges) {
    const a = domainOf.get(e.from), b = domainOf.get(e.to);
    if (a === b || e.kind !== 'flow' || byId.get(e.from).type === 'actor' || pairs.has(`${a}>${b}`)) continue;
    pairs.add(`${a}>${b}`);
    domainEdges.push({ id: `d${domainEdges.length}`, sources: [`domain:${a}`], targets: [`domain:${b}`] });
  }
  const outer = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered', 'elk.direction': 'RIGHT',
      'elk.layered.spacing.nodeNodeBetweenLayers': '40', 'elk.spacing.nodeNode': '20',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF', 'elk.spacing.componentComponent': '30',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES', 'elk.randomSeed': '1',
    },
    children: blocks.map((b) => ({ id: `domain:${b.domain}`, width: b.w, height: b.h })),
    edges: domainEdges,
  });

  const M = 30, TOP = 84;
  const rect = new Map(), stickies = [], rings = [];
  for (const g of outer.children) {
    const b = blocks.find((x) => `domain:${x.domain}` === g.id);
    const cx = g.x + M + b.rx, cy = g.y + TOP + b.ry;
    rings.push({ domain: b.domain, cx, cy, rx: b.rx, ry: b.ry, top: cy - b.ry });
    const ix = cx - b.inner.width / 2, iy = cy - b.inner.height / 2 + 16;
    for (const c of b.inner.children) {
      const bx = box.get(c.id), n = byId.get(c.id);
      const [w, h] = size.get(n.id);
      const r = { x: ix + c.x + bx.ox, y: iy + c.y + bx.oy, w, h };
      rect.set(n.id, r);
      stickies.push({ node: n, r, z: 2 });
      for (const a of attached.get(n.id) || []) {
        const [ox, oy] = ATTACH[a.attach.pos];
        const [aw, ah] = size.get(a.id);
        const ar = { x: r.x + ox * STICKY_W, y: oy >= 0 ? r.y + h + (oy - 1) * STD_H : r.y + oy * STD_H, w: aw, h: ah };
        rect.set(a.id, ar);
        stickies.push({ node: a, r: ar, z: 3 });
      }
    }
  }
  const edges = bp.edges.map((e) => {
    const a = rect.get(e.from), b = rect.get(e.to);
    if (!a || !b) return null;
    let sx = a.x + a.w, sy = a.y + a.h / 2, tx = b.x - 3, ty = b.y + b.h / 2;
    if (tx < sx) { tx = b.x + b.w / 2; ty = b.y - 3; }
    const dx = Math.max(28, (tx - sx) / 2);
    return { kind: e.kind, from: e.from, to: e.to, d: `M${r1(sx)} ${r1(sy)} C${r1(sx + dx)} ${r1(sy)},${r1(tx - dx)} ${r1(ty)},${r1(tx)} ${r1(ty)}` };
  }).filter(Boolean);

  let minX = Infinity, maxX = 0, maxY = 0;
  for (const g of rings) { minX = Math.min(minX, g.cx - g.rx); maxX = Math.max(maxX, g.cx + g.rx); maxY = Math.max(maxY, g.cy + g.ry); }
  for (const s of stickies) { minX = Math.min(minX, s.r.x); maxX = Math.max(maxX, s.r.x + s.r.w); maxY = Math.max(maxY, s.r.y + s.r.h); }
  const shift = minX < 16 ? 16 - minX : 0;
  for (const s of stickies) s.r.x += shift;
  for (const g of rings) g.cx += shift;
  const shifted = edges.map((e) => ({ ...e, shift }));
  return {
    stickies: stickies.map((s) => ({ ...s, r: { x: r1(s.r.x), y: r1(s.r.y), w: s.r.w, h: s.r.h } })),
    rings: rings.map((g) => ({ ...g, cx: r1(g.cx), cy: r1(g.cy), rx: r1(g.rx), ry: r1(g.ry), top: r1(g.top) })),
    edges: shifted,
    width: Math.ceil(maxX + shift + 32),
    height: Math.ceil(maxY + 32),
  };
}

// ---- generic box-and-arrow diagram (state diagrams, context map) -----------------
/**
 * @param {{id:string,label:string,sub?:string,kind?:string}[]} nodes
 * @param {{from:string,to:string,label?:string}[]} edges
 */
export async function layoutGraph(nodes, edges, { direction = 'RIGHT' } = {}) {
  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.spacing.nodeNodeBetweenLayers': '70',
      'elk.spacing.nodeNode': '40',
      'elk.spacing.edgeLabel': '4',
      'elk.edgeLabels.placement': 'CENTER',
      'elk.layered.edgeLabels.sideSelection': 'ALWAYS_UP',
      'elk.randomSeed': '1',
    },
    children: nodes.map((n) => {
      const w = Math.max(textWidth(n.label, 15), n.sub ? textWidth(n.sub, 11) : 0) + 36;
      return { id: n.id, width: Math.max(96, Math.ceil(w)), height: n.sub ? 56 : 44 };
    }),
    edges: edges.map((e, i) => ({
      id: `g${i}`, sources: [e.from], targets: [e.to],
      labels: e.label ? [{ text: e.label, width: Math.ceil(textWidth(e.label, 12)) + 10, height: 18 }] : [],
    })),
  };
  const res = await elk.layout(graph);
  const pad = 16;
  const placed = res.children.map((c) => ({ ...nodes.find((n) => n.id === c.id), x: r1(c.x + pad), y: r1(c.y + pad), w: c.width, h: c.height }));
  const routed = res.edges.map((e, i) => {
    const pts = [];
    for (const s of e.sections || []) {
      pts.push(s.startPoint, ...(s.bendPoints || []), s.endPoint);
    }
    const label = e.labels?.[0];
    return {
      ...edges[i],
      points: pts.map((p) => [r1(p.x + pad), r1(p.y + pad)]),
      labelBox: label ? { x: r1(label.x + pad), y: r1(label.y + pad), w: label.width, h: label.height } : null,
    };
  });
  return { nodes: placed, edges: routed, width: Math.ceil(res.width + pad * 2), height: Math.ceil(res.height + pad * 2) };
}
