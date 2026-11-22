import { bffJson } from "~/lib/bff-fetch";
/**
 * Client of the import of existing SEPA mandates (#6198): the preview of a
 * CSV file with its column mapping, the import of the ready rows and the log
 * of the imports. The file travels as multipart form; the backend reads it
 * in memory and never stores it. No answer carries an IBAN: a valid one
 * comes back masked, an invalid one not at all.
 * Backend int64 IDs leave here as strings; calendar dates stay "YYYY-MM-DD".
 */

import { knownEnum } from "./contract/known-enum";
import type * as traegerSepaMandatesContract from "./contract/traeger-sepa-mandates.generated";
import { type MandateSequence, knownMandateSequence } from "./traeger-sepa-api";

/** Largest file the backend reads, in bytes. */
export const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024;

// Go does not register these sets; the contract types them as string.
const IMPORT_FIELD_VALUES = [
  "reference",
  "signed_on",
  "iban",
  "bic",
  "account_holder",
  "payer",
  "creditor_id",
  "sequence",
  "last_collected_on",
  "debtor_number",
] as const;
const PAYER_KEY_VALUES = ["email", "contract_id", "debtor_number"] as const;
const IMPORT_ROW_STATUS_VALUES = [
  "ready",
  "clarify",
  "duplicate",
  "same_mandate",
  "conflict",
  "invalid",
  "imported",
] as const;
const DEBTOR_NUMBER_STATUS_VALUES = [
  "new",
  "same",
  "siblings_differ",
  "differs",
  "invalid",
  "no_family",
  // Only when the Träger keeps the number per child (#7007).
  "no_child",
  "rows_differ",
] as const;

export type ImportField = (typeof IMPORT_FIELD_VALUES)[number];

/** debtor_number: the number moto keeps, per child or per payer (#7009). */
export type PayerKey = (typeof PAYER_KEY_VALUES)[number];

export type ImportRowStatus = (typeof IMPORT_ROW_STATUS_VALUES)[number];

/** Header of the column each field comes from; "" leaves it unmapped. */
type ImportColumns = Readonly<Record<ImportField, string>>;

export interface ImportMapping {
  readonly columns: ImportColumns;
  /** null: a key this build does not know; the office picks one. */
  readonly payerKey: PayerKey | null;
  /** The office says every mandate of the file is given to its creditor ID. */
  readonly creditorFromTraeger: boolean;
  /** The creditor ID the office saw when it confirmed; "" without confirmation. */
  readonly confirmedCreditorId: string;
}

export interface ImportProblem {
  /** undefined: a field this build does not know. */
  readonly field: ImportField | undefined;
  readonly code: string;
}

export interface ImportRow {
  readonly line: number;
  /** undefined: a status this build does not know. */
  readonly status: ImportRowStatus | undefined;
  readonly reference: string;
  readonly signedOn: string | null;
  readonly ibanMasked: string;
  readonly bic: string;
  readonly accountHolder: string;
  readonly contractId: string | null;
  readonly payerFirstName: string;
  readonly payerLastName: string;
  readonly sequence: MandateSequence | "";
  readonly lastCollectedOn: string | null;
  readonly mandateId: string | null;
  readonly problems: readonly ImportProblem[];
  readonly hints: readonly string[];
  /** Debtor number of the row for the family (#4693), "" without the column. */
  readonly debtorNumber: string;
  /**
   * The line whose mandate a sibling's row repeats (#7009); null for every
   * other row.
   */
  readonly sameMandateLine: number | null;
  readonly debtorNumberStatus: DebtorNumberStatus | "";
}

/** What the import does with the debtor number of a row (#4693). */
type DebtorNumberStatus = (typeof DEBTOR_NUMBER_STATUS_VALUES)[number];

type ImportCounts = Readonly<
  Record<ImportRowStatus, number> & {
    debtorNumbers: number;
    debtorConflicts: number;
    /** Rows without IBAN and reference the import skipped (#7009). */
    withoutMandate: number;
  }
>;

export interface ImportResult {
  readonly encoding: string;
  readonly delimiter: string;
  readonly headers: readonly string[];
  readonly mapping: ImportMapping;
  /** Required fields still without a column; rows are read once it is empty. */
  readonly unmapped: readonly ImportField[];
  readonly creditorId: string;
  /** Names the rows and what the import does with each, as the preview showed them. */
  readonly fingerprint: string;
  readonly applied: boolean;
  readonly counts: ImportCounts;
  readonly rows: readonly ImportRow[];
}

export interface ImportLogEntry {
  readonly file: string;
  readonly accountId: string | null;
  readonly importedAt: string;
  readonly mandates: number;
}

