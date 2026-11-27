import { bffJson } from "~/lib/bff-fetch";
/**
 * Client of the invoices and amounts per family in the Träger portal
 * (#4691). A family is the recipient of its documents; its ID is the ID of
 * its first document. moto does not match payments: "open" is what the
 * invoices ask for after their Storno and Gutschriften.
 * Money stays whole cent. Backend int64 IDs leave here as strings.
 */

import {
  type BillingDocumentKind,
  knownDocumentKind,
} from "./traeger-billing-api";
import { familyKeyEmail } from "~/lib/family-key";
import { knownEnum } from "./contract/known-enum";
import type * as traegerBillingFamiliesContract from "./contract/traeger-billing-families.generated";
import {
  type DebtorNumberFormat,
  debtorNumberFormatOf,
} from "./debtor-number-format";
import {
  type PaymentMethod,
  knownPaymentMethod,
} from "./traeger-billing-terms-api";

// Go does not register these sets; the contract types them as string. A value
// this build does not know stays undefined instead of passing as a known one.
const PAYMENT_KIND_VALUES = ["family", "cost_bearer", "exempt"] as const;
const INVOICE_STATUS_VALUES = [
  "open",
  "partly_credited",
  "credited",
  "cancelled",
  "nothing_due",
] as const;
const SERVICE_VALUES = ["holiday", "care"] as const;

/** Who pays an invoice. */
type BillingPaymentKind = (typeof PAYMENT_KIND_VALUES)[number];

export interface BillingPayment {
  /** undefined: a kind this build does not know. */
  readonly kind: BillingPaymentKind | undefined;
  /** The name the invoice copied; empty unless a cost bearer pays. */
  readonly costBearerName: string;
}

/** What an invoice still asks for. */
export type BillingInvoiceStatus = (typeof INVOICE_STATUS_VALUES)[number];

export interface BillingAmounts {
  readonly issuedCents: number;
  readonly cancelledCents: number;
  readonly creditedCents: number;
  readonly openCents: number;
}

export interface BillingFamily extends BillingAmounts {
  readonly id: string;
  readonly recipientFirstName: string;
  readonly recipientLastName: string;
  readonly recipientEmail: string;
  readonly debtorNumbers: readonly string[];
  readonly payments: readonly BillingPayment[];
  /** The payment methods of its invoices (#4689), in form order. */
  readonly paymentMethods?: readonly PaymentMethod[];
  readonly invoiceCount: number;
  readonly openInvoiceCount: number;
  readonly documentCount: number;
  /** Calendar date "YYYY-MM-DD"; empty without a document. */
  readonly lastIssuedOn: string;
  /** The key of the family, the address of its registrations (#6692). */
  readonly familyEmail: string;
  /** The debtor number the family has at the Träger; "" for none. */
  readonly familyDebtorNumber: string;
  /** No care contract and no monthly invoice: known from the holiday care. */
  readonly holidayOnly: boolean;
  /** The family has an issued document, so it opens a page of its own. */
  readonly hasDocuments: boolean;
  /**
   * The payment method the office set for the family (#7770): what its next
   * invoice takes. "" or absent while the Abrechnungsvorgaben decide, also
   * for one this build does not know.
   */
  readonly familyPaymentMethod?: PaymentMethod | "";
  /**
   * A contract of the family, absent or "" without one: it opens the
   * family's recipient and payment.
   */
  readonly contractId?: string;
  /**
   * The family is known by its contract alone: no document, no number and
   * no deviation yet. Its number is set with its recipient and payment,
   * which create its row; the number dialog of the list needs that row.
   */
  readonly contractOnly?: boolean;
  /**
   * The children and their own numbers when the Träger keeps a number per
   * child (#7007); absent when it keeps one per payer.
   */
  readonly children?: readonly FamilyChild[];
}

/** Whom the Träger's debtor numbers name (#7007). */
type DebtorNumberScope = "payer" | "child";

/** A child of a family with its own debtor number, "" for none (#7007). */
export interface FamilyChild {
  readonly firstName: string;
  readonly lastName: string;
  /** Calendar date "YYYY-MM-DD"; null without one. */
  readonly birthDate: string | null;
  readonly debtorNumber: string;
}

/** A family with its children as the list of children answers it. */
export interface FamilyChildNumbers {
  /** A contract of the family, absent for a family known only by a number. */
  readonly contractId?: string;
  readonly familyEmail: string;
  readonly recipientFirstName: string;
  readonly recipientLastName: string;
  readonly children: readonly FamilyChild[];
}

/** The format of the Träger's debtor numbers and whom they name. */
export interface DebtorNumberSettings {
  readonly format: DebtorNumberFormat;
  readonly scope: DebtorNumberScope;
}

