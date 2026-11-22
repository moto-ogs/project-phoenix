import { bffJson } from "~/lib/bff-fetch";
/**
 * Client of the import of children and their existing care contracts
 * (#4723): the preview of a CSV file with its column mapping, the import of
 * the ready rows and the log of the imports. The file travels as multipart
 * form; the backend reads it in memory and never stores it.
 * Backend int64 IDs leave here as strings; calendar dates stay "YYYY-MM-DD".
 */

import { knownEnum } from "./contract/known-enum";
import type * as traegerContractImportsContract from "./contract/traeger-contract-imports.generated";

/** Largest file the backend reads, in bytes. */
export const MAX_CONTRACT_IMPORT_FILE_BYTES = 2 * 1024 * 1024;

// Go does not register these sets; the contract types them as string. A value
// this build does not know stays undefined instead of passing as a known one.
const FIELD_VALUES = [
  "child_first_name",
  "child_last_name",
  "child_birth_date",
  "school",
  "module",
  "weekdays",
  "effective_from",
  "ends_on",
  "concluded_on",
  "party_first_name",
  "party_last_name",
  "party_email",
  "debtor_number",
  "family_children",
] as const;
const ROW_STATUS_VALUES = [
  "ready",
  "duplicate",
  "conflict",
  "invalid",
  "imported",
] as const;
const DEBTOR_NUMBER_STATUS_VALUES = [
  "new",
  "same",
  "differs",
  "rows_differ",
  "invalid",
] as const;
const FAMILY_CHILDREN_STATUS_VALUES = [
  "new",
  "same",
  "differs",
  "rows_differ",
] as const;
const DEBTOR_SCOPE_VALUES = ["payer", "child"] as const;

export type ContractImportField = (typeof FIELD_VALUES)[number];

export type ContractImportRowStatus = (typeof ROW_STATUS_VALUES)[number];

/** What the import does with the debtor number of a row; "" without one. */
type ContractDebtorNumberStatus =
  "" | (typeof DEBTOR_NUMBER_STATUS_VALUES)[number];

/**
 * What the import does with the number of the family's children of a row
 * (#7356); "" without one.
 */
type ContractFamilyChildrenStatus =
  "" | (typeof FAMILY_CHILDREN_STATUS_VALUES)[number];

/** Header of the column each field comes from; "" leaves it unmapped. */
type ContractImportColumns = Readonly<Record<ContractImportField, string>>;

export interface ContractImportMapping {
  readonly columns: ContractImportColumns;
  /** The school of every row of a file without a school column; "" with one. */
  readonly schoolId: string;
  /** The module of every row of a file without a module column; "" with one. */
  readonly moduleName: string;
  /**
   * The first day of every contract of a file without a column for it, as
   * `YYYY-MM-DD`; "" with a column.
   */
  readonly effectiveFrom: string;
}

interface ContractImportProblem {
  /** undefined: a field this build does not know. */
  readonly field: ContractImportField | undefined;
  readonly code: string;
}

export interface ContractImportRow {
  readonly line: number;
  /** undefined: a status this build does not know. */
  readonly status: ContractImportRowStatus | undefined;
  readonly childFirstName: string;
  readonly childLastName: string;
  readonly childBirthDate: string | null;
  readonly schoolName: string;
  readonly moduleNames: readonly string[];
  readonly weekdays: readonly string[];
  readonly effectiveFrom: string | null;
  readonly endsOn: string | null;
  readonly partyName: string;
  readonly partyEmail: string;
  readonly problems: readonly ContractImportProblem[];
  /** Notes that do not hold the row back: "start_moved", "imported_before", "no_party". */
  readonly hints: readonly string[];
  /** The stored contract, or the running one a duplicate row found. */
  readonly contractId: string | null;
  /** The line that names the same child before this row. */
  readonly repeatsLine: number | null;
  readonly debtorNumber: string;
  readonly debtorNumberStatus: ContractDebtorNumberStatus;
  /** How many children the family has, as the row names it; null without. */
  readonly familyChildren: number | null;
  readonly familyChildrenStatus: ContractFamilyChildrenStatus;
}

interface ContractImportCounts {
  readonly ready: number;
  readonly duplicate: number;
  readonly conflict: number;
  readonly invalid: number;
  readonly imported: number;
  readonly debtorNumbers: number;
  readonly debtorConflicts: number;
  /** Families whose number of children the import takes over (#7356). */
  readonly familyChildren: number;
}

interface ContractImportModule {
  readonly name: string;
  readonly phaseName: string;
  readonly hasConditions: boolean;
}

export interface ContractImportSchool {
  readonly id: string;
  readonly name: string;
  readonly modules: readonly ContractImportModule[];
}

export interface ContractImportResult {
  readonly encoding: string;
  readonly delimiter: string;
  readonly headers: readonly string[];
  readonly mapping: ContractImportMapping;
  /** Required fields without a column or a choice. */
  readonly unmapped: readonly ContractImportField[];
  readonly schools: readonly ContractImportSchool[];
  /** Whom a debtor number of the Träger names. */
  readonly debtorNumberScope: (typeof DEBTOR_SCOPE_VALUES)[number] | undefined;
  /**
   * Whether the account may map the column of the family's children: the
   * number counts as confirmed by the Abrechnung, so it needs that right.
   */
  readonly familyChildrenAllowed: boolean;
  readonly fingerprint: string;
  readonly applied: boolean;
  readonly counts: ContractImportCounts;
  readonly rows: readonly ContractImportRow[];
}

