/**
 * Keyboard / D-pad spatial navigation.
 * Any element with `data-focus` is a focus target. Arrow keys move to the geometrically
 * nearest target in that direction, Enter activates it, Backspace/Escape go back.
 * Mouse still works normally. Designed so the same UI maps 1:1 to a TV remote.
 */

type Dir = 'up' | 'down' | 'left' | 'right';

const KEY_DIR: Record<string, Dir> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

function targets(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-focus]')).filter((el) => {
    if (el.hasAttribute('disabled') || el.getAttribute('aria-hidden') === 'true') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
}

function center(r: DOMRect) {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function pick(from: HTMLElement, dir: Dir): HTMLElement | null {
  const fr = from.getBoundingClientRect();
  const fc = center(fr);
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of targets()) {
    if (el === from) continue;
    const r = el.getBoundingClientRect();
    const c = center(r);
    let primary = 0;
    let secondary = 0;
    switch (dir) {
      case 'left':
        primary = fr.left - r.right;
        secondary = Math.abs(c.y - fc.y);
        break;
      case 'right':
        primary = r.left - fr.right;
        secondary = Math.abs(c.y - fc.y);
        break;
      case 'up':
        primary = fr.top - r.bottom;
        secondary = Math.abs(c.x - fc.x);
        break;
      case 'down':
        primary = r.top - fr.bottom;
        secondary = Math.abs(c.x - fc.x);
        break;
    }
    // Must be strictly in that direction (allow slight overlap).
    if (primary < -Math.min(fr.width, fr.height) * 0.3) continue;
    const horizontal = dir === 'left' || dir === 'right';
    // Prefer same row/column: penalize perpendicular distance heavily.
    const overlap = horizontal
      ? Math.min(fr.bottom, r.bottom) - Math.max(fr.top, r.top)
      : Math.min(fr.right, r.right) - Math.max(fr.left, r.left);
    const alignedBonus = overlap > 0 ? 0 : 1;
    const score = Math.max(primary, 0) + secondary * 2 + alignedBonus * 2000;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

export function focusFirst(scope: ParentNode = document, selector = '[data-focus]') {
  const el = scope.querySelector<HTMLElement>(selector);
  if (el) {
    el.focus({ preventScroll: true });
    scrollIntoViewSmart(el);
    return true;
  }
  return false;
}

function scrollIntoViewSmart(el: HTMLElement) {
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
}

export function installSpatialNavigation(onBack: () => void) {
  const handler = (e: KeyboardEvent) => {
    const active = document.activeElement as HTMLElement | null;
    const inInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
    const video = active?.tagName === 'VIDEO';

    if (e.key === 'Backspace' || e.key === 'Escape' || e.key === 'GoBack' || e.key === 'BrowserBack') {
      if (inInput && e.key === 'Backspace') return;
      e.preventDefault();
      onBack();
      return;
    }

    const dir = KEY_DIR[e.key];
    if (!dir) {
      if (e.key === 'Enter' && active?.hasAttribute('data-focus') && !inInput && active.tagName !== 'BUTTON' && active.tagName !== 'A') {
        e.preventDefault();
        active.click();
      }
      return;
    }
    if (video) return; // let the video element handle seeking
    if (inInput && (dir === 'left' || dir === 'right')) return;

    const from = active && active.hasAttribute('data-focus') ? active : null;
    const next = from ? pick(from, dir) : targets()[0] ?? null;
    if (next) {
      e.preventDefault();
      next.focus({ preventScroll: true });
      scrollIntoViewSmart(next);
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}
