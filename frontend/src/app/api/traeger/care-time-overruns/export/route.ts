import { withPrivateDownloadNoStore } from "~/lib/private-no-store";
import { proxyFile } from "~/lib/traeger/route-wrapper.server";

// Länger als gebucht: die Zahlen je Schule als PDF, Excel oder CSV (#4718).
export const GET = withPrivateDownloadNoStore(
  proxyFile("/traeger/care-time-overruns/export"),
);
