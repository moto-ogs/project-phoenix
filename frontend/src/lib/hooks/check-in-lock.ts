"use client";

import { useSyncExternalStore } from "react";

import { ApiError } from "~/lib/api-error";
import { PlannedStartDetailsSchema } from "~/lib/contract/problem-details.generated";
import { onSWRScopeReset } from "~/lib/swr";
import { PLANNED_START_NOT_REACHED_CODE } from "~/lib/time-tracking-api";

/**
 * „Einstempeln erst kurz vor Schichtbeginn“
 * (`operations.time_tracking_enforce_planned_start`, #3825): Ob die Schule
 * die Sperre eingeschaltet hat und ab wann sie heute öffnet, darf Personal
 * ohne `config:read` nicht lesen. Das Frontend erfährt es erst aus der
 * Ablehnung des Servers (`iot.planned_start_not_reached` mit
 * `planned_start_time`, schon um die Vorlaufzeit verschoben). Diese Antwort
 * gilt für den ganzen Tag: Bis zu der Uhrzeit lehnt der Server jedes
 * Einstempeln ab. Sie wird hier gemerkt, damit ein Einstempel-Knopf danach
 * gesperrt ist und den Grund nennt, statt dieselbe Ablehnung noch einmal
 * zu holen.
 *
 * Nur im Speicher dieses Tabs; jede Sitzungsgrenze (Abmelden, anderes Konto)
 * räumt den Eintrag mit dem SWR-Cache ab.
 */
interface CheckInLock {
  readonly date: string;
  /** Berliner Wanduhrzeit „HH:MM“, ab der der Server Einstempeln annimmt. */
  readonly opensAt: string;
}

let lock: CheckInLock | null = null;
const listeners = new Set<() => void>();

function emit(next: CheckInLock | null) {
  lock = next;
  for (const listener of listeners) listener();
}

onSWRScopeReset(() => emit(null));

/** Merkt die Ablehnung, wenn `error` die Schichtbeginn-Sperre ist. */
export function noteCheckInRefusal(error: unknown, date: string): void {
  if (
    !(error instanceof ApiError) ||
    error.code !== PLANNED_START_NOT_REACHED_CODE
  )
    return;
  const decoded = PlannedStartDetailsSchema.safeParse(error.details);
  if (!decoded.success) return;
  const opensAt = decoded.data.planned_start_time;
  if (!/^\d{2}:\d{2}$/.test(opensAt)) return;
  emit({ date, opensAt });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Uhrzeit „HH:MM“, ab der Einstempeln heute geht, solange die gemerkte Sperre
 * noch gilt; sonst `null`. `clock` ist die Berliner Wanduhr „HH:MM“
 * (`useBerlinClock`); ist sie noch leer, gilt die Sperre weiter.
 */
export function useCheckInOpensAt(today: string, clock: string): string | null {
  const current = useSyncExternalStore(
    subscribe,
    () => lock,
    () => null,
  );
  if (!current || current.date !== today) return null;
  return clock < current.opensAt ? current.opensAt : null;
}

export function _resetCheckInLockForTests(): void {
  emit(null);
}
