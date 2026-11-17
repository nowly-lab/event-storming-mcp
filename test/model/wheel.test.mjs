import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wheelAction } from '../../model/lib/pan.mjs';
import { readData } from '../../model/domain-model.mjs';
import { renderModel } from '../../model/lib/render.mjs';

const ev = (deltaY, mod = {}) => ({ ctrlKey: false, metaKey: false, deltaY, ...mod });
const view = (scrollTop, scrollHeight, clientHeight) => ({ scrollTop, scrollHeight, clientHeight });

test('Ctrl/⌘ + wheel zooms', () => {
  assert.equal(wheelAction(ev(100, { ctrlKey: true }), view(0, 2000, 500)), 'zoom');
  assert.equal(wheelAction(ev(100, { metaKey: true }), view(0, 500, 500)), 'zoom');
});

test('the wheel moves the board while it can move that way', () => {
  assert.equal(wheelAction(ev(100), view(0, 2000, 500)), 'view');
  assert.equal(wheelAction(ev(-100), view(800, 2000, 500)), 'view');
});

test('the wheel moves the page when the board cannot move vertically', () => {
  assert.equal(wheelAction(ev(100), view(0, 500, 500)), 'page', 'no vertical room');
  assert.equal(wheelAction(ev(100), view(1500, 2000, 500)), 'page', 'already at the bottom');
  assert.equal(wheelAction(ev(-100), view(0, 2000, 500)), 'page', 'already at the top');
});

test('a sideways wheel is left to the browser', () => {
  assert.equal(wheelAction(ev(0), view(0, 500, 500)), 'view');
});

test('the generated page carries the wheel rule', async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const html = (await renderModel(readData(join(here, 'fixtures', 'sample')).data, { product: 'Sample' }))['big-picture.html'];
  assert.match(html, /function wheelAction\(/);
  assert.match(html, /wheelAction\(e, view\)/);
});
