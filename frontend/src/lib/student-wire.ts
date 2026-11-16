// The student as the backend sends and receives it, and the one translation
// to and from the browser's Student. The BFF routes are its callers; the
// browser never sees these shapes.

import { parseAttendanceActor } from "~/lib/attendance-actor";
import { knownEnum, success } from "./contract/runtime";
import {
  DAY_PLANNING_STATUS_VALUES,
  DEPARTURE_MODE_VALUES,
  STUDENT_CONSENT_KEY_VALUES,
  STUDENT_CONSENT_STATE_VALUES,
  StudentResponseSchema,
  type NameStudentResponse,
  type SlimStudentResponse,
  type StudentConsentResponse,
  type StudentDetailResponse,
  type StudentResponse,
  type routes,
} from "./contract/students.generated";
import { normalizeLocation } from "./location-helper";
import {
  allowedDepartureModesFromDeparture,
  allowedDepartureModesFromLegacy,
  busDaysHaveAny,
  departureDaysFromLegacy,
  normalizeAllowedDepartureModes,
  normalizeBusDays,
  normalizeDepartureDays,
  normalizePickupDays,
  type AllowedDepartureModes,
  type DepartureDays,
} from "./departure-plan";
import type { Student, StudentConsent, StudentUpdate } from "./student-helpers";

/** The answer of a student create or update: the full row, like a list row. */
export const studentWriteResponse = success(StudentResponseSchema);

/** The three projections of `GET /api/students`. */
export type StudentView =
  keyof (typeof routes)["GET /api/students/"]["response"];

// A full row is also read as a slim one; only the slim projection carries
// the day's departure.
type SlimOnly =
  "departure_modes" | "departure_label" | "departure_is_exception";
type SlimRow = Omit<SlimStudentResponse, SlimOnly> &
  Partial<Pick<SlimStudentResponse, SlimOnly>>;

// The detail read adds these to the full row; a write answers without them.
type FullRow = StudentResponse &
  Partial<
    Pick<
      StudentDetailResponse,
      "consents" | "actual_arrival_by" | "actual_pickup_by"
    >
  >;

/** Consents this build knows; an unknown key or state shows nothing. */
function mapConsents(
  consents: StudentConsentResponse[] | undefined,
): StudentConsent[] | undefined {
  return consents?.flatMap((consent) => {
    const key = knownEnum(STUDENT_CONSENT_KEY_VALUES, consent.key);
    const state = knownEnum(STUDENT_CONSENT_STATE_VALUES, consent.state);
    return key && state ? [{ key, state, changed_at: consent.changed_at }] : [];
  });
}

function nameFields(row: NameStudentResponse) {
  const first = row.first_name ?? "";
  const last = row.last_name ?? "";
  return {
    id: row.id,
    name: `${first} ${last}`.trim(),
    first_name: row.first_name,
    second_name: row.last_name,
  };
}

/** The names-only row: no class and no location (#4996). */
function mapNameStudent(row: NameStudentResponse): Student {
  return { ...nameFields(row), school_class: "", current_location: "" };
}

/**
 * The Kindersuche projection, without synthesizing the omitted full-detail
 * fields: the route serializes the mapped value back to the browser.
 */
