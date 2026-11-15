import { apiPost } from "~/lib/api-helpers.server";
import { createPostHandler } from "~/lib/route-wrapper.server";
import { requireNumericParam } from "~/lib/route-wrapper-utils.server";

interface UnreadCount {
  unread_count: number;
}

/**
 * POST /api/notifications/feed/{id}/read — einen Hinweis als gelesen
 * markieren (#7148). Die ID ist eine Datenbank-ID; alles andere ist 400,
 * bevor das Backend gefragt wird.
 */
export const POST = createPostHandler<UnreadCount>(
  async (_request, _body, token, params) => {
    const id = requireNumericParam(params);
    const response = await apiPost<{ data: UnreadCount }>(
      `/api/notifications/feed/${id}/read`,
      token,
    );
    return response.data;
  },
);
