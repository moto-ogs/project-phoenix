import { withPrivateDownloadNoStore } from "~/lib/private-no-store";
import { proxyFile } from "~/lib/traeger/route-wrapper.server";

// Export der Belegung als PDF, Excel oder CSV (#4676, #4718).
export const GET = withPrivateDownloadNoStore(
  proxyFile("/traeger/schools/occupancy/export"),
);
