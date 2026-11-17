import { proxyUpload } from "~/lib/traeger/route-wrapper.server";

// Kinderzahl der Familien aus einer Datei nachtragen (#7356): übernimmt die
// bereiten Zeilen der bestätigten Vorschau. Das Backend prüft Größe, Endung
// und Inhalt und speichert die Datei nicht.
// The file plus the mapping.
const IMPORT_MAX_BYTES = 2 * 1024 * 1024 + 256 * 1024;

export const POST = proxyUpload(
  "/traeger/family-children/imports",
  IMPORT_MAX_BYTES,
  {
    method: "POST",
    tooLargeCode: "parent_billing.sepa_import_file_too_large",
  },
);
