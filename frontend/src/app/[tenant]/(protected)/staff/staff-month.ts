/**
 * Der Monat aus `?month=JJJJ-MM` (#6890), sonst der laufende. Ein Monat nach
 * heute gilt nicht: die Zeitkonten kennen keine Zukunft.
 */
export function linkedMonth(
  param: string | null,
  today: string,
): { year: number; month: number } {
  const current = {
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)),
  };
  const match = /^(\d{4})-(\d{2})$/.exec(param ?? "");
  if (!match) return current;
  const linked = { year: Number(match[1]), month: Number(match[2]) };
  const valid =
    linked.month >= 1 &&
    linked.month <= 12 &&
    linked.year * 12 + linked.month <= current.year * 12 + current.month;
  return valid ? linked : current;
}
