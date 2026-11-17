/**
 * Auswertungen des Trägers: Auslastung, Vergleiche, Berichte, Nachweise.
 * Keys describe the response, not its screen; a family prefix ends in `-`.
 */
export const traegerReportKeys = {
  // Auslastung eines Zeitraums (#4713): Zahlen je Schule, keine Kinder.
  utilization: (from: string, to: string) =>
    `traeger-utilization-${from}-${to}`,
  // Standortvergleich eines Zeitraums; keine Auswahl heißt alle Schulen.
  comparison: (from: string, to: string, schoolIds: readonly string[]) =>
    `traeger-comparison-${from}-${to}-${
      schoolIds.length === 0
        ? "all"
        : schoolIds.map(encodeURIComponent).join(",")
    }`,
  // Länger als gebucht: ohne Namen die Zahlen je Schule, mit Namen auch die
  // Kinder (steht im Zugriffsprotokoll der Schule).
  careTimeOverruns: (
    from: string,
    to: string,
    schoolId: string | null,
    withNames: boolean,
  ) =>
    `traeger-care-time-overruns-${withNames ? "children" : "summary"}-${from}-${to}-${
      schoolId === null ? "all" : encodeURIComponent(schoolId)
    }`,
  // Bericht zum Stichtag (#4716); eine geänderte Vorlage ändert ihn.
  keyDateReportFamily: "traeger-key-date-report-",
  keyDateReport: (keyDate: string, templateId: string | null) =>
    `traeger-key-date-report-${keyDate}-${
      templateId === null ? "standard" : encodeURIComponent(templateId)
    }`,
  // Personalnachweise: Ablaufliste mit Arten, Zuordnung der Arten der Schulen.
  staffProofsFamily: "traeger-staff-proofs-",
  staffProofList: () => "traeger-staff-proofs-list",
  schoolProofKinds: () => "traeger-staff-proofs-school-kinds",
} as const;
