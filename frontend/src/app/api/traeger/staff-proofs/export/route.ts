import { withPrivateDownloadNoStore } from "~/lib/private-no-store";
import { proxyFile } from "~/lib/traeger/route-wrapper.server";

// Die Ablaufliste der Nachweise als PDF, Excel oder CSV (#4707, #4718).
export const GET = withPrivateDownloadNoStore(
  proxyFile("/traeger/staff-proofs/export"),
);
