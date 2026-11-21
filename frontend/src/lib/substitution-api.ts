import { ApiError, apiErrorFromResponse } from "./api-error";
import type {
  SubstitutionAssignmentResult,
  SubstitutionOverviewResult,
} from "./contract/substitutions.generated";
import { sessionFetch } from "./session-cache";
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
  type SubstitutionProxyEnvelope,
  unwrapSubstitutionProxyEnvelope,
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
  BackendApplyDeviationsResponse,
  BackendBulkSubstitutionResponse,
  BulkSubstitutionInput,
  BulkSubstitutionResponse,
} from "./timetable-types";

class SubstitutionService {
  async fetchOverview(): Promise<SubstitutionOverview> {
    const response = await sessionFetch("/api/substitutions", {
      credentials: "include",
    });
    if (!response.ok) {
      throw await apiErrorFromResponse(
        response,
        "substitution overview failed",
      );
    }
    const envelope =
      (await response.json()) as SubstitutionProxyEnvelope<SubstitutionOverviewResult>;
    return mapSubstitutionOverview(unwrapSubstitutionProxyEnvelope(envelope));
  }

  async fetchScheduleOverview(
    from: string,
    to: string,
  ): Promise<ScheduleSubstitutionOverview> {
    const params = new URLSearchParams({ from, to });
    const response = await sessionFetch(`/api/substitutions?${params}`, {
      credentials: "include",
    });
    if (!response.ok) {
      throw await apiErrorFromResponse(
        response,
        "schedule substitution overview failed",
      );
    }
    const envelope =
      (await response.json()) as SubstitutionProxyEnvelope<SubstitutionOverviewResult>;
    if (envelope.data === undefined) {
      throw invalidResponseError("schedule substitution overview");
    }
    return mapScheduleSubstitutionOverview(envelope.data);
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
    const response = await sessionFetch("/api/substitutions", {
      method: "POST",
      credentials: "include",
      body: JSON.stringify({
        type: "schedule_substitution",
        schedule_substitution: {
          instance_id: Number(instanceId),
          ...prepareApplyDeviationsBody(input),
        },
      }),
    });
    if (!response.ok) throw await substitutionError(response);
    const envelope =
      (await response.json()) as SubstitutionProxyEnvelope<unknown>;
    return mapApplyDeviations(
      substitutionAssignmentResult<BackendApplyDeviationsResponse>(
        unwrapSubstitutionProxyEnvelope(envelope),
        "schedule_substitution",
      ),
    );
  }

  async applyBulkSubstitution(
    input: BulkSubstitutionInput,
  ): Promise<BulkSubstitutionResponse> {
    const response = await sessionFetch("/api/substitutions", {
      method: "POST",
      credentials: "include",
      body: JSON.stringify({
        type: "schedule_substitution",
        schedule_substitution: {
          whole_days: prepareBulkSubstitutionBody(input),
        },
      }),
    });
    if (!response.ok) throw await substitutionError(response);
    const envelope =
      (await response.json()) as SubstitutionProxyEnvelope<unknown>;
    return mapBulkSubstitution(
      substitutionAssignmentResult<BackendBulkSubstitutionResponse>(
        unwrapSubstitutionProxyEnvelope(envelope),
        "schedule_substitution",
      ),
    );
  }

  async fetchSubstitutions(date?: Date): Promise<Substitution[]> {
    const params = new URLSearchParams();
    if (date) params.set("date", formatDateForBackend(date));
    const response = await sessionFetch(
      `/api/substitutions${params.size > 0 ? `?${params.toString()}` : ""}`,
      { credentials: "include" },
    );
    if (!response.ok) {
      throw await apiErrorFromResponse(response, "group handovers failed");
    }
    const envelope =
      (await response.json()) as SubstitutionProxyEnvelope<SubstitutionOverviewResult>;
    const body = unwrapSubstitutionProxyEnvelope(envelope);
    return mapSubstitutionsResponse(body.group_handovers);
  }

