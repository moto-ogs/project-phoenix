/**
 * Client of the enrollments the Träger office adds afterwards for the
 * children of imported contracts (#7760, ADR 0309 section 4): the preview of
 * one school, the run that takes the confirmed preview, and the way back that
 * takes the binding of one contract off again. Backend int64 IDs leave here
 * as strings; calendar dates stay "YYYY-MM-DD".
 */

import { bffJson } from "~/lib/bff-fetch";
import { knownEnum } from "./contract/known-enum";
import type * as enrollmentsContract from "./contract/traeger-contract-enrollments.generated";

// Go does not register these sets; the contract types them as string. A value
// this build does not know stays undefined instead of passing as a known one.
const STATUS_VALUES = [
  "ready",
  "done",
  "unlinked",
  "held",
  "stuck",
  "changed",
] as const;
const ACTION_VALUES = ["enroll", "bind"] as const;
// The reasons of the plan (carecontract.EnrollmentReason…), of the school's
// enrollment (enrollment.ContractEnrollment…) and the workflow's own
// `changed`, in one set: a row carries one of them.
const REASON_VALUES = [
  // Plan of Care Contract.
  "contract_not_active",
  "not_begun",
  "offering_gone",
  "two_phases",
  "phase_not_begun",
  "phase_ended",
  "fixed_days",
  "day_unavailable",
  "end_time",
  "bookings_differ",
  "care_ends",
  "has_application",
  "follows_contract",
  "offering_inactive",
  "planned_change",
  // The school's enrollment.
  "student_missing",
  "student_inactive",
  "without_care_place",
  "birth_date_missing",
  "phase_missing",
  "offering_phase",
  "booking_window",
  "care_offerings_off",
  "care_ends_earlier",
  "window_too_short",
  "enrolled_elsewhere",
  // The workflow: the application is no longer what the plan proved.
  "changed",
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

/** What a row says about an imported contract (ADR 0309 section 4). */
type EnrollmentRowStatus = (typeof STATUS_VALUES)[number];

/** What a ready row does, and what a run did for a done row. */
type EnrollmentRowAction = (typeof ACTION_VALUES)[number];

export type EnrollmentReason = (typeof REASON_VALUES)[number];

export type EnrollmentWeekday = (typeof WEEKDAY_VALUES)[number];

/** One module the child books, with its weekdays and end times. */
export interface EnrollmentBooking {
  readonly careOfferingId: string;
  readonly moduleName: string;
  /** The weekdays the booking holds; unknown values left out. */
  readonly days: readonly EnrollmentWeekday[];
  /** First day, "YYYY-MM-DD"; null when the backend names none. */
  readonly validFrom: string | null;
  /** First day it no longer holds (half open); null without an end. */
  readonly validUntil: string | null;
  /** End time "HH:MM" per weekday. */
  readonly endTimes: Readonly<Partial<Record<EnrollmentWeekday, string>>>;
}

/** A later version of the contract and the bookings it brings. */
interface EnrollmentChange {
  readonly effectiveFrom: string | null;
  readonly bookings: readonly EnrollmentBooking[];
}

/** The child record as the school has it. */
interface EnrollmentChildRecord {
  readonly studentId: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly birthDate: string | null;
}

export interface EnrollmentRow {
  readonly contractId: string;
  /** undefined: a status this build does not know. */
  readonly status: EnrollmentRowStatus | undefined;
  /** undefined: none, or a reason this build does not know. */
  readonly reason: EnrollmentReason | undefined;
  readonly action: EnrollmentRowAction | undefined;
  /** The child as the newest version of the contract names it. */
  readonly contractChild: {
    readonly firstName: string;
    readonly lastName: string;
  };
  /** null for a contract without a child record, or one the school no longer has. */
  readonly student: EnrollmentChildRecord | null;
  readonly phaseName: string;
  readonly bookings: readonly EnrollmentBooking[];
  readonly changes: readonly EnrollmentChange[];
  /**
   * The enrollment the contract is or would be bound to, the one that holds
   * the row back, or the silent enrollment of a stuck row.
   */
  readonly requestChildId: string | null;
  /** The earlier imported contract of the child (reason follows_contract). */
  readonly followsContractId: string | null;
}

export interface EnrollmentCounts {
  readonly ready: number;
  readonly done: number;
  readonly unlinked: number;
  readonly held: number;
  readonly stuck: number;
  readonly changed: number;
}

export interface EnrollmentPreview {
  readonly schoolId: string;
  /** The state the office confirms; the run takes the rows only with it. */
  readonly fingerprint: string;
  readonly counts: EnrollmentCounts;
  readonly rows: readonly EnrollmentRow[];
}

export interface EnrollmentRun {
  readonly schoolId: string;
  /** The run enrolled at least one child or bound at least one contract. */
  readonly changed: boolean;
  readonly counts: EnrollmentCounts;
  readonly rows: readonly EnrollmentRow[];
}

function mapBooking(
  booking: enrollmentsContract.EnrollmentBooking,
): EnrollmentBooking {
  const endTimes: Partial<Record<EnrollmentWeekday, string>> = {};
  for (const [day, time] of Object.entries(booking.end_times ?? {})) {
    const known = knownEnum(WEEKDAY_VALUES, day);
    if (known) endTimes[known] = time;
  }
  return {
    careOfferingId: booking.care_offering_id,
    moduleName: booking.module_name,
    days: (booking.days ?? []).flatMap((day) => {
      const known = knownEnum(WEEKDAY_VALUES, day);
      return known ? [known] : [];
    }),
    validFrom: booking.valid_from,
    validUntil: booking.valid_until,
    endTimes,
  };
}

function mapRow(row: enrollmentsContract.EnrollmentRow): EnrollmentRow {
  const student = row.student;
  return {
    contractId: row.contract_id,
    status: knownEnum(STATUS_VALUES, row.status),
    reason: knownEnum(REASON_VALUES, row.reason),
    action: knownEnum(ACTION_VALUES, row.action),
    contractChild: {
      firstName: row.contract_child.first_name,
      lastName: row.contract_child.last_name,
    },
    student: student
      ? {
          studentId: student.student_id,
          firstName: student.first_name,
          lastName: student.last_name,
          birthDate: student.birth_date ?? null,
        }
      : null,
    phaseName: row.phase_name,
    bookings: (row.bookings ?? []).map(mapBooking),
    changes: (row.changes ?? []).map((change) => ({
      effectiveFrom: change.effective_from,
      bookings: (change.bookings ?? []).map(mapBooking),
    })),
    requestChildId: row.request_child_id ?? null,
    followsContractId: row.follows_contract_id ?? null,
  };
}

function mapCounts(
  counts: enrollmentsContract.EnrollmentRowCounts,
): EnrollmentCounts {
  return {
    ready: counts.ready,
    done: counts.done,
    unlinked: counts.unlinked,
    held: counts.held,
    stuck: counts.stuck,
    changed: counts.changed,
  };
}

/**
 * What a run would do for every imported contract of the school. Enrolls
 * nobody; the read stands in the access log of the school.
 */
export async function previewContractEnrollments(
  schoolId: string,
): Promise<EnrollmentPreview> {
  const data = await bffJson(
    "org",
    "POST /traeger/contract-enrollments/preview",
    { body: { school_id: schoolId } },
  );
  return {
    schoolId: data.school_id,
    fingerprint: data.fingerprint,
    counts: mapCounts(data.counts),
    rows: (data.rows ?? []).map(mapRow),
  };
}

/**
 * Enrolls and binds the rows the confirmed preview showed as ready. A
 * preview that no longer holds is `care_contract.enrollment_preview_changed`
 * (409): nothing is written, the page reads the preview again.
 */
export async function runContractEnrollments(
  schoolId: string,
  fingerprint: string,
): Promise<EnrollmentRun> {
  const data = await bffJson("org", "POST /traeger/contract-enrollments/", {
    body: { school_id: schoolId, fingerprint },
  });
  return {
    schoolId: data.school_id,
    changed: data.changed,
    counts: mapCounts(data.counts),
    rows: (data.rows ?? []).map(mapRow),
  };
}

/**
 * Takes the binding to the enrollment `requestChildId`, the one the office
 * saw, off an imported contract. The enrollment stays at the school. A
 * contract bound otherwise by now is
 * `care_contract.enrollment_binding_changed` (409) and keeps its binding.
 */
export async function unbindContractEnrollment(
  contractId: string,
  requestChildId: string,
): Promise<void> {
  await bffJson("org", "DELETE /traeger/contract-enrollments/{contractId}", {
    params: { contractId },
    query: { request_child_id: requestChildId },
  });
}
