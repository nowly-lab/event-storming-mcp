import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { writeAtomic } from "../store/fsutil.ts";

export type ServerInfo = { port: number; pid: number; version: string; url: string };

export async function readServerInfo(dataDir: string): Promise<ServerInfo | null> {
  const f = join(dataDir, "server.json");
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(await readFile(f, "utf8")) as ServerInfo;
  } catch {
    return null;
  }
}

export async function writeServerInfo(dataDir: string, info: ServerInfo): Promise<void> {
  await writeAtomic(join(dataDir, "server.json"), `${JSON.stringify(info, null, 2)}\n`);
}

export async function clearServerInfo(dataDir: string, pid: number): Promise<void> {
  const cur = await readServerInfo(dataDir);
  if (cur?.pid === pid) await rm(join(dataDir, "server.json"), { force: true });
}

/** The running server when server.json points at one that answers its health check with the same pid. */
export async function liveServer(dataDir: string): Promise<ServerInfo | null> {
  const info = await readServerInfo(dataDir);
  if (!info) return null;
  try {
    const r = await fetch(`${info.url}/api/health`, { signal: AbortSignal.timeout(1500) });
    const h = (await r.json()) as { pid?: number };
    return h.pid === info.pid ? info : null;
  } catch {
    return null;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Takes the one-server-per-data-folder lock (server.lock, created exclusively). A lock whose process is
 * gone is removed and taken again. Returns false when another live server holds it.
 */
export function acquireServerLock(dataDir: string): boolean {
  mkdirSync(dataDir, { recursive: true });
  const f = join(dataDir, "server.lock");
  for (let i = 0; i < 2; i++) {
    try {
      const fd = openSync(f, "wx");
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const holder = Number(readFileSync(f, "utf8").trim());
      if (holder && holder !== process.pid && alive(holder)) return false;
      rmSync(f, { force: true });
    }
  }
  return false;
}

export function releaseServerLock(dataDir: string): void {
  const f = join(dataDir, "server.lock");
  try {
    if (Number(readFileSync(f, "utf8").trim()) === process.pid) rmSync(f, { force: true });
  } catch {
    // Already gone.
  }
}

/** Returns the running server, starting a detached one when none answers (a stale server.json is replaced). */
export async function ensureServer(opts: { dataDir: string; cli: string; timeoutMs?: number }): Promise<ServerInfo> {
  const live = await liveServer(opts.dataDir);
  if (live) return live;
  const child = spawn(process.execPath, [opts.cli, "serve", "--foreground"], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, EVENT_STORMING_MCP_DATA_DIR: opts.dataDir },
  });
  child.unref();
  const end = Date.now() + (opts.timeoutMs ?? 15_000);
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, 100));
    // Another caller may have started the server first; its server is as good as ours.
    const info = await liveServer(opts.dataDir);
    if (info) return info;
  }
  throw new Error("サーバーを起動できませんでした。`event-storming-mcp serve --foreground` を実行して、表示される誤りを確かめてください。");
}

/** Stops the running server. Returns false when none was running. */
export async function stopServer(dataDir: string): Promise<boolean> {
  const info = await liveServer(dataDir);
  if (!info) return false;
  process.kill(info.pid, "SIGTERM");
  const end = Date.now() + 5000;
  while (Date.now() < end && (await liveServer(dataDir))) await new Promise((r) => setTimeout(r, 100));
  return true;
}
