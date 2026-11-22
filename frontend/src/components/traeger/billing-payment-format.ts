/**
 * Display helpers of who gets an invoice, how it is paid and by when
 * (#4689): payment method, payment term, bundling, run due dates and the
 * deviation of a family.
 */

import { formatDate } from "~/lib/date-helpers";
import type {
  BillingService,
  BillingTerms,
  FamilyBilling,
  InvoicePayment,
  PaymentMethod,
  RecipientKind,
  RunDueDate,
} from "~/lib/traeger-billing-terms-api";
import { PAYMENT_METHODS } from "~/lib/traeger-billing-terms-api";
import { traegerPath } from "~/lib/traeger-url";

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  transfer: "Überweisung",
  direct_debit: "Lastschrift",
};

export const BILLING_SERVICE_LABELS: Record<BillingService, string> = {
  care: "Monatsbeitrag Betreuung",
  meal: "Mittagessen",
  holiday: "Ferienbetreuung",
};

/** "Sofort", "1 Tag", "14 Tage". */
export function dueDaysLabel(days: number): string {
  if (days === 0) return "Sofort";
  return days === 1 ? "1 Tag" : `${days} Tage`;
}

/**
 * Which invoice carries a service: its own, or the invoice of the service
 * it travels with. `options` are the services it may travel with; `carries`
 * tells that another service may travel on its invoice. A service with
 * neither (the holiday care) always has its own invoice.
 */
export function bundleLabel(
  bundleWith: string,
  options: readonly string[],
  carries = false,
): string {
  if (bundleWith === "care") return "Auf der Rechnung der Betreuung";
  if (options.length === 0 && !carries) return "Immer eigene Rechnung";
  return "Eigene Rechnung";
}

/** The recipient kind as a short phrase; null for the contract party. */
export function recipientKindLabel(
  kind: RecipientKind | "" | undefined,
): string | null {
  if (kind === "both") return "Beide Eltern";
  if (kind === "payer") return "Abweichender Zahler";
  return null;
}

/**
 * The name line of an invoice's recipient: "An Max Muster", for both
 * parents "An Max Muster und Erika Muster".
 */
export function recipientLine(recipient: {
  readonly firstName: string;
  readonly lastName: string;
  readonly kind?: RecipientKind | "";
  readonly secondName?: string;
}): string {
  const name = `${recipient.firstName} ${recipient.lastName}`.trim();
  if (!name) return "Ohne Empfänger";
  const second = recipient.secondName?.trim();
  if (recipient.kind === "both" && second) return `An ${name} und ${second}`;
  return `An ${name}`;
}

/** "fällig am 15.12.2026". */
export function dueOnText(payment: InvoicePayment): string {
  return payment.dueOn ? `fällig am ${formatDate(payment.dueOn)}` : "";
}

/**
 * The hint beside a due date that the family set, not the run or the
 * payment term; null otherwise.
 */
export function dueSourceHint(payment: InvoicePayment): string | null {
  return payment.dueSource === "family" ? "Zahltag der Familie" : null;
}

/** "Lastschrift am 01.12.2026 · Überweisung am 15.12.2026", or null. */
export function runDueDatesText(dates: readonly RunDueDate[]): string | null {
  const ordered = PAYMENT_METHODS.flatMap((method) =>
    dates.filter((due) => due.paymentMethod === method && due.dueOn),
  );
  if (ordered.length === 0) return null;
  return ordered
    .map(
      (due) =>
        `${PAYMENT_METHOD_LABELS[due.paymentMethod]} am ${formatDate(due.dueOn ?? "")}`,
    )
    .join(" · ");
}

/** Frozen invoice deadlines, with identical method/date pairs shown once. */
export function invoiceDueDatesText(
  payments: readonly (InvoicePayment | null | undefined)[],
): string | null {
  const dates = new Map<string, RunDueDate & { readonly dueOn: string }>();
  for (const payment of payments) {
    if (payment?.dueOn && payment.method) {
      dates.set(`${payment.method}:${payment.dueOn}`, {
        paymentMethod: payment.method,
        dueOn: payment.dueOn,
      });
    }
  }
  return runDueDatesText(
    [...dates.values()].sort((a, b) => a.dueOn.localeCompare(b.dueOn)),
  );
}

