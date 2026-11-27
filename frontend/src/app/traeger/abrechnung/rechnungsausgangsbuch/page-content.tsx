"use client";

// Rechnungsausgangsbuch (#4819): jedes ausgestellte Dokument der
// Elternabrechnung in einer Liste, über alle Läufe, Rechnungssteller und
// Nummernkreise. Träger-Büro und Prüfung lesen sie nach Nummer: Fehlt in
// einem Nummernkreis eine Nummer, steht das als Warnung über der Liste und
// an der Stelle in der Liste. Ein
// Dokument steht hier, sobald es seine Nummer hat; Entwürfe eines Laufs
// haben keine. Nur zum Lesen. Filter, Summen und Seiten rechnet der Server;
// jedes Lesen steht im Protokoll der gezeigten Läufe.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  journalGapAnchor,
  journalGapWording,
  journalIssuerLabel,
  journalIssuers,
  journalMissingCountLabel,
  journalPeriodLabel,
  journalRangeLabel,
  journalRangeOf,
  journalRangeValue,
  journalReferenceWord,
  journalRunChoiceLabels,
  journalRunHref,
  journalRunLabel,
  journalRunOf,
  journalRunValue,
} from "~/components/traeger/invoice-journal-format";
import { useTraegerListExportItems } from "~/components/traeger/traeger-list-export-menu";
import { useFreshTraegerResource } from "~/components/traeger/use-traeger-resource";
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
import { DataField, DataGrid } from "~/components/ui/data-field";
import { StatusBadge } from "~/components/ui/status-badge";
import { TenantPage } from "~/components/ui/tenant-page";
import { useApiErrorDisplay } from "~/contexts/ToastContext";
import { documentsConcept } from "~/lib/concepts/documents";
import { formatDate, parseISODate, toISODate } from "~/lib/date-helpers";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
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
const NO_GAPS: InvoiceJournalPage["gaps"] = [];

/** Typing a number or a name asks the server once the person pauses. */
const SEARCH_PAUSE_MS = 300;

/** A document number, set like the numbers of the neighbouring pages. */
function DocumentNumber({ children }: Readonly<{ children: string }>) {
  return <span className="font-mono whitespace-nowrap">{children}</span>;
}

/** „Es fehlen die Nummern FE-2026-0005 und FE-2026-0006 (nach FE-2026-0004).“ */
function GapSentence({ gap }: Readonly<{ gap: JournalNumberGap }>) {
  const { lead, first, joint, last, place, anchors } = journalGapWording(gap);
  const [anchor, second] = anchors;
  return (
    <>
      {lead} <DocumentNumber>{first}</DocumentNumber>
      {joint ? (
        <>
          {" "}
          {joint} <DocumentNumber>{last}</DocumentNumber>
        </>
      ) : null}{" "}
      ({place} <DocumentNumber>{anchor ?? ""}</DocumentNumber>
      {second ? (
        <>
          {" "}
          und <DocumentNumber>{second}</DocumentNumber>
        </>
      ) : null}
      ).
    </>
  );
}

/** A cancellation and a credit take money back: their amount stays signed. */
function amountCell(cents: number) {
  return (
    <span className="text-gray-900 tabular-nums">{formatEuro(cents)}</span>
  );
}

/**
 * The tax of a document. Elternbeiträge carry none, so the column stays
 * quiet; an amount of 0,00 € in Netto or Brutto is a real, issued value.
 */
