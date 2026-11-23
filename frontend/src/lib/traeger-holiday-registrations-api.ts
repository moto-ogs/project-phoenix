import { bffFile, bffJson } from "~/lib/bff-fetch";
/**
 * Client of the review of the holiday registrations in the Träger portal
 * (#4663): the list of a holiday period with its filters, one registration
 * with its history, the changes of the Träger-Büro and the export as CSV or
 * Excel. Talks to the BFF routes under
 * /api/traeger/holiday-periods/{id}/registrations. Backend int64 IDs leave
 * here as strings.
 */

import {
  type DebtorNumberFormat,
  debtorNumberFormatOf,
} from "~/lib/debtor-number-format";
import {
  holidayFormVersionFromContract,
  type HolidayFormVersion,
} from "~/lib/holiday-form-field";
import { knownEnum, requiredEnum } from "./contract/known-enum";
import { requiredDay } from "./contract/required-day";
import type * as sharedContract from "./contract/shared.generated";
import type * as traegerHolidayContributionsContract from "./contract/traeger-holiday-contributions.generated";
import type * as traegerHolidayPeriodsContract from "./contract/traeger-holiday-periods.generated";
import { knownMailOutcome, type MailOutcome } from "./email-delivery-status";
import { filenameFromDisposition } from "./file-download";
import {
  consentTextsFromBackend,
  type HolidayConsentTexts,
} from "./holiday-consent-texts";

export type HolidayRegistrationStatus = "received" | "confirmed" | "cancelled";

/**
 * The changes the Träger-Büro makes with one action. A confirmation freezes
 * the contribution and a cancellation computes the sibling group again, so
 * both go through the Elternabrechnung (#4664, #5662,
 * `confirmHolidayRegistration` and `cancelHolidayRegistration` in
 * traeger-contributions-api).
 */
export type HolidayRegistrationAction = "freeze" | "reopen";

const EVENT_ACTIONS = [
  "freeze",
  "reopen",
  "confirm",
  "cancel",
  "rebook",
  "debtor_number",
  "edit",
  "proof_upload",
  "sibling_merge",
  "sibling_split",
  "sibling_cancel",
  "promote",
  "wish",
  "allocate",
  "criteria_check",
] as const satisfies readonly string[];

type HolidayRegistrationEventAction = (typeof EVENT_ACTIONS)[number];

const STATUSES: readonly HolidayRegistrationStatus[] = [
  "received",
  "confirmed",
  "cancelled",
];
const PLACEMENTS: readonly HolidayPlacement[] = [
  "placed",
  "waitlisted",
  "pending",
];
const DECIDED_PLACEMENTS = ["placed", "waitlisted"] as const;
const WISHES = ["yes", "no"] as const;
const WISH_SOURCES = ["account", "office"] as const;
const CONTACT_KINDS: readonly HolidayRegistrationContact["kind"][] = [
  "emergency",
  "pickup",
];
const CHECK_VALUES = ["yes", "no"] as const;
const STATED_VALUES = ["yes", "no", "unknown"] as const;
const CRITERION_SCOPES = ["family", "child"] as const;
const MAIL_KINDS: readonly HolidayRegistrationMailKind[] = [
  "holiday_registration_received",
  "holiday_registration_accepted",
  "holiday_place_granted",
  "holiday_closure_notice",
  "holiday_parent_account_offer",
];
const MAIL_STATES: readonly HolidayRegistrationMailState[] = [
  "failed",
  "blocked",
  "unknown",
  "complained",
  "unsubscribed",
];
const BOOKING_UNITS = ["week", "day"] as const;

/** The filter of the list and the export. Empty values match everything. */
export interface HolidayRegistrationFilter {
  readonly status: HolidayRegistrationStatus | "";
  /** A school ID, "guest" for holiday guests, or empty for all. */
  readonly school: string;
  readonly weekId: string;
  /** A time model name; time models are per week. */
  readonly timeModel: string;
  /**
   * The holiday care wish (#4703): "check" for children the office still
   * has to check, "yes" or "no", empty for all.
   */
  readonly wish: HolidayWishFilter;
}

export type HolidayWishFilter = "" | "check" | "yes" | "no";

export const EMPTY_HOLIDAY_REGISTRATION_FILTER: HolidayRegistrationFilter = {
  status: "",
  school: "",
  weekId: "",
  timeModel: "",
  wish: "",
};

/** What is known about a child's holiday care wish (#4703). */
type HolidayWish = "yes" | "no" | "";
/** Where the known wish comes from: the parent's account or the office. */
type HolidayWishSource = "account" | "office" | "";

/**
 * Whether a booking has a place in its week or waits for one (#4699). In a
 * period by criteria a booking stays "pending" until the office decides
 * (#4700); it is neither billed nor reported to the OGS.
 */
type HolidayPlacement = "placed" | "waitlisted" | "pending";

interface HolidayRegistrationBooking {
  readonly weekId: string;
  /** Calendar dates "YYYY-MM-DD". */
  readonly weekStartsOn: string;
  readonly weekEndsOn: string;
  readonly hostSchoolId: string;
  readonly timeModelId: string;
  readonly timeModelName: string;
  readonly placement: HolidayPlacement;
  /** Place on the waiting list of the week, from 1; null with a place. */
  readonly waitlistPosition: number | null;
  /** When the booking moved up from the waiting list; null otherwise. */
  readonly promotedAt: string | null;
  /** The booked days of a week by days (#4701); empty for a whole week. */
  readonly days?: readonly string[];
  /**
   * The child eats lunch on the care days of the booking (#5631), with the
   * number of lunches and their price now in cent.
   */
  readonly lunch?: boolean;
  readonly lunchDays?: number;
  readonly lunchPriceCents?: number;
}

