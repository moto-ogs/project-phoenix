"use client";

import { useTraegerResource } from "./use-traeger-resource";
import {
  type DebtorNumberFormat,
  NO_DEBTOR_NUMBER_FORMAT,
} from "~/lib/debtor-number-format";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import {
  type DebtorNumberSettings,
  fetchDebtorNumberSettings,
} from "~/lib/traeger-billing-families-api";

interface DebtorNumberSettingsState {
  /** The settings, null until read or after a failed read. */
  readonly settings: DebtorNumberSettings | null;
  /** The failed read; null while it loads or once it succeeded. */
  readonly error: unknown;
  /** Reads the settings again. */
  readonly reload: () => void;
}

/**
 * The format of the Träger's debtor numbers (#6675) and whom they name
 * (#7007). A failed read stays unresolved: guessing the scope would show
 * the numbers of the wrong store (#7007), so the page shows the error.
 */
export function useDebtorNumberSettings(): DebtorNumberSettingsState {
  const { data, failure, reload } = useTraegerResource(
    traegerKeys.debtorNumberSettings(),
    fetchDebtorNumberSettings,
    "die Einstellungen der Debitorennummer",
  );
  return { settings: data, error: failure ?? null, reload };
}

/**
 * The format of the Träger's debtor numbers (#6675) for a family's fields.
 * It only shapes the field: without it the backend still checks every
 * number, so a failed read keeps the plain hint.
 */
export function useDebtorNumberFormat(): DebtorNumberFormat {
  return useDebtorNumberSettings().settings?.format ?? NO_DEBTOR_NUMBER_FORMAT;
}
