"use client";

/**
 * Seitlicher Übergang der App (Prototyp Mobile-Zielbild, #8070).
 *
 * Vorwärts schiebt die neue Seite von rechts herein, Zurück von links. Pill
 * und Safe-Area-Streifen haben eine eigene `view-transition-name` und
 * bleiben stehen (`styles/globals.css`, „Seitenübergang“).
 *
 * Warum die Browser-API und nicht React `<ViewTransition>`: React 19.3
 * exportiert `ViewTransition` ohne Flag und Next 16.4 reicht
 * `Link transitionTypes` durch. Unser „Zurück“ ist aber ein
 * Verlaufsschritt (`history.back()`), und Verlaufsschritte tragen keinen
 * Transition-Typ (Next-Doku `view-transitions.md` Z. 358). Ein Mechanismus
 * für beide Richtungen ist `document.startViewTransition`; der Rückruf wartet,
 * bis der Router die neue Seite bestätigt hat (`notifyRouteCommit`).
 *
 * Nur in der App und ohne `prefers-reduced-motion`. Browser-/Wischzurück
 * läuft nie hier durch und animiert deshalb nicht (keine Doppelanimation
 * mit der iOS-Geste). Der Desktop ruft nie `startViewTransition` auf.
 */

import { APP_QUERY, REDUCED_MOTION_QUERY } from "~/lib/device-context";

export type PageTransitionDirection = "forward" | "back";

/** So lange hält der Übergang höchstens das alte Bild fest. */
const COMMIT_TIMEOUT_MS = 450;

let commitCount = 0;
const commitWaiters = new Set<() => void>();
let running = false;

/** Meldet einen bestätigten Seitenwechsel (aus dem Verlaufs-Tracker). */
export function notifyRouteCommit(): void {
  commitCount += 1;
  for (const waiter of [...commitWaiters]) waiter();
}

/** Wartet auf einen Wechsel nach `since`, höchstens `timeoutMs`. */
function waitForCommitSince(since: number, timeoutMs: number): Promise<void> {
  if (commitCount !== since) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      commitWaiters.delete(done);
      // Kein requestAnimationFrame: Während der Übergang das Bild hält,
      // zeichnet der Browser nicht, und der Rückruf käme nie. Die Layout-
      // Effekte der neuen Seite sind beim Melden schon gelaufen.
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    commitWaiters.add(done);
  });
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => Promise<void>) => {
    finished: Promise<void>;
  };
};

function animationAllowed(): boolean {
  if (typeof window === "undefined" || running) return false;
  const doc = document as ViewTransitionDocument;
  return (
    typeof doc.startViewTransition === "function" &&
    window.matchMedia(APP_QUERY).matches &&
    !window.matchMedia(REDUCED_MOTION_QUERY).matches
  );
}

function pathOf(href: string): string | null {
  try {
    return new URL(href, window.location.href).pathname;
  } catch {
    return null;
  }
}

function begin(direction: PageTransitionDirection, navigate?: () => void) {
  const doc = document as ViewTransitionDocument;
  const root = document.documentElement;
  const since = commitCount;
  running = true;
  root.dataset.navDirection = direction;
  const transition = doc.startViewTransition!(async () => {
    navigate?.();
    await waitForCommitSince(since, COMMIT_TIMEOUT_MS);
  });
  void transition.finished.finally(() => {
    running = false;
    delete root.dataset.navDirection;
  });
}

/**
 * Führt einen Seitenwechsel aus, in der App mit seitlichem Übergang
 * (`history.back()`, `router.replace`).
 */
export function runPageTransition(
  direction: PageTransitionDirection,
  navigate: () => void,
): void {
  if (!animationAllowed()) {
    navigate();
    return;
  }
  begin(direction, navigate);
}

/**
 * Für einen Wechsel, den ein Link selbst ausführt (`NavigationLink`):
 * startet den Übergang, ohne die Navigation zu übernehmen. Nur, wenn sich
 * der Pfad ändert; ein Filter oder Reiter in der Query schiebt nichts.
 */
export function startPageTransition(
  direction: PageTransitionDirection,
  href: string,
): void {
  if (!animationAllowed()) return;
  const target = pathOf(href);
  if (target === null || target === window.location.pathname) return;
  begin(direction);
}
