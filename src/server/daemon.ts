import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
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

/**
 * The port that is the server's lock. It is derived from the data folder (or set by
 * EVENT_STORMING_MCP_PORT), and the server listens on it: the operating system lets only one process
 * listen on a port and frees it when that process ends, so there is never a second writer and never a
 * stale lock to recover.
 */
export function lockPort(dataDir: string, env: Record<string, string | undefined> = process.env): number {
  const fixed = Number(env.EVENT_STORMING_MCP_PORT);
  if (Number.isInteger(fixed) && fixed > 0 && fixed < 65536) return fixed;
  let real = dataDir;
  try {
    real = realpathSync(dataDir);
  } catch {
    // Not created yet: the path as given.
  }
  return 40000 + (createHash("sha256").update(real).digest().readUInt32BE(0) % 20000);
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
