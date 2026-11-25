"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * Whether an element scrolls its content (#7112). A scrolling area without
 * anything focusable in it is out of reach for the keyboard (axe
 * `scrollable-region-focusable`); `Modal` and `SlideOverBody` put it into the
 * tab order only while it scrolls and holds no control of its own.
 */
export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

function hasTabStop(element: HTMLElement): boolean {
  return Array.from(
    element.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).some((control) => {
    if (
      (control.hasAttribute("tabindex") && control.tabIndex < 0) ||
      control.matches(":disabled") ||
      control.closest("[hidden], [inert]")
    )
      return false;

    return (
      control.checkVisibility?.({ visibilityProperty: true }) ??
      (control.getClientRects().length > 0 &&
        getComputedStyle(control).visibility === "visible")
    );
  });
}

export function useScrollRegion(
  ref: RefObject<HTMLElement | null>,
  active = true,
): boolean {
  // Der erste sichtbare Render muss schon tastaturerreichbar sein. Sonst kann
  // axe den Bereich zwischen dem Öffnen des Dialogs und der ersten Messung
  // als nicht erreichbaren Scrollbereich finden.
  const [scrolls, setScrolls] = useState(active);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!active || !element || typeof ResizeObserver === "undefined") {
      setScrolls(active);
      return;
    }
    // With a control inside, the keyboard already reaches the area: no
    // extra tab stop then.
    const measure = () =>
      setScrolls(
        element.scrollHeight > element.clientHeight + 1 && !hasTabStop(element),
      );
    const resize = new ResizeObserver(measure);
    resize.observe(element);
    if (element.firstElementChild) resize.observe(element.firstElementChild);

    // Forms can lose their last tab stop without changing their dimensions.
    const mutations = new MutationObserver(measure);
    mutations.observe(element, {
      subtree: true,
      childList: true,
      attributeFilter: [
        "class",
        "style",
        "hidden",
        "inert",
        "disabled",
        "tabindex",
        "href",
        "type",
        "contenteditable",
      ],
    });
    measure();
    return () => {
      resize.disconnect();
      mutations.disconnect();
    };
  }, [ref, active]);
  return scrolls;
}
