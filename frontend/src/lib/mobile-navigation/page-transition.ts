"use client";

export type PageTransitionDirection = "forward" | "back";

/**
 * Führt einen Seitenwechsel der App aus. Der seitliche Übergang folgt in
 * einem eigenen Baustein; bis dahin wechselt die Seite ohne Animation.
 */
export function runPageTransition(
  _direction: PageTransitionDirection,
  navigate: () => void,
): void {
  navigate();
}

/**
 * Für einen Wechsel, den ein Link selbst ausführt: startet den Übergang,
 * ohne die Navigation zu übernehmen.
 */
export function startPageTransition(_direction: PageTransitionDirection): void {
  // Folgt mit dem Baustein „Seitlicher Übergang“.
}
