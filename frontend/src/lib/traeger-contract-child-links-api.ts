/**
 * Client of the link of imported contracts to the child records of their
 * schools (#7760, ADR 0307): the preview of a CSV file with its two columns,
 * the link of its ready rows, and the link of one contract by hand. The file
 * travels as multipart form; the backend reads it in memory and never stores
 * it. Backend int64 IDs leave here as strings; calendar dates stay
 * "YYYY-MM-DD".
 */

import { apiErrorFromResponse, transportFetch } from "./api-error";
import { knownEnum } from "./contract/known-enum";
import type {
  ChildLinking as WireLinking,
  ChildLinkRow as WireRow,
} from "./contract/traeger-contract-child-links.generated";
import { readJson, traegerRequest } from "./traeger-api";

const LINKS_PATH = "/api/traeger/contract-child-links";

// Go does not register these sets; the contract types them as string. A value
// this build does not know stays undefined instead of passing as a known one.
const FIELD_VALUES = ["contract", "child"] as const;
const STATUS_VALUES = [
  "ready",
  "linked",
  "stored",
  "conflict",
  "invalid",
] as const;
const PROBLEM_VALUES = [
  "missing",
  "invalid",
  "unknown",
  "not_imported",
  "repeated",
  "linked_other",
  "has_contract",
  "differs",
] as const;

/** The two columns of a file: the contract and the child record. */
export type ChildLinkField = (typeof FIELD_VALUES)[number];

export type ChildLinkStatus = (typeof STATUS_VALUES)[number];

export type ChildLinkProblemCode = (typeof PROBLEM_VALUES)[number];

/** Header of the column each field comes from; "" leaves it unmapped. */
export type ChildLinkColumns = Readonly<Record<ChildLinkField, string>>;

export interface ChildLinkProblem {
  /** undefined: a field this build does not know. */
  readonly field: ChildLinkField | undefined;
  /** undefined: a code this build does not know. */
  readonly code: ChildLinkProblemCode | undefined;
}

/** A person as the contract or the child record names it. */
export interface ChildLinkPerson {
  readonly firstName: string;
  readonly lastName: string;
  readonly birthDate: string | null;
}

export interface ChildLinkRow {
  readonly line: number;
  /** undefined: a status this build does not know. */
  readonly status: ChildLinkStatus | undefined;
  /** The contract the row names; null when the cell is empty or no number. */
  readonly contractId: string | null;
  /** The child record the row names; null when the cell is empty or no number. */
  readonly studentId: string | null;
  readonly schoolName: string;
  /** The child as the contract keeps it; empty names for an unknown contract. */
  readonly contract: ChildLinkPerson;
  /** The child record of the contract's school; null when it has none. */
  readonly student: ChildLinkPerson | null;
  readonly problems: readonly ChildLinkProblem[];
  /** The line that names the same contract or child before this row. */
  readonly repeatsLine: number | null;
  /** The running contract the child has already (`has_contract`). */
  readonly otherContractId: string | null;
  /**
   * The state the office sees, answered for a single contract only; the
   * link takes the row only with it. "" for a row of a file.
   */
  readonly fingerprint: string;
}

export interface ChildLinkCounts {
  readonly ready: number;
  readonly linked: number;
  readonly stored: number;
  readonly conflict: number;
  readonly invalid: number;
}

export interface ChildLinkResult {
  readonly encoding: string;
  readonly delimiter: string;
  readonly headers: readonly string[];
  readonly columns: ChildLinkColumns;
  /** Fields without a column; the rows are read once each has one. */
  readonly unmapped: readonly ChildLinkField[];
  readonly fingerprint: string;
  readonly applied: boolean;
  readonly counts: ChildLinkCounts;
  readonly rows: readonly ChildLinkRow[];
}

export interface ChildLinkFileRequest {
  readonly file: File;
  /** null takes the columns moto suggests from the headers. */
  readonly columns: ChildLinkColumns | null;
  /** The fingerprint of the preview the office confirmed; only for the run. */
  readonly fingerprint?: string;
}

