import { withPrivateDownloadNoStore } from "~/lib/private-no-store";
import { proxyFile } from "~/lib/traeger/route-wrapper.server";

// Der Zeitexport des Trägers als CSV, je Person, Tag und Einsatzort (#4712).
export const GET = withPrivateDownloadNoStore(
  proxyFile("/traeger/staff-exports/times/export"),
);