export interface BillingFamilyDocument {
  readonly id: string;
  /** Holiday care or monthly care (#4689); the run belongs to it. */
  readonly service?: (typeof SERVICE_VALUES)[number];
  readonly runId: string;
  /** undefined: a kind this build does not know. */
  readonly kind: BillingDocumentKind | undefined;
  readonly number: string;
  /** Calendar dates "YYYY-MM-DD"; null when the backend has none. */
  readonly issuedOn: string | null;
  readonly periodName: string;
  readonly serviceFrom: string | null;
  readonly serviceUntil: string | null;
  /** The number of the invoice a Storno or Gutschrift refers to. */
  readonly referenceNumber: string;
  readonly reason: string;
  readonly childNames: readonly string[];
  readonly debtorNumber: string;
  /** Negative for a Storno or Gutschrift. */
  readonly totalCents: number;
  /** Set for an invoice only. */
  readonly payment: BillingPayment | null;
  readonly status: BillingInvoiceStatus | null;
  readonly openCents: number;
  /** How and by when it is paid (#4689); "" and null on documents issued before. */
  readonly paymentMethod?: PaymentMethod | "";
  readonly dueOn?: string | null;
}

export interface BillingFamilyDetail extends BillingFamily {
  /** Newest first. */
  readonly documents: readonly BillingFamilyDocument[];
}

function paymentFromBackend(
  payment: traegerBillingFamiliesContract.BillingPayment,
): BillingPayment {
  return {
    kind: knownEnum(PAYMENT_KIND_VALUES, payment.kind),
    costBearerName: payment.cost_bearer_name,
  };
}

/** The payment methods this build knows; an unknown one is left out. */
function knownPaymentMethods(
  methods: readonly string[] | null,
): PaymentMethod[] {
  return (methods ?? []).flatMap((method) => {
    const known = knownPaymentMethod(method);
    return known ? [known] : [];
  });
}

/** A wire ID as the pages use it: "" where the backend sends 0 for none. */
function idOrNone(id: string): string {
  return id === "0" ? "" : id;
}

function familyFromBackend(
  family: traegerBillingFamiliesContract.BillingFamily,
): BillingFamily {
  return {
    id: family.id,
    recipientFirstName: family.recipient_first_name,
    recipientLastName: family.recipient_last_name,
    recipientEmail: family.recipient_email,
    debtorNumbers: family.debtor_numbers ?? [],
    payments: (family.payments ?? []).map(paymentFromBackend),
    paymentMethods: knownPaymentMethods(family.payment_methods),
    invoiceCount: family.invoice_count,
    openInvoiceCount: family.open_invoice_count,
    documentCount: family.document_count,
    lastIssuedOn: family.last_issued_on ?? "",
    familyEmail: family.family_email,
    familyDebtorNumber: family.family_debtor_number,
    holidayOnly: family.holiday_only,
    hasDocuments: family.id !== "0",
    familyPaymentMethod: knownPaymentMethod(family.family_payment_method) ?? "",
    contractId: idOrNone(family.contract_id),
    issuedCents: family.issued_cents,
    cancelledCents: family.cancelled_cents,
    creditedCents: family.credited_cents,
    openCents: family.open_cents,
  };
}

function documentFromBackend(
  document: traegerBillingFamiliesContract.BillingFamilyDocument,
): BillingFamilyDocument {
  return {
    id: document.id,
    service: knownEnum(SERVICE_VALUES, document.service),
    runId: document.run_id,
    kind: knownDocumentKind(document.kind),
    number: document.number,
    issuedOn: document.issued_on,
    periodName: document.period_name,
    serviceFrom: document.service_from,
    serviceUntil: document.service_until,
    referenceNumber: document.reference_number,
    reason: document.reason,
    childNames: document.child_names ?? [],
    debtorNumber: document.debtor_number,
    totalCents: document.total_cents,
    payment: document.payment ? paymentFromBackend(document.payment) : null,
    status: knownEnum(INVOICE_STATUS_VALUES, document.status) ?? null,
    openCents: document.open_cents,
    paymentMethod:
      document.payment_method === ""
        ? ""
        : knownPaymentMethod(document.payment_method),
    dueOn: document.due_on,
  };
}

/**
 * The families with an issued document or a number of their own, also the
 * families of the holiday care before their first invoice (#6692), by name.
 */
export async function fetchBillingFamilies(): Promise<BillingFamily[]> {
  const families = await bffJson("org", "GET /traeger/billing-families/");
  return families.map(familyFromBackend);
}

/** One family with every document, the newest first. */
export async function fetchBillingFamily(
  id: string,
): Promise<BillingFamilyDetail> {
  const family = await bffJson("org", "GET /traeger/billing-families/{id}", {
    params: { id },
  });
  return {
    ...familyFromBackend(family),
    documents: (family.documents ?? []).map(documentFromBackend),
  };
}

/**
 * Sets the debtor number of a family by its address (#6692), also of a
 * family without a care contract; "" removes it. Returns the number it has.
 */
