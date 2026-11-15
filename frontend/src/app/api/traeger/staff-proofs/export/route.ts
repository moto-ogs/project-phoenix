import { withPrivateDownloadNoStore } from "~/lib/private-no-store";
import { proxyFile } from "~/lib/traeger/route-wrapper.server";

// Die Ablaufliste der Nachweise als CSV (#4707).
export const GET = withPrivateDownloadNoStore(
  proxyFile("/traeger/staff-proofs/export"),
);
