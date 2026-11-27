/**
 * Verlaufsschritte, die nur ein Blatt der App geschlossen oder geöffnet haben
 * (#8070). Die Blatt-Sitzung (`components/ui/sheet-session.ts`) markiert
 * solche `popstate`-Ereignisse; andere Zuhörer wie der Navigationswächter
 * (`lib/hooks/use-navigation-guard.ts`) lassen sie dann liegen. Liegt in
 * `lib`, damit der Wächter nicht vom Kit abhängt.
 */
const handledEvents = new WeakSet<Event>();

export function markSheetHistoryEvent(event: Event): void {
  handledEvents.add(event);
}

/**
 * Ob dieses `popstate` nur ein Blatt geschlossen hat oder von einem Blatt
 * selbst ausgelöst wurde.
 */
export function isSheetHistoryEvent(event: Event): boolean {
  return handledEvents.has(event);
}
