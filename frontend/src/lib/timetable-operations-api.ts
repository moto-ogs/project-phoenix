import { ApiError, wireErrorCode } from "./api-error";
import { bffJson } from "./bff-fetch";
import type { spontaneousStartRequest } from "./contract/timetable.generated";
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

interface PlannedNowOptions {
  date?: string;
  horizonMinutes?: number;
  limit?: number;
  includeRoster?: boolean;
  /**
   * "past" lists today's finished blocks instead of the upcoming window
   * (#2335); "day" lists the whole day in every lifecycle state (#2383).
   */
  scope?: "past" | "day";
}

export type SpontaneousStartBody = Required<
  Pick<spontaneousStartRequest, "title" | "room_id">
> &
  Pick<spontaneousStartRequest, "activity_group_id" | "staff_ids">;

// Terminal reopen failures discard the five-minute undo banner. Room,
// capacity, and concurrent-check-in conflicts also arrive as HTTP 409, but
// those can clear while the window is still open.
export function isReopenUnavailableError(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    (err.status === 403 ||
      wireErrorCode(err.code) === "timetable.invalid_transition")
  );
}

export const timetableOperationsApi = {
  async plannedNow(
    dateOrOptions?: string | PlannedNowOptions,
  ): Promise<PlannedTimetableInstance[]> {
    const options =
      typeof dateOrOptions === "string"
        ? { date: dateOrOptions }
        : dateOrOptions;
    const raw = await bffJson(
      "tenant",
      "GET /api/timetable/operations/planned-now",
      {
        query: {
          date: options?.date || undefined,
          horizon_minutes: options?.horizonMinutes,
          limit: options?.limit,
          include_roster: options?.includeRoster,
          scope: options?.scope,
        },
      },
    );
    return (raw.instances ?? []).map(mapPlannedInstance);
  },

  async start(instanceId: string): Promise<StartOperationResult> {
    const raw = await bffJson(
      "tenant",
      "POST /api/timetable/operations/instances/{id}/start",
      { params: { id: instanceId } },
    );
    return mapStartOperation(raw);
  },

  async createAndStartSpontaneous(
    body: SpontaneousStartBody,
  ): Promise<StartOperationResult> {
    const raw = await bffJson(
      "tenant",
      "POST /api/timetable/operations/spontaneous/start",
      { body },
    );
    return mapStartOperation(raw);
  },

  async roster(instanceId: string): Promise<TimetableRoster> {
    const raw = await bffJson(
      "tenant",
      "GET /api/timetable/operations/instances/{id}/roster",
      { params: { id: instanceId } },
    );
    return mapRoster(raw);
  },

  async rosterByActiveGroup(activeGroupId: string): Promise<TimetableRoster> {
    const raw = await bffJson(
      "tenant",
      "GET /api/timetable/operations/active-groups/{id}/roster",
      { params: { id: activeGroupId } },
    );
    return mapRoster(raw);
  },

  async checkIn(
    instanceId: string,
    studentId: string,
  ): Promise<TimetableRoster> {
    const raw = await bffJson(
      "tenant",
      "POST /api/timetable/operations/instances/{id}/students/{student_id}/check-in",
      { params: { id: instanceId, student_id: studentId } },
    );
    return mapRoster(raw);
  },

  // Sammel-Check-in (#3824): alle ausgewählten Kinder in einem Aufruf. Der
  // Server trägt alle ein oder keines.
  async checkInMany(
    instanceId: string,
    studentIds: readonly string[],
  ): Promise<TimetableRoster> {
    const raw = await bffJson(
      "tenant",
      "POST /api/timetable/operations/instances/{id}/students/check-in",
      { params: { id: instanceId }, body: { student_ids: [...studentIds] } },
    );
    return mapRoster(raw);
  },

  async checkOut(
    instanceId: string,
    studentId: string,
  ): Promise<TimetableRoster> {
    const raw = await bffJson(
      "tenant",
      "POST /api/timetable/operations/instances/{id}/students/{student_id}/check-out",
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
      "tenant",
      "PATCH /api/timetable/operations/instances/{id}/students/{student_id}/attendance",
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
      "tenant",
      "PUT /api/timetable/operations/instances/{id}/students/{student_id}/homework-feedback",
      { params: { id: instanceId, student_id: studentId }, body },
    );
  },

  async complete(
    instanceId: string,
    confirmedPresentStudentIds: string[],
  ): Promise<{ reopenUntil?: string }> {
    const raw = await bffJson(
      "tenant",
      "POST /api/timetable/operations/instances/{id}/complete",
      {
        params: { id: instanceId },
        body: { confirmed_present_student_ids: confirmedPresentStudentIds },
      },
    );
    return { reopenUntil: raw.reopen_until };
  },

  async reopen(instanceId: string): Promise<StartOperationResult> {
    const raw = await bffJson(
      "tenant",
      "POST /api/timetable/operations/instances/{id}/reopen",
      { params: { id: instanceId } },
    );
    return mapStartOperation(raw);
  },
};