export interface HolidayRegistrationChild {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly birthDate: string;
  /** Null for a holiday guest. */
  readonly homeSchoolId: string | null;
  readonly guestSchoolName: string;
  readonly bookings: readonly HolidayRegistrationBooking[];
  /** Other registrations of the period with the same child. */
  readonly duplicateRegistrationIds: readonly string[];
  /** The child's holiday care wish, empty when unknown (#4703). */
  readonly holidayWish: HolidayWish;
  readonly holidayWishSource: HolidayWishSource;
  /** The office still has to check the wish of this child. */
  readonly holidayWishCheck: boolean;
}

/** Which mail of a registration to the parents (#6737, #6976). */
export type HolidayRegistrationMailKind =
  | "holiday_registration_received"
  | "holiday_registration_accepted"
  | "holiday_place_granted"
  | "holiday_closure_notice"
  | "holiday_parent_account_offer";

/**
 * One mail of a registration with what became of it, in Delivery's words
 * (#6976). A Träger keeps no address list, so no mail carries a mark.
 */
interface HolidayRegistrationMail {
  readonly kind: HolidayRegistrationMailKind;
  readonly outcome: MailOutcome;
  /** When the mail came about; two mails of one kind stay apart. */
  readonly createdAt: string | null;
}

/**
 * What became of a mail that did not reach the parents (#6737): moto gave it
 * up or it came back, the address is blocked, or the outcome is unknown.
 */
type HolidayRegistrationMailState =
  | "failed"
  | "blocked"
  | "unknown"
  // The mail arrived; the parents reported it or unsubscribed (#6976).
  | "complained"
  | "unsubscribed";

export interface HolidayRegistrationMailProblem {
  readonly kind: HolidayRegistrationMailKind;
  readonly state: HolidayRegistrationMailState;
}

export interface HolidayRegistrationSummary {
  readonly id: string;
  readonly status: HolidayRegistrationStatus;
  readonly frozen: boolean;
  readonly submittedAt: string;
  readonly guardianFirstName: string;
  readonly guardianLastName: string;
  readonly guardianEmail: string;
  readonly guardianPhone: string;
  /** The parents state that they receive benefits (#4664). */
  readonly benefitsDeclared: boolean;
  /**
   * The family's number in the finance system of the Träger, entered at the
   * confirmation (#5621); empty without one.
   */
  readonly debtorNumber: string;
  /**
   * The day moto deletes the registration and the day its health information
   * goes (#6691), as "YYYY-MM-DD"; null for a period without weeks.
   */
  readonly deletesOn: string | null;
  readonly healthDeletesOn: string | null;
  /** Mails that did not reach the parents (#6737, #6976). */
  readonly mailProblems: readonly HolidayRegistrationMailProblem[];
  readonly children: readonly HolidayRegistrationChild[];
}

export interface HolidayRegistrationList {
  readonly registrations: readonly HolidayRegistrationSummary[];
  /** Registrations of the whole period, whatever the filter. */
  readonly total: number;
  readonly statusCounts: Readonly<Record<HolidayRegistrationStatus, number>>;
}

/** The Träger right that opens the health information (#4722). */
export const TRAEGER_HEALTH_RIGHT = "traeger_health:read";

/** The health information of one child of a registration (#4722). */
export interface HolidayRegistrationHealth {
  readonly childId: string;
  readonly allergies: string;
  readonly medication: string;
  readonly healthNotes: string;
  /** Answers to the child questions marked as health information. */
  readonly answers: Readonly<Record<string, unknown>>;
}

/**
 * The health information of one registration, read apart from the detail
 * and only with the right „Gesundheitsangaben sehen“ (#4722).
 */
export interface HolidayRegistrationHealthDetail {
  /** Answers to the family questions marked as health information. */
  readonly answers: Readonly<Record<string, unknown>>;
  readonly children: readonly HolidayRegistrationHealth[];
}

export interface HolidayRegistrationContact {
  readonly kind: "emergency" | "pickup";
  readonly name: string;
  readonly phone: string;
  readonly relationship: string;
}

export interface HolidayBookingChange {
  readonly weekId: string;
  readonly timeModelId: string;
  /** The days of a week by days (#4701). */
  readonly days?: readonly string[];
  /** The lunch of the booking (#5631). */
  readonly lunch?: boolean;
}

export interface HolidayRegistrationEvent {
  readonly action: HolidayRegistrationEventAction;
  readonly occurredAt: string;
  /** Status before a confirmation or cancellation. */
  readonly from: HolidayRegistrationStatus | "";
  /** The rebooked child and its bookings before and after. */
  readonly childId: string;
  readonly before: readonly HolidayBookingChange[];
  readonly after: readonly HolidayBookingChange[];
  /**
   * The debtor number before and after, when a confirmation entered it or a
   * change changed it (#5621); null otherwise.
   */
  readonly debtorNumber: {
    readonly before: string;
    readonly after: string;
  } | null;
  /** The fields an edit changed, as paths like "guardian.phone" (#5629). */
  readonly fields: readonly string[];
  /** The other registrations of a sibling merge or split (#5628). */
  readonly siblings: readonly string[];
  /** The office's decision on the holiday care wish (#4703). */
  readonly wish: HolidayWish;
  /** The weeks an allocation decided (#4700). */
  readonly weekIds?: readonly string[];
  /** What an allocation decided; absent for other actions. */
  readonly placement?: "placed" | "waitlisted";
  /** Why the office differed from the proposal; empty otherwise. */
  readonly reason?: string;
  /** The checks of the criteria the office changed (#4700). */
  readonly checks?: readonly HolidayCriterionCheck[];
}

