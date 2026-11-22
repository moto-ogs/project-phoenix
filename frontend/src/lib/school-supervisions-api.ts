import { bffJson } from "./bff-fetch";
import { requiredDay } from "./contract/required-day";
// Client-seitige API für die Aufsichten im Schul-Portal ("moto schule", #2527).
//
// Gleiche Nutzlast wie die OGS-Aufsicht (lib/timetable-operations-types), aber
// über die Next.js-Routen unter /api/school/*, die mit dem school-Token gegen
// /school/supervisions sprechen. Das Backend beschränkt jede Antwort auf die
// Blöcke, in die diese Lehrkraft im Betreuungsplan eingeteilt ist.

import type * as schoolSupervisionsContract from "./contract/school-supervisions.generated";
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

export const schoolSupervisionsApi = {
  /** Die eigenen Aufsichten von heute, in jedem Zustand. */
  async myDay(): Promise<PlannedTimetableInstance[]> {
    const raw = await bffJson("school", "GET /school/supervisions/");
    return (raw.instances ?? []).map(mapPlannedInstance);
  },

  async roster(instanceId: string): Promise<TimetableRoster> {
    const raw = await bffJson(
      "school",
      "GET /school/supervisions/{id}/roster",
      {
        params: { id: instanceId },
      },
    );
    return mapRoster(raw);
  },

  async start(instanceId: string): Promise<StartOperationResult> {
    const raw = await bffJson(
      "school",
      "POST /school/supervisions/{id}/start",
      {
        params: { id: instanceId },
      },
    );
    return mapStartOperation(raw);
  },

  async complete(
    instanceId: string,
    confirmedPresentStudentIds: string[],
  ): Promise<void> {
    await bffJson("school", "POST /school/supervisions/{id}/complete", {
      params: { id: instanceId },
      body: { confirmed_present_student_ids: confirmedPresentStudentIds },
    });
  },

  async checkIn(
    instanceId: string,
    studentId: string,
  ): Promise<TimetableRoster> {
    const raw = await bffJson(
      "school",
      "POST /school/supervisions/{id}/students/{student_id}/check-in",
      { params: { id: instanceId, student_id: studentId } },
    );
    return mapRoster(raw);
  },

  async checkOut(
    instanceId: string,
    studentId: string,
  ): Promise<TimetableRoster> {
    const raw = await bffJson(
      "school",
      "POST /school/supervisions/{id}/students/{student_id}/check-out",
      { params: { id: instanceId, student_id: studentId } },
    );
    return mapRoster(raw);
  },

  async patchAttendance(
    instanceId: string,
    studentId: string,
    body: AttendancePatchBody,
  ): Promise<void> {
    await bffJson(
      "school",
      "PATCH /school/supervisions/{id}/students/{student_id}/attendance",
      { params: { id: instanceId, student_id: studentId }, body },
    );
  },

  /** Rückmeldung zu den Hausaufgaben eines Kindes der Lernzeit (#4796). */
  async saveHomeworkFeedback(
    instanceId: string,
    studentId: string,
    body: HomeworkFeedbackBody,
  ): Promise<void> {
    await bffJson(
      "school",
      "PUT /school/supervisions/{id}/students/{student_id}/homework-feedback",
      { params: { id: instanceId, student_id: studentId }, body },
    );
  },

  /** Abhol- und Notfallinformationen eines Kindes. Wird protokolliert. */
  async studentSheet(
    instanceId: string,
    studentId: string,
  ): Promise<SupervisionStudentSheet> {
    const raw = await bffJson(
      "school",
      "GET /school/supervisions/{id}/students/{student_id}/sheet",
      { params: { id: instanceId, student_id: studentId } },
    );
    return mapSheet(raw);
  },
};
