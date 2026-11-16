import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const SAMPLE = new URL("./model/fixtures/sample", import.meta.url).pathname;

export function tmp(prefix = "esm-"): { dir: string; done(): void } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } }).trim();
}

/** A git repository with the sample model at docs/model and an origin URL; returns its root and model dir. */
export function sampleRepo(root: string, origin: string | null = "https://example.com/acme/shop.git"): { repo: string; modelDir: string } {
  const repo = join(root, "repo");
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  if (origin) git(repo, "remote", "add", "origin", origin);
  const modelDir = join(repo, "docs", "model");
  cpSync(SAMPLE, modelDir, { recursive: true });
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "init");
  return { repo, modelDir };
}
