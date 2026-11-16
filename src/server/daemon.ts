import { spawn } from "node:child_process";
import { existsSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
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

const STALE_EMPTY_MS = 10_000;

/**
 * Takes the one-server-per-data-folder lock, server.lock, which holds the owner's pid.
 *
 * The lock is published complete: the pid is written to a private temporary file that is then hard-linked
 * to server.lock, which fails if the lock exists, so nobody ever sees a half-written lock. A lock whose
 * process is gone (or one left empty for a long time) is taken over by renaming it to a private name and
 * checking that the renamed file is the one judged stale; if another process replaced it meanwhile, it is
 * put back and the takeover is abandoned. Returns false when a live process holds the lock.
 */
export function acquireServerLock(dataDir: string): boolean {
  mkdirSync(dataDir, { recursive: true });
  const lock = join(dataDir, "server.lock");
  const unique = () => `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  for (let attempt = 0; attempt < 8; attempt++) {
    const tmp = `${lock}.${unique()}.tmp`;
    writeFileSync(tmp, String(process.pid));
    try {
      linkSync(tmp, lock);
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    } finally {
      rmSync(tmp, { force: true });
    }
    let seen: string;
    let age: number;
    try {
      seen = readFileSync(lock, "utf8");
      age = Date.now() - statSync(lock).mtimeMs;
    } catch {
      continue; // released meanwhile: try again
    }
    const holder = Number(seen.trim());
    if (holder === process.pid) return true;
    if (holder > 0 ? alive(holder) : age < STALE_EMPTY_MS) return false;
    const moved = `${lock}.${unique()}.stale`;
    try {
      renameSync(lock, moved);
    } catch {
      continue; // someone else moved or released it first
    }
    if (readFileSync(moved, "utf8") === seen) {
      rmSync(moved, { force: true });
      continue;
    }
    // Not the stale lock we judged: a new owner took it between our look and the rename. Put it back.
    try {
      linkSync(moved, lock);
    } catch {
      // A third process already holds a new lock; the moved one's owner will see it is no longer the holder.
    }
    rmSync(moved, { force: true });
    return false;
  }
  return false;
}

/** True while server.lock still names this process. The server checks it and stops when it lost the lock. */
export function holdsServerLock(dataDir: string): boolean {
  try {
    return Number(readFileSync(join(dataDir, "server.lock"), "utf8").trim()) === process.pid;
  } catch {
    return false;
  }
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
