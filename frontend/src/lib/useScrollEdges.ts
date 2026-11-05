import { useEffect, type RefObject } from 'react';

/**
 * Marks a scrolling list with data-more-above / data-more-below while there is more to scroll to,
 * so CSS can fade that edge (a cut-off row then reads as "more", not as a clipped box).
 */
export function useScrollEdges(ref: RefObject<HTMLElement | null>, deps: unknown[] = []) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mark = () => {
      const above = el.scrollTop > 2;
      const below = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
      if ((el.dataset.moreAbove === 'true') !== above) el.dataset.moreAbove = String(above);
      if ((el.dataset.moreBelow === 'true') !== below) el.dataset.moreBelow = String(below);
    };
    mark();
    el.addEventListener('scroll', mark, { passive: true });
    const ro = new ResizeObserver(mark);
    ro.observe(el);
    // Rows animate in and out, so the height changes after mount too.
    const mo = new MutationObserver(() => requestAnimationFrame(mark));
    mo.observe(el, { childList: true });
    return () => { el.removeEventListener('scroll', mark); ro.disconnect(); mo.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
