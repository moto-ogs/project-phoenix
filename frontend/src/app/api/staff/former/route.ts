// Temporary (#7563): the contract registers GET /api/staff/former, which the
// current client calls through this path and reads in the contract's field
// names. Bundles built before #7563 read the camel-case fields this file used
// to build, so it answers both for one production deploy. Delete it after the
// next production deploy, together with its test; the portal's catch-all then
// answers the path.
import { contractGet } from "~/lib/contract/client.server";
import { routes } from "~/lib/contract/staff.generated";
import { createGetHandler } from "~/lib/route-wrapper.server";
import { withLegacyFormerFields } from "~/lib/staff-route-mapping";

const FORMER = routes["GET /api/staff/former"];

// Former employments for the Ehemalige filter of the staff list (#3403).
export const GET = createGetHandler(async (_request, token) => {
  const result = await contractGet(
    `${FORMER.method} ${FORMER.pattern}`,
    FORMER.response,
    "/api/staff/former",
    token,
  );
  if (!result.ok) throw result.error.cause;
  return result.value.data.map(withLegacyFormerFields);
});
