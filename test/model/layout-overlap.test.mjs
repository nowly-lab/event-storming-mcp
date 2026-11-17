// Stickies on the big picture never overlap, keep a gap from their host and stay inside their domain ellipse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readData } from '../../model/domain-model.mjs';
import { layoutBoard } from '../../model/lib/layout.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const POS = ['above', 'below', 'above-right', 'below-right', 'above-left', 'below-left'];

/** A crowded board: hosts with three stickies in every position, long texts, and stickies stuck across domains. */
function crowded() {
  const domains = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  const nodes = [], edges = [];
  for (const d of ['a', 'b']) {
    for (let i = 0; i < 4; i++) {
      const id = `${d}-e${i}`;
      nodes.push({ id, type: i % 2 ? 'event' : 'command', domain: d, text: i === 2 ? 'とても長い文の付箋で、何行にも折り返して高さが増える。'.repeat(3) : `付箋 ${id}` });
      if (i) edges.push({ from: `${d}-e${i - 1}`, to: id, kind: 'flow' });
      if (i === 1 || i === 2) for (const pos of POS) for (let k = 0; k < 3; k++) {
        nodes.push({ id: `${id}-${pos}-${k}`, type: 'hotspot', domain: k === 2 ? (d === 'a' ? 'b' : 'a') : d, text: k === 1 ? '長いホットスポットの文。'.repeat(6) : `${pos} ${k}`, attach: { to: id, pos } });
      }
    }
  }
  edges.push({ from: 'a-e3', to: 'b-e0', kind: 'flow' });
  return { domains, nodes, edges };
}

const boards = () => [['sample', readData(join(here, 'fixtures', 'sample')).data['big-picture']], ['crowded', crowded()]];
const hostOf = (bp, n) => (n.attach ? bp.nodes.find((x) => x.id === n.attach.to) : n);

test('no two stickies overlap', async () => {
  for (const [name, bp] of boards()) {
    const s = (await layoutBoard(bp)).stickies;
    for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) {
      const a = s[i].r, b = s[j].r;
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      assert.ok(ox <= 0 || oy <= 0, `${name}: ${s[i].node.id} overlaps ${s[j].node.id}`);
    }
  }
});

test('attachments keep a gap from their host', async () => {
  for (const [name, bp] of boards()) {
    const s = (await layoutBoard(bp)).stickies;
    const r = new Map(s.map((x) => [x.node.id, x.r]));
    for (const x of s.filter((x) => x.node.attach)) {
      const a = x.r, b = r.get(x.node.attach.to);
      const gx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w)), gy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
      assert.ok(Math.max(gx, gy) >= 10 - 0.11, `${name}: ${x.node.id} is ${Math.max(gx, gy)}px from its host`);
    }
  }
});

test('every sticky sits inside its ellipse', async () => {
  for (const [name, bp] of boards()) {
    const L = await layoutBoard(bp);
    for (const st of L.stickies) {
      const g = L.rings.find((x) => x.domain === hostOf(bp, st.node).domain);
      for (const [px, py] of [[st.r.x, st.r.y], [st.r.x + st.r.w, st.r.y], [st.r.x, st.r.y + st.r.h], [st.r.x + st.r.w, st.r.y + st.r.h]]) {
        assert.ok(((px - g.cx) / g.rx) ** 2 + ((py - g.cy) / g.ry) ** 2 <= 1.0001, `${name}: ${st.node.id} pokes out of ${g.domain}`);
      }
    }
  }
});
