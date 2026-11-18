"use client";

// Der Download jeder Liste und jedes Berichts im Träger-Portal (#4718): PDF,
// Excel und CSV in einem Menü „Herunterladen“, mit dem Filter der Seite. Über
// den Einträgen steht, für welche Schulen die Datei gilt, damit niemand eine
// Schule herunterlädt und alle erwartet.
//
// Zwei Formen mit derselben Download-, Warte- und Fehlerlogik (#7403):
// - `useTraegerListExportItems` im Seitenkopf: die Einträge stehen im
//   Drei-Punkte-Menü der Seite (`TenantPage` `overflowMenu`) unter der
//   Überschrift „Herunterladen“ (TENANT-PAGE-SPEC Regel 4).
// - `TraegerListExportMenu` auf einer Karte oder einem Tabellenkopf ohne
//   eigenes Seitenmenü: der Knopf „Herunterladen ▾“.

import { useState } from "react";

import {
  ExportMenu,
  exportMenuItems,
  type ExportMenuOption,
} from "~/components/ui/export-menu";
import type { OverflowMenuEntry } from "~/components/ui/page-header/OverflowMenu";
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

interface TraegerListDownloadOptions {
  /**
   * Fetches the file in one format with the filters of the page, usually
   * `downloadTraegerList` or the list's own client.
   */
  readonly download: (format: TraegerListFormat) => Promise<TraegerListFile>;
  /** The heading over the formats, from `traegerExportScope`. */
  readonly scope: string;
  /** The file name without ending, when the backend names none. */
  readonly fallbackName: string;
  /** The object of the error message: „die Belegung“. */
  readonly errorObject: string;
  /** The data behind the export is not there yet. */
  readonly unavailable?: boolean;
  /**
   * Hears every failed download first, so a page can drop what it loaded
   * once the session or the right is gone.
   */
  readonly onError?: (error: unknown) => void;
}

/**
 * The download of one format, shared by the menu entries and the button:
 * the format being created, and the toast when it fails.
 */
function useTraegerListDownload({
  download: fetchFile,
  fallbackName,
  errorObject,
  onError,
}: TraegerListDownloadOptions) {
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

  function select(option: ExportMenuOption) {
    // The menu holds only the list formats; Word is none of them.
    if (option.format && option.format !== "docx") {
      void download(option.format);
    }
  }

  return { busy, select };
}

/**
 * PDF, Excel and CSV of one list as entries for the page menu
 * (`TenantPage` `overflowMenu`), under the heading „Herunterladen“ with the
 * schools of the file below it. For the page head; a card without a page
 * menu takes `TraegerListExportMenu`.
 */
export function useTraegerListExportItems(
  options: TraegerListDownloadOptions,
): OverflowMenuEntry[] {
  const { busy, select } = useTraegerListDownload(options);
  return exportMenuItems({
    headerDescription: options.scope,
    options: TRAEGER_LIST_FORMAT_OPTIONS,
    busyKey: busy,
    unavailable: options.unavailable,
    onSelect: select,
  });
}

interface TraegerListExportMenuProps extends TraegerListDownloadOptions {
  /** The name of the list for screen readers: „Belegung herunterladen“. */
  readonly ariaLabel: string;
  /** What a click on the trigger does, when the kit sentence is not enough. */
  readonly tooltip?: string;
}

/**
 * „Herunterladen ▾“ with PDF, Excel and CSV of one list, for a card or a
 * table head that has no page menu of its own. In the page head the export
 * goes into the page's menu instead: `useTraegerListExportItems`. The backend
 * builds the file with the page's filters, so the file holds what the page
 * shows.
 */
export function TraegerListExportMenu({
  ariaLabel,
  tooltip,
  ...options
}: TraegerListExportMenuProps) {
  const { busy, select } = useTraegerListDownload(options);
  return (
    <ExportMenu
      ariaLabel={ariaLabel}
      tooltip={tooltip}
      header={options.scope}
      options={TRAEGER_LIST_FORMAT_OPTIONS}
      busyKey={busy}
      unavailable={options.unavailable}
      onSelect={select}
    />
  );
}
