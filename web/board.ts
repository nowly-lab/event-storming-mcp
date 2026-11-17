import type { Edge, Model, NodeType, SessionDiff } from "./types.ts";

/** What the editor tells the shell. The shell owns the edit state and the server calls. */
export type BoardHooks = {
  startText(id: string, text: string): void;
  typing(text: string): void;
  commitText(): void;
  cancel(): void;
  busy(): void;
  idle(): void;
  connect(from: string, to: string): void;
  removeEdge(e: Edge): void;
  removeNode(id: string): void;
  select(id: string | null): void;
  navigate(page: string): void;
};

const EDIT_CSS = `
.note.esm-recent { box-shadow: 0 0 0 4px #1f9d55, 0 0 18px 4px rgba(31,157,85,.6) !important; }
.note.esm-warn { outline: 3px dashed #d64545; outline-offset: 3px; }
.note.esm-moving { transition: transform .3s ease !important; }
.esm-input { position: absolute; z-index: 40; font: 600 13px/1.4 var(--f-note); text-align: center; border: 2px solid var(--accent); border-radius: 3px; padding: 6px; resize: none; background: #fff; color: #24241f; }
.esm-tools { position: absolute; z-index: 41; display: flex; gap: 2px; padding: 3px; background: var(--paper); border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 3px 10px rgba(0,0,0,.18); transform: translateY(-100%); white-space: nowrap; }
.esm-tools button { font: 500 12px var(--f-ui); border: 0; background: transparent; color: var(--ink); padding: 4px 8px; border-radius: 5px; cursor: pointer; }
.esm-tools button:hover { background: var(--row); }
.esm-handle { position: absolute; z-index: 42; width: 16px; height: 16px; margin: -8px 0 0 -8px; border-radius: 50%; background: #1f9d55; border: 2px solid #fff; cursor: crosshair; box-shadow: 0 1px 4px rgba(0,0,0,.3); }
.esm-overlay { position: absolute; inset: 0; pointer-events: none; z-index: 39; overflow: visible; }
.esm-overlay path { fill: none; stroke: #1f9d55; stroke-width: 3; stroke-dasharray: 6 5; }
.edge.esm-sel { stroke: #d64545 !important; stroke-width: 4 !important; }
.board.esm-connecting .note { cursor: copy; }
.note.esm-s-added { outline: 4px solid #1f9d55; outline-offset: 4px; }
.note.esm-s-updated { outline: 4px solid #e0b100; outline-offset: 4px; }
.esm-badge { position: absolute; top: -14px; right: -8px; z-index: 5; padding: 1px 7px; border-radius: 99px; font: 700 11px/1.5 var(--f-ui); color: #fff; pointer-events: none; }
.esm-s-added > .esm-badge { background: #1f9d55; }
.esm-s-updated > .esm-badge { background: #b98f00; }
.edge.esm-s-added { stroke: #1f9d55 !important; stroke-width: 4 !important; }
`;

const PANEL_ROWS = (d: PanelData) => {
  const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const row = (k: string, v: string | null | false | undefined) => (v ? `<dt>${k}</dt><dd>${v}</dd>` : "");
  const ev = d.evidence.map((e) => `<div class="path">${esc(e.path)}${e.symbol ? ` <span class="code">${esc(e.symbol)}</span>` : ""}${e.note ? `<div class="foot">${esc(e.note)}</div>` : ""}</div>`).join("");
  return `<h2>付箋の詳細</h2><div class="head" style="background:var(--s-${d.color})">${esc(d.text)}</div><dl>${row("種類", esc(d.type))}${row("ドメイン", esc(d.domain))}${row("実行", d.execution && esc(d.execution))}${row("不変条件", d.invariants.map(esc).join("<br>"))}${row("貼り先", d.attachedTo && esc(d.attachedTo))}${row("前", d.from.map(esc).join("<br>"))}${row("次", d.to.map(esc).join("<br>"))}${row("メモ", d.note && esc(d.note))}${row("今回の計画", d.changed ? "変わる" : "")}${row("証拠", ev || "—")}</dl>`;
};
type PanelData = { type: string; color: string; domain: string; text: string; execution: string | null; invariants: string[]; note: string | null; changed: boolean; attachedTo: string | null; from: string[]; to: string[]; evidence: { path: string; symbol: string | null; note: string | null }[] };

