"use client";

import { bffFile } from "~/lib/bff-fetch";

// Exporte für Kämmerei und Steuerbüro (#4693, #4694): je ausgestellten Lauf
// die Sollstellung als CSV mit der Feldzuordnung des Trägers und den
// DATEV-Buchungsstapel, sobald die DATEV-Werte vollständig sind, und das
// Exportprotokoll aller Dateien, auch der Lastschriftdateien. Jeder Abruf
// bekommt die nächste Dateinummer des Trägers. Nur das Recht
// „Finanz-Export“ sieht die Seite.

import { useMemo, useRef, useState } from "react";
import { billingTabs } from "~/components/traeger/billing-family-format";
import { EXPORT_RECIPIENT_PATH } from "~/components/traeger/export-handover-format";
import {
  BOOKING_ACCOUNTS_PATH,
  DATEV_SETTINGS_PATH,
  DatevNothingNewNotice,
  DatevReadinessNotice,
  DatevRefusedNotice,
  DatevRepeatDialog,
} from "~/components/traeger/finance-export-datev";
import {
  type DatevHandoverNotices,
  handoverMenuItems,
  useFinanceHandover,
} from "~/components/traeger/finance-export-handover";
import {
  ExportProtocolTable,
  ExportRunsTable,
  type RunFileFormat,
  runFileKey,
} from "~/components/traeger/finance-export-tables";
import {
  TraegerListExportMenu,
  traegerExportScope,
} from "~/components/traeger/traeger-list-export-menu";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { SectionCard } from "~/components/ui/section-card";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { useApiErrorDisplay, useToast } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import { downloadBlob } from "~/lib/file-download";
import { createLogger } from "~/lib/logger";
import { traegerBillingKeys } from "~/lib/swr/traeger-billing-keys";
import {
  downloadTraegerList,
  listExportQuery,
} from "~/lib/traeger-list-export";
import {
  type DatevBookingProblem,
  type DatevDownloadOptions,
  type DatevRunStates,
  type ExportProtocolEntry,
  type ExportRun,
  type ExportSettings,
  type FinanceExportPage,
  type FinanceExportRunPage,
  datevBookingProblems,
  downloadDatevBatch,
  datevRunKey,
  downloadSollstellung,
  fetchDatevRunStates,
  fetchExportProtocol,
  fetchExportRuns,
  fetchExportSettings,
} from "~/lib/traeger-finance-exports-api";
import { traegerPath } from "~/lib/traeger-url";

const logger = createLogger({ component: "TraegerFinanceExportsPage" });

const INFO =
  "Hier lädst du die Sollstellung für deine Kämmerei und die DATEV-Datei für dein Steuerbüro herunter. Welche Spalten die Sollstellung hat, legst du unter „Feldzuordnung“ fest. Jede Datei bekommt eine neue Nummer und steht im Protokoll. Rechnet ein Schulträger oder eine Gemeinde eine Schule selbst ab, fehlen deren Schreiben hier: Sie bucht sie in ihrem eigenen Haushalt.";

/** What the page shows, once runs, protocol and settings are there. */
function exportsData(
  runs: FinanceExportRunPage | null,
  protocol: FinanceExportPage<ExportProtocolEntry> | null,
  settings: ExportSettings | null,
  datevRuns: DatevRunStates | null,
) {
  if (!runs || !protocol || !settings) return null;
  return {
    runs,
    protocol,
    nextFileNumber: settings.nextFileNumber,
    datev: settings.datev,
    datevRuns: datevRuns ?? NO_DATEV_RUNS,
  };
}

/** A DATEV download that found no new booking, and of which run. */
interface DatevNothingNew {
  readonly runLabel: string;
  readonly taken: boolean;
}

const NO_DATEV_RUNS: DatevRunStates = { ready: false, runs: new Map() };

/** The invoices of a refused DATEV download and the run they belong to. */
interface DatevRefusal {
  readonly runKind: ExportRun["runKind"];
  readonly runLabel: string;
  readonly problems: readonly DatevBookingProblem[];
}

const FILE_NAMES: Record<RunFileFormat, string> = {
  sollstellung: "die Sollstellung",
  datev: "die DATEV-Datei",
};

/** The toast after a download; a repeat says that it is one. */
function datevSuccess(
  filename: string,
  format: RunFileFormat,
  run: ExportRun,
  options: DatevDownloadOptions,
): string {
  if (format === "datev" && options.all) {
    return `${filename} ist heruntergeladen. Sie wiederholt alle Buchungen von ${run.label}.`;
  }
  return `${filename} ist heruntergeladen.`;
}

