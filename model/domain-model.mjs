#!/usr/bin/env node
// Domain model CLI: validate the JSON data, render the HTML pages, and check that both are current.
//
//   npx -y github:nowly-lab/event-storming-mcp validate <model-dir>
//   npx -y github:nowly-lab/event-storming-mcp render   <model-dir>
//   npx -y github:nowly-lab/event-storming-mcp check    <model-dir> [--repo <product-root>]
//   npx -y github:nowly-lab/event-storming-mcp init     <model-dir>
//
// Exit codes: 0 ok, 1 the data or the pages need fixing, 2 usage error.
// Data format: ../docs/data-format.md
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DATA_FILES, collectEvidence, validateModel } from './lib/validate.mjs';
import { renderModel } from './lib/render.mjs';

const USAGE = `使い方:
  event-storming-mcp validate <model-dir>               データを検証する
  event-storming-mcp render   <model-dir>               検証が通ったら HTML を書き出す
  event-storming-mcp check    <model-dir> [--repo DIR]  検証し、HTML がデータと一致するか確かめる。
                                                           --repo を付けると証拠のパスと名前も確かめる
  event-storming-mcp init     <model-dir>               空のデータの雛形を作る（既存は上書きしない）`;

export function readData(dir) {
  const data = {}, errors = [];
  for (const file of DATA_FILES) {
    const p = join(dir, 'data', `${file}.json`);
    if (!existsSync(p)) continue;
    try {
      data[file] = JSON.parse(readFileSync(p, 'utf8'));
    } catch (e) {
      errors.push(`data/${file}.json: JSON として読めません: ${e.message}`);
    }
  }
  return { data, errors };
}

export function checkEvidence(data, repo) {
  const errors = [];
  for (const e of collectEvidence(data)) {
    const where = `data/${e.file}.json: ${e.where}`;
    const p = join(repo, e.path);
    if (!existsSync(p)) { errors.push(`${where}.path: ${JSON.stringify(e.path)} が ${repo} にありません。パスを直すか、実装がこのファイルを作ったか確かめてください。`); continue; }
    if (e.symbol) {
      let text = '';
      try { text = readFileSync(p, 'utf8'); } catch { errors.push(`${where}.path: ${JSON.stringify(e.path)} を読めません。ファイルを指定してください。`); continue; }
      if (!text.includes(e.symbol)) errors.push(`${where}.symbol: ${JSON.stringify(e.symbol)} が ${e.path} にありません。名前を直すか、実装がこの名前を作ったか確かめてください。`);
    }
  }
  return errors;
}

export async function run(argv, out = console) {
  const [cmd, dirArg, ...rest] = argv;
  if (!['validate', 'render', 'check', 'init'].includes(cmd) || !dirArg) { out.error(USAGE); return 2; }
  const dir = resolve(dirArg);
  let repo = null;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--repo' && rest[i + 1]) repo = resolve(rest[++i]);
    else { out.error(`知らない引数です: ${rest[i]}\n${USAGE}`); return 2; }
  }
  if (repo && cmd !== 'check') { out.error('--repo は check でだけ使えます。'); return 2; }

  if (cmd === 'init') {
    mkdirSync(join(dir, 'data'), { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    const base = (file, title, extra) => ({ schema: `${file}/v1`, title, checked: { revision: 'TODO', date: today }, ...extra });
    const templates = {
      'big-picture': base('big-picture', '全体像', { domains: [], nodes: [], edges: [] }),
      'domain-glossary': base('domain-glossary', '用語集', { terms: [] }),
      'workflow-models': base('workflow-models', 'ワークフロー', { lifecycles: [] }),
      'context-map': base('context-map', 'コンテキスト', { contexts: [], relations: [] }),
    };
    for (const [file, v] of Object.entries(templates)) {
      const p = join(dir, 'data', `${file}.json`);
      if (existsSync(p)) { out.log(`そのまま: data/${file}.json（既にあります）`); continue; }
      writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);
      out.log(`作成: data/${file}.json`);
    }
    return 0;
  }

  const { data, errors: readErrors } = readData(dir);
  const errors = [...readErrors, ...validateModel(data).filter((e) => !readErrors.some((r) => e.startsWith(r.split(':')[0]) && e.includes('ファイルがありません')))];
  if (errors.length) {
    out.error(`データに ${errors.length} 件の問題があります。直してからもう一度実行してください。`);
    for (const e of errors) out.error(e);
    return 1;
  }
  if (cmd === 'validate') { out.log('データは正しい形です。'); return 0; }

  const product = data['big-picture'].product || data['big-picture'].title;
  const pages = await renderModel(data, { product });
  if (cmd === 'render') {
    for (const [file, html] of Object.entries(pages)) writeFileSync(join(dir, file), html);
    out.log(`HTML を ${Object.keys(pages).length} 件書き出しました: ${Object.keys(pages).join(', ')}`);
    return 0;
  }

  // check
  const problems = [];
  for (const [file, html] of Object.entries(pages)) {
    const p = join(dir, file);
    if (!existsSync(p)) problems.push(`${file}: ありません。render を実行してください。`);
    else if (readFileSync(p, 'utf8') !== html) problems.push(`${file}: データと一致しません。HTML を手で直さず、データを直して render を実行してください。`);
  }
  if (repo) problems.push(...checkEvidence(data, repo));
  if (problems.length) {
    out.error(`${problems.length} 件の問題があります。`);
    for (const e of problems) out.error(e);
    return 1;
  }
  out.log(repo ? 'データは正しく、HTML は最新で、証拠のパスと名前はすべてあります。' : 'データは正しく、HTML は最新です。');
  return 0;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) process.exitCode = await run(process.argv.slice(2));
