// Drag to pan for the zoom boxes. These functions run in the browser: render.mjs writes their source
// into each page's script, so the page and the tests use the same code. Keep them self-contained.

/** Pixels the pointer must travel before a press becomes a pan (a shorter press stays a click). */
export const PAN_THRESHOLD = 4;

/**
 * True when a press may start a pan: the left mouse button or a pen, on empty canvas or an arrow.
 * Stickies, buttons, links, form fields and anything marked data-no-pan keep their own pointer behaviour
 * (.zoom-ctrl sits beside the view, not in it; it is listed in case a page puts controls inside).
 * Touch is left to the browser, which already scrolls with a finger.
 */
export function canStartPan(e) {
  if (e.button !== 0 || e.pointerType === 'touch') return false;
  var t = e.target;
  if (!t || typeof t.closest !== 'function') return false;
  return !t.closest('.note, .zoom-ctrl, a, button, input, textarea, select, [contenteditable], [data-no-pan]');
}

/** Scroll position for the pointer at x/y; it moves only once the press has travelled past the threshold. */
export function panStep(start, x, y, moving, threshold) {
  var dx = x - start.x, dy = y - start.y;
  if (!moving && Math.hypot(dx, dy) <= threshold) return { moving: false, left: start.left, top: start.top };
  return { moving: true, left: start.left - dx, top: start.top - dy };
}

/**
 * What a wheel turn over the zoom box does: Ctrl/⌘ (and trackpad pinch) zooms; a vertical turn scrolls the board
 * while it can still move that way, and otherwise scrolls the page, so the board never swallows the wheel.
 */
export function wheelAction(e, v) {
  if (e.ctrlKey || e.metaKey) return 'zoom';
  if (!e.deltaY) return 'view';
  var room = v.scrollHeight - v.clientHeight;
  if (e.deltaY > 0 ? v.scrollTop < room - 1 : v.scrollTop > 0) return 'view';
  return 'page';
}