/** Joins the next page onto the pages read so far. */
function joinPages<P extends FinanceExportPage<unknown>>(read: P, next: P): P {
  return { ...next, items: [...read.items, ...next.items] };
}

/**
 * Reads pages from the first one until at least `count` entries or the end,
 * so a reload keeps the older pages a person already opened.
 */
async function readPages<P extends FinanceExportPage<unknown>>(
  fetchPage: (offset: number) => Promise<P>,
  count: number,
): Promise<P> {
  let pages = await fetchPage(0);
  while (pages.items.length < count && pages.nextOffset !== null) {
    pages = joinPages(pages, await fetchPage(pages.nextOffset));
  }
  return pages;
}

/** „Ältere anzeigen“ under a list the server pages (`DataTable moreAction`). */
function olderPages(
  page: FinanceExportPage<unknown>,
  loading: boolean,
  onMore: () => void,
) {
  if (page.nextOffset === null) return undefined;
  return {
    label: "Ältere anzeigen",
    onClick: onMore,
    loading,
    loadingText: "Wird geladen …",
    tooltip: "Zeigt weitere Einträge unten in der Liste an.",
  };
}

/** The pages beside the exports, in the page menu (#7407). */
const SETTINGS_PAGES: readonly {
  readonly label: string;
  readonly href: string;
  readonly description: string;
}[] = [
  {
    label: "Empfänger der Exporte",
    href: EXPORT_RECIPIENT_PATH,
    description: "Öffnet die Empfänger, an die moto die Exporte schickt.",
  },
  {
    label: "DATEV-Werte",
    href: DATEV_SETTINGS_PATH,
    description: "Öffnet die DATEV-Werte in den Einstellungen.",
  },
  {
    label: "Feldzuordnung",
    href: "/traeger/abrechnung/exporte/feldzuordnung",
    description:
      "Öffnet die Spalten der Sollstellung für die Kämmerei zum Ändern.",
  },
  {
    label: "Konten und Kostenstellen",
    href: BOOKING_ACCOUNTS_PATH,
    description:
      "Öffnet die Erlöskonten und Kostenstellen für DATEV-Datei und Sollstellung.",
  },
];

