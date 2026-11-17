import { proxyUpload } from "~/lib/traeger/route-wrapper.server";

// Vorschau zum Nachtragen der Kinderzahl (#7356): liest die Datei mit der
// Zuordnung und beschreibt jede Zeile. Speichert nichts.
// The file plus the mapping.
const IMPORT_MAX_BYTES = 2 * 1024 * 1024 + 256 * 1024;

export const POST = proxyUpload(
  "/traeger/family-children/imports/preview",
  IMPORT_MAX_BYTES,
  {
    method: "POST",
    tooLargeCode: "parent_billing.sepa_import_file_too_large",
  },
);
