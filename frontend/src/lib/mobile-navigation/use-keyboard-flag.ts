"use client";

import { useEffect } from "react";

/** Darunter zählt die Tastatur nicht als offen (wie bei den Blättern). */
const KEYBOARD_MIN_PX = 120;

function isEditable(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  if (element instanceof HTMLTextAreaElement) return !element.readOnly;
  if (element instanceof HTMLInputElement) {
    return (
      !element.readOnly &&
      ![
        "button",
        "checkbox",
        "radio",
        "range",
        "submit",
        "reset",
        "file",
        "color",
      ].includes(element.type)
    );
  }
  return false;
}

/**
 * Setzt `data-keyboard-open` am `<html>`, solange die Bildschirmtastatur
 * offen ist (#8070): Der sichtbare Bereich ist deutlich kleiner als das
 * Layout und ein Eingabefeld hat den Fokus. Die Pill blendet sich dann aus
 * (`styles/globals.css`), statt über der Tastatur zu schweben und das Feld
 * zu verdecken. Ohne `visualViewport` (Tests, alte Browser) passiert nichts.
 */
export function useKeyboardFlag(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const measure = () => {
      const zoomed = Math.abs(vv.scale - 1) >= 0.01;
      const open =
        !zoomed &&
        window.innerHeight - vv.height > KEYBOARD_MIN_PX &&
        isEditable(document.activeElement);
      if (open) root.dataset.keyboardOpen = "";
      else delete root.dataset.keyboardOpen;
    };
    measure();
    vv.addEventListener("resize", measure);
    document.addEventListener("focusin", measure);
    document.addEventListener("focusout", measure);
    return () => {
      vv.removeEventListener("resize", measure);
      document.removeEventListener("focusin", measure);
      document.removeEventListener("focusout", measure);
      delete root.dataset.keyboardOpen;
    };
  }, []);
}
