/**
 * Client of who gets an invoice, how it is paid and by when (#4689): the
 * payment method, payment term and bundling per service, the deviation of a
 * family (another recipient, its own payment method or due day) and the due
 * dates of a calculated run per payment method.
 * Backend int64 IDs leave here as strings; calendar dates stay "YYYY-MM-DD".
 */

import { knownEnum } from "./contract/known-enum";
import type {
  InvoiceMandate as WireInvoiceMandate,
  InvoicePayment as WireInvoicePayment,
  PostalAddress as WirePostalAddress,
  RunDueDate as WireRunDueDate,
} from "./contract/shared.generated";
import type {
  RunDueDatesRequest,
  RunDueDatesResponse,
} from "./contract/traeger-billing-run-due-dates.generated";
import type {
  BillingTermsResponse,
  ServiceTermsRequest,
} from "./contract/traeger-billing-terms.generated";
import type {
  FamilyBilling as WireFamilyBilling,
  FamilyBillingRequest,
  FamilyBillingResponse,
} from "./contract/traeger-family-billing.generated";
import { traegerRequest } from "./traeger-api";

// Go does not register these sets; the contract types them as string. A value
// this build does not know stays undefined instead of passing as a known one.
const PAYMENT_METHOD_VALUES = ["transfer", "direct_debit"] as const;
const BILLING_SERVICE_VALUES = ["care", "meal", "holiday"] as const;
const RECIPIENT_KIND_VALUES = ["applicant", "both", "payer"] as const;
const DUE_SOURCE_VALUES = ["family", "run", "term"] as const;
const DEBIT_GAP_VALUES = [
  "mandate_missing",
  "creditor_missing",
  "creditor_changed",
  "mandate_expired",
] as const;
const SEQUENCE_TYPE_VALUES = ["FRST", "RCUR", "OOFF"] as const;

export type PaymentMethod = (typeof PAYMENT_METHOD_VALUES)[number];
export type BillingService = (typeof BILLING_SERVICE_VALUES)[number];
/** Who an invoice goes to; empty on an invoice issued before #4689. */
export type RecipientKind = (typeof RECIPIENT_KIND_VALUES)[number];
/** Where the due date of an invoice comes from. */
type DueSource = (typeof DUE_SOURCE_VALUES)[number];

/** The payment methods in the order the forms show them. */
export const PAYMENT_METHODS: readonly PaymentMethod[] = PAYMENT_METHOD_VALUES;

/** The payment method a value names, undefined when unknown. */
export function knownPaymentMethod(
  value: string | undefined,
): PaymentMethod | undefined {
  return knownEnum(PAYMENT_METHOD_VALUES, value);
}

/** The recipient kind a value names, or undefined for one this build does not know. */
export function knownRecipientKind(
  value: string | undefined,
): RecipientKind | undefined {
  return knownEnum(RECIPIENT_KIND_VALUES, value);
}

/** The longest payment term in days. */
export const MAX_DUE_DAYS = 120;
/** The latest day of a month a family's invoices may be due on. */
export const MAX_DUE_DAY = 28;

export interface ServiceTerms {
  readonly service: BillingService;
  /** undefined: a payment method this build does not know. */
  readonly paymentMethod: PaymentMethod | undefined;
  readonly dueDays: number;
  /** The service whose invoice carries this one's positions; "" = own invoice. */
  readonly bundleWith: string;
  /** False while the Träger keeps the defaults. */
  readonly custom: boolean;
  readonly updatedAt: string | null;
}

interface BillingServiceOption {
  readonly service: BillingService;
  /** The services whose invoice may carry this one; empty = always its own. */
  readonly bundleWith: readonly string[];
}

export interface BillingTerms {
  readonly services: readonly BillingServiceOption[];
  readonly terms: readonly ServiceTerms[];
}

export interface ServiceTermsInput {
  readonly paymentMethod: PaymentMethod;
  readonly dueDays: number;
  readonly bundleWith: string;
}

export interface PostalAddress {
  readonly street: string;
  readonly postalCode: string;
  readonly city: string;
}

/** The deviation of one family; the family is the e-mail of the contract party. */
export interface FamilyBilling {
  readonly id: string;
  readonly familyEmail: string;
  readonly contractId: string;
  /** undefined: a recipient kind this build does not know. */
  readonly recipientKind: RecipientKind | undefined;
  readonly secondFirstName: string;
  readonly secondLastName: string;
  readonly payerFirstName: string;
  readonly payerLastName: string;
  readonly payerEmail: string;
  readonly payerAddress: PostalAddress | null;
  /** "" keeps the payment method of the service; undefined: one this build does not know. */
  readonly paymentMethod: PaymentMethod | "" | undefined;
  /** Day of the month 1–28; null keeps the date of the run. */
  readonly dueDay: number | null;
  /** Number of the family in the finance system of the Träger, "" without one (#4693). */
  readonly debtorNumber: string;
  readonly updatedAt: string;
}