export async function setFamilyDebtorNumber(
  familyEmail: string,
  debtorNumber: string,
): Promise<string> {
  const saved = await bffJson(
    "org",
    "PUT /traeger/billing-families/debtor-number",
    {
      body: {
        family_email: familyEmail,
        debtor_number: debtorNumber,
      } satisfies traegerBillingFamiliesContract.FamilyDebtorNumberRequest,
    },
  );
  return saved.debtor_number;
}

/**
 * The format of the Träger's debtor numbers (#6675), so a field can name it
 * and check it before the backend does, and whom they name (#7007).
 */
export async function fetchDebtorNumberSettings(): Promise<DebtorNumberSettings> {
  return mapDebtorNumberSettings(
    await bffJson("org", "GET /traeger/billing-families/debtor-number-format"),
  );
}

export function mapDebtorNumberSettings(
  raw: traegerBillingFamiliesContract.debtorNumberSettings,
): DebtorNumberSettings {
  return {
    format: debtorNumberFormatOf(raw),
    // "payer" is the backend's default scope (DebtorNumberScopePayer).
    scope: raw.scope === "child" ? "child" : "payer",
  };
}

function childFromBackend(
  child: traegerBillingFamiliesContract.FamilyChild,
): FamilyChild {
  return {
    firstName: child.first_name,
    lastName: child.last_name,
    birthDate: child.birth_date,
    debtorNumber: child.debtor_number,
  };
}

/**
 * Every family with a care contract or a child's number, with its children
 * and their own numbers (#7007).
 */
export async function fetchFamilyChildren(
  numbers = true,
): Promise<FamilyChildNumbers[]> {
  // Without numbers the backend names the families with a contract only:
  // no child, no number, no entry in a number's trail (#7770).
  const families = await bffJson(
    "org",
    "GET /traeger/billing-families/children",
    { query: { numbers: numbers ? undefined : false } },
  );
  return families.map((family) => ({
    contractId: idOrNone(family.contract_id),
    familyEmail: family.family_email,
    recipientFirstName: family.recipient_first_name,
    recipientLastName: family.recipient_last_name,
    children: (family.children ?? []).map(childFromBackend),
  }));
}

/**
 * Sets the number of a child of a family (#7007); "" removes it. Returns
 * the child with the number it has.
 */
export async function setChildDebtorNumber(
  familyEmail: string,
  child: FamilyChild,
  debtorNumber: string,
): Promise<FamilyChild> {
  const saved = await bffJson(
    "org",
    "PUT /traeger/billing-families/child-debtor-number",
    {
      body: {
        family_email: familyEmail,
        child_first_name: child.firstName,
        child_last_name: child.lastName,
        child_birth_date: child.birthDate,
        debtor_number: debtorNumber,
      } satisfies traegerBillingFamiliesContract.ChildDebtorNumberRequest,
    },
  );
  return childFromBackend(saved);
}

/**
 * The families of the list with their children (#7007): each family takes
 * its children by its address, and a family with a contract or a child's
 * number but no document and no number of its own joins the list. A Träger
 * that keeps the number per payer (`perChild` false) gets the same families
 * and their contract without the children (#7770): a family with a contract
 * stands in the list before its first invoice, so its payment can be set.
 */
export function withFamilyChildren(
  families: readonly BillingFamily[],
  children: readonly FamilyChildNumbers[],
  perChild = true,
): BillingFamily[] {
  const byEmail = new Map(
    children.map((family) => [family.familyEmail, family]),
  );
  const listed = families.map((family) => {
    const known = byEmail.get(family.familyEmail);
    return {
      ...family,
      // The family's longest-running contract wins: what is saved goes with
      // the contract it was saved through. A family without a contract in
      // force keeps the contract of its deviation.
      contractId: known?.contractId || family.contractId || "",
      ...(perChild ? { children: known?.children ?? [] } : {}),
    };
  });
  const known = new Set(families.map((family) => family.familyEmail));
  for (const family of children) {
    if (known.has(family.familyEmail)) continue;
    // Known only by a child's number: without the children it has nothing
    // to show and no contract to open, so it joins only a per-child list.
    if (!perChild && !family.contractId) continue;
    listed.push({
      id: "0",
      recipientFirstName: family.recipientFirstName,
      recipientLastName: family.recipientLastName,
      recipientEmail: familyKeyEmail(family.familyEmail),
      debtorNumbers: [],
      payments: [],
      paymentMethods: [],
      invoiceCount: 0,
      openInvoiceCount: 0,
      documentCount: 0,
      lastIssuedOn: "",
      familyEmail: family.familyEmail,
      familyDebtorNumber: "",
      holidayOnly: false,
      hasDocuments: false,
      familyPaymentMethod: "",
      contractId: family.contractId ?? "",
      contractOnly: Boolean(family.contractId),
      ...(perChild ? { children: family.children } : {}),
      issuedCents: 0,
      cancelledCents: 0,
      creditedCents: 0,
      openCents: 0,
    });
  }
  return listed;
}
