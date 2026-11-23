import { bffJson } from "~/lib/bff-fetch";

export interface StaffGroupLeaderCandidate {
  id: string;
  teacherId?: string;
  fullName: string;
}

export async function fetchGroupLeaderCandidates(): Promise<
  StaffGroupLeaderCandidate[]
> {
  const staff = await bffJson("tenant", "GET /api/staff/by-role", {
    query: { role: "user" },
    errorMessage: "Group leader candidates failed",
  });
  return (staff ?? []).map((staff) => ({
    id: staff.id,
    teacherId: staff.teacher_id,
    fullName: staff.full_name,
  }));
}
