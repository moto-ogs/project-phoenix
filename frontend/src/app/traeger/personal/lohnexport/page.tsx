"use client";

// Lohnexport des Trägers über alle Schulen (#4712, ADR 0089 Abschnitt 11,
// ADR 0250): die DATEV-Lohndatei für alle Arbeitsverträge des Trägers, der
// Zeitexport für ein eigenes Zeiterfassungssystem und die Lohnarten je Art
// des Vertrags. Ein Monat gilt für alle drei Reiter; Standard ist der
// Vormonat, denn den rechnet das Lohnbüro ab.

import { LockKeyIcon } from "@phosphor-icons/react";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { PayrollFilePanel } from "~/components/traeger/staff/payroll-file-panel";
import { PayrollSettingsPanel } from "~/components/traeger/staff/payroll-settings-panel";
import { TimeExportPanel } from "~/components/traeger/staff/time-export-panel";
import { useTraegerSettingsSchema } from "~/components/traeger/use-traeger-resources";
import { EmptyState } from "~/components/ui/empty-state";
import { PlanningContextBar } from "~/components/ui/planning/planning-context-bar";
import { SectionCard } from "~/components/ui/section-card";
import { TenantPage } from "~/components/ui/tenant-page";
import { useApiErrorDisplay, useApiLoadError } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import { monthLabel } from "~/lib/duration-format";
import { downloadBlob } from "~/lib/file-download";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { createLogger } from "~/lib/logger";
import {
  downloadPayrollFile,
  downloadTimeFile,
  fetchPayrollReport,
  fetchTimeReport,
  type PayrollFormat,
  type PayrollReport,
  type TimeReport,
} from "~/lib/traeger-staff-exports-api";

const logger = createLogger({ component: "TraegerPayrollExportPage" });

const NOT_RELEASED = "workforce.traeger_staff_not_released";

type Tab = "lohndatei" | "zeitexport" | "lohnarten";
const TABS: readonly { value: Tab; label: string }[] = [
  { value: "lohndatei", label: "Lohndatei" },
  { value: "zeitexport", label: "Zeitexport" },
  { value: "lohnarten", label: "Lohnarten" },
];

const INFO = (
  <div className="space-y-2">
    <p>
      Hier entsteht die Lohndatei für DATEV: eine Datei für alle Schulen und
      alle Arbeitsverträge beim Träger. Jede Art des Vertrags hat eigene
      Lohnarten. So bleiben Minijob, Übungsleiterpauschale und Ehrenamt
      getrennt.
    </p>
    <p>
      Der Zeitexport gibt die Zeiten für ein eigenes Zeiterfassungssystem aus.
      Jeder Download steht im Zugriffsprotokoll jeder Schule.
    </p>
  </div>
);

interface MonthKey {
  readonly year: number;
  readonly month: number;
}

const shift = ({ year, month }: MonthKey, delta: number): MonthKey => {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
};

const monthOf = (isoDay: string): MonthKey => {
  const [year, month] = isoDay.split("-").map(Number);
  return { year: year ?? 2000, month: month ?? 1 };
};

const sameMonth = (a: MonthKey, b: MonthKey) =>
  a.year === b.year && a.month === b.month;

const errorText = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

export default function TraegerPayrollExportPage() {
  // `useSearchParams` braucht eine Suspense-Grenze.
  return (
    <Suspense fallback={<TenantPage title="Lohnexport" loading />}>
      <PayrollExportContent />
    </Suspense>
  );
}

function PayrollExportContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get("tab");
  const tab: Tab = TABS.some((entry) => entry.value === tabParam)
    ? (tabParam as Tab)
    : "lohndatei";
  const today = useBerlinToday();
  const thisMonth = monthOf(today);
  const [shown, setShown] = useState<MonthKey>(() => shift(monthOf(today), -1));
  const [format, setFormat] = useState<PayrollFormat>("datev_lodas");
  const [payroll, setPayroll] = useState<PayrollReport | null>(null);
  const [times, setTimes] = useState<TimeReport | null>(null);
  const [notReleased, setNotReleased] = useState(false);
  const [downloading, setDownloading] = useState<"payroll" | "times" | null>(
    null,
  );
  // Each report keeps its own load error: a failed time report must not
  // stand over the payroll file, and its retry clears only its own error.
  const payrollLoad = useApiLoadError();
  const timesLoad = useApiLoadError();
  const { show: showPayrollError, clear: clearPayrollError } = payrollLoad;
  const { show: showTimesError, clear: clearTimesError } = timesLoad;
  const display = useApiErrorDisplay();
  const settings = useTraegerSettingsSchema();
  const shownLabel = monthLabel(shown.year, shown.month);

  // Only the latest request may show its answer: a slow answer for the
  // month before must not replace the month now shown.
  const payrollRequest = useRef(0);
  const timesRequest = useRef(0);
  // A retry or the refresh after a failed download loads what the page shows
  // now, not the month that was shown when the request started.
  const current = useRef({ month: shown, format });
  useEffect(() => {
    current.current = { month: shown, format };
  }, [shown, format]);

  const loadPayroll = useCallback(
    async (month: MonthKey, chosen: PayrollFormat) => {
      const request = ++payrollRequest.current;
      setPayroll(null);
      try {
        const report = await fetchPayrollReport(
          month.year,
          month.month,
          chosen,
        );
        if (request !== payrollRequest.current) return;
        setPayroll(report);
        setNotReleased(false);
        clearPayrollError();
      } catch (err) {
        if (request !== payrollRequest.current) return;
        if (err instanceof ApiError && err.code === NOT_RELEASED) {
          setNotReleased(true);
          clearPayrollError();
          return;
        }
        logger.error("traeger_payroll_report_load_failed", {
          error: errorText(err),
        });
        await showPayrollError(err, {
          object: "die Prüfung der Lohndatei",
          retry: () =>
            void loadPayroll(current.current.month, current.current.format),
        });
      }
    },
    [clearPayrollError, showPayrollError],
  );

  const loadTimes = useCallback(
    async (month: MonthKey) => {
      const request = ++timesRequest.current;
      setTimes(null);
      try {
        const report = await fetchTimeReport(month.year, month.month);
        if (request !== timesRequest.current) return;
        setTimes(report);
        clearTimesError();
      } catch (err) {
        if (request !== timesRequest.current) return;
        if (err instanceof ApiError && err.code === NOT_RELEASED) {
          setNotReleased(true);
          clearTimesError();
          return;
        }
        logger.error("traeger_time_report_load_failed", {
          error: errorText(err),
        });
        await showTimesError(err, {
          object: "die Prüfung des Zeitexports",
          retry: () => void loadTimes(current.current.month),
        });
      }
    },
    [clearTimesError, showTimesError],
  );

  useEffect(() => {
    void loadPayroll(shown, format);
  }, [loadPayroll, shown, format]);

  useEffect(() => {
    if (tab === "zeitexport") void loadTimes(shown);
  }, [loadTimes, shown, tab]);

  const download = async (kind: "payroll" | "times") => {
    setDownloading(kind);
    try {
      const file =
        kind === "payroll"
          ? await downloadPayrollFile(shown.year, shown.month, format)
          : await downloadTimeFile(shown.year, shown.month);
      downloadBlob(
        file.blob,
        file.filename ??
          (kind === "payroll"
            ? `lohnexport_${format}_${shown.year}-${String(shown.month).padStart(2, "0")}.txt`
            : `zeitexport_${shown.year}-${String(shown.month).padStart(2, "0")}.csv`),
      );
    } catch (err) {
      logger.error("traeger_staff_export_download_failed", {
        kind,
        error: errorText(err),
      });
      await display.show(err, {
        object: kind === "payroll" ? "die Lohndatei" : "der Zeitexport",
      });
      // Ein abgelehnter Download kommt mit dem neuen Stand der Prüfung.
      if (kind === "payroll") {
        void loadPayroll(current.current.month, current.current.format);
      }
    } finally {
      setDownloading(null);
    }
  };

  const changeTab = (next: string) => {
    const params = new URLSearchParams(searchParams?.toString());
    params.set("tab", next);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const isThisMonth = sameMonth(shown, thisMonth);
  const contextBar = (
    <PlanningContextBar
      withoutContextRow
      dateLabel={shownLabel}
      onPrevious={() => setShown((current) => shift(current, -1))}
      onNext={
        isThisMonth ? undefined : () => setShown((current) => shift(current, 1))
      }
      previousLabel="Vorheriger Monat"
      nextLabel="Nächster Monat"
      previousTooltip="Zeigt den Monat davor."
      nextTooltip="Zeigt den Monat danach."
      onToday={
        sameMonth(shown, shift(thisMonth, -1))
          ? undefined
          : () => setShown(shift(thisMonth, -1))
      }
      todayLabel="Letzter Monat"
    />
  );

  return (
    <TenantPage
      title="Lohnexport"
      info={INFO}
      searchSlot={notReleased ? undefined : contextBar}
      tabs={
        notReleased
          ? undefined
          : {
              value: tab,
              onChange: changeTab,
              items: TABS,
              label: "Bereiche des Lohnexports",
              inUrl: true,
            }
      }
      error={
        tab === "zeitexport"
          ? timesLoad.error
          : (payrollLoad.error ??
            (tab === "lohnarten" ? settings.loadError : null))
      }
    >
      {notReleased ? (
        <SectionCard>
          <EmptyState
            icon={<LockKeyIcon className="h-12 w-12" aria-hidden="true" />}
            title="Personal beim Träger ist noch nicht freigeschaltet."
            description="Das moto-Team schaltet es frei. Bis dahin rechnet jede Schule ihren Lohn selbst ab."
          />
        </SectionCard>
      ) : null}
      {!notReleased && tab === "lohndatei" ? (
        <PayrollFilePanel
          report={payroll}
          monthLabel={shownLabel}
          format={format}
          onFormatChange={setFormat}
          onDownload={() => void download("payroll")}
          downloading={downloading === "payroll"}
          onOpenWageTypes={() => changeTab("lohnarten")}
        />
      ) : null}
      {!notReleased && tab === "zeitexport" ? (
        <TimeExportPanel
          report={times}
          monthLabel={shownLabel}
          onDownload={() => void download("times")}
          downloading={downloading === "times"}
        />
      ) : null}
      {!notReleased &&
      tab === "lohnarten" &&
      !settings.data &&
      !settings.loadError ? (
        <SectionCard title="Lohnarten je Art des Vertrags" loading />
      ) : null}
      {!notReleased && tab === "lohnarten" && settings.data ? (
        <PayrollSettingsPanel
          schema={settings.data}
          gaps={payroll?.unconfigured ?? []}
          onSaved={async () => {
            await settings.mutate();
            await loadPayroll(current.current.month, current.current.format);
          }}
        />
      ) : null}
    </TenantPage>
  );
}