function taxCell(cents: number) {
  return cents === 0 ? (
    <span className="text-gray-500 tabular-nums">{formatEuro(0)}</span>
  ) : (
    amountCell(cents)
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

/** What the table needs beside its rows. */
interface JournalColumnContext {
  readonly showIssuer: boolean;
  /** The gap a document stands at, by `journalGapAnchor`. */
  readonly gapAt: ReadonlyMap<string, string>;
  /** Shows a document and everything that refers to it. */
  readonly onShowReference: (number: string) => void;
}

function journalColumns({
  showIssuer,
  gapAt,
  onShowReference,
}: JournalColumnContext): DataTableColumn<JournalDocument>[] {
  const gapOf = (document: JournalDocument) =>
    gapAt.get(
      journalGapAnchor(
        document.issuer.key,
        document.service,
        document.numberYear,
        document.number,
      ),
    );
  const reference = (document: JournalDocument) =>
    document.reference ? (
      <Button
        type="button"
        variant="link"
        size="compact"
        className="whitespace-nowrap"
        tooltip="Sucht diese Nummer in allen Dokumenten. Andere Filter werden geleert."
        onClick={() => onShowReference(document.reference?.number ?? "")}
      >
        {journalReferenceWord(document.reference)}{" "}
        <DocumentNumber>{document.reference.number}</DocumentNumber>
      </Button>
    ) : null;
  return [
    {
      key: "number",
      header: "Nummer",
      render: (document) => {
        const gap = gapOf(document);
        return (
          <span className="flex flex-col items-start gap-1">
            <span className="font-mono font-medium whitespace-nowrap text-gray-900">
              {document.number}
            </span>
            {/* The gap stands where the numbers are missing, not only in
                the notice above the list. */}
            {gap ? <StatusBadge tone="warning" size="xs" label={gap} /> : null}
          </span>
        );
      },
      stacked: "title",
    },
    {
      key: "issued",
      header: "Ausgestellt",
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
          {reference(document)}
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
              {journalReferenceWord(document.reference)}{" "}
              <DocumentNumber>{document.reference.number}</DocumentNumber>
            </span>
          ) : null}
          <span className="basis-full text-gray-900">
            {document.recipientName || "–"}
          </span>
          {/* The run leads to the letters of the document, on a phone too. */}
          <span className="basis-full">{runCell(document)}</span>
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
    ...(showIssuer
      ? [
          {
            key: "issuer",
            header: "Rechnungssteller",
            render: (document: JournalDocument) =>
              journalIssuerLabel(document.issuer),
          } satisfies DataTableColumn<JournalDocument>,
        ]
      : []),
    // The phone line under the number already carries the run.
    { key: "run", header: "Lauf", render: runCell, stacked: "hidden" },
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
      render: (document) => taxCell(document.taxCents),
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
      // One amount beside the number on a phone: it says which one.
      stackedRender: (document) => (
        <span className="flex flex-col items-end">
          {amountCell(document.grossCents)}
          <span className="text-xs font-normal text-gray-500">brutto</span>
        </span>
      ),
    },
  ];
}

function rangePresets(todayISO: string) {
  const today = parseISODate(todayISO);
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
  return `${gap.service ?? ""}|${gap.year}|${gap.issuer.key}|${gap.firstMissing}`;
}

function gapRange(gap: JournalNumberGap): JournalRangeFilter | null {
  return gap.service
    ? { issuerKey: gap.issuer.key, service: gap.service, year: gap.year }
    : null;
}

/**
 * Where each gap stands in the list: at the document beside it. A document
 * with a gap on either side carries both.
 */
function gapAnchors(
  gaps: readonly JournalNumberGap[],
): ReadonlyMap<string, string> {
  const missing = new Map<string, number>();
  for (const gap of gaps) {
    // The document after the gap carries it; a gap at the end of the range
    // stands at its last document.
    const number = gap.beforeNumber === "" ? gap.afterNumber : gap.beforeNumber;
    const anchor = journalGapAnchor(
      gap.issuer.key,
      gap.service,
      gap.year,
      number,
    );
    missing.set(anchor, (missing.get(anchor) ?? 0) + gap.missingCount);
  }
  // The badge names no direction: the list shows the newest number first.
  return new Map(
    [...missing].map(([anchor, count]) => [
      anchor,
      `Lücke: ${count} ${count === 1 ? "Nummer" : "Nummern"}`,
    ]),
  );
}

// „moto‑Team“ with a hyphen that keeps the word on one line.
const GAP_NEXT_STEP = "Wende dich an das moto\u2011Team und nenne die Nummern.";

/**
 * The gaps of the number ranges, whatever the filter. One gap is one
 * notice; several stand as rows of one card (frontend-ui-kit, „Several
 * notices of the same kind“). The step to a range shows the numbers around
 * its gap and brings the list into view; its row keeps its place.
 */
