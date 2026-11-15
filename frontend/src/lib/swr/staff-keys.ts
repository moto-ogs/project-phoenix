import { previewRow, previewText, type ListPreview } from "./list-preview";
import { SWR_FAMILIES } from "./shell-keys";
import type { staffService } from "~/lib/staff-api";
import { resourceKey } from "./resource-key";
export type StaffFilters = NonNullable<
  Parameters<typeof staffService.getAllStaff>[0]
>;
export const staffKeys = {
  previewSources: (key: string) =>
    key.startsWith("staff-directory-list-") ||
    key.startsWith("staff-directory-teachers-"),
  preview(data: unknown, id: string): ListPreview | undefined {
    const row = previewRow(data, id);
    const name = previewText(row?.name);
    return name ? { id, name, context: previewText(row?.role) } : undefined;
  },
  profileKey: (id: string) => `staff-detail-${encodeURIComponent(id)}`,
  recordKey: (id: string) => `staff-record-${encodeURIComponent(id)}`,
  family: SWR_FAMILIES.staff,
  key: (params: StaffFilters = {}, options: { strict?: boolean } = {}) =>
    resourceKey("staff-directory-list-", {
      ...params,
      strict: options.strict ?? false,
    }),
  teachersKey: () =>
    resourceKey("staff-directory-teachers-", { page: 1, pageSize: 1000 }),
} as const;

/**
 * Der Stand der Mails zu Abwesenheitsanträgen (#7058), je Satz der gezeigten
 * Anträge; Konto und Schule ergänzen die Hooks. Die Leitung liest die Mails
 * zu ihren Entscheidungen, die Person die Meldung ihrer wartenden Anträge.
 */
export const absenceMailKeys = {
  decisions: (absenceIds: readonly string[]) =>
    `staff-absence-mails-${absenceIds.join(",")}`,
  ownRequests: (waitingIds: readonly string[]) =>
    `own-absence-request-mails-${waitingIds.join(",")}`,
} as const;

/**
 * Die Personen, deren Monat der Träger abschließt (#4711), je Monat. Der
 * Abschluss der Schule ändert sie nicht; ein neuer Monat lädt neu.
 */
export const traegerMonthStaffKeys = {
  month: (year: number, month: number) =>
    `staff-month-close-traeger-staff-${year}-${month}`,
} as const;

/** Nachweise der Mitarbeitenden (#4808). */
export const staffQualificationKeys = {
  types: () => "database-qualification-types",
  overview: () => "database-qualifications",
  entries: (staffId: string) =>
    `staff-qualification-entries-${encodeURIComponent(staffId)}`,
  own: () => "own-staff-qualifications",
  traeger: (staffId: string) =>
    `staff-traeger-proofs-${encodeURIComponent(staffId)}`,
} as const;

/**
 * Arbeitszeitmodell-Vorlagen (#6891): die Katalogseite mit Nutzungszahl und
 * die Auswahl im Reiter „Arbeitszeitmodell“, die eine Änderung neu lädt.
 */
export const workTimeModelKeys = {
  catalog: () => "database-work-time-models",
  picker: () => "work-time-models",
  /** Vorlage, Soll und Sperren je Person für den Zuordnungsdialog (#6921). */
  staffFacts: () => "work-time-model-staff-facts",
} as const;

/** Monatskarte einer Person (#1842). Derselbe Schlüssel, den
 *  `usePeriodMetrics` und die Zeiterfassung schreiben, damit eine offene
 *  Personalakte die Abfrage teilt; Invalidierungen matchen auf
 *  „staff-month-summary-“. */
export const staffMonthSummaryKeys = {
  month: (staffId: string, year: number, month: number) =>
    `staff-month-summary-${staffId}-${year}-${month}`,
} as const;
