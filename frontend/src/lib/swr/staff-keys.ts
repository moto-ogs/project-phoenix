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
  key: (params: StaffFilters = {}) =>
    resourceKey("staff-directory-list-", params),
  teachersKey: () =>
    resourceKey("staff-directory-teachers-", { page: 1, pageSize: 1000 }),
  /** Dokumente der Personalakte (Reiter „Dokumente“). */
  documents: (staffId: string) => `staff-documents-${staffId}`,
  /** Personalnummer für die Lohnabrechnung, nur mit Lohnrecht gelesen. */
  payrollNumber: (staffId: string) => `staff-payroll-number-${staffId}`,
  /** Stammdaten der Personalakte; dieselbe Antwort liest die Detailseite. */
  stammdaten: (staffId: string) => `staff-stammdaten-${staffId}`,
  /** Die maskierten Finanzangaben, nur mit `staff:financial`. */
  stammdatenFinancial: (staffId: string) =>
    `staff-stammdaten-financial-${staffId}`,
} as const;

/**
 * Der Stand der Mails zu Abwesenheitsanträgen (#7058), je Satz der gezeigten
 * Anträge; Konto und Schule ergänzen die Hooks. Die Leitung liest die Mails
 * zu ihren Entscheidungen, die Person die Meldung ihrer wartenden Anträge.
 */
