import { withPrivateDownloadNoStore } from "~/lib/private-no-store";
import { proxyFile } from "~/lib/traeger/route-wrapper.server";

// Die Blockungen der Woche im Vertretungspool als PDF, Excel oder CSV (#4709, #4718).
export const GET = withPrivateDownloadNoStore(
  proxyFile("/traeger/staff-pool/export"),
);
