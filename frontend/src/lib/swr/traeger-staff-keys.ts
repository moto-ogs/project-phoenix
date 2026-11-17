/**
 * Personal des Trägers: Akten, Planung, Abwesenheiten, Lohnexport.
 * Keys describe the response, not its screen; a family prefix ends in `-`.
 */
export const traegerStaffKeys = {
  /** Akten, Vorschläge und Personal ohne Akte; jede Änderung an einer Akte. */
  overviewFamily: "traeger-staff-overview-",
  overview: () => "traeger-staff-overview-records",
  record: (recordId: string) =>
    `traeger-staff-record-${encodeURIComponent(recordId)}`,
  /** Vorschau einer Verknüpfung, je Akte und Beschäftigungen. */
  linkPreview: (
    recordId: string | null,
    members: readonly { schoolId: string; staffId: string }[],
  ) =>
    `traeger-staff-link-preview-${encodeURIComponent(recordId ?? "new")}-${members
      .map(
        (member) =>
          `${encodeURIComponent(member.schoolId)}.${encodeURIComponent(member.staffId)}`,
      )
      .join("+")}`,
  importLog: () => "traeger-staff-import-log",
  absenceTypes: () => "traeger-staff-absence-types",
  /** Kontingente je Akte und Jahr; eine Art oder ein Anspruch ändert sie. */
  absenceAccountsFamily: "traeger-staff-absence-accounts-",
  absenceAccounts: (recordId: string, year: number) =>
    `traeger-staff-absence-accounts-${encodeURIComponent(recordId)}-${year}`,
  /** Stundenkonten; ein Arbeitsvertrag ändert ihr Soll. */
  timeAccountFamily: "traeger-staff-time-account-",
  timeAccount: (recordId: string, year: number, month: number) =>
    `traeger-staff-time-account-${encodeURIComponent(recordId)}-${year}-${month}`,
  /** Planungswochen und Schulen mit künftigen Schichten; eine Schicht ändert sie. */
  planningFamily: "traeger-staff-planning-",
  planningWeek: (monday: string) => `traeger-staff-planning-week-${monday}`,
  futureShifts: () => "traeger-staff-planning-future-shifts",
  /** Springer und Blockungen je Woche; das Merkmal im Arbeitsvertrag ändert sie. */
  poolFamily: "traeger-staff-pool-",
  poolWeek: (monday: string) => `traeger-staff-pool-week-${monday}`,
  /** Prüfungen der Lohndatei; die Lohnarten ändern jeden Monat. */
  payrollFamily: "traeger-staff-payroll-",
  payrollReport: (year: number, month: number, format: string) =>
    `traeger-staff-payroll-report-${year}-${month}-${encodeURIComponent(format)}`,
  timeReport: (year: number, month: number) =>
    `traeger-staff-time-report-${year}-${month}`,
} as const;
