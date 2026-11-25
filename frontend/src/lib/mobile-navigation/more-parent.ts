import { useSyncExternalStore } from "react";

/**
 * Ob die aktuelle App-Seite über „Mehr“ erreicht wurde (#8070). Die Pill
 * kennt die Reiter und meldet es; der Seitenkopf zeigt dann den Zurück-Pfeil
 * zu „Mehr“, wie jede andere Unterseite einen Rückweg hat.
 */
let underMore = false;
const listeners = new Set<() => void>();

export function setUnderMore(next: boolean): void {
  if (underMore === next) return;
  underMore = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useUnderMore(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => underMore,
    () => false,
  );
}
