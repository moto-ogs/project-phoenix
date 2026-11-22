import { ApiError } from "~/lib/api-error";
import { bffFile, type FileRouteKey } from "~/lib/bff-fetch";
import { downloadBlob } from "~/lib/file-download";

/**
 * Requests of the import pages (#2517). The upload itself goes through
 * `bffJson`; a failure is an `ApiError` with code, field errors and request
 * ID, so the page shows the catalog text.
 */

/**
 * The error body of a failed import. A stopped batch carries the rows that
 * were already saved there (`import.batch_failed`, `details.result`).
 */
export function importFailureBody(error: unknown): unknown {
  return error instanceof ApiError ? error.problem : undefined;
}

type TemplateRoute = Extract<
  FileRouteKey<"tenant">,
  `GET /api/import/${string}/template`
>;

/** Downloads the import template as `filename`. */
export async function downloadImportTemplate(
  route: TemplateRoute,
  format: "csv" | "xlsx",
  filename: string,
): Promise<void> {
  const response = await bffFile("tenant", route, {
    query: { format },
    errorMessage: "Template download failed",
  });
  downloadBlob(await response.blob(), filename);
}
