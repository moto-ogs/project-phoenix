import { proxyPost } from "~/lib/school/route-wrapper.server";

/**
 * POST /api/school/notifications/feed/{id}/read — einen Hinweis in moto schule
 * als gelesen markieren (#7139). Das Backend weist eine ID ab, die keine Zahl
 * ist.
 */
export const POST = proxyPost(
  (params) =>
    `/school/notifications/feed/${encodeURIComponent(params.id as string)}/read`,
);
