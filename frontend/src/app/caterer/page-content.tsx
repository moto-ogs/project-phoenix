"use client";

// Overview of the caterer portal (ADR 0077, #3873): one table of every
// school the caterer supplies, the days of the chosen period as columns,
// with a sum per school and per day. Each school opens to its days with
// classes, names (if the school shows them) and the confirmation. Each
// period has one compact read; only an expanded card reads order details.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FileSpreadsheet, FileText, Printer } from "lucide-react";
import { CatererSchoolOrders } from "~/components/caterer/caterer-school-orders";
import { Button } from "~/components/ui/button";
import {
  DataTable,
  DataTableSkeleton,
  type DataTableColumn,
} from "~/components/ui/data-table";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import {
  OverflowMenu,
  type OverflowMenuEntry,
} from "~/components/ui/page-header/OverflowMenu";
import { SectionCard } from "~/components/ui/section-card";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { StatusBadge } from "~/components/ui/status-badge";
import { useApiErrorDisplay, useApiLoadError } from "~/contexts/ToastContext";
import { isReadRefusal } from "~/lib/access-refusal";
import { ApiError } from "~/lib/api-error";
import { bffFile } from "~/lib/bff-fetch";
import {
  downloadCatererDeliveries,
  confirmCatererOrder,
  fetchCatererOrders,
  fetchCatererOverview,
  type DeliveryExportFormat,
} from "~/lib/caterer-api";
import {
  sameSummaryDays,
  summarizeOrderDay,
  type CatererSchoolSummary,
  type CatererSchools,
  type CatererSummaryDay,
  type CatererSchool,
} from "~/lib/caterer-orders";
import {
  defaultPeriod,
  periodDays,
  PERIODS,
  type Period,
} from "~/lib/caterer-period";
import { parseISODate } from "~/lib/date-helpers";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { openBlobForPrint } from "~/lib/file-download";
import { useSession } from "next-auth/react";
import { useSWRAuth, useInvalidateMatching, useSWRCacheKey } from "~/lib/swr";
import { useDiscardRefusedEntity, useSWRRequestGuard } from "~/lib/swr/hooks";
import { catererKeys } from "~/lib/swr/portal-keys";
import { useOptimisticAction } from "~/lib/swr/optimistic";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";

function shortDay(iso: string): string {
  return parseISODate(iso).toLocaleDateString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
}

function berlinDateTime(instant: string): string {
  return new Date(instant).toLocaleString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  });
}

function counts(day: CatererSummaryDay | undefined): number {
  if (!day || day.closed || day.status === "unordered") return 0;
  return day.total;
}

/** Where a school's orders of the period stand, in one badge. */
function SchoolState({ orders }: Readonly<{ orders: CatererSchoolSummary }>) {
  const live = orders.days.filter(
    (day) => !day.closed && day.status !== "unordered",
  );
  const open = live.filter((day) => day.status === "open");
  if (open.length > 0) {
    const first = open.reduce((a, b) => (a.deadline < b.deadline ? a : b));
    return (
      <StatusBadge
        label={`Offen bis ${berlinDateTime(first.deadline)}`}
        tone="gray"
      />
    );
  }
  if (live.length === 0) return null;
  return live.every((day) => day.status === "confirmed") ? (
    <StatusBadge label="Bestätigt" tone="green" />
  ) : (
    <StatusBadge label="Bestellt" tone="blue" />
  );
}

/**
 * A school whose orders did not load, where its orders would stand: the
 * shared load-error text with „Wiederholen“ for this one school.
 */