function mapRow(row: WireRow): ChildLinkRow {
  const hasStudent =
    row.student_first_name !== "" ||
    row.student_last_name !== "" ||
    row.student_birth_date !== null;
  return {
    line: row.line,
    status: knownEnum(STATUS_VALUES, row.status),
    contractId: row.contract_id ?? null,
    studentId: row.student_id ?? null,
    schoolName: row.school_name,
    contract: {
      firstName: row.contract_child_first_name,
      lastName: row.contract_child_last_name,
      birthDate: row.contract_child_birth_date,
    },
    student: hasStudent
      ? {
          firstName: row.student_first_name,
          lastName: row.student_last_name,
          birthDate: row.student_birth_date,
        }
      : null,
    problems: (row.problems ?? []).map((problem) => ({
      field: knownEnum(FIELD_VALUES, problem.field),
      code: knownEnum(PROBLEM_VALUES, problem.code),
    })),
    repeatsLine: row.repeats_line ?? null,
    otherContractId: row.other_contract_id ?? null,
    fingerprint: row.fingerprint ?? "",
  };
}

function mapLinking(result: WireLinking): ChildLinkResult {
  return {
    encoding: result.encoding,
    delimiter: result.delimiter,
    headers: result.headers ?? [],
    columns: { contract: result.columns.contract, child: result.columns.child },
    unmapped: (result.unmapped ?? []).flatMap((field) => {
      const known = knownEnum(FIELD_VALUES, field);
      return known ? [known] : [];
    }),
    fingerprint: result.fingerprint ?? "",
    applied: result.applied,
    counts: { ...result.counts },
    rows: (result.rows ?? []).map(mapRow),
  };
}

async function postFile(
  path: string,
  request: ChildLinkFileRequest,
): Promise<ChildLinkResult> {
  const form = new FormData();
  form.append("file", request.file);
  if (request.columns) {
    form.append("columns", JSON.stringify(request.columns));
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
  return mapLinking((data as { data: WireLinking }).data);
}

/** Reads the file and answers every row; links nothing. */
export function previewChildLinks(
  request: ChildLinkFileRequest,
): Promise<ChildLinkResult> {
  return postFile(`${LINKS_PATH}/preview`, request);
}

/** Links the ready rows of the confirmed preview. */
export function applyChildLinks(
  request: ChildLinkFileRequest,
): Promise<ChildLinkResult> {
  return postFile(LINKS_PATH, request);
}

function contractPath(contractId: string): string {
  return `${LINKS_PATH}/${encodeURIComponent(contractId)}`;
}

/** What linking one contract to a child record would do; links nothing. */
export async function previewContractChildLink(
  contractId: string,
  studentId: string,
): Promise<ChildLinkRow> {
  return mapRow(
    await traegerRequest<WireRow>(`${contractPath(contractId)}/preview`, {
      method: "POST",
      body: { student_id: studentId },
    }),
  );
}

/**
 * Links one contract to a child record. `acceptDifference` confirms that a
 * child record named or born otherwise is the contract's child; it lifts
 * only that one problem. `fingerprint` is the one of the previewed row: when
 * the contract or the child record changed since, the backend answers
 * `care_contract.child_link_changed` and links nothing.
 */
export async function linkContractChild(
  contractId: string,
  studentId: string,
  acceptDifference: boolean,
  fingerprint: string,
): Promise<ChildLinkRow> {
  return mapRow(
    await traegerRequest<WireRow>(contractPath(contractId), {
      method: "PUT",
      body: {
        student_id: studentId,
        accept_difference: acceptDifference,
        fingerprint,
      },
    }),
  );
}

/**
 * Takes the child record `studentId`, the one the office saw, off an
 * imported contract. A contract linked to another child record since answers
 * `care_contract.child_link_changed` and keeps its link.
 */
export async function unlinkContractChild(
  contractId: string,
  studentId: string,
): Promise<void> {
  const query = new URLSearchParams({ student_id: studentId }).toString();
  await traegerRequest<unknown>(`${contractPath(contractId)}?${query}`, {
    method: "DELETE",
  });
}
