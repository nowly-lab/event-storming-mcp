import { changeRows } from "./session-logic.ts";
import type { SessionDiff } from "./types.ts";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Fills 「このセッションの変更 (N)」. Pressing a row brings its sticky to the middle; a removed one stays in the list only. */
export function renderChanges(el: HTMLElement, d: SessionDiff, textOf: (id: string) => string, onJump: (id: string) => void): void {
  const rows = changeRows(d, textOf);
  el.innerHTML = `<h2>このセッションの変更 (${rows.length})</h2><p class="foot">版 ${d.from} から版 ${d.to} まで。押すと付箋へ移動します</p>` +
    (rows.length
      ? `<ol>${rows.map((r, i) => `<li><button type="button" class="chg ${r.kind}" data-i="${i}" ${r.jump ? "" : "disabled"}><b>${r.label}</b><span class="t">${esc(r.text)}</span><small>${esc(r.who)}</small></button></li>`).join("")}</ol>`
      : '<p class="empty">まだ変更はありません</p>');
  el.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button.chg");
    const r = b && rows[Number(b.dataset.i)];
    if (r?.jump) onJump(r.jump);
  };
}
