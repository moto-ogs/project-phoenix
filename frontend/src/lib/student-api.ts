// The browser's client for the student: list, detail, create, update,
// check-in, photo, deletion and privacy consent. The calls go through the
// staff portal's catalog proxy under /api/students; this module maps the
// contract's shape (student-wire) onto the browser's Student once.

import { ApiError, apiErrorFromResponse, apiErrorFromText } from "./api-error";
import {
  mapAttendanceHistoryResponse,
  type AttendanceHistory,
  type AttendanceHistoryWire,
} from "./attendance-history-helpers";
import { bffJson } from "./bff-fetch";
import type {
  CareOfferingOptionResponse,
  EnrollmentAnswerFilterResponse,
  NameStudentResponse,
  PrivacyConsentDefaultsResponse,
  PrivacyConsentResponse,
  RoomHistoryStopResponse,
  StudentDetailResponse,
  StudentResponse,
  schoolCheckinBatchRequest,
  schoolCheckinBatchResponse,
  schoolCheckinRequest,
  schoolCheckinResponse,
} from "./contract/students.generated";
import { knownEnum } from "./contract/known-enum";
import { createLogger } from "~/lib/logger";
import { encodeMultiValueParam } from "./multi-value-param";
import { sessionFetch } from "./session-cache";
import type {
  CareOfferingOption,
  EnrollmentAnswerFilter,
  PrivacyConsent,
  Student,
  StudentPage,
  StudentUpdate,
} from "./student-helpers";
import { notifyStudentCompanionsChanged } from "./student-companion-api";
import {
  readConsentAfterWrite,
  sentConsentPair,
  writeStudentConsent,
} from "./student-privacy-consent";
import {
  studentCreateRequest,
  type StudentCreateBody,
} from "./student-request";
import {
  CompanionPlanConflictError,
  isCompanionPlanConflictResponse,
  PRIVACY_CONSENT_SAVED_DETAIL,
} from "./student-update-errors";
import {
  mapStudentDetailResponse,
  mapStudentListRow,
  mapStudentResponse,
  prepareStudentForBackend,
  writeMayChangeCompanions,
  type StudentView,
} from "./student-wire";

const logger = createLogger({ component: "StudentAPI" });

/** The filters of `GET /api/students`. */
export interface StudentFilters {
  search?: string;
  inHouse?: boolean;
  /**
   * Educational group(s). Several may be selected at once (#2218) and travel
   * comma-separated; the backend reads both that form and a repeated parameter.
   */
  groupId?: string | string[];
  /** Students currently checked in to an active group in this room (#1323). */
  roomId?: string;
  schoolClass?: string | string[];
  /** School year(s) ("Stufe"), matched against the class name (#2218). */
  gradeLevel?: string | string[];
  locationState?: "present" | "transit";
  dayStatus?: "comes_today" | "not_coming_today";
  /** Planning day (YYYY-MM-DD) the day status and times are evaluated for (#1939). Omit for today. */
  date?: string;
  bus?: "yes" | "no";
  photoConsent?: "yes" | "no";
  pickupStatus?: "self" | "pickedUp" | "none";
  /**
   * Keeps the present children who booked this care offering for today and
   * are not signed off for it (#4571). Needs `locationState: "present"`.
   */
  careOfferingId?: string;
  /**
   * Keeps the children with one answer to a question of the registration
   * form, "<question key>=<answer value>" (#6954). Needs users:read.
   */
  enrollmentAnswer?: string;
  page?: number;
  pageSize?: number;
  /** Adds today's effective pickup time (`pickup_time`) to every row. */
  includePickupTimes?: boolean;
  includeArrivalTimes?: boolean;
  /** Companion links for the shown day; costs an extra query per page. */
  includeCompanions?: boolean;
  /** Keeps children whose care ends with a pending withdrawal (#2487). */
  includePendingWithdrawals?: boolean;
  /**
   * Wire projection. "slim" (#2097) drops address, health, guardian and
   * schedule fields; "names" (#4996) keeps only ID and name.
   */
  view?: "slim" | "names";
}

const QUERY_KEYS: Record<
  Exclude<keyof StudentFilters, "groupId" | "schoolClass" | "gradeLevel">,
  string