function mapSlimStudent(row: SlimRow): Student {
  return {
    ...nameFields(row),
    school_class: row.school_class,
    group_name: row.group_name,
    group_id: row.group_id,
    current_location: normalizeLocation(row.current_location),
    location_since: row.location_since ?? undefined,
    current_room_color: row.current_room_color ?? null,
    sick: row.sick,
    sick_since: row.sick_since,
    excused: row.excused,
    excused_since: row.excused_since,
    class_trip: row.class_trip,
    class_trip_since: row.class_trip_since,
    day_planning_status: knownEnum(
      DAY_PLANNING_STATUS_VALUES,
      row.day_planning_status,
    ),
    day_planning_reason: row.day_planning_reason,
    day_planning_label: row.day_planning_label,
    pending_excused_note: row.pending_excused_note,
    teacher_hints: row.teacher_hints,
    class_handover: row.class_handover,
    departure_modes: row.departure_modes?.flatMap(
      (mode) => knownEnum(DEPARTURE_MODE_VALUES, mode) ?? [],
    ),
    departure_label: row.departure_label,
    departure_is_exception: row.departure_is_exception,
    pickup_time: row.pickup_time,
    pickup_is_exception: row.pickup_is_exception,
    pickup_notes: row.pickup_notes,
    arrival_time: row.arrival_time,
    arrival_is_exception: row.arrival_is_exception,
    arrival_notes: row.arrival_notes,
    actual_arrival_time: row.actual_arrival_time,
    actual_pickup_time: row.actual_pickup_time,
    companion_student_ids: row.companion_student_ids,
    photo_url: row.photo_url,
    photo_consent_given: row.photo_consent_given,
    has_full_access: row.has_full_access,
  };
}

/** The full row. */
export function mapStudentResponse(row: FullRow): Student {
  // The plan normalizers below keep only weekdays and modes this build knows.
  const busDays = row.bus_days;
  const pickupDays = row.pickup_days;
  const departureDays = row.departure_days as DepartureDays | undefined;
  const allowedModes = row.allowed_departure_modes as
    AllowedDepartureModes | undefined;
  return {
    ...mapSlimStudent(row),
    studentId: row.tag_id,
    bus: busDaysHaveAny(busDays),
    bus_days: normalizeBusDays(busDays),
    pickup_days: normalizePickupDays(pickupDays),
    // A child whose plan predates allowed_departure_modes (#1694) or
    // departure_days (#1610) still carries only the older maps.
    allowed_departure_modes: allowedModes
      ? normalizeAllowedDepartureModes(allowedModes)
      : departureDays
        ? allowedDepartureModesFromDeparture(departureDays)
        : allowedDepartureModesFromLegacy(busDays, pickupDays),
    departure_days: departureDays
      ? normalizeDepartureDays(departureDays)
      : departureDaysFromLegacy(busDays, pickupDays),
    care_ends_on: row.care_ends_on,
    care_ended: row.care_ended ?? false,
    care_exit_recorded: row.care_exit_recorded ?? false,
    address_street: row.address_street,
    address_city: row.address_city,
    address_postal_code: row.address_postal_code,
    extra_info: row.extra_info,
    departure_companion_note: row.departure_companion_note,
    birthday: row.birthday,
    health_info: row.health_info,
    pickup_status: row.pickup_status,
    actual_pickup_note: row.actual_pickup_note,
    actual_arrival_by: parseAttendanceActor(row.actual_arrival_by),
    actual_pickup_by: parseAttendanceActor(row.actual_pickup_by),
    photo_consent_given_at: row.photo_consent_given_at,
    photo_consent_given_by: row.photo_consent_given_by,
    agb_accepted_at: row.agb_accepted_at,
    data_processing_accepted_at: row.data_processing_accepted_at,
    email_contact_accepted_at: row.email_contact_accepted_at,
    consents: mapConsents(row.consents),
  };
}

const LIST_ROW_MAPPERS: Record<StudentView, (row: never) => Student> = {
  full: mapStudentResponse,
  slim: mapSlimStudent,
  names: mapNameStudent,
};

/** Maps a list row of the requested projection. */
export function mapStudentListRow(
  row: NameStudentResponse,
  view: StudentView,
): Student {
  return LIST_ROW_MAPPERS[view](row as never);
}

/** The detail read: the full row plus access, feature flags and consent. */
export function mapStudentDetailResponse(row: StudentDetailResponse): Student {
  return {
    ...mapStudentResponse(row),
    has_full_access: row.has_full_access,
    has_write_access: row.has_write_access,
    has_absence_write_access: row.has_absence_write_access,
    has_sick_excused_write_access: row.has_sick_excused_write_access,
    group_supervisors: row.group_supervisors ?? [],
    attendance_log_enabled: row.attendance_log_enabled,
    feedback_enabled: row.feedback_enabled,
    privacy_consent_accepted: row.privacy_consent?.accepted,
    data_retention_days: row.privacy_consent?.data_retention_days,
  };
}

