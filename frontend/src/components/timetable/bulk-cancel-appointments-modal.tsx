"use client";

/**
 * „Termine absagen“ (#3594): sagt alle geplanten Termine eines Zeitraums ab
 * und nimmt sie aus dem Plan, etwa wenn ein Schließtag erst nach der Planung
 * eingetragen wurde. Zuerst zählt moto die betroffenen Termine (dry_run),
 * dann folgt die zweistufige Bestätigung des geteilten Löschdialogs.
 *
 * Abgesagt werden nur geplante Termine ab heute. Laufende, beendete und
 * vergangene Termine bleiben. Serien, die bewusst auch an Schließtagen
 * geplant sind (Ferienbetreuung), bleiben ebenfalls, bis die Person das
 * Häkchen „Auch diese Serien absagen“ setzt; der Dialog nennt sie mit Namen.
 * Eltern bekommen keine Nachricht.
 */

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { DateRange } from "react-day-picker";

import { Checkbox } from "~/components/ui/checkbox";
import { ConfirmDeleteModal } from "~/components/ui/confirm-delete-modal";
import { DateRangePicker } from "~/components/ui/date-range-picker";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { formatClosingDayRange } from "~/lib/closing-day-helpers";
import { berlinTodayISO, parseISODate, toISODate } from "~/lib/date-helpers";
import { useRefreshAfterWrite } from "~/lib/hooks/use-refresh-after-write";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import { SCHOOL_VACATION_HINTS_KEY } from "~/lib/school-vacations-api";
import { useFreshSWR, useTenantMutateMatching } from "~/lib/swr";
import { tenantDailyKeys } from "~/lib/swr/tenant-daily-keys";
import { timetableService } from "~/lib/timetable-api";
import type { BulkCancelResult } from "~/lib/timetable-types";

const logger = createLogger({ component: "BulkCancelAppointmentsModal" });

/** SWR-Präfixe der Planflächen, die nach dem Absagen neu laden. */
const PLAN_CACHE_PREFIXES = [
  "timetable-week-",
  "timetable-month-",
  "timetable-day-",
  "timetable-gaps-",
  // Planungszeiträume des Betreuungsplans: die Verwendung zählt Termine.
  "database-calendar-periods-list",
  // Der Ferienhinweis zählt die Regeltermine in den Ferien (#5345).
  SCHOOL_VACATION_HINTS_KEY,
  // Das nächste Öffnen zählt neu.
  tenantDailyKeys.bulkCancelPreviewFamily,
] as const;

function termineLabel(count: number): string {
  return count === 1 ? "1 Termin" : `${count} Termine`;
}

function appointmentsLabel(count: number): string {
  return count === 1 ? "wird 1 Termin" : `werden ${count} Termine`;
}

/** „Ferienbetreuung (5 Termine), Ferienspiele (1 Termin)“ */
function keptSeriesLabel(series: BulkCancelResult["keptSeries"]): string {
  return series
    .map((entry) => `${entry.name} (${termineLabel(entry.count)})`)
    .join(", ");
}

/**
 * Ein Zeitraum, der schon begonnen hat, startet heute: vergangene Termine
 * sagt moto ohnehin nicht ab, und die Auswahl erlaubt keine früheren Tage.
 */
function clampToToday(from: string, to: string): string {
  const today = berlinTodayISO();
  return from !== "" && from < today && to >= today ? today : from;
}