export interface ImportRequest {
  readonly file: File;
  /** null lets moto suggest the mapping from the headers. */
  readonly mapping: ImportMapping | null;
  /** Answer per line of a row to clarify. */
  readonly sequences?: Readonly<Record<number, MandateSequence>>;
  /** The fingerprint of the preview the office confirmed; the import takes over only that. */
  readonly fingerprint?: string;
}

// payer_key "" lets the backend refuse a mapping without a key.
function toBackendMapping(
  mapping: ImportMapping,
): traegerSepaMandatesContract.SEPAMandateImportMapping {
  return {
    columns: { ...mapping.columns },
    payer_key: mapping.payerKey ?? "",
    creditor_from_traeger: mapping.creditorFromTraeger,
    confirmed_creditor_id: mapping.confirmedCreditorId,
  };
}

function knownFields(fields: readonly string[] | null): ImportField[] {
  return (fields ?? []).flatMap((field) => {
    const known = knownEnum(IMPORT_FIELD_VALUES, field);
    return known ? [known] : [];
  });
}

function mapRow(
  row: traegerSepaMandatesContract.SEPAMandateImportRow,
): ImportRow {
  return {
    line: row.line,
    status: knownEnum(IMPORT_ROW_STATUS_VALUES, row.status),
    reference: row.reference,
    signedOn: row.signed_on,
    ibanMasked: row.iban_masked,
    bic: row.bic,
    accountHolder: row.account_holder,
    contractId: row.contract_id || null,
    payerFirstName: row.payer_first_name,
    payerLastName: row.payer_last_name,
    sequence: knownMandateSequence(row.sequence) ?? "",
    lastCollectedOn: row.last_collected_on,
    mandateId: row.mandate_id || null,
    problems: (row.problems ?? []).map((problem) => ({
      field: knownEnum(IMPORT_FIELD_VALUES, problem.field),
      code: problem.code,
    })),
    hints: row.hints ?? [],
    debtorNumber: row.debtor_number ?? "",
    debtorNumberStatus:
      knownEnum(DEBTOR_NUMBER_STATUS_VALUES, row.debtor_number_status) ?? "",
    sameMandateLine: row.same_mandate_line ?? null,
  };
}

function mapImportResult(
  result: traegerSepaMandatesContract.SEPAMandateImport,
): ImportResult {
  const { counts } = result;
  return {
    encoding: result.encoding,
    delimiter: result.delimiter,
    headers: result.headers ?? [],
    mapping: {
      columns: result.mapping.columns,
      payerKey: knownEnum(PAYER_KEY_VALUES, result.mapping.payer_key) ?? null,
      creditorFromTraeger: result.mapping.creditor_from_traeger,
      confirmedCreditorId: result.mapping.confirmed_creditor_id,
    },
    unmapped: knownFields(result.unmapped),
    creditorId: result.creditor_id,
    fingerprint: result.fingerprint ?? "",
    applied: result.applied,
    counts: {
      ready: counts.ready,
      clarify: counts.clarify,
      duplicate: counts.duplicate,
      same_mandate: counts.same_mandate,
      conflict: counts.conflict,
      invalid: counts.invalid,
      imported: counts.imported,
      debtorNumbers: counts.debtor_numbers,
      debtorConflicts: counts.debtor_conflicts,
      withoutMandate: counts.without_mandate,
    },
    rows: (result.rows ?? []).map(mapRow),
  };
}

async function postImport(
  preview: boolean,
  request: ImportRequest,
): Promise<ImportResult> {
  const form = new FormData();
  form.append("file", request.file);
  if (request.mapping) {
    form.append("mapping", JSON.stringify(toBackendMapping(request.mapping)));
  }
  if (request.sequences && Object.keys(request.sequences).length > 0) {
    form.append("sequences", JSON.stringify(request.sequences));
  }
  if (request.fingerprint) {
    form.append("fingerprint", request.fingerprint);
  }
  const data = await (preview
    ? bffJson("org", "POST /traeger/sepa-mandates/imports/preview", {
        body: form,
      })
    : bffJson("org", "POST /traeger/sepa-mandates/imports", { body: form }));
  return mapImportResult(data);
}

/** Reads the file and answers every row; stores nothing. */
export function previewSepaImport(
  request: ImportRequest,
): Promise<ImportResult> {
  return postImport(true, request);
}

/** Takes over the ready rows and the clarified ones. */
export function applySepaImport(request: ImportRequest): Promise<ImportResult> {
  return postImport(false, request);
}

/** The imports of the Träger, newest first. */
export async function fetchSepaImportLog(): Promise<ImportLogEntry[]> {
  const entries = await bffJson("org", "GET /traeger/sepa-mandates/imports");
  return entries.map((entry) => ({
    file: entry.file,
    accountId: entry.account_id,
    importedAt: entry.imported_at,
    mandates: entry.mandates,
  }));
}
