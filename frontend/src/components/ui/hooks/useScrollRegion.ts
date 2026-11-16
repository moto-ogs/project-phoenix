"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * Whether an element scrolls its content (#7112). A scrolling area without
 * anything focusable in it is out of reach for the keyboard (axe
 * `scrollable-region-focusable`); `Modal` and `SlideOverBody` put it into the
 * tab order only while it scrolls.
 */
export function useScrollRegion(
  ref: RefObject<HTMLElement | null>,
  active = true,
): boolean {
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!active || !element || typeof ResizeObserver === "undefined") return;
    const measure = () =>
      setScrolls(element.scrollHeight > element.clientHeight + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    measure();
    return () => observer.disconnect();
  }, [ref, active]);
  return scrolls;
}
