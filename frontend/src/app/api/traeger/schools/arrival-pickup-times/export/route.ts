import { withPrivateDownloadNoStore } from "~/lib/private-no-store";
import { proxyFile } from "~/lib/traeger/route-wrapper.server";

// CSV-Export der Ankunfts- und Abholzeiten (#4714).
export const GET = withPrivateDownloadNoStore(
  proxyFile("/traeger/schools/arrival-pickup-times/export"),
);
