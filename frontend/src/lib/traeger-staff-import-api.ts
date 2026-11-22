import { bffJson } from "~/lib/bff-fetch";
/**
 * Client of the Personal-Import of the Träger (#4724, ADR 0089 section 5):
 * the preview of a CSV file with its column mapping, the import of the new
 * and complete rows and the log of the imports. The file travels as
 * multipart form; the backend reads it in memory and never stores it. No
 * answer carries a bank or tax value: a valid one comes back masked, an
 * invalid one not at all. Backend int64 IDs leave here as strings; calendar
 * dates stay "YYYY-MM-DD".
 */

import { apiErrorFromResponse, transportFetch } from "./api-error";
import type * as traegerStaffRecordImportsContract from "./contract/traeger-staff-record-imports.generated";
import { knownEnum } from "./contract/known-enum";
import { readJson } from "./traeger-api";

const IMPORTS_PATH = "/api/traeger/staff-record-imports";

/** Largest file the backend reads, in bytes. */
export const MAX_STAFF_IMPORT_FILE_BYTES = 2 * 1024 * 1024;

// Go does not register these sets; the contract types them as string.
const STAFF_IMPORT_FIELD_VALUES = [
  "personnel_number",
  "first_name",
  "last_name",
  "birthday",
  "iban",
  "tax_id",
  "social_security_number",
] as const;
const STAFF_IMPORT_ROW_STATUS_VALUES = [
  "new",
  "complete",
  "duplicate",
  "conflict",
  "invalid",
  "imported",
] as const;
const STAFF_IMPORT_PROBLEM_CODE_VALUES = [
  "missing",
  "invalid",
  "too_long",
  "future",
  "repeated",
  "differs",
] as const;

export type StaffImportField = (typeof STAFF_IMPORT_FIELD_VALUES)[number];

export type StaffImportRowStatus =
  (typeof STAFF_IMPORT_ROW_STATUS_VALUES)[number];

/**
 * Why a row stays out. `other`: a reason this build does not know; the row
 * still stays out.
 */
type StaffImportProblemCode =
  (typeof STAFF_IMPORT_PROBLEM_CODE_VALUES)[number] | "other";

/** Header of the column each field comes from; "" leaves it unmapped. */
type StaffImportColumns = Readonly<Record<StaffImportField, string>>;

export interface StaffImportMapping {
  readonly columns: StaffImportColumns;
}

export interface StaffImportProblem {
  /** undefined: a field this build does not know. */
  readonly field: StaffImportField | undefined;
  readonly code: StaffImportProblemCode;
}

export interface StaffImportRow {
  readonly line: number;
  /** undefined: a state this build does not know. */
  readonly status: StaffImportRowStatus | undefined;
  readonly personnelNumber: string;
  readonly firstName: string;
  readonly lastName: string;
  /** `YYYY-MM-DD` or "". */
  readonly birthday: string;
  readonly ibanMasked: string;
  readonly taxIdMasked: string;
  readonly socialSecurityNumberMasked: string;
  /** The record with the row's number, or the one the import created. */
  readonly recordId: string | null;
  /** Bank and tax fields a complete row fills on its record. */
  readonly completes: readonly StaffImportField[];
  readonly problems: readonly StaffImportProblem[];
}

export type StaffImportCounts = Readonly<Record<StaffImportRowStatus, number>>;

export interface StaffImportResult {
  readonly encoding: string;
  readonly delimiter: string;
  readonly headers: readonly string[];
  readonly mapping: StaffImportMapping;
  /** Required fields still without a column; rows are read once it is empty. */
  readonly unmapped: readonly StaffImportField[];
  /** Names the rows as the preview showed them; the import takes over only that. */
  readonly fingerprint: string;
  readonly applied: boolean;
  readonly counts: StaffImportCounts;
  readonly rows: readonly StaffImportRow[];
}

