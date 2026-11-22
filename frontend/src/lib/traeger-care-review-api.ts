import { bffFile, bffJson } from "~/lib/bff-fetch";
/**
 * Client of the review of a monthly run before its release (#5916): the
 * schools a new run may bill, the invoice date, the exclusion of single
 * invoices and the review list. Backend int64 IDs leave here as strings;
 * calendar dates stay "YYYY-MM-DD".
 */

import type * as traegerCareBillingRunsContract from "./contract/traeger-care-billing-runs.generated";
import { type BillingFile, billingFile } from "./traeger-billing-api";
import {
  type CareInvoice,
  type CareRunDetail,
  detailFromBackend,
} from "./traeger-care-billing-api";

/** A school of the Träger for a new run, with the open run that bills it. */
export interface CareRunSchool {
  readonly id: string;
  readonly name: string;
  /** The open run of the month that already bills the school. */
  readonly openRunId: string | null;
}

export type CareReviewFormat = "pdf" | "xlsx" | "csv";

/** The schools a new run of `month` ("YYYY-MM-01") may bill. */
export async function fetchCareRunSchools(
  month: string,
): Promise<CareRunSchool[]> {
  const schools = await bffJson(
    "org",
    "GET /traeger/care-billing-runs/schools",
    {
      query: { month },
    },
  );
  return (schools ?? []).map((school) => ({
    id: school.id,
    name: school.name,
    openRunId: school.open_run_id,
  }));
}

/** Sets the invoice date of a calculated run; null takes the release day. */
export async function setCareRunInvoiceDate(
  runId: string,
  invoiceDate: string | null,
): Promise<CareRunDetail> {
  return detailFromBackend(
    await bffJson("org", "PUT /traeger/care-billing-runs/{id}/invoice-date", {
      params: { id: runId },
      body: {
        invoice_date: invoiceDate,
      } satisfies traegerCareBillingRunsContract.CareInvoiceDateRequest,
    }),
  );
}

/** One invoice of a run: its contract and what it bills (#6346). */
export interface CareInvoiceRef {
  readonly contractId: string;
  readonly service: CareInvoice["service"];
}

/**
 * Leaves one invoice out of the release, with a reason. Only this invoice:
 * the other invoice of the same contract (care or Mensa) stays (#6346).
 */
export async function excludeCareInvoice(
  runId: string,
  invoice: CareInvoiceRef,
  reason: string,
): Promise<CareRunDetail> {
  return detailFromBackend(
    await bffJson("org", "POST /traeger/care-billing-runs/{id}/exclusions", {
      params: { id: runId },
      body: {
        contract_id: invoice.contractId,
        service: invoice.service,
        reason,
      } satisfies traegerCareBillingRunsContract.CareExclusionRequest,
    }),
  );
}

/** Takes one excluded invoice back into the release; answers the run. */
export async function includeCareInvoice(
  runId: string,
  invoice: CareInvoiceRef,
): Promise<CareRunDetail> {
  return detailFromBackend(
    await bffJson("org", "POST /traeger/care-billing-runs/{id}/inclusions", {
      params: { id: runId },
      body: {
        contract_id: invoice.contractId,
        service: invoice.service,
      } satisfies traegerCareBillingRunsContract.CareInclusionRequest,
    }),
  );
}

/** The review list of the preview, without invoice numbers. */
export async function downloadCareRunReview(
  runId: string,
  format: CareReviewFormat,
): Promise<BillingFile> {
  return billingFile(
    bffFile("org", "GET /traeger/care-billing-runs/{id}/review-export", {
      params: { id: runId },
      query: { format },
    }),
    `pruefliste.${format}`,
  );
}
