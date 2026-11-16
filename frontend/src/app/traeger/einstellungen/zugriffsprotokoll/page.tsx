"use client";

// Zugriffsprotokoll des Träger-Portals (#4655): wer wann an einer Schule des
// Trägers Daten gelesen oder geändert hat. Nur zum Lesen, mit Filtern und
// CSV-Export. Jedes Öffnen steht selbst im Protokoll der gezeigten Schulen.

import { useMemo, useState } from "react";
import { ScrollText } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { DateRangePicker } from "~/components/ui/date-range-picker";
import { EmptyState } from "~/components/ui/empty-state";
import type {
  ActiveFilter,
  FilterConfig,
} from "~/components/ui/page-header/types";
import { StatusBadge } from "~/components/ui/status-badge";
import { TenantPage } from "~/components/ui/tenant-page";
import {
  TraegerListExportMenu,
  traegerExportScope,
} from "~/components/traeger/traeger-list-export-menu";
import { useApiErrorDisplay } from "~/contexts/ToastContext";
import {
  formatBerlinDate,
  parseISODate,
  berlinTodayISO,
  toISODate,
} from "~/lib/date-helpers";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { useTraegerSchools } from "~/components/traeger/use-traeger-schools";
import { createLogger } from "~/lib/logger";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import {
  downloadTraegerAccessLog,
  fetchTraegerAccessLog,
  fetchTraegerAccessLogPeople,
  type TraegerAccessKind,
  type TraegerAccessLogEntry,
  type TraegerAccessLogFilter,
  type TraegerAccessLogPage,
} from "~/lib/traeger-api";

const logger = createLogger({ component: "TraegerAccessLogPage" });

type KindChoice = TraegerAccessKind | "all";

const KIND_ITEMS: readonly { value: KindChoice; label: string }[] = [
  { value: "all", label: "Alles" },
  { value: "read", label: "Gelesen" },
  { value: "change", label: "Geändert" },
];

const KIND_LABELS: Readonly<Record<TraegerAccessKind, string>> = {
  read: "Gelesen",
  change: "Geändert",
};

const BERLIN_TIME = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  hour: "2-digit",
  minute: "2-digit",
});

const COLUMNS: DataTableColumn<TraegerAccessLogEntry>[] = [
  {
    key: "occurredAt",
    header: "Zeitpunkt",
    render: (entry) => (
      <span className="whitespace-nowrap text-gray-900">
        {formatBerlinDate(entry.occurredAt)},{" "}
        {BERLIN_TIME.format(new Date(entry.occurredAt))} Uhr
      </span>
    ),
    // On a phone the time leads the line under the name, so the name keeps
    // the full width.
    stacked: "hidden",
  },
  {
    key: "person",
    header: "Person",
    render: (entry) => (
      // A Träger-Büro address can be long; it wraps on a phone instead of
      // running into the time beside it.
      <span className="font-medium wrap-anywhere text-gray-900">
        {entry.person}
      </span>
    ),
    stacked: "title",
    // The log has no detail page: the whole address stays visible.
    stackedClamp: false,
  },
  {
    key: "school",
    header: "Schule",
    render: (entry) => entry.schoolName || "–",
    stacked: "field",
  },
  {
    key: "kind",
    header: "Art",
    render: (entry) => (
      <StatusBadge
        tone={entry.kind === "change" ? "orange" : "blue"}
        label={KIND_LABELS[entry.kind]}
      />
    ),
    stacked: "field",
  },
  {
    key: "data",
    header: "Daten",
    render: (entry) => entry.dataLabel,
    // On a phone one line under the name carries time and kind, then school and
    // data with their names in front (not in a right-aligned column), as the
    // OGS lists compose a record.
    stackedLabel: false,
    stackedRender: (entry) => (
      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-gray-600">
        <span className="whitespace-nowrap text-gray-900">
          {formatBerlinDate(entry.occurredAt)},{" "}
          {BERLIN_TIME.format(new Date(entry.occurredAt))} Uhr
        </span>
        <StatusBadge
          tone={entry.kind === "change" ? "orange" : "blue"}
          label={KIND_LABELS[entry.kind]}
        />
        {entry.schoolName ? (
          <span className="basis-full">
            <span className="text-gray-500">Schule </span>
            <span className="text-gray-900">{entry.schoolName}</span>
          </span>
        ) : null}
        <span className="basis-full">
          <span className="text-gray-500">Daten </span>
          <span className="text-gray-900">{entry.dataLabel}</span>
        </span>
      </span>
    ),
  },
];