export interface ContractImportLogEntry {
  readonly file: string;
  readonly accountId: string | null;
  readonly importedAt: string;
  readonly contracts: number;
}

export interface ContractImportRequest {
  readonly file: File;
  /** null takes the mapping moto suggests from the headers. */
  readonly mapping: ContractImportMapping | null;
  /** The fingerprint of the preview the office confirmed; only for the import. */
  readonly fingerprint?: string;
}

function knownFields(fields: readonly string[] | null): ContractImportField[] {
  return (fields ?? []).flatMap((field) => {
    const known = knownEnum(FIELD_VALUES, field);
    return known ? [known] : [];
  });
}

/** The multipart field "mapping"; "0" leaves the school to the file. */
function toBackendMapping(
  mapping: ContractImportMapping,
): traegerContractImportsContract.ContractImportMapping {
  return {
    columns: { ...mapping.columns },
    school_id: mapping.schoolId || "0",
    module_name: mapping.moduleName,
    effective_from: mapping.effectiveFrom === "" ? null : mapping.effectiveFrom,
  };
}

function mapRow(
  row: traegerContractImportsContract.ContractImportRow,
): ContractImportRow {
  return {
    line: row.line,
    status: knownEnum(ROW_STATUS_VALUES, row.status),
    childFirstName: row.child_first_name,
    childLastName: row.child_last_name,
    childBirthDate: row.child_birth_date,
    schoolName: row.school_name,
    moduleNames: row.module_names ?? [],
    weekdays: row.weekdays ?? [],
    effectiveFrom: row.effective_from,
    endsOn: row.ends_on,
    partyName: row.party_name,
    partyEmail: row.party_email,
    problems: (row.problems ?? []).map((problem) => ({
      field: knownEnum(FIELD_VALUES, problem.field),
      code: problem.code,
    })),
    hints: row.hints ?? [],
    contractId: row.contract_id || null,
    repeatsLine: row.repeats_line ?? null,
    debtorNumber: row.debtor_number ?? "",
    debtorNumberStatus:
      knownEnum(DEBTOR_NUMBER_STATUS_VALUES, row.debtor_number_status) ?? "",
    familyChildren: row.family_children ?? null,
    familyChildrenStatus:
      knownEnum(FAMILY_CHILDREN_STATUS_VALUES, row.family_children_status) ??
      "",
  };
}

/** The school of a mapping as the catalog proxy sends it; "0" names none. */
const mappedSchoolId = (id: string): string => (id === "0" ? "" : id);

function mapImportResult(
  result: traegerContractImportsContract.ContractImport,
): ContractImportResult {
  return {
    encoding: result.encoding,
    delimiter: result.delimiter,
    headers: result.headers ?? [],
    mapping: {
      columns: result.mapping.columns,
      schoolId: mappedSchoolId(result.mapping.school_id),
      moduleName: result.mapping.module_name,
      effectiveFrom: result.mapping.effective_from ?? "",
    },
    unmapped: knownFields(result.unmapped),
    schools: (result.schools ?? []).map((school) => ({
      id: school.id,
      name: school.name,
      modules: (school.modules ?? []).map((entry) => ({
        name: entry.name,
        phaseName: entry.phase_name,
        hasConditions: entry.has_conditions,
      })),
    })),
    debtorNumberScope: knownEnum(
      DEBTOR_SCOPE_VALUES,
      result.debtor_number_scope,
    ),
    familyChildrenAllowed: result.family_children_allowed,
    fingerprint: result.fingerprint ?? "",
    applied: result.applied,
    counts: {
      ready: result.counts.ready,
      duplicate: result.counts.duplicate,
      conflict: result.counts.conflict,
      invalid: result.counts.invalid,
      imported: result.counts.imported,
      debtorNumbers: result.counts.debtor_numbers,
      debtorConflicts: result.counts.debtor_conflicts,
      familyChildren: result.counts.family_children,
    },
    rows: (result.rows ?? []).map(mapRow),
  };
}

async function postImport(
  preview: boolean,
  request: ContractImportRequest,
): Promise<ContractImportResult> {
  const form = new FormData();
  form.append("file", request.file);
  if (request.mapping) {
    form.append("mapping", JSON.stringify(toBackendMapping(request.mapping)));
  }
  if (request.fingerprint) {
    form.append("fingerprint", request.fingerprint);
  }
  const data = await (preview
    ? bffJson("org", "POST /traeger/contract-imports/preview", { body: form })
    : bffJson("org", "POST /traeger/contract-imports/", { body: form }));
  return mapImportResult(data);
}

/** Reads the file and answers every row; stores nothing. */
export function previewContractImport(
  request: ContractImportRequest,
): Promise<ContractImportResult> {
  return postImport(true, request);
}

/** Takes over the ready rows. */
export function applyContractImport(
  request: ContractImportRequest,
): Promise<ContractImportResult> {
  return postImport(false, request);
}

/** The imports of the Träger, newest first. */
export async function fetchContractImportLog(): Promise<
  ContractImportLogEntry[]
> {
  const entries = await bffJson("org", "GET /traeger/contract-imports/");
  return entries.map((entry) => ({
    file: entry.file,
    accountId: entry.account_id,
    importedAt: entry.imported_at,
    contracts: entry.contracts,
  }));
}
