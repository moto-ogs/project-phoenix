import { unwrapEnvelope } from "~/lib/backend-client.server";
import { proxyGet, tenant } from "~/lib/route-wrapper.server";
import {
  substitutionAssignmentResult,
  type AddSupervisorRequest,
  type BackendSubstitutionOverview,
  type CreateSubstitutionRequest,
  type SubstitutionAssignmentKind,
} from "~/lib/substitution-helpers";

type AssignmentBody =
  | CreateSubstitutionRequest
  | AddSupervisorRequest
  | { type: "schedule_substitution" };

/**
 * Temporary (#2352): the catalog proxy answers /api/substitutions once this
 * file is gone. It stays one release for an installed app with an older
 * bundle, which reads the overview with numeric appointment ids and the bare
 * assignment result. The backend now names the result's shape in `type` and
 * carries it under the member of that name; POST hands the older bundle the
 * bare member, as before. The current client reads both shapes. Delete this
 * file after the next production deploy.
 */
export const GET = proxyGet<BackendSubstitutionOverview>("/api/substitutions");

export const POST = tenant.post<unknown, AssignmentBody>(
  async (request, body, token) => {
    const answer = await tenant.api("POST", "/api/substitutions", token, body, {
      idempotencyKey: request.headers.get("Idempotency-Key"),
      request,
    });
    const data = unwrapEnvelope<{ type?: SubstitutionAssignmentKind }>(answer);
    const kind = data?.type ?? body.type;
    return kind ? substitutionAssignmentResult(data, kind) : data;
  },
);
