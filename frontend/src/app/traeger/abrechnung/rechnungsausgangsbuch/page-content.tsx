"use client";

// Rechnungsausgangsbuch (#4819): jedes ausgestellte Dokument der
// Elternabrechnung in einer Liste, über alle Läufe, Rechnungssteller und
// Nummernkreise. Träger-Büro und Prüfung lesen sie nach Nummer: Fehlt in
// einem Nummernkreis eine Nummer, steht das als Warnung über der Liste. Ein
// Dokument steht hier, sobald es seine Nummer hat; Entwürfe eines Laufs
// haben keine. Nur zum Lesen. Filter, Summen und Seiten rechnet der Server;
// jedes Lesen steht im Protokoll der gezeigten Läufe.

import { useMemo, useState } from "react";
import { TriangleAlert } from "lucide-react";
import type { DateRange } from "react-day-picker";
import {
  billingAreaTitle,
  billingTabs,
} from "~/components/traeger/billing-family-format";
import { formatEuro } from "~/components/traeger/contribution-format";
import { emptySearchText } from "~/components/traeger/empty-search";
import {
  JOURNAL_DOCUMENT_TYPE_LABELS,
  JOURNAL_DOCUMENT_TYPE_TONES,
  JOURNAL_DOCUMENT_TYPES,
  journalGapText,
  journalIssuerLabel,
  journalIssuers,
  journalPeriodLabel,
  journalRangeLabel,
  journalRangeOf,
  journalRangeValue,
  journalReferenceLabel,
  journalRunHref,
  journalRunLabel,
  journalRunOf,
  journalRunValue,
} from "~/components/traeger/invoice-journal-format";
import { useTraegerListExportItems } from "~/components/traeger/traeger-list-export-menu";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { DateRangePicker } from "~/components/ui/date-range-picker";
import { EmptyState } from "~/components/ui/empty-state";
import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import NavigationLink from "~/components/ui/navigation-link";
import type {
  ActiveFilter,
  FilterConfig,
} from "~/components/ui/page-header/types";
import {
  ResponsiveActionList,
  ResponsiveActionRow,
  ResponsiveRowActions,
} from "~/components/ui/responsive-action-list";
import { SectionCard } from "~/components/ui/section-card";
import { StatCard } from "~/components/ui/stat-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { useApiErrorDisplay } from "~/contexts/ToastContext";
import { billingConcept } from "~/lib/concepts/billing";
import {
  berlinTodayISO,
  formatDate,
  parseISODate,
  toISODate,
} from "~/lib/date-helpers";
import { labelOf } from "~/lib/label-of";
import { createLogger } from "~/lib/logger";
import { traegerBillingKeys } from "~/lib/swr/traeger-billing-keys";
import {
  type InvoiceJournalFilter,
  type InvoiceJournalPage,
  type JournalDocument,
  type JournalDocumentType,
  type JournalNumberGap,
  type JournalRangeFilter,
  downloadInvoiceJournal,
  fetchInvoiceJournal,
} from "~/lib/traeger-invoice-journal-api";

const logger = createLogger({ component: "TraegerInvoiceJournalPage" });

const NO_RANGES: InvoiceJournalPage["numberRanges"] = [];
const NO_RUNS: InvoiceJournalPage["runs"] = [];

/** Typing a number or a name asks the server once the person pauses. */
const SEARCH_PAUSE_MS = 300;

/** A cancellation and a credit take money back: their amount stays signed. */
function amountCell(cents: number) {
  return (
    <span
      className={
        cents === 0
          ? "text-gray-500 tabular-nums"
          : "text-gray-900 tabular-nums"
      }
    >
      {formatEuro(cents)}
    </span>
  );
}

function typeBadge(document: JournalDocument) {
  return (
    <StatusBadge
      tone={labelOf(JOURNAL_DOCUMENT_TYPE_TONES, document.documentType, "gray")}
      label={labelOf(
        JOURNAL_DOCUMENT_TYPE_LABELS,
        document.documentType,
        "Dokument",
      )}
    />
  );
}

