import { apiErrorFromResponse } from "~/lib/api-error";
import type { StaffWithRoleResponse } from "~/lib/contract/staff.generated";
import { sessionFetch } from "~/lib/session-cache";

export interface StaffGroupLeaderCandidate {
  id: string;
  teacherId?: string;
  fullName: string;
}

export async function fetchGroupLeaderCandidates(): Promise<
  StaffGroupLeaderCandidate[]
> {
  const response = await sessionFetch("/api/staff/by-role?role=user", {
    method: "GET",
  });
  if (!response.ok) {
    throw await apiErrorFromResponse(
      response,
      "Group leader candidates failed",
    );
  }
  const data = (await response.json()) as {
    data: StaffWithRoleResponse[] | null;
  };
  // Go writes an empty result as null.
  return (data.data ?? []).map((staff) => ({
    id: staff.id,
    teacherId: staff.teacher_id,
    fullName: staff.full_name,
  }));
}
