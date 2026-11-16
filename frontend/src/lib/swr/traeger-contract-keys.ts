/**
 * Betreuungsverträge des Trägers und ihre Bedingungen.
 * Keys describe the response, not its screen; a family prefix ends in `-`.
 */
const changesFamily = (contractId: string) =>
  `traeger-care-contract-changes-${encodeURIComponent(contractId)}-`;
const noticeFamily = (contractId: string) =>
  `traeger-care-contract-notice-${encodeURIComponent(contractId)}-`;

export const traegerContractKeys = {
  // Erste Seite der Vertragsliste je Filter (#4678): Kind, Eltern, Status.
  listFamily: "traeger-care-contract-list-",
  list: (filter: {
    readonly status?: string;
    readonly schoolId: string;
    readonly search: string;
  }) =>
    `traeger-care-contract-list-status=${encodeURIComponent(filter.status ?? "")}&school=${encodeURIComponent(filter.schoolId)}&search=${encodeURIComponent(filter.search)}`,
  // Angenommene Kinder ohne Vertrag, mit dem Grund, warum keiner entsteht.
  candidates: () => "traeger-care-contract-candidates",
  // „Wann gilt der Vertrag?“ je Schule.
  conclusionModes: () => "traeger-care-contract-conclusion-modes",
  contract: (id: string) =>
    `traeger-care-contract-detail-${encodeURIComponent(id)}`,
  // Das PDF eines Vertrags; ein neues gibt es nur nach dem ersten Versand
  // oder mit einer anderen geltenden Version.
  contractPdf: (id: string, version: number, frozen: boolean) =>
    `traeger-care-contract-pdf-${encodeURIComponent(id)}-v${version}-${frozen ? "frozen" : "draft"}`,
  // Änderungswunsch der Eltern (#5979).
  changesFamily,
  changes: (contractId: string) => `${changesFamily(contractId)}current`,
  // Vorschau eines Wunschs in seiner Version zu einem Tag.
  changePreview: (
    contractId: string,
    requestId: string,
    requestVersion: string,
    day: string,
  ) =>
    `${changesFamily(contractId)}preview-${encodeURIComponent(requestId)}-${encodeURIComponent(requestVersion)}-${day}`,
  // Kündigung und Widerruf (#4682): was der Vertrag heute erlaubt.
  noticeFamily,
  notice: (contractId: string) => `${noticeFamily(contractId)}current`,
  // Die Termine für einen Eingangstag.
  noticeOn: (contractId: string, day: string) =>
    `${noticeFamily(contractId)}on-${day}`,
  // Vertragsbedingungen je Angebot.
  templates: () => "traeger-care-contract-templates",
  // Bisherige Vertragsimporte (#4723): Datei, Zeitpunkt, Konto, Anzahl.
  importLog: () => "traeger-care-contract-import-log",
} as const;
