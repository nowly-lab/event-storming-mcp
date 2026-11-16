import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareRenders } from "../scripts/compare-renders.mjs";
import { main } from "../src/cli.ts";

const SAMPLE = new URL("./model/fixtures/sample", import.meta.url).pathname;
const quiet = { out: () => {}, err: () => {} };

test("compareRenders reports identical pages and a changed page", async () => {
  const dir = mkdtempSync(join(tmpdir(), "esm-cmp-"));
  try {
    cpSync(SAMPLE, dir, { recursive: true });
    await main(["render", dir], quiet);
    assert.deepEqual(await compareRenders(dir), []);
    writeFileSync(join(dir, "context-map.html"), "changed");
    assert.deepEqual(await compareRenders(dir), ["context-map.html"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
