// app/api/staff/route.ts
//
// Temporary (#7563): the contract registers GET and POST /api/staff, and the
// current client reads the contract record. Bundles built before #7563 read
// the flat fields this file used to build (`name`, `firstName`, `tag_id`, …)
// and call this same path, so the file stays for one production deploy and
// answers the contract record with those fields beside it
// (`withLegacyStaffFields`). Delete it after the next production deploy,
// together with its test; the portal's catch-all then answers the path.
import type { NextRequest } from "next/server";
import { contractGet, contractWrite } from "~/lib/contract/client.server";
import { routes, type StaffRequest } from "~/lib/contract/staff.generated";
import {
  createGetHandler,
  createPostHandler,
} from "~/lib/route-wrapper.server";
import { withLegacyStaffFields } from "~/lib/staff-route-mapping";

const LIST = routes["GET /api/staff/"];
const CREATE = routes["POST /api/staff/"];

/** Handler for GET /api/staff: the staff directory with its filters. */
export const GET = createGetHandler(async (request: NextRequest, token) => {
  // Only the filters the contract names travel, as through the proxy; the
  // legacy `strict=1` and `search` never reached the backend's filters.
  const filters: readonly string[] = LIST.query;
  const query = new URLSearchParams();
  request.nextUrl.searchParams.forEach((value, key) => {
    if (filters.includes(key)) query.append(key, value);
  });
  const search = query.size > 0 ? `?${query.toString()}` : "";
  const result = await contractGet(
    `${LIST.method} ${LIST.pattern}`,
    LIST.response,
    `/api/staff${search}`,
    token,
  );
  if (!result.ok) throw result.error.cause;
  return result.value.data.map(withLegacyStaffFields);
});

/** Handler for POST /api/staff: forwards the body; the backend validates it. */
export const POST = createPostHandler<
  ReturnType<typeof withLegacyStaffFields>,
  StaffRequest
>(async (_request: NextRequest, body, token) => {
  const result = await contractWrite(CREATE, "/api/staff", token, body);
  if (!result.ok) throw result.error.cause;
  return withLegacyStaffFields(result.value.data);
});