/** The run of a document opens its page: there lie its letters. */
function runCell(document: JournalDocument) {
  const label = journalRunLabel(document.run);
  const href = journalRunHref(document.run);
  if (!href) return label;
  return (
    <NavigationLink
      href={href}
      className="rounded-sm text-gray-900 underline decoration-gray-300 underline-offset-2 hover:decoration-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900"
    >
      {label}
    </NavigationLink>
  );
}

function journalColumns(
  severalIssuers: boolean,
): DataTableColumn<JournalDocument>[] {
  return [
    {
      key: "number",
      header: "Nummer",
      render: (document) => (
        <span className="font-mono font-medium whitespace-nowrap text-gray-900">
          {document.number}
        </span>
      ),
      stacked: "title",
    },
    {
      key: "issued",
      header: "Datum",
      render: (document) => (
        <span className="whitespace-nowrap tabular-nums">
          {formatDate(document.issuedOn)}
        </span>
      ),
      // On a phone the date leads the line under the number.
      stacked: "hidden",
    },
    {
      key: "type",
      // The reference stands beside its type: „Storno“ and the invoice it
      // takes back read as one fact.
      header: "Dokumentart und Bezug",
      render: (document) => (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {typeBadge(document)}
          {document.reference ? (
            <span className="whitespace-nowrap text-gray-600">
              {journalReferenceLabel(document.reference)}
            </span>
          ) : null}
        </span>
      ),
      stackedLabel: false,
      stackedRender: (document) => (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-gray-600">
          <span className="whitespace-nowrap tabular-nums">
            {formatDate(document.issuedOn)}
          </span>
          {typeBadge(document)}
          {document.reference ? (
            <span className="whitespace-nowrap">
              {journalReferenceLabel(document.reference)}
            </span>
          ) : null}
          <span className="basis-full text-gray-900">
            {document.recipientName || "–"}
          </span>
        </span>
      ),
    },
    {
      key: "recipient",
      header: "Empfänger",
      render: (document) => (
        <span className="text-gray-900">{document.recipientName || "–"}</span>
      ),
      // The phone line under the number already names the recipient.
      stacked: "hidden",
    },
    ...(severalIssuers
      ? [
          {
            key: "issuer",
            header: "Rechnungssteller",
            render: (document: JournalDocument) =>
              journalIssuerLabel(document.issuer),
          } satisfies DataTableColumn<JournalDocument>,
        ]
      : []),
    { key: "run", header: "Lauf", render: runCell },
    {
      key: "net",
      header: "Netto",
      align: "right",
      render: (document) => amountCell(document.netCents),
    },
    {
      key: "tax",
      header: "Steuer",
      align: "right",
      render: (document) => amountCell(document.taxCents),
    },
    {
      key: "gross",
      header: "Brutto",
      align: "right",
      render: (document) => (
        <span className="font-medium">{amountCell(document.grossCents)}</span>
      ),
      stacked: "meta",
      stackedTone: "figure",
    },
  ];
}

function rangePresets() {
  const today = parseISODate(berlinTodayISO());
  const year = today.getFullYear();
  const month = today.getMonth();
  return [
    {
      label: "Dieser Monat",
      range: () => ({ from: new Date(year, month, 1), to: today }),
    },
    {
      label: "Letzter Monat",
      range: () => ({
        from: new Date(year, month - 1, 1),
        to: new Date(year, month, 0),
      }),
    },
    {
      label: "Dieses Jahr",
      range: () => ({ from: new Date(year, 0, 1), to: today }),
    },
    {
      label: "Letztes Jahr",
      range: () => ({
        from: new Date(year - 1, 0, 1),
        to: new Date(year - 1, 11, 31),
      }),
    },
  ];
}

/** The gap of a number range, named by its range. */
function gapKey(gap: JournalNumberGap): string {
  return `${gap.service ?? ""}|${gap.year}|${gap.issuer.key}|${gap.afterNumber}|${gap.beforeNumber}`;
}

