/**
 * Abrechnung des Trägers: Läufe, Regeln, Exporte, Lastschrift.
 * Keys describe the response, not its screen; a family prefix ends in `-`.
 */
export const traegerBillingKeys = {
  // Kostenträger-Anteile aller Verträge (#4687).
  costShares: () => "traeger-billing-cost-shares",
  // Ein Abrechnungslauf der Ferienbetreuung mit seinen Dokumenten (#4668).
  holidayRun: (id: string) =>
    `traeger-billing-holiday-run-${encodeURIComponent(id)}`,
  // Ferienzeiträume, für die sich ein Lauf starten lässt.
  holidayRunPeriods: () => "traeger-billing-holiday-run-periods",
  // Regeln des Monatsbeitrags (#4685).
  careRules: () => "traeger-billing-care-rules",
  // Preisliste der Monatsbeiträge (#4684).
  careTariffs: () => "traeger-billing-care-tariffs",
  // Mensa-Preise je Schule (#4686).
  careMealTariffs: () => "traeger-billing-care-meal-tariffs",
  // Nachweise der Ermäßigungen je Vertrag (#4685).
  careEvidences: () => "traeger-billing-care-evidences",
  // Kinderzahlen der Familien.
  childCounts: () => "traeger-billing-child-counts",
  // Familien der Abrechnung (#4691): Liste, Kinder je Familie, eine Familie.
  familiesFamily: "traeger-billing-family-",
  families: () => "traeger-billing-family-list",
  familyChildren: () => "traeger-billing-family-children",
  // The families with a contract alone, without children and numbers (#7770).
  familyContracts: () => "traeger-billing-family-contracts",
  family: (id: string) =>
    `traeger-billing-family-detail-${encodeURIComponent(id)}`,
  // Rechnungsausgangsbuch (#4819): die erste Seite eines Filters. Jedes
  // Lesen steht im Protokoll der gezeigten Läufe.
  invoiceJournal: (filter: string) =>
    `traeger-billing-invoice-journal-${encodeURIComponent(filter)}`,
  // Finanz-Exporte (#4693, #4694, #4821).
  exportSettings: () => "traeger-billing-export-settings",
  exportRuns: () => "traeger-billing-export-runs",
  exportProtocol: () => "traeger-billing-export-protocol",
  datevRunsFamily: "traeger-billing-datev-runs-",
  // Neue DATEV-Buchungen der genannten Läufe (#6433).
  datevRuns: (runKeys: readonly string[]) =>
    `traeger-billing-datev-runs-${runKeys.map(encodeURIComponent).join(",")}`,
  bookingAccounts: () => "traeger-billing-booking-accounts",
  // Empfänger der Finanz-Exporte (#6824, #6911): Liste und ein Empfänger.
  exportRecipientsFamily: "traeger-billing-export-recipient-",
  exportRecipients: () => "traeger-billing-export-recipient-list",
  exportRecipient: (id: string) =>
    `traeger-billing-export-recipient-detail-${encodeURIComponent(id)}`,
} as const;
