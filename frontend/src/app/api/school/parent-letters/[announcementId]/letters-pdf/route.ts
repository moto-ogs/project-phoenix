import { withPrivateDownloadNoStore } from "~/lib/private-no-store";
import { requirePathSegmentParam } from "~/lib/route-wrapper-utils.server";
import { school } from "~/lib/school/route-wrapper.server";

// Serienbriefe (#4813): alle Briefe eines eigenen Elternbriefs in moto schule
// als ein PDF zum Drucken, ein Brief je Kind.
export const GET = withPrivateDownloadNoStore(
  school.route(async (request, _token, params) =>
    school.downloadFile(
      request,
      `/school/parent-letters/${requirePathSegmentParam(params, "announcementId")}/letters-pdf`,
      { backendCacheControl: true },
    ),
  ),
);