function SchoolLoadError({
  school,
  failure,
  onRetry,
}: Readonly<{
  school: CatererSchool;
  failure: NonNullable<CatererSchoolSummary["failure"]>;
  onRetry: () => Promise<void>;
}>) {
  const { error, show } = useApiLoadError();
  const retryRef = useRef(onRetry);
  useLayoutEffect(() => {
    retryRef.current = onRetry;
  });
  useEffect(() => {
    void show(
      new ApiError(failure.code, failure.status, { code: failure.code }),
      {
        object: `die Bestellung von ${school.name}`,
        retry: () => void retryRef.current(),
      },
    );
  }, [failure.code, failure.status, school.name, show]);
  const retryable = error && {
    ...error,
    retry: error.retry ?? {
      label: "Wiederholen",
      onClick: () => void onRetry(),
    },
  };
  return <LoadErrorAlert error={retryable} />;
}

type SchoolUpdate = (
  row: CatererSchoolSummary,
  freshDirectory: boolean,
) => CatererSchoolSummary | null;
interface RowChange {
  id: string;
  update: SchoolUpdate;
}
interface DirectoryRead {
  details: Map<string, CatererSummaryDay[]>;
  changes: RowChange[];
}

function applyRowChange(
  directory: CatererSchools,
  change: RowChange,
  freshDirectory: boolean,
) {
  return {
    ...directory,
    schools: directory.schools.flatMap((row) =>
      row.id === change.id ? (change.update(row, freshDirectory) ?? []) : row,
    ),
  };
}

interface OverviewRow {
  key: string;
  school: CatererSchoolSummary | null;
  orders: CatererSchoolSummary | null;
  failed: boolean;
}

function confirmDays<
  T extends {
    days: { orderId: string | null; status: CatererSummaryDay["status"] }[];
  },
>(current: T, orderId: string): T {
  return {
    ...current,
    days: current.days.map((day) =>
      day.orderId === orderId ? { ...day, status: "confirmed" as const } : day,
    ),
  };
}

function SchoolDetails({
  school,
  from,
  to,
  onConfirmed,
  onRefused,
  onRefreshSummary,
  onRead,
}: Readonly<{
  school: CatererSchoolSummary;
  from: string;
  to: string;
  onConfirmed: (orderId: string) => void;
  onRefused: (failure: ApiError) => void;
  onRefreshSummary: () => void;
  onRead: (days: CatererSummaryDay[]) => void;
}>) {
  const key = catererKeys.orders(school.id, school.grant, from, to);
  const guard = useSWRRequestGuard();
  const discard = useDiscardRefusedEntity();
  const invalidate = useInvalidateMatching();
  const matches = (candidate: string) =>
    candidate.startsWith(catererKeys.schoolDetails(school.id));
  function handleRefusal(cause: unknown) {
    if (
      cause instanceof ApiError &&
      discard(cause, {
        codes: [
          "meals.not_supplied",
          "general.permission",
          "meals.plan_disabled",
          "meals.registration_disabled",
        ],
        matches,
      })
    ) {
      onRefused(cause);
    }
  }
  const read = useSWRAuth(
    key,
    async () => {
      const complete = guard(key);
      try {
        const detail = await fetchCatererOrders(school.id, from, to);
        complete(() => onRead(detail.days.map(summarizeOrderDay)));
        return detail;
      } catch (cause) {
        complete(() => handleRefusal(cause));
        throw cause;
      }
    },
    { keepPreviousData: false, revalidateIfStale: false },
  );
  const action = useOptimisticAction(key, read.data);
  const { error } = useSwrResourceLoadError(
    [read],
    `die Bestellung von ${school.name}`,
    read.mutate,
  );
  async function confirm(orderId: string) {
    const result = await action.run({
      optimistic: (current) => confirmDays(current, orderId),
      request: async () => {
        const complete = guard(key);
        try {
          await confirmCatererOrder(school.id, orderId);
        } catch (cause) {
          complete(() => handleRefusal(cause));
          throw cause;
        }
      },
      commit: () => {
        void read.mutate(
          (current) => current && confirmDays(current, orderId),
          { revalidate: false },
        );
        void invalidate(
          (candidate) => candidate !== key && matches(candidate),
          { expireInactive: true },
        );
        onConfirmed(orderId);
      },
    });
    if (result.status === "failed") {
      if (
        result.error instanceof ApiError &&
        result.error.code === "meals.order_not_found"
      )
        void reconcile();
      throw result.error;
    }
    if (result.status === "done") await reconcile();
  }
  async function reconcile() {
    onRefreshSummary();
    await read.mutate();
  }
  if (error) return <LoadErrorAlert error={error} />;
  return action.data ? (
    <CatererSchoolOrders
      school={school}
      orders={action.data}
      onConfirm={confirm}
    />
  ) : (
    <DataTableSkeleton rows={3} columns={5} />
  );
}

