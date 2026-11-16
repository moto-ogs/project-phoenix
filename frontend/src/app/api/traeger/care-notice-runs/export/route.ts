import { withPrivateDownloadNoStore } from "~/lib/private-no-store";
import { proxyFile } from "~/lib/traeger/route-wrapper.server";

// Die Läufe der Jahresbescheide als PDF, Excel oder CSV (#4718).
export const GET = withPrivateDownloadNoStore(
  proxyFile("/traeger/care-notice-runs/export"),
);
