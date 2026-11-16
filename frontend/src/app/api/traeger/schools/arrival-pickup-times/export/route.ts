import { withPrivateDownloadNoStore } from "~/lib/private-no-store";
import { proxyFile } from "~/lib/traeger/route-wrapper.server";

// Export der Ankunfts- und Abholzeiten als PDF, Excel oder CSV (#4714, #4718).
export const GET = withPrivateDownloadNoStore(
  proxyFile("/traeger/schools/arrival-pickup-times/export"),
);
