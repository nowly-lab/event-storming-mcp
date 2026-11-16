import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { lockPort } from "../src/server/daemon.ts";
import { join } from "node:path";
import { tmp } from "./helpers.ts";

const CLI = new URL("../src/cli.ts", import.meta.url).pathname;

test("lockPort depends only on the data folder", () => {
  const a = lockPort("/tmp/a"), b = lockPort("/tmp/b");
  assert.equal(a, lockPort("/tmp/a"));
  assert.notEqual(a, b);
  assert.ok(a >= 40000 && a < 60000);
});

function serve(dir: string, extra: string[] = []): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [CLI, "serve", "--foreground", ...extra], { env: { ...process.env, EVENT_STORMING_MCP_DATA_DIR: dir }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    c.stdout.on("data", (d) => (out += d));
    c.stderr.on("data", (d) => (out += d));
    // A winner keeps running; stop it after the losers have exited.
    const t = setTimeout(() => c.kill("SIGTERM"), 4000);
    c.on("exit", (code) => { clearTimeout(t); resolve({ code, out }); });
  });
}

test("racing servers on one data folder: exactly one listens, the others exit 1", async () => {
  for (let round = 0; round < 2; round++) {
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
  const blocker = createServer().listen(lockPort(t.dir), "127.0.0.1");
  await new Promise((r) => blocker.once("listening", r));
  try {
    const r = await serve(t.dir);
    assert.equal(r.code, 1);
    assert.match(r.out, /EVENT_STORMING_MCP_DATA_DIR/);
  } finally {
    blocker.close();
    t.done();
  }
});

test("different HTTP ports do not make a second server for one data folder", async () => {
  const t = tmp();
  try {
    const rs = await Promise.all([serve(t.dir, ["--port", "0"]), serve(t.dir, ["--port", "0"]), serve(t.dir)]);
    assert.equal(rs.filter((r) => /^http:\/\/127\.0\.0\.1:\d+/m.test(r.out)).length, 1, rs.map((r) => r.out).join("\n---\n"));
  } finally {
    t.done();
  }
});

test("racing servers with a registered project record its first version once", async () => {
  const t = tmp();
  try {
    const { sampleRepo } = await import("./helpers.ts");
    const { ProjectRegistry } = await import("../src/store/registry.ts");
    const { HistoryStore } = await import("../src/store/history.ts");
    const { modelDir } = sampleRepo(t.dir);
    const dataDir = join(t.dir, "data");
    const p = await new ProjectRegistry(dataDir).register(modelDir);
    await Promise.all([1, 2, 3, 4].map(() => serve(dataDir)));
    const versions = (await new HistoryStore(dataDir).list(p.slug)).map((e) => e.version);
    assert.deepEqual(versions, [1]);
  } finally {
    t.done();
  }
});
