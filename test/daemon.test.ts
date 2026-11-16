import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ensureServer, readServerInfo, stopServer } from "../src/server/daemon.ts";
import { tmp } from "./helpers.ts";

const CLI = new URL("../src/cli.ts", import.meta.url).pathname;

test("ensureServer replaces stale server.json", async () => {
  const t = tmp();
  try {
    mkdirSync(t.dir, { recursive: true });
    writeFileSync(join(t.dir, "server.json"), JSON.stringify({ port: 1, pid: 999999, version: "0" }));
    const s = await ensureServer({ dataDir: t.dir, cli: CLI });
    assert.match(s.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.notEqual(s.pid, 999999);
    const h = await (await fetch(`${s.url}/api/health`)).json();
    assert.equal(h.pid, s.pid);
    assert.equal((await readServerInfo(t.dir))?.pid, s.pid);
    await stopServer(t.dir);
  } finally {
    t.done();
  }
});

test("second serve reuses the running server", async () => {
  const t = tmp();
  try {
    const a = await ensureServer({ dataDir: t.dir, cli: CLI });
    const b = await ensureServer({ dataDir: t.dir, cli: CLI });
    assert.equal(a.pid, b.pid);
    assert.equal(a.url, b.url);
    assert.equal(await stopServer(t.dir), true);
    assert.equal(await stopServer(t.dir), false);
  } finally {
    t.done();
  }
});

test("simultaneous startup leaves one server", async () => {
  const t = tmp();
  try {
    const [a, b] = await Promise.all([ensureServer({ dataDir: t.dir, cli: CLI }), ensureServer({ dataDir: t.dir, cli: CLI })]);
    assert.equal(a.pid, b.pid);
    await new Promise((r) => setTimeout(r, 500));
    const { execFileSync } = await import("node:child_process");
    const procs = execFileSync("ps", ["-ax", "-o", "pid=,command="], { encoding: "utf8" }).split("\n").filter((l) => l.includes(CLI) && l.includes("--foreground") && !l.includes("ps -ax"));
    const mine = procs.filter((l) => { const pid = Number(l.trim().split(/\s+/)[0]); try { return execFileSync("ps", ["-p", String(pid), "-E", "-o", "command="], { encoding: "utf8" }).includes(t.dir); } catch { return false; } });
    assert.equal(mine.length, 1, mine.join("\n"));
    await stopServer(t.dir);
  } finally {
    t.done();
  }
});
