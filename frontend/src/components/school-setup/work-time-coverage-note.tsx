"use client";

import { CheckCircleIcon } from "@phosphor-icons/react";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { InsetPanel } from "~/components/ui/inset-panel";
import { ProgressBar } from "~/components/ui/progress-bar";
import { Skeleton } from "~/components/ui/skeleton";
import { ApiError } from "~/lib/api-error";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import { LOCATION_COLORS } from "~/lib/location-helper";
import { notBookedModuleOf } from "~/lib/module-not-booked";
import type { PayrollTargetCoverage } from "~/lib/payroll-api";
import { monthYearLabel } from "~/lib/time-account-links";

/** Die Soll-Prüfung, wie der Schritt „Arbeitszeitmodelle“ sie zeigt. */
export interface WorkTimeCoverageState {
  /** `undefined`, solange die Zahl lädt. */
  readonly coverage: PayrollTargetCoverage | undefined;
  readonly error: unknown;
  readonly retry: () => unknown;
}

/**
 * Die Zahl darf fehlen, ohne dass etwas kaputt ist: Die Checkliste sieht,
 * wer Einstellungen ändert; die Zeitkonten zählt nur, wer sie auch verwaltet.
 * Bucht die Schule die Zeiterfassung gerade ab, gibt es nichts zu zählen.
 */
function mayStayHidden(error: unknown): boolean {
  return (
    notBookedModuleOf(error) !== null ||
    (error instanceof ApiError &&
      (error.status === 401 || error.status === 403))
  );
}

/**
 * Wie viele Personen mit Zeitkonto noch kein Soll haben (#6919), im
 * aufgeklappten Schritt der Checkliste. Dieselbe Zahl wie unter „Abrechnung“
 * und über den Zeitkonten.
 */
export function WorkTimeCoverageNote({
  coverage,
  error,
  retry,
}: WorkTimeCoverageState) {
  const hidden = mayStayHidden(error);
  const loadError = useSwrLoadError(
    hidden ? null : error,
    "die Zahl der Personen ohne Soll",
    retry,
  );
  if (hidden) return null;
  if (error) {
    return <LoadErrorAlert error={loadError} />;
  }
  if (!coverage) {
    return (
      <InsetPanel
        className="flex flex-col gap-2.5"
        aria-busy="true"
        aria-label="Die Zahl der Personen ohne Soll lädt"
      >
        <Skeleton className="h-9 w-4/5" />
        <Skeleton className="h-1.5 w-full" />
      </InsetPanel>
    );
  }

  const { staffTotal: total, staffWithoutTarget: missing } = coverage;
  const month = monthYearLabel(coverage.year, coverage.month);
  if (total === 0) {
    return (
      <InsetPanel className="text-sm text-gray-700">
        In den Zeitkonten steht noch niemand. Lade zuerst dein Team ein.
      </InsetPanel>
    );
  }
  if (missing === 0) {
    return (
      <InsetPanel className="flex items-center gap-2.5">
        <CheckCircleIcon
          size={20}
          weight="fill"
          className="shrink-0"
          style={{ color: LOCATION_COLORS.GROUP_ROOM }}
          aria-hidden
        />
        <p className="text-sm text-gray-700">
          {total === 1
            ? `Die eine Person mit Zeitkonto hat im ${month} ein Soll.`
            : `Alle ${total} Personen mit Zeitkonto haben im ${month} ein Soll.`}
        </p>
      </InsetPanel>
    );
  }
  return (
    <InsetPanel className="flex flex-col gap-2.5">
      <p className="flex items-center gap-3">
        <span className="text-moto-orange-strong text-3xl leading-none font-semibold tabular-nums">
          {missing}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="text-sm font-medium text-gray-900">
            {missing === 1
              ? `von ${total} ${total === 1 ? "Person hat" : "Personen hat"} noch kein Soll`
              : `von ${total} Personen haben noch kein Soll`}
          </span>
          <span className="text-xs text-gray-500">Zeitkonten {month}</span>
        </span>
      </p>
      <ProgressBar
        value={total - missing}
        max={total}
        tone="orange"
        size="sm"
        label={`${total - missing} von ${total} Personen haben ein Soll`}
      />
    </InsetPanel>
  );
}
