import { bffError } from "~/lib/api-response-error.server";
import { withPrivateDownloadNoStore } from "~/lib/private-no-store";
import { tenant } from "~/lib/route-wrapper.server";
import { requirePathSegmentParam } from "~/lib/route-wrapper-utils.server";

// Erklärungen (#3430): den Nachweisbericht als PDF oder den Verlauf als CSV
// herunterladen. Beide Dateien erzeugt das Backend. Mit student_id enthält
// der Nachweis nur dieses Kind (Kinderakte, #4814).
const FORMATS = new Set(["csv", "pdf"]);
const STUDENT_ID = /^[1-9]\d{0,18}$/;

export const GET = withPrivateDownloadNoStore(
  tenant.route(async (request, _token, params) => {
    const format = request.nextUrl.searchParams.get("format") ?? "";
    if (!FORMATS.has(format)) {
      throw bffError(400, "format must be csv or pdf");
    }
    const studentId = request.nextUrl.searchParams.get("student_id");
    if (studentId !== null && !STUDENT_ID.test(studentId)) {
      throw bffError(400, "student_id must be a positive integer");
    }
    const child = studentId === null ? "" : `&student_id=${studentId}`;
    return tenant.downloadFile(
      request,
      `/api/parent-announcements/${requirePathSegmentParam(params, "announcementId")}/declaration-export?format=${format}${child}`,
      { backendCacheControl: true },
    );
  }),
);