/** The last 30 days up to today, as the page opens. */
function lastThirtyDays(): DateRange {
  const today = parseISODate(berlinTodayISO());
  return {
    from: new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29),
    to: today,
  };
}

function rangePresets() {
  const today = parseISODate(berlinTodayISO());
  const daysBack = (days: number) =>
    new Date(today.getFullYear(), today.getMonth(), today.getDate() - days);
  return [
    { label: "Heute", range: () => ({ from: today, to: today }) },
    { label: "Letzte 7 Tage", range: () => ({ from: daysBack(6), to: today }) },
    { label: "Letzte 30 Tage", range: lastThirtyDays },
    {
      label: "Letzte 12 Monate",
      range: () => ({ from: daysBack(365), to: today }),
    },
  ];
}

export default function TraegerAccessLogPage() {
  const [range, setRange] = useState<DateRange | undefined>(lastThirtyDays);
  const [schoolId, setSchoolId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [kind, setKind] = useState<KindChoice>("all");
  const { schools: schoolData } = useTraegerSchools();
  const schools = schoolData ?? [];
  const [loadingMore, setLoadingMore] = useState(false);
  const { show: showActionError } = useApiErrorDisplay();

  const from = range?.from ? toISODate(range.from) : "";
  const to = range?.to ? toISODate(range.to) : from;

  // The person filter offers the people who acted in the window; without
  // them (a failed read) only "Alle Personen". The list shows its own error.
  const peopleReader = useTraegerResource(
    from ? traegerKeys.accessLogPeople(from, to) : null,
    () => fetchTraegerAccessLogPeople(from, to),
    "die Personen des Zugriffsprotokolls",
  );
  const people = peopleReader.data ?? [];
  // A person who does not act in the new window can no longer be chosen;
  // the filter would stay active without a visible choice.
  if (
    accountId &&
    ((peopleReader.data &&
      !peopleReader.data.some((person) => person.accountId === accountId)) ||
      peopleReader.failure)
  ) {
    setAccountId("");
  }

  const filter = useMemo<TraegerAccessLogFilter | null>(
    () =>
      from
        ? { from, to, schoolId, accountId, kind: kind === "all" ? "" : kind }
        : null,
    [from, to, schoolId, accountId, kind],
  );
  const {
    data: first,
    loading,
    error,
  } = useTraegerResource(
    filter ? traegerKeys.accessLog(filter) : null,
    () =>
      filter ? fetchTraegerAccessLog(filter, 1) : Promise.reject(new Error()),
    "das Zugriffsprotokoll",
  );
  // Later pages belong to the first page they continue; a new filter or a
  // reload starts a new list and drops them.
  const [later, setLater] = useState<{
    readonly after: TraegerAccessLogPage;
    readonly page: number;
    readonly entries: readonly TraegerAccessLogEntry[];
    readonly hasMore: boolean;
  } | null>(null);
  const continued = later && later.after === first ? later : null;
  const entries = first
    ? [...first.entries, ...(continued?.entries ?? [])]
    : [];
  const hasMore = continued ? continued.hasMore : (first?.hasMore ?? false);

  const loadMore = async () => {
    if (!filter || !first) return;
    const page = (continued?.page ?? 1) + 1;
    setLoadingMore(true);
    try {
      const result = await fetchTraegerAccessLog(filter, page, first.asOf);
      setLater({
        after: first,
        page,
        entries: [...(continued?.entries ?? []), ...result.entries],
        hasMore: result.hasMore,
      });
    } catch (err) {
      logger.error("traeger_access_log_load_more_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      await showActionError(err, {
        object: "die nächste Seite des Protokolls",
      });
    } finally {
      setLoadingMore(false);
    }
  };

  const schoolOptions = [
    { value: "", label: "Alle Schulen" },
    ...schools.map((school) => ({ value: school.id, label: school.name })),
  ];
  const personOptions = [
    { value: "", label: "Alle Personen" },
    ...people.map((person) => ({
      value: person.accountId,
      label: person.name,
    })),
  ];
  const filtered = Boolean(schoolId || accountId || kind !== "all");

  const filters: FilterConfig[] = [
    {
      id: "school",
      label: "Schule",
      type: "dropdown",
      value: schoolId,
      onChange: (value) => setSchoolId(value as string),
      options: schoolOptions,
    },
    {
      id: "person",
      label: "Person",
      type: "dropdown",
      value: accountId,
      onChange: (value) => setAccountId(value as string),
      options: personOptions,
    },
    {
      id: "kind",
      label: "Art des Zugriffs",
      type: "buttons",
      value: kind,
      onChange: (value) => setKind(value as KindChoice),
      options: [...KIND_ITEMS],
    },
  ];
  const activeFilters: ActiveFilter[] = [
    ...(schoolId
      ? [
          {
            id: "school",
            label:
              schoolOptions.find((option) => option.value === schoolId)
                ?.label ?? "Schule",
            onRemove: () => setSchoolId(""),
          },
        ]
      : []),
    ...(accountId
      ? [
          {
            id: "person",
            label:
              personOptions.find((option) => option.value === accountId)
                ?.label ?? "Person",
            onRemove: () => setAccountId(""),
          },
        ]
      : []),
    ...(kind !== "all"
      ? [
          {
            id: "kind",
            label: KIND_LABELS[kind],
            onRemove: () => setKind("all"),
          },
        ]
      : []),
  ];

  return (
    <TenantPage
      title="Zugriffsprotokoll"
      info="Wer hat an Ihren Schulen Daten gelesen oder geändert? Hier steht jeder Zugriff mit Zeitpunkt, Person und Schule."
      actions={
        <>
          <DateRangePicker
            value={range}
            onChange={setRange}
            presets={rangePresets()}
            toMax={parseISODate(berlinTodayISO())}
            className="w-full sm:w-auto"
            triggerClassName="w-full sm:w-auto"
          />
          <TraegerListExportMenu
            download={(format) => {
              if (!filter) return Promise.reject(new Error("no filter"));
              return downloadTraegerAccessLog(filter, format);
            }}
            scope={traegerExportScope(
              schoolId
                ? schoolOptions.find((option) => option.value === schoolId)
                    ?.label
                : null,
            )}
            ariaLabel="Zugriffsprotokoll herunterladen"
            fallbackName={`zugriffsprotokoll-${from}-bis-${to}`}
            errorObject="das Zugriffsprotokoll"
            unavailable={!filter || loading}
          />
        </>
      }
      filters={filters}
      activeFilters={activeFilters}
      onClearAllFilters={() => {
        setSchoolId("");
        setAccountId("");
        setKind("all");
      }}
      error={error}
    >
      <DataTable
        columns={COLUMNS}
        rows={entries}
        getRowKey={(entry) => entry.id}
        isLoading={loading}
        loadingRowCount={5}
        stackedOnMobile
        stackedLayout="row"
        stackedDetailKey="data"
        // Older entries load inside the list's surface, like every list.
        moreAction={
          hasMore
            ? {
                label: "Weitere Einträge laden",
                onClick: () => void loadMore(),
                tooltip: "Zeigt weitere Einträge unten in der Liste an.",
                loading: loadingMore,
                loadingText: "Lädt …",
              }
            : undefined
        }
        emptyState={
          <EmptyState
            icon={<ScrollText className="h-12 w-12" aria-hidden="true" />}
            title={
              filtered
                ? "Zu diesen Filtern gibt es keinen Eintrag."
                : "In diesem Zeitraum gibt es keinen Eintrag."
            }
            description="Wählen Sie einen anderen Zeitraum oder andere Filter."
          />
        }
      />
    </TenantPage>
  );
}
