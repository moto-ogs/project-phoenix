// app/api/timetable/conflict-check/route.ts
//
// GET /api/timetable/conflict-check?date=...&start_time=...&end_time=...
//     [&room_id=N][&staff_ids=1,2][&student_ids=3,4][&exclude_instance_id=N]
//     [&exclude_activity_group_id=N]
//   Advisory pre-save conflict check. Forwards the query string verbatim
//   to the backend /api/timetable/conflicts endpoint.
//
// The Go backend wraps responses in { status, data, message }. proxyGet
// strips that envelope so route-wrapper does not double-wrap the payload.
//
// Since #2352 the app calls /api/timetable/conflicts through the catalog
// proxy. This file stays one release for installed clients with an older
// bundle; delete it afterwards.
import { proxyGet } from "~/lib/route-wrapper.server";

export const GET = proxyGet("/api/timetable/conflicts");
