"use client";

// Die Datei eines Träger-Imports (#4723, #7760): eine CSV-Datei wählen, sie
// mit einer Spaltenzuordnung lesen lassen und das Ergebnis zeigen. Nur die
// Antwort auf den letzten Blick in die Datei zählt; eine ältere, die später
// ankommt, ändert nichts. Was der Import mit dem Ergebnis tut, bleibt bei
// seiner Seite.

import { useCallback, useRef, useState } from "react";
import { useApiErrorDisplay } from "~/contexts/ToastContext";
import { createLogger } from "~/lib/logger";

const logger = createLogger({ component: "CsvFilePreview" });

/** Größte Datei, die das Backend liest, in Bytes. */
const MAX_CSV_FILE_BYTES = 2 * 1024 * 1024;

/** Was an der gewählten Datei nicht passt, als Satz; `null` passt. */
function csvFileProblem(
  file: File,
  maxBytes = MAX_CSV_FILE_BYTES,
): string | null {
  if (!/\.(csv|txt)$/i.test(file.name)) {
    return "Bitte wähle eine CSV-Datei. Eine Excel-Datei speichere vorher als CSV.";
  }
  if (file.size > maxBytes) {
    return "Die Datei ist zu groß. Erlaubt sind 2 MB.";
  }
  return null;
}

export function useCsvFilePreview<Mapping, Result>({
  preview,
  logEvent,
  maxBytes = MAX_CSV_FILE_BYTES,
}: Readonly<{
  /** Liest die Datei; `null` nimmt die Zuordnung, die moto vorschlägt. */
  preview: (file: File, mapping: Mapping | null) => Promise<Result>;
  /** Name des Log-Ereignisses, wenn das Lesen scheitert. */
  logEvent: string;
  maxBytes?: number;
}>) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  // The result on screen belongs to the newest look at the file.
  const [verified, setVerified] = useState(false);
  const [reading, setReading] = useState(false);
  const { show, showMessage } = useApiErrorDisplay();
  const request = useRef(0);

  const read = useCallback(
    async (chosen: File, mapping: Mapping | null) => {
      const id = ++request.current;
      setVerified(false);
      setReading(true);
      try {
        const next = await preview(chosen, mapping);
        if (id === request.current) {
          setResult(next);
          setVerified(true);
        }
      } catch (err) {
        logger.error(logEvent, {
          error: err instanceof Error ? err.message : String(err),
        });
        if (id === request.current) void show(err, { object: "die Datei" });
      } finally {
        if (id === request.current) setReading(false);
      }
    },
    [preview, logEvent, show],
  );

  /** Nimmt eine gewählte Datei und liest sie; `false`, wenn sie nicht passt. */
  const choose = (chosen: File): boolean => {
    const problem = csvFileProblem(chosen, maxBytes);
    if (problem) {
      showMessage(problem);
      return false;
    }
    setFile(chosen);
    setResult(null);
    void read(chosen, null);
    return true;
  };

  /** Verwirft die Datei; eine Antwort, die noch unterwegs ist, zählt nicht mehr. */
  const restart = () => {
    request.current++;
    setFile(null);
    setResult(null);
    setVerified(false);
    setReading(false);
  };

  return { file, result, setResult, verified, reading, read, choose, restart };
}