/** "yes"/"no" as the office checked it, null for not checked. */
export type HolidayCriterionCheckValue = "yes" | "no" | null;

/** One check of a criterion by the office (#4700). */
export interface HolidayCriterionCheck {
  readonly criterionId: string;
  /** Null for a criterion of the family. */
  readonly childId: string | null;
  readonly checked: HolidayCriterionCheckValue;
}

/**
 * The answer to one criterion in a registration (#4700): what the parents
 * said and what the office checked. The office's check counts first.
 */
export interface HolidayRegistrationCriterion {
  readonly criterionId: string;
  readonly name: string;
  readonly question: string;
  readonly scope: "family" | "child";
  /** Null for a criterion of the family. */
  readonly childId: string | null;
  readonly stated: "yes" | "no" | "unknown";
  readonly checked: HolidayCriterionCheckValue;
  readonly checkedAt: string | null;
}

/** A proof of benefits the parents uploaded with the registration (#5238). */
interface HolidayRegistrationProof {
  readonly id: string;
  readonly filename: string;
  readonly sizeBytes: number;
  readonly contentType: string;
  readonly uploadedAt: string;
}

export interface HolidayRegistrationDetail extends HolidayRegistrationSummary {
  /**
   * Postal address of the parent, when the form asked for it (#5625). Only
   * the detail and the export name it, the list does not.
   */
  readonly guardianAddress: {
    readonly street: string;
    readonly postalCode: string;
    readonly city: string;
  } | null;
  readonly secondGuardian: {
    readonly firstName: string;
    readonly lastName: string;
    readonly email: string;
    readonly phone: string;
  } | null;
  readonly contacts: readonly HolidayRegistrationContact[];
  readonly privacyConsentAt: string;
  readonly healthConsentAt: string | null;
  readonly bindingConfirmedAt: string | null;
  /**
   * The declaration (#5626): when the parent confirmed the custody and the
   * name typed to give the declarations; a registration before has neither.
   */
  readonly custodyConfirmedAt: string | null;
  readonly declarationName: string;
  /** The version of the consent texts; 0 before #4722. */
  readonly consentVersion: number;
  /** The German texts of that version; null when they are not kept. */
  readonly consentTexts: HolidayConsentTexts | null;
  /** Only the detail names the proofs; list and export never do. */
  readonly benefitsProofs: readonly HolidayRegistrationProof[];
  readonly history: readonly HolidayRegistrationEvent[];
  /**
   * The form version the parents answered (#5198); its labels name the
   * answers, also after a later change of the form.
   */
  readonly legalAcceptances?: Readonly<Record<string, string>>;
  readonly form: HolidayFormVersion;
  /** Answers to the family questions, by key. */
  readonly answers: Readonly<Record<string, unknown>>;
  /** Answers to the questions per child, by child ID and key. */
  readonly childAnswers: Readonly<
    Record<string, Readonly<Record<string, unknown>>>
  >;
  /** Only in a period by criteria (#4700); empty otherwise. */
  readonly criteria?: readonly HolidayRegistrationCriterion[];
  /** Every mail to the parents, oldest first (#6976). */
  readonly mails?: readonly HolidayRegistrationMail[];
}

/** The days of a list the decoder may leave null, without the empty ones. */
function presentDays(days: readonly (string | null)[] | null | undefined) {
  return (days ?? []).filter((day): day is string => day !== null);
}

/**
 * A registration whose status or placement this build does not know drops
 * out of the list (#2353): the actions of the office and the bulk
 * confirmation decide on both, and a rebooking sends every booking back.
 */
function knownRegistration(
  registration: traegerHolidayPeriodsContract.HolidayRegistrationSummary,
): boolean {
  return (
    knownEnum(STATUSES, registration.status) !== undefined &&
    (registration.children ?? []).every((child) =>
      (child.bookings ?? []).every(
        (booking) => knownEnum(PLACEMENTS, booking.placement) !== undefined,
      ),
    )
  );
}

function bookingFromBackend(
  booking: sharedContract.HolidayRegistrationBooking,
): HolidayRegistrationBooking {
  const days = presentDays(booking.days);
  return {
    weekId: booking.week_id,
    weekStartsOn: requiredDay(
      booking.week_starts_on,
      "holiday_registration_booking.week_starts_on",
    ),
    weekEndsOn: requiredDay(
      booking.week_ends_on,
      "holiday_registration_booking.week_ends_on",
    ),
    hostSchoolId: booking.host_school_id,
    timeModelId: booking.time_model_id,
    timeModelName: booking.time_model_name,
    placement: requiredEnum(
      PLACEMENTS,
      booking.placement,
      "holiday_registration_booking.placement",
    ),
    waitlistPosition: booking.waitlist_position ?? null,
    promotedAt: booking.promoted_at ?? null,
    ...(days.length > 0 ? { days } : {}),
    lunch: booking.lunch,
    lunchDays: booking.lunch_days,
    lunchPriceCents: booking.lunch_price_cents,
  };
}