> = {
  search: "search",
  inHouse: "in_house",
  roomId: "room_id",
  locationState: "location_state",
  dayStatus: "day_status",
  date: "date",
  bus: "bus",
  photoConsent: "photo_consent",
  pickupStatus: "pickup_status",
  careOfferingId: "care_offering_id",
  enrollmentAnswer: "enrollment_answer",
  page: "page",
  pageSize: "page_size",
  includePickupTimes: "include_pickup_times",
  includeArrivalTimes: "include_arrival_times",
  includeCompanions: "include_companions",
  includePendingWithdrawals: "include_pending_withdrawals",
  view: "view",
};

const MULTI_VALUE_KEYS = {
  groupId: "group_id",
  schoolClass: "school_class",
  gradeLevel: "grade_level",
} as const;

function studentQuery(filters: StudentFilters = {}): string {
  const params = new URLSearchParams();
  for (const [key, param] of Object.entries(QUERY_KEYS)) {
    const value = filters[key as keyof typeof QUERY_KEYS];
    // false and 0 restrict nothing, except in_house where false is a filter.
    if (value === undefined || value === "" || value === 0) continue;
    if (value === false && key !== "inHouse") continue;
    params.append(param, String(value));
  }
  // A selection of several values travels comma-separated and escaped (see
  // lib/multi-value-param); a single string is taken as already encoded.
  for (const [key, param] of Object.entries(MULTI_VALUE_KEYS)) {
    const value = filters[key as keyof typeof MULTI_VALUE_KEYS];
    const encoded = Array.isArray(value)
      ? encodeMultiValueParam(value)
      : (value ?? "").trim();
    if (encoded) params.append(param, encoded);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

/**
 * One page of children. Without a page size the backend answers every child
 * up to its cap of 1000 in one page.
 */
export async function fetchStudents(
  filters?: StudentFilters,
): Promise<{ students: Student[]; pagination: StudentPage["pagination"] }> {
  const url = `/api/students${studentQuery(filters)}`;
  const response = await sessionFetch(url);
  if (!response.ok) {
    throw await apiErrorFromResponse(
      response,
      `GET ${url} failed (${response.status})`,
    );
  }
  const page = (await response.json()) as {
    data: NameStudentResponse[];
    pagination: StudentPage["pagination"];
  };
  const view: StudentView = filters?.view ?? "full";
  return {
    students: page.data.map((row) => mapStudentListRow(row, view)),
    pagination: page.pagination,
  };
}

export async function fetchSchoolClasses(): Promise<string[]> {
  return bffJson<string[]>("/api/students/school-classes");
}

/** Names for a complete local child selector, including subsequent pages. */
export async function fetchAllStudentNames(): Promise<Student[]> {
  const first = await fetchStudents({ page: 1, pageSize: 500, view: "names" });
  const rest = await Promise.all(
    Array.from({ length: first.pagination.total_pages - 1 }, (_, i) =>
      fetchStudents({ page: i + 2, pageSize: 500, view: "names" }),
    ),
  );
  return [first, ...rest].flatMap((page) => page.students);
}

/** One child with access flags, feature flags and privacy consent. */
export async function fetchStudent(id: string): Promise<Student> {
  // The detail read carries the consent: one read and no consent waterfall.
  return mapStudentDetailResponse(
    await bffJson<StudentDetailResponse>(
      `/api/students/${encodeURIComponent(id)}?include_privacy_consent=true`,
    ),
  );
}

/**
 * Creates a child with its guardians and weekly schedules (one backend
 * transaction), then the privacy consent the form changed. The consent lives
 * at another backend endpoint, so it cannot join that transaction: when it
 * fails, the child exists anyway and the answer carries the consent that is
 * actually stored and `privacy_consent_saved: false`, so the form can say
 * that the input was lost and the person can correct it on the child's page
 * (#5970). The marker is absent whenever nothing was lost.
 */
export async function createStudent(body: StudentCreateBody): Promise<Student> {
  const consent = sentConsentPair(body);
  const created = await bffJson<StudentResponse>("/api/students", {
    method: "POST",
    body: studentCreateRequest(body),
  });

  let written = consent;
  if (consent) {
    try {
      await writeStudentConsent(created.id, consent);
    } catch (consentError) {
      written = null;
      logger.error("privacy_consent_write_failed_after_create", {
        student_id: created.id,
        error:
          consentError instanceof Error
            ? consentError.message
            : String(consentError),
      });
    }
  }

  return {
    ...mapStudentResponse(created),
    ...(await readConsentAfterWrite(created.id, written)),
    ...(consent && !written && { privacy_consent_saved: false }),
  };
}

/**
 * Marks a refused student write whose consent write had landed already, so
 * the form says which half was saved (isPrivacyConsentSaved). Status, code,
 * field errors and the companion conflict list stay as the backend sent them.
 */
function markPrivacyConsentSaved(error: unknown): unknown {
  if (!(error instanceof ApiError)) return error;
  error.details = { ...error.details, [PRIVACY_CONSENT_SAVED_DETAIL]: true };
  return error;
}

/**
 * The registration questions the child list can filter by (#6954), read
 * through the portal's catalog proxy since #7563.
 */
export async function fetchEnrollmentAnswerFilters(): Promise<
  EnrollmentAnswerFilter[]
> {
  const filters = await bffJson<EnrollmentAnswerFilterResponse[] | null>(
    "/api/students/enrollment-answer-filters",
  );
  return (filters ?? []).map(mapEnrollmentAnswerFilter);
}

/** The school's active care offerings that count as care (#4571). */
export async function fetchCareOfferingOptions(): Promise<
  CareOfferingOption[]
> {
  const offerings = await bffJson<CareOfferingOptionResponse[] | null>(
    "/api/students/care-offerings",
  );
  return (offerings ?? []).map((offering) => ({
    id: String(offering.id),
    name: offering.name,
  }));
}

/** A filter question of the contract, without the type the list needs not. */
function mapEnrollmentAnswerFilter(
  filter: EnrollmentAnswerFilterResponse,
): EnrollmentAnswerFilter {
  return {
    key: filter.key,
    label: filter.label,
    options: (filter.options ?? []).map((option) => ({
      value: option.value,
      label: option.label,
      count: option.count,
    })),
  };
}

interface StudentEnrollmentExtraField {
  key: string;
  label: string;
  type: string;
  target?: string;
  options?: { label: string; value: string }[];
  value: unknown;
}

export interface StudentEnrollmentExtraFieldGroup {
  request_id: string;
  phase_name: string;
  submitted_at: string;
  fields: StudentEnrollmentExtraField[];
}

export async function fetchStudentEnrollmentExtraFields(
  id: string,
): Promise<StudentEnrollmentExtraFieldGroup[]> {
  return bffJson<StudentEnrollmentExtraFieldGroup[]>(
    `/api/students/${encodeURIComponent(id)}/enrollment-extra-fields`,
  );
}

/**
 * Updates a child and, when the form changed it, the privacy consent.
 *
 * A 409 carrying a conflict list means a linked child's own departure plan
 * does not allow the requested "läuft mit" days. It is a question, not a
 * failure: it arrives as CompanionPlanConflictError, and the caller re-sends
 * with extend_companion_plans after the user confirms. Nothing was written.
 * Every other refusal keeps code, field errors and request ID (#2513); the
 * predicates in student-update-errors recognise the companion ones by code.
 *
 * Consent BEFORE the student PUT, deliberately. Both writes can fail, so one
 * of them has to run while the other is still undone, and the two are not
 * interchangeable. The consent PUT is a plain upsert of the two values in
 * this update: failing it leaves the student untouched, and a retry replays
 * the identical write. The student PUT carries the companion fingerprint
 * (#1694), so once it commits, a retry of the same payload is refused as
 * `students.companions_changed`. Running it last means a reported failure
 * never hides a committed companion write; a student PUT failing on top of a
 * committed consent write says so (markPrivacyConsentSaved).
 *
 * The consequence for callers: a consent pair in the update is WRITTEN,
 * refused student PUT or not, so only a save that actually changes it may
 * send it.
 *
 * Mounted "läuft mit" views refetch when the write changed the links: the
 * backend's verdict, or what the update can change when it sent none. An
 * open Laufgemeinschaft form answers that by discarding its draft, so a
 * write that changed none announces nothing.
 */
export async function updateStudent(
  id: string,
  update: StudentUpdate,
): Promise<Student> {
  const consent = sentConsentPair(update);
  if (consent) await writeStudentConsent(id, consent);

  let response: Response;
  try {
    response = await sessionFetch(`/api/students/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(prepareStudentForBackend(update)),
    });
  } catch (error) {
    throw consent ? markPrivacyConsentSaved(error) : error;
  }
  if (!response.ok) {
    const body = await response.text();
    const error =
      response.status === 409 && isCompanionPlanConflictResponse(body)
        ? new CompanionPlanConflictError(body)
        : apiErrorFromText(
            `Student update failed (${response.status})`,
            response.status,
            body,
          );
    throw consent ? markPrivacyConsentSaved(error) : error;
  }
  const { data } = (await response.json()) as { data: StudentResponse };
  if (data.companions_changed ?? writeMayChangeCompanions(update)) {
    notifyStudentCompanionsChanged();
  }
  return {
    ...mapStudentResponse(data),
    ...(await readConsentAfterWrite(id, consent)),
  };
}

/** The latest recorded change of a tracked field (#1455). */
export interface StudentFieldChange {
  id: string;
  field: string;
  /** Already formatted German values. */
  old_value: string;
  new_value: string;
  edited_by: string;
  changed_at: string;
}

/** Recorded field changes, newest first; the backend requires full access. */
export async function fetchStudentChangeHistory(
  id: string,
): Promise<StudentFieldChange[]> {
  return bffJson<StudentFieldChange[]>(
    `/api/students/${encodeURIComponent(id)}/change-history`,
  );
}

/** The child's Anwesenheitsprotokoll (#1425); 403 when the school turned it off. */
export async function fetchStudentAttendanceHistory(
  id: string,
): Promise<AttendanceHistory> {
  return mapAttendanceHistoryResponse(
    await bffJson<AttendanceHistoryWire>(
      `/api/students/${encodeURIComponent(id)}/attendance-history`,
    ),
  );
}

// ─── School check-in/out (web UI) ───────────────────────────────────────────

export type SchoolCheckinAction = "in" | "out";

/** Why a checkout is no departure for the day: the child goes to class (#5656). */
export type SchoolCheckoutReason = "class";

type SchoolCheckinStatus =
  "checked_in" | "on_yard" | "checked_out" | "not_checked_in";

const SCHOOL_CHECKIN_STATUSES: readonly SchoolCheckinStatus[] = [
  "checked_in",
  "on_yard",
  "checked_out",
  "not_checked_in",
];

/** The attendance state after the call, so the UI can update optimistically. */
interface SchoolCheckinResponse {
  studentId: string;
  /** undefined: a status this build does not know. */
  status: SchoolCheckinStatus | undefined;
  checkInTime?: string;
  checkOutTime?: string;
  yardSince?: string;
  /** The presence label Go derives („Anwesend“, „Im Unterricht“, …). */
  location: string;
  /** false when the student was already in the target state. */
  changed: boolean;
}

/**
 * Checks a child in or out of school via the web UI. Always writes
 * active.attendance; room visits stay with the IoT kiosk flow.
 */
export async function schoolCheckinStudent(
  studentId: string,
  action: SchoolCheckinAction,
  checkoutNote?: string,
  checkoutReason?: SchoolCheckoutReason,
): Promise<SchoolCheckinResponse> {
  // The early-checkout note (#3324) and the reason only go with "out". The
  // backend refuses a note together with a reason: the note is for going home
  // early, so the reason wins.
  const note = action === "out" ? checkoutNote?.trim() : undefined;
  const reason = action === "out" ? checkoutReason : undefined;
  try {
    const body: schoolCheckinRequest = reason
      ? { action, reason }
      : note
        ? { action, note }
        : { action };
    const data = await bffJson<schoolCheckinResponse>(
      `/api/students/${encodeURIComponent(studentId)}/school-checkin`,
      { method: "POST", body },
    );
    return {
      studentId: data.student_id,
      status: knownEnum(SCHOOL_CHECKIN_STATUSES, data.status),
      checkInTime: data.check_in_time,
      checkOutTime: data.check_out_time,
      yardSince: data.yard_since,
      location: data.location,
      changed: data.changed,
    };
  } catch (error) {
    logger.error("school_checkin_failed", {
      student_id: studentId,
      action,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// ─── Batch school check-in/out (#2359) ──────────────────────────────────────

interface SchoolCheckinBatchResult {
  studentId: string;
  ok: boolean;
  /** false when the student was already in the target state (no-op). */
  changed: boolean;
  /** The presence label Go derives; „Im Unterricht“ after a class checkout. */
  location?: string;
  /** Machine-readable failure code, e.g. "not_found". */
  error?: string;
}

export interface SchoolCheckinBatchOutcome {
  action: SchoolCheckinAction;
  results: SchoolCheckinBatchResult[];
  succeeded: number;
  failed: number;
}

/** The backend's maxSchoolCheckinBatchSize. */
const SCHOOL_CHECKIN_BATCH_CHUNK_SIZE = 1000;

/**
 * Applies one check-in/out action to a set of children (#2359). Children
 * already in the target state count as succeeded no-ops; children the caller
 * cannot act on come back with a per-child error while the rest are processed.
 *
 * Selections beyond the per-request cap go out as sequential requests. Throws
 * only when the FIRST request fails outright (e.g. 403 without users:checkin);
 * once anything has been processed, a failing later chunk is reported as
 * per-child `request_failed` entries, so the caller's partial-failure handling
 * (retained selection, named retry dialog) covers it truthfully.
 */
export async function schoolCheckinStudentsBatch(
  studentIds: string[],
  action: SchoolCheckinAction,
  checkoutReason?: SchoolCheckoutReason,
): Promise<SchoolCheckinBatchOutcome> {
  const outcome: SchoolCheckinBatchOutcome = {
    action,
    results: [],
    succeeded: 0,
    failed: 0,
  };

  for (
    let offset = 0;
    offset < studentIds.length;
    offset += SCHOOL_CHECKIN_BATCH_CHUNK_SIZE
  ) {
    const chunk = studentIds.slice(
      offset,
      offset + SCHOOL_CHECKIN_BATCH_CHUNK_SIZE,
    );
    try {
      // String IDs on this endpoint: they are matched back against the
      // selection, and a JSON number would corrupt int64 IDs above 2^53-1.
      const body: schoolCheckinBatchRequest = checkoutReason
        ? { action, reason: checkoutReason, student_ids: chunk }
        : { action, student_ids: chunk };
      const data = await bffJson<schoolCheckinBatchResponse>(
        "/api/students/school-checkin/batch",
        { method: "POST", body },
      );
      outcome.succeeded += data.succeeded;
      outcome.failed += data.failed;
      outcome.results.push(
        ...(data.results ?? []).map((result) => ({
          studentId: result.student_id,
          ok: result.ok,
          changed: result.changed,
          location: result.location,
          error: result.error,
        })),
      );
    } catch (error) {
      logger.error("school_checkin_batch_failed", {
        action,
        student_count: chunk.length,
        chunk_offset: offset,
        error: error instanceof Error ? error.message : String(error),
      });
      if (offset === 0) throw error;
      for (const studentId of studentIds.slice(offset)) {
        outcome.results.push({
          studentId,
          ok: false,
          changed: false,
          error: "request_failed",
        });
        outcome.failed++;
      }
      break;
    }
  }

  return outcome;
}

// ─── Deletion ───────────────────────────────────────────────────────────────

export interface StudentDeletionCounts {
  timetable_assignments: number;
  activity_enrollments: number;
  attendance_records: number;
  care_schedules: number;
  guardian_links: number;
  companion_links: number;
  communications: number;
  consents: number;
  enrollment_references: number;
  other_records: number;
}

export interface StudentDeletionImpact {
  confirmation_name: string;
  fingerprint: string;
  total: number;
  counts: StudentDeletionCounts;
  preserved: {
    guardian_profiles: boolean;
    parent_accounts: boolean;
    other_students: boolean;
    shared_instances: boolean;
  };
}

export type StudentDeletionReason =
  | "test_data"
  | "incorrect_entry"
  | "duplicate"
  | "privacy_request"
  // Nur für Kinder, deren Betreuung beendet ist (#2487): der reguläre
  // Austritt liegt lange genug zurück, die Aufbewahrungsfrist ist um.
  | "retention_expired";

interface DeleteStudentWithDataInput {
  expected_fingerprint: string;
  confirmation_name: string;
  reason: StudentDeletionReason;
  acknowledged: true;
}

export async function fetchStudentDeletionImpact(
  id: string,
  completionId?: string,
): Promise<StudentDeletionImpact> {
  return bffJson<StudentDeletionImpact>(
    completionId
      ? `/api/students/care-withdrawals/${encodeURIComponent(completionId)}/deletion-impact`
      : `/api/students/${encodeURIComponent(id)}/delete-impact`,
  );
}

export async function deleteStudentWithData(
  id: string,
  input: DeleteStudentWithDataInput,
  completionId?: string,
): Promise<void> {
  await bffJson<unknown>(
    completionId
      ? `/api/students/care-withdrawals/${encodeURIComponent(completionId)}`
      : `/api/students/${encodeURIComponent(id)}`,
    { method: "DELETE", body: input },
  );
}

// ─── Student photo (Datenverwaltung) ────────────────────────────────────────

/**
 * Uploads a photo for a child. Callers pass the file through `compressAvatar`
 * (lib/image-utils) first: a raw 5+ MB camera JPEG would hit the backend's
 * `maxStudentPhotoBody` cap.
 *
 * The backend requires `operations.student_photos_enabled` and either a stored
 * photo consent or `consentAcknowledged`, which stamps the consent together
 * with the photo. The returned URL is opaque.
 */
export async function uploadStudentPhoto(
  studentId: string,
  file: Blob,
  options: { consentAcknowledged?: boolean } = {},
): Promise<{ photoUrl: string }> {
  const formData = new FormData();
  formData.append(
    "photo",
    file instanceof File
      ? file
      : new File([file], "student-photo.jpg", {
          type: file.type || "image/jpeg",
        }),
  );
  if (options.consentAcknowledged) {
    formData.append("consent_acknowledged", "true");
  }
  const data = await bffJson<{ photo_url: string }>(
    `/api/students/${encodeURIComponent(studentId)}/photo`,
    { method: "POST", body: formData },
  );
  return { photoUrl: data.photo_url };
}

/** Removes a child's photo (idempotent). */
export async function deleteStudentPhoto(studentId: string): Promise<void> {
  await bffJson<unknown>(
    `/api/students/${encodeURIComponent(studentId)}/photo`,
    { method: "DELETE" },
  );
}

// ─── Room history stop (#3844) ──────────────────────────────────────────────

/** Whether a child's room history and mood are stopped, and since when. */
export interface RoomHistoryStop {
  stopped: boolean;
  /** Instant the stop began; null while recording. */
  stoppedAt: string | null;
  /** Completed visits a new stop deleted; zero otherwise. */
  deletedVisits: number;
}

function mapRoomHistoryStop(
  response: RoomHistoryStopResponse,
): RoomHistoryStop {
  return {
    stopped: response.stopped,
    stoppedAt: response.stopped_at ?? null,
    deletedVisits: response.deleted_visits,
  };
}

function roomHistoryStopPath(studentId: string): string {
  return `/api/students/${encodeURIComponent(studentId)}/room-history-stop`;
}

/** Reads the stop of a child's room history and mood. */
export async function fetchRoomHistoryStop(
  studentId: string,
): Promise<RoomHistoryStop> {
  return mapRoomHistoryStop(
    await bffJson<RoomHistoryStopResponse>(roomHistoryStopPath(studentId)),
  );
}

/**
 * Stops the child's room history and mood and deletes its completed visits.
 * Only the OGS administration (config:manage) may.
 */
export async function stopRoomHistory(
  studentId: string,
): Promise<RoomHistoryStop> {
  return mapRoomHistoryStop(
    await bffJson<RoomHistoryStopResponse>(roomHistoryStopPath(studentId), {
      method: "PUT",
    }),
  );
}

/** Lifts the stop; moto records again from now on. */
export async function resumeRoomHistory(
  studentId: string,
): Promise<RoomHistoryStop> {
  return mapRoomHistoryStop(
    await bffJson<RoomHistoryStopResponse>(roomHistoryStopPath(studentId), {
      method: "DELETE",
    }),
  );
}

// ─── Privacy consent ────────────────────────────────────────────────────────

function mapConsentPair(
  consent: PrivacyConsentResponse | PrivacyConsentDefaultsResponse,
): PrivacyConsent {
  return {
    accepted: consent.accepted,
    dataRetentionDays: consent.data_retention_days,
  };
}

/**
 * The stored consent of a child, or the school's defaults when none is
 * stored. Refused (403) without read access, where the detail read only
 * carries the defaults.
 */
export async function fetchStudentPrivacyConsent(
  studentId: string,
): Promise<PrivacyConsent> {
  return mapConsentPair(
    await bffJson<PrivacyConsentResponse>(
      `/api/students/${encodeURIComponent(studentId)}/privacy-consent`,
    ),
  );
}

/** The consent a new child starts with: the school's defaults. */
export async function fetchPrivacyConsentDefaults(): Promise<PrivacyConsent> {
  return mapConsentPair(
    await bffJson<PrivacyConsentDefaultsResponse>(
      "/api/students/privacy-consent/defaults",
    ),
  );
}
