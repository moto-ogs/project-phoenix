"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Ruft `onVisible` auf, sobald das Element mit der zurückgegebenen Ref in den
 * sichtbaren Bereich kommt, etwa das Ende einer Liste zum Nachladen (#7148).
 * Der Rahmen einer scrollenden Liste zählt mit: ein IntersectionObserver ohne
 * `root` schneidet mit jedem scrollenden Vorfahren.
 *
 * Ohne IntersectionObserver oder mit `enabled` false beobachtet der Hook
 * nichts. Der Aufrufer bietet immer einen Knopf an, auch für die Tastatur.
 */
export function useOnVisible(
  onVisible: () => void,
  enabled: boolean,
): (node: Element | null) => void {
  const [node, setNode] = useState<Element | null>(null);
  const onVisibleRef = useRef(onVisible);
  useEffect(() => {
    onVisibleRef.current = onVisible;
  });
  useEffect(() => {
    if (!enabled || !node || typeof IntersectionObserver !== "function") {
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        onVisibleRef.current();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled, node]);

  return setNode;
}
