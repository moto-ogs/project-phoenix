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
import { knownEnum } from "./contract/known-enum";
import type * as traegerFamilyChildrenContract from "./contract/traeger-family-children.generated";

const IMPORTS_PATH = "/api/traeger/family-children/imports";

/** Largest file the backend reads, in bytes. */
export const MAX_FAMILY_IMPORT_FILE_BYTES = 2 * 1024 * 1024;

// Go does not register these sets; the contract types them as string. A value
// this build does not know stays undefined instead of passing as a known one.
const FIELD_VALUES = [
  "child_first_name",
  "child_last_name",
  "child_birth_date",
  "school",
  "children",
  "valid_from",
] as const;
const ROW_STATUS_VALUES = [
  "ready",
  "same",
  "differs",
  "conflict",
  "invalid",
  "imported",
] as const;

export type FamilyImportField = (typeof FIELD_VALUES)[number];

export type FamilyImportRowStatus = (typeof ROW_STATUS_VALUES)[number];

/** Header of the column each field comes from; "" leaves it unmapped. */
type FamilyImportColumns = Readonly<Record<FamilyImportField, string>>;

export interface FamilyImportMapping {
  readonly columns: FamilyImportColumns;
  /** The school of every row of a file without a school column; "" with one. */
  readonly schoolId: string;
  /**
   * The day the numbers count from, "YYYY-MM-DD", for every row without a
   * day of its own; "" lets the backend take today. An answer always names
   * the day it used.
   */
  readonly validFrom: string;
}

interface FamilyImportProblem {
  /** undefined: a field this build does not know. */
  readonly field: FamilyImportField | undefined;
  readonly code: string;
}

export interface FamilyImportRow {
  readonly line: number;
  /** undefined: a status this build does not know. */
  readonly status: FamilyImportRowStatus | undefined;
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
  /**
   * Every later day: the child's contracts belong to several families and
   * the number counts from a later day for some of them. Else empty.
   */
  readonly laterValidFrom: readonly string[];
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

function mapRow(
  row: traegerFamilyChildrenContract.FamilyChildrenImportRow,
): FamilyImportRow {
  return {
    line: row.line,
    status: knownEnum(ROW_STATUS_VALUES, row.status),
    childFirstName: row.child_first_name,
    childLastName: row.child_last_name,
    childBirthDate: row.child_birth_date,
    schoolName: row.school_name,
    children: row.children,
    contractId: row.contract_id || null,
    validFrom: row.valid_from,
    laterValidFrom: (row.later_valid_from ?? []).filter(
      (day): day is string => day !== null,
    ),
    confirmedChildren: row.confirmed_children,
    problems: (row.problems ?? []).map((problem) => ({
      field: knownEnum(FIELD_VALUES, problem.field),
      code: problem.code,
    })),
    repeatsLine: row.repeats_line ?? null,
  };
}

/** The school of a mapping as the catalog proxy sends it; "0" names none. */
const mappedSchoolId = (id: string): string => (id === "0" ? "" : id);

function mapImportResult(
  result: traegerFamilyChildrenContract.FamilyChildrenImport,
): FamilyImportResult {
  return {
    encoding: result.encoding,
    delimiter: result.delimiter,
    headers: result.headers ?? [],
    mapping: {
      columns: result.mapping.columns,
      schoolId: mappedSchoolId(result.mapping.school_id),
      validFrom: result.mapping.valid_from ?? "",
    },
    unmapped: (result.unmapped ?? []).flatMap((field) => {
      const known = knownEnum(FIELD_VALUES, field);
      return known ? [known] : [];
    }),
    schools: (result.schools ?? []).map((school) => ({
      id: school.id,
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
        // "0" leaves the school to the file.
        school_id: request.mapping.schoolId || "0",
        valid_from: request.mapping.validFrom || null,
      } satisfies traegerFamilyChildrenContract.FamilyChildrenImportMapping),
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
  return mapImportResult(
    (data as { data: traegerFamilyChildrenContract.FamilyChildrenImport }).data,
  );
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
