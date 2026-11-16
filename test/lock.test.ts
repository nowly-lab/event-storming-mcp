import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { utimesSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { acquireServerLock, releaseServerLock } from "../src/server/daemon.ts";
import { tmp } from "./helpers.ts";

const DAEMON = new URL("../src/server/daemon.ts", import.meta.url).href;

test("a lock file that is still being written (empty, fresh) is not taken as stale", () => {
  const t = tmp();
  try {
    writeFileSync(join(t.dir, "server.lock"), "");
    assert.equal(acquireServerLock(t.dir), false);
    // An empty lock left behind long ago is stale.
    const old = new Date(Date.now() - 60_000);
    utimesSync(join(t.dir, "server.lock"), old, old);
    assert.equal(acquireServerLock(t.dir), true);
    assert.equal(readFileSync(join(t.dir, "server.lock"), "utf8"), String(process.pid));
    releaseServerLock(t.dir);
  } finally {
    t.done();
  }
});

test("a lock held by a dead process is taken over", () => {
  const t = tmp();
  try {
    writeFileSync(join(t.dir, "server.lock"), "999999");
    assert.equal(acquireServerLock(t.dir), true);
    releaseServerLock(t.dir);
  } finally {
    t.done();
  }
});

function contender(dir: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const code = `import { acquireServerLock } from ${JSON.stringify(DAEMON)}; const ok = acquireServerLock(${JSON.stringify(dir)}); process.stdout.write(ok ? "yes" : "no"); setTimeout(() => {}, 400);`;
    const c = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    c.stdout.on("data", (d) => (out += d));
    c.on("exit", () => resolve(out === "yes"));
    c.on("error", reject);
  });
}

test("racing processes over a fresh folder and over a stale lock: exactly one wins every time", async () => {
  for (let round = 0; round < 6; round++) {
    const t = tmp();
    try {
      if (round % 2) writeFileSync(join(t.dir, "server.lock"), "999999");
      const wins = (await Promise.all([1, 2, 3, 4].map(() => contender(t.dir)))).filter(Boolean).length;
      assert.equal(wins, 1, `round ${round}`);
    } finally {
      t.done();
    }
  }
});
