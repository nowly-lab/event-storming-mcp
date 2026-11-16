#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { engine } from "./model/engine.ts";
import { VERSION } from "./version.ts";

export const USAGE = `event-storming-mcp ${VERSION}
使い方:
  event-storming-mcp [serve] [--no-open] [--port N]   サーバーを起動して画面を開く（動いていれば開くだけ）
  event-storming-mcp add <model-dir>                  モデルフォルダをプロジェクトとして登録する
  event-storming-mcp mcp                              MCP サーバー（stdio）。サーバーが止まっていれば起動する
  event-storming-mcp status [--json]                  サーバーの状態
  event-storming-mcp stop                             サーバーを止める
  event-storming-mcp validate <model-dir>             データを検証する
  event-storming-mcp render   <model-dir>             検証が通ったら HTML を書き出す
  event-storming-mcp check    <model-dir> [--repo DIR] HTML がデータと一致するか（--repo で証拠も）確かめる
  event-storming-mcp init     <model-dir>             空のデータの雛形を作る（既存は上書きしない）

終了コード: 0 成功、1 データや HTML を直す必要がある、2 使い方の誤り。
環境変数: EVENT_STORMING_MCP_DATA_DIR（既定 ~/.event-storming-mcp）、EVENT_STORMING_MCP_BROWSER=none
`;

export type IO = { out: (s: string) => void; err: (s: string) => void };
export type Command = (args: string[], io: IO) => Promise<number>;

const MODEL_COMMANDS = new Set(["init", "validate", "render", "check"]);
/** Server-side commands are added by later modules; see registerCommand. */
const commands = new Map<string, Command>();
export function registerCommand(name: string, fn: Command): void {
  commands.set(name, fn);
}

export async function main(argv: string[], io: IO): Promise<number> {
  const [cmd = "serve", ...rest] = argv;
  if (cmd === "--version" || cmd === "-v") {
    io.out(`${VERSION}\n`);
    return 0;
  }
  if (cmd === "--help" || cmd === "-h" || cmd === "help") {
    io.out(USAGE);
    return 0;
  }
  if (MODEL_COMMANDS.has(cmd)) {
    const { run } = await engine();
    return run([cmd, ...rest], { log: (s: string) => io.out(`${s}\n`), error: (s: string) => io.err(`${s}\n`) });
  }
  const fn = commands.get(cmd);
  if (!fn) {
    io.err(`event-storming-mcp: 知らないコマンドです: ${cmd}\n\n${USAGE}`);
    return 2;
  }
  return fn(rest, io);
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  process.exitCode = await main(process.argv.slice(2), { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) });
}
