"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

import { berlinTodayISO } from "~/lib/date-helpers";

// A seed boundary supplies the day of its HTML for hydration only.
export const RenderedBerlinDay = createContext<string | undefined>(undefined);

/**
 * The current Berlin calendar day as "YYYY-MM-DD", re-rendering the caller when
 * the day rolls over at Berlin midnight. Use instead of a bare
 * `berlinTodayISO()` call on any page that can stay mounted across midnight
 * (e.g. the meal plan) so the selected week and the "today" highlight follow the
 * date without a manual reload — a bare call is only re-read when something else
 * happens to re-render.
 *
 * Polls once a minute: `berlinTodayISO()` is cheap and the setState updater
 * no-ops when the value is unchanged, so a mounted page costs one string compare
 * per minute and re-renders only on the actual rollover.
 */
export function useBerlinToday(): string {
  return useBerlinTodayWithRefresh()[0];
}

/** Also checks the day on demand, before continuing a dated read. */
export function useBerlinTodayWithRefresh() {
  const [today, setToday] = useState(berlinTodayISO);
  const refresh = useCallback(() => {
    const now = berlinTodayISO();
    setToday(now);
    return now;
  }, []);
  useEffect(() => {
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, [refresh]);
  const renderedDay = useContext(RenderedBerlinDay);
  return [renderedDay ?? today, refresh] as const;
}
