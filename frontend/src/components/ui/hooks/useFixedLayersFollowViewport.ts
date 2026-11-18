"use client";

import { useEffect } from "react";

/** The CSS variable the shell's fixed layers move by (`FIXED_LAYER_SHIFT`). */
export const FIXED_LAYER_SHIFT_VAR = "--moto-fixed-shift";

/**
 * Tailwind class for every fixed layer of the shell: it moves by the
 * measured shift and stays where it is when nothing was measured. Spelled
 * out in full so Tailwind finds it.
 */
export const FIXED_LAYER_SHIFT = "translate-y-[var(--moto-fixed-shift,0px)]";

/** Below this the keyboard does not count as open (same as the sheets). */
const KEYBOARD_MIN_PX = 120;

/**
 * Keeps the shell's fixed layers (bottom bar, dotted background) on screen in
 * the installed iPhone app.
 *
 * iOS 26 leaves the visual viewport shifted after the keyboard closes
 * (`visualViewport.offsetTop` stays above 0, Apple FB19889436, WebKit 297779).
 * `position: fixed` is anchored to the layout viewport, which no longer
 * follows the scroll: the bottom bar stayed in the middle of the page and
 * scrolled away with the content. The gap between the visible bottom and the
 * layout viewport's bottom is exactly how far the layers have to move.
 *
 * Without the bug the gap is 0, so the layers stay where CSS puts them. While
 * the keyboard is open or the page is zoomed, the visual viewport is smaller
 * on purpose; the layers keep the browser's behaviour then.
 */
export function useFixedLayersFollowViewport() {
  useEffect(() => {
    const vv = window.visualViewport;
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (!vv || !standalone) return;
    const root = document.documentElement;

    const measure = () => {
      const zoomed = Math.abs(vv.scale - 1) >= 0.01;
      const keyboardOpen = window.innerHeight - vv.height > KEYBOARD_MIN_PX;
      const shift =
        zoomed || keyboardOpen
          ? 0
          : Math.round(vv.offsetTop + vv.height - window.innerHeight);
      if (Math.abs(shift) < 1) {
        root.style.removeProperty(FIXED_LAYER_SHIFT_VAR);
      } else {
        root.style.setProperty(FIXED_LAYER_SHIFT_VAR, `${shift}px`);
      }
    };

    let frame = 0;
    const measureNextFrame = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    };

    measure();
    vv.addEventListener("resize", measureNextFrame);
    vv.addEventListener("scroll", measureNextFrame);
    window.addEventListener("scroll", measureNextFrame, { passive: true });
    return () => {
      vv.removeEventListener("resize", measureNextFrame);
      vv.removeEventListener("scroll", measureNextFrame);
      window.removeEventListener("scroll", measureNextFrame);
      window.cancelAnimationFrame(frame);
      root.style.removeProperty(FIXED_LAYER_SHIFT_VAR);
    };
  }, []);
}
