import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { promisify } from "node:util";
import { writeAtomic } from "./fsutil.ts";

const run = promisify(execFile);

export type Checkout = { root: string; registeredAt: string };
/** A repository's model folder. Several checkouts (Orca worktrees) of one repository share one project. */
export type Project = {
  slug: string;
  name: string;
  origin: string | null;
  /** Model folder relative to the repository root, with "/" separators. */
  modelPath: string;
  checkouts: Checkout[];
  /** The checkout whose files the server writes; one of `checkouts`. */
  writeTarget: string;
};

async function git(cwd: string, ...args: string[]): Promise<string | null> {
  try {
    return (await run("git", args, { cwd })).stdout.trim();
  } catch {
    return null;
  }
}

export function modelDirOf(p: Project, root = p.writeTarget): string {
  return join(root, ...p.modelPath.split("/").filter(Boolean));
}

export class ProjectRegistry {
  readonly dir: string;
  constructor(dataDir: string) {
    this.dir = join(dataDir, "projects");
  }

  async register(modelDirArg: string): Promise<Project> {
    if (!existsSync(join(modelDirArg, "data", "big-picture.json"))) {
      throw new Error(`${modelDirArg} に data/big-picture.json がありません。モデルフォルダを指定するか、init を先に実行してください。`);
    }
    const modelDir = realpathSync(modelDirArg);
    const top = await git(modelDir, "rev-parse", "--show-toplevel");
    const root = top ? realpathSync(top) : modelDir;
    const origin = top ? await git(modelDir, "remote", "get-url", "origin") : null;
    const modelPath = relative(root, modelDir).split(sep).join("/");
    const key = origin ? `${origin}#${modelPath}` : modelDir;
    const repoName = origin ? basename(origin).replace(/\.git$/, "") : basename(root);
    const slug = `${repoName.toLowerCase().replace(/[^a-z0-9-]+/g, "-")}-${createHash("sha256").update(key).digest("hex").slice(0, 6)}`;
    const bp = JSON.parse(await readFile(join(modelDir, "data", "big-picture.json"), "utf8"));
    const prev = await this.find(slug);
    const now = new Date().toISOString();
    const checkouts = prev ? prev.checkouts.filter((c) => c.root !== root) : [];
    const known = prev?.checkouts.find((c) => c.root === root);
    checkouts.push(known ?? { root, registeredAt: now });
    const p: Project = { slug, name: bp.product || bp.title || repoName, origin, modelPath, checkouts: sortByTime(checkouts), writeTarget: root };
    await this.save(p);
    return p;
  }

  async list(): Promise<Project[]> {
    if (!existsSync(this.dir)) return [];
    const out: Project[] = [];
    for (const slug of (await readdir(this.dir)).sort()) {
      const p = await this.find(slug);
      if (p) out.push(p);
    }
    return out;
  }

  async get(slugOrName: string): Promise<Project> {
    const p = (await this.find(slugOrName)) ?? (await this.list()).find((x) => x.name === slugOrName);
    if (!p) throw new Error(`プロジェクト ${JSON.stringify(slugOrName)} は登録されていません。register_project（または add <model-dir>）で登録してください。`);
    return p;
  }

  async setWriteTarget(slug: string, checkoutRoot: string): Promise<Project> {
    const p = await this.get(slug);
    if (!p.checkouts.some((c) => c.root === checkoutRoot)) {
      throw new Error(`${checkoutRoot} はこのプロジェクトに登録されていない作業場所です。先に登録してください。`);
    }
    const next = { ...p, writeTarget: checkoutRoot };
    await this.save(next);
    return next;
  }

  private async find(slug: string): Promise<Project | null> {
    if (!/^[a-z0-9-]+$/.test(slug)) return null;
    const f = join(this.dir, slug, "project.json");
    if (!existsSync(f)) return null;
    return JSON.parse(await readFile(f, "utf8")) as Project;
  }

  private async save(p: Project): Promise<void> {
    await writeAtomic(join(this.dir, p.slug, "project.json"), `${JSON.stringify(p, null, 2)}\n`);
  }
}

function sortByTime(cs: Checkout[]): Checkout[] {
  return [...cs].sort((a, b) => a.registeredAt.localeCompare(b.registeredAt));
}
