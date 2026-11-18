import { proxyGet, proxyPost } from "~/lib/route-wrapper.server";

// Temporary for one release (#2352): installed PWAs with an old bundle still
// POST the bulk approval to this path. The client now calls
// /api/students/change-requests/bulk-approve through the catalog proxy. While
// this file owns the path it also answers the list GET; delete it as a whole
// after the release.

// Aggregated parent requests across the four kinds, open or history,
// cursor-paginated (#2432).
export const GET = proxyGet("/api/students/change-requests", {
  forwardQuery: [
    "view",
    "search",
    "student_id",
    "types",
    "status",
    "from",
    "to",
    "cursor",
    "limit",
  ],
});

export const POST = proxyPost("/api/students/change-requests/bulk-approve");
