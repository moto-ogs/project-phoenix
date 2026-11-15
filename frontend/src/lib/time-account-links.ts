/**
 * Die Zeitkonten mit dem Filter „ohne Soll“ (#6890, #6919). Mit Jahr und
 * Monat öffnet die Liste genau den Monat, den die Soll-Prüfung gezählt hat;
 * ohne sie den laufenden.
 */
export function staffWithoutTargetHref(year?: number, month?: number): string {
  const base = "/staff?view=accounts&filter=ohne-soll";
  return year && month
    ? `${base}&month=${year}-${String(month).padStart(2, "0")}`
    : base;
}
