import { bffJson } from "~/lib/bff-fetch";
import type * as operatorStaffPersonMergesContract from "~/lib/contract/operator-staff-person-merges.generated";

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
function mapSide(side: operatorStaffPersonMergesContract.Side): MergeSide {
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
  const candidates = await bffJson(
    "platform",
    "GET /operator/staff-person-merges/{schoolId}",
    { params: { schoolId } },
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
  await bffJson("platform", "POST /operator/staff-person-merges/{schoolId}", {
    params: { schoolId },
    body: {
      school_confirmed: schoolConfirmed,
      cases: candidates.map((candidate) => ({
        donor_id: candidate.donor.personId,
        keeper_id: candidate.keeper.personId,
        revision: candidate.revision,
      })),
    } satisfies operatorStaffPersonMergesContract.Request,
  });
}
