"use client";

import { useEffect } from "react";

/**
 * Sprungziel von „Heute anders“ (#7670): die Startseite verlinkt eine Klasse
 * mit diesem Anker, die Klassenansicht springt dann zur ersten Zeile, die
 * heute anders ist. Die Kinder stehen nur hier, nicht im Block.
 */
export const DAY_CHANGE_ANCHOR = "heute-anders";

/** Markiert eine Zeile, die heute anders ist (`isDayChange`). */
export const DAY_CHANGE_ROW_ATTRIBUTE = "data-day-change";

/**
 * Springt nach dem Laden einmal zur ersten Zeile, die heute anders ist, wenn
 * die Adresse den Anker trägt. Der Fokus landet auf der Zeile, damit auch
 * Tastatur und Bildschirmleser dort weiterlesen.
 */
export function useJumpToDayChange(ready: boolean): void {
  useEffect(() => {
    if (!ready || window.location.hash !== `#${DAY_CHANGE_ANCHOR}`) return;
    const row = document.querySelector<HTMLElement>(
      `[${DAY_CHANGE_ROW_ATTRIBUTE}]`,
    );
    if (!row) return;
    row.scrollIntoView({ block: "center" });
    row.focus({ preventScroll: true });
  }, [ready]);
}
