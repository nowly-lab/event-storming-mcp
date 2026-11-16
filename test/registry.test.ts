import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { ProjectRegistry } from "../src/store/registry.ts";
import { git, sampleRepo, tmp } from "./helpers.ts";

test("register twice from two worktrees of one repo yields one project with two checkouts", async () => {
  const t = tmp();
  try {
    const { repo, modelDir } = sampleRepo(t.dir);
    const wt = join(t.dir, "wt");
    git(repo, "worktree", "add", "-q", wt, "-b", "feature");
    const reg = new ProjectRegistry(join(t.dir, "data"));
    const a = await reg.register(modelDir);
    const b = await reg.register(join(wt, "docs", "model"));
    assert.equal(a.slug, b.slug);
    assert.equal(b.modelPath, "docs/model");
    assert.equal(b.origin, "https://example.com/acme/shop.git");
    assert.deepEqual(b.checkouts.map((c) => c.root), [realpathSync(repo), realpathSync(wt)]);
    assert.equal((await reg.list()).length, 1);
    assert.equal(b.name, "sample");
  } finally {
    t.done();
  }
});

test("writeTarget follows the latest register and can be switched", async () => {
  const t = tmp();
  try {
    const { repo, modelDir } = sampleRepo(t.dir);
    const wt = join(t.dir, "wt");
    git(repo, "worktree", "add", "-q", wt, "-b", "feature");
    const reg = new ProjectRegistry(join(t.dir, "data"));
    await reg.register(modelDir);
    const p = await reg.register(join(wt, "docs", "model"));
    assert.equal(p.writeTarget, realpathSync(wt));
    const q = await reg.setWriteTarget(p.slug, realpathSync(repo));
    assert.equal(q.writeTarget, realpathSync(repo));
    await assert.rejects(reg.setWriteTarget(p.slug, "/nowhere"), /登録されていない作業場所/);
  } finally {
    t.done();
  }
});

test("register rejects a folder without data/big-picture.json", async () => {
  const t = tmp();
  try {
    const empty = join(t.dir, "empty");
    mkdirSync(empty);
    const reg = new ProjectRegistry(join(t.dir, "data"));
    await assert.rejects(reg.register(empty), /init を先に/);
  } finally {
    t.done();
  }
});

test("repo without origin falls back to real path", async () => {
  const t = tmp();
  try {
    const { repo, modelDir } = sampleRepo(t.dir, null);
    const reg = new ProjectRegistry(join(t.dir, "data"));
    const p = await reg.register(modelDir);
    assert.equal(p.origin, null);
    assert.equal(p.checkouts[0].root, realpathSync(repo));
    const again = await new ProjectRegistry(join(t.dir, "data")).get(p.slug);
    assert.deepEqual(again, p);
  } finally {
    t.done();
  }
});