function NumberGaps({
  gaps,
  severalIssuers,
  shownRange,
  checkedCount,
  onShowRange,
}: Readonly<{
  gaps: readonly JournalNumberGap[];
  severalIssuers: boolean;
  shownRange: string;
  /**
   * Every document of the Träger while a search or filter narrows the list
   * below; null while the list shows them all.
   */
  checkedCount: number | null;
  onShowRange: (range: JournalRangeFilter) => void;
}>) {
  // The list follows the notice: after „Nummernkreis zeigen“ its start
  // comes into view, also when the notice fills a phone screen.
  const endRef = useRef<HTMLSpanElement>(null);
  const [jumpTo, setJumpTo] = useState("");
  useEffect(() => {
    if (jumpTo === "" || jumpTo !== shownRange) return;
    endRef.current?.scrollIntoView({ block: "start" });
    setJumpTo("");
  }, [jumpTo, shownRange]);
  if (gaps.length === 0) return null;
  const inView = (gap: JournalNumberGap) => {
    const range = gapRange(gap);
    return range !== null && journalRangeValue(range) === shownRange;
  };
  const showButton = (gap: JournalNumberGap) => {
    const range = gapRange(gap);
    if (!range || inView(gap)) return null;
    const name = journalRangeLabel(gap, severalIssuers);
    return (
      <Button
        type="button"
        variant="surface"
        size="compact"
        aria-label={`Nur Nummernkreis ${name} zeigen`}
        tooltip="Zeigt nur diesen Nummernkreis, nach Nummer sortiert. Suche und andere Filter werden geleert."
        onClick={() => {
          setJumpTo(journalRangeValue(range));
          onShowRange(range);
        }}
      >
        Nur diesen Nummernkreis zeigen
      </Button>
    );
  };
  // The check covers the whole book, whatever the list below shows.
  const nextStep =
    checkedCount === null
      ? GAP_NEXT_STEP
      : `Geprüft sind alle ${checkedCount} Dokumente, nicht nur die der Liste unten. ${GAP_NEXT_STEP}`;
  const [only] = gaps;
  if (gaps.length === 1 && only) {
    return (
      <>
        <Alert
          type="warning"
          title={`Lücke im Nummernkreis ${journalRangeLabel(only, severalIssuers)}`}
          message={
            <>
              <GapSentence gap={only} /> {nextStep}
            </>
          }
          action={showButton(only)}
          actionLayout="responsive"
        />
        <span ref={endRef} className="hidden" aria-hidden="true" />
      </>
    );
  }
  const missing = gaps.reduce((sum, gap) => sum + gap.missingCount, 0);
  return (
    <SectionCard
      title="Lücken in den Nummernkreisen"
      titleBadge={
        <StatusBadge tone="warning" label={journalMissingCountLabel(missing)} />
      }
      description={nextStep}
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
              {/* „Nummernkreis“ in the name: its service and year also name
                  runs („Monatsbeiträge Oktober 2026“). */}
              <p className="font-medium text-gray-900">
                Nummernkreis {journalRangeLabel(gap, severalIssuers)}
              </p>
              <p className="text-sm text-gray-600">
                <GapSentence gap={gap} />
              </p>
            </div>
            <ResponsiveRowActions>
              {inView(gap) ? (
                // The row keeps its place; it says why its button is gone.
                <StatusBadge tone="gray" label="In der Liste gezeigt" />
              ) : (
                showButton(gap)
              )}
            </ResponsiveRowActions>
          </ResponsiveActionRow>
        ))}
      </ResponsiveActionList>
      <span ref={endRef} aria-hidden="true" />
    </SectionCard>
  );
}

/** „Summen für 6 von 25 Dokumenten“, „Summen für alle 25 Dokumente“. */
function totalsTitle(count: number, allCount: number, filtered: boolean) {
  if (filtered) return `Summen für ${count} von ${allCount} Dokumenten`;
  return count === 1
    ? "Summen für 1 Dokument"
    : `Summen für alle ${count} Dokumente`;
}

/**
 * The sums of every document the filter keeps, not only of the rows shown.
 * The heading says what they cover and `scope` which search and filter
 * narrow them: an audit asks first what a sum is of.
 */
function JournalTotals({
  page,
  allCount,
  scope,
}: Readonly<{
  page: InvoiceJournalPage;
  /** Every document of the Träger, without search and filter. */
  allCount: number;
  /** The search and the filters in words; empty for the whole book. */
  scope: string;
}>) {
  return (
    <SectionCard
      title={totalsTitle(page.totalCount, allCount, scope !== "")}
      description={scope || undefined}
    >
      <DataGrid columns={4}>
        <DataField label="Netto">
          <span className="tabular-nums">
            {formatEuro(page.totals.netCents)}
          </span>
        </DataField>
        <DataField label="Steuer">
          <span className="tabular-nums">
            {formatEuro(page.totals.taxCents)}
          </span>
        </DataField>
        <DataField label="Brutto">
          <span className="tabular-nums">
            {formatEuro(page.totals.grossCents)}
          </span>
        </DataField>
      </DataGrid>
    </SectionCard>
  );
}

