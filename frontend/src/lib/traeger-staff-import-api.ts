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
import { readJson, traegerRequest } from "./traeger-api";

const IMPORTS_PATH = "/api/traeger/staff-record-imports";

/** Largest file the backend reads, in bytes. */
export const MAX_STAFF_IMPORT_FILE_BYTES = 2 * 1024 * 1024;

export type StaffImportField =
  | "personnel_number"
  | "first_name"
  | "last_name"
  | "birthday"
  | "iban"
  | "tax_id"
  | "social_security_number";

export type StaffImportRowStatus =
  "new" | "complete" | "duplicate" | "conflict" | "invalid" | "imported";

type StaffImportProblemCode =
  "missing" | "invalid" | "too_long" | "future" | "repeated" | "differs";

/** Header of the column each field comes from; "" leaves it unmapped. */
type StaffImportColumns = Readonly<Record<StaffImportField, string>>;

export interface StaffImportMapping {
  readonly columns: StaffImportColumns;
}

export interface StaffImportProblem {
  readonly field: StaffImportField;
  readonly code: StaffImportProblemCode;
}

export interface StaffImportRow {
  readonly line: number;
  readonly status: StaffImportRowStatus;
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

interface BackendRow {
  line: number;
  status: StaffImportRowStatus;
  personnel_number: string;
  first_name: string;
  last_name: string;
  birthday?: string;
  iban_masked?: string;
  tax_id_masked?: string;
  social_security_number_masked?: string;
  staff_record_id?: number;
  completes: StaffImportField[] | null;
  problems: StaffImportProblem[] | null;
}

interface BackendResult {
  encoding: string;
  delimiter: string;
  headers: string[] | null;
  mapping: { columns: Record<StaffImportField, string> };
  unmapped: StaffImportField[] | null;
  fingerprint?: string;
  applied: boolean;
  counts: Record<StaffImportRowStatus, number>;
  rows: BackendRow[] | null;
}

interface BackendLogEntry {
  file: string;
  account_id: number;
  imported_at: string;
  created: number;
  completed: number;
}

function mapRow(row: BackendRow): StaffImportRow {
  return {
    line: row.line,
    status: row.status,
    personnelNumber: row.personnel_number,
    firstName: row.first_name,
    lastName: row.last_name,
    birthday: row.birthday ?? "",
    ibanMasked: row.iban_masked ?? "",
    taxIdMasked: row.tax_id_masked ?? "",
    socialSecurityNumberMasked: row.social_security_number_masked ?? "",
    recordId: row.staff_record_id ? String(row.staff_record_id) : null,
    completes: row.completes ?? [],
    problems: row.problems ?? [],
  };
}

function mapResult(result: BackendResult): StaffImportResult {
  return {
    encoding: result.encoding,
    delimiter: result.delimiter,
    headers: result.headers ?? [],
    mapping: { columns: result.mapping.columns },
    unmapped: result.unmapped ?? [],
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
  return mapResult((data as { data: BackendResult }).data);
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
  const entries = await traegerRequest<BackendLogEntry[] | null>(IMPORTS_PATH);
  return (entries ?? []).map((entry) => ({
    file: entry.file,
    accountId: String(entry.account_id),
    importedAt: entry.imported_at,
    created: entry.created,
    completed: entry.completed,
  }));
}