function childFromBackend(
  child: sharedContract.HolidayRegistrationChild,
): HolidayRegistrationChild {
  return {
    id: child.id,
    firstName: child.first_name,
    lastName: child.last_name,
    birthDate: requiredDay(
      child.birth_date,
      "holiday_registration_child.birth_date",
    ),
    homeSchoolId: child.home_school_id,
    guestSchoolName: child.guest_school_name,
    bookings: (child.bookings ?? []).map(bookingFromBackend),
    duplicateRegistrationIds: child.duplicate_registration_ids ?? [],
    // Go writes an empty wish when it is unknown; the office decides it
    // itself, nothing sends this value back.
    holidayWish: knownEnum(WISHES, child.holiday_wish) ?? "",
    holidayWishSource: knownEnum(WISH_SOURCES, child.holiday_wish_source) ?? "",
    holidayWishCheck: child.holiday_wish_check,
  };
}

/** Mail problems of a kind or state this build does not know drop out. */
function mailProblemsFromBackend(
  problems:
    readonly sharedContract.HolidayRegistrationMailProblem[] | null | undefined,
): HolidayRegistrationMailProblem[] {
  return (problems ?? []).flatMap((problem) => {
    const kind = knownEnum(MAIL_KINDS, problem.kind);
    const state = knownEnum(MAIL_STATES, problem.state);
    return kind && state ? [{ kind, state }] : [];
  });
}

/** Only for a registration `knownRegistration` let through. */
function summaryFromBackend(
  registration: traegerHolidayPeriodsContract.HolidayRegistrationSummary,
): HolidayRegistrationSummary {
  return {
    id: registration.id,
    status: requiredEnum(
      STATUSES,
      registration.status,
      "holiday_registration.status",
    ),
    frozen: registration.frozen,
    submittedAt: registration.submitted_at,
    guardianFirstName: registration.guardian_first_name,
    guardianLastName: registration.guardian_last_name,
    guardianEmail: registration.guardian_email,
    guardianPhone: registration.guardian_phone,
    benefitsDeclared: registration.benefits_declared,
    debtorNumber: registration.debtor_number,
    deletesOn: registration.deletes_on,
    healthDeletesOn: registration.health_deletes_on,
    mailProblems: mailProblemsFromBackend(registration.mail_problems),
    children: (registration.children ?? []).map(childFromBackend),
  };
}

/** A check with a value this build does not know drops out. */
function checksFromBackend(
  checks: readonly sharedContract.HolidayCriterionCheck[],
): HolidayCriterionCheck[] {
  return checks.flatMap((check) => {
    const checked =
      check.checked === null ? null : knownEnum(CHECK_VALUES, check.checked);
    if (checked === undefined) return [];
    return [
      { criterionId: check.criterion_id, childId: check.child_id, checked },
    ];
  });
}

function changesFromBackend(
  changes: readonly sharedContract.HolidayBookingChange[] | undefined,
): HolidayBookingChange[] {
  return (changes ?? []).map((change) => {
    const days = presentDays(change.days);
    return {
      weekId: change.week_id,
      timeModelId: change.time_model_id,
      ...(days.length > 0 ? { days } : {}),
      ...(change.lunch ? { lunch: true } : {}),
    };
  });
}

/**
 * The history. An entry this build cannot name drops out (#2353): an
 * unknown action, a decision or a wish it would have to guess.
 */
function historyFromBackend(
  history: sharedContract.HolidayRegistrationDetail["history"],
): HolidayRegistrationEvent[] {
  return (history ?? []).flatMap((event) => {
    const action = knownEnum(EVENT_ACTIONS, event.action);
    const details = event.details;
    const placement =
      details.placement === undefined
        ? undefined
        : knownEnum(DECIDED_PLACEMENTS, details.placement);
    const wish =
      details.wish === undefined ? "" : knownEnum(WISHES, details.wish);
    if (
      !action ||
      (details.placement !== undefined && !placement) ||
      wish === undefined
    ) {
      return [];
    }
    return [
      {
        action,
        occurredAt: event.occurred_at,
        from: knownEnum(STATUSES, details.from) ?? "",
        childId: details.child_id ?? "",
        before: changesFromBackend(details.before),
        after: changesFromBackend(details.after),
        debtorNumber: details.debtor_number ?? null,
        fields: details.fields ?? [],
        siblings: details.siblings ?? [],
        wish,
        // Only an allocation and a check carry these (#4700).
        ...(details.week_ids ? { weekIds: details.week_ids } : {}),
        ...(placement ? { placement } : {}),
        ...(details.reason ? { reason: details.reason } : {}),
        ...(details.checks
          ? { checks: checksFromBackend(details.checks) }
          : {}),
      },
    ];
  });
}

/** A criterion with a scope or answer this build does not know drops out. */
function criteriaFromBackend(
  criteria: sharedContract.HolidayRegistrationDetail["criteria"],
): HolidayRegistrationCriterion[] {
  return (criteria ?? []).flatMap((criterion) => {
    const scope = knownEnum(CRITERION_SCOPES, criterion.scope);
    const stated = knownEnum(STATED_VALUES, criterion.stated);
    const checked =
      criterion.checked === null
        ? null
        : knownEnum(CHECK_VALUES, criterion.checked);
    if (!scope || !stated || checked === undefined) return [];
    return [
      {
        criterionId: criterion.criterion_id,
        name: criterion.name,
        question: criterion.question,
        scope,
        childId: criterion.child_id,
        stated,
        checked,
        checkedAt: criterion.checked_at,
      },
    ];
  });
}

/**
 * One registration. Its status, the placements and the contact kinds are
 * required (#2353): the office acts on the status, a rebooking sends every
 * booking back and a change of the contacts saves both lists whole, so a
 * value this build does not know fails the read instead of being guessed.
 */
