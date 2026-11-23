// The student as the browser holds it, and the small display helpers every
// student surface shares. The backend wire shape lives in student-wire.ts,
// the Heimweg plan in departure-plan.ts.

import { schoolClassLabel } from "./school-class-label";
import type { AttendanceActor } from "~/lib/attendance-actor";
import type {
  CompanionExtensionConfirmation,
  StudentCompanion,
} from "./student-companion-api";
import type { ConsentRecord } from "./consent-types";
import type {
  AllowedDepartureModes,
  BusDays,
  DepartureDays,
  DepartureMode,
  PickupDays,
} from "./departure-plan";
import type * as studentsContract from "~/lib/contract/students.generated";

/**
 * Shared filter options for school year (Klassenstufe) filter
 * Used in student search and OGS groups pages
 */
export const SCHOOL_YEAR_FILTER_OPTIONS = [
  { value: "all", label: "Alle" },
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "3", label: "3" },
  { value: "4", label: "4" },
] as const;

/**
 * Extract the school year (Klassenstufe) from a school_class string.
 * E.g. "Klasse 3a" → "3", "2b" → "2", "unknown" → null
 */
export function getSchoolYear(schoolClass: string): string | null {
  const match = /(\d+)/.exec(schoolClass);
  return match ? match[1]! : null;
}

export type StudentConsent = ConsentRecord;

/** A child's privacy consent, or the school's defaults when none is stored. */
export interface PrivacyConsent {
  accepted: boolean;
  dataRetentionDays: number;
  /** The version of a child's stored consent read; defaults carry none. */
  version?: string;
}

/** Die Zeile, mit der eine OGS-Ansicht einen Hinweis der Lehrkraft zeigt. */
export function teacherHintText(hint: studentsContract.TeacherHint): string {
  const author = hint.author_name ? ` ${hint.author_name}` : "";
  // schoolClassLabel macht aus „3b“ und „Klasse 3b“ beide „Klasse 3b“.
  const target = hint.school_class
    ? ` an die ${schoolClassLabel(hint.school_class)}`
    : "";
  return `Hinweis der Lehrkraft${author}${target}: ${hint.body}`;
}

/**
 * Der React-Schlüssel eines Hinweises. Je Lehrkraft, Kind und Ziel gibt es
 * einen Hinweis; zwei Lehrkräfte mit demselben Text bleiben getrennt.
 */
export function teacherHintKey(hint: studentsContract.TeacherHint): string {
  return `${hint.school_class ?? ""}|${hint.author_name ?? ""}|${hint.body}`;
}

/** Fields every projection carries, as the backend sends them. */
type StudentCore = Pick<
  studentsContract.StudentDetailResponse,
  "id" | "school_class" | "current_location"
>;

/**
 * Fields the browser keeps as the backend sends them. The slim and names
 * projections and the write answers omit some, so each is optional here.
 */
type StudentWireFields = Partial<
  Pick<
    studentsContract.StudentDetailResponse,
    | "first_name"
    | "group_name"
    | "group_id"
    | "location_since"
    | "bus"
    | "sick"
    | "sick_since"
    | "excused"
    | "excused_since"
    | "class_trip"
    | "class_trip_since"
    | "day_planning_reason"
    | "day_planning_label"
    | "care_ends_on"
    | "care_ended"
    | "care_exit_recorded"
    | "without_care_place"
    | "pending_excused_note"
    | "teacher_hints"
    | "class_handover"
    | "address_street"
    | "address_city"
    | "address_postal_code"
    | "has_full_access"
    | "has_write_access"
    | "has_absence_write_access"
    | "has_sick_excused_write_access"
    | "group_supervisors"
    | "attendance_log_enabled"
    | "feedback_enabled"
    | "extra_info"
    | "departure_companion_note"
    | "companion_student_ids"
    | "birthday"
    | "health_info"
    | "pickup_status"
    | "pickup_time"
    | "pickup_is_exception"
    | "pickup_notes"
    | "arrival_time"
    | "arrival_is_exception"
    | "arrival_notes"
    | "actual_arrival_time"
    | "actual_pickup_time"
    | "actual_pickup_note"
    | "photo_url"
    | "photo_consent_given"
    | "photo_consent_given_at"
    | "photo_consent_given_by"
    | "agb_accepted_at"
    | "data_processing_accepted_at"
    | "email_contact_accepted_at"
  >
