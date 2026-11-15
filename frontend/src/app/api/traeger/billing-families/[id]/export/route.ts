import { withPrivateDownloadNoStore } from "~/lib/private-no-store";
import { requirePathSegmentParam } from "~/lib/route-wrapper-utils.server";
import { proxyFile } from "~/lib/traeger/route-wrapper.server";

// Die Dokumente einer Familie als PDF, Excel oder CSV (#4718).
export const GET = withPrivateDownloadNoStore(
  proxyFile(
    (params) =>
      `/traeger/billing-families/${requirePathSegmentParam(params)}/export`,
  ),
);
