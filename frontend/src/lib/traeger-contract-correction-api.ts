/**
 * Client of the completion of imported care contracts (#7767): the list of
 * every imported contract as a CSV file, the preview of the filled-in list,
 * the correction of its changing rows and the log of the corrections. The
 * file travels as multipart form; the backend reads it in memory and keeps
 * only its name. Backend int64 IDs leave here as strings; calendar dates
 * stay "YYYY-MM-DD".
 */

import { bffJson } from "~/lib/bff-fetch";

import { apiErrorFromResponse, transportFetch } from "./api-error";
import { knownEnum } from "./contract/known-enum";
import type { ContractCorrectionValues as WireValues } from "./contract/shared.generated";
import type {
  ContractCorrectionRow as WireRow,
  ContractCorrectionRun as WireRun,
} from "./contract/traeger-contract-corrections.generated";
import { filenameFromDisposition } from "./file-download";

const CORRECTIONS_PATH = "/api/traeger/contract-corrections";

/** Largest file the backend reads, in bytes. */
export const MAX_CONTRACT_CORRECTION_FILE_BYTES = 2 * 1024 * 1024;

// Go does not register these sets; the contract types them as string. A value
// this build does not know stays undefined instead of passing as a known one.
const FIELD_VALUES = [
  "contract_id",
  "child",
  "parties",
  "method",
  "concluded_on",
  "evidence",
] as const;
const ROW_STATUS_VALUES = [
  "change",
  "unchanged",
  "invalid",
  "corrected",
] as const;
const CHANGE_VALUES = ["parties", "method", "concluded_on"] as const;
const METHOD_VALUES = ["einfach_elektronisch", "papier"] as const;

/** A column of the list. */
export type ContractCorrectionField = (typeof FIELD_VALUES)[number];

export type ContractCorrectionRowStatus = (typeof ROW_STATUS_VALUES)[number];

/** A value a row can change. */
export type ContractCorrectionChange = (typeof CHANGE_VALUES)[number];

/** How the contract was concluded: online or on paper. */
export type ContractCorrectionMethod = (typeof METHOD_VALUES)[number];

/** The values a correction can change, as a contract carries them. */
export interface ContractCorrectionValues {
  /** The names of the parties in their order. */
  readonly parties: readonly string[];
  /** null: not concluded, or a method this build does not know. */
  readonly method: ContractCorrectionMethod | null;
  /** The day of the conclusion; null when unknown. */
  readonly concludedOn: string | null;
  /** The office does not know the day of the conclusion. */
  readonly dateUnknown: boolean;
}

export interface ContractCorrectionProblem {
  /** undefined: a column this build does not know. */
  readonly field: ContractCorrectionField | undefined;
  readonly code: string;
}

export interface ContractCorrectionRow {
  readonly line: number;
  /** undefined: a status this build does not know. */
  readonly status: ContractCorrectionRowStatus | undefined;
  readonly contractId: string | null;
  readonly childName: string;
  readonly schoolName: string;
  /** The values the row changes, as far as this build knows them. */
  readonly changes: readonly ContractCorrectionChange[];
  readonly before: ContractCorrectionValues;
  readonly after: ContractCorrectionValues;
  readonly evidence: string;
  readonly problems: readonly ContractCorrectionProblem[];
  /** The line that names the same contract before this row. */
  readonly repeatsLine: number | null;
}

export interface ContractCorrectionRun {
  readonly encoding: string;
  readonly delimiter: string;
  readonly headers: readonly string[];
  /** Required columns the file lacks; then it has no rows. */
  readonly missing: readonly ContractCorrectionField[];
  readonly fingerprint: string;
  readonly applied: boolean;
  readonly counts: {
    readonly change: number;
    readonly unchanged: number;
    readonly invalid: number;
    readonly corrected: number;
  };
  readonly rows: readonly ContractCorrectionRow[];
}

export interface ContractCorrectionLogEntry {
  readonly file: string;
  readonly accountId: string | null;
  readonly correctedAt: string;
  readonly contracts: number;
}

