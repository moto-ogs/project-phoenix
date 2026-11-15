import { withPrivateDownloadNoStore } from "~/lib/private-no-store";
import { proxyFile } from "~/lib/traeger/route-wrapper.server";

// CSV-Export des Standortvergleichs (#4715).
export const GET = withPrivateDownloadNoStore(
  proxyFile("/traeger/schools/comparison/export"),
);
