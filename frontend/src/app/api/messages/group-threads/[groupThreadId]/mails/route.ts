import { proxyGet } from "~/lib/route-wrapper.server";

/**
 * Proxy GET /api/messages/group-threads/{groupThreadId}/mails → backend
 * (#7058): the e-mails of each group message, counted by result.
 */
export const GET = proxyGet(
  (params) =>
    `/api/messages/group-threads/${encodeURIComponent(String(params.groupThreadId))}/mails`,
);
