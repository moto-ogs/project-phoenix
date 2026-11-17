"use client";

// Ein gespeichertes Schreiben als PDF (#5692), für die Schreiben der
// Ferienbetreuung und der Monatsbeiträge (#4684): „Herunterladen“, „In
// neuem Tab öffnen“ und die Seite selbst. Beide Knöpfe nehmen genau die
// gezeigte Datei, ohne zweite Anfrage. Jedes Öffnen geht über denselben
// angemeldeten Endpunkt wie der Download und steht deshalb im Protokoll.

import { Download, ExternalLink } from "lucide-react";
import { ActionHint } from "~/components/ui/action-hint";
import { Button, buttonClassName } from "~/components/ui/button";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { PdfPreview, useObjectUrl } from "~/components/ui/pdf-preview";
import { downloadBlob } from "~/lib/file-download";
import { traegerBillingRunKeys } from "~/lib/swr/traeger-billing-run-keys";
import type { BillingFile } from "~/lib/traeger-billing-api";
import { useFreshTraegerResource } from "./use-traeger-resource";

const OPEN_TAB_HINT = "Öffnet das Schreiben als PDF in einem neuen Tab.";
const LOAD_FAILED_REASON =
  "Das Schreiben ließ sich nicht laden. Bitte laden Sie es erneut.";

export function LetterFileView({
  fileKey,
  load,
  title,
}: Readonly<{
  /** Names the file across runs and kinds; a new key loads it again. */
  fileKey: string;
  load: () => Promise<BillingFile>;
  /** „Rechnung FE-2026-0001“: names the frame and both buttons. */
  title: string;
}>) {
  // `load` belongs to the key: a new function for the same key loads
  // nothing, so callers may pass it inline. The frame and the tab show the
  // file as a PDF whatever type the response named, so nothing else ever
  // renders on this origin.
  const { data: file, error } = useFreshTraegerResource(
    fileKey ? traegerBillingRunKeys.letterFile(fileKey) : null,
    async () => {
      const next = await load();
      return {
        blob: new Blob([next.blob], { type: "application/pdf" }),
        filename: next.filename,
      };
    },
    "das Schreiben",
  );
  const url = useObjectUrl(file?.blob ?? null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="surface"
          size="compact"
          disabled={!file}
          disabledReason={error ? LOAD_FAILED_REASON : undefined}
          aria-label={`${title} herunterladen`}
          tooltip="Lädt das Schreiben als PDF auf Ihr Gerät."
          onClick={() => {
            if (file) downloadBlob(file.blob, file.filename);
          }}
          className="gap-1.5"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Herunterladen
        </Button>
        {url ? (
          <ActionHint text={OPEN_TAB_HINT}>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${title} in neuem Tab öffnen`}
              className={buttonClassName({
                variant: "surface",
                size: "compact",
                className: "gap-1.5",
              })}
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              In neuem Tab öffnen
            </a>
          </ActionHint>
        ) : (
          <Button
            type="button"
            variant="surface"
            size="compact"
            disabled
            disabledReason={error ? LOAD_FAILED_REASON : undefined}
            tooltip={OPEN_TAB_HINT}
            className="gap-1.5"
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            In neuem Tab öffnen
          </Button>
        )}
      </div>
      {error ? (
        <LoadErrorAlert error={error} actionLayout="responsive" />
      ) : (
        <PdfPreview url={url} title={title} />
      )}
    </div>
  );
}
