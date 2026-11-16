import { withPrivateDownloadNoStore } from "~/lib/private-no-store";
import { proxyFile } from "~/lib/traeger/route-wrapper.server";

// Export der Auslastung je Tag als PDF, Excel oder CSV (#4713, #4718).
export const GET = withPrivateDownloadNoStore(
  proxyFile("/traeger/schools/utilization/export"),
);
