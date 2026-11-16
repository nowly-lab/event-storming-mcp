import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { lockPort } from "../src/server/daemon.ts";
import { tmp } from "./helpers.ts";

const CLI = new URL("../src/cli.ts", import.meta.url).pathname;

test("lockPort is stable per data folder, differs between folders and honours EVENT_STORMING_MCP_PORT", () => {
  const a = lockPort("/tmp/a", {}), b = lockPort("/tmp/b", {});
  assert.equal(a, lockPort("/tmp/a", {}));
  assert.notEqual(a, b);
  assert.ok(a >= 40000 && a < 60000);
  assert.equal(lockPort("/tmp/a", { EVENT_STORMING_MCP_PORT: "51234" }), 51234);
});

function serve(dir: string): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [CLI, "serve", "--foreground"], { env: { ...process.env, EVENT_STORMING_MCP_DATA_DIR: dir }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    c.stdout.on("data", (d) => (out += d));
    c.stderr.on("data", (d) => (out += d));
    // A winner keeps running; stop it after the losers have exited.
    const t = setTimeout(() => c.kill("SIGTERM"), 6000);
    c.on("exit", (code) => { clearTimeout(t); resolve({ code, out }); });
  });
}

test("racing servers on one data folder: exactly one listens, the others exit 1", async () => {
  for (let round = 0; round < 3; round++) {
    const t = tmp();
    try {
      const rs = await Promise.all([1, 2, 3, 4].map(() => serve(t.dir)));
      const losers = rs.filter((r) => r.code === 1 && /もう動いています/.test(r.out));
      const winners = rs.filter((r) => /^http:\/\/127\.0\.0\.1:\d+/m.test(r.out));
      assert.equal(winners.length, 1, rs.map((r) => r.out).join("\n---\n"));
      assert.equal(losers.length, 3);
    } finally {
      t.done();
    }
  }
});

test("a port taken by another program gives a clear error", async () => {
  const t = tmp();
  const blocker = createServer().listen(lockPort(t.dir, {}), "127.0.0.1");
  await new Promise((r) => blocker.once("listening", r));
  try {
    const r = await serve(t.dir);
    assert.equal(r.code, 1);
    assert.match(r.out, /EVENT_STORMING_MCP_PORT/);
  } finally {
    blocker.close();
    t.done();
  }
});