export default function TraegerFinanceExportsPage() {
  const [downloading, setDownloading] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<DatevRefusal | null>(null);
  const [nothingNew, setNothingNew] = useState<DatevNothingNew | null>(null);
  const [repeat, setRepeat] = useState<ExportRun | null>(null);
  // „Alle Buchungen erneut“ for the recipient instead of the browser.
  const [repeatHandover, setRepeatHandover] = useState(false);
  const [loadingMore, setLoadingMore] = useState<"runs" | "protocol" | null>(
    null,
  );
  const errors = useApiErrorDisplay();
  const { success } = useToast();

  // A reload reads as many entries as the person already opened.
  const opened = useRef({ runs: 0, protocol: 0 });
  const runsRead = useTraegerResource(
    traegerBillingKeys.exportRuns(),
    () => readPages(fetchExportRuns, opened.current.runs),
    "die Exporte",
  );
  const protocolRead = useTraegerResource(
    traegerBillingKeys.exportProtocol(),
    () => readPages(fetchExportProtocol, opened.current.protocol),
    "die Exporte",
  );
  const settingsRead = useTraegerResource(
    traegerBillingKeys.exportSettings(),
    fetchExportSettings,
    "die Exporte",
  );
  const settings = settingsRead.data;
  const runItems = runsRead.data?.items;
  // The new DATEV bookings of the shown runs (#6433). A failure leaves the
  // table with the last DATEV file of each run, as before #6433: the
  // download still names every refusal itself.
  const datevRead = useTraegerResource(
    settings?.datev.ready && runItems
      ? traegerBillingKeys.datevRuns(runItems.map(datevRunKey))
      : null,
    () => fetchDatevRunStates(runItems ?? []),
    "die DATEV-Buchungen",
    { keepPreviousData: true },
  );
  const data = exportsData(
    runsRead.data,
    protocolRead.data,
    settings,
    datevRead.data,
  );
  const loadError = runsRead.error ?? protocolRead.error ?? settingsRead.error;
  const loading = !data && !loadError;
  const reloadAll = () => {
    runsRead.reload();
    protocolRead.reload();
    settingsRead.reload();
    datevRead.reload();
  };

  // A DATEV handover that makes no file shows the notices of the download.
  const runs = data?.runs.items;
  const datevNotices = useMemo<DatevHandoverNotices>(
    () => ({
      onAttempt: () => {
        setRefusal(null);
        setNothingNew(null);
      },
      onNothingNew: (run, taken) =>
        setNothingNew({ runLabel: run.label, taken }),
      onRefused: (run, problems) =>
        setRefusal({
          runKind:
            runs?.find(
              (item) =>
                item.pathKind === run.pathKind && item.runId === run.runId,
            )?.runKind ?? "care",
          runLabel: run.label,
          problems,
        }),
    }),
    [runs],
  );

  // Handover to the recipient of each format (ADR 0218, ADR 0222); a handover reloads
  // the runs and the protocol like a download.
  const handover = useFinanceHandover(reloadAll, datevNotices);
  const openRepeat = (run: ExportRun, toRecipient: boolean) => {
    setRepeatHandover(toRecipient);
    setRepeat(run);
  };

  const loadMore = async (list: "runs" | "protocol") => {
    if (!data) return;
    const offset =
      list === "runs" ? data.runs.nextOffset : data.protocol.nextOffset;
    if (offset === null) return;
    setLoadingMore(list);
    try {
      if (list === "runs") {
        const runs = joinPages(data.runs, await fetchExportRuns(offset));
        opened.current.runs = runs.items.length;
        await runsRead.mutate(runs, { revalidate: false });
      } else {
        const protocol = joinPages(
          data.protocol,
          await fetchExportProtocol(offset),
        );
        opened.current.protocol = protocol.items.length;
        await protocolRead.mutate(protocol, { revalidate: false });
      }
    } catch (err) {
      logger.error("traeger_finance_exports_more_failed", {
        list,
        error: err instanceof Error ? err.message : String(err),
      });
      void errors.show(err, {
        object: list === "runs" ? "die älteren Läufe" : "die älteren Dateien",
      });
    } finally {
      setLoadingMore(null);
    }
  };

  const download = async (
    format: RunFileFormat,
    run: ExportRun,
    options: DatevDownloadOptions = {},
  ) => {
    setDownloading(runFileKey(format, run));
    setRefusal(null);
    setNothingNew(null);
    try {
      const file =
        format === "datev"
          ? await downloadDatevBatch(run.pathKind, run.runId, options)
          : await downloadSollstellung(run.pathKind, run.runId);
      downloadBlob(file.blob, file.filename);
      setRepeat(null);
      success(datevSuccess(file.filename, format, run, options));
    } catch (err) {
      const problems =
        format === "datev" && err instanceof ApiError
          ? datevBookingProblems(err.details)
          : [];
      const code =
        format === "datev" && err instanceof ApiError ? err.code : undefined;
      if (
        code === "parent_billing.datev_no_new_bookings" ||
        code === "parent_billing.datev_bookings_taken"
      ) {
        // Nothing new to book: no fault, no number used. The notice above
        // the list says so and the reload shows the run's state.
        setRepeat(null);
        setNothingNew({
          runLabel: run.label,
          taken: code === "parent_billing.datev_bookings_taken",
        });
      } else if (problems.length > 0) {
        // A refusal of the content, not a fault: the notice above the list
        // names every refused invoice and what to do; a toast would repeat
        // it without the names.
        logger.warn("traeger_datev_download_refused", {
          documents: problems.length,
        });
        setRepeat(null);
        setRefusal({ runKind: run.runKind, runLabel: run.label, problems });
      } else {
        logger.error("traeger_finance_export_download_failed", {
          format,
          error: err instanceof Error ? err.message : String(err),
        });
        void errors.show(err, { object: FILE_NAMES[format] });
      }
    } finally {
      setDownloading(null);
      reloadAll();
    }
  };

  return (
    <TenantPage
      title="Exporte"
      info={INFO}
      tabs={billingTabs("exporte")}
      overflowMenu={SETTINGS_PAGES.map((page) => ({
        label: page.label,
        description: page.description,
        href: traegerPath(page.href),
        onClick: () => undefined,
      }))}
      stats={
        data ? (
          <TenantPageStats
            items={[
              {
                value: data.runs.total,
                label: data.runs.total === 1 ? "Lauf" : "Läufe",
              },
              { value: data.runs.notExported, label: "noch nicht exportiert" },
              {
                value: `Nr. ${data.nextFileNumber}`,
                label: "ist die nächste Datei",
              },
            ]}
          />
        ) : null
      }
      statsLoading={loading}
      error={loadError}
      loading={loading}
    >
      {data ? (
        <>
          <DatevReadinessNotice readiness={data.datev} />
          {handover.notice}
          {nothingNew ? (
            <DatevNothingNewNotice
              runLabel={nothingNew.runLabel}
              taken={nothingNew.taken}
              onDismiss={() => setNothingNew(null)}
            />
          ) : null}
          {refusal ? (
            <DatevRefusedNotice
              runKind={refusal.runKind}
              runLabel={refusal.runLabel}
              problems={refusal.problems}
            />
          ) : null}
          <SectionCard
            title="Dateien pro Lauf"
            description="Die Sollstellung ist für deine Kämmerei, die DATEV-Datei für dein Steuerbüro. Die DATEV-Datei enthält nur neue Buchungen."
            action={
              <TraegerListExportMenu
                download={(format) =>
                  downloadTraegerList(
                    bffFile("org", "GET /traeger/finance-exports/runs/export", {
                      query: listExportQuery(format),
                    }),
                  )
                }
                scope={traegerExportScope()}
                ariaLabel="Läufe der Exporte herunterladen"
                fallbackName="exportlaeufe"
                errorObject="die Läufe der Exporte"
                unavailable={data.runs.total === 0}
              />
            }
          >
            <ExportRunsTable
              runs={data.runs.items}
              downloading={downloading}
              datev={{ ...data.datevRuns, settingsReady: data.datev.ready }}
              onDownload={(format, run) => void download(format, run)}
              onRepeat={(run) => openRepeat(run, false)}
              busy={downloading !== null || handover.running !== null}
              handingOver={(run) =>
                handover.isRunning("sollstellung", run) ||
                handover.isRunning("datev", run)
              }
              handoverItems={(run) =>
                handoverMenuItems({
                  recipients: handover.recipients,
                  formats: data.datev.ready
                    ? ["sollstellung", "datev"]
                    : ["sollstellung"],
                  onHandOver: (format) => handover.handOver(format, run),
                  onHandOverAll:
                    data.datev.ready &&
                    run.lastDatev &&
                    (data.datevRuns.runs.get(datevRunKey(run))?.fiscalYears
                      .length ?? 0) > 0
                      ? () => openRepeat(run, true)
                      : undefined,
                })
              }
              moreAction={olderPages(
                data.runs,
                loadingMore === "runs",
                () => void loadMore("runs"),
              )}
            />
          </SectionCard>
          <SectionCard
            title="Exportprotokoll"
            description="Jede Datei, die moto verlassen hat: Sollstellungen, DATEV-Dateien und Lastschriftdateien."
            action={
              <TraegerListExportMenu
                download={(format) =>
                  downloadTraegerList(
                    bffFile(
                      "org",
                      "GET /traeger/finance-exports/files/export",
                      { query: listExportQuery(format) },
                    ),
                  )
                }
                scope={traegerExportScope()}
                ariaLabel="Exportprotokoll herunterladen"
                fallbackName="exportprotokoll"
                errorObject="das Exportprotokoll"
                unavailable={data.protocol.total === 0}
              />
            }
          >
            <ExportProtocolTable
              entries={data.protocol.items}
              moreAction={olderPages(
                data.protocol,
                loadingMore === "protocol",
                () => void loadMore("protocol"),
              )}
            />
          </SectionCard>
          {handover.dialog}
          <DatevRepeatDialog
            key={repeat ? datevRunKey(repeat) : "closed"}
            runLabel={repeat?.label ?? null}
            fiscalYears={
              repeat
                ? (data.datevRuns.runs.get(datevRunKey(repeat))?.fiscalYears ??
                  [])
                : []
            }
            handover={repeatHandover}
            loading={
              repeat !== null &&
              (repeatHandover
                ? handover.isRunning("datev", repeat)
                : downloading === runFileKey("datev", repeat))
            }
            onClose={() => setRepeat(null)}
            onConfirm={(fiscalYear) => {
              if (!repeat) return;
              if (repeatHandover) {
                // The handover asks again itself when the recipient has it.
                setRepeat(null);
                handover.handOver("datev", repeat, { all: true, fiscalYear });
              } else void download("datev", repeat, { all: true, fiscalYear });
            }}
          />
        </>
      ) : null}
    </TenantPage>
  );
}
