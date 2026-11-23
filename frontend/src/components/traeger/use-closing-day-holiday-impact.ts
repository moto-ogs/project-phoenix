"use client";

/**
 * Lädt zum Entwurf eines Träger-Schließtags, welche Ferienbuchungen er betrifft
 * (#6434). Der Dialog zeigt das vor dem Speichern; das Speichern bestätigt mit
 * dem Zeichen der zuletzt gezeigten Vorschau. Eine ältere Antwort überschreibt
 * nie eine neuere. Beim Ändern und Löschen schickt die Vorschau den
 * gespeicherten Schließtag mit; dann nennt sie auch die Tage, die wieder
 * öffnen (#6457). Das Löschen braucht keinen Entwurf.
 */

import { useCallback, useState } from "react";

import type { ClosingDayDraft } from "~/components/planning/closing-day-modal";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import {
  previewTraegerClosingDayHolidayBookings,
  type TraegerClosingDay,
} from "~/lib/traeger-closing-days";
import { useDebounce } from "~/lib/use-debounce";

/** Wartezeit nach der letzten Änderung, bevor die Vorschau lädt. */
const PREVIEW_DELAY_MS = 300;

function completeDraft(
  draft: ClosingDayDraft | null,
): draft is ClosingDayDraft {
  return (
    draft !== null &&
    draft.startDate !== "" &&
    draft.endDate !== "" &&
    draft.endDate >= draft.startDate &&
    draft.schoolIds.length > 0
  );
}

/**
 * `saved` ist der gespeicherte Schließtag beim Ändern oder Löschen, `null`
 * beim Anlegen. Mit `mode: "delete"` lädt die Vorschau zum Löschen von
 * `saved`, sobald `open` gilt.
 */
export function useClosingDayHolidayImpact(
  open: boolean,
  saved: TraegerClosingDay | null = null,
  mode: "save" | "delete" = "save",
) {
  const [draft, setDraft] = useState<ClosingDayDraft | null>(null);
  const deleting = mode === "delete";
  const request: ClosingDayDraft | null = deleting ? saved : draft;
  const requested = open && completeDraft(request) ? request : null;
  // The preview loads once the draft rested; until then it is pending.
  const rested = useDebounce(requested, deleting ? 0 : PREVIEW_DELAY_MS);
  const key =
    requested !== null && rested === requested
      ? traegerKeys.closingDayImpact(requested, saved, deleting)
      : null;
  // Die Vorschau kommt aus dem geteilten Cache (ADR 0311): das Speichern
  // bestätigt mit ihrem Zeichen, und der Server lehnt ab, wenn sich die
  // Buchungen seither geändert haben; dann lädt `reload` die neue Vorschau.
  const {
    data: impact,
    loading,
    error,
    reload,
  } = useTraegerResource(
    key,
    () =>
      requested
        ? previewTraegerClosingDayHolidayBookings(
            { ...requested, reason: "" },
            saved ? { closingDay: saved, delete: deleting } : undefined,
          )
        : Promise.reject(new Error("no closing day draft")),
    "die gebuchte Ferienbetreuung",
  );
  const pending = requested !== null && (key === null || loading);

  const onDraftChange = useCallback(
    (next: ClosingDayDraft) => setDraft(next),
    [],
  );

  return {
    onDraftChange,
    impact: requested ? impact : null,
    loading: pending,
    error: requested ? error : null,
    reload,
    /** Das Speichern wartet, bis die Vorschau zum Entwurf geladen ist. */
    blocked: requested !== null && (pending || impact === null),
  };
}
