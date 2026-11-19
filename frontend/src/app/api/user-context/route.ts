// Temporary (#7563): the current client reads GET /api/me/navigation through
// the portal's catalog proxy and maps the contract's shape itself
// (lib/user-context-map). An installed bundle of the previous release still
// calls this path and reads the mapped user context. Delete this file and its
// test after the next production deploy.
import type { NextRequest } from "next/server";
import { createGetHandler } from "~/lib/route-wrapper.server";
import type { UserContextResponse } from "~/lib/user-context-types";
import { loadUserContext } from "~/lib/user-context.server";

/**
 * GET /api/user-context
 *
 * BFF endpoint that fetches user context data needed across multiple pages.
 * The Go backend returns one complete projection, so one browser request maps
 * to one backend request and partial access data cannot be hidden as empty.
 *
 * Used by: /students/search, and potentially other pages that need user context
 * The tenant layout preloads the same projection on the server (#2973); this
 * route serves later revalidations and sessions without a preload.
 */
export const GET = createGetHandler<UserContextResponse>(
  async (_request: NextRequest, token: string) => loadUserContext(token),
);
