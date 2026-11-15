"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Ruft `onVisible` auf, sobald das Element mit der zurückgegebenen Ref in den
 * sichtbaren Bereich kommt, etwa das Ende einer Liste zum Nachladen (#7148).
 * Der Rahmen einer scrollenden Liste zählt mit: ein IntersectionObserver ohne
 * `root` schneidet mit jedem scrollenden Vorfahren.
 *
 * `supported` ist false, wo es keinen IntersectionObserver gibt (alte
 * WebViews, jsdom). Der Aufrufer bietet dann einen Knopf an; er sollte ihn
 * ohnehin anbieten, denn mit der Tastatur scrollt niemand ein Ende ins Bild.
 * Mit `enabled` false beobachtet der Hook nichts, etwa solange eine Seite lädt.
 */
export function useOnVisible(
  onVisible: () => void,
  enabled: boolean,
): {
  readonly ref: (node: Element | null) => void;
  readonly supported: boolean;
} {
  const [node, setNode] = useState<Element | null>(null);
  const onVisibleRef = useRef(onVisible);
  useEffect(() => {
    onVisibleRef.current = onVisible;
  });
  const supported =
    typeof window !== "undefined" && "IntersectionObserver" in window;

  useEffect(() => {
    if (!enabled || !node || !supported) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        onVisibleRef.current();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled, node, supported]);

  const ref = useCallback((element: Element | null) => setNode(element), []);
  return { ref, supported };
}