export interface FamilyBillingInput {
  readonly contractId: string;
  readonly recipientKind: RecipientKind;
  readonly secondFirstName: string;
  readonly secondLastName: string;
  readonly payerFirstName: string;
  readonly payerLastName: string;
  readonly payerEmail: string;
  readonly payerAddress: PostalAddress | null;
  readonly paymentMethod: PaymentMethod | "";
  readonly dueDay: number | null;
  readonly debtorNumber: string;
}

/** The due date of a run for one payment method. */
export interface RunDueDate {
  readonly paymentMethod: PaymentMethod;
  /** Calendar date "YYYY-MM-DD"; null when the backend has none. */
  readonly dueOn: string | null;
}

/**
 * Why an invoice of a family that pays by direct debit is not collected
 * (#4695). "other": a reason this build does not know; it is still not
 * collected.
 */
type DebitGap = (typeof DEBIT_GAP_VALUES)[number] | "other";

/** The SEPA mandate an invoice by direct debit is collected with (#4695). */
interface InvoiceMandate {
  readonly reference: string;
  readonly signedOn: string | null;
  readonly creditorId: string;
  readonly ibanMasked: string;
  readonly sequenceType: (typeof SEQUENCE_TYPE_VALUES)[number] | undefined;
  /** The debit comes sooner than the pre-notification days of the Träger. */
  readonly noticeShort: boolean;
}

/** How and by when an invoice is paid, with where the date came from. */
export interface InvoicePayment {
  readonly method: PaymentMethod | undefined;
  readonly dueOn: string | null;
  readonly dueSource: DueSource | undefined;
  /** The SEPA mandate a direct debit is collected with (#4695). */
  readonly mandate?: InvoiceMandate | null;
  /** Why a family that pays by direct debit is not collected; null if it is. */
  readonly debitGap?: DebitGap | null;
}

function invoiceMandateFromBackend(
  mandate: WireInvoiceMandate | undefined,
): InvoiceMandate | null {
  if (!mandate) return null;
  return {
    reference: mandate.reference,
    signedOn: mandate.signed_on,
    creditorId: mandate.creditor_id,
    ibanMasked: mandate.iban_masked,
    sequenceType: knownEnum(SEQUENCE_TYPE_VALUES, mandate.sequence_type),
    noticeShort: mandate.notice_short ?? false,
  };
}

// A service this build does not know has no form: its entry is left out.
function termsFromBackend(body: BillingTermsResponse): BillingTerms {
  return {
    services: (body.services ?? []).flatMap((option) => {
      const service = knownEnum(BILLING_SERVICE_VALUES, option.service);
      return service ? [{ service, bundleWith: option.bundle_with ?? [] }] : [];
    }),
    terms: (body.terms ?? []).flatMap((terms) => {
      const service = knownEnum(BILLING_SERVICE_VALUES, terms.service);
      if (!service) return [];
      return [
        {
          service,
          paymentMethod: knownEnum(PAYMENT_METHOD_VALUES, terms.payment_method),
          dueDays: terms.due_days,
          bundleWith: terms.bundle_with,
          custom: terms.custom,
          updatedAt: terms.updated_at,
        },
      ];
    }),
  };
}

function addressFromBackend(address: WirePostalAddress): PostalAddress {
  return {
    street: address.street,
    postalCode: address.postal_code,
    city: address.city,
  };
}

function familyFromBackend(family: WireFamilyBilling): FamilyBilling {
  return {
    id: family.id,
    familyEmail: family.family_email,
    contractId: family.contract_id === "0" ? "" : family.contract_id,
    recipientKind: knownRecipientKind(family.recipient_kind),
    secondFirstName: family.second_first_name,
    secondLastName: family.second_last_name,
    payerFirstName: family.payer_first_name,
    payerLastName: family.payer_last_name,
    payerEmail: family.payer_email,
    payerAddress: family.payer_address
      ? addressFromBackend(family.payer_address)
      : null,
    paymentMethod:
      family.payment_method === ""
        ? ""
        : knownEnum(PAYMENT_METHOD_VALUES, family.payment_method),
    dueDay: family.due_day,
    debtorNumber: family.debtor_number,
    updatedAt: family.updated_at,
  };
}

