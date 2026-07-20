'use client';
import { type RefObject, useEffect, useState } from 'react';

/**
 * Reactive content-box width of `ref`'s element, in CSS pixels, via
 * ResizeObserver. Use this over `useWindowSize` when you need the width of a
 * specific container — a scroll region inside a collapsible sidebar, the
 * extension popup — rather than the viewport: the two diverge whenever chrome
 * around the element changes width without the window resizing. The content box
 * excludes padding and the scrollbar gutter, so it's exactly the space a child
 * grid has to lay out in.
 *
 * Returns 0 until the first measurement lands (SSR, and the first paint before
 * the observer fires) — guard callers against a 0 width.
 */
export function useElementWidth<T extends HTMLElement>(ref: RefObject<T | null>): number {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      // contentBoxSize is the padding/scrollbar-excluded inline width; fall back
      // to contentRect where the newer field is unavailable.
      const next = entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
      setWidth(next);
    });
    observer.observe(el);

    return () => observer.disconnect();
  }, [ref]);

  return width;
}