export function BulkCancelAppointmentsModal({
  isOpen,
  initialFrom,
  initialTo,
  afterSave = false,
  onClose,
  onCancelled,
}: {
  /** Direkt nach dem Speichern eines Schließtags geöffnet (#3594). */
  readonly afterSave?: boolean;
  readonly isOpen: boolean;
  /** Vorgeschlagener erster Tag als "YYYY-MM-DD"; die Person kann ihn ändern. */
  readonly initialFrom: string;
  /** Vorgeschlagener letzter Tag als "YYYY-MM-DD"; die Person kann ihn ändern. */
  readonly initialTo: string;
  readonly onClose: () => void;
  readonly onCancelled?: (count: number) => void;
}) {
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [includeSeries, setIncludeSeries] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  // Der Dialog liegt über den Toasts: der Fehler des Absagens steht im
  // Dialog (#2516), der Fehler des Zählens vor Ort mit Wiederholen.
  const formErrors = useApiFormError();
  const { clear: clearError } = formErrors;
  const counting = isOpen && from !== "" && to !== "";
  const {
    data: preview,
    error: countError,
    mutate: recount,
  } = useFreshSWR(
    counting
      ? tenantDailyKeys.bulkCancelPreview(from, to, includeSeries)
      : null,
    () => timetableService.bulkCancel(from, to, true, includeSeries),
    { keepPreviousData: false },
  );
  const countLoad = useSwrResourceLoadError(
    [{ data: preview, error: countError }],
    "das Zählen der Termine",
    () => recount(),
  );
  const latestConfirmRef = useRef<() => void>(() => undefined);
  const { success: toastSuccess } = useToast();
  const refreshPlan = useTenantMutateMatching(PLAN_CACHE_PREFIXES);
  // Nach der Absage lädt der Plan nach. Das ist nur eine Invalidierung der
  // Plan-Schlüssel; deren Flächen zeigen ihre Ladefehler selbst. Sie läuft
  // nach dem Schreiben, nie in dessen catch (#6652).
  const planAfterWrite = useRefreshAfterWrite("die Anzeige des Plans", () =>
    refreshPlan(),
  );
  const rangeLabelId = useId();
  const includeSeriesId = useId();

  useEffect(() => {
    if (!isOpen) return;
    setFrom(clampToToday(initialFrom, initialTo));
    setTo(initialTo);
    setIncludeSeries(false);
    clearError();
  }, [isOpen, initialFrom, initialTo, clearError]);

  const handleRangeChange = (range: DateRange | undefined) => {
    setFrom(range?.from ? toISODate(range.from) : "");
    setTo(range?.to ? toISODate(range.to) : "");
  };

  const handleConfirm = async () => {
    if (!preview || countError || cancelling) return;
    setCancelling(true);
    formErrors.clear();
    let result: Awaited<ReturnType<typeof timetableService.bulkCancel>>;
    try {
      result = await timetableService.bulkCancel(
        from,
        to,
        false,
        includeSeries,
      );
    } catch (err) {
      logger.error("bulk_cancel_failed", {
        from,
        to,
        error: err instanceof Error ? err.message : String(err),
      });
      void formErrors.show(err, {
        object: "die Absage der Termine",
        retry: () => latestConfirmRef.current(),
      });
      setCancelling(false);
      return;
    }
    setCancelling(false);
    toastSuccess(
      result.count === 1
        ? "1 Termin ist abgesagt."
        : `${result.count} Termine sind abgesagt.`,
    );
    onCancelled?.(result.count);
    onClose();
    await planAfterWrite.refresh();
  };

  useLayoutEffect(() => {
    latestConfirmRef.current = () => void handleConfirm();
  });

  // „Im Zeitraum 12.10.2026 – 16.10.2026“, ein einzelner Tag „Am 12.10.2026“.
  const rangeText = `${from === to ? "Am" : "Im Zeitraum"} ${formatClosingDayRange({ startDate: from, endDate: to })}`;
  const ready: Pick<BulkCancelResult, "count" | "keptSeries"> | null =
    counting && preview ? preview : null;
  const keptSeries = ready?.keptSeries ?? [];
  // Das Häkchen bleibt sichtbar, solange es gesetzt ist: nach dem Neuzählen
  // bleibt keine Serie mehr übrig, die Person muss es aber abwählen können.
  const showIncludeSeries = includeSeries || keptSeries.length > 0;

  return (
    <ConfirmDeleteModal
      isOpen={isOpen}
      title="Termine im Zeitraum absagen"
      description={
        <div className="flex flex-col gap-3">
          {afterSave && (
            <p>Der Schließtag ist gespeichert. Es sind noch Termine geplant.</p>
          )}
          <div
            role="group"
            aria-labelledby={rangeLabelId}
            className="flex flex-col gap-1"
          >
            <span
              id={rangeLabelId}
              className="text-sm font-medium text-gray-700"
            >
              Zeitraum
            </span>
            <DateRangePicker
              value={
                from !== "" && to !== ""
                  ? { from: parseISODate(from), to: parseISODate(to) }
                  : undefined
              }
              onChange={handleRangeChange}
              fromMin={parseISODate(berlinTodayISO())}
            />
          </div>
          {counting && !preview && !countError && (
            <p>Die Termine werden gezählt.</p>
          )}
          <LoadErrorAlert error={countLoad.error} />
          <LoadErrorAlert error={planAfterWrite.error} />
          {ready && ready.count === 0 && keptSeries.length === 0 && (
            <p>{rangeText} sind keine Termine mehr geplant.</p>
          )}
          {ready && ready.count === 0 && keptSeries.length > 0 && (
            <p>
              {rangeText} sind nur noch Serien geplant, die auch an Schließtagen
              stattfinden: {keptSeriesLabel(keptSeries)}. Zum Absagen setzt du
              unten das Häkchen.
            </p>
          )}
          {ready && ready.count > 0 && (
            <p>
              {rangeText} {appointmentsLabel(ready.count)} abgesagt. Eltern
              bekommen keine Nachricht.
            </p>
          )}
          {ready && ready.count > 0 && keptSeries.length > 0 && (
            <p>
              Serien, die auch an Schließtagen stattfinden, bleiben:{" "}
              {keptSeriesLabel(keptSeries)}.
            </p>
          )}
          {showIncludeSeries && (
            <label htmlFor={includeSeriesId} className="flex items-start gap-2">
              <Checkbox
                id={includeSeriesId}
                checked={includeSeries}
                disabled={cancelling}
                onChange={(event) => setIncludeSeries(event.target.checked)}
              />
              <span className="text-sm text-gray-800">
                Auch diese Serien absagen
              </span>
            </label>
          )}
        </div>
      }
      gate={{ mode: "twoStep", firstStepLabel: "Termine absagen" }}
      cancelLabel="Termine behalten"
      confirmDisabled={!ready || ready.count === 0 || cancelling}
      onConfirm={handleConfirm}
      onClose={onClose}
      loading={cancelling}
      error={formErrors.error}
      confirmLabel="Endgültig absagen"
      loadingLabel="Wird abgesagt…"
    />
  );
}