function detailFromBackend(
  registration: sharedContract.HolidayRegistrationDetail,
): HolidayRegistrationDetail {
  return {
    ...summaryFromBackend(registration),
    guardianAddress: registration.guardian_address
      ? {
          street: registration.guardian_address.street,
          postalCode: registration.guardian_address.postal_code,
          city: registration.guardian_address.city,
        }
      : null,
    secondGuardian: registration.second_guardian
      ? {
          firstName: registration.second_guardian.first_name,
          lastName: registration.second_guardian.last_name,
          email: registration.second_guardian.email,
          phone: registration.second_guardian.phone,
        }
      : null,
    contacts: (registration.contacts ?? []).map((contact) => ({
      kind: requiredEnum(
        CONTACT_KINDS,
        contact.kind,
        "holiday_registration_contact.kind",
      ),
      name: contact.name,
      phone: contact.phone,
      relationship: contact.relationship,
    })),
    privacyConsentAt: registration.privacy_consent_at,
    healthConsentAt: registration.health_consent_at,
    bindingConfirmedAt: registration.binding_confirmed_at,
    custodyConfirmedAt: registration.custody_confirmed_at,
    declarationName: registration.declaration_name,
    consentVersion: registration.consent_version,
    consentTexts: registration.consent_texts
      ? consentTextsFromBackend(registration.consent_texts)
      : null,
    benefitsProofs: (registration.benefits_proofs ?? []).map((proof) => ({
      id: proof.id,
      filename: proof.filename,
      sizeBytes: proof.size_bytes,
      contentType: proof.content_type,
      uploadedAt: proof.uploaded_at,
    })),
    history: historyFromBackend(registration.history),
    legalAcceptances: registration.legal_acceptances ?? {},
    // The answers render along the pinned version; a question this build
    // does not know fails the read rather than hiding its answer.
    form: registration.form
      ? holidayFormVersionFromContract(
          registration.form,
          "HolidayRegistrationDetail.form",
        )
      : { legalBlocks: [], version: 0, fields: [], addressRequirement: "off" },
    answers: registration.custom_data ?? {},
    childAnswers: Object.fromEntries(
      (registration.child_custom_data ?? []).map((entry) => [
        entry.child_id,
        entry.custom_data ?? {},
      ]),
    ),
    criteria: criteriaFromBackend(registration.criteria),
    mails: (registration.mails ?? []).flatMap((mail) => {
      const kind = knownEnum(MAIL_KINDS, mail.kind);
      const outcome = knownMailOutcome(mail.outcome);
      return kind && outcome
        ? [{ kind, outcome, createdAt: mail.created_at ?? null }]
        : [];
    }),
  };
}

const registrationsPath = (periodId: string) =>
  `/api/traeger/holiday-periods/${encodeURIComponent(periodId)}/registrations`;

const registrationPath = (periodId: string, registrationId: string) =>
  `${registrationsPath(periodId)}/${encodeURIComponent(registrationId)}`;

/** Address of the proxy that opens one proof of benefits (#5238). */
export function holidayProofHref(
  periodId: string,
  registrationId: string,
  proofId: string,
): string {
  return `${registrationPath(periodId, registrationId)}/proofs/${encodeURIComponent(proofId)}`;
}

/**
 * Uploads a proof of benefits the family brought on paper (#5627) and
 * returns the registration with its proofs. The backend checks type, size
 * and content like the parents' upload.
 */
export async function uploadHolidayProof(
  periodId: string,
  registrationId: string,
  file: File,
): Promise<HolidayRegistrationDetail> {
  const body = new FormData();
  body.append("file", file);
  return detailFromBackend(
    await bffJson(
      "org",
      "POST /traeger/holiday-periods/{id}/registrations/{registrationId}/proofs",
      { params: { id: periodId, registrationId }, body },
    ),
  );
}

/** The query of a filter, empty values left out. */
function holidayFilterQuery(filter: HolidayRegistrationFilter) {
  return {
    status: filter.status || undefined,
    school: filter.school || undefined,
    week_id: filter.weekId || undefined,
    time_model: filter.timeModel || undefined,
    wish: filter.wish || undefined,
  };
}

/** The registrations of a period that match the filter. */
export async function fetchHolidayRegistrations(
  periodId: string,
  filter: HolidayRegistrationFilter,
): Promise<HolidayRegistrationList> {
  const list = await bffJson(
    "org",
    "GET /traeger/holiday-periods/{id}/registrations",
    {
      params: { id: periodId },
      query: holidayFilterQuery(filter),
    },
  );
  return {
    registrations: (list.registrations ?? [])
      .filter(knownRegistration)
      .map(summaryFromBackend),
    total: list.total,
    statusCounts: {
      received: list.status_counts?.received ?? 0,
      confirmed: list.status_counts?.confirmed ?? 0,
      cancelled: list.status_counts?.cancelled ?? 0,
    },
  };
}

/** One registration with contacts and history, without health information. */
export async function fetchHolidayRegistration(
  periodId: string,
  registrationId: string,
): Promise<HolidayRegistrationDetail> {
  return detailFromBackend(
    await bffJson(
      "org",
      "GET /traeger/holiday-periods/{id}/registrations/{registrationId}",
      { params: { id: periodId, registrationId } },
    ),
  );
}

/**
 * The registered children a school of the Träger knows (#6683): child ID to
 * the one school that manages a child with the same names and date of birth
 * today. Only a hint; moto links nothing. The backend records every
 * comparison, so a page asks only for what it shows: the whole period, or
 * one registration.
 */