/**
 * One page of the model in an iframe. The big picture gets the inline editor; a redraw of it swaps the
 * board in place (keeping zoom and scroll) and moves stickies from their old to their new place.
 */
export class Board {
  private frame: HTMLIFrameElement;
  private page = "";
  private hooks: BoardHooks;
  private model: Model | null = null;
  private selected: string | null = null;
  private selectedEdge: Edge | null = null;
  private connecting = false;
  private editing: string | null = null;

  constructor(stage: HTMLElement, hooks: BoardHooks) {
    this.hooks = hooks;
    this.frame = document.createElement("iframe");
    this.frame.title = "ドメインモデル";
    stage.replaceChildren(this.frame);
    window.addEventListener("resize", () => this.fitView());
  }

  get doc(): Document | null {
    return this.frame.contentDocument;
  }

  /** Loads a page; resolves when it is drawn. */
  load(url: string, page: string, model: Model): Promise<void> {
    this.page = page;
    this.model = model;
    this.selected = null;
    this.selectedEdge = null;
    return new Promise((resolve) => {
      this.frame.onload = () => {
        this.frame.onload = null;
        this.setup();
        resolve();
      };
      this.frame.src = url;
    });
  }

  /** Redraws with new HTML. The big picture swaps its board in place; other pages reload and keep their scroll. */
  async refresh(url: string, model: Model, opts: { anchor?: string } = {}): Promise<void> {
    this.model = model;
    const doc = this.doc;
    if (this.page !== "big-picture.html" || !doc?.getElementById("board")) {
      const y = doc?.scrollingElement?.scrollTop ?? 0;
      await this.load(url, this.page, model);
      if (this.doc?.scrollingElement) this.doc.scrollingElement.scrollTop = y;
      return;
    }
    const html = await (await fetch(url)).text();
    const next = new DOMParser().parseFromString(html, "text/html");
    const board = doc.getElementById("board")!;
    const nb = next.getElementById("board");
    if (!nb) return this.load(url, this.page, model);
    const before = positions(board);
    const view = board.closest(".zoom-view") as HTMLElement | null;
    const zoom = zoomOf(board);
    const anchorBefore = opts.anchor ? before.get(opts.anchor) : undefined;
    board.setAttribute("style", nb.getAttribute("style") ?? "");
    board.innerHTML = nb.innerHTML;
    const nodes = doc.getElementById("nodes");
    const nn = next.getElementById("nodes");
    if (nodes && nn) nodes.textContent = nn.textContent;
    const after = positions(board);
    // Keep the edited sticky where it was on screen.
    const anchorAfter = opts.anchor ? after.get(opts.anchor) : undefined;
    if (view && anchorBefore && anchorAfter) {
      view.scrollLeft += (anchorAfter.x - anchorBefore.x) * zoom;
      view.scrollTop += (anchorAfter.y - anchorBefore.y) * zoom;
    }
    // Move each sticky from its old place to the new one.
    for (const el of board.querySelectorAll<HTMLElement>(".note")) {
      const a = before.get(el.dataset.id!), b = after.get(el.dataset.id!);
      if (!a || !b || (a.x === b.x && a.y === b.y)) continue;
      el.style.transform = `translate(${a.x - b.x}px, ${a.y - b.y}px)`;
      requestAnimationFrame(() => {
        el.classList.add("esm-moving");
        el.style.transform = "";
        setTimeout(() => el.classList.remove("esm-moving"), 350);
      });
    }
    this.decorate();
  }

  /** Marks stickies: recently changed (glow for 10 s) and rule warnings (dashed red). */
  mark(recent: string[], warn: Set<string>): void {
    const doc = this.doc;
    if (!doc) return;
    for (const el of doc.querySelectorAll<HTMLElement>(".note")) {
      el.classList.toggle("esm-warn", warn.has(el.dataset.id!));
      if (recent.includes(el.dataset.id!)) {
        el.classList.add("esm-recent");
        setTimeout(() => el.classList.remove("esm-recent"), 10_000);
      }
    }
  }