/**
 * Whether a student write can change the "läuft mit" links, for answers that
 * carry no verdict of the backend. A submitted list replaces the stored one, a
 * confirmed extension widens a linked child's plan, and every departure map
 * prepareStudentForBackend sends makes the backend trim links off weekdays
 * the new plan no longer allows.
 */
export function writeMayChangeCompanions(student: StudentUpdate): boolean {
  return (
    student.companions !== undefined ||
    (student.confirmed_companion_extensions?.length ?? 0) > 0 ||
    student.allowed_departure_modes !== undefined ||
    student.departure_days !== undefined ||
    student.bus_days !== undefined ||
    student.pickup_days !== undefined
  );
}

/** The backend body of a student write. Omitted keys leave stored values. */
export function prepareStudentForBackend(student: StudentUpdate) {
  return {
    first_name: student.first_name,
    last_name: student.second_name,
    school_class: student.school_class,
    current_location: student.current_location
      ? normalizeLocation(student.current_location)
      : undefined,
    // bus_days is the single source of truth (#1582); the legacy bus boolean
    // is not sent. Each map only goes out when the caller set it, so partial
    // updates (sick/excused toggles) leave the stored plan untouched.
    bus_days:
      student.bus_days === undefined
        ? undefined
        : normalizeBusDays(student.bus_days),
    pickup_days:
      student.pickup_days === undefined
        ? undefined
        : normalizePickupDays(student.pickup_days),
    allowed_departure_modes:
      student.allowed_departure_modes === undefined
        ? undefined
        : normalizeAllowedDepartureModes(student.allowed_departure_modes),
    // When sent, the backend derives bus_days/pickup_days/pickup_status from
    // departure_days (#1610).
    departure_days:
      student.departure_days === undefined
        ? undefined
        : normalizeDepartureDays(student.departure_days),
    group_id: student.group_id
      ? Number.parseInt(String(student.group_id), 10)
      : undefined,
    address_street: student.address_street,
    address_city: student.address_city,
    address_postal_code: student.address_postal_code,
    extra_info: student.extra_info,
    departure_companion_note: student.departure_companion_note,
    // Laufgemeinschaft ("läuft mit"): an omitted key leaves the stored links
    // untouched, [] clears them. The id travels as the string the frontend
    // holds: the backend accepts a quoted decimal, and a JS number would round
    // an id beyond Number.MAX_SAFE_INTEGER to a DIFFERENT child's id.
    companions: student.companions?.map((companion) => ({
      companion_student_id: companion.companion_student_id,
      weekdays: companion.weekdays,
    })),
    // The fingerprint of the list the form LOADED. Sent without a list too:
    // the backend trims links the new departure plan no longer allows, so a
    // plan saved from a stale load deletes a fresh link exactly like a stale
    // list would, and the backend refuses that unless this claim matches.
    companions_fingerprint: student.companions_fingerprint,
    extend_companion_plans: student.extend_companion_plans,
    // What the user confirmed, not just that they confirmed something: the
    // backend refuses to widen a conflict these entries do not cover.
    confirmed_companion_extensions: student.confirmed_companion_extensions?.map(
      (entry) => ({
        companion_student_id: entry.companion_student_id,
        weekdays: entry.weekdays,
      }),
    ),
    // The Go backend takes null or a valid date, not "".
    birthday: student.birthday?.trim() ? student.birthday : undefined,
    health_info: student.health_info,
    pickup_status: student.pickup_status,
    sick: student.sick,
    excused: student.excused,
    // The backend stamps a false→true change and clears photo and metadata on
    // true→false.
    photo_consent_given: student.photo_consent_given,
  };
}