export async function fetchHolidayKnownChildren(
  periodId: string,
  registrationId?: string,
): Promise<ReadonlyMap<string, string>> {
  const known = await bffJson(
    "org",
    "GET /traeger/holiday-periods/{id}/registrations/known-children",
    {
      params: { id: periodId },
      query: { registration_id: registrationId || undefined },
    },
  );
  return new Map(
    (known.children ?? []).map((child) => [child.child_id, child.school_id]),
  );
}

/**
 * The registrations of a period whose receipt or acceptance mail did not reach
 * the parents (#6737): registration ID to its mail problems. A registration
 * without a problem has no key.
 */
export async function fetchHolidayRegistrationMailProblems(
  periodId: string,
): Promise<ReadonlyMap<string, readonly HolidayRegistrationMailProblem[]>> {
  const answer = await bffJson(
    "org",
    "GET /traeger/holiday-periods/{id}/registrations/mail-problems",
    { params: { id: periodId } },
  );
  return new Map(
    (answer.registrations ?? []).map((registration) => [
      registration.registration_id,
      mailProblemsFromBackend(registration.mail_problems),
    ]),
  );
}

/**
 * The health information of a registration (#4722). The backend answers 403
 * without the right „Gesundheitsangaben sehen“ and records every read.
 */
export async function fetchHolidayRegistrationHealth(
  periodId: string,
  registrationId: string,
): Promise<HolidayRegistrationHealthDetail> {
  const health = await bffJson(
    "org",
    "GET /traeger/holiday-periods/{id}/registrations/{registrationId}/health",
    { params: { id: periodId, registrationId } },
  );
  return {
    answers: health.custom_data ?? {},
    children: (health.children ?? []).map((child) => ({
      childId: child.child_id,
      allergies: child.allergies,
      medication: child.medication,
      healthNotes: child.health_notes,
      answers: child.custom_data ?? {},
    })),
  };
}

/**
 * The detail with the health answers merged into its answers, so the
 * questions marked as health information show their answer beside the
 * others (#4722).
 */
export function withHolidayHealthAnswers(
  registration: HolidayRegistrationDetail,
  health: HolidayRegistrationHealthDetail | null,
): HolidayRegistrationDetail {
  if (!health) return registration;
  const childAnswers: Record<string, Readonly<Record<string, unknown>>> = {
    ...registration.childAnswers,
  };
  for (const child of health.children) {
    childAnswers[child.childId] = {
      ...childAnswers[child.childId],
      ...child.answers,
    };
  }
  return {
    ...registration,
    answers: { ...registration.answers, ...health.answers },
    childAnswers,
  };
}

/** Freezes or reopens a registration. */
export async function changeHolidayRegistration(
  periodId: string,
  registrationId: string,
  action: HolidayRegistrationAction,
): Promise<HolidayRegistrationDetail> {
  return detailFromBackend(
    await bffJson(
      "org",
      action === "freeze"
        ? "POST /traeger/holiday-periods/{id}/registrations/{registrationId}/freeze"
        : "POST /traeger/holiday-periods/{id}/registrations/{registrationId}/reopen",
      { params: { id: periodId, registrationId } },
    ),
  );
}

/**
 * Saves the office's checks of the criteria (#4700). A check changes the
 * proposal for open bookings and the order of the waiting list.
 */
export async function checkHolidayRegistrationCriteria(
  periodId: string,
  registrationId: string,
  checks: readonly HolidayCriterionCheck[],
): Promise<HolidayRegistrationDetail> {
  return detailFromBackend(
    await bffJson(
      "org",
      "PUT /traeger/holiday-periods/{id}/registrations/{registrationId}/criteria",
      {
        params: { id: periodId, registrationId },
        body: {
          checks: checks.map((check) => ({
            criterion_id: check.criterionId,
            child_id: check.childId === null ? null : check.childId,
            checked: check.checked,
          })),
        } satisfies traegerHolidayPeriodsContract.HolidayCriteriaCheckRequest,
      },
    ),
  );
}

/**
 * The office decides the holiday care wish of a child of its schools
 * (#4703). It only orders the waiting list; no place is given or taken.
 */
export async function setHolidayChildWish(
  periodId: string,
  registrationId: string,
  childId: string,
  wish: "yes" | "no",
): Promise<HolidayRegistrationDetail> {
  return detailFromBackend(
    await bffJson(
      "org",
      "PUT /traeger/holiday-periods/{id}/registrations/{registrationId}/children/{childId}/holiday-wish",
      {
        params: { id: periodId, registrationId, childId },
        body: {
          wish,
        } satisfies traegerHolidayPeriodsContract.HolidayWishRequest,
      },
    ),
  );
}

/** Replaces the bookings of one child: one time model per week. */
export async function rebookHolidayChild(
  periodId: string,
  registrationId: string,
  childId: string,
  bookings: readonly HolidayBookingChange[],
): Promise<HolidayRegistrationDetail> {
  return detailFromBackend(
    await bffJson(
      "org",
      "PUT /traeger/holiday-contributions/{periodId}/registrations/{registrationId}/children/{childId}/bookings",
      {
        params: { periodId, registrationId, childId },
        body: {
          bookings: bookings.map(
            (
              booking,
            ): traegerHolidayContributionsContract.HolidayBookingChoice => ({
              week_id: booking.weekId,
              time_model_id: booking.timeModelId,
              ...(booking.days && booking.days.length > 0
                ? { days: [...booking.days] }
                : {}),
              ...(booking.lunch ? { lunch: true } : {}),
            }),
          ),
        } satisfies traegerHolidayContributionsContract.HolidayRebookingRequest,
      },
    ),
  );
}

