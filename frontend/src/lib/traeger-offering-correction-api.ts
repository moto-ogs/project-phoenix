/**
 * Client of the correction of the modules imported contracts book (#7764):
 * the preview of a CSV file that names, per contract, weekday and booked
 * module the module it belongs to, and the correction of the ready
 * contracts. The file travels as multipart form like the contract import;
 * the backend reads it in memory and never stores it.
 * Backend int64 IDs leave here as strings; calendar dates stay "YYYY-MM-DD".
 */

import { apiErrorFromResponse, transportFetch } from "./api-error";
import { knownEnum } from "./contract/known-enum";
import type {
  OfferingCorrection as WireResult,
  OfferingCorrectionContract as WireContract,
} from "./contract/traeger-contract-imports.generated";
import { readJson } from "./traeger-api";

const CORRECTIONS_PATH = "/api/traeger/contract-imports/offering-corrections";

/** Largest file the backend reads, in bytes (same limit as the import). */
export const MAX_OFFERING_CORRECTION_FILE_BYTES = 2 * 1024 * 1024;

// Go does not register these sets; the contract types them as string. A value
// this build does not know stays undefined instead of passing as a known one.
const FIELD_VALUES = [
  "contract",
  "weekday",
  "current_offering",
  "target_offering",
] as const;
const STATUS_VALUES = [
  "ready",
  "unchanged",
  "held",
  "invalid",
  "corrected",
] as const;

export type OfferingCorrectionField = (typeof FIELD_VALUES)[number];

export type OfferingCorrectionStatus = (typeof STATUS_VALUES)[number];

export interface OfferingCorrectionProblem {
  readonly line: number;
  /** undefined: a field this build does not know. */
  readonly field: OfferingCorrectionField | undefined;
  readonly code: string;
}

/** One booked module of a contract and the module it goes to. */
interface OfferingCorrectionChange {
  /** "mon" … "sun". */
  readonly weekdays: readonly string[];
  readonly from: string;
  /** "" while the office has not decided the target yet. */
  readonly to: string;
}

export interface OfferingCorrectionContract {
  /** The contract as the file names it. */
  readonly reference: string;
  /** First line of the contract in the file. */
  readonly line: number;
  readonly contractId: string | null;
  readonly schoolName: string;
  readonly childFirstName: string;
  readonly childLastName: string;
  /** undefined: a status this build does not know. */
  readonly status: OfferingCorrectionStatus | undefined;
  /** First day of the new version; null without one. */
  readonly effectiveFrom: string | null;
  /** Number of the new version; null without one. */
  readonly versionNumber: number | null;
  readonly changes: readonly OfferingCorrectionChange[];
  readonly problems: readonly OfferingCorrectionProblem[];
  /** Notes that hold nothing back: "start_moved", "end_time_differs". */
  readonly hints: readonly string[];
}

interface OfferingCorrectionCounts {
  readonly ready: number;
  readonly unchanged: number;
  readonly held: number;
  readonly invalid: number;
  readonly corrected: number;
}

export interface OfferingCorrectionResult {
  readonly encoding: string;
  readonly delimiter: string;
  readonly headers: readonly string[];
  /** Columns the file lacks; with any, `contracts` is empty. */
  readonly missingColumns: readonly OfferingCorrectionField[];
  /** The day the corrections hold from, "YYYY-MM-DD". */
  readonly effectiveFrom: string;
  readonly fingerprint: string;
  readonly applied: boolean;
  readonly counts: OfferingCorrectionCounts;
  readonly contracts: readonly OfferingCorrectionContract[];
}

export interface OfferingCorrectionRequest {
  readonly file: File;
  /** The day the corrections hold from, "YYYY-MM-DD": today or later. */
  readonly effectiveFrom: string;
  /** The fingerprint of the preview the office confirmed; only to apply. */
  readonly fingerprint?: string;
}

function mapContract(contract: WireContract): OfferingCorrectionContract {
  return {
    reference: contract.reference,
    line: contract.line,
    contractId: contract.contract_id || null,
    schoolName: contract.school_name,
    childFirstName: contract.child_first_name,
    childLastName: contract.child_last_name,
    status: knownEnum(STATUS_VALUES, contract.status),
    effectiveFrom: contract.effective_from,
    versionNumber: contract.version_number || null,
    changes: (contract.changes ?? []).map((change) => ({
      weekdays: change.weekdays ?? [],
      from: change.from,
      to: change.to,
    })),
    problems: (contract.problems ?? []).map((problem) => ({
      line: problem.line,
      field: knownEnum(FIELD_VALUES, problem.field),
      code: problem.code,
    })),
    hints: contract.hints ?? [],
  };
}

function mapResult(
  result: WireResult,
  requested: string,
): OfferingCorrectionResult {
  return {
    encoding: result.encoding,
    delimiter: result.delimiter,
    headers: result.headers ?? [],
    missingColumns: (result.missing_columns ?? []).flatMap((field) => {
      const known = knownEnum(FIELD_VALUES, field);
      return known ? [known] : [];
    }),
    // The backend answers the day it checked; the requested one otherwise.
    effectiveFrom: result.effective_from ?? requested,
    fingerprint: result.fingerprint ?? "",
    applied: result.applied,
    counts: {
      ready: result.counts.ready,
      unchanged: result.counts.unchanged,
      held: result.counts.held,
      invalid: result.counts.invalid,
      corrected: result.counts.corrected,
    },
    contracts: (result.contracts ?? []).map(mapContract),
  };
}

async function postCorrection(
  path: string,
  request: OfferingCorrectionRequest,
): Promise<OfferingCorrectionResult> {
  const form = new FormData();
  form.append("file", request.file);
  form.append("effective_from", request.effectiveFrom);
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
  return mapResult((data as { data: WireResult }).data, request.effectiveFrom);
}

/** Reads the file and answers every contract it names; stores nothing. */
export function previewOfferingCorrection(
  request: OfferingCorrectionRequest,
): Promise<OfferingCorrectionResult> {
  return postCorrection(`${CORRECTIONS_PATH}/preview`, request);
}

/** Gives every ready contract a new version with the target modules. */
export function applyOfferingCorrection(
  request: OfferingCorrectionRequest,
): Promise<OfferingCorrectionResult> {
  return postCorrection(CORRECTIONS_PATH, request);
}
