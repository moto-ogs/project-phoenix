"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

const subscribeNothing = () => () => undefined;

/** "⌘ K" on a Mac, "Strg K" elsewhere; empty during server rendering. */
export function useSearchShortcutLabel(): string {
  return useSyncExternalStore(
    subscribeNothing,
    () => (/Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘ K" : "Strg K"),
    () => "",
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

/**
 * Cmd/Ctrl+K toggles a portal's search dialog on every width (#6954, #7648).
 * Inside a field the shortcut stays the field's own (a link in an editor),
 * unless the search is open: then it closes the search.
 */
export function useSearchShortcut(isOpen: boolean, toggle: () => void): void {
  // The listener reads the open state and the callback without re-subscribing.
  const openRef = useRef(isOpen);
  const toggleRef = useRef(toggle);
  useEffect(() => {
    openRef.current = isOpen;
    toggleRef.current = toggle;
  }, [isOpen, toggle]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key?.toLowerCase() !== "k") return;
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.altKey || event.shiftKey) return;
      if (isEditableTarget(event.target) && !openRef.current) return;
      event.preventDefault();
      toggleRef.current();
    };
    globalThis.addEventListener("keydown", handleKeyDown);
    return () => globalThis.removeEventListener("keydown", handleKeyDown);
  }, []);
}
