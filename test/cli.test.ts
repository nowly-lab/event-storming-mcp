import { test } from "node:test";
import assert from "node:assert/strict";
import { main } from "../src/cli.ts";
import { VERSION } from "../src/version.ts";

function io() {
  const out: string[] = [], err: string[] = [];
  return { out, err, io: { out: (s: string) => out.push(s), err: (s: string) => err.push(s) } };
}

test("cli: unknown command prints usage and exits 2", async () => {
  const c = io();
  assert.equal(await main(["nope"], c.io), 2);
  assert.match(c.err.join(""), /使い方/);
});

test("cli: --version prints package version", async () => {
  const c = io();
  assert.equal(await main(["--version"], c.io), 0);
  assert.equal(c.out.join("").trim(), VERSION);
});

import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SAMPLE = new URL("./model/fixtures/sample", import.meta.url).pathname;

test("cli: check on fixture prints the same lines and exit code as the original script", async () => {
  const dir = mkdtempSync(join(tmpdir(), "esm-cli-"));
  try {
    cpSync(SAMPLE, dir, { recursive: true });
    const r = io();
    assert.equal(await main(["render", dir], r.io), 0);
    assert.match(r.out.join(""), /HTML を 6 件書き出しました/);
    const c = io();
    assert.equal(await main(["check", dir], c.io), 0);
    assert.equal(c.out.join(""), "データは正しく、HTML は最新です。\n");
    const bad = io();
    assert.equal(await main(["check", dir, "--bogus"], bad.io), 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
