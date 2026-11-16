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
