import { withPrivateDownloadNoStore } from "~/lib/private-no-store";
import { proxyFile } from "~/lib/traeger/route-wrapper.server";

// CSV-Export der Auslastung je Tag (#4713).
export const GET = withPrivateDownloadNoStore(
  proxyFile("/traeger/schools/utilization/export"),
);
