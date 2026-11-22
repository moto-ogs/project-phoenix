/**
 * Exports of the lists and reports of the Träger portal (#4718): every list
 * as PDF, Excel or CSV, for one school or all. The backend renders the file
 * from the same data the page shows and writes each export of personal data
 * to the access log; the browser only asks for it and saves it.
 */

import { filenameFromDisposition } from "./file-download";

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
 * The query of an export: the filters of the page, an empty value left out,
 * and the format.
 */
export function listExportQuery(
  format: TraegerListFormat,
  params: Readonly<Record<string, string | null | undefined>> = {},
): Record<string, string> {
  const query: Record<string, string> = {};
  for (const [name, value] of Object.entries(params)) {
    if (value) query[name] = value;
  }
  return { ...query, format };
}

/**
 * Reads one export, asked through `bffFile`, with the file name the backend
 * chose. A refusal is the ApiError of `bffFile`.
 */
export async function downloadTraegerList(
  file: Promise<Response>,
): Promise<TraegerListFile> {
  const response = await file;
  return {
    blob: await response.blob(),
    filename: filenameFromDisposition(response),
  };
}
