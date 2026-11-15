import { withPrivateDownloadNoStore } from "~/lib/private-no-store";
import { proxyFile } from "~/lib/traeger/route-wrapper.server";

// Bericht zum Stichtag als PDF, Excel oder CSV (#4716).
export const GET = withPrivateDownloadNoStore(
  proxyFile("/traeger/reports/key-date/export"),
);
