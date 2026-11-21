import type {
  Request as StaffPersonMergeRequest,
  Side as WireSide,
  StaffPersonMergeCandidate as WireCandidate,
} from "~/lib/contract/operator-staff-person-merges.generated";
import { operatorFetch } from "./api-helpers";

export type MergeSide = {
  personId: string;
  name: string;
  accountId?: string;
  createdAt: string;
  birthday?: string;
  staffId: string;
  staffCreatedAt: string;
  retiredAt: string | null;
};
export type StaffMergeCandidate = {
  keeper: MergeSide;
  donor: MergeSide;
  revision: string;
};
function mapSide(side: WireSide): MergeSide {
  return {
    personId: side.person.id,
    name: `${side.person.first_name} ${side.person.last_name}`,
    accountId: side.person.account_id,
    createdAt: side.person.created_at,
    birthday: side.person.birthday,
    staffId: side.employment.id,
    staffCreatedAt: side.employment.created_at,
    retiredAt: side.employment.deleted_at,
  };
}
export async function previewStaffPersonMerges(
  schoolId: string,
): Promise<StaffMergeCandidate[]> {
  const candidates = await operatorFetch<WireCandidate[]>(
    `/api/operator/staff-person-merges/${encodeURIComponent(schoolId)}`,
  );
  return candidates.map((candidate) => ({
    keeper: mapSide(candidate.keeper),
    donor: mapSide(candidate.donor),
    revision: candidate.revision,
  }));
}
export async function executeStaffPersonMerges(
  schoolId: string,
  candidates: StaffMergeCandidate[],
  schoolConfirmed: boolean,
): Promise<void> {
  await operatorFetch(
    `/api/operator/staff-person-merges/${encodeURIComponent(schoolId)}`,
    {
      method: "POST",
      body: {
        school_confirmed: schoolConfirmed,
        cases: candidates.map((candidate) => ({
          donor_id: candidate.donor.personId,
          keeper_id: candidate.keeper.personId,
          revision: candidate.revision,
        })),
      } satisfies StaffPersonMergeRequest,
    },
  );
}
