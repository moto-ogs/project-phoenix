import { traegerRequest } from "./traeger-api";

/**
 * A detail the Träger still has to enter before its contracts, invoices and
 * notices go out (#7177). The backend names only those whose module a
 * school of the Träger books.
 */
export type TraegerRequiredDetail =
  | "letterhead"
  | "bank_account"
  | "sepa_creditor"
  | "number_range_holiday"
  | "number_range_care";

const KNOWN: ReadonlySet<string> = new Set<TraegerRequiredDetail>([
  "letterhead",
  "bank_account",
  "sepa_creditor",
  "number_range_holiday",
  "number_range_care",
]);

function isRequiredDetail(value: string): value is TraegerRequiredDetail {
  return KNOWN.has(value);
}

/** The missing details in the backend's order; unknown names are left out. */
export async function fetchTraegerRequiredDetails(): Promise<
  TraegerRequiredDetail[]
> {
  const response = await traegerRequest<{ missing: string[] | null }>(
    "/api/traeger/required-details",
  );
  return (response.missing ?? []).filter(isRequiredDetail);
}
