// Pickup Schedule API Client: the tenant routes of the Abholplan (#7806).
import { ApiError } from "./api-error";
import { bffJson } from "./bff-fetch";
import type * as studentsContract from "./contract/students.generated";
import type {
  PickupData,
  PickupExceptionFormData,
  PickupException,
  PickupNoteFormData,
  PickupNote,
  DepartureException,
  DepartureMode,
} from "./pickup-schedule-helpers";
import {
  mapDepartureExceptionResponse,
  mapPickupDataResponse,
  mapPickupExceptionResponse,
  mapPickupNoteResponse,
  mapPickupExceptionFormToBackend,
  mapPickupNoteFormToBackend,
} from "./pickup-schedule-helpers";

export type PickupAdjustmentResolution = "exception" | "offering";

const POSITIVE_ID = /^[1-9]\d*$/;

export async function bulkUpsertPickupSchedules(
  studentIds: string[],
  schedules: studentsContract.PickupScheduleInput[],
  confirmedException = false,
): Promise<studentsContract.BulkUpsertResult> {
  const ids = [...new Set(studentIds)];
  if (
    ids.length === 0 ||
    ids.length > 500 ||
    ids.some((id) => !POSITIVE_ID.test(id))
  ) {
    throw new ApiError("Ungültige Kinderauswahl", 400, {
      code: "general.input",
    });
  }

  return bffJson("tenant", "POST /api/students/pickup-schedules/bulk", {
    body: {
      student_ids: ids,
      schedules,
      ...(confirmedException ? { confirmed_exception: true } : {}),
    },
    errorMessage: "Failed to update pickup schedules",
  });
}

export async function previewStudentPickupAdjustment(
  studentId: string,
  payload: studentsContract.pickupAdjustmentRequest,
): Promise<studentsContract.pickupAdjustmentPreviewResponse> {
  return bffJson("tenant", "POST /api/students/{id}/pickup-schedules/preview", {
    params: { id: studentId },
    body: payload,
    errorMessage: "Gehzeiten konnten nicht geprüft werden",
  });
}

/** A switched offering reports its effect on the Regeltermine (#5102). */
export async function applyStudentPickupAdjustment(
  studentId: string,
  payload: studentsContract.pickupAdjustmentRequest & {
    preview_token: string;
    resolution: PickupAdjustmentResolution;
  },
): Promise<studentsContract.pickupAdjustmentResponse> {
  return bffJson("tenant", "POST /api/students/{id}/pickup-schedules/apply", {
    params: { id: studentId },
    body: payload,
    errorMessage: "Gehzeiten konnten nicht gespeichert werden",
  });
}

/**
 * Fetch pickup schedules and exceptions for a student
 */
export async function fetchStudentPickupData(
  studentId: string,
  range?: { from: string; to: string },
): Promise<PickupData> {
  const data = await bffJson(
    "tenant",
    "GET /api/students/{id}/pickup-schedules",
    {
      params: { id: studentId },
      query: { from: range?.from, to: range?.to },
      errorMessage: "Failed to fetch pickup schedules",
    },
  );
  return mapPickupDataResponse(data);
}

/**
 * Setzt die Gehzeit eines Wochentags auf die Angebots-Gehzeit zurück (#2290).
 * Der Server lehnt den Reset ab, wenn an diesem Datum keine Angebots-Gehzeit gilt.
 */
export async function resetStudentPickupToOffering(
  studentId: string,
  weekday: number,
  date: string,
): Promise<PickupData> {
  const data = await bffJson(
    "tenant",
    "POST /api/students/{id}/pickup-schedules/reset-offering",
    {
      params: { id: studentId },
      body: { weekday, date },
      errorMessage: "Failed to reset pickup schedule",
    },
  );
  return mapPickupDataResponse(data);
}

/**
 * Create a pickup exception for a student
 */
export async function createStudentPickupException(
  studentId: string,
  data: PickupExceptionFormData,
): Promise<PickupException> {
  const created = await bffJson(
    "tenant",
    "POST /api/students/{id}/pickup-exceptions",
    {
      params: { id: studentId },
      body: mapPickupExceptionFormToBackend(data),
      errorMessage: "Failed to create pickup exception",
    },
  );
  return mapPickupExceptionResponse(created);
}

/**
 * Update a pickup exception
 */
export async function updateStudentPickupException(
  studentId: string,
  exceptionId: string,
  data: PickupExceptionFormData,
): Promise<PickupException> {
  const updated = await bffJson(
    "tenant",
    "PUT /api/students/{id}/pickup-exceptions/{exceptionId}",
    {
      params: { id: studentId, exceptionId },
      body: mapPickupExceptionFormToBackend(data),
      errorMessage: "Failed to update pickup exception",
    },
  );
  return mapPickupExceptionResponse(updated);
}

