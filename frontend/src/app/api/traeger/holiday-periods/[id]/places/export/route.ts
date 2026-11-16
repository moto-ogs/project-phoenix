import { withPrivateDownloadNoStore } from "~/lib/private-no-store";
import { proxyFile } from "~/lib/traeger/route-wrapper.server";
import { requirePathSegmentParam } from "~/lib/route-wrapper-utils.server";

// Die Plätze und die Warteliste eines Ferienzeitraums als PDF, Excel oder CSV (#4718).
export const GET = withPrivateDownloadNoStore(
  proxyFile(
    (params) =>
      `/traeger/holiday-periods/${requirePathSegmentParam(params)}/places/export`,
  ),
);