export interface ContractCorrectionRequest {
  readonly file: File;
  /** The fingerprint of the preview the office confirmed; only to apply. */
  readonly fingerprint?: string;
}

export interface ContractCorrectionList {
  readonly blob: Blob;
  readonly filename: string;
}

/** The values of a contract as the correction and the contract name them. */
export function correctionValuesFromBackend(
  values: WireValues,
): ContractCorrectionValues {
  return {
    parties: values.parties ?? [],
    method: knownEnum(METHOD_VALUES, values.method) ?? null,
    concludedOn: values.concluded_on,
    dateUnknown: values.date_unknown,
  };
}

/** The changed values of a row or a stored correction this build knows. */
export function correctionChangesFromBackend(
  changes: readonly string[] | null,
): ContractCorrectionChange[] {
  return (changes ?? []).flatMap((change) => {
    const known = knownEnum(CHANGE_VALUES, change);
    return known ? [known] : [];
  });
}

function mapRow(row: WireRow): ContractCorrectionRow {
  return {
    line: row.line,
    status: knownEnum(ROW_STATUS_VALUES, row.status),
    contractId: row.contract_id ?? null,
    childName: row.child_name,
    schoolName: row.school_name,
    changes: correctionChangesFromBackend(row.changes),
    before: correctionValuesFromBackend(row.before),
    after: correctionValuesFromBackend(row.after),
    evidence: row.evidence,
    problems: (row.problems ?? []).map((problem) => ({
      field: knownEnum(FIELD_VALUES, problem.field),
      code: problem.code,
    })),
    repeatsLine: row.repeats_line ?? null,
  };
}

function mapRun(run: WireRun): ContractCorrectionRun {
  return {
    encoding: run.encoding,
    delimiter: run.delimiter,
    headers: run.headers ?? [],
    missing: (run.missing ?? []).flatMap((field) => {
      const known = knownEnum(FIELD_VALUES, field);
      return known ? [known] : [];
    }),
    fingerprint: run.fingerprint ?? "",
    applied: run.applied,
    counts: {
      change: run.counts.change,
      unchanged: run.counts.unchanged,
      invalid: run.counts.invalid,
      corrected: run.counts.corrected,
    },
    rows: (run.rows ?? []).map(mapRow),
  };
}

async function postCorrection(
  preview: boolean,
  request: ContractCorrectionRequest,
): Promise<ContractCorrectionRun> {
  const form = new FormData();
  form.append("file", request.file);
  if (request.fingerprint) {
    form.append("fingerprint", request.fingerprint);
  }
  const data = await (preview
    ? bffJson("org", "POST /traeger/contract-corrections/preview", {
        body: form,
      })
    : bffJson("org", "POST /traeger/contract-corrections/", { body: form }));
  return mapRun(data);
}

/** Reads the filled-in list and answers every row; stores nothing. */
export function previewContractCorrections(
  request: ContractCorrectionRequest,
): Promise<ContractCorrectionRun> {
  return postCorrection(true, request);
}

/** Changes the contracts of the changing rows of the confirmed preview. */
export function applyContractCorrections(
  request: ContractCorrectionRequest,
): Promise<ContractCorrectionRun> {
  return postCorrection(false, request);
}

/** The list of every imported contract to fill in, as a CSV file. */
export async function downloadContractCorrectionList(): Promise<ContractCorrectionList> {
  const response = await transportFetch(`${CORRECTIONS_PATH}/list`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    throw await apiErrorFromResponse(
      response,
      `Request failed (${response.status})`,
    );
  }
  return {
    blob: await response.blob(),
    filename:
      filenameFromDisposition(response) ?? "vertragsangaben-nachpflegen.csv",
  };
}

/** The corrections of the Träger, newest first. */
export async function fetchContractCorrectionLog(): Promise<
  ContractCorrectionLogEntry[]
> {
  const entries = await bffJson("org", "GET /traeger/contract-corrections/");
  return (entries ?? []).map((entry) => ({
    file: entry.file,
    accountId: entry.account_id,
    correctedAt: entry.corrected_at,
    contracts: entry.contracts,
  }));
}