/** The payment methods of a family as one line, in form order. */
export function paymentMethodsText(
  methods: readonly string[] | undefined,
): string | null {
  const known = PAYMENT_METHODS.filter((method) =>
    (methods ?? []).includes(method),
  );
  if (known.length === 0) return null;
  return known.map((method) => PAYMENT_METHOD_LABELS[method]).join(", ");
}

/**
 * The deviation that applies to an invoice: the one saved for its
 * family key, else its contract for legacy invoices without that key.
 * A payer's e-mail never identifies a family.
 */
export function findFamilyBilling(
  families: readonly FamilyBilling[],
  invoice: {
    readonly contractId: string;
    readonly familyEmail?: string;
    readonly recipientEmail: string;
    readonly recipientKind?: RecipientKind | "";
  },
): FamilyBilling | null {
  const familyEmail = invoice.familyEmail?.trim().toLowerCase();
  if (familyEmail) {
    return (
      families.find((family) => family.familyEmail === familyEmail) ?? null
    );
  }
  const byContract = families.find(
    (family) =>
      family.contractId !== "" && family.contractId === invoice.contractId,
  );
  if (byContract) return byContract;
  if (invoice.recipientKind === "payer") return null;
  const email = invoice.recipientEmail.trim().toLowerCase();
  if (!email) return null;
  return families.find((family) => family.familyEmail === email) ?? null;
}

/** The query value that says the payment page was opened from the contract. */
export const FAMILY_PAYMENT_FROM_CONTRACT = "vertrag";

/**
 * How the list of families filters by the payment method the office set
 * (#7770). The value travels in the address („?zahlung=ohne“), so the list
 * comes back filtered after a family was saved.
 */
const FAMILY_PAYMENT_FILTERS = ["ohne", "lastschrift", "ueberweisung"] as const;
export type FamilyPaymentFilter = (typeof FAMILY_PAYMENT_FILTERS)[number];

/** The filter a query value names, "" for none or an unknown one. */
export function familyPaymentFilterOf(
  value: string | null | undefined,
): FamilyPaymentFilter | "" {
  return FAMILY_PAYMENT_FILTERS.find((filter) => filter === value) ?? "";
}

/** The list of families, filtered by the payment method when given. */
export function familiesPath(filter: FamilyPaymentFilter | "" = ""): string {
  const path = traegerPath("/traeger/abrechnung/familien");
  return filter ? `${path}?zahlung=${filter}` : path;
}

/**
 * The address where recipient and payment of a contract's family are set
 * without a run (#7770). `from` says where the page leads back to: the
 * contract, or the list of families with the filter it was opened under.
 */
export function familyPaymentPath(
  contractId: string,
  from: { contract: true } | { filter?: FamilyPaymentFilter | "" } = {},
): string {
  const path = traegerPath(
    `/traeger/abrechnung/familien/zahlung/${encodeURIComponent(contractId)}`,
  );
  if ("contract" in from) return `${path}?von=${FAMILY_PAYMENT_FROM_CONTRACT}`;
  return from.filter ? `${path}?zahlung=${from.filter}` : path;
}

/**
 * What „Wie in den Abrechnungsvorgaben“ takes today: one payment method when
 * every service has the same, else the method per service; null when no
 * service names one this build knows.
 */
export function termsPaymentText(terms: BillingTerms): string | null {
  const known = terms.terms.flatMap((entry) =>
    entry.paymentMethod
      ? [{ service: entry.service, method: entry.paymentMethod }]
      : [],
  );
  const first = known[0];
  if (!first) return null;
  if (known.every((entry) => entry.method === first.method)) {
    return `${PAYMENT_METHOD_LABELS[first.method]} für alle Leistungen`;
  }
  return known
    .map(
      (entry) =>
        `${BILLING_SERVICE_LABELS[entry.service]} per ${PAYMENT_METHOD_LABELS[entry.method]}`,
    )
    .join(", ");
}