function gapRange(gap: JournalNumberGap): JournalRangeFilter | null {
  return gap.service
    ? { issuerKey: gap.issuer.key, service: gap.service, year: gap.year }
    : null;
}

const GAP_NEXT_STEP =
  "moto vergibt jede Nummer nur einmal und ohne Lücke. Wende dich an das moto-Team und nenne die fehlenden Nummern. Wir klären die Ursache mit dir.";

/**
 * The gaps of the number ranges in view. One gap is one notice; several
 * stand as rows of one card (frontend-ui-kit, „Several notices of the same
 * kind“). The step to the range shows the numbers around the gap.
 */
function NumberGaps({
  gaps,
  severalIssuers,
  shownRange,
  onShowRange,
}: Readonly<{
  gaps: readonly JournalNumberGap[];
  severalIssuers: boolean;
  shownRange: string;
  onShowRange: (range: JournalRangeFilter) => void;
}>) {
  if (gaps.length === 0) return null;
  const showButton = (gap: JournalNumberGap) => {
    const range = gapRange(gap);
    if (!range || journalRangeValue(range) === shownRange) return null;
    const name = journalRangeLabel(gap, severalIssuers);
    return (
      <Button
        type="button"
        variant="surface"
        size="compact"
        aria-label={`Nummernkreis zeigen: ${name}`}
        tooltip="Zeigt nur die Dokumente dieses Nummernkreises, damit du die Stelle der Lücke siehst."
        onClick={() => onShowRange(range)}
      >
        Nummernkreis zeigen
      </Button>
    );
  };
  const [only] = gaps;
  if (gaps.length === 1 && only) {
    return (
      <Alert
        type="warning"
        title={`Lücke im Nummernkreis ${journalRangeLabel(only, severalIssuers)}`}
        message={`${journalGapText(only)} ${GAP_NEXT_STEP}`}
        action={showButton(only)}
        actionLayout="responsive"
      />
    );
  }
  return (
    <SectionCard
      title="Lücken in den Nummernkreisen"
      titleBadge={
        <StatusBadge tone="warning" label={`${gaps.length} Lücken`} />
      }
      description={GAP_NEXT_STEP}
      leading={
        <TriangleAlert
          className="text-moto-orange-strong mt-0.5 size-5 shrink-0"
          aria-hidden="true"
        />
      }
    >
      <ResponsiveActionList>
        {gaps.map((gap) => (
          <ResponsiveActionRow key={gapKey(gap)}>
            <div className="min-w-0">
              <p className="font-medium text-gray-900">
                {journalRangeLabel(gap, severalIssuers)}
              </p>
              <p className="text-sm text-gray-600">{journalGapText(gap)}</p>
            </div>
            <ResponsiveRowActions>{showButton(gap)}</ResponsiveRowActions>
          </ResponsiveActionRow>
        ))}
      </ResponsiveActionList>
    </SectionCard>
  );
}

/**
 * The sums of every document the filter keeps, not only of the rows shown.
 * They follow search and filter like the count in the head; the info of the
 * page says so.
 */
function JournalTotals({ page }: Readonly<{ page: InvoiceJournalPage }>) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
      <StatCard
        variant="inline"
        label="Summe netto"
        value={formatEuro(page.totals.netCents)}
      />
      <StatCard
        variant="inline"
        label="Summe Steuer"
        value={formatEuro(page.totals.taxCents)}
      />
      <StatCard
        variant="inline"
        label="Summe brutto"
        value={formatEuro(page.totals.grossCents)}
      />
    </div>
  );
}

