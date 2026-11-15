import { withPrivateDownloadNoStore } from "~/lib/private-no-store";
import { proxyFile } from "~/lib/traeger/route-wrapper.server";

// CSV-Datei der Tagesmeldung, eine Zeile je Kind und Tag ohne Namen (#4717).
export const GET = withPrivateDownloadNoStore(
  proxyFile("/traeger/schools/daily-attendance/export"),
);