export default function CatererOverviewPage() {
  const today = useBerlinToday();
  const [period, setPeriod] = useState<Period>(() => defaultPeriod(today));
  const days = useMemo(() => periodDays(period, today), [period, today]);
  const from = days[0]!;
  const to = days[days.length - 1]!;
  const { data: session } = useSession();
  const enabled = session?.user.scope === "caterer";
  const key = enabled ? catererKeys.overview(from, to) : null;
  const scoped = useSWRCacheKey();
  const invalidate = useInvalidateMatching();
  const guard = useSWRRequestGuard();
  const retries = useRef(new Map<string, symbol>());
  // Fold concurrent school reads/writes into the directory result. Mutating its
  // SWR key mid-fetch would drop the whole directory, including revoked schools.
  const reading = useRef(new Map<string, DirectoryRead>());
  const response = useSWRAuth<CatererSchools>(
    key,
    async (): Promise<CatererSchools> => {
      const complete = guard(key);
      const window = scoped(key!)!;
      const overlapping: DirectoryRead = { details: new Map(), changes: [] };
      reading.current.set(window, overlapping);
      retries.current.clear();
      try {
        const directory = await fetchCatererOverview(from, to);
        const fresh = overlapping.changes.reduce(
          (data, change) => applyRowChange(data, change, true),
          directory,
        );
        complete(() => {
          // An overview refresh can discover a changed order while its detail
          // is open or cached. Refresh just that window of the changed school.
          const previous = response.readCurrent?.().data;
          const changed = new Set<string>();
          for (const school of fresh.schools) {
            const before = previous?.schools.find(
              (row) => row.id === school.id,
            );
            const detailKey = catererKeys.orders(
              school.id,
              school.grant,
              from,
              to,
            );
            if (
              !school.failure &&
              !sameSummaryDays(
                overlapping.details.get(detailKey) ?? before?.days,
                school.days,
              )
            )
              changed.add(detailKey);
          }
          if (changed.size)
            void invalidate((candidate) => changed.has(candidate), {
              expireInactive: true,
            });
        });
        return fresh;
      } catch (cause) {
        if (isReadRefusal(cause)) {
          complete(
            () =>
              void invalidate(
                (candidate) =>
                  candidate !== key &&
                  (candidate.startsWith(catererKeys.overviewFamily) ||
                    candidate.startsWith(catererKeys.detailFamily)),
                { clear: true },
              ),
          );
        }
        if (
          !isReadRefusal(cause) &&
          overlapping.changes.length &&
          reading.current.get(window) === overlapping
        ) {
          complete(() => {
            void response.mutate(
              (data) =>
                data &&
                overlapping.changes.reduce(
                  (previous, change) => applyRowChange(previous, change, false),
                  data,
                ),
              { revalidate: false },
            );
          });
        }
        throw cause;
      } finally {
        if (reading.current.get(window) === overlapping)
          reading.current.delete(window);
      }
    },
    {
      keepPreviousData: false,
      revalidateOnFocus: true,
      focusThrottleInterval: 60_000,
    },
  );
  const schools = response.data ?? null;
  const loading = !schools && response.isLoading;
  const { error } = useSwrResourceLoadError(
    [response],
    "die Bestellungen",
    response.mutate,
  );
  const { show: showActionError } = useApiErrorDisplay();
  const [exporting, setExporting] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const current = useRef({
    key,
    scope: scoped(""),
    mutate: response.mutate,
    refresh: retrySchool,
  });
  const grants = useRef<string | null>(null);
  useLayoutEffect(() => {
    current.current = {
      key,
      scope: scoped(""),
      mutate: response.mutate,
      refresh: retrySchool,
    };
    if (!schools) return;
    const allowed = schools.schools
      .filter((school) => !school.failure)
      .map(
        (school) => catererKeys.schoolDetails(school.id) + school.grant + ":",
      )
      .sort();
    const signature = JSON.stringify([scoped(""), allowed]);
    if (grants.current === signature) return;
    grants.current = signature;
    // A new supply or a narrower grant invalidates details in every window,
    // including pending reads. No other overview may restore the old grant.
    void invalidate(
      (candidate) =>
        (candidate !== key &&
          candidate.startsWith(catererKeys.overviewFamily)) ||
        (candidate.startsWith(catererKeys.detailFamily) &&
          !allowed.some((prefix) => candidate.startsWith(prefix))),
      { clear: true },
    );
  });

  function applyToWindow(
    windowKey: string | null,
    mutate: typeof response.mutate,
    change: RowChange,
  ) {
    if (!windowKey) return;
    const pending = reading.current.get(scoped(windowKey)!);
    if (pending) {
      pending.changes.push(change);
    } else {
      void mutate((data) => data && applyRowChange(data, change, false), {
        revalidate: false,
      });
    }
  }

  function updateSchool(id: string, update: SchoolUpdate) {
    const visible = current.current;
    if (visible.scope !== scoped("")) return;
    const change = { id, update };
    applyToWindow(key, response.mutate, change);
    if (visible.key !== key) applyToWindow(visible.key, visible.mutate, change);
    void invalidate(
      (candidate) =>
        candidate.startsWith(catererKeys.overviewFamily) &&
        candidate !== key &&
        candidate !== visible.key,
      { clear: true },
    );
  }

  function reconcileDetail(
    school: CatererSchoolSummary,
    days: CatererSummaryDay[],
  ) {
    // Only this bound window and grant: a late read must not touch another
    // period, restore an ended supply or put names into the overview cache.
    const pending = reading.current.get(scoped(key!)!);
    if (pending) {
      pending.details.set(
        catererKeys.orders(school.id, school.grant, from, to),
        days,
      );
    }
    const cached = response.readCurrent?.().data;
    const previous = cached?.schools.find((row) => row.id === school.id);
    if (
      !previous ||
      previous.failure ||
      previous.grant !== school.grant ||
      sameSummaryDays(previous.days, days)
    )
      return;
    applyToWindow(key, response.mutate, {
      id: school.id,
      update: (row, freshDirectory) =>
        freshDirectory || row.failure || row.grant !== school.grant
          ? row
          : { ...row, days },
    });
  }

  async function retrySchool(school: CatererSchoolSummary) {
    if (current.current.scope !== scoped("") || current.current.key !== key)
      return;
    let complete: ReturnType<typeof guard>;
    try {
      complete = guard(key);
    } catch {
      return;
    }
    const ticket = Symbol();
    retries.current.set(school.id, ticket);
    const isCurrent = () =>
      complete.isCurrent() && retries.current.get(school.id) === ticket;
    try {
      const result = await fetchCatererOverview(from, to, school.id);
      const row = result.schools[0];
      if (row?.id !== school.id || !isCurrent()) return;
      applyToWindow(key, response.mutate, {
        id: school.id,
        // A concurrent directory's membership, new grant or refusal wins.
        update: (previous, freshDirectory) =>
          freshDirectory && (previous.failure || previous.grant !== row.grant)
            ? previous
            : row,
      });
    } catch (cause) {
      if (!isCurrent()) return;
      if (cause instanceof ApiError && cause.code === "meals.not_supplied")
        updateSchool(school.id, () => null);
      else
        void showActionError(cause, {
          object: `die Bestellung von ${school.name}`,
          retry: () => void retrySchool(school),
        });
    }
  }

  async function download(format: DeliveryExportFormat) {
    setExporting(format);
    try {
      await downloadCatererDeliveries(from, to, format);
    } catch (cause) {
      void showActionError(cause, { object: "die Lieferliste" });
    } finally {
      setExporting(null);
    }
  }

  async function print() {
    // Opened inside the click: a tab opened after the download is blocked.
    const target = window.open("", "_blank");
    setExporting("print");
    try {
      const response = await bffFile("caterer", "GET /caterer/orders/export", {
        query: { from, to, format: "pdf" },
        errorMessage: "caterer print failed",
      });
      await openBlobForPrint(await response.blob(), target);
    } catch (cause) {
      target?.close();
      void showActionError(cause, { object: "die Druckansicht" });
    } finally {
      setExporting(null);
    }
  }

  const list = schools?.schools ?? [];
  const rows: OverviewRow[] = [
    ...list.map((school) => ({
      key: school.id,
      school,
      orders: school.failure ? null : school,
      failed: Boolean(school.failure),
    })),
    ...(list.length > 1
      ? [{ key: "sum", school: null, orders: null, failed: false }]
      : []),
  ];
  const dayOf = (row: OverviewRow, date: string) =>
    row.orders?.days.find((day) => day.date === date);
  const totalsComplete = !loading && list.every((school) => !school.failure);
  const daySum = (date: string) =>
    list.reduce(
      (sum, school) =>
        sum + counts(school.days.find((day) => day.date === date)),
      0,
    );

  const columns: DataTableColumn<OverviewRow>[] = [
    {
      key: "school",
      header: "Schule",
      stacked: "title",
      render: (row) =>
        row.school ? (
          <div className="flex flex-col items-start gap-1">
            <span className="font-medium text-gray-900">{row.school.name}</span>
            {row.orders ? <SchoolState orders={row.orders} /> : null}
            {row.failed ? (
              <span className="text-sm text-gray-600">
                Bestellung nicht geladen
              </span>
            ) : null}
          </div>
        ) : (
          <span className="font-semibold text-gray-900">Summe</span>
        ),
    },
    ...days.map((date) => ({
      key: date,
      header: shortDay(date),
      align: "right" as const,
      render: (row: OverviewRow) => {
        if (!row.school)
          return (
            <span className="font-semibold">
              {totalsComplete ? daySum(date) : "Unvollständig"}
            </span>
          );
        const day = dayOf(row, date);
        if (!day || day.closed || day.status === "unordered") return "–";
        const { added, removed } = day;
        return (
          <span className="inline-flex items-center justify-end gap-1">
            {day.total}
            {added > 0 ? (
              <StatusBadge
                label={`+${added}`}
                tone="orange"
                title="Nach der Frist dazugekommen"
              />
            ) : null}
            {removed > 0 ? (
              <StatusBadge
                label={`−${removed}`}
                tone="orange"
                title="Nach der Frist abgemeldet"
              />
            ) : null}
          </span>
        );
      },
    })),
    {
      key: "sum",
      header: "Summe",
      align: "right",
      render: (row) => (
        <span className="font-semibold">
          {row.school && !row.orders
            ? "Nicht geladen"
            : !row.school && !totalsComplete
              ? "Unvollständig"
              : row.school
                ? days.reduce((sum, date) => sum + counts(dayOf(row, date)), 0)
                : days.reduce((sum, date) => sum + daySum(date), 0)}
        </span>
      ),
    },
  ];

  // Eine sichtbare Aktion neben dem Zeitraum, die Formate im Menü (wie
  // Tagesauswertung und Statistik): Drucken ist der tägliche Griff, die
  // Dateien sind der seltene. Vorher standen vier Knöpfe in der Kopfzeile.
  const exportActions: OverflowMenuEntry[] = [
    { kind: "header", label: "Herunterladen" },
    ...(
      [
        { format: "pdf", label: "PDF", Icon: FileText },
        { format: "xlsx", label: "Excel", Icon: FileSpreadsheet },
        { format: "csv", label: "CSV", Icon: FileSpreadsheet },
      ] as {
        format: DeliveryExportFormat;
        label: string;
        Icon: typeof FileText;
      }[]
    ).map(({ format, label, Icon }) => ({
      label: exporting === format ? "Wird erstellt…" : label,
      icon: <Icon className="h-4 w-4" aria-hidden />,
      onClick: () => void download(format),
      disabled: !schools || exporting !== null,
    })),
  ];

  // Laden, Fehler und Leer stehen in derselben Karte wie die Tabelle, die
  // sie ersetzen; nichts steht frei auf dem Hintergrund.
  const unavailable = Boolean(error) || (schools !== null && list.length === 0);

  return (
    <div className="space-y-6">
      <SectionCard
        title={
          schools?.catererName
            ? `Bestellungen für ${schools.catererName}`
            : "Bestellungen"
        }
        description={
          unavailable
            ? undefined
            : "Eine Zahl wie +2 ist eine Änderung nach der Frist."
        }
        actions={
          unavailable ? undefined : (
            <div className="flex flex-wrap items-center gap-2">
              <SegmentedControl<Period>
                items={PERIODS}
                value={period}
                onChange={setPeriod}
                ariaLabel="Zeitraum wählen"
              />
              <Button
                type="button"
                variant="primary"
                size="md"
                className="gap-2"
                disabled={!schools || exporting !== null}
                onClick={() => void print()}
              >
                <Printer className="h-4 w-4" aria-hidden />
                {exporting === "print" ? "Wird geöffnet…" : "Drucken"}
              </Button>
              <OverflowMenu
                items={exportActions}
                ariaLabel="Weitere Aktionen"
              />
            </div>
          )
        }
      >
        {error ? (
          <LoadErrorAlert error={error} />
        ) : schools !== null && list.length === 0 ? (
          <p className="text-sm leading-6 text-gray-600">
            Du belieferst zurzeit keine Schule. Sobald eine Schule dich einlädt,
            siehst du hier ihre Bestellungen.
          </p>
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            getRowKey={(row) => row.key}
            isLoading={loading}
            loadingRowCount={3}
            caption="Essen je Schule und Tag im gewählten Zeitraum"
          />
        )}
      </SectionCard>

      {error || !schools
        ? null
        : list.map((school) => {
            return (
              <SectionCard
                key={school.id}
                title={school.name}
                description={
                  school.deliveryAddress
                    ? `Lieferadresse: ${school.deliveryAddress}`
                    : undefined
                }
                collapsible
                collapsed={!expanded.has(scoped(school.id)!)}
                onCollapsedChange={(collapsed) => {
                  const id = scoped(school.id)!;
                  setExpanded((previous) => {
                    const next = new Set(previous);
                    if (collapsed) next.delete(id);
                    else next.add(id);
                    return next;
                  });
                }}
              >
                {school.failure ? (
                  <SchoolLoadError
                    school={school}
                    failure={school.failure}
                    onRetry={() => retrySchool(school)}
                  />
                ) : (
                  <SchoolDetails
                    school={school}
                    from={from}
                    to={to}
                    onConfirmed={(orderId) =>
                      updateSchool(school.id, (row) =>
                        confirmDays(row, orderId),
                      )
                    }
                    onRefused={(cause) =>
                      updateSchool(school.id, (row) =>
                        cause.code === "meals.not_supplied"
                          ? null
                          : {
                              ...row,
                              failure: {
                                code: cause.code!,
                                status: cause.status!,
                              },
                              days: [],
                            },
                      )
                    }
                    onRead={(days) => reconcileDetail(school, days)}
                    onRefreshSummary={() => {
                      if (current.current.scope === scoped(""))
                        void current.current.refresh(school);
                    }}
                  />
                )}
              </SectionCard>
            );
          })}
    </div>
  );
}
