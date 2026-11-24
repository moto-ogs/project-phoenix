"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useIsApp } from "~/lib/device-context";
import { currentEntry, previousEntry, recordCommit } from "./history-stack";
import { notifyRouteCommit, runPageTransition } from "./page-transition";

/**
 * Meldet jeden Seitenwechsel an den Verlaufsstack. Steht einmal in der
 * Portalhülle (`PortalShell`), vor dem Seiteninhalt.
 */
export function useNavigationStackTracker(): void {
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? "";
  const traversal = useRef(false);

  useEffect(() => {
    const onPopState = () => {
      traversal.current = true;
    };
    window.addEventListener("popstate", onPopState, { capture: true });
    return () =>
      window.removeEventListener("popstate", onPopState, { capture: true });
  }, []);

  useLayoutEffect(() => {
    recordCommit(
      `${window.location.pathname}${window.location.search}`,
      traversal.current,
    );
    traversal.current = false;
    notifyRouteCommit();
  }, [pathname, search]);
}

/**
 * Ob „Zurück“ ein Verlaufsschritt sein darf: Der vorige Eintrag liegt in der
 * App und im selben Reiter. Ohne Reiter (Portale ohne Pill) genügt „in der
 * App“.
 */
export function canStepBack(): boolean {
  const previous = previousEntry();
  if (!previous) return false;
  const current = currentEntry();
  return previous.tab === current?.tab;
}

/**
 * „Zurück“ in der App: ein Schritt im Verlauf, wenn der vorige Eintrag dazu
 * passt (`true`), sonst `false`: dann ersetzt der Aufrufer die Seite durch
 * sein Ziel (`replace`), nie ein neuer Eintrag. `null` auf dem Desktop: dort
 * bleibt der Rückweg ein gewöhnlicher Link.
 *
 * Ohne `useRouter`: `history.back()` löst dasselbe `popstate` aus, das der
 * Next-Router verarbeitet, und der Rückweg rendert auch ohne App-Router
 * (Tests, Storybook).
 */
export function useStackBack(): (() => boolean) | null {
  const isApp = useIsApp();
  const back = useCallback(() => {
    if (!canStepBack()) return false;
    runPageTransition("back", () => window.history.back());
    return true;
  }, []);
  return isApp ? back : null;
}

/** `useNavigationStackTracker` als Bauteil, in einer Suspense-Grenze. */
export function NavigationStackTracker(): null {
  useNavigationStackTracker();
  return null;
}
