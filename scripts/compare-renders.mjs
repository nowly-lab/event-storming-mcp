#!/usr/bin/env node
// Renders each model directory in memory with this repository's engine and compares the result with
// the pages already in that directory, byte for byte. Used to prove the move from the skill script
// changes no product's pages.
//   node scripts/compare-renders.mjs <model-dir>...
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readData } from '../model/domain-model.mjs';
import { renderModel } from '../model/lib/render.mjs';

/** Returns the page files whose rendering differs from the file on disk (missing counts as different). */
export async function compareRenders(dir) {
  const { data, errors } = readData(resolve(dir));
  if (errors.length) throw new Error(errors.join('\n'));
  const product = data['big-picture'].product || data['big-picture'].title;
  const pages = await renderModel(data, { product });
  return Object.entries(pages)
    .filter(([file, html]) => { const p = join(dir, file); return !existsSync(p) || readFileSync(p, 'utf8') !== html; })
    .map(([file]) => file);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dirs = process.argv.slice(2);
  if (!dirs.length) { console.error('使い方: node scripts/compare-renders.mjs <model-dir>...'); process.exit(2); }
  let same = 0;
  for (const dir of dirs) {
    try {
      const diff = await compareRenders(dir);
      if (diff.length) console.log(`違う: ${dir}: ${diff.join(', ')}`);
      else { same++; console.log(`一致: ${dir}`); }
    } catch (e) { console.log(`読めない: ${dir}: ${e.message}`); }
  }
  console.log(`一致: ${same}/${dirs.length}`);
  process.exitCode = same === dirs.length ? 0 : 1;
}
