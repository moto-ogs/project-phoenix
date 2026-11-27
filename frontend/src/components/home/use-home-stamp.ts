"use client";

import { useState } from "react";

import { useBerlinClock } from "~/components/home/home-card-rows";
import { useApiErrorDisplay, useToast } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import { formatTime } from "~/lib/date-helpers";
import { useCheckInOpensAt } from "~/lib/hooks/check-in-lock";
import { useOptimisticStamp } from "~/lib/hooks/use-optimistic-stamp";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { createLogger } from "~/lib/logger";
import { useOwnTimeRefresh } from "~/lib/hooks/use-own-time-refresh";
import { useSWRAuth } from "~/lib/swr";
import { timeTrackingKeys } from "~/lib/swr/portal-keys";
import {
  PLANNED_START_NOT_REACHED_CODE,
  readStampDeviation,
} from "~/lib/time-tracking-api";
import { useTenantRouter } from "~/lib/tenant-router";
import { readOwnClock } from "~/app/[tenant]/(protected)/time-tracking/own-clock-read";

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
 * App-Startseite. Kein neuer Datenweg: dieselbe Leseansicht der Stempeluhr
 * (`timeTrackingKeys.overview(today)`, mit Sitzung und heutiger
 * Abwesenheit) und derselbe Schreibweg (`useOptimisticStamp`) wie die
 * Stempeluhr auf `/time-tracking`, mit denselben Toasts und demselben
 * Nachladen der eigenen Zeiterfassung.
 *
 * Was die Stempeluhr zusätzlich fragt, bleibt dort: Ist heute eine
 * Abwesenheit eingetragen oder will der Server einen Grund für eine
 * Abweichung vom Dienstplan, führt der Knopf in die Zeiterfassung, wo die
 * Rückfrage steht. Einstempeln hier heißt „vor Ort“; Homeoffice wählt man in
 * der Zeiterfassung. Stempelt die Person nur am NFC-Terminal (#8024), gibt
 * es hier keinen Stempelknopf.
 */
export function useHomeStamp(enabled: boolean) {
  const today = useBerlinToday();
  const router = useTenantRouter();
  const toast = useToast();
  const { show: showActionError } = useApiErrorDisplay();
  const [busy, setBusy] = useState(false);

  const current = useSWRAuth(
    enabled ? timeTrackingKeys.overview(today) : null,
    () => readOwnClock(today),
    { keepPreviousData: false, revalidateOnFocus: false, errorRetryCount: 1 },
  );
  const stampAction = useOptimisticStamp(
    current.data?.session,
    (session) => {
      void current.mutate(
        (previous) =>
          previous ? { ...previous, session, breaks: [] } : undefined,
        { revalidate: false },
      );
    },
    today,
  );
  // Dasselbe Nachladen wie die Stempeluhr nach einem Stempel.
  const refresh = useOwnTimeRefresh();

  const session = stampAction.data;
  let state: HomeStampState;
  if (
    !enabled ||
    current.error !== undefined ||
    current.data?.terminalOnlyStamping === true
  )
    state = { kind: "unavailable" };
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

  const todayAbsence = Boolean(current.data?.absence);
  // Wie `stampingDisabled` der Stempeluhr: ein unbekannter Stand wird nie
  // zur Stempel-Aktion.
  const disabled = busy || stampAction.pending || state.kind === "loading";

  // „Einstempeln erst kurz vor Schichtbeginn“: Hat der Server heute schon
  // „noch nicht“ gesagt (hier oder in der Zeiterfassung), bleibt Einstempeln
  // bis zu der genannten Uhrzeit gesperrt und nennt sie. Vorab wissen kann
  // es das Frontend nicht: Die Einstellung braucht `config:read`.
  const opensAt = useCheckInOpensAt(today, useBerlinClock());
  const checkInBlockedReason =
    opensAt === null
      ? null
      : `Einstempeln geht heute erst ab ${opensAt} Uhr. So hat es deine Schule eingestellt.`;

  const toTimeTracking = () => router.push("/time-tracking");

  const run = async (checkIn: boolean) => {
    if (disabled || (checkIn && checkInBlockedReason !== null)) return;
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
      if (readStampDeviation(err) !== null) {
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
    void refresh("time");
    toast.success(
      checkIn ? "Du bist eingestempelt." : "Du bist ausgestempelt.",
    );
  };

  return {
    state,
    disabled,
    /** Grund, warum Einstempeln gerade nicht geht; sonst `null`. */
    checkInBlockedReason,
    checkIn: () => void run(true),
    checkOut: () => void run(false),
  };
}
