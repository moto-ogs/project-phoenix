import { proxyUpload } from "~/lib/traeger/route-wrapper.server";

// Vorschau des Personal-Imports (#4724): liest die Datei mit der Zuordnung
// und beschreibt jede Zeile. Speichert nichts.
// The file plus the mapping and the fingerprint.
const IMPORT_MAX_BYTES = 2 * 1024 * 1024 + 64 * 1024;

export const POST = proxyUpload(
  "/traeger/staff-record-imports/preview",
  IMPORT_MAX_BYTES,
  {
    method: "POST",
    tooLargeCode: "workforce.traeger_staff_import_file_too_large",
  },
);
