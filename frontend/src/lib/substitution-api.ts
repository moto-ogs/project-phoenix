import { ApiError } from "./api-error";
import { bffJson } from "./bff-fetch";
import type { assignmentRequest } from "./contract/substitutions.generated";
import {
  type RunningSupervision,
  type Substitution,
  type TeacherAvailability,
  formatDateForBackend,
  mapSubstitutionResponse,
  mapSubstitutionsResponse,
  mapRunningSupervision,
  mapSubstitutionOverview,
  mapScheduleSubstitutionOverview,
  type ScheduleSubstitutionOverview,
  type SubstitutionOverview,
  prepareSubstitutionForBackend,
  substitutionAssignmentResult,
} from "./substitution-helpers";
import {
  mapApplyDeviations,
  mapBulkSubstitution,
  prepareApplyDeviationsBody,
  prepareBulkSubstitutionBody,
} from "./timetable-helpers";
import type {
  ApplyDeviationsInput,
  ApplyDeviationsResponse,
  BulkSubstitutionInput,
  BulkSubstitutionResponse,
} from "./timetable-types";

const overview = (
  query: {
    from?: string;
    to?: string;
    date?: string;
    active_group_id?: string;
  },
  errorMessage: string,
) => bffJson("tenant", "GET /api/substitutions/", { query, errorMessage });

const assign = (body: assignmentRequest, errorMessage: string) =>
  bffJson("tenant", "POST /api/substitutions/", { body, errorMessage });

const end = (body: { type: string; id: string }, errorMessage: string) =>
  bffJson("tenant", "POST /api/substitutions/end", { body, errorMessage });

class SubstitutionService {
  async fetchOverview(): Promise<SubstitutionOverview> {
    return mapSubstitutionOverview(
      await overview({}, "substitution overview failed"),
    );
  }

  async fetchScheduleOverview(
    from: string,
    to: string,
  ): Promise<ScheduleSubstitutionOverview> {
    return mapScheduleSubstitutionOverview(
      await overview({ from, to }, "schedule substitution overview failed"),
    );
  }

  async applyScheduleSubstitution(
    instanceId: string,
    input: ApplyDeviationsInput,
  ): Promise<ApplyDeviationsResponse> {
    if (input.cancel) {
      // Programmierfehler, kein Nutzerfehler: Absagen haben einen eigenen
      // Weg. Der Absturztext des Anzeigewegs ist dafür die richtige Folge.
      throw new Error("cancellations do not go through a substitution");
    }
    const body = prepareApplyDeviationsBody(input);
    const answer = await assign(
      {
        type: "schedule_substitution",
        schedule_substitution: { ...body, instance_id: instanceId },
      },
      "schedule substitution failed",
    );
    return mapApplyDeviations(
      substitutionAssignmentResult(answer, "schedule_substitution"),
    );
  }

  async applyBulkSubstitution(
    input: BulkSubstitutionInput,
  ): Promise<BulkSubstitutionResponse> {
    const answer = await assign(
      {
        type: "schedule_substitution",
        schedule_substitution: {
          whole_days: prepareBulkSubstitutionBody(input),
        },
      },
      "schedule substitution failed",
    );
    return mapBulkSubstitution(
      substitutionAssignmentResult(answer, "schedule_substitution"),
    );
  }

  async fetchSubstitutions(date?: Date): Promise<Substitution[]> {
    const body = await overview(
      { date: date ? formatDateForBackend(date) : undefined },
      "group handovers failed",
    );
    return mapSubstitutionsResponse(body.group_handovers);
  }

  async fetchAvailableTeachers(): Promise<TeacherAvailability[]> {
    const body = await overview({}, "available staff failed");
    return (body.targets ?? []).map((staff) => {
      const [firstName = "", ...lastNameParts] = staff.full_name.split(" ");
      return {
        id: staff.id,
        firstName,
        lastName: lastNameParts.join(" "),
        inSubstitution: false,
        substitutionCount: 0,
      };
    });
  }

  async fetchRunningSupervision(
    activeGroupId: string,
  ): Promise<RunningSupervision> {
    const body = await overview(
      { active_group_id: activeGroupId },
      "running supervision failed",
    );
    const rows = body.running_supervisions;
    if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]) {
      throw new ApiError("invalid running supervision response", 500);
    }
    return mapRunningSupervision(rows[0]);
  }

  async addSupervisor(
    activeGroupId: string,
    targetStaffId: string,
  ): Promise<{ id: string; targetName: string }> {
    return this.postAdditionalSupervision(activeGroupId, targetStaffId, false);
  }

  /**
   * Hands the caller's running supervision over (#4763): the target becomes
   * a supervisor and the caller's own supervision ends. The children and
   * the planning stay as they are.
   */
  async handOverSupervision(
    activeGroupId: string,
    targetStaffId: string,
  ): Promise<{ id: string; targetName: string }> {
    return this.postAdditionalSupervision(activeGroupId, targetStaffId, true);
  }

  private async postAdditionalSupervision(
    activeGroupId: string,
    targetStaffId: string,
    handOver: boolean,
  ): Promise<{ id: string; targetName: string }> {
    const answer = await assign(
      {
        type: "additional_supervision",
        additional_supervision: {
          active_group_id: activeGroupId,
          target_staff_id: targetStaffId,
          ...(handOver ? { hand_over: true } : {}),
        },
      },
      handOver
        ? "supervision handover failed"
        : "additional supervision failed",
    );
    const body = substitutionAssignmentResult(answer, "additional_supervision");
    return { id: body.id, targetName: body.target.full_name };
  }

  /**
   * Ends the caller's own supervision while another supervisor stays
   * (#4763); the backend refuses with substitutions.last_supervisor
   * otherwise.
   */
  async releaseSupervision(activeGroupId: string): Promise<void> {
    await end(
      { type: "additional_supervision", id: activeGroupId },
      "supervision release failed",
    );
  }

  async createSubstitution(
    groupId: string,
    substituteStaffId: string,
    startDate: string,
    endDate: string,
  ): Promise<Substitution> {
    const answer = await assign(
      prepareSubstitutionForBackend(
        groupId,
        substituteStaffId,
        startDate,
        endDate,
      ),
      "group handover failed",
    );
    const result = substitutionAssignmentResult(answer, "group_handover");
    // A group handover always names its group and period; the contract
    // shares the type with the other kinds, where both are absent.
    if (!result.group || !result.period) {
      throw new ApiError("group handover answer without group or period", 502);
    }
    return mapSubstitutionResponse({
      id: result.id,
      group: result.group,
      target: result.target,
      period: result.period,
      can_end: result.can_end ?? false,
    });
  }

  async deleteSubstitution(id: string): Promise<void> {
    await end({ type: "group_handover", id }, "end group handover failed");
  }
}

export const substitutionService = new SubstitutionService();