> &
  // The day's departure: only the slim projection carries it.
  Partial<
    Pick<
      studentsContract.SlimStudentResponse,
      "departure_label" | "departure_is_exception"
    >
  > &
  // Write-only claims of a departure-plan save (409 `students.companions_changed`).
  Pick<
    studentsContract.UpdateStudentRequest,
    "companions_fingerprint" | "extend_companion_plans"
  >;

/**
 * The student as the browser holds it: the contract's fields (#7806), and the
 * ones lib/student-wire.ts maps into the browser's form.
 */
export type Student = StudentCore &
  StudentWireFields & {
    /** First and last name, joined. */
    name: string;
    /** The backend's last_name. */
    second_name?: string;
    /** The backend's tag_id. */
    studentId?: string;
    /** Hex color of the current room when set (Issue #1324). Empty string treated as null. */
    current_room_color?: string | null;
    // The departure maps, narrowed to weekdays and modes this build knows.
    // departure_days is the source of truth for how the child leaves;
    // bus_days/pickup_days are derived from it (#1610).
    bus_days?: BusDays;
    pickup_days?: PickupDays;
    departure_days?: DepartureDays;
    allowed_departure_modes?: AllowedDepartureModes;
    departure_modes?: DepartureMode[];
    // Narrowed to the statuses this build knows; an unknown one shows none.
    day_planning_status?: studentsContract.DayPlanningStatus;
    // Heutige Angebote des Kindes (#6487); nur wenn die Schule sie auf der
    // Kinderkarte zeigt. Kommt aus der Gruppenansicht (grouplive).
    planned_activities?: studentsContract.PlannedActivity[];
    // The detail read's privacy_consent, flattened for form handling.
    privacy_consent_accepted?: boolean;
    data_retention_days?: number | null;
    /** Write-only: the version of the consent read the form shows; a save of
     *  the consent sends it back (ADR 0311). */
    privacy_consent_version?: string;
    /** The version of the master data the detail read showed (write access
     *  only); a form save sends it back as expected_version (ADR 0311). */
    version?: string;
    /** Answer of the create only: false when the child was created but the
     *  consent the form changed could not be saved (#5970). */
    privacy_consent_saved?: false;
    /** The child's Laufgemeinschaft. Loaded from the companions endpoint and
     *  submitted back with the departure plan it belongs to; omitting it
     *  leaves the stored links untouched. */
    companions?: StudentCompanion[];
    /** Write-only: the children and weekdays a widening confirmation
     *  covered. Without them the backend treats it as unanswered. */
    confirmed_companion_extensions?: CompanionExtensionConfirmation[];
    actual_arrival_by?: AttendanceActor | null; // Who recorded today's arrival (#4761)
    actual_pickup_by?: AttendanceActor | null; // Who recorded today's pickup (#4761)
    consents?: StudentConsent[];
  };

/** One page of a student list. */
export interface StudentPage {
  data: Student[];
  pagination: {
    current_page: number;
    page_size: number;
    total_pages: number;
    total_records: number;
  };
}

/**
 * What a student write carries. The Laufgemeinschaft rides along with the
 * departure plan it belongs to; its ids stay strings all the way to the
 * backend, which accepts a quoted decimal.
 */
export type StudentUpdate = Omit<Partial<Student>, "companions"> & {
  companions?: { companion_student_id: string; weekdays: string[] }[];
};

/** An active care offering that counts as care, as a selection lists it. */
export interface CareOfferingOption {
  readonly id: string;
  readonly name: string;
}

/**
 * A question of the school's registration form the child list can filter by
 * (#6954), with the answers given and how many children gave each.
 */
export interface EnrollmentAnswerFilter {
  readonly key: string;
  readonly label: string;
  readonly options: ReadonlyArray<{
    readonly value: string;
    readonly label: string;
    readonly count: number;
  }>;
}
