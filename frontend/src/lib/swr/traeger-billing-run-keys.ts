/**
 * Läufe der Abrechnung: Monatsbeiträge, Jahresbescheide, Lastschrift und
 * ihr Versand. Keys describe the response, not its screen; a family prefix
 * ends in `-`.
 */
export const traegerBillingRunKeys = {
  // Monatsläufe (#4684): Rechnungen und Schreiben mit Namen der Familien.
  careRunsFamily: "traeger-care-run-",
  careRuns: () => "traeger-care-run-list",
  careRun: (id: string) => `traeger-care-run-detail-${encodeURIComponent(id)}`,
  careLetters: (runId: string) =>
    `traeger-care-run-letters-${encodeURIComponent(runId)}`,
  // Schulen eines Monats und ihr offener Lauf (#5916), keine Personendaten.
  careRunSchools: (month: string) =>
    `traeger-care-run-schools-${encodeURIComponent(month)}`,
  // Abweichende Empfänger und Zahlwege der Familien (#4689).
  familyBillings: () => "traeger-family-billings",
  // Jahresbescheide (#6219): Bescheide und ihre Originale je Vertrag.
  noticeRunsFamily: "traeger-care-notice-run-",
  noticeRuns: () => "traeger-care-notice-run-list",
  noticeRun: (id: string) =>
    `traeger-care-notice-run-detail-${encodeURIComponent(id)}`,
  noticeLetters: (runId: string) =>
    `traeger-care-notice-run-letters-${encodeURIComponent(runId)}`,
  noticeLetter: (runId: string, contractId: string) =>
    `traeger-care-notice-run-notice-${encodeURIComponent(runId)}-${encodeURIComponent(contractId)}`,
  // Versand der Bestätigungsschreiben eines Ferienlaufs (#4670).
  letterMailings: (runId: string) =>
    `traeger-billing-run-mailings-${encodeURIComponent(runId)}`,
  // Ein gespeichertes Schreiben als PDF (#5692); `file` names the letter
  // across runs and kinds („invoice-12“, „notice-4“).
  letterFile: (file: string) =>
    `traeger-letter-file-${encodeURIComponent(file)}`,
  // Ausstellung, Versand und Exporte einer Rechnung.
  invoiceHistory: (kind: string, invoiceId: string) =>
    `traeger-invoice-history-${encodeURIComponent(kind)}-${encodeURIComponent(invoiceId)}`,
  // SEPA-Mandate (#4695), ihre Abbuchungen (#4697) und Importe (#6198):
  // IBAN nur maskiert.
  sepaMandatesFamily: "traeger-sepa-mandate-",
  sepaMandates: (contractId?: string) =>
    contractId
      ? `traeger-sepa-mandate-contract-${encodeURIComponent(contractId)}`
      : "traeger-sepa-mandate-all",
  sepaMandateHistory: (mandateId: string) =>
    `traeger-sepa-mandate-history-${encodeURIComponent(mandateId)}`,
  sepaMandateCollections: (mandateIds: readonly string[]) =>
    `traeger-sepa-mandate-collections-${mandateIds.map(encodeURIComponent).join(",")}`,
  // Outside the mandate family: an import refreshes the mandates and reads
  // its log itself.
  sepaImportLog: () => "traeger-sepa-import-log",
  // Die Lastschriftdatei eines Laufs (#4697), ohne Bankdaten der Familien.
  sepaDebitRun: (kind: string, runId: string) =>
    `traeger-sepa-debit-run-${encodeURIComponent(kind)}-${encodeURIComponent(runId)}`,
} as const;

/** While a mail of a run waits, its readers look again after this long. */
export const REFRESH_WHILE_QUEUED_MS = 15_000;
