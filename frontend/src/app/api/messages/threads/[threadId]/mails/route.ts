import { proxyGet } from "~/lib/route-wrapper.server";

/**
 * Proxy GET /api/messages/threads/{threadId}/mails → backend (#7058): what
 * became of the e-mail of each OGS message. Moves no read state.
 */
export const GET = proxyGet(
  (params) =>
    `/api/messages/threads/${encodeURIComponent(String(params.threadId))}/mails`,
);
