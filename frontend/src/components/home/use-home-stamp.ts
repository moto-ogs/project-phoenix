"use client";

import { useState } from "react";

import { useApiErrorDisplay, useToast } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import { formatTime } from "~/lib/date-helpers";
import { useOptimisticStamp } from "~/lib/hooks/use-optimistic-stamp";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { createLogger } from "~/lib/logger";
import { useSWRAuth, useTenantMutateMatching } from "~/lib/swr";
import { timeTrackingKeys } from "~/lib/swr/portal-keys";
import { staffAbsenceKeys } from "~/lib/swr/staff-keys";
import {
  DEVIATION_REASON_REQUIRED_CODE,
  PLANNED_START_NOT_REACHED_CODE,
  timeTrackingService,
} from "~/lib/time-tracking-api";
import type { StaffAbsence, WorkSession } from "~/lib/time-tracking-helpers";
import { useTenantRouter } from "~/lib/tenant-router";

const logger = createLogger({ component: "HomeStamp" });

export type HomeStampState =
  | { readonly kind: "loading" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "out" }
  | {
      readonly kind: "in";
      readonly since: string;
      readonly homeOffice: boolean;
    }
  | { readonly kind: "done"; readonly until: string };

/**
 * VORSCHLAG zu Produktentscheid 4 (Epic #8070, „neue Einstiege zu vorhandenen
 * Aktionen“): Stempelzustand und Stempeln in der Jetzt-Leiste der
 * App-Startseite. Kein neuer Datenweg: dieselbe Sitzung
 * (`timeTrackingKeys.current()`), dieselben Abwesenheiten
 * (`staffAbsenceKeys.ownList`) und derselbe Schreibweg
 * (`useOptimisticStamp`) wie die Stempeluhr auf `/time-tracking`, mit
 * denselben Toasts und demselben Nachladen der Tabellen.
 *
 * Was die Stempeluhr zusätzlich fragt, bleibt dort: Ist heute eine
 * Abwesenheit eingetragen oder will der Server einen Grund für eine
 * Abweichung vom Dienstplan, führt der Knopf in die Zeiterfassung, wo die
 * Rückfrage steht. Einstempeln hier heißt „vor Ort“; Homeoffice wählt man in
 * der Zeiterfassung.
 */
export function useHomeStamp(enabled: boolean) {
  const today = useBerlinToday();
  const router = useTenantRouter();
  const toast = useToast();
  const { show: showActionError } = useApiErrorDisplay();
  const [busy, setBusy] = useState(false);

  const current = useSWRAuth<WorkSession | null>(
    enabled ? timeTrackingKeys.current() : null,
    () => timeTrackingService.getCurrentSession(),
    { keepPreviousData: true, revalidateOnFocus: false, errorRetryCount: 1 },
  );
  const absences = useSWRAuth<StaffAbsence[]>(
    enabled ? staffAbsenceKeys.ownList(today, today) : null,
    () => timeTrackingService.getAbsences(today, today),
    { revalidateOnFocus: false, errorRetryCount: 1 },
  );
  const stampAction = useOptimisticStamp(current.data, current.mutate, today);
  // Dieselben Präfixe wie die Zeiterfassung nach einem Stempel.
  const refreshTables = useTenantMutateMatching([
    "time-tracking-table",
    "time-tracking-month-summary",
    "time-tracking-schedule-targets-",
    "time-tracking-history",
  ]);

  const session = stampAction.data;
  let state: HomeStampState;
  if (!enabled || current.error !== undefined) state = { kind: "unavailable" };
  else if (current.data === undefined) state = { kind: "loading" };
  else if (session && session.checkOutTime === null)
    state = {
      kind: "in",
      since: formatTime(session.checkInTime),
      homeOffice: session.status === "home_office",
    };
  else if (session?.checkOutTime)
    state = { kind: "done", until: formatTime(session.checkOutTime) };
  else state = { kind: "out" };

  const todayAbsence = (absences.data ?? []).some(
    (a) => a.dateStart <= today && a.dateEnd >= today,
  );
  // Wie `stampingDisabled` der Stempeluhr: ein unbekannter Stand wird nie
  // zur Stempel-Aktion.
  const disabled =
    busy ||
    stampAction.pending ||
    state.kind === "loading" ||
    absences.data === undefined;

  const toTimeTracking = () => router.push("/time-tracking");

  const run = async (checkIn: boolean) => {
    if (disabled) return;
    if (checkIn && todayAbsence) {
      // Die Stempeluhr fragt vorher nach, ob trotz Abwesenheit gestempelt
      // wird; die Frage steht dort.
      toTimeTracking();
      return;
    }
    setBusy(true);
    try {
      const outcome = await stampAction.stamp(checkIn ? "present" : null);
      if (outcome.status === "discarded") return;
      if (outcome.status === "failed") throw outcome.error;
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.code === DEVIATION_REASON_REQUIRED_CODE
      ) {
        // Der Grund wird in der Stempeluhr erfasst.
        toTimeTracking();
        return;
      }
      if (
        !(err instanceof ApiError) ||
        err.code !== PLANNED_START_NOT_REACHED_CODE
      ) {
        logger.error(checkIn ? "check_in_failed" : "check_out_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      await showActionError(err, {
        object: "die Arbeitszeit",
        retry: () => void run(checkIn),
      });
      return;
    } finally {
      setBusy(false);
    }
    void refreshTables();
    toast.success(
      checkIn ? "Du bist eingestempelt." : "Du bist ausgestempelt.",
    );
  };

  return {
    state,
    disabled,
    checkIn: () => void run(true),
    checkOut: () => void run(false),
  };
}