/** A person of the registration as the Träger-Büro edits it (#5629). */
export interface HolidayRegistrationPersonEdit {
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phone: string;
}

/** The postal address of the parent who registered (#5625). */
interface HolidayRegistrationAddressEdit {
  readonly street: string;
  readonly postalCode: string;
  readonly city: string;
}

/** An emergency contact or a person allowed to collect the children. */
export interface HolidayRegistrationContactEdit {
  readonly name: string;
  readonly phone: string;
  readonly relationship: string;
}

/** The details of one child; a null school makes it a holiday guest. */
interface HolidayRegistrationChildEdit {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly birthDate: string;
  readonly homeSchoolId: string | null;
  readonly guestSchoolName: string;
  /** Its answers to the questions without health information. */
  readonly answers: Readonly<Record<string, unknown>>;
}

/**
 * One change of the details (#5629). A section that is absent stays as it
 * is; a null `secondGuardian` removes the second guardian.
 */
export interface HolidayRegistrationEdit {
  readonly guardians?: {
    readonly guardian: HolidayRegistrationPersonEdit;
    /** Null removes the address; the form version decides whether it is asked. */
    readonly address: HolidayRegistrationAddressEdit | null;
    readonly secondGuardian: HolidayRegistrationPersonEdit | null;
  };
  readonly child?: HolidayRegistrationChildEdit;
  readonly contacts?: {
    readonly emergency: readonly HolidayRegistrationContactEdit[];
    readonly pickup: readonly HolidayRegistrationContactEdit[];
  };
  /** The family's answers to the questions without health information. */
  readonly answers?: Readonly<Record<string, unknown>>;
}

function personBody(person: HolidayRegistrationPersonEdit) {
  return {
    first_name: person.firstName,
    last_name: person.lastName,
    email: person.email,
    phone: person.phone,
  };
}

function contactBody(contact: HolidayRegistrationContactEdit) {
  return {
    name: contact.name,
    phone: contact.phone,
    relationship: contact.relationship,
  };
}

/** The request body; the field names are those of the public form. */
function holidayRegistrationEditBody(
  edit: HolidayRegistrationEdit,
): traegerHolidayPeriodsContract.HolidayRegistrationEditRequest {
  const body: traegerHolidayPeriodsContract.HolidayRegistrationEditRequest = {};
  if (edit.guardians) {
    body.guardian = personBody(edit.guardians.guardian);
    const address = edit.guardians.address;
    body.guardian_address = address
      ? {
          street: address.street,
          postal_code: address.postalCode,
          city: address.city,
        }
      : null;
    body.second_guardian = edit.guardians.secondGuardian
      ? personBody(edit.guardians.secondGuardian)
      : null;
  }
  if (edit.child) {
    body.children = [
      {
        id: edit.child.id,
        first_name: edit.child.firstName,
        last_name: edit.child.lastName,
        birth_date: edit.child.birthDate,
        home_school_id: edit.child.homeSchoolId ? edit.child.homeSchoolId : "0",
        guest_school_name: edit.child.guestSchoolName,
        custom_data: { ...edit.child.answers },
      },
    ];
  }
  if (edit.contacts) {
    body.emergency_contacts = edit.contacts.emergency.map(contactBody);
    body.pickup_persons = edit.contacts.pickup.map(contactBody);
  }
  if (edit.answers) body.custom_data = { ...edit.answers };
  return body;
}

/** Changes the details a family entered (#5629). */
export async function editHolidayRegistration(
  periodId: string,
  registrationId: string,
  edit: HolidayRegistrationEdit,
): Promise<HolidayRegistrationDetail> {
  return detailFromBackend(
    await bffJson(
      "org",
      "PUT /traeger/holiday-periods/{id}/registrations/{registrationId}/details",
      {
        params: { id: periodId, registrationId },
        body: holidayRegistrationEditBody(edit),
      },
    ),
  );
}

interface DownloadedFile {
  readonly blob: Blob;
  readonly filename: string | null;
}

/** Fetches a file of the Träger portal with the backend's file name. */
async function downloadTraegerFile(
  file: Promise<Response>,
): Promise<DownloadedFile> {
  const response = await file;
  return {
    blob: await response.blob(),
    filename: filenameFromDisposition(response),
  };
}

/** The export of a filter as CSV or Excel, with the backend's file name. */
export async function downloadHolidayRegistrations(
  periodId: string,
  filter: HolidayRegistrationFilter,
  format: "pdf" | "xlsx" | "csv",
): Promise<DownloadedFile> {
  return downloadTraegerFile(
    bffFile("org", "GET /traeger/holiday-periods/{id}/registrations/export", {
      params: { id: periodId },
      query: { ...holidayFilterQuery(filter), format },
    }),
  );
}

/**
 * One registration as a PDF (#6691). With `withHealth` the file names the
 * health information; the backend admits that only with the right to see it.
 */
export async function downloadHolidayRegistrationPdf(
  periodId: string,
  registrationId: string,
  withHealth: boolean,
): Promise<DownloadedFile> {
  return downloadTraegerFile(
    bffFile(
      "org",
      "GET /traeger/holiday-periods/{id}/registrations/{registrationId}/pdf",
      {
        params: { id: periodId, registrationId },
        query: { health: withHealth || undefined },
      },
    ),
  );
}