  /** Frames the stickies and arrows changed since the base version (null clears them). Called after every redraw. */
  markSession(d: SessionDiff | null): void {
    const doc = this.doc, board = doc?.getElementById("board");
    if (!doc || !board) return;
    board.querySelectorAll(".esm-badge").forEach((x) => x.remove());
    board.querySelectorAll(".esm-s-added, .esm-s-updated").forEach((x) => x.classList.remove("esm-s-added", "esm-s-updated"));
    if (!d) return;
    for (const c of d.changes) {
      if (c.kind === "removed") continue;
      const el = doc.getElementById(`n-${c.id}`);
      if (!el) continue;
      el.classList.add(`esm-s-${c.kind}`);
      const badge = doc.createElement("span");
      badge.className = "esm-badge";
      badge.textContent = c.kind === "added" ? "追加" : "変更";
      el.appendChild(badge);
    }
    for (const e of d.edgesAdded) board.querySelector(`.edge[data-from="${CSS.escape(e.from)}"][data-to="${CSS.escape(e.to)}"]`)?.classList.add("esm-s-added");
  }

  /** Brings a sticky to the middle of the board and selects it. */
  focusNode(id: string): void {
    const el = this.doc?.getElementById(`n-${id}`);
    if (!el) return;
    el.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
    this.select(id);
  }

