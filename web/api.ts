import type { ApplyResult, Model, Op, Project, Removal, VersionEntry } from "./types.ts";

const nonce = () => document.querySelector<HTMLMetaElement>('meta[name="esm-nonce"]')?.content ?? "";
const base = (slug: string) => `/api/projects/${encodeURIComponent(slug)}`;

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url);
  const body = await r.json();
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  return body as T;
}
async function post<T>(url: string, body: object): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, nonce: nonce() }) });
  const out = await r.json();
  if (!r.ok) throw new Error(out.error ?? `HTTP ${r.status}`);
  return out as T;
}

export const api = {
  projects: () => get<Project[]>("/api/projects"),
  model: (slug: string) => get<{ version: number; data: Model; warnings: string[]; htmlCurrent: boolean }>(`${base(slug)}/model`),
  history: (slug: string) => get<VersionEntry[]>(`${base(slug)}/history`),
  pageUrl: (slug: string, page: string, version?: number) => `${base(slug)}/pages/${page}${version ? `?version=${version}` : ""}`,
  apply: (slug: string, baseVersion: number, ops: Op[]) => post<ApplyResult>(`${base(slug)}/changes`, { baseVersion, ops }),
  previewRemove: (slug: string, id: string) => post<{ version: number; removal: Removal }>(`${base(slug)}/preview-remove`, { id }),
  restore: (slug: string, version: number, baseVersion: number) => post<ApplyResult>(`${base(slug)}/restore`, { version, baseVersion }),
  writeTarget: (slug: string, checkoutRoot: string) => post<Project>(`${base(slug)}/write-target`, { checkoutRoot }),
};
