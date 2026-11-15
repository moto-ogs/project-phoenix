/**
 * Exports of the lists and reports of the Träger portal (#4718): every list
 * as PDF, Excel or CSV, for one school or all. The backend renders the file
 * from the same data the page shows and writes each export of personal data
 * to the access log; the browser only asks for it and saves it.
 */

import { apiErrorFromBody, transportFetch } from "./api-error";
import { filenameFromDisposition } from "./file-download";
import { readJson } from "./traeger-api";

/** The formats of a Träger list export. */
export type TraegerListFormat = "pdf" | "xlsx" | "csv";

/** The formats in the order of the download menu. */
export const TRAEGER_LIST_FORMATS: readonly TraegerListFormat[] = [
  "pdf",
  "xlsx",
  "csv",
];

/** A downloaded export, with the file name the backend chose. */
export interface TraegerListFile {
  readonly blob: Blob;
  readonly filename: string | null;
}

/**
 * Downloads one export of the BFF route `path` (below `/api/traeger/`). The
 * params are the filters of the page; an empty value is left out.
 */
export async function downloadTraegerList(
  path: string,
  format: TraegerListFormat,
  params: Readonly<Record<string, string | null | undefined>> = {},
): Promise<TraegerListFile> {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value) query.set(name, value);
  }
  query.set("format", format);
  const response = await transportFetch(`${path}?${query.toString()}`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    throw apiErrorFromBody(
      `Request failed (${response.status})`,
      response.status,
      await readJson(response),
    );
  }
  return {
    blob: await response.blob(),
    filename: filenameFromDisposition(response),
  };
}
