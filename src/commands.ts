import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { Command } from "./cli.ts";
import { startServer } from "./server/http.ts";
import { acquireServerLock, clearServerInfo, ensureServer, liveServer, releaseServerLock, stopServer, writeServerInfo } from "./server/daemon.ts";
import { HistoryStore } from "./store/history.ts";
import { ModelStore } from "./store/model-store.ts";
import { dataDir } from "./store/paths.ts";
import { ProjectRegistry } from "./store/registry.ts";
import { VERSION } from "./version.ts";

const CLI = fileURLToPath(new URL("./cli" + (import.meta.url.endsWith(".ts") ? ".ts" : ".js"), import.meta.url));
// src/commands.ts and dist/commands.js are both one level below the package root.
const WEB = fileURLToPath(new URL("../dist/web", import.meta.url));

export function openBrowser(url: string): void {
  if (process.env.EVENT_STORMING_MCP_BROWSER === "none") return;
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
}

const serve: Command = async (args, io) => {
  const { values } = parseArgs({ args, options: { "no-open": { type: "boolean" }, foreground: { type: "boolean" }, port: { type: "string" } } });
  const dir = dataDir();
  if (!values.foreground) {
    const info = await ensureServer({ dataDir: dir, cli: CLI });
    io.out(`${info.url}\n`);
    if (!values["no-open"]) openBrowser(info.url);
    return 0;
  }
  if (!acquireServerLock(dir) || (await liveServer(dir))) {
    io.err("event-storming-mcp: サーバーはもう動いています（status で確かめられます）。\n");
    return 1;
  }
  const registry = new ProjectRegistry(dir);
  const history = new HistoryStore(dir);
  const store = new ModelStore({ registry, history });
  const { attachMcp } = await import("./mcp/http.ts");
  const deps = { store, registry, history, webRoot: WEB, port: values.port ? Number(values.port) : 0 };
  const server: { url: string } & Awaited<ReturnType<typeof startServer>> = await startServer({ ...deps, mcp: attachMcp(deps, () => server.url, openBrowser) });
  await writeServerInfo(dir, { port: server.port, pid: process.pid, version: VERSION, url: server.url });
  io.out(`${server.url}\n`);
  const shutdown = async () => {
    await clearServerInfo(dir, process.pid);
    releaseServerLock(dir);
    await server.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  return new Promise<number>(() => {});
};

const add: Command = async (args, io) => {
  if (!args[0]) {
    io.err("event-storming-mcp: add <model-dir> と書いてください。\n");
    return 2;
  }
  try {
    const p = await new ProjectRegistry(dataDir()).register(resolve(args[0]));
    io.out(`登録しました: ${p.name}（${p.slug}）書き込み先 ${p.writeTarget}\n`);
    return 0;
  } catch (e) {
    io.err(`event-storming-mcp: ${(e as Error).message}\n`);
    return 1;
  }
};

const status: Command = async (args, io) => {
  const info = await liveServer(dataDir());
  if (args.includes("--json")) io.out(`${JSON.stringify({ running: !!info, ...info })}\n`);
  else io.out(info ? `動いています: ${info.url}（pid ${info.pid}、版 ${info.version}）\n` : "止まっています。\n");
  return 0;
};

const stop: Command = async (_args, io) => {
  io.out((await stopServer(dataDir())) ? "止めました。\n" : "動いていません。\n");
  return 0;
};

const mcp: Command = async (_args, io) => {
  const { runStdio } = await import("./mcp/stdio.ts");
  return runStdio({ dataDir: dataDir(), cli: CLI, io });
};

export const commands: Record<string, Command> = { serve, add, status, stop, mcp };
