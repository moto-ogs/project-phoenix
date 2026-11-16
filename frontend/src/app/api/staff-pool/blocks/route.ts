import { proxyPost } from "~/lib/route-wrapper.server";

// Einen Springer für die eigene Schule blocken (#4709).
export const POST = proxyPost("/api/staff-pool/blocks");
