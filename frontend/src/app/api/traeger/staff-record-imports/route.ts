import { proxyGet, proxyUpload } from "~/lib/traeger/route-wrapper.server";

// Personal-Import des Trägers (#4724): GET listet die Importe, POST übernimmt
// die neuen und ergänzten Zeilen einer CSV-Datei. Das Backend prüft Größe,
// Endung und Inhalt und speichert die Datei nicht.
// The file plus the mapping and the fingerprint.
const IMPORT_MAX_BYTES = 2 * 1024 * 1024 + 64 * 1024;

export const GET = proxyGet("/traeger/staff-record-imports/");

export const POST = proxyUpload(
  "/traeger/staff-record-imports/",
  IMPORT_MAX_BYTES,
  {
    method: "POST",
    tooLargeCode: "workforce.traeger_staff_import_file_too_large",
  },
);
