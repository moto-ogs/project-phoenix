import { withPrivateDownloadNoStore } from "~/lib/private-no-store";
import { tenant } from "~/lib/route-wrapper.server";
import { requirePathSegmentParam } from "~/lib/route-wrapper-utils.server";

// Serienbriefe (#4813): alle Briefe eines Versands als ein PDF zum Drucken,
// ein Brief je Kind. Das Backend erzeugt die Datei.
export const GET = withPrivateDownloadNoStore(
  tenant.route(async (request, _token, params) =>
    tenant.downloadFile(
      request,
      `/api/parent-announcements/${requirePathSegmentParam(params, "announcementId")}/letters-pdf`,
      { backendCacheControl: true },
    ),
  ),
);
