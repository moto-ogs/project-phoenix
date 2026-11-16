import { type ListPreview, previewRow, previewText } from "./list-preview";

/**
 * Shared Träger resources: schools, holidays, settings, documents, reports.
 * Billing, contracts and staff own their keys in `traeger-billing-keys`,
 * `traeger-contract-keys` and `traeger-staff-keys`. Every key lives only in
 * the tab's memory, scoped to the Träger and the account (#4986, #5182).
 */
export const traegerKeys = {
  // Read by pages of several areas; each has one reader hook in
  // `components/traeger`.
  buero: () => "traeger-buero",
  profile: () => "traeger-profile",
  organization: () => "traeger-organization",
  masterData: () => "traeger-master-data",
  sepaCreditor: () => "traeger-sepa-creditor",
  // Verlauf des Träger-Büros (#5474): die erste Seite; ältere Seiten lädt
  // die Ansicht dazu. Jede Änderung im Büro liest die Familie neu.
  accountHistoryFamily: "traeger-account-history-",
  accountHistory: () => "traeger-account-history-first",
  // Zugriffsprotokoll (#4655): erste Seite je Filter und die Personen eines
  // Zeitraums. Jedes Lesen steht selbst im Protokoll der Schulen.
  accessLog: (filter: {
    readonly from: string;
    readonly to: string;
    readonly schoolId: string;
    readonly accountId: string;
    readonly kind: string;
  }) =>
    `traeger-access-log-list-${filter.from}-${filter.to}-${encodeURIComponent(
      filter.schoolId,
    )}-${encodeURIComponent(filter.accountId)}-${filter.kind}`,
  accessLogPeople: (from: string, to: string) =>
    `traeger-access-log-people-${from}-${to}`,
  // Format und Bezug der Debitorennummern (#6675, #7007).
  debtorNumberSettings: () => "traeger-debtor-number-settings",
  schools: () => "traeger-schools",
  school: (id: string) => `traeger-school-${encodeURIComponent(id)}`,
  schoolsAlerts: () => "traeger-schools-alerts",
  keyDateCounts: () => "traeger-key-date-counts",
  occupancy: () => "traeger-occupancy",
  // Ankunft und Abholung eines Zeitraums (#4714): Durchschnitte, keine Kinder.
  arrivalPickupTimes: (from: string, to: string) =>
    `traeger-arrival-pickup-times-${from}-${to}`,
  // Tagesmeldung Mecklenburg-Vorpommern eines Zeitraums (#4717): Zahlen, keine Kinder.
  dailyAttendance: (from: string, to: string) =>
    `traeger-daily-attendance-${from}-${to}`,
  periodsFamily: "traeger-holiday-period-",
  periods: () => "traeger-holiday-period-list",
  period: (id: string) =>
    `traeger-holiday-period-detail-${encodeURIComponent(id)}`,
  // Teile eines Ferienzeitraums; eine Änderung am Zeitraum liest sie mit.
  // Anmeldeformular (#5198): Fragen, keine Antworten.
  holidayForm: (id: string) =>
    `traeger-holiday-period-form-${encodeURIComponent(id)}`,
  // Plätze je Woche mit Warteliste (#4699): Kinder mit Namen.
  holidayPlaces: (id: string) =>
    `traeger-holiday-period-places-${encodeURIComponent(id)}`,
  // Vergabe nach Kriterien (#4700): offene Anmeldungen mit Vorschlag.
  holidayAllocation: (id: string) =>
    `traeger-holiday-period-allocation-${encodeURIComponent(id)}`,
  // Ferienanmeldungen (#4698) je Filter, mit Kindern und Eltern.
  holidayRegistrations: (
    id: string,
    filter: {
      readonly status: string;
      readonly school: string;
      readonly weekId: string;
      readonly timeModel: string;
      readonly wish: string;
    },
  ) =>
    `traeger-holiday-period-registrations-${encodeURIComponent(id)}-${[
      filter.status,
      filter.school,
      filter.weekId,
      filter.timeModel,
      filter.wish,
    ]
      .map(encodeURIComponent)
      .join(",")}`,
  holidayRegistration: (id: string, registrationId: string) =>
    `traeger-holiday-period-registration-${encodeURIComponent(
      id,
    )}-${encodeURIComponent(registrationId)}`,
  // Teile einer Anmeldung: Gesundheitsangaben (#4722), der Ferienbeitrag
  // nach der Erklärung der Eltern (#5629) und die Debitorennummer der
  // Familie (#6692).
  holidayRegistrationHealth: (id: string, registrationId: string) =>
    `traeger-holiday-period-registration-health-${encodeURIComponent(
      id,
    )}-${encodeURIComponent(registrationId)}`,
  holidayContribution: (id: string, registrationId: string) =>
    `traeger-holiday-period-contribution-${encodeURIComponent(
      id,
    )}-${encodeURIComponent(registrationId)}`,
  holidayFamilyDebtorNumber: (id: string, registrationId: string) =>
    `traeger-holiday-period-family-debtor-number-${encodeURIComponent(
      id,
    )}-${encodeURIComponent(registrationId)}`,
  // Geschwistergruppen der Anmeldungen (#5628).
  holidaySiblingGroups: (id: string) =>
    `traeger-holiday-period-siblings-${encodeURIComponent(id)}`,
  // Schulen, die ein angemeldetes Kind kennen (#6683). `children` nennt
  // Namen und Geburtsdaten, nach denen die Antwort fragt.
  holidayKnownChildren: (
    id: string,
    registrationId: string | undefined,
    children: string | undefined,
  ) =>
    `traeger-holiday-period-known-${encodeURIComponent(id)}-${encodeURIComponent(
      registrationId ?? "",
    )}-${encodeURIComponent(children ?? "")}`,
  // Nicht zugestellte Mails der Anmeldungen (#6737), gelesen zum Stand
  // `states` der gezeigten Anmeldungen: eine Bestätigung schickt eine Mail.
  holidayMailProblems: (id: string, states: string) =>
    `traeger-holiday-period-mail-problems-${encodeURIComponent(
      id,
    )}-${encodeURIComponent(states)}`,
  // Ob der Träger die Debitorennummer bei der Bestätigung verlangt (#5621).
  holidayConfirmationSettings: () => "traeger-holiday-confirmation-settings",
  settings: () => "traeger-settings-schema",
  // Vorlagen der Briefe (#4677): Texte mit Platzhaltern, keine Personendaten.
  // Die Liste ist eine eigene Familie: Speichern einer Vorlage liest die
  // Vorlage selbst schon nach.
  documentTemplatesFamily: "traeger-document-templates-",
  documentTemplates: () => "traeger-document-templates-list",
  // Dokumentart je Leistung (#4688); sie nennt, ob die Vorlage „Bescheid“
  // eine Rechtsbehelfsbelehrung hat, und gehört darum zur Familie.
  documentKinds: () => "traeger-document-templates-kinds",
  documentTemplate: (kind: string) =>
    `traeger-document-template-${encodeURIComponent(kind)}`,
  // Die Vorschau einer gespeicherten Version mit Beispieldaten.
  documentTemplatePreview: (kind: string, version: number) =>
    `traeger-document-template-preview-${encodeURIComponent(kind)}-${version}`,
  // Abrechnungsvorgaben (#5685): Regeln, Kostenträger, Nummernkreise und
  // Zahlungsbedingungen, keine Personendaten.
  contributionRules: () => "traeger-contribution-rules",
  costBearers: () => "traeger-cost-bearers",
  holidayNumberRange: () => "traeger-number-range-holiday",
  careNumberRange: () => "traeger-number-range-care",
  billingTerms: () => "traeger-billing-terms",
  // Kriterien der Platzvergabe (#4700): Namen und Fragen, keine Antworten.
  holidayCriteria: () => "traeger-holiday-criteria",
  // Schließtage und Feiertage eines Jahres (#4702), keine Personendaten.
  closingDays: (from: string, to: string) =>
    `traeger-closing-days-${from}-${to}`,
  // Offene Hinweise an Eltern zu Schließtagen in Ferienwochen (#6434):
  // Wochen und Zahlen, keine Namen.
  holidayClosures: () => "traeger-holiday-closures-pending",
  // Welche Ferienbuchungen ein Entwurf eines Schließtags trifft (#6434),
  // beim Ändern und Löschen mit dem gespeicherten Schließtag (#6457).
  closingDayImpact: (
    draft: {
      readonly startDate: string;
      readonly endDate: string;
      readonly schoolIds: readonly string[];
    },
    saved: {
      readonly id: string;
      readonly startDate: string;
      readonly endDate: string;
      readonly schoolIds: readonly string[];
    } | null,
    deleting: boolean,
  ) =>
    `traeger-closing-day-impact-${deleting ? "delete" : "save"}-${
      draft.startDate
    }-${draft.endDate}-${draft.schoolIds.map(encodeURIComponent).join(",")}-${
      saved
        ? `${encodeURIComponent(saved.id)}.${saved.startDate}.${
            saved.endDate
          }.${saved.schoolIds.map(encodeURIComponent).join(",")}`
        : "new"
    }`,
  billingRuns: () => "traeger-billing-run-list",
  // Geteilte Dokumente (#4692): Titel, Dateiname und Freigaben, keine Inhalte.
  documents: () => "traeger-document-list",
  documentAudiences: () => "traeger-document-audiences",
  // Anmeldephasen und Angebote des Trägers (#4704): Entwürfe, Versionen und
  // das Ergebnis je Schule, keine Personendaten.
  // Berichtsvorlagen (#4716): Name, Abschnitte, Stichtag und Sozialräume,
  // keine Personendaten.
  reportTemplates: () => "traeger-report-templates",
  catalogFamily: "traeger-catalog-phase-",
  catalogPhases: () => "traeger-catalog-phase-list",
  catalogPhase: (id: string) =>
    `traeger-catalog-phase-detail-${encodeURIComponent(id)}`,
  // Was das Übertragen je Schule ändert (#4704); eine Änderung an der Phase
  // ändert die Vorschau.
  catalogPhasePreview: (id: string) =>
    `traeger-catalog-phase-preview-${encodeURIComponent(id)}`,
  periodPreview(data: unknown, id: string): ListPreview | undefined {
    const row = previewRow(data, id);
    const name = previewText(row?.name);
    return name ? { id, name } : undefined;
  },
} as const;
