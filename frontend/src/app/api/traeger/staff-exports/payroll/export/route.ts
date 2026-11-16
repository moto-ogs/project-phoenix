import { withPrivateDownloadNoStore } from "~/lib/private-no-store";
import { proxyFile } from "~/lib/traeger/route-wrapper.server";

// Die DATEV-Lohndatei des Trägers über alle Schulen (#4712).
export const GET = withPrivateDownloadNoStore(
  proxyFile("/traeger/staff-exports/payroll/export"),
);