  /** Opens the text editor on a sticky (also used right after adding one). */
  editText(id: string, draft?: string): void {
    const doc = this.doc, board = doc?.getElementById("board");
    const note = doc?.getElementById(`n-${id}`) as HTMLElement | null;
    if (!doc || !board || !note) return;
    this.closeEditor();
    const ta = doc.createElement("textarea");
    ta.className = "esm-input";
    ta.value = draft ?? note.querySelector(".txt")?.textContent ?? "";
    Object.assign(ta.style, { left: note.style.left, top: note.style.top, width: note.style.width, height: note.style.height, minHeight: "60px" });
    board.appendChild(ta);
    this.editing = id;
    this.hooks.startText(id, note.querySelector(".txt")?.textContent ?? "");
    if (draft !== undefined) this.hooks.typing(draft);
    ta.addEventListener("input", () => this.hooks.typing(ta.value));
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        this.hooks.commitText();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.closeEditor();
        this.hooks.cancel();
      }
    });
    ta.addEventListener("blur", () => {
      if (this.editing === id) this.hooks.commitText();
    });
    ta.focus();
    ta.select();
  }

  closeEditor(): void {
    // Clear first: removing the focused field fires its blur, which must not commit again.
    this.editing = null;
    this.doc?.querySelector(".esm-input")?.remove();
  }

  get selection(): string | null {
    return this.selected;
  }

  /**
   * Makes the big picture's zoom box as tall as the frame, so no part of the board is cut off below it. On load the
   * frame scrolls to the board; turning the wheel up at the board's top edge scrolls back to the title and legend.
   */
  private fitView(scrollToBoard = false): void {
    const doc = this.doc;
    const view = this.page === "big-picture.html" ? doc?.querySelector<HTMLElement>(".zoom-view") : null;
    if (!doc?.scrollingElement || !view) return;
    // The page's breadcrumb bar stays on top while the page scrolls; the board sits below it.
    const bar = doc.querySelector<HTMLElement>(".top")?.offsetHeight ?? 0;
    view.style.maxHeight = "none";
    view.style.height = `${Math.max(320, this.frame.clientHeight - bar - 32)}px`;
    if (scrollToBoard) doc.scrollingElement.scrollTop = view.getBoundingClientRect().top + doc.scrollingElement.scrollTop - bar - 16;
  }

  private setup(): void {
    const doc = this.doc;
    if (!doc) return;
    // Links between pages switch the shell's tab instead of navigating inside the frame.
    doc.addEventListener("click", (e) => {
      const a = (e.target as Element).closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      const m = /([a-z-]+\.html)(#.*)?$/.exec(a.getAttribute("href") ?? "");
      if (m && m[1] !== this.page) {
        e.preventDefault();
        this.hooks.navigate(m[1] + (m[2] ?? ""));
      }
    });
    if (this.page !== "big-picture.html" || !doc.getElementById("board")) return;
    this.fitView(true);
    const style = doc.createElement("style");
    style.textContent = EDIT_CSS;
    doc.head.appendChild(style);
    const board = doc.getElementById("board")!;
    board.addEventListener("dblclick", (e) => {
      const n = (e.target as Element).closest(".note") as HTMLElement | null;
      if (n) this.editText(n.dataset.id!);
    });
    board.addEventListener("click", (e) => this.onClick(e as MouseEvent));
    doc.addEventListener("keydown", (e) => {
      if ((e.target as Element).closest?.(".esm-input")) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        if (this.selectedEdge) this.hooks.removeEdge(this.selectedEdge);
        else if (this.selected) this.hooks.removeNode(this.selected);
      } else if (e.key === "Escape") {
        this.stopConnecting();
        this.select(null);
      }
    });
    this.decorate();
  }

  private onClick(e: MouseEvent): void {
    const doc = this.doc!, board = doc.getElementById("board")!;
    if ((e.target as Element).closest(".esm-tools, .esm-input, .esm-handle")) return;
    const n = (e.target as Element).closest(".note") as HTMLElement | null;
    if (n) {
      if (this.connecting && this.selected && n.dataset.id !== this.selected) {
        this.hooks.connect(this.selected, n.dataset.id!);
        this.stopConnecting();
        return;
      }
      this.select(n.dataset.id!);
      // Re-draw the details panel from the current data (the page's own copy can be older).
      const data = JSON.parse(doc.getElementById("nodes")?.textContent ?? "{}")[n.dataset.id!];
      const panel = doc.getElementById("panel");
      if (data && panel) panel.innerHTML = PANEL_ROWS(data);
      return;
    }
    this.selectEdge(edgeAt(board, e.clientX, e.clientY));
  }

  private select(id: string | null): void {
    this.selected = id;
    this.selectedEdge = null;
    this.hooks.select(id);
    this.decorate();
  }

  private selectEdge(e: Edge | null): void {
    this.selected = null;
    this.selectedEdge = e;
    this.decorate();
  }

  private stopConnecting(): void {
    this.connecting = false;
    this.doc?.getElementById("board")?.classList.remove("esm-connecting");
    this.hooks.idle();
  }

  /** Draws the toolbar, the arrow handle and the edge selection for the current selection. */
  private decorate(): void {
    const doc = this.doc, board = doc?.getElementById("board");
    if (!doc || !board) return;
    board.querySelectorAll(".esm-tools, .esm-handle, .esm-overlay").forEach((x) => x.remove());
    board.querySelectorAll(".edge.esm-sel").forEach((x) => x.classList.remove("esm-sel"));
    if (this.selectedEdge) {
      const s = this.selectedEdge;
      board.querySelector(`.edge[data-from="${CSS.escape(s.from)}"][data-to="${CSS.escape(s.to)}"]`)?.classList.add("esm-sel");
      return;
    }
    const note = this.selected ? (doc.getElementById(`n-${this.selected}`) as HTMLElement | null) : null;
    if (!note) return;
    const r = rectOf(note);
    const tools = doc.createElement("div");
    tools.className = "esm-tools";
    tools.dataset.noPan = "";
    tools.style.left = `${r.x}px`;
    tools.style.top = `${r.y - 6}px`;
    tools.innerHTML = '<button type="button" data-a="text">文字を直す</button><button type="button" data-a="connect">矢印をつなぐ</button><button type="button" data-a="remove">削除</button>';
    tools.addEventListener("click", (e) => {
      const a = (e.target as HTMLElement).dataset.a;
      if (a === "text") this.editText(this.selected!);
      if (a === "remove") this.hooks.removeNode(this.selected!);
      if (a === "connect") {
        this.connecting = true;
        board.classList.add("esm-connecting");
        this.hooks.busy();
      }
    });
    board.appendChild(tools);
    const handle = doc.createElement("div");
    handle.className = "esm-handle";
    handle.dataset.noPan = "";
    handle.title = "引っぱって矢印をつなぐ";
    handle.style.left = `${r.x + r.w}px`;
    handle.style.top = `${r.y + r.h / 2}px`;
    handle.addEventListener("pointerdown", (e) => this.drag(e, r));
    board.appendChild(handle);
  }

  private drag(e: PointerEvent, from: { x: number; y: number; w: number; h: number }): void {
    const doc = this.doc!, board = doc.getElementById("board")!;
    e.preventDefault();
    this.hooks.busy();
    const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "esm-overlay");
    svg.setAttribute("width", board.style.width);
    svg.setAttribute("height", board.style.height);
    const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
    svg.appendChild(path);
    board.appendChild(svg);
    const z = zoomOf(board);
    const sx = from.x + from.w, sy = from.y + from.h / 2;
    const move = (m: PointerEvent) => {
      const b = board.getBoundingClientRect();
      path.setAttribute("d", `M${sx} ${sy} L${(m.clientX - b.left) / z} ${(m.clientY - b.top) / z}`);
    };
    const up = (u: PointerEvent) => {
      doc.removeEventListener("pointermove", move);
      doc.removeEventListener("pointerup", up);
      svg.remove();
      // Arrow layers can sit above the stickies at that point; take the first sticky under the pointer.
      const target = doc.elementsFromPoint(u.clientX, u.clientY).map((x) => x.closest(".note")).find(Boolean) as HTMLElement | undefined;
      if (target && target.dataset.id !== this.selected && this.selected) this.hooks.connect(this.selected, target.dataset.id!);
      else this.hooks.idle();
    };
    doc.addEventListener("pointermove", move);
    doc.addEventListener("pointerup", up);
  }

  nodeType(id: string): NodeType | undefined {
    return this.model?.["big-picture"].nodes.find((n) => n.id === id)?.type;
  }
}

