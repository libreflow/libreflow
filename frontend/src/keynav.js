// LibreFlow — keynav.js
// Keyboard navigation (roving tabindex) for the virtual-scroll track list.
// Arrow keys move focus through filtered track rows; virtual scroll advances
// automatically when focus reaches the edge of the rendered window.
//
// Invariants respected:
//   - Never allocates in the rAF loop (rAF is one-shot, after-scroll only)
//   - Does NOT handle Enter/Space (handled in handlers.js)
//   - Does NOT steal focus when a modal, context-menu or input is active

import { VIRT }       from './virt.js';
import { getFiltered } from './search.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns true when a modal/dialog/input is capturing keyboard focus,
 *  so we should not intercept arrow keys. */
function _isModalOpen() {
  const ae = document.activeElement;
  if (!ae) return false;
  const tag = ae.tagName;
  // Inputs and textareas capture keys themselves
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  // Any open modal/dialog overlay
  if (ae.closest('[role="dialog"]')) return true;
  if (ae.closest('#ctx-menu'))       return true;
  if (ae.closest('#sleep-menu'))     return true;
  if (ae.closest('#eq-panel'))       return true;
  if (ae.closest('#queue-panel'))    return true;
  if (ae.closest('#settings-panel')) return true;
  return false;
}

/** Returns all rendered, non-skeleton track rows inside #tlist. */
function _trackRows(listEl) {
  return Array.from(listEl.querySelectorAll('.tr:not(.tr-skel)'));
}

/** Move tabindex="0" from `fromEl` to `toEl` and focus `toEl`. */
function _moveFocus(fromEl, toEl) {
  if (fromEl) fromEl.setAttribute('tabindex', '-1');
  toEl.setAttribute('tabindex', '0');
  toEl.focus({ preventScroll: true });
}

// ── Main init ─────────────────────────────────────────────────────────────────

/**
 * Initialise keyboard navigation for the virtual-scroll track list.
 * Called once from app.js after DOM is ready.
 */
export function initKeyNav() {
  const listEl = document.getElementById('tlist');
  if (!listEl) return;

  listEl.addEventListener('keydown', (e) => {
    // Only intercept when focus is inside #tlist
    if (!listEl.contains(document.activeElement)) return;
    // Don't intercept when a modal/input is active
    if (_isModalOpen()) return;

    const key = e.key;
    if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'Home' && key !== 'End') return;

    e.preventDefault();

    if (key === 'Home') {
      _handleHome(listEl);
    } else if (key === 'End') {
      _handleEnd(listEl);
    } else if (key === 'ArrowDown') {
      _handleArrow(listEl, 1);
    } else if (key === 'ArrowUp') {
      _handleArrow(listEl, -1);
    }
  });
}

// ── Arrow navigation ──────────────────────────────────────────────────────────

/**
 * Move focus up (dir=-1) or down (dir=1) within the rendered rows.
 * If the focused row is the last/first rendered row, scroll the virtual list
 * and focus the newly rendered row after one rAF.
 */
function _handleArrow(listEl, dir) {
  const rows = _trackRows(listEl);
  if (!rows.length) return;

  // Find current focused row (tabindex="0") or the one containing activeElement
  const focused = document.activeElement?.closest('.tr:not(.tr-skel)');
  const curRowIdx = focused ? rows.indexOf(focused) : -1;

  const isAtEdge = dir === 1
    ? curRowIdx === rows.length - 1   // last rendered row
    : curRowIdx === 0;                 // first rendered row

  if (!isAtEdge && curRowIdx >= 0) {
    // Simple case: sibling row exists in the DOM
    const nextEl = rows[curRowIdx + dir];
    if (nextEl) {
      _moveFocus(focused, nextEl);
      nextEl.scrollIntoView({ block: 'nearest' });
      return;
    }
  }

  // Edge case: need to scroll the virtual list
  const fl = getFiltered();
  if (!fl.length) return;

  // Determine current virtual index from data-fi attribute
  let currentFi = focused ? parseInt(focused.dataset.fi, 10) : -1;
  if (isNaN(currentFi)) currentFi = -1;

  // If no focused row, start from beginning (ArrowDown) or end (ArrowUp)
  if (currentFi < 0) {
    currentFi = dir === 1 ? -1 : fl.length;
  }

  const nextFi = currentFi + dir;
  if (nextFi < 0 || nextFi >= fl.length) return; // already at boundary

  // Scroll the virtual list to the target index
  VIRT.scrollToIdx(nextFi);

  // After one rAF the DOM is rebuilt; focus the row with data-fi === nextFi
  requestAnimationFrame(() => {
    const newRows = _trackRows(listEl);
    const target = newRows.find(el => parseInt(el.dataset.fi, 10) === nextFi);
    if (target) {
      // Remove tabindex="0" from the previously focused row if still in DOM
      const prevFocused = listEl.querySelector('.tr:not(.tr-skel)[tabindex="0"]');
      _moveFocus(prevFocused !== target ? prevFocused : null, target);
      target.scrollIntoView({ block: 'nearest' });
    }
  });
}

// ── Home / End ────────────────────────────────────────────────────────────────

function _handleHome(listEl) {
  // Scroll to very top
  listEl.scrollTop = 0;
  // Focus the first rendered row after rAF
  requestAnimationFrame(() => {
    const rows = _trackRows(listEl);
    if (!rows.length) return;
    const prevFocused = listEl.querySelector('.tr:not(.tr-skel)[tabindex="0"]');
    _moveFocus(prevFocused !== rows[0] ? prevFocused : null, rows[0]);
  });
}

function _handleEnd(listEl) {
  const fl = getFiltered();
  if (!fl.length) return;

  // Scroll to last track via virtual scroll
  VIRT.scrollToIdx(fl.length - 1);

  // Focus the last rendered row after rAF
  requestAnimationFrame(() => {
    const rows = _trackRows(listEl);
    if (!rows.length) return;
    const last = rows[rows.length - 1];
    const prevFocused = listEl.querySelector('.tr:not(.tr-skel)[tabindex="0"]');
    _moveFocus(prevFocused !== last ? prevFocused : null, last);
  });
}
