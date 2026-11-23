import { bffFile } from "~/lib/bff-fetch";
import {
  downloadBlob,
  filenameFromDisposition,
  openBlobForPrint,
} from "~/lib/file-download";

export type TimeTrackingExportFormat = "pdf" | "xlsx" | "csv";

/**
 * Downloads the Zeitnachweis of one person for a period. The own time
 * tracking uses the same route with the signed-in person's staff ID; the
 * backend allows that without the manage permission.
 */
export async function exportStaffTimeTracking(
  staffId: string,
  from: string,
  to: string,
  format: TimeTrackingExportFormat,
  printTarget?: Window,
): Promise<void> {
  const response = await bffFile(
    "tenant",
    "GET /api/staff/{id}/time-tracking/export",
    {
      params: { id: staffId },
      query: { from, to, format },
      errorMessage: "time tracking export failed",
    },
  );
  const blob = await response.blob();
  if (printTarget) {
    await openBlobForPrint(blob, printTarget);
    return;
  }
  downloadBlob(
    blob,
    filenameFromDisposition(response) ?? `zeitnachweis-${from}-${to}.${format}`,
  );
}
