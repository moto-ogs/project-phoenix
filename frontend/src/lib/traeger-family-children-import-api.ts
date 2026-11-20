/**
 * Client of the numbers of the families from a file (#7356): the preview of
 * a CSV file with its column mapping and the import of the ready rows. Each
 * row names a child with a care contract and how many children its family
 * has. The file travels as multipart form; the backend reads it in memory
 * and never stores it. Backend int64 IDs leave here as strings; calendar
 * dates stay "YYYY-MM-DD".
 */

import { apiErrorFromResponse, transportFetch } from "./api-error";
import { readJson } from "./traeger-api";

const IMPORTS_PATH = "/api/traeger/family-children/imports";

/** Largest file the backend reads, in bytes. */
export const MAX_FAMILY_IMPORT_FILE_BYTES = 2 * 1024 * 1024;

export type FamilyImportField =
  | "child_first_name"
  | "child_last_name"
  | "child_birth_date"
  | "school"
  | "children";

export type FamilyImportRowStatus =
  "ready" | "same" | "differs" | "conflict" | "invalid" | "imported";

/** Header of the column each field comes from; "" leaves it unmapped. */
type FamilyImportColumns = Readonly<Record<FamilyImportField, string>>;

export interface FamilyImportMapping {
  readonly columns: FamilyImportColumns;
  /** The school of every row of a file without a school column; "" with one. */
  readonly schoolId: string;
}

interface FamilyImportProblem {
  readonly field: FamilyImportField;
  readonly code: string;
}

export interface FamilyImportRow {
  readonly line: number;
  readonly status: FamilyImportRowStatus;
  readonly childFirstName: string;
  readonly childLastName: string;
  readonly childBirthDate: string | null;
  readonly schoolName: string;
  /** The number the row names; null for none. */
  readonly children: number | null;
  /** The contract of the child the number goes to. */
  readonly contractId: string | null;
  /** The first day the number counts from. */
  readonly validFrom: string | null;
  /** The number the Abrechnung confirmed before, for "same" and "differs". */
  readonly confirmedChildren: number | null;
  readonly problems: readonly FamilyImportProblem[];
  /** The line that names the same child before this row. */
  readonly repeatsLine: number | null;
}

interface FamilyImportCounts {
  readonly ready: number;
  readonly same: number;
  readonly differs: number;
  readonly conflict: number;
  readonly invalid: number;
  readonly imported: number;
}

export interface FamilyImportSchool {
  readonly id: string;
  readonly name: string;
}

export interface FamilyImportResult {
  readonly encoding: string;
  readonly delimiter: string;
  readonly headers: readonly string[];
  readonly mapping: FamilyImportMapping;
  /** Required fields without a column or a choice. */
  readonly unmapped: readonly FamilyImportField[];
  readonly schools: readonly FamilyImportSchool[];
  readonly fingerprint: string;
  readonly applied: boolean;
  readonly counts: FamilyImportCounts;
  readonly rows: readonly FamilyImportRow[];
}

export interface FamilyImportRequest {
  readonly file: File;
  /** null takes the mapping moto suggests from the headers. */
  readonly mapping: FamilyImportMapping | null;
  /** The fingerprint of the preview the office confirmed; only for the import. */
  readonly fingerprint?: string;
}

interface BackendRow {
  line: number;
  status: FamilyImportRowStatus;
  child_first_name: string;
  child_last_name: string;
  child_birth_date: string | null;
  school_name: string;
  children: number | null;
  contract_id?: string;
  valid_from: string | null;
  confirmed_children: number | null;
  problems: FamilyImportProblem[] | null;
  repeats_line?: number;
}

interface BackendResult {
  encoding: string;
  delimiter: string;
  headers: string[] | null;
  mapping: { columns: Record<FamilyImportField, string>; school_id: string };
  unmapped: FamilyImportField[] | null;
  schools: { id: string; name: string }[] | null;
  fingerprint?: string;
  applied: boolean;
  counts: FamilyImportCounts;
  rows: BackendRow[] | null;
}

function mapRow(row: BackendRow): FamilyImportRow {
  return {
    line: row.line,
    status: row.status,
    childFirstName: row.child_first_name,
    childLastName: row.child_last_name,
    childBirthDate: row.child_birth_date,
    schoolName: row.school_name,
    children: row.children,
    contractId: row.contract_id ? String(row.contract_id) : null,
    validFrom: row.valid_from,
    confirmedChildren: row.confirmed_children,
    problems: row.problems ?? [],
    repeatsLine: row.repeats_line ?? null,
  };
}

/** The school of a mapping as the catalog proxy sends it; "0" names none. */
const mappedSchoolId = (id: string): string => (id === "0" ? "" : id);

function mapImportResult(result: BackendResult): FamilyImportResult {
  return {
    encoding: result.encoding,
    delimiter: result.delimiter,
    headers: result.headers ?? [],
    mapping: {
      columns: result.mapping.columns,
      schoolId: mappedSchoolId(result.mapping.school_id),
    },
    unmapped: result.unmapped ?? [],
    schools: (result.schools ?? []).map((school) => ({
      id: String(school.id),
      name: school.name,
    })),
    fingerprint: result.fingerprint ?? "",
    applied: result.applied,
    counts: result.counts,
    rows: (result.rows ?? []).map(mapRow),
  };
}

async function postImport(
  path: string,
  request: FamilyImportRequest,
): Promise<FamilyImportResult> {
  const form = new FormData();
  form.append("file", request.file);
  if (request.mapping) {
    form.append(
      "mapping",
      JSON.stringify({
        columns: request.mapping.columns,
        school_id: request.mapping.schoolId
          ? Number(request.mapping.schoolId)
          : 0,
      }),
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
  return mapImportResult((data as { data: BackendResult }).data);
}

/** Reads the file and answers every row; stores nothing. */
export function previewFamilyChildrenImport(
  request: FamilyImportRequest,
): Promise<FamilyImportResult> {
  return postImport(`${IMPORTS_PATH}/preview`, request);
}

/** Takes over the ready rows of the confirmed preview. */
export function applyFamilyChildrenImport(
  request: FamilyImportRequest,
): Promise<FamilyImportResult> {
  return postImport(IMPORTS_PATH, request);
}