export default function TraegerInvoiceJournalPage() {
  const [range, setRange] = useState<DateRange | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [issuerKey, setIssuerKey] = useState<string | null>(null);
  const [numberRange, setNumberRange] = useState<JournalRangeFilter | null>(
    null,
  );
  const [documentType, setDocumentType] = useState<JournalDocumentType | "">(
    "",
  );
  const [run, setRun] = useState<InvoiceJournalFilter["run"]>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const { show: showActionError } = useApiErrorDisplay();

  const from = range?.from ? toISODate(range.from) : "";
  const to = range?.to ? toISODate(range.to) : from;
  const filter = useMemo<InvoiceJournalFilter>(
    () => ({
      from,
      to,
      issuerKey,
      range: numberRange,
      documentType,
      run,
      search,
    }),
    [from, to, issuerKey, numberRange, documentType, run, search],
  );
  // Every read stands in the trail of each run it shows: one read per
  // opening and filter, none on focus, reconnect or from the dedupe window.
  const {
    data: first,
    loading,
    error,
  } = useTraegerResource(
    traegerBillingKeys.invoiceJournal(JSON.stringify(filter)),
    () => fetchInvoiceJournal(filter, 1),
    "das Rechnungsausgangsbuch",
    {
      revalidateOnMount: true,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 0,
    },
  );
  // The filter choices outlive a change of the filter, so a select never
  // empties while the next answer loads.
  const [choices, setChoices] = useState<InvoiceJournalPage | null>(null);
  if (first && first !== choices) setChoices(first);
  const numberRanges = choices?.numberRanges ?? NO_RANGES;
  const runs = choices?.runs ?? NO_RUNS;
  const issuers = useMemo(() => journalIssuers(numberRanges), [numberRanges]);
  const severalIssuers = issuers.length > 1;

  // Later pages belong to the first page they continue; a new filter starts
  // a new list and drops them.
  const [later, setLater] = useState<{
    readonly after: InvoiceJournalPage;
    readonly page: number;
    readonly documents: readonly JournalDocument[];
    readonly hasMore: boolean;
  } | null>(null);
  const continued = later && later.after === first ? later : null;
  const documents = useMemo(() => {
    if (!first) return [];
    // A release between two pages moves the rows: a document counts once.
    const seen = new Set(first.documents.map((document) => document.key));
    return [
      ...first.documents,
      ...(continued?.documents ?? []).filter(
        (document) => !seen.has(document.key),
      ),
    ];
  }, [first, continued]);
  const hasMore = continued ? continued.hasMore : (first?.hasMore ?? false);

  const loadMore = async () => {
    if (!first) return;
    const page = (continued?.page ?? 1) + 1;
    setLoadingMore(true);
    try {
      const result = await fetchInvoiceJournal(filter, page);
      setLater({
        after: first,
        page,
        documents: [...(continued?.documents ?? []), ...result.documents],
        hasMore: result.hasMore,
      });
    } catch (err) {
      logger.error("traeger_invoice_journal_load_more_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      await showActionError(err, {
        object: "die nächsten Dokumente des Rechnungsausgangsbuchs",
      });
    } finally {
      setLoadingMore(false);
    }
  };

  // A number range belongs to one issuer: choosing another issuer drops it.
  const chooseIssuer = (key: string | null) => {
    setIssuerKey(key);
    if (numberRange && key !== null && numberRange.issuerKey !== key) {
      setNumberRange(null);
    }
  };
  const rangeOptions = numberRanges.filter(
    (numberRange) => issuerKey === null || numberRange.issuer.key === issuerKey,
  );
  const rangeValue = journalRangeValue(numberRange);
  const runValue = journalRunValue(run);
  const issuerValue = issuerKey === null ? "" : issuerKey || "traeger";

  const filters: FilterConfig[] = [
    {
      id: "type",
      label: "Dokumentart",
      type: "dropdown",
      value: documentType,
      onChange: (value) => setDocumentType(value as JournalDocumentType | ""),
      options: [
        { value: "", label: "Alle Dokumentarten" },
        ...JOURNAL_DOCUMENT_TYPES.map((type) => ({
          value: type,
          label: JOURNAL_DOCUMENT_TYPE_LABELS[type],
        })),
      ],
    },
    {
      id: "range",
      label: "Nummernkreis",
      type: "dropdown",
      value: rangeValue,
      onChange: (value) =>
        setNumberRange(journalRangeOf(value as string, numberRanges)),
      options: [
        { value: "", label: "Alle Nummernkreise" },
        ...rangeOptions.flatMap((numberRange) =>
          numberRange.service
            ? [
                {
                  value: journalRangeValue({
                    issuerKey: numberRange.issuer.key,
                    service: numberRange.service,
                    year: numberRange.year,
                  }),
                  label: journalRangeLabel(
                    numberRange,
                    severalIssuers && issuerKey === null,
                  ),
                  count: numberRange.documentCount,
                },
              ]
            : [],
        ),
      ],
    },
    {
      id: "run",
      label: "Lauf",
      type: "dropdown",
      value: runValue,
      onChange: (value) => setRun(journalRunOf(value as string, runs)),
      options: [
        { value: "", label: "Alle Läufe" },
        ...runs.flatMap((option) =>
          option.kind
            ? [
                {
                  value: journalRunValue({ kind: option.kind, id: option.id }),
                  label: journalRunLabel(option),
                },
              ]
            : [],
        ),
      ],
    },
    // With one issuer the choice changes nothing, so it stays away.
    ...(severalIssuers
      ? [
          {
            id: "issuer",
            label: "Rechnungssteller",
            type: "dropdown",
            value: issuerValue,
            onChange: (value) =>
              chooseIssuer(
                value === "" ? null : value === "traeger" ? "" : String(value),
              ),
            options: [
              { value: "", label: "Alle Rechnungssteller" },
              ...issuers.map((issuer) => ({
                value: issuer.key || "traeger",
                label: journalIssuerLabel(issuer),
              })),
            ],
          } satisfies FilterConfig,
        ]
      : []),
  ];

  const shownRange = numberRanges.find(
    (option) =>
      option.service !== undefined &&
      journalRangeValue({
        issuerKey: option.issuer.key,
        service: option.service,
        year: option.year,
      }) === rangeValue,
  );
  const shownRun = runs.find(
    (option) =>
      option.kind !== undefined &&
      journalRunValue({ kind: option.kind, id: option.id }) === runValue,
  );
  const shownIssuer = issuers.find((issuer) => issuer.key === issuerKey);
  const period = journalPeriodLabel(from, to);
  const activeFilters: ActiveFilter[] = [
    ...(period
      ? [{ id: "period", label: period, onRemove: () => setRange(undefined) }]
      : []),
    ...(documentType
      ? [
          {
            id: "type",
            label: JOURNAL_DOCUMENT_TYPE_LABELS[documentType],
            onRemove: () => setDocumentType(""),
          },
        ]
      : []),
    ...(numberRange
      ? [
          {
            id: "range",
            label: shownRange
              ? `Nummernkreis ${journalRangeLabel(shownRange, severalIssuers)}`
              : "Nummernkreis",
            onRemove: () => setNumberRange(null),
          },
        ]
      : []),
    ...(run
      ? [
          {
            id: "run",
            label: shownRun ? journalRunLabel(shownRun) : "Lauf",
            onRemove: () => setRun(null),
          },
        ]
      : []),
    ...(issuerKey !== null && severalIssuers
      ? [
          {
            id: "issuer",
            label: shownIssuer
              ? journalIssuerLabel(shownIssuer)
              : "Rechnungssteller",
            onRemove: () => chooseIssuer(null),
          },
        ]
      : []),
  ];
  const clearFilters = () => {
    setRange(undefined);
    setDocumentType("");
    setNumberRange(null);
    setRun(null);
    setIssuerKey(null);
  };
  const resetAll = () => {
    setSearch("");
    clearFilters();
  };
  const filtered = search.trim() !== "" || activeFilters.length > 0;
  const emptySearch = emptySearchText(
    search,
    activeFilters.map((active) => active.label),
    "Prüfe die Schreibweise der Nummer oder des Namens.",
  );
  const columns = useMemo(
    () => journalColumns(severalIssuers),
    [severalIssuers],
  );
  const totalCount = first?.totalCount ?? 0;
  // Before the first document there is nothing to sum, filter or download.
  const neverIssued = Boolean(first) && !filtered && totalCount === 0;

  const exportItems = useTraegerListExportItems({
    download: (format) => downloadInvoiceJournal(filter, format),
    scope: filtered
      ? "Die Dokumente mit Suche und Filter der Seite, nach Nummer sortiert. Jeder Download wird protokolliert."
      : "Alle Dokumente, nach Nummer sortiert. Jeder Download wird protokolliert.",
    fallbackName: "rechnungsausgangsbuch",
    errorObject: "das Rechnungsausgangsbuch",
    unavailable: !first || totalCount === 0,
  });

  return (
    <TenantPage
      title={billingAreaTitle("rechnungsausgangsbuch")}
      info="Hier steht jedes ausgestellte Dokument aus allen Läufen: Rechnungen, Bescheide, Stornos und Gutschriften. Ein Dokument steht hier, sobald es seine Nummer hat. Entwürfe siehst du im Lauf. moto prüft jeden Nummernkreis auf fehlende Nummern. Die Summen folgen Suche und Filter, Stornos und Gutschriften sind abgezogen. Elternbeiträge stellt moto ohne Steuer aus. Ob eine Familie gezahlt hat, prüfst du in deiner Buchhaltung."
      tabs={billingTabs("rechnungsausgangsbuch")}
      stats={
        first && !neverIssued ? (
          <TenantPageStats
            items={[
              {
                value: totalCount,
                label: totalCount === 1 ? "Dokument" : "Dokumente",
              },
            ]}
          />
        ) : null
      }
      statsLoading={!first && !error}
      actions={
        neverIssued ? undefined : (
          <DateRangePicker
            value={range}
            onChange={setRange}
            presets={rangePresets()}
            toMax={parseISODate(berlinTodayISO())}
            fieldLabel="Ausgestellt im Zeitraum"
            className="w-full sm:w-auto"
            triggerClassName="w-full sm:w-auto"
          />
        )
      }
      overflowMenu={exportItems}
      search={
        neverIssued
          ? undefined
          : {
              value: search,
              onChange: setSearch,
              placeholder: "Nummer oder Empfänger",
              debounceMs: SEARCH_PAUSE_MS,
            }
      }
      filters={neverIssued ? undefined : filters}
      filterPanel
      activeFilters={activeFilters}
      onClearAllFilters={clearFilters}
      error={error}
    >
      {neverIssued ? null : (
        <>
          <NumberGaps
            gaps={first?.gaps ?? []}
            severalIssuers={severalIssuers}
            shownRange={rangeValue}
            onShowRange={(next) => {
              setNumberRange(next);
              setIssuerKey(null);
            }}
          />
          {first && totalCount > 0 ? <JournalTotals page={first} /> : null}
        </>
      )}
      <DataTable
        columns={columns}
        rows={documents}
        getRowKey={(document) => document.key}
        isLoading={loading}
        loadingRowCount={8}
        dense
        stackedLayout="row"
        stackedDetailKey="type"
        moreAction={
          hasMore
            ? {
                label: `Weitere Dokumente laden (${documents.length} von ${totalCount})`,
                onClick: () => void loadMore(),
                tooltip: "Zeigt weitere Dokumente unten in der Liste an.",
                loading: loadingMore,
                loadingText: "Lädt …",
              }
            : undefined
        }
        emptyState={
          filtered ? (
            <EmptyState
              title="Kein Dokument passt zu Suche und Filter."
              description={emptySearch.description}
              action={
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  tooltip="Leert Suche, Zeitraum und Filter und zeigt wieder alle Dokumente."
                  onClick={resetAll}
                >
                  {emptySearch.actionLabel}
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<MotoConceptIcon concept={billingConcept} size={48} />}
              title="Noch kein Dokument ausgestellt."
              description="Ein Dokument steht hier, sobald du einen Lauf freigibst. Dann bekommt es seine Nummer."
            />
          )
        }
      />
    </TenantPage>
  );
}
