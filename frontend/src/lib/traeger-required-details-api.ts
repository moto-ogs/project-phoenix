import { bffJson } from "~/lib/bff-fetch";

/**
 * A detail the Träger still has to enter before its contracts, invoices and
 * notices go out (#7177). The backend names only those whose module a
 * school of the Träger books.
 */
const REQUIRED_DETAILS = [
  "letterhead",
  "bank_account",
  "sepa_creditor",
  "number_range_holiday",
  "number_range_care",
] as const;

export type TraegerRequiredDetail = (typeof REQUIRED_DETAILS)[number];

const KNOWN: ReadonlySet<string> = new Set(REQUIRED_DETAILS);

function isRequiredDetail(value: string): value is TraegerRequiredDetail {
  return KNOWN.has(value);
}

/** The missing details in the backend's order; unknown names are left out. */
export async function fetchTraegerRequiredDetails(): Promise<
  TraegerRequiredDetail[]
> {
  const response = await bffJson("org", "GET /traeger/required-details/");
  return (response.missing ?? []).filter(isRequiredDetail);
}
