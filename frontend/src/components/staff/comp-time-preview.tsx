"use client";

// Stundenkonto-Vorschau für einen geplanten Freizeitausgleich (#2873).
// Informiert vor dem Eintragen; ein negativer Stand wird bestätigt, nicht
// verhindert. Seit #3256 Teil des gemeinsamen Dialogs „Abwesenheit eintragen".
// Die Bestätigung prüft der Server unter seiner Sperre (ADR 0311): eine
// Vorschau aus dem Cache, die kein Minus zeigte, bucht kein Minus.

import { useCallback, useEffect } from "react";

import { formatSignedDuration } from "~/components/staff/staff-time-views";
import { DataField, DataGrid } from "~/components/ui/data-field";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { useApiLoadError } from "~/contexts/ToastContext";
import { useSWRAuth } from "~/lib/swr";
import { staffAbsenceKeys } from "~/lib/swr/staff-keys";
import {
  staffAbsenceService,
  type CompTimeBalancePreview,
} from "~/lib/staff-api";
import { InsetPanel } from "~/components/ui/inset-panel";

export function useCompTimePreview({
  enabled,
  staffId,
  dateStart,
  dateEnd,
  halfDay,
}: {
  readonly enabled: boolean;
  readonly staffId: string;
  readonly dateStart: string;
  readonly dateEnd: string;
  readonly halfDay: boolean;
}): {
  preview: CompTimeBalancePreview | null;
  loading: boolean;
  error: unknown;
  reload: () => void;
} {
  const { data, error, mutate, isValidating } = useSWRAuth(
    enabled && dateStart && dateEnd
      ? staffAbsenceKeys.compTimePreview(staffId, dateStart, dateEnd, halfDay)
      : null,
    () =>
      staffAbsenceService.getCompTimePreview(staffId, {
        dateStart,
        dateEnd,
        halfDay,
      }),
    // Ein anderer Zeitraum zeigt nicht die Projektion des vorigen.
    { keepPreviousData: false },
  );
  const reload = useCallback(() => void mutate(), [mutate]);
  // Der Block zeigt den Ladefehler (das Panel), die Buchung selbst bleibt
  // möglich und meldet ihre eigenen Fehler. Ein gescheitertes Auffrischen
  // zeigt keine alte Projektion als Grundlage einer Bestätigung.
  const failure = isValidating ? undefined : error;
  const preview = failure ? null : (data ?? null);
  const active = enabled && Boolean(dateStart && dateEnd);
  return {
    preview,
    loading: active && preview === null && !failure,
    error: failure ?? null,
    reload,
  };
}

export function CompTimePreviewPanel({
  preview,
  loading,
  error = null,
  onRetry,
}: {
  readonly preview: CompTimeBalancePreview | null;
  readonly loading: boolean;
  readonly error?: unknown;
  readonly onRetry?: () => void;
}) {
  const load = useApiLoadError();
  const showLoadError = load.show;
  const clearLoadError = load.clear;
  useEffect(() => {
    if (error) {
      void showLoadError(error, {
        object: "die Vorschau für das Stundenkonto",
        retry: onRetry,
      });
    } else {
      clearLoadError();
    }
  }, [error, onRetry, showLoadError, clearLoadError]);

  if (error) return <LoadErrorAlert error={load.error} />;
  if (preview === null && !loading) return null;
  return (
    <InsetPanel>
      {preview === null ? (
        <p className="text-sm text-gray-500">Stundenkonto wird berechnet …</p>
      ) : (
        <>
          <DataGrid columns={1}>
            <DataField inline label="Stundenkonto aktuell">
              <span className="tabular-nums">
                {formatSignedDuration(preview.currentBalanceMinutes)}
              </span>
            </DataField>
            {preview.futureCommitmentMinutes > 0 && (
              <DataField inline label="Bereits geplanter Freizeitausgleich">
                <span className="tabular-nums">
                  {formatSignedDuration(-preview.futureCommitmentMinutes)}
                </span>
              </DataField>
            )}
            {preview.futureAdjustmentMinutes !== 0 && (
              <DataField inline label="Bereits geplante Buchungen">
                <span className="tabular-nums">
                  {formatSignedDuration(preview.futureAdjustmentMinutes)}
                </span>
              </DataField>
            )}
            <DataField inline label="Abzug für diesen Eintrag">
              <span className="tabular-nums">
                {formatSignedDuration(-preview.deductionMinutes)}
              </span>
            </DataField>
            <DataField inline label="Stundenkonto danach">
              <span
                className={`font-semibold tabular-nums ${
                  preview.projectedBalanceMinutes < 0
                    ? "text-moto-red-strong"
                    : ""
                }`}
              >
                {formatSignedDuration(preview.projectedBalanceMinutes)}
              </span>
            </DataField>
          </DataGrid>
          {preview.realizedDeductionMinutes > 0 && (
            <p className="mt-2 text-xs text-gray-500">
              Tage bis heute sind im aktuellen Stand schon enthalten.
            </p>
          )}
        </>
      )}
    </InsetPanel>
  );
}