function rectOf(el: HTMLElement) {
  return { x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: parseFloat(el.style.width), h: parseFloat(el.style.height) };
}
function positions(board: HTMLElement): Map<string, { x: number; y: number }> {
  return new Map([...board.querySelectorAll<HTMLElement>(".note")].map((n) => [n.dataset.id!, { x: parseFloat(n.style.left), y: parseFloat(n.style.top) }]));
}
function zoomOf(board: HTMLElement): number {
  const r = board.getBoundingClientRect();
  return board.offsetWidth ? r.width / board.offsetWidth : 1;
}
/**
 * The arrow nearest to a click, within a few screen pixels. Every candidate is measured, so a click
 * between two close arrows picks the closer one instead of whichever comes first in the page.
 */
function edgeAt(board: HTMLElement, cx: number, cy: number): Edge | null {
  const b = board.getBoundingClientRect();
  const z = zoomOf(board);
  const tol = 8 / z;
  let best: { edge: Edge; d: number } | null = null;
  for (const p of board.querySelectorAll<SVGPathElement>("path.edge[data-from]")) {
    const g = p.parentElement as unknown as SVGGElement;
    const shift = Number(/translate\(([-\d.]+)/.exec(g.getAttribute("transform") ?? "")?.[1] ?? 0);
    const x = (cx - b.left) / z - shift, y = (cy - b.top) / z;
    const box = p.getBBox();
    if (x < box.x - tol || x > box.x + box.width + tol || y < box.y - tol || y > box.y + box.height + tol) continue;
    const d = distanceToPath(p, x, y);
    if (d <= tol && (!best || d < best.d)) best = { edge: { from: p.dataset.from!, to: p.dataset.to!, kind: p.classList.contains("result") ? "result" : "flow" }, d };
  }
  return best?.edge ?? null;
}

/** Shortest distance from a point to a path: coarse samples, then a finer pass around the best one. */
export function distanceToPath(p: { getTotalLength(): number; getPointAtLength(l: number): { x: number; y: number } }, x: number, y: number): number {
  const len = p.getTotalLength();
  const at = (l: number) => { const q = p.getPointAtLength(Math.max(0, Math.min(len, l))); return Math.hypot(q.x - x, q.y - y); };
  const step = Math.max(2, len / 200);
  let bestL = 0, bestD = Infinity;
  for (let l = 0; l <= len; l += step) { const d = at(l); if (d < bestD) { bestD = d; bestL = l; } }
  for (let l = bestL - step; l <= bestL + step; l += step / 10) { const d = at(l); if (d < bestD) bestD = d; }
  return bestD;
}
