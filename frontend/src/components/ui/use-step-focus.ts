"use client";

import { useEffect, useRef } from "react";

const HEADING = "h1, h2, h3, h4";

/**
 * Focus for a form that changes its step in place (#7111, WCAG 2.4.3):
 * form → summary → done, upload → check → result. When the old step leaves
 * the DOM, the focus would fall to `<body>` and a screen reader would say
 * nothing. Give the hook the current step and put the returned ref on the
 * root of every step; on each change the first heading of the new step
 * takes the focus (`tabIndex={-1}`) and is read out. A step without a
 * heading focuses its root. The first render keeps the focus where it is,
 * and so does the first step after `null` or `undefined`: data that finished
 * loading is no step the person took.
 */
export function useStepFocus<T extends HTMLElement = HTMLElement>(
  step: unknown,
) {
  const ref = useRef<T>(null);
  const shown = useRef(step);
  useEffect(() => {
    const previous = shown.current;
    if (Object.is(previous, step)) return;
    shown.current = step;
    if (previous === null || previous === undefined) return;
    focusStepHeading(ref.current);
  }, [step]);
  return ref;
}

/** Focuses the first heading in `root`, or `root` itself without one. */
export function focusStepHeading(root: HTMLElement | null): void {
  if (!root) return;
  const target = root.matches(HEADING)
    ? root
    : (root.querySelector<HTMLElement>(HEADING) ?? root);
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus();
}