  async fetchAvailableTeachers(): Promise<TeacherAvailability[]> {
    const response = await sessionFetch("/api/substitutions", {
      credentials: "include",
    });
    if (!response.ok) {
      throw await apiErrorFromResponse(response, "available staff failed");
    }
    const envelope =
      (await response.json()) as SubstitutionProxyEnvelope<SubstitutionOverviewResult>;
    const body = unwrapSubstitutionProxyEnvelope(envelope);
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
    const params = new URLSearchParams({ active_group_id: activeGroupId });
    const response = await sessionFetch(`/api/substitutions?${params}`, {
      credentials: "include",
    });
    if (!response.ok) {
      throw await apiErrorFromResponse(response, "running supervision failed");
    }
    const envelope =
      (await response.json()) as SubstitutionProxyEnvelope<SubstitutionOverviewResult>;
    const rows = unwrapSubstitutionProxyEnvelope(envelope).running_supervisions;
    if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]) {
      throw invalidResponseError("running supervision");
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
    const response = await sessionFetch("/api/substitutions", {
      method: "POST",
      credentials: "include",
      body: JSON.stringify({
        type: "additional_supervision",
        additional_supervision: {
          active_group_id: activeGroupId,
          target_staff_id: targetStaffId,
          ...(handOver ? { hand_over: true } : {}),
        },
      }),
    });
    if (!response.ok) {
      throw await apiErrorFromResponse(
        response,
        handOver
          ? "supervision handover failed"
          : "additional supervision failed",
      );
    }
    const envelope =
      (await response.json()) as SubstitutionProxyEnvelope<unknown>;
    const body = substitutionAssignmentResult<SubstitutionAssignmentResult>(
      unwrapSubstitutionProxyEnvelope(envelope),
      "additional_supervision",
    );
    return { id: body.id, targetName: body.target.full_name };
  }

  /**
   * Ends the caller's own supervision while another supervisor stays
   * (#4763); the backend refuses with substitutions.last_supervisor
   * otherwise.
   */
  async releaseSupervision(activeGroupId: string): Promise<void> {
    const response = await sessionFetch("/api/substitutions/end", {
      method: "POST",
      credentials: "include",
      body: JSON.stringify({
        type: "additional_supervision",
        id: activeGroupId,
      }),
    });
    if (!response.ok) {
      throw await apiErrorFromResponse(response, "supervision release failed");
    }
  }

  async createSubstitution(
    groupId: string,
    substituteStaffId: string,
    startDate: string,
    endDate: string,
  ): Promise<Substitution> {
    const response = await sessionFetch("/api/substitutions", {
      method: "POST",
      credentials: "include",
      body: JSON.stringify(
        prepareSubstitutionForBackend(
          groupId,
          substituteStaffId,
          startDate,
          endDate,
        ),
      ),
    });
    if (!response.ok) {
      throw await apiErrorFromResponse(response, "group handover failed");
    }
    const envelope =
      (await response.json()) as SubstitutionProxyEnvelope<unknown>;
    const result = substitutionAssignmentResult<SubstitutionAssignmentResult>(
      unwrapSubstitutionProxyEnvelope(envelope),
      "group_handover",
    );
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
    const response = await sessionFetch("/api/substitutions/end", {
      method: "POST",
      credentials: "include",
      body: JSON.stringify({
        type: "group_handover",
        id,
      }),
    });
    if (!response.ok) {
      throw await apiErrorFromResponse(response, "end group handover failed");
    }
  }
}

async function substitutionError(response: Response): Promise<ApiError> {
  return apiErrorFromResponse(response, "schedule substitution failed");
}

/** A 2xx answer without the expected shape counts as a server failure. */
function invalidResponseError(what: string): ApiError {
  return new ApiError(`invalid ${what} response`, 500);
}

export const substitutionService = new SubstitutionService();