/** „Keines der 25 Dokumente passt zur Suche.“, „… zum Filter.“ or to both. */
function noHitTitle(
  allCount: number,
  searching: boolean,
  filtering: boolean,
): string {
  const none =
    allCount === 1
      ? "Das eine Dokument passt nicht"
      : `Keines der ${allCount} Dokumente passt`;
  if (searching && filtering) return `${none} zu Suche und Filter.`;
  return searching ? `${none} zur Suche.` : `${none} zum Filter.`;
}

export default function TraegerInvoiceJournalPage() {
  // The page stays open across midnight: presets and the latest day follow.
  const today = useBerlinToday();
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
  // A jump drops a search still being typed, so it cannot come back after.
  const [jumps, setJumps] = useState(0);
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
  // Every read stands in the trail of each run it shows. The rows appear
  // only once this opening's own read answered: a filter chosen before
  // shows nothing from the cache that no new trail entry stands for.
  const {
    data: first,
    loading,
    error,
  } = useFreshTraegerResource(
    traegerBillingKeys.invoiceJournal(JSON.stringify(filter)),
    () => fetchInvoiceJournal(filter, 1),
    "das Rechnungsausgangsbuch",
  );
  // What does not follow the filter (choices, gaps) outlives its change, so
  // a select never empties and a warning never blinks while an answer loads.
  const [latest, setLatest] = useState<InvoiceJournalPage | null>(null);
  if (first && first !== latest) setLatest(first);
  const numberRanges = latest?.numberRanges ?? NO_RANGES;
  const runs = latest?.runs ?? NO_RUNS;
  const gaps = latest?.gaps ?? NO_GAPS;
  const issuers = useMemo(() => journalIssuers(numberRanges), [numberRanges]);
  const severalIssuers = issuers.length > 1;
  // One issuer needs no column, unless a body issues in place of the Träger:
  // then the book has to say who.
  const showIssuer =
    severalIssuers || issuers.some((issuer) => issuer.key !== "");
  const allCount = numberRanges.reduce(
    (sum, numberRange) => sum + numberRange.documentCount,
    0,
  );

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
    // A release between two pages moves the rows: a document counts once,
    // whichever page brought it first.
    const seen = new Set<string>();
    return [...first.documents, ...(continued?.documents ?? [])].filter(
      (document) => {
        if (seen.has(document.key)) return false;
        seen.add(document.key);
        return true;
      },
    );
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
  const runLabels = useMemo(() => journalRunChoiceLabels(runs), [runs]);
  const rangeValue = journalRangeValue(numberRange);
  const runValue = journalRunValue(run);
  const issuerValue = issuerKey === null ? "" : issuerKey || "traeger";

  const filters: FilterConfig[] = [
    {
      // The period stands with the other filters: it narrows this list,
      // not the runs of the other registers.
      id: "period",
      label: "Ausgestellt im Zeitraum",
      type: "custom",
      value: "",
      onChange: () => undefined,
      options: [],
      render: (
        <DateRangePicker
          value={range}
          onChange={setRange}
          presets={rangePresets(today)}
          fieldLabel="Ausgestellt im Zeitraum"
          className="w-full sm:w-auto"
          triggerClassName="w-full sm:w-auto"
        />
      ),
    },
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
        ...runs.flatMap((option, i) =>
          option.kind
            ? [
                {
                  value: journalRunValue({ kind: option.kind, id: option.id }),
                  label: runLabels[i] ?? journalRunLabel(option),
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
  const shownRunAt = runs.findIndex(
    (option) =>
      option.kind !== undefined &&
      journalRunValue({ kind: option.kind, id: option.id }) === runValue,
  );
  const shownRun = runLabels[shownRunAt];
  const shownIssuer = issuers.find((issuer) => issuer.key === issuerKey);
  const period = journalPeriodLabel(from, to);
  const activeFilters: ActiveFilter[] = [
    ...(period
      ? [
          {
            id: "period",
            label: `Ausgestellt ${period}`,
            onRemove: () => setRange(undefined),
          },
        ]
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
            label: shownRun ? `Lauf ${shownRun}` : "Lauf",
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
  // A jump shows its target whatever was filtered before: the document a
  // reference names with all that refers to it, or one whole number range.
  const showReference = useCallback((number: string) => {
    setJumps((count) => count + 1);
    setRange(undefined);
    setDocumentType("");
    setNumberRange(null);
    setRun(null);
    setIssuerKey(null);
    setSearch(number);
  }, []);
  const showRange = (next: JournalRangeFilter) => {
    setJumps((count) => count + 1);
    resetAll();
    setNumberRange(next);
  };
  const searching = search.trim() !== "";
  const filtering = activeFilters.length > 0;
  const filtered = searching || filtering;
  const emptySearch = emptySearchText(
    search,
    activeFilters.map((active) => active.label),
    "Prüfe die Nummer des Dokuments oder den Namen des Empfängers.",
  );
  // Search and filters in words, for the sums and the download: both must
  // say which documents they cover where the person decides.
  const scope = [
    searching ? `Suche „${search.trim()}“` : "",
    ...activeFilters.map((active) => active.label),
  ]
    .filter(Boolean)
    .join(", ");
  const gapAt = useMemo(() => gapAnchors(gaps), [gaps]);
  const columns = useMemo(
    () => journalColumns({ showIssuer, gapAt, onShowReference: showReference }),
    [showIssuer, gapAt, showReference],
  );
  const totalCount = first?.totalCount ?? 0;

  const exportItems = useTraegerListExportItems({
    download: (format) => downloadInvoiceJournal(filter, format),
    scope: filtered
      ? `${totalCount} von ${allCount} Dokumenten: ${scope}. Als Liste, aufsteigend nach Nummer. Jeder Download wird protokolliert.`
      : `Alle ${allCount} Dokumente. Als Liste, aufsteigend nach Nummer. Jeder Download wird protokolliert.`,
    fallbackName: "rechnungsausgangsbuch",
    errorObject: "das Rechnungsausgangsbuch",
    unavailable: !first || totalCount === 0,
  });

  return (
    <TenantPage
      title={billingAreaTitle("rechnungsausgangsbuch")}
      info="Das Rechnungsausgangsbuch zeigt jedes ausgestellte Dokument aus allen Läufen: Rechnungen, Gebührenbescheide, Bestätigungen, Stornos und Gutschriften. Das neueste steht oben. Entwürfe haben noch keine Nummer und stehen nur im Lauf. Elternbeiträge stellt moto ohne Steuer aus."
      tabs={billingTabs("rechnungsausgangsbuch")}
      overflowMenu={exportItems}
      search={{
        value: search,
        onChange: setSearch,
        placeholder: "Nummer oder Empfänger",
        debounceMs: SEARCH_PAUSE_MS,
        resetKey: jumps,
      }}
      filters={filters}
      activeFilters={activeFilters}
      onClearAllFilters={clearFilters}
      error={error}
    >
      <NumberGaps
        gaps={gaps}
        severalIssuers={severalIssuers}
        // The jump stays while a search or another filter hides rows of
        // the range.
        shownRange={searching || activeFilters.length > 1 ? "" : rangeValue}
        checkedCount={filtered ? allCount : null}
        onShowRange={showRange}
      />
      {/* Without a hit the way back comes first; its title says how many
          documents the book holds. */}
      {first && totalCount > 0 ? (
        <JournalTotals page={first} allCount={allCount} scope={scope} />
      ) : null}
      <DataTable
        columns={columns}
        rows={documents}
        getRowKey={(document) => document.key}
        isLoading={loading}
        loadingRowCount={8}
        dense
        stackedLayout="row"
        stackedDetailKey="type"
        rowHasInteractiveControls
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
              title={noHitTitle(allCount, searching, filtering)}
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
              icon={<MotoConceptIcon concept={documentsConcept} size={48} />}
              title="Noch kein Dokument ausgestellt."
              description="Sobald ein Lauf freigegeben ist, stehen seine Dokumente hier. Die Läufe findest du unter „Ferien“, „Monatsbeiträge“ und „Jahresbescheide“."
            />
          )
        }
      />
    </TenantPage>
  );
}