export interface StaffImportLogEntry {
  readonly file: string;
  readonly accountId: string;
  /** The reader's own import. */
  readonly byYou: boolean;
  /** The name a colleague carries at the Träger; "" for the reader or none. */
  readonly accountName: string;
  readonly importedAt: string;
  readonly created: number;
  readonly completed: number;
}

export interface StaffImportRequest {
  readonly file: File;
  /** null lets moto suggest the mapping from the headers. */
  readonly mapping: StaffImportMapping | null;
  /** The fingerprint of the preview the office confirmed. */
  readonly fingerprint?: string;
}

const knownFields = (values: readonly string[] | null): StaffImportField[] =>
  (values ?? []).flatMap((value) => {
    const field = knownEnum(STAFF_IMPORT_FIELD_VALUES, value);
    return field === undefined ? [] : [field];
  });

function mapRow(
  row: traegerStaffRecordImportsContract.StaffImportRow,
): StaffImportRow {
  return {
    line: row.line,
    status: knownEnum(STAFF_IMPORT_ROW_STATUS_VALUES, row.status),
    personnelNumber: row.personnel_number,
    firstName: row.first_name,
    lastName: row.last_name,
    birthday: row.birthday ?? "",
    ibanMasked: row.iban_masked ?? "",
    taxIdMasked: row.tax_id_masked ?? "",
    socialSecurityNumberMasked: row.social_security_number_masked ?? "",
    // Go omits the field while the row has no record, so "0" never comes.
    recordId: row.staff_record_id ?? null,
    completes: knownFields(row.completes),
    problems: (row.problems ?? []).map((problem) => ({
      field: knownEnum(STAFF_IMPORT_FIELD_VALUES, problem.field),
      code:
        knownEnum(STAFF_IMPORT_PROBLEM_CODE_VALUES, problem.code) ?? "other",
    })),
  };
}

function mapResult(
  result: traegerStaffRecordImportsContract.StaffImport,
): StaffImportResult {
  return {
    encoding: result.encoding,
    delimiter: result.delimiter,
    headers: result.headers ?? [],
    mapping: { columns: result.mapping.columns },
    // A field this build does not know has no column to choose here.
    unmapped: knownFields(result.unmapped),
    fingerprint: result.fingerprint ?? "",
    applied: result.applied,
    counts: result.counts,
    rows: (result.rows ?? []).map(mapRow),
  };
}

async function postImport(
  path: string,
  request: StaffImportRequest,
): Promise<StaffImportResult> {
  const form = new FormData();
  form.append("file", request.file);
  if (request.mapping) {
    form.append(
      "mapping",
      JSON.stringify({ columns: request.mapping.columns }),
    );
  }
  if (request.fingerprint) {
    form.append("fingerprint", request.fingerprint);
  }
  const response = await transportFetch(path, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    body: form,
  });
  if (!response.ok) {
    throw await apiErrorFromResponse(
      response,
      `Request failed (${response.status})`,
    );
  }
  const data = await readJson(response);
  return mapResult(
    (data as { data: traegerStaffRecordImportsContract.StaffImport }).data,
  );
}

/** Reads the file and answers every row; stores nothing. */
export function previewStaffImport(
  request: StaffImportRequest,
): Promise<StaffImportResult> {
  return postImport(`${IMPORTS_PATH}/preview`, request);
}

/** Takes over the new and complete rows of the confirmed preview. */
export function applyStaffImport(
  request: StaffImportRequest,
): Promise<StaffImportResult> {
  return postImport(IMPORTS_PATH, request);
}

/** The imports of the Träger, newest first. */
export async function fetchStaffImportLog(): Promise<StaffImportLogEntry[]> {
  const entries = await bffJson("org", "GET /traeger/staff-record-imports/");
  return entries.map((entry) => ({
    file: entry.file,
    accountId: entry.account_id,
    byYou: entry.by_you,
    accountName: entry.account_name ?? "",
    importedAt: entry.imported_at,
    created: entry.created,
    completed: entry.completed,
  }));
}