const decisionMailFamily = "staff-absence-mails-";
export const absenceMailKeys = {
  decisionsFamily: decisionMailFamily,
  decisions: (absenceIds: readonly string[]) =>
    `${decisionMailFamily}${absenceIds.join(",")}`,
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

/**
 * Der einzelne Hinweis der Leitung, auf den ein Eintrag in der Glocke zeigt
 * (#7143), je Konto; die Schule ergänzt `useSWRAuth`. Die eigene
 * Kenntnisnahme gehört zur Antwort, deshalb trägt der Schlüssel das Konto.
 */
export const staffNoticeKeys = {
  /**
   * Die heute geltenden Hinweise je Konto: Badge der Seitenleiste,
   * Startseiten-Baustein und /tagesinformationen teilen den Eintrag (#4989).
   */
  today: (accountId: string) => `staff-notices-today:${accountId}`,
  /** Alle Hinweise der Leitung je Konto, mit eigener Kenntnisnahme. */
  all: (accountId: string) => `staff-notices:${accountId}`,
  linked: (accountId: string, noticeId: string) =>
    `staff-notice:${accountId}:${encodeURIComponent(noticeId)}`,
  /** Wer eine Tagesinformation wann bestätigt hat (#2208). */
  acknowledgements: (noticeId: string) =>
    `staff-notice-acknowledgements-${encodeURIComponent(noticeId)}`,
} as const;

/**
 * Abwesenheiten, Kontingente und ihre Vorschauen je Person. Das Präfix
 * „staff-absences-“ hält sie im SSE-Satz von staff_time_tracking_changed.
 */
export const staffAbsenceKeys = {
  /** Abwesenheitsarten der Schule; derselbe Eintrag wie Zeiterfassung und
   *  Auswahl der Arten. */
  types: () => "staff-absence-types",
  /** Abwesenheiten einer Person im Zeitraum; derselbe Eintrag wie der Reiter
   *  „Zeiterfassung“. */
  list: (staffId: string, from: string, to: string) =>
    `staff-absences-${encodeURIComponent(staffId)}-${from}-${to}`,
  vacationQuota: (staffId: string, year: number) =>
    `staff-absences-quota-${encodeURIComponent(staffId)}-${year}`,
  allowances: (staffId: string, year: number, typeIds: readonly string[]) =>
    `staff-absences-allowances-${encodeURIComponent(staffId)}-${year}-${typeIds.join(",")}`,
  /** Urlaubsrest und Kontingente je Jahr für die Buchungsdialoge. */
  yearAccounts: (
    staffId: string,
    years: readonly number[],
    typeIds: readonly string[],
  ) =>
    `staff-absences-year-accounts-${encodeURIComponent(staffId)}-${years.join(",")}-${typeIds.join(",")}`,
  compTimePreview: (
    staffId: string,
    dateStart: string,
    dateEnd: string,
    halfDay: boolean,
  ) =>
    `staff-absences-comp-time-preview-${encodeURIComponent(staffId)}-${dateStart}-${dateEnd}-${halfDay}`,
  allowancePreview: (
    typeId: string,
    staffId: string,
    dateStart: string,
    dateEnd: string,
    halfDay: boolean,
  ) =>
    `staff-absences-allowance-preview-${encodeURIComponent(staffId)}-${encodeURIComponent(typeId)}-${dateStart}-${dateEnd}-${halfDay}`,
  /** Probelauf einer Umbuchung (#3258), je Auswahl und Zielart. */
  rebookingPreview: (
    staffId: string,
    absenceIds: readonly string[],
    value: string,
  ) =>
    `staff-absences-rebooking-preview-${encodeURIComponent(staffId)}-${absenceIds.join(",")}-${encodeURIComponent(value)}`,
  /** Abwesenheiten für die Überschneidungsprüfung im Urlaubsformular. */
  ownList: (from: string, to: string) => `time-tracking-absences-${from}-${to}`,
  /** Abwesenheiten für das Stundenkonto einer Person (Reiter „Übersicht“). */
  accountListFamily: (staffId: string) => `staff-absences-account-${staffId}-`,
  accountList: (staffId: string, from: string, to: string): string =>
    `${staffAbsenceKeys.accountListFamily(staffId)}${from}-${to}`,
  /**
   * Wartende Anträge: alle der Schule und die einer Person (Reiter-Badge).
   * Beide liegen unter dem Präfix „staff-pending-absences-“, das jede
   * Entscheidung auffrischt.
   */
  pendingAll: () => "staff-pending-absences-all",
  pendingForStaff: (staffId: string) => `staff-pending-absences-${staffId}`,
  /** Die Anträge je Konto, Ansicht und Filter (#4988). */
  requestsFamily: (accountId: string | undefined) =>
    `staff-absence-requests:${accountId}:`,
  requests: (
    accountId: string,
    view: string,
    search: string,
    types: readonly string[],
  ): string =>
    `${staffAbsenceKeys.requestsFamily(accountId)}${view}:${JSON.stringify([search, types])}`,
} as const;

/** Zeiterfassung, Schichten und Protokoll je Person. */
export const staffTimeKeys = {
  /** Erste Seite des Änderungsprotokolls (#1417) je Filter; „Weitere
   *  Einträge laden“ hängt Folgeseiten nur in der Ansicht an. */
  auditLog: (query: object) => resourceKey("staff-audit-log-", query),
  /** DATEV-Vorschau je Format und Monat, vor dem Export. */
  datevReport: (format: string, year: number, month: number) =>
    `staff-time-datev-report-${format}-${year}-${month}`,
  /** Änderungen eines Arbeitsblocks. Die eigene Sicht nutzt einen anderen
   *  Endpunkt als die Leitung. Das Präfix „staff-history-“ hält sie im
   *  SSE-Satz und in `isStaleAfterSessionSave`. */
  sessionEdits: (view: "admin" | "own", staffId: string, sessionId: string) =>
    `staff-history-session-edits-${view}-${encodeURIComponent(staffId)}-${encodeURIComponent(sessionId)}`,
  /** Regel einer Schichtserie (#2028). Das Präfix „dienstplan-shifts-“
   *  frischt sie mit jeder Planänderung auf (PLAN_CACHE_KEY_PREFIXES). */
  shiftSeries: (seriesId: string) =>
    `dienstplan-shifts-series-${encodeURIComponent(seriesId)}`,
  /** Arbeitszeitplan einer Person; Präfix „staff-schedule-“. */
  schedule: (staffId: string) => `staff-schedule-${staffId}`,
  /**
   * Tagesprojektion (Soll, Gutschrift, Ist, Saldo) einer Person im Zeitraum.
   * Zeiterfassungstabelle und Wochenkachel teilen den Eintrag; Speichern
   * frischt alles mit „staff-schedule-targets-<id>-“ auf.
   */
  scheduleTargets: (staffId: string, from: string, to: string) =>
    `staff-schedule-targets-${staffId}-${from}-${to}`,
  /** Dieselbe Projektion über das Stundenkonto (Reiter „Übersicht“). */
  scheduleTargetsAccount: (staffId: string, from: string, to: string) =>
    `staff-schedule-targets-${staffId}-account-${from}-${to}`,
  /** Vorschau der Sollzeiten im Reiter „Arbeitszeitmodell“. */
  scheduleTargetsPreview: (staffId: string, from: string, to: string) =>
    `staff-schedule-targets-preview-${staffId}-${from}-${to}`,
  /** Arbeitsblöcke einer Person im Zeitraum; Präfix „staff-history-“ im SSE. */
  history: (staffId: string, from: string, to: string) =>
    `staff-history-${staffId}-${from}-${to}`,
  /** Arbeitsblöcke über das Stundenkonto (Reiter „Übersicht“). */
  historyAccountFamily: (staffId: string) =>
    `staff-history-account-${staffId}-`,
  historyAccount: (staffId: string, from: string, to: string): string =>
    `${staffTimeKeys.historyAccountFamily(staffId)}${from}-${to}`,
  /** Stundenkonto-Buchungen (#1420) einer Person. */
  balanceAdjustmentsFamily: (staffId: string) =>
    `staff-balance-adjustments-${staffId}-`,
  balanceAdjustments: (staffId: string, from: string, to: string): string =>
    `${staffTimeKeys.balanceAdjustmentsFamily(staffId)}${from}-${to}`,
  /** Geplante Schichten einer Person im sichtbaren Zeitraum. */
  shiftsVisible: (staffId: string, from: string, to: string) =>
    `staff-shifts-visible-${staffId}-${from}-${to}`,
  /** Sonderarbeitszeiten einer Person. */
  targetOverrides: (staffId: string) => `staff-target-overrides-${staffId}`,
  /** Zeiterfassung der Schule im Überblick, je Zeitraum. */
  dashboardSummary: (period: string) => `staff-dashboard-summary-${period}`,
} as const;

/** Rollen, Klassen und Betreuungsrechte der Mitarbeitenden. */
export const staffAccessKeys = {
  /** Personen, deren Ansicht die Leitung lesend öffnen kann (#2893). */
  previewCandidates: () => "staff-preview-candidates",
  /** Zugewiesene Schulklassen einer Lehrkraft (#1772). */
  schoolClasses: (staffId: string) =>
    `staff-school-classes-${encodeURIComponent(staffId)}`,
  /** Mögliche Ersatzkräfte beim Auflösen offener Zuordnungen. */
  groupLeaderCandidates: () => "staff-group-leader-candidates",
  /** Betreuungsrecht eines Kontos der eigenen Schule. */
  caregiverCapability: (accountId: string) =>
    `caregiver-capability-${encodeURIComponent(accountId)}`,
  /** Betreuungsrecht eines Kontos, aus dem Operator-Portal je Schule. */
  operatorCaregiverCapability: (schoolId: string, accountId: string) =>
    `operator-caregiver-capability-${encodeURIComponent(schoolId)}-${encodeURIComponent(accountId)}`,
  /** Die Rechte einer Rolle (`authService.getRolePermissions`). */
  rolePermissions: (roleId: string) =>
    `role-permissions-${encodeURIComponent(roleId)}`,
  /** Alle Rechte zur Auswahl im Rollen-Reiter (`authService.getPermissions`). */
  permissionCatalog: () => "role-permission-catalog",
  /** Die Systemrolle eines Kontos (Konto bearbeiten, #3116). */
  roleAssignment: (accountId: string) => `staff-role-assignment-${accountId}`,
} as const;

/** Stammdaten, Verzeichnisse und Monatsstände der Personalverwaltung. */
export const staffRecordKeys = {
  /** Ausgeschiedene Mitarbeitende (`staffService.getFormerStaff`). */
  former: () => "staff-former-list",
  /** Das Dokumentenverzeichnis aller Mitarbeitenden. */
  documentDirectory: () => "staff-document-directory",
  /** Zeitkonten eines Monats je Beschäftigungstyp und Saldo-Grenzen (#1417). */
  timeAccounts: (
    year: number,
    month: number,
    employment: string,
    saldoMin: number | undefined,
    saldoMax: number | undefined,
  ) =>
    `staff-time-accounts-${year}-${month}-${employment}-${saldoMin ?? ""}-${saldoMax ?? ""}`,
  /** Die Personen eines Monats als Auswahl des Änderungsprotokolls. */
  auditOptions: (year: number, month: number) =>
    `staff-audit-options-${year}-${month}`,
  /** Abschluss-Status eines Monats (#1417). */
  monthClose: (year: number, month: number) =>
    `staff-month-close-${year}-${month}`,
} as const;

/**
 * Alle gespeicherten Schließtag-Zeiträume (#2032). Derselbe Schlüssel wie in
 * `useClosingDaysState`, damit Editor und Planraster eine Antwort teilen.
 */
export const closingDayKeys = {
  list: () => "planning-closing-days",
  /** Das Fenster des Zeiterfassungs-Endpunkts ohne `schedules:read`. */
  window: (fromISO: string, toISO: string) =>
    `planning-closing-days-${fromISO}-${toISO}`,
} as const;
