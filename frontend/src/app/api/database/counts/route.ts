import { proxyGet } from "~/lib/route-wrapper.server";

// Temporary (#2352): the client reads the counts from /api/database/stats
// through the catalog proxy since this release. This path stays one release
// for an installed app with an older bundle; the backend now answers in the
// usual envelope, which proxyGet unwraps to the bare counts that bundle
// expects. Delete this file and its row in
// src/test/proxy-routes/api/database.json after the next production deploy.
export const GET = proxyGet("/api/database/stats");
