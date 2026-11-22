import type * as studentsContract from "./contract/students.generated";
/**
 * The parents' change of the booked care of a contract's child, as the
 * Träger-Büro decides it (#5979): the open request with its modules and
 * days, and the last decision. Backend int64 IDs leave here as strings;
 * calendar dates stay "YYYY-MM-DD". Types and mapping only; the client lives
 * in care-contract-changes-api.ts.
 */

import { mapRosterImpact, type RosterImpact } from "./roster-impact";
import { knownEnum } from "./contract/known-enum";
import { requiredDay } from "./contract/required-day";
import type {
  ChangeDecisionRequest,
  ContractChanges as WireContractChanges,
} from "./contract/traeger-contract-changes.generated";
import type { Weekday } from "./traeger-care-contracts-api";

// Go does not register these sets; the contract types them as string.
const MODULE_STATE_VALUES = [
  "added",
  "removed",
  "changed",
  "unchanged",
] as const;
const WEEKDAY_VALUES = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
] as const;

type ChangeModuleState = (typeof MODULE_STATE_VALUES)[number];

/** The weekdays this build knows; an unknown one is left out. */
function knownDays(days: readonly string[] | null): Weekday[] {
  return (days ?? []).flatMap((day) => {
    const weekday = knownEnum(WEEKDAY_VALUES, day);
    return weekday ? [weekday] : [];
  });
}

/** One module of a change: what the child books now and what is asked. */
interface ContractChangeLine {
  readonly careOfferingId: string;
  readonly moduleName: string;
  /** undefined: a state this build does not know. */
  readonly state: ChangeModuleState | undefined;
  readonly beforeDays: readonly Weekday[];
  readonly afterDays: readonly Weekday[];
}

/** A change the parents asked for that nobody decided yet. */
export interface ContractChangeRequest {
  readonly id: string;
  /** Pins the request the decision is taken on. */
  readonly version: string;
  readonly submittedAt: string;
  readonly effectiveFrom: string;
  readonly parentNote: string;
  /** The parents give up every module: that is a termination. */
  readonly endsAllCare: boolean;
  readonly lines: readonly ContractChangeLine[];
}

/** The newest decided change of the child. */
export interface ContractChangeOutcome {
  readonly approved: boolean;
  readonly decidedAt: string;
  readonly effectiveFrom: string;
  readonly reason: string;
}

export interface ContractChanges {
  /** The office may decide: the contract is active. */
  readonly decidable: boolean;
  readonly pending: readonly ContractChangeRequest[];
  readonly lastDecision: ContractChangeOutcome | null;
  /** The school asks for a reason on an approval too. */
  readonly reasonRequired: boolean;
  readonly rosterImpact?: RosterImpact | null;
}

export interface ContractChangeDecision {
  readonly approve: boolean;
  readonly reason: string;
  /** The day the change takes effect; only with an approval. */
  readonly effectiveFrom?: string;
  readonly expectedVersion: string;
}

export function contractChangesFromBackend(
  data: WireContractChanges,
): ContractChanges {
  return {
    decidable: data.decidable,
    reasonRequired: data.reason_required,
    rosterImpact: mapRosterImpact(data.roster_impact),
    pending: (data.pending ?? []).map((request) => ({
      id: request.id,
      version: request.version,
      submittedAt: request.submitted_at,
      effectiveFrom: requiredDay(
        request.effective_from,
        "change_request.effective_from",
      ),
      parentNote: request.parent_note,
      endsAllCare: request.ends_all_care,
      lines: (request.lines ?? []).map((line) => ({
        careOfferingId: line.care_offering_id,
        moduleName: line.module_name,
        state: knownEnum(MODULE_STATE_VALUES, line.state),
        beforeDays: knownDays(line.before_days),
        afterDays: knownDays(line.after_days),
      })),
    })),
    lastDecision: data.last_decision
      ? {
          approved: data.last_decision.approved,
          decidedAt: data.last_decision.decided_at,
          effectiveFrom: requiredDay(
            data.last_decision.effective_from,
            "change_outcome.effective_from",
          ),
          reason: data.last_decision.reason,
        }
      : null,
  };
}

export function decisionBody(
  decision: ContractChangeDecision,
): ChangeDecisionRequest {
  return {
    approve: decision.approve,
    reason: decision.reason.trim(),
    effective_from: decision.approve ? (decision.effectiveFrom ?? null) : null,
    expected_version: decision.expectedVersion,
  };
}

/** Match the existing review presentation, including modules with fixed days. */
export function contractChangeReview(request: ContractChangeRequest) {
  const dayLabels: Record<Weekday, string> = {
    mon: "Mo",
    tue: "Di",
    wed: "Mi",
    thu: "Do",
    fri: "Fr",
    sat: "Sa",
    sun: "So",
  };
  const booked = (days: readonly Weekday[]) =>
    days.length
      ? days.map((day) => dayLabels[day]).join(", ")
      : "Gebucht (feste Tage)";
  const diff: studentsContract.OfferingRequestDiffResponse[] = request.lines
    .filter((line) => line.state !== "unchanged")
    .map((line) => ({
      offering_id: line.careOfferingId,
      label: line.moduleName,
      old: line.state === "added" ? "Nicht gebucht" : booked(line.beforeDays),
      new: line.state === "removed" ? "Nicht gebucht" : booked(line.afterDays),
    }));
  const unchanged = request.lines
    .filter((line) => line.state === "unchanged")
    .map((line) => ({
      offering_id: line.careOfferingId,
      label: line.moduleName,
      days: booked(line.afterDays),
    }));
  return { id: request.id, diff, unchanged, note: request.parentNote };
}
