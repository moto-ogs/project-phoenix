"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * Whether an element scrolls its content (#7112). A scrolling area without
 * anything focusable in it is out of reach for the keyboard (axe
 * `scrollable-region-focusable`); `Modal` and `SlideOverBody` put it into the
 * tab order only while it scrolls and holds no control of its own.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

export function useScrollRegion(
  ref: RefObject<HTMLElement | null>,
  active = true,
): boolean {
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!active || !element || typeof ResizeObserver === "undefined") return;
    // With a control inside, the keyboard already reaches the area: no
    // extra tab stop then.
    const measure = () =>
      setScrolls(
        element.scrollHeight > element.clientHeight + 1 &&
          element.querySelector(FOCUSABLE) === null,
      );
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    measure();
    return () => observer.disconnect();
  }, [ref, active]);
  return scrolls;
}
