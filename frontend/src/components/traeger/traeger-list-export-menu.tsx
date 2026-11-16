"use client";

// Der Download jeder Liste und jedes Berichts im Träger-Portal (#4718): PDF,
// Excel und CSV in einem Menü „Herunterladen“, mit dem Filter der Seite. Über
// den Einträgen steht, für welche Schulen die Datei gilt, damit niemand eine
// Schule herunterlädt und alle erwartet.

import { useState } from "react";

import { ExportMenu, type ExportMenuOption } from "~/components/ui/export-menu";
import { useApiErrorDisplay } from "~/contexts/ToastContext";
import { downloadBlob } from "~/lib/file-download";
import { createLogger } from "~/lib/logger";
import {
  TRAEGER_LIST_FORMATS,
  type TraegerListFile,
  type TraegerListFormat,
} from "~/lib/traeger-list-export";

const logger = createLogger({ component: "TraegerListExportMenu" });

/** What each format is good for, in one line under its name. */
const TRAEGER_LIST_FORMAT_DESCRIPTIONS: Readonly<
  Record<TraegerListFormat, string>
> = {
  pdf: "Zum Drucken und Ablegen",
  xlsx: "Zum Weiterrechnen in einer Tabelle",
  csv: "Für andere Programme",
};

/** The menu entries of the formats, in the order of the menu. */
export const TRAEGER_LIST_FORMAT_OPTIONS: readonly ExportMenuOption[] =
  TRAEGER_LIST_FORMATS.map((format) => ({
    key: format,
    format,
    description: TRAEGER_LIST_FORMAT_DESCRIPTIONS[format],
  }));

/**
 * The heading over the formats: which schools the file holds. Without a
 * school chosen it is every school the page shows.
 */
export function traegerExportScope(schoolName?: string | null): string {
  return schoolName ? `Nur ${schoolName}` : "Alle Schulen";
}

interface TraegerListExportMenuProps {
  /**
   * Fetches the file in one format with the filters of the page, usually
   * `downloadTraegerList` or the list's own client.
   */
  readonly download: (format: TraegerListFormat) => Promise<TraegerListFile>;
  /** The heading over the formats, from `traegerExportScope`. */
  readonly scope: string;
  /** The name of the list for screen readers: „Belegung herunterladen“. */
  readonly ariaLabel: string;
  /** The file name without ending, when the backend names none. */
  readonly fallbackName: string;
  /** The object of the error message: „die Belegung“. */
  readonly errorObject: string;
  /** The data behind the export is not there yet. */
  readonly unavailable?: boolean;
  /** What a click on the trigger does, when the kit sentence is not enough. */
  readonly tooltip?: string;
  /**
   * Hears every failed download first, so a page can drop what it loaded
   * once the session or the right is gone.
   */
  readonly onError?: (error: unknown) => void;
}

/**
 * „Herunterladen“ with PDF, Excel and CSV of one list. The backend builds
 * the file with the page's filters, so the file holds what the page shows.
 */
export function TraegerListExportMenu({
  download: fetchFile,
  scope,
  ariaLabel,
  fallbackName,
  errorObject,
  unavailable = false,
  tooltip,
  onError,
}: TraegerListExportMenuProps) {
  const { show: showActionError } = useApiErrorDisplay();
  const [busy, setBusy] = useState<TraegerListFormat | null>(null);

  async function download(format: TraegerListFormat) {
    setBusy(format);
    try {
      const file = await fetchFile(format);
      downloadBlob(file.blob, file.filename ?? `${fallbackName}.${format}`);
    } catch (err) {
      onError?.(err);
      logger.error("traeger_list_export_failed", {
        list: fallbackName,
        format,
        error: err instanceof Error ? err.message : String(err),
      });
      await showActionError(err, { object: errorObject });
    } finally {
      setBusy(null);
    }
  }

  return (
    <ExportMenu
      ariaLabel={ariaLabel}
      tooltip={tooltip}
      header={scope}
      options={TRAEGER_LIST_FORMAT_OPTIONS}
      busyKey={busy}
      unavailable={unavailable}
      onSelect={(option) => {
        // The menu holds only the list formats; Word is none of them.
        if (option.format && option.format !== "docx") {
          void download(option.format);
        }
      }}
    />
  );
}
