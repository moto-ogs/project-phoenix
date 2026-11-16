import { withPrivateDownloadNoStore } from "~/lib/private-no-store";
import { proxyFile } from "~/lib/traeger/route-wrapper.server";

// Das Exportprotokoll als PDF, Excel oder CSV, auf Wunsch nur eines Laufs (#4718).
export const GET = withPrivateDownloadNoStore(
  proxyFile("/traeger/finance-exports/files/export"),
);
