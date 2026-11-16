import { withPrivateDownloadNoStore } from "~/lib/private-no-store";
import { proxyFile } from "~/lib/traeger/route-wrapper.server";

// Export des Zugriffsprotokolls als PDF, Excel oder CSV (#4655, #4718).
export const GET = withPrivateDownloadNoStore(
  proxyFile("/traeger/access-log/export"),
);
