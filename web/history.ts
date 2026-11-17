import { api } from "./api.ts";
import { authorLabel } from "./live.ts";
import { frameClass } from "./history-logic.ts";
import type { VersionEntry } from "./types.ts";

const FRAME_CSS = `.top,main>div:first-child,.toolbar,.panel,main>p.foot{display:none!important}main{padding:0!important}.board-wrap{display:block!important}.zoom-view{max-height:none!important;height:calc(100vh - 4px)}.note.esm-added{outline:4px solid #1f9d55;outline-offset:3px}.note.esm-removed{outline:4px solid #d64545;outline-offset:3px}.note.esm-updated{outline:4px solid #e0b100;outline-offset:3px}`;

/** The history tab: the list, the before/after boards with coloured frames, and restore. */
export async function showHistory(slug: string, root: { list: HTMLElement; detail: HTMLElement }, onCompare: (version: number) => void, onRestore: (version: number) => Promise<void>, selected?: number): Promise<void> {
  const entries = await api.history(slug);
  const pick = selected ?? entries[0]?.version;
  root.list.replaceChildren(...entries.map((e) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-current", String(e.version === pick));
    b.innerHTML = `<b>${time(e.at)}</b>${esc(authorLabel(e.author))}<small>版 ${e.version} · ${esc(e.summary)}</small>`;
    b.addEventListener("click", () => void showHistory(slug, root, onCompare, onRestore, e.version));
    li.appendChild(b);
    return li;
  }));
  const e = entries.find((x) => x.version === pick);
  if (!e) {
    root.detail.innerHTML = "<p>まだ変更がありません。</p>";
    return;
  }
  renderDetail(slug, e, entries[0].version, root.detail, onCompare, onRestore);
}

function renderDetail(slug: string, e: VersionEntry, latest: number, el: HTMLElement, onCompare: (v: number) => void, onRestore: (v: number) => Promise<void>) {
  el.innerHTML = `<header><h3>${time(e.at)} · ${esc(authorLabel(e.author))}（版 ${e.version}）</h3><button type="button" class="btn" data-compare>この版から比べる</button>${e.version === latest ? "" : '<button type="button" class="btn primary" data-restore>この版に戻す</button>'}</header>
<div class="pair"><figure><figcaption>変更前${e.version > 1 ? `（版 ${e.version - 1}）` : ""}</figcaption>${e.version > 1 ? `<iframe title="変更前" src="${api.pageUrl(slug, "big-picture.html", e.version - 1)}"></iframe>` : "<p>これが最初の版です。</p>"}</figure>
<figure><figcaption>変更後（版 ${e.version}）</figcaption><iframe title="変更後" src="${api.pageUrl(slug, "big-picture.html", e.version)}"></iframe></figure></div>
<div class="legend-diff"><span><i style="border-color:#1f9d55"></i>追加</span><span><i style="border-color:#d64545"></i>削除</span><span><i style="border-color:#e0b100"></i>変更</span><span>変更内容: ${esc(e.summary)}</span></div>`;
  el.querySelector("[data-restore]")?.addEventListener("click", () => void onRestore(e.version));
  el.querySelector("[data-compare]")?.addEventListener("click", () => onCompare(e.version));
  for (const f of el.querySelectorAll("iframe")) {
    f.addEventListener("load", () => {
      const doc = f.contentDocument;
      if (!doc) return;
      const st = doc.createElement("style");
      st.textContent = FRAME_CSS;
      doc.head.appendChild(st);
      const before = f.title === "変更前";
      for (const n of doc.querySelectorAll<HTMLElement>(".note")) {
        const c = frameClass(n.dataset.id!, e.diff);
        // Removed stickies exist only before and added ones only after; changed ones are framed on both sides.
        if (c && (before ? c !== "added" : c !== "removed")) n.classList.add(`esm-${c}`);
      }
      // Show the change at full size, centred.
      (doc.querySelector('.zoom-ctrl [data-z="one"]') as HTMLButtonElement | null)?.click();
      const first = doc.querySelector(".esm-added, .esm-removed, .esm-updated") ?? doc.querySelector(`#n-${CSS.escape(e.diff.updated[0] ?? e.diff.removed[0] ?? e.diff.added[0] ?? "")}`);
      first?.scrollIntoView({ block: "center", inline: "center" });
    });
  }
}

const time = (iso: string) => new Date(iso).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
