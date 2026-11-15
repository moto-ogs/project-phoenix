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

const MONTH_FORMATTER = new Intl.DateTimeFormat("de-DE", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** „September 2026“ für Jahr und Monat (1 bis 12). */
export function monthYearLabel(year: number, month: number): string {
  return MONTH_FORMATTER.format(new Date(Date.UTC(year, month - 1, 1)));
}
