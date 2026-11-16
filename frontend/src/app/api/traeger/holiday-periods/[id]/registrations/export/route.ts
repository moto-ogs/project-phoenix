import { withPrivateDownloadNoStore } from "~/lib/private-no-store";
import { proxyFile } from "~/lib/traeger/route-wrapper.server";
import { requirePathSegmentParam } from "~/lib/route-wrapper-utils.server";

// Export der Ferienanmeldungen als PDF, Excel oder CSV (#4663, #4718).
export const GET = withPrivateDownloadNoStore(
  proxyFile(
    (params) =>
      `/traeger/holiday-periods/${requirePathSegmentParam(params)}/registrations/export`,
  ),
);
