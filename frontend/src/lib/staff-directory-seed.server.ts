import { ApiError } from "~/lib/api-error";
import * as active from "~/lib/contract/active.generated";
import * as staff from "~/lib/contract/staff.generated";
import { readContract, seedRead } from "~/lib/server-seed.server";
import { mapStaffList } from "~/lib/staff-api";
import { staffKeys } from "~/lib/swr/staff-keys";

export function staffDirectorySeed(token: string, canReadGroups: boolean) {
  return {
    key: staffKeys.key(),
    render: true,
    value: seedRead("staff directory", async (signal) => {
      const [directory, groups] = await Promise.all([
        readContract(staff.routes["GET /api/staff/"], { token, signal }),
        canReadGroups
          ? readContract(active.routes["GET /api/active/groups/"], {
              token,
              signal,
              query: { active: true },
            })
              .then((answer) => answer.data)
              .catch((error) => {
                if (
                  error instanceof ApiError &&
                  (error.status === 401 || error.status === 403)
                )
                  return [];
                throw error;
              })
          : [],
      ]);
      return mapStaffList(directory.data, groups);
    }),
  };
}
