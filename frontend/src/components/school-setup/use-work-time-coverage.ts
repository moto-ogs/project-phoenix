"use client";

import { useSWRAuth } from "~/lib/swr";
import { payrollKeys } from "~/lib/swr/portal-keys";
import type { PayrollTargetCoverage } from "~/lib/payroll-api";

/**
 * Wie viele Personen mit Zeitkonto noch kein Soll haben (#6919): dieselbe
 * Zahl wie unter „Abrechnung“ und über den Zeitkonten (#6890). Lädt erst,
 * wenn die Checkliste den Schritt zeigt; der Abruf kommt nach, damit er
 * nicht im Bündel jeder Seite liegt.
 */
export function useWorkTimeCoverage(enabled: boolean): {
  coverage: PayrollTargetCoverage | undefined;
  error: unknown;
  /** Lädt neu und liefert die Zahl; scheitert mit dem Fehler des Abrufs. */
  retry: () => Promise<PayrollTargetCoverage | undefined>;
} {
  const { data, error, mutate } = useSWRAuth<PayrollTargetCoverage>(
    enabled ? payrollKeys.targetCoverage() : null,
    async () => {
      const { fetchPayrollTargetCoverage } = await import("~/lib/payroll-api");
      return fetchPayrollTargetCoverage();
    },
    { keepPreviousData: false, shouldRetryOnError: false },
  );
  return { coverage: data, error, retry: () => mutate() };
}