/** The registrations of a filter as a ZIP with one PDF each (#6691). */
export async function downloadHolidayRegistrationPdfs(
  periodId: string,
  filter: HolidayRegistrationFilter,
  withHealth: boolean,
): Promise<DownloadedFile> {
  return downloadTraegerFile(
    bffFile("org", "GET /traeger/holiday-periods/{id}/registrations/pdf", {
      params: { id: periodId },
      query: {
        ...holidayFilterQuery(filter),
        health: withHealth || undefined,
      },
    }),
  );
}

/**
 * What a confirmation of the Träger needs (#5621). It lives here, not in the
 * contributions client, because the list reads it for its column too and
 * should not load that client.
 */
/** An active cost bearer the confirmation offers (#5627). */
export interface CostBearerChoice {
  readonly id: string;
  readonly name: string;
}

export interface HolidayConfirmationSettings {
  /** The Träger asks for the debtor number of the family. */
  readonly debtorNumberRequired: boolean;
  /** The format the number must have (#6675); none without the setting. */
  readonly debtorNumberFormat?: DebtorNumberFormat;
  /** The active cost bearers of the Träger, by name (#5627). */
  readonly costBearers?: readonly CostBearerChoice[];
}

export async function fetchHolidayConfirmationSettings(): Promise<HolidayConfirmationSettings> {
  const settings = await bffJson(
    "org",
    "GET /traeger/holiday-contributions/confirmation-settings",
  );
  return {
    debtorNumberRequired: settings.debtor_number_required,
    debtorNumberFormat: debtorNumberFormatOf(settings.debtor_number_format),
    costBearers: (settings.cost_bearers ?? []).map((bearer) => ({
      id: bearer.id,
      name: bearer.name,
    })),
  };
}

/** One booking on the waiting list of a week, in its order (#4699). */
interface HolidayWaitlistEntry {
  readonly position: number;
  readonly registrationId: string;
  /** Undefined for a status this build does not know. */
  readonly registrationStatus: HolidayRegistrationStatus | undefined;
  readonly submittedAt: string;
  readonly childId: string;
  readonly childFirstName: string;
  readonly childLastName: string;
  readonly timeModelName: string;
  /** Waits behind the others: no holiday care wish (#4703). */
  readonly deferred: boolean;
  /** The wanted days of a booking of days (#4701); empty for a whole week. */
  readonly days?: readonly string[];
}

/**
 * The places of one week of a holiday period (#4699): its capacity, null for
 * unlimited, the children with a place and the waiting list.
 */
export interface HolidayWeekPlaces {
  readonly weekId: string;
  /** Calendar dates "YYYY-MM-DD". */
  readonly startsOn: string;
  readonly endsOn: string;
  readonly hostSchoolId: string;
  readonly capacity: number | null;
  readonly placed: number;
  /** Bookings the office has not decided yet (#4700). */
  readonly pending?: number;
  readonly waitlist: readonly HolidayWaitlistEntry[];
  /** "day": the capacity holds for each day (#4701). */
  readonly bookingUnit?: "week" | "day";
  /** Placed bookings of each care day of a week by days, in order. */
  readonly days?: readonly { readonly date: string; readonly placed: number }[];
}

/** The places and waiting lists of every week of a period (#4699). */
export async function fetchHolidayWeekPlaces(
  periodId: string,
): Promise<readonly HolidayWeekPlaces[]> {
  const weeks = await bffJson(
    "org",
    "GET /traeger/holiday-periods/{id}/places",
    { params: { id: periodId } },
  );
  return weeks.map((week) => ({
    weekId: week.week_id,
    startsOn: requiredDay(week.starts_on, "holiday_week_places.starts_on"),
    endsOn: requiredDay(week.ends_on, "holiday_week_places.ends_on"),
    hostSchoolId: week.host_school_id,
    capacity: week.capacity,
    placed: week.placed,
    pending: week.pending,
    // Go sets the unit on every week; "week" is its default.
    bookingUnit: knownEnum(BOOKING_UNITS, week.booking_unit) ?? "week",
    days: (week.days ?? []).map((day) => ({
      date: requiredDay(day.date, "holiday_day_places.date"),
      placed: day.placed,
    })),
    waitlist: (week.waitlist ?? []).map((entry) => {
      const days = presentDays(entry.days);
      return {
        position: entry.position,
        registrationId: entry.registration_id,
        // Only shown; an unknown status shows „–“.
        registrationStatus: knownEnum(STATUSES, entry.registration_status),
        submittedAt: entry.submitted_at,
        childId: entry.child_id,
        childFirstName: entry.child_first_name,
        childLastName: entry.child_last_name,
        timeModelName: entry.time_model_name,
        deferred: entry.deferred,
        ...(days.length > 0 ? { days } : {}),
      };
    }),
  }));
}

/**
 * Sets the places of a week, null for unlimited (#4699). Freed places go to
 * the waiting list at once; the answer names the registrations that moved
 * up.
 */
export async function setHolidayWeekCapacity(
  periodId: string,
  weekId: string,
  capacity: number | null,
): Promise<{ readonly movedUp: readonly string[] }> {
  const change = await bffJson(
    "org",
    "PUT /traeger/holiday-contributions/{periodId}/weeks/{weekId}/capacity",
    {
      params: { periodId, weekId },
      body: {
        capacity,
      } satisfies traegerHolidayContributionsContract.HolidayCapacityRequest,
    },
  );
  return { movedUp: change.moved_up ?? [] };
}