// A due date for a payment method this build does not know is left out.
export function runDueDatesFromBackend(
  dates: readonly WireRunDueDate[] | null,
): RunDueDate[] {
  return (dates ?? []).flatMap((due) => {
    const paymentMethod = knownEnum(PAYMENT_METHOD_VALUES, due.payment_method);
    return paymentMethod ? [{ paymentMethod, dueOn: due.due_on }] : [];
  });
}

export function invoicePaymentFromBackend(
  payment: WireInvoicePayment | null,
): InvoicePayment | null {
  if (!payment) return null;
  return {
    method: knownEnum(PAYMENT_METHOD_VALUES, payment.method),
    dueOn: payment.due_on,
    dueSource: knownEnum(DUE_SOURCE_VALUES, payment.due_source),
    mandate: invoiceMandateFromBackend(payment.mandate),
    debitGap: payment.debit_gap
      ? (knownEnum(DEBIT_GAP_VALUES, payment.debit_gap) ?? "other")
      : null,
  };
}

const TERMS_PATH = "/api/traeger/billing-terms";
const FAMILY_PATH = "/api/traeger/family-billing";
const DUE_DATES_PATH = "/api/traeger/billing-run-due-dates";

/** The terms of every service, the defaults where the Träger set none. */
export async function fetchBillingTerms(): Promise<BillingTerms> {
  return termsFromBackend(
    await traegerRequest<BillingTermsResponse>(TERMS_PATH),
  );
}

/** Sets the terms of one service; answers the terms of every service. */
export async function saveServiceTerms(
  service: BillingService,
  input: ServiceTermsInput,
): Promise<BillingTerms> {
  return termsFromBackend(
    await traegerRequest<BillingTermsResponse>(
      `${TERMS_PATH}/${encodeURIComponent(service)}`,
      {
        method: "PUT",
        body: {
          payment_method: input.paymentMethod,
          due_days: input.dueDays,
          bundle_with: input.bundleWith,
        } satisfies ServiceTermsRequest,
      },
    ),
  );
}

/** The deviations of the families of the Träger. */
export async function fetchFamilyBillings(): Promise<FamilyBilling[]> {
  const families = await traegerRequest<WireFamilyBilling[]>(FAMILY_PATH);
  return families.map(familyFromBackend);
}

/** The request body of a deviation; exported for its test. */
export function familyBillingBody(
  input: FamilyBillingInput,
): FamilyBillingRequest {
  const both = input.recipientKind === "both";
  const payer = input.recipientKind === "payer";
  return {
    contract_id: Number(input.contractId),
    recipient_kind: input.recipientKind,
    second_first_name: both ? input.secondFirstName.trim() : "",
    second_last_name: both ? input.secondLastName.trim() : "",
    payer_first_name: payer ? input.payerFirstName.trim() : "",
    payer_last_name: payer ? input.payerLastName.trim() : "",
    payer_email: payer ? input.payerEmail.trim() : "",
    payer_address:
      payer && input.payerAddress
        ? {
            street: input.payerAddress.street.trim(),
            postal_code: input.payerAddress.postalCode.trim(),
            city: input.payerAddress.city.trim(),
          }
        : null,
    payment_method: input.paymentMethod,
    due_day: input.dueDay,
    debtor_number: input.debtorNumber.trim(),
  };
}

/**
 * Sets the deviation of the family of a contract. Null when nothing
 * deviates any more: then the family has no deviation.
 */
export async function saveFamilyBilling(
  input: FamilyBillingInput,
): Promise<FamilyBilling | null> {
  const body = await traegerRequest<FamilyBillingResponse>(FAMILY_PATH, {
    method: "PUT",
    body: familyBillingBody(input),
  });
  return body.family ? familyFromBackend(body.family) : null;
}

/**
 * Replaces the due dates of a calculated run; a payment method without a
 * date falls back to the payment term of the service.
 */
export async function saveRunDueDates(
  kind: "care" | "holiday",
  runId: string,
  dates: readonly RunDueDate[],
): Promise<RunDueDate[]> {
  const body = await traegerRequest<RunDueDatesResponse>(
    `${DUE_DATES_PATH}/${kind}/${encodeURIComponent(runId)}`,
    {
      method: "PUT",
      body: {
        due_dates: dates.map((due) => ({
          payment_method: due.paymentMethod,
          due_on: due.dueOn,
        })),
      } satisfies RunDueDatesRequest,
    },
  );
  return runDueDatesFromBackend(body.due_dates);
}
