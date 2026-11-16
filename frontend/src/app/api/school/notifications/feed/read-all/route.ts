import { proxyPost } from "~/lib/school/route-wrapper.server";

/** POST /api/school/notifications/feed/read-all — alle Hinweise als gelesen markieren (#7139). */
export const POST = proxyPost("/school/notifications/feed/read-all");