/**
 * Delete a pickup exception
 */
export async function deleteStudentPickupException(
  studentId: string,
  exceptionId: string,
): Promise<void> {
  await bffJson(
    "tenant",
    "DELETE /api/students/{id}/pickup-exceptions/{exceptionId}",
    {
      params: { id: studentId, exceptionId },
      errorMessage: "Failed to delete pickup exception",
    },
  );
}

/**
 * Setzt die Abholart eines einzelnen Tages (#3945). Ein Tag hat höchstens
 * einen Wert; erneutes Speichern ersetzt ihn.
 */
export async function setStudentDepartureException(
  studentId: string,
  date: string,
  data: { departureMode: DepartureMode; reason?: string },
): Promise<DepartureException | null> {
  const result = await bffJson(
    "tenant",
    "PUT /api/students/{id}/departure-exceptions/{date}",
    {
      params: { id: studentId, date },
      body: { departure_mode: data.departureMode, reason: data.reason },
      errorMessage: "Failed to set departure exception",
    },
  );
  return mapDepartureExceptionResponse(result);
}

/**
 * Gibt den Tag an den Wochenplan zurück: die Abholart des Tages entfällt.
 */
export async function deleteStudentDepartureException(
  studentId: string,
  date: string,
): Promise<void> {
  await bffJson(
    "tenant",
    "DELETE /api/students/{id}/departure-exceptions/{date}",
    {
      params: { id: studentId, date },
      errorMessage: "Failed to delete departure exception",
    },
  );
}

/**
 * Setzt, wer das Kind an einem Tag abholt (#7655): eine abholberechtigte
 * Person oder eine einmalige Person mit Namen. Erneutes Speichern ersetzt sie.
 */
export async function setStudentPickupPerson(
  studentId: string,
  date: string,
  person: { guardianProfileId: string } | { name: string },
): Promise<void> {
  await bffJson("tenant", "PUT /api/students/{id}/pickup-persons/{date}", {
    params: { id: studentId, date },
    body:
      "guardianProfileId" in person
        ? { guardian_profile_id: person.guardianProfileId }
        : { name: person.name },
    errorMessage: "Failed to set pickup person",
  });
}

/** Entfernt die Abholperson des Tages (#7655). */
export async function deleteStudentPickupPerson(
  studentId: string,
  date: string,
): Promise<void> {
  await bffJson("tenant", "DELETE /api/students/{id}/pickup-persons/{date}", {
    params: { id: studentId, date },
    errorMessage: "Failed to delete pickup person",
  });
}

// =============================================================================
// PICKUP NOTES API
// =============================================================================

/**
 * Create a pickup note for a student
 */
export async function createStudentPickupNote(
  studentId: string,
  data: PickupNoteFormData,
): Promise<PickupNote> {
  const created = await bffJson(
    "tenant",
    "POST /api/students/{id}/pickup-notes",
    {
      params: { id: studentId },
      body: mapPickupNoteFormToBackend(data),
      errorMessage: "Failed to create pickup note",
    },
  );
  return mapPickupNoteResponse(created);
}

/**
 * Update a pickup note
 */
export async function updateStudentPickupNote(
  studentId: string,
  noteId: string,
  data: PickupNoteFormData,
  expectedVersion: string,
): Promise<PickupNote> {
  const updated = await bffJson(
    "tenant",
    "PUT /api/students/{id}/pickup-notes/{noteId}",
    {
      params: { id: studentId, noteId },
      body: {
        ...mapPickupNoteFormToBackend(data),
        expected_version: expectedVersion,
      },
      errorMessage: "Failed to update pickup note",
    },
  );
  return mapPickupNoteResponse(updated);
}

/**
 * Delete a pickup note
 */
export async function deleteStudentPickupNote(
  studentId: string,
  noteId: string,
): Promise<void> {
  await bffJson("tenant", "DELETE /api/students/{id}/pickup-notes/{noteId}", {
    params: { id: studentId, noteId },
    errorMessage: "Failed to delete pickup note",
  });
}

// =============================================================================
// BULK PICKUP TIMES (types for the OGS dashboard)
// =============================================================================

/**
 * Frontend day note in bulk response
 */
interface BulkDayNote {
  id: string;
  content: string;
}

/**
 * Frontend-friendly bulk pickup time
 */
export interface BulkPickupTime {
  studentId: string;
  date: string;
  weekdayName: string;
  pickupTime?: string;
  isException: boolean;
  /** The Abholart set for this day only (#3946); only the supervision
   *  dashboard carries it. */
  dayDepartureMode?: DepartureMode;
  dayNotes: BulkDayNote[];
  notes?: string;
}
