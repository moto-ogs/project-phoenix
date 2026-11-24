import type { StaffShift } from "~/lib/shift-helpers";

/** Was der Dienstplan einem offenen Dialog nach dem Neuladen übergibt. */
export type ReloadedModalShift =
  | {
      readonly kind: "stored";
      readonly shift: StaffShift;
      readonly replacements: StaffShift[];
    }
  | { readonly kind: "gone" };

/**
 * Die gespeicherte Schicht des Dialogs in der neu gelesenen Woche, mit
 * ihren Vertretungen (ADR 0311). Fehlt sie, ist sie gelöscht oder in eine
 * andere Woche verschoben: der Dialog hätte nur noch den alten Stand.
 */
export function reloadedModalShift(
  openedId: string,
  shifts: readonly StaffShift[],
): ReloadedModalShift {
  const stored = shifts.find((s) => s.id === openedId);
  if (!stored) return { kind: "gone" };
  return {
    kind: "stored",
    shift: stored,
    replacements: shifts.filter((s) => s.originShiftId === stored.id),
  };
}

/** Die Meldung, wenn die Schicht nach einer Ablehnung fehlt. */
export const MODAL_SHIFT_GONE_MESSAGE =
  "Deine Änderung ist nicht gespeichert. Jemand hat die Schicht inzwischen gelöscht oder in eine andere Woche verschoben.";
