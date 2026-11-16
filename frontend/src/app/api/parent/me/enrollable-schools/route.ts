import { contractGet } from "~/lib/contract/client.server";
import { routes } from "~/lib/contract/parent-me.generated";
import { createParentGetHandler } from "~/lib/parent/route-wrapper.server";

const ENROLLABLE = routes["GET /parent/me/enrollable-schools"];

/**
 * The enrollment phases the calling guardian may apply to, pre-filtered and
 * sorted by the backend. The account comes from the parent session's token,
 * never from query or body. The answer is checked against the generated
 * contract (ADR 0270); one that does not match is a 502.
 */
export const GET = createParentGetHandler(async (request, token) => {
  const result = await contractGet(
    `${ENROLLABLE.method} ${ENROLLABLE.pattern}`,
    ENROLLABLE.response,
    ENROLLABLE.pattern,
    token,
    { signal: request.signal },
  );
  if (!result.ok) throw result.error.cause;
  return result.value.data;
});
