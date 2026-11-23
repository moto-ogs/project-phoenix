"use client";

// Stundenkonto-Vorschau für einen geplanten Freizeitausgleich (#2873).
// Informiert vor dem Eintragen; ein negativer Stand wird bestätigt, nicht
// verhindert. Seit #3256 Teil des gemeinsamen Dialogs „Abwesenheit eintragen".
// Die Bestätigung prüft der Server unter seiner Sperre (ADR 0311): eine
// Vorschau aus dem Cache, die kein Minus zeigte, bucht kein Minus.

import { useEffect } from "react";

import { formatSignedDuration } from "~/components/staff/staff-time-views";
import { DataField, DataGrid } from "~/components/ui/data-field";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { useApiLoadError } from "~/contexts/ToastContext";
import { useReadDraft } from "~/lib/swr/read-draft";
import { staffAbsenceKeys } from "~/lib/swr/staff-keys";
import {
  staffAbsenceService,
  type CompTimeBalancePreview,
} from "~/lib/staff-api";
import { InsetPanel } from "~/components/ui/inset-panel";

/**
 * The projection a comp time booking confirms (ADR 0311). The draft is the
 * confirmation of a minus: unconfirmed, the projection follows a newer
 * read; confirmed, it holds the projection on screen, and the booking sends
 * its fingerprint. After a refusal the stored projection shows and the
 * confirmation is gone. A new range is a new opening.
 */
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
}) {
  const active = enabled && Boolean(dateStart && dateEnd);
  const draft = useReadDraft<CompTimeBalancePreview, boolean, string>({
    key: active
      ? staffAbsenceKeys.compTimePreview(staffId, dateStart, dateEnd, halfDay)
      : null,
    fetcher: () =>
      staffAbsenceService.getCompTimePreview(staffId, {
        dateStart,
        dateEnd,
        halfDay,
      }),
    token: (preview) => preview.fingerprint,
    toDraft: () => false,
    // The dialog closes after a booking: no read of the old projection.
    answer: (_saved, shown) => shown,
  });
  // Der Block zeigt den Ladefehler (das Panel); ohne Vorschau bucht der
  // Dialog keinen Freizeitausgleich, denn der Server prüft genau die gezeigte
  // Projektion. Ein gescheitertes Lesen zeigt keine alte Projektion als
  // Grundlage einer Bestätigung.
  const failed = draft.status === "loadFailed";
  return {
    ...draft,
    preview: failed ? null : (draft.base ?? null),
    loading: active && draft.status === "loading",
    error: failed ? draft.error : null,
    reload: draft.retryLoad,
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
