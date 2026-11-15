import { proxyPost } from "~/lib/route-wrapper.server";

/** POST /api/notifications/feed/read-all — alle Hinweise als gelesen markieren. */
export const POST = proxyPost("/api/notifications/feed/read-all");
