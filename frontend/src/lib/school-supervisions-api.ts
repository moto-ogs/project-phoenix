import type { ApiResponse } from "./api-envelope";
import { apiErrorFromBody, transportFetch } from "./api-error";
import { requiredDay } from "./contract/required-day";
// Client-seitige API für die Aufsichten im Schul-Portal ("moto schule", #2527).
//
// Gleiche Nutzlast wie die OGS-Aufsicht (lib/timetable-operations-types), aber
// über die Next.js-Routen unter /api/school/*, die mit dem school-Token gegen
// /school/supervisions sprechen. Das Backend beschränkt jede Antwort auf die
// Blöcke, in die diese Lehrkraft im Betreuungsplan eingeteilt ist.

import type * as schoolSupervisionsContract from "./contract/school-supervisions.generated";
import type * as sharedContract from "./contract/shared.generated";
import type {
  AttendancePatchBody,
  HomeworkFeedbackBody,
  PlannedTimetableInstance,
  StartOperationResult,
  TimetableRoster,
} from "./timetable-operations-types";
import {
  mapPlannedInstance,
  mapRoster,
  mapStartOperation,
} from "./timetable-operations-types";

/** Eine Kontaktperson auf dem Kind-Infoblatt. */
export interface SupervisionContact {
  name: string;
  relationship?: string;
  /** Eine Nummer je Eintrag — das Backend fasst nichts zu einer Zeile zusammen. */
  phones: string[];
  note?: string;
}

/** Abhol- und Notfallinformationen eines Kindes der eigenen Aufsicht. */
export interface SupervisionStudentSheet {
  studentId: string;
  firstName: string;
  lastName: string;
  schoolClass?: string;
  date: string;
  arrival?: string;
  pickup?: string;
  departure: string;
  status?: string;
  pickupContacts: SupervisionContact[];
  emergencyContacts: SupervisionContact[];
}

function mapContact(
  raw: schoolSupervisionsContract.SupervisionContact,
): SupervisionContact {
  return { ...raw, phones: raw.phones ?? [] };
}

async function unwrap<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw apiErrorFromBody(
      `Anfrage fehlgeschlagen (HTTP ${response.status})`,
      response.status,
      await response.json().catch(() => undefined),
    );
  }
  const envelope = (await response.json()) as ApiResponse<T>;
  return envelope.data;
}

function jsonRequest(method: string, body?: unknown): RequestInit {
  return {
    method,
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
  };
}

function mapSheet(
  raw: schoolSupervisionsContract.SupervisionStudentSheet,
): SupervisionStudentSheet {
  return {
    studentId: raw.student_id,
    firstName: raw.first_name,
    lastName: raw.last_name,
    schoolClass: raw.school_class,
    date: requiredDay(raw.date, "supervision_student_sheet.date"),
    arrival: raw.arrival,
    pickup: raw.pickup,
    departure: raw.departure,
    status: raw.status,
    pickupContacts: (raw.pickup_contacts ?? []).map(mapContact),
    emergencyContacts: (raw.emergency_contacts ?? []).map(mapContact),
  };
}

const base = "/api/school/supervisions";

export const schoolSupervisionsApi = {
  /** Die eigenen Aufsichten von heute, in jedem Zustand. */
  async myDay(): Promise<PlannedTimetableInstance[]> {
    const raw =
      await unwrap<schoolSupervisionsContract.SchoolSupervisionsResponse>(
        await transportFetch(base, {
          credentials: "include",
          headers: { Accept: "application/json" },
        }),
      );
    return (raw.instances ?? []).map(mapPlannedInstance);
  },

  async roster(instanceId: string): Promise<TimetableRoster> {
    const raw = await unwrap<sharedContract.OperationRoster>(
      await transportFetch(`${base}/${instanceId}/roster`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      }),
    );
    return mapRoster(raw);
  },

  async start(instanceId: string): Promise<StartOperationResult> {
    const raw = await unwrap<sharedContract.startOperationResponse>(
      await transportFetch(`${base}/${instanceId}/start`, jsonRequest("POST")),
    );
    return mapStartOperation(raw);
  },

  async complete(
    instanceId: string,
    confirmedPresentStudentIds: string[],
  ): Promise<void> {
    await unwrap<unknown>(
      await transportFetch(
        `${base}/${instanceId}/complete`,
        jsonRequest("POST", {
          confirmed_present_student_ids: confirmedPresentStudentIds,
        } satisfies sharedContract.CompleteOperationRequest),
      ),
    );
  },

  async checkIn(
    instanceId: string,
    studentId: string,
  ): Promise<TimetableRoster> {
    const raw = await unwrap<sharedContract.OperationRoster>(
      await transportFetch(
        `${base}/${instanceId}/students/${studentId}/check-in`,
        jsonRequest("POST"),
      ),
    );
    return mapRoster(raw);
  },

  async checkOut(
    instanceId: string,
    studentId: string,
  ): Promise<TimetableRoster> {
    const raw = await unwrap<sharedContract.OperationRoster>(
      await transportFetch(
        `${base}/${instanceId}/students/${studentId}/check-out`,
        jsonRequest("POST"),
      ),
    );
    return mapRoster(raw);
  },

  async patchAttendance(
    instanceId: string,
    studentId: string,
    body: AttendancePatchBody,
  ): Promise<void> {
    await unwrap<unknown>(
      await transportFetch(
        `${base}/${instanceId}/students/${studentId}/attendance`,
        jsonRequest("PATCH", body),
      ),
    );
  },

  /** Rückmeldung zu den Hausaufgaben eines Kindes der Lernzeit (#4796). */
  async saveHomeworkFeedback(
    instanceId: string,
    studentId: string,
    body: HomeworkFeedbackBody,
  ): Promise<void> {
    await unwrap<unknown>(
      await transportFetch(
        `${base}/${instanceId}/students/${studentId}/homework-feedback`,
        jsonRequest("PUT", body),
      ),
    );
  },

  /** Abhol- und Notfallinformationen eines Kindes. Wird protokolliert. */
  async studentSheet(
    instanceId: string,
    studentId: string,
  ): Promise<SupervisionStudentSheet> {
    const raw =
      await unwrap<schoolSupervisionsContract.SupervisionStudentSheet>(
        await transportFetch(
          `${base}/${instanceId}/students/${studentId}/sheet`,
          {
            credentials: "include",
            headers: { Accept: "application/json" },
          },
        ),
      );
    return mapSheet(raw);
  },
};
