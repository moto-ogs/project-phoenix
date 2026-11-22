import { bffFile, bffJson } from "~/lib/bff-fetch";
/**
 * Client of the monthly contribution of the care contract (#4684): the
 * price list of the Träger (a monthly price per booked weekday, module and
 * school) and the monthly runs that bill a month by the contract in force.
 * Money stays whole cent. Backend int64 IDs leave here as strings; calendar
 * dates stay "YYYY-MM-DD".
 */

import {
  type CareMealChanged,
  type CareMealGap,
  type CareMealPosition,
  type CareMealUnbilled,
  mealChangedFromBackend,
  mealGapsFromBackend,
  mealPositionsFromBackend,
  mealUnbilledFromBackend,
} from "./traeger-care-meal-api";
import {
  type MailOutcome,
  type MailProviderBlock,
  knownMailOutcome,
  knownMailProviderBlock,
} from "~/lib/email-delivery-status";
import { knownEnum } from "./contract/known-enum";
import { requiredDay } from "./contract/required-day";
import type * as sharedContract from "./contract/shared.generated";
import type * as traegerCareBillingRunsContract from "./contract/traeger-care-billing-runs.generated";
import type * as traegerCareTariffsContract from "./contract/traeger-care-tariffs.generated";
import {
  type InvoicePayment,
  type PostalAddress,
  type RecipientKind,
  type RunDueDate,
  invoicePaymentFromBackend,
  knownRecipientKind,
  runDueDatesFromBackend,
} from "./traeger-billing-terms-api";
import {
  type BillingFile,
  type LetterMailStatus,
  billingFile,
  knownLetterMailStatus,
} from "./traeger-billing-api";

// Go does not register these sets; the contract types them as string. A value
// this build does not know stays undefined instead of passing as a known one.
const WEEKDAY_VALUES = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
] as const;
const RUN_STATUS_VALUES = ["calculated", "released", "discarded"] as const;
const MONTH_RULE_VALUES = ["version_on_first", "pro_rata"] as const;
const AMENDMENT_KIND_VALUES = [
  "amount",
  "add_position",
  "remove_position",
  "recipient",
  "address",
] as const;
const AMENDMENT_CONFLICT_VALUES = [
  "basis_changed",
  "position_missing",
  "negative_total",
] as const;
const REDUCTION_KIND_VALUES = [
  "income_level",
  "sibling",
  "single_parent",
  "cap",
] as const;
const COST_SHARE_KIND_VALUES = [
  "education_participation",
  "youth_office",
  "other_subsidy",
] as const;
const COST_SHARE_SCOPE_VALUES = ["care", "meal", "both"] as const;

/** The cost share kind a value names, undefined when unknown. */
export function knownCostShareKind(
  value: string,
): CareCostShareKind | undefined {
  return knownEnum(COST_SHARE_KIND_VALUES, value);
}

/** The cost share scope a value names, undefined when unknown. */
export function knownCostShareScope(
  value: string,
): CareCostShareScope | undefined {
  return knownEnum(COST_SHARE_SCOPE_VALUES, value);
}
const UNCOUNTED_STATUS_VALUES = ["missing", "expired"] as const;

export type CareWeekday = (typeof WEEKDAY_VALUES)[number];
export type CareRunStatus = (typeof RUN_STATUS_VALUES)[number];
export type CareMonthRule = (typeof MONTH_RULE_VALUES)[number];

export const CARE_WEEKDAYS: readonly CareWeekday[] = WEEKDAY_VALUES;

function knownWeekday(value: string): CareWeekday | undefined {
  return knownEnum(WEEKDAY_VALUES, value);
}

/** The weekdays of a list this build knows; an unknown one is left out. */
function knownWeekdays(values: readonly string[] | null): CareWeekday[] {
  return (values ?? []).flatMap((value) => {
    const weekday = knownWeekday(value);
    return weekday ? [weekday] : [];
  });
}

/** A module the contracts of the Träger book at one school. */
export interface CareModule {
  readonly schoolId: string;
  readonly schoolName: string;
  readonly careOfferingId: string;
  readonly moduleName: string;
  /** End time "HH:MM" or empty. */
  readonly endsAt: string;
  readonly bookedWeekdays: readonly CareWeekday[];
  readonly bookedDaysPerWeek: readonly number[];
  readonly contractCount: number;
}

/**
 * How a module is priced (#6196): a price per booked weekday (the sum of
 * the booked days) or a scale by the number of booked days per week.
 */
export type CarePriceForm = "weekday" | "days_per_week";

/**
 * The monthly price of one weekday of a module from a month on, or with
 * `daysPerWeek` the price for that many booked days per week. `siblingCents`
 * is the price for every further child; null keeps the first child's.
 */
interface CareTariff {
  readonly id: string;
  readonly schoolId: string;
  readonly careOfferingId: string;
  readonly moduleName: string;
  /** "" for a scale step; undefined: a weekday this build does not know. */
  readonly weekday: CareWeekday | "" | undefined;
  readonly daysPerWeek?: number | null;
  readonly validFrom: string;
  readonly validUntil: string | null;
  readonly monthlyCents: number;
  readonly siblingCents?: number | null;
  readonly mealExtra?: boolean;
}

/** The head of a price list: the months it bills nothing for (1–12). */
interface CarePriceListHead {
  readonly schoolId: string;
  readonly validFrom: string;
  readonly freeMonths: readonly number[];
}

export interface CareSchool {
  readonly id: string;
  readonly name: string;
}

export interface CareTariffs {
  readonly schools: readonly CareSchool[];
  readonly modules: readonly CareModule[];
  readonly tariffs: readonly CareTariff[];
  readonly lists?: readonly CarePriceListHead[];
  /** Per school ID the last month an issued invoice bills ("YYYY-MM-01"). */
  readonly billedUntil: Readonly<Record<string, string>>;
}

export interface CarePriceInput {
  readonly careOfferingId: string;
  readonly moduleName: string;
  /** Set for a price per weekday … */
  readonly weekday?: CareWeekday;
  /** … or for a scale step. */
  readonly daysPerWeek?: number;
  readonly monthlyCents: number;
  readonly siblingCents: number | null;
  readonly mealExtra: boolean;
}

export interface CareRun {
  readonly id: string;
  readonly billingMonth: string;
  /** undefined: a status this build does not know. */
  readonly status: CareRunStatus | undefined;
  readonly createdAt: string;
  readonly releasedAt: string | null;
  readonly issuedOn: string | null;
  readonly documentCount: number | null;
  readonly totalCents: number | null;
  /** Empty until a released run records the rule it billed by; undefined: unknown. */
  readonly monthRule: CareMonthRule | "" | undefined;
  /** The schools the run bills (#5916). */
  readonly schoolIds: readonly string[];
  /** The invoice date of the run; null takes the day of the release. */
  readonly invoiceDate: string | null;
  /** When the Abrechnung discarded the empty open run (#6626). */
  readonly discardedAt: string | null;
}

export interface CareRunList {
  readonly runs: readonly CareRun[];
  /** The first month from the current one on without a released run. */
  readonly suggestedMonth: string;
}

interface CareWeekdayPrice {
  readonly weekday: CareWeekday;
  readonly monthlyCents: number;
  readonly amountCents: number;
}

export interface CarePosition {
  readonly careOfferingId: string;
  readonly moduleName: string;
  readonly versionNumber: number;
  readonly serviceFrom: string;
  readonly serviceUntil: string;
  readonly weekdays: readonly CareWeekdayPrice[];
  /** The scale step a module priced by days per week billed (#6196). */
  readonly daysPerWeek?: number | null;
  readonly tierMonthlyCents?: number | null;
  /** The price excludes the meal, which the Mensa bills. */
  readonly mealExtra?: boolean;
  readonly amountCents: number;
  /** The amount a removal deducts after reductions and cost shares. */
  readonly payableCents?: number;
  /** Names the position for a change of the review (#6197). */
  readonly key: string;
}

export type CareAmendmentKind = (typeof AMENDMENT_KIND_VALUES)[number];

/**
 * Why a change of the review is not applied (#6197). "other": a reason this
 * build does not know; the change is still not applied.
 */
type CareAmendmentConflict =
  (typeof AMENDMENT_CONFLICT_VALUES)[number] | "other";

/** One side of a change: a total, a position, a recipient or an address. */
interface CareAmendmentValue {
  readonly totalCents: number | null;
  readonly label: string;
  readonly amountCents: number | null;
  readonly recipient: {
    readonly firstName: string;
    readonly lastName: string;
    readonly secondName: string;
    readonly email: string;
  } | null;
  readonly address: PostalAddress | null;
}

/**
 * A change of an invoice in the review (#6197): on a preview its history,
 * also revoked and conflicting entries; on an issued invoice what its
 * release applied. `amountCents` is the correction line it adds.
 */
export interface CareAmendment {
  readonly id: string;
  /** undefined: a kind this build does not know; its amount still counts. */
  readonly kind: CareAmendmentKind | undefined;
  readonly label: string;
  readonly amountCents: number;
  readonly positionKey: string;
  readonly before: CareAmendmentValue;
  readonly after: CareAmendmentValue;
  readonly reason: string;
  readonly amendedAt: string;
  /** Taken over from the cancelled invoice with this number. */
  readonly carriedFromNumber: string | null;
  readonly revocation: {
    readonly reason: string;
    readonly revokedAt: string;
  } | null;
  readonly conflict: CareAmendmentConflict | null;
}

/** Whether a change shapes the invoice. */
export function amendmentApplied(amendment: CareAmendment): boolean {
  return amendment.revocation === null && amendment.conflict === null;
}

/** The correction lines of the applied changes; recipient and address add none. */
export function careCorrectionLines(
  invoice: CareInvoice,
): readonly CareAmendment[] {
  return (invoice.amendments ?? []).filter(
    (amendment) =>
      amendmentApplied(amendment) &&
      amendment.kind !== "recipient" &&
      amendment.kind !== "address",
  );
}

/** Which changes of an invoice the Träger allows in the review (#6197). */
interface CareAmendable {
  readonly amount: boolean;
  readonly recipient: boolean;
  readonly address: boolean;
  readonly positions: boolean;
}

export interface CareInvoice {
  /** Empty for a draft. */
  readonly id: string;
  readonly number: string;
  readonly issuedOn: string | null;
  readonly contractId: string;
  /** What the invoice bills: the care with the Mensa bundled, or the Mensa on an invoice of its own (#4686). */
  readonly service: "care" | "meal";
  /** Original contract-party address, independent of the payer. */
  readonly familyEmail?: string;
  readonly schoolId: string;
  readonly schoolName: string;
  readonly childFirstName: string;
  readonly childLastName: string;
  readonly recipient: {
    readonly firstName: string;
    readonly lastName: string;
    readonly email: string;
    /** Who gets it (#4689); "" on an invoice issued before. */
    readonly kind?: RecipientKind | "";
    /** The second parent when both parents get it. */
    readonly secondName?: string;
    /** The payer's address when another person pays. */
    readonly address?: PostalAddress | null;
  };
  /** How and by when it is paid (#4689); null on an invoice issued before. */
  readonly payment?: InvoicePayment | null;
  readonly positions: readonly CarePosition[];
  /** The rules of the chain in their order (#4685); negative amounts. */
  readonly reductions: readonly CareReduction[];
  /** The Mensa months of the child (#4686); no rule reduces them. */
  readonly mealPositions: readonly CareMealPosition[];
  /**
   * What cost bearers pay of the contribution after the reductions (#4687);
   * `totalCents` is the rest the family pays.
   */
  readonly costShares: readonly CareInvoiceCostShare[];
  /** The changes of the review (#6197); `totalCents` adds their lines. */
  readonly amendments?: readonly CareAmendment[];
  readonly totalCents: number;
  /** Set on a preview invoice the release leaves out (#5916). */
  readonly exclusion?: CareExclusion | null;
}

/** Why the release leaves an invoice of the preview out (#5916). */
interface CareExclusion {
  readonly reason: string;
  readonly excludedAt: string;
}

/**
 * One reduction of an invoice with a copy of its rule (#4685). A sibling
 * reduction names the child's rank among the children its rule counted.
 */
export interface CareReduction {
  readonly kind: (typeof REDUCTION_KIND_VALUES)[number] | undefined;
  readonly name: string;
  readonly childRank: number | null;
  readonly familyChildren: number | null;
  readonly discountBasisPoints: number | null;
  readonly discountCents: number | null;
  readonly priceCents: number | null;
  readonly capCents: number | null;
  /** The sibling prices of the price list (#6196). */
  readonly tariffSiblingPrice?: boolean;
  readonly amountCents: number;
}

export type CareCostShareKind = (typeof COST_SHARE_KIND_VALUES)[number];

/** What a share covers (#4686): the modules, the Mensa or both. */
export type CareCostShareScope = (typeof COST_SHARE_SCOPE_VALUES)[number];

/** The part one cost bearer pays of an invoice, a positive amount (#4687). */
interface CareInvoiceCostShare {
  readonly kind: CareCostShareKind | undefined;
  readonly costBearerId: string;
  readonly costBearerName: string;
  readonly shareBasisPoints: number | null;
  readonly shareCents: number | null;
  readonly scope: CareCostShareScope | undefined;
  readonly amountCents: number;
}

/** What one cost bearer pays of the invoices of a run (#4687). */
export interface CareCostBearerTotal {
  readonly costBearerId: string;
  readonly costBearerName: string;
  readonly invoiceCount: number;
  readonly amountCents: number;
}

/** The contribution before the cost bearer shares. */
export function careContributionCents(invoice: CareInvoice): number {
  // The correction lines of the review come after the shares (#6197).
  const corrections = careCorrectionLines(invoice).reduce(
    (sum, line) => sum + line.amountCents,
    0,
  );
  return invoice.costShares.reduce(
    (sum, share) => sum + share.amountCents,
    invoice.totalCents - corrections,
  );
}

export interface CareUnpriced {
  readonly contractId: string;
  readonly schoolId: string;
  readonly schoolName: string;
  readonly childFirstName: string;
  readonly childLastName: string;
  readonly careOfferingId: string;
  readonly moduleName: string;
  /** Empty for a missing scale step; undefined: a weekday this build does not know. */
  readonly weekday: CareWeekday | "" | undefined;
  /** The missing scale step of a module priced by days per week. */
  readonly daysPerWeek?: number | null;
}

/**
 * A child the run holds back for a duplicate contract (ADR 0158, Nachtrag
 * Kind-Monat): in a preview one entry per module and weekday billed twice,
 * naming every contract of the child; in a released run one entry per
 * child of the contracts its release held back, without a module.
 */
export interface CareDuplicate {
  readonly childFirstName: string;
  readonly childLastName: string;
  readonly moduleName: string;
  readonly weekday: CareWeekday | undefined;
  readonly contracts: readonly {
    readonly contractId: string;
    readonly schoolId: string;
    readonly schoolName: string;
  }[];
}

/**
 * An invoice of a monthly run whose family has no confirmed number of
 * children for the month (#7356): the sibling rule counts its children with
 * a contract alone.
 */
export interface CareUncountedContract {
  readonly contractId: string;
  readonly schoolName: string;
  readonly childFirstName: string;
  readonly childLastName: string;
  /** No number at all, or one that ended before the month; undefined: unknown. */
  readonly status: (typeof UNCOUNTED_STATUS_VALUES)[number] | undefined;
}

export interface CareRunDetail extends CareRun {
  readonly invoices: readonly CareInvoice[];
  readonly unpriced: readonly CareUnpriced[];
  readonly duplicates: readonly CareDuplicate[];
  /** The children of `duplicates`; the release bills none of them. */
  readonly duplicateChildren: number;
  /**
   * Families a sibling rule that counts the family ranks without a
   * confirmed number for the month (#5918); it counts their children with a
   * contract alone.
   */
  readonly uncountedFamilies?: number;
  /** The invoices of those families, each with the reason (#7356). */
  readonly uncountedContracts?: readonly CareUncountedContract[];
  readonly billed: number;
  /** Contracts a free month of their price list bills nothing for. */
  readonly freeOfCharge?: number;
  readonly previewCount: number;
  readonly previewCents: number;
  readonly numberPattern: string;
  readonly numberRangeSet: boolean;
  /** Ended months a school has not released for the Mensa (#4686). */
  readonly mealGaps: readonly CareMealGap[];
  /** Released Mensa months of children the run does not bill (#4686). */
  readonly mealUnbilled: readonly CareMealUnbilled[];
  /** Mensa months issued invoices bill with an amount a later release changed (#4686). */
  readonly mealChanged: readonly CareMealChanged[];
  /** The due dates of the run per payment method (#4689). */
  readonly dueDates?: readonly RunDueDate[];
  /** The review of a calculated run (#5916). */
  readonly schools: readonly CareSchool[];
  readonly excludedCount: number;
  readonly excludedCents: number;
  /** The reviewed state; the release sends it back. */
  readonly fingerprint: string;
  /** Which changes of an invoice the Träger allows (#6197). */
  readonly amendable?: CareAmendable;
  /** Changes in conflict on invoices the release issues; it refuses while any is open. */
  readonly amendmentConflicts?: number;
  /** The kind of document the run issues (#4688). */
  readonly documentKind?: string;
  /** A release would refuse: the fee notice has no legal remedy (#4688). */
  readonly legalRemedyMissing?: boolean;
  /** What each cost bearer pays of the invoices (#4687). */
  readonly costBearers: readonly CareCostBearerTotal[];
  /**
   * Children whose Jahresbescheid an amendment set to 0,00 € for the month:
   * the month stays locked, only a new notice bills it (ADR 0182, #6219).
   */
  readonly feeNoticeHeld?: readonly CareFeeNoticeHold[];
}

export interface CareFeeNoticeHold {
  readonly contractId: string;
  readonly childFirstName: string;
  readonly childLastName: string;
  readonly noticeNumber: string;
}

function addressFromBackend(
  address: sharedContract.PostalAddress,
): PostalAddress {
  return {
    street: address.street,
    postalCode: address.postal_code,
    city: address.city,
  };
}

function amendmentValue(
  value: traegerCareBillingRunsContract.CareAmendmentValue,
): CareAmendmentValue {
  return {
    totalCents: value.total_cents ?? null,
    label: value.label ?? "",
    amountCents: value.amount_cents ?? null,
    recipient: value.recipient
      ? {
          firstName: value.recipient.first_name,
          lastName: value.recipient.last_name,
          secondName: value.recipient.second_name,
          email: value.recipient.email,
        }
      : null,
    address: value.address ? addressFromBackend(value.address) : null,
  };
}

function amendmentFromBackend(
  amendment: traegerCareBillingRunsContract.CareAmendment,
): CareAmendment {
  return {
    id: amendment.id,
    kind: knownEnum(AMENDMENT_KIND_VALUES, amendment.kind),
    label: amendment.label,
    amountCents: amendment.amount_cents,
    positionKey: amendment.position_key ?? "",
    before: amendmentValue(amendment.before),
    after: amendmentValue(amendment.after),
    reason: amendment.reason,
    amendedAt: amendment.amended_at,
    carriedFromNumber: amendment.carried
      ? (amendment.carried_from_number ?? "")
      : null,
    revocation: amendment.revocation
      ? {
          reason: amendment.revocation.reason,
          revokedAt: amendment.revocation.revoked_at,
        }
      : null,
    conflict: amendment.conflict
      ? (knownEnum(AMENDMENT_CONFLICT_VALUES, amendment.conflict) ?? "other")
      : null,
  };
}

/** An ID of the contract; "0" is none. */
function id(value: string): string {
  return value === "0" ? "" : value;
}

export function schoolFromBackend(
  school: sharedContract.CareSchool,
): CareSchool {
  return { id: id(school.id), name: school.name };
}

/** Per school the last billed month; a school without one is left out. */
function billedUntilFromBackend(
  billed: Readonly<Record<string, string | null>> | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [school, month] of Object.entries(billed ?? {})) {
    if (month) out[school] = month;
  }
  return out;
}

export function moduleFromBackend(
  module: sharedContract.CareModule,
): CareModule {
  return {
    schoolId: id(module.school_id),
    schoolName: module.school_name,
    careOfferingId: id(module.care_offering_id),
    moduleName: module.module_name,
    endsAt: module.ends_at,
    bookedWeekdays: knownWeekdays(module.booked_weekdays),
    bookedDaysPerWeek: module.booked_days_per_week ?? [],
    contractCount: module.contract_count,
  };
}

function tariffsFromBackend(
  body: traegerCareTariffsContract.CareTariffs,
): CareTariffs {
  return {
    schools: (body.schools ?? []).map(schoolFromBackend),
    modules: (body.modules ?? []).map(moduleFromBackend),
    tariffs: (body.tariffs ?? []).map((tariff) => ({
      id: id(tariff.id),
      schoolId: id(tariff.school_id),
      careOfferingId: id(tariff.care_offering_id),
      moduleName: tariff.module_name,
      weekday: tariff.weekday === "" ? "" : knownWeekday(tariff.weekday),
      daysPerWeek: tariff.days_per_week,
      validFrom: requiredDay(tariff.valid_from, "care_tariff.valid_from"),
      validUntil: tariff.valid_until,
      monthlyCents: tariff.monthly_cents,
      siblingCents: tariff.sibling_cents,
      mealExtra: tariff.meal_extra,
    })),
    lists: (body.lists ?? []).map((list) => ({
      schoolId: id(list.school_id),
      validFrom: requiredDay(list.valid_from, "care_price_list.valid_from"),
      freeMonths: list.free_months ?? [],
    })),
    billedUntil: billedUntilFromBackend(body.billed_until),
  };
}

function runFromBackend(run: traegerCareBillingRunsContract.CareRun): CareRun {
  return {
    id: id(run.id),
    billingMonth: requiredDay(run.billing_month, "care_run.billing_month"),
    status: knownEnum(RUN_STATUS_VALUES, run.status),
    createdAt: run.created_at,
    releasedAt: run.released_at,
    issuedOn: run.issued_on,
    documentCount: run.document_count,
    totalCents: run.total_cents,
    monthRule:
      run.month_rule === "" ? "" : knownEnum(MONTH_RULE_VALUES, run.month_rule),
    schoolIds: (run.school_ids ?? []).map(id),
    invoiceDate: run.invoice_date,
    discardedAt: run.discarded_at,
  };
}

function invoiceFromBackend(
  invoice: traegerCareBillingRunsContract.CareInvoice,
): CareInvoice {
  return {
    id: id(invoice.id),
    number: invoice.number,
    issuedOn: invoice.issued_on,
    contractId: id(invoice.contract_id),
    service: invoice.service === "meal" ? "meal" : "care",
    familyEmail: invoice.family_email,
    schoolId: id(invoice.school_id),
    schoolName: invoice.school_name,
    childFirstName: invoice.child_first_name,
    childLastName: invoice.child_last_name,
    recipient: {
      firstName: invoice.recipient.first_name,
      lastName: invoice.recipient.last_name,
      email: invoice.recipient.email,
      kind:
        invoice.recipient.kind === ""
          ? ""
          : knownRecipientKind(invoice.recipient.kind),
      secondName: invoice.recipient.second_name,
      address: invoice.recipient.address
        ? addressFromBackend(invoice.recipient.address)
        : null,
    },
    payment: invoicePaymentFromBackend(invoice.payment),
    positions: (invoice.positions ?? []).map((position) => ({
      careOfferingId: id(position.care_offering_id),
      moduleName: position.module_name,
      versionNumber: position.version_number,
      serviceFrom: requiredDay(
        position.service_from,
        "care_position.service_from",
      ),
      serviceUntil: requiredDay(
        position.service_until,
        "care_position.service_until",
      ),
      weekdays: (position.weekdays ?? []).flatMap((price) => {
        const weekday = knownWeekday(price.weekday);
        return weekday
          ? [
              {
                weekday,
                monthlyCents: price.monthly_cents,
                amountCents: price.amount_cents,
              },
            ]
          : [];
      }),
      daysPerWeek: position.days_per_week ?? null,
      tierMonthlyCents: position.tier_monthly_cents ?? null,
      mealExtra: position.meal_extra ?? false,
      amountCents: position.amount_cents,
      payableCents: position.payable_cents,
      key: position.key ?? "",
    })),
    reductions: (invoice.reductions ?? []).map((reduction) => ({
      kind: knownEnum(REDUCTION_KIND_VALUES, reduction.kind),
      name: reduction.name,
      childRank: reduction.child_rank,
      familyChildren: reduction.family_children,
      discountBasisPoints: reduction.discount_basis_points,
      discountCents: reduction.discount_cents,
      priceCents: reduction.price_cents,
      capCents: reduction.cap_cents,
      tariffSiblingPrice: reduction.tariff_sibling_price,
      amountCents: reduction.amount_cents,
    })),
    mealPositions: mealPositionsFromBackend(invoice.meal_positions),
    costShares: (invoice.cost_shares ?? []).map((share) => ({
      kind: knownCostShareKind(share.kind),
      costBearerId: id(share.cost_bearer_id),
      costBearerName: share.cost_bearer_name,
      shareBasisPoints: share.share_basis_points,
      shareCents: share.share_cents,
      scope: knownCostShareScope(share.scope),
      amountCents: share.amount_cents,
    })),
    amendments: (invoice.amendments ?? []).map(amendmentFromBackend),
    totalCents: invoice.total_cents,
    exclusion: invoice.exclusion
      ? {
          reason: invoice.exclusion.reason,
          excludedAt: invoice.exclusion.excluded_at,
        }
      : null,
  };
}

export function detailFromBackend(
  detail: traegerCareBillingRunsContract.CareRunDetail,
): CareRunDetail {
  return {
    ...runFromBackend(detail),
    invoices: (detail.invoices ?? []).map(invoiceFromBackend),
    unpriced: (detail.unpriced ?? []).map((entry) => ({
      contractId: id(entry.contract_id),
      schoolId: id(entry.school_id),
      schoolName: entry.school_name,
      childFirstName: entry.child_first_name,
      childLastName: entry.child_last_name,
      careOfferingId: id(entry.care_offering_id),
      moduleName: entry.module_name,
      weekday: entry.weekday === "" ? "" : knownWeekday(entry.weekday),
      daysPerWeek: entry.days_per_week ?? null,
    })),
    duplicates: (detail.duplicates ?? []).map((entry) => ({
      childFirstName: entry.child_first_name,
      childLastName: entry.child_last_name,
      moduleName: entry.module_name,
      weekday: knownWeekday(entry.weekday),
      contracts: (entry.contracts ?? []).map((contract) => ({
        contractId: id(contract.contract_id),
        schoolId: id(contract.school_id),
        schoolName: contract.school_name,
      })),
    })),
    duplicateChildren: detail.duplicate_children,
    uncountedFamilies: detail.uncounted_families,
    uncountedContracts: (detail.uncounted_contracts ?? []).map((contract) => ({
      contractId: id(contract.contract_id),
      schoolName: contract.school_name,
      childFirstName: contract.child_first_name,
      childLastName: contract.child_last_name,
      status: knownEnum(UNCOUNTED_STATUS_VALUES, contract.status),
    })),
    billed: detail.billed,
    freeOfCharge: detail.free_of_charge,
    previewCount: detail.preview_count,
    previewCents: detail.preview_cents,
    numberPattern: detail.number_pattern,
    numberRangeSet: detail.number_range_set,
    mealGaps: mealGapsFromBackend(detail.meal_gaps),
    mealUnbilled: mealUnbilledFromBackend(detail.meal_unbilled),
    mealChanged: mealChangedFromBackend(detail.meal_changed),
    dueDates: runDueDatesFromBackend(detail.due_dates),
    schools: (detail.schools ?? []).map(schoolFromBackend),
    excludedCount: detail.excluded_count,
    excludedCents: detail.excluded_cents,
    fingerprint: detail.fingerprint,
    amendable: { ...detail.amendable },
    amendmentConflicts: detail.amendment_conflicts,
    documentKind: detail.document_kind,
    legalRemedyMissing: detail.legal_remedy_missing,
    costBearers: (detail.cost_bearers ?? []).map((total) => ({
      costBearerId: id(total.cost_bearer_id),
      costBearerName: total.cost_bearer_name,
      invoiceCount: total.invoice_count,
      amountCents: total.amount_cents,
    })),
    feeNoticeHeld: (detail.fee_notice_held ?? []).map((hold) => ({
      contractId: id(hold.contract_id),
      childFirstName: hold.child_first_name,
      childLastName: hold.child_last_name,
      noticeNumber: hold.notice_number,
    })),
  };
}

export async function fetchCareTariffs(): Promise<CareTariffs> {
  return tariffsFromBackend(await bffJson("org", "GET /traeger/care-tariffs/"));
}

/** Sets the prices of a school from `validFrom` (the 1st of a month) on. */
export async function saveCarePriceList(
  schoolId: string,
  validFrom: string,
  prices: readonly CarePriceInput[],
  freeMonths: readonly number[] = [],
): Promise<CareTariffs> {
  return tariffsFromBackend(
    await bffJson("org", "PUT /traeger/care-tariffs/", {
      body: {
        school_id: schoolId,
        valid_from: validFrom,
        free_months: [...freeMonths],
        prices: prices.map((price) => ({
          care_offering_id: price.careOfferingId,
          module_name: price.moduleName,
          weekday: price.weekday ?? "",
          days_per_week: price.daysPerWeek ?? null,
          monthly_cents: price.monthlyCents,
          sibling_cents: price.siblingCents,
          meal_extra: price.mealExtra,
        })),
      } satisfies traegerCareTariffsContract.CarePriceListRequest,
    }),
  );
}

/** Removes the prices of a school that start on `validFrom`. */
export async function deleteCarePriceList(
  schoolId: string,
  validFrom: string,
): Promise<CareTariffs> {
  return tariffsFromBackend(
    await bffJson(
      "org",
      "DELETE /traeger/care-tariffs/{schoolID}/{validFrom}",
      { params: { schoolID: schoolId, validFrom } },
    ),
  );
}

export async function fetchCareRuns(): Promise<CareRunList> {
  const body = await bffJson("org", "GET /traeger/care-billing-runs/");
  return {
    runs: (body.runs ?? []).map(runFromBackend),
    suggestedMonth: requiredDay(
      body.suggested_month,
      "care_runs.suggested_month",
    ),
  };
}

/** What a new run bills (#5916): month, schools and invoice date. */
export interface CareRunStartInput {
  readonly billingMonth: string;
  /** Empty: every school no open run of the month bills. */
  readonly schoolIds: readonly string[];
  /** Null takes the day of the release. */
  readonly invoiceDate: string | null;
}

export async function startCareRun(input: CareRunStartInput): Promise<CareRun> {
  return runFromBackend(
    await bffJson("org", "POST /traeger/care-billing-runs/", {
      body: {
        billing_month: input.billingMonth,
        school_ids: [...input.schoolIds],
        invoice_date: input.invoiceDate,
      } satisfies traegerCareBillingRunsContract.CareRunRequest,
    }),
  );
}

export async function fetchCareRun(runId: string): Promise<CareRunDetail> {
  return detailFromBackend(
    await bffJson("org", "GET /traeger/care-billing-runs/{id}", {
      params: { id: runId },
    }),
  );
}

/**
 * Releases the preview the Abrechnung checked: its count, sum and
 * fingerprint. A preview that changed since is refused (#5916).
 */
export async function releaseCareRun(
  run: Pick<
    CareRunDetail,
    "id" | "previewCount" | "previewCents" | "fingerprint"
  >,
): Promise<CareRunDetail> {
  return detailFromBackend(
    await bffJson("org", "POST /traeger/care-billing-runs/{id}/release", {
      params: { id: run.id },
      body: {
        document_count: run.previewCount,
        total_cents: run.previewCents,
        fingerprint: run.fingerprint,
      },
    }),
  );
}

/**
 * Discards an open run that has nothing to issue or to settle (#6626). The
 * server checks under the lock of the release; a run with content is refused
 * (409).
 */
export async function discardCareRun(runId: string): Promise<CareRunDetail> {
  return detailFromBackend(
    await bffJson("org", "POST /traeger/care-billing-runs/{id}/discard", {
      params: { id: runId },
    }),
  );
}

// The letters of a released monthly run (#4684): one letter per invoice and
// per Storno of a sent invoice, the mail of each letter, the print and the
// Storno itself.

/** The letter of an invoice or of its Storno. */
export type CareLetterKind = "invoice" | "cancellation";

/** What the Abrechnung wrote into every letter of a run. */
interface CareLetterSet {
  readonly paymentDueOn: string;
  readonly notes: string;
  readonly createdAt: string;
}

export interface CareLetterInput {
  readonly paymentDueOn: string;
  readonly notes: string;
}

/**
 * One invoice or Storno of a run with its letter and its last mail. A
 * Storno follows its invoice directly. `hasLetter` is false before the
 * letters exist and for the Storno of an invoice that never went out.
 */
export interface CareLetterMailing {
  readonly invoiceId: string;
  readonly kind: CareLetterKind;
  /** The number of this document: the invoice or the Storno. */
  readonly number: string;
  readonly invoiceNumber: string;
  readonly issuedOn: string | null;
  readonly childFirstName: string;
  readonly childLastName: string;
  readonly schoolName: string;
  readonly recipientFirstName: string;
  readonly recipientLastName: string;
  readonly recipientEmail: string;
  /** Negative for a Storno. */
  readonly totalCents: number;
  readonly reason: string;
  /** The invoice has a Storno. */
  readonly cancelled: boolean;
  readonly cancellationNumber: string;
  readonly hasLetter: boolean;
  /**
   * The sent letter also lands in the parents inbox. False when the child has
   * no record yet: the family gets it by mail or on paper only.
   */
  readonly inInbox: boolean;
  /** A paper copy was downloaded through the print action. */
  readonly printed?: boolean;
  /** A later released invoice replaces this cancelled invoice. */
  readonly replaced?: boolean;
  /** "unknown" also stands for a state this build does not know. */
  readonly status: LetterMailStatus;
  readonly sends: number;
  readonly attempts: number;
  readonly requestedAt: string | null;
  readonly sentAt: string | null;
  readonly mailOutcome?: MailOutcome;
  readonly providerBlock?: MailProviderBlock;
}

/**
 * The letters of a run by the state of their last mail. `notSent` includes
 * `withoutEmail`, the letters of families without an address.
 */
interface CareLetterSummary {
  readonly letters: number;
  readonly sent: number;
  readonly queued: number;
  readonly failed: number;
  readonly notSent: number;
  readonly withoutEmail: number;
  /** Letters that reach the family by mail or paper only (no child record). */
  readonly withoutInbox: number;
}

export interface CareLetters {
  readonly letters: CareLetterSet | null;
  readonly documents: readonly CareLetterMailing[];
  readonly summary: CareLetterSummary;
}

/** What a send to every family did. */
export interface CareLetterSeries {
  readonly queued: number;
  readonly already: number;
  readonly withoutEmail: number;
  /** Letters held back: the address is no longer a party of the contract. */
  readonly recipientChanged: number;
}

function careMailingFromBackend(
  mailing: traegerCareBillingRunsContract.CareLetterMailing,
): CareLetterMailing {
  return {
    invoiceId: id(mailing.invoice_id),
    kind: mailing.kind === "cancellation" ? "cancellation" : "invoice",
    number: mailing.number,
    invoiceNumber: mailing.invoice_number,
    issuedOn: mailing.issued_on,
    childFirstName: mailing.child_first_name,
    childLastName: mailing.child_last_name,
    schoolName: mailing.school_name,
    recipientFirstName: mailing.recipient_first_name,
    recipientLastName: mailing.recipient_last_name,
    recipientEmail: mailing.recipient_email,
    totalCents: mailing.total_cents,
    reason: mailing.reason ?? "",
    cancelled: mailing.cancelled,
    cancellationNumber: mailing.cancellation_number ?? "",
    hasLetter: mailing.has_letter,
    inInbox: mailing.in_inbox,
    printed: mailing.printed,
    replaced: mailing.replaced,
    status: knownLetterMailStatus(mailing.status),
    sends: mailing.sends,
    attempts: mailing.attempts,
    requestedAt: mailing.requested_at,
    sentAt: mailing.sent_at,
    mailOutcome: knownMailOutcome(mailing.mail_outcome),
    providerBlock: knownMailProviderBlock(mailing.provider_block),
  };
}

function careLettersFromBackend(
  body: traegerCareBillingRunsContract.CareLetters,
): CareLetters {
  const summary = body.summary;
  return {
    letters: body.letters
      ? {
          paymentDueOn: requiredDay(
            body.letters.payment_due_on,
            "care_letters.payment_due_on",
          ),
          notes: body.letters.notes,
          createdAt: body.letters.created_at,
        }
      : null,
    documents: (body.documents ?? []).map(careMailingFromBackend),
    summary: {
      letters: summary.letters,
      sent: summary.sent,
      queued: summary.queued,
      failed: summary.failed,
      notSent: summary.not_sent,
      withoutEmail: summary.without_email,
      withoutInbox: summary.without_inbox,
    },
  };
}

function careLetterBody(
  input: CareLetterInput,
): traegerCareBillingRunsContract.CareLetterRequest {
  return { payment_due_on: input.paymentDueOn, notes: input.notes };
}

/** The letters of a released run with the state of every invoice. */
export async function fetchCareLetters(runId: string): Promise<CareLetters> {
  return careLettersFromBackend(
    await bffJson("org", "GET /traeger/care-billing-runs/{id}/letters", {
      params: { id: runId },
    }),
  );
}

/** Creates the letter of every invoice once; families see nothing yet. */
export async function createCareLetters(
  runId: string,
  input: CareLetterInput,
): Promise<CareLetters> {
  return careLettersFromBackend(
    await bffJson("org", "POST /traeger/care-billing-runs/{id}/letters", {
      params: { id: runId },
      body: careLetterBody(input),
    }),
  );
}

/** The letter of the first invoice with the input, without storing it. */
export async function previewCareLetter(
  runId: string,
  input: CareLetterInput,
): Promise<BillingFile> {
  return billingFile(
    bffFile("org", "POST /traeger/care-billing-runs/{id}/letters/preview", {
      params: { id: runId },
      body: careLetterBody(input),
    }),
    "vorschau.pdf",
  );
}

/**
 * Every letter the run may still send in one PDF to print; with
 * `withoutEmailOnly` only those of families without an address.
 */
export async function printCareLetters(
  runId: string,
  withoutEmailOnly = false,
): Promise<BillingFile> {
  return billingFile(
    bffFile("org", "GET /traeger/care-billing-runs/{id}/letters/print", {
      params: { id: runId },
      query: { only: withoutEmailOnly ? "without_email" : undefined },
    }),
    "monatsrechnungen.pdf",
  );
}

/** Mails every letter with an address and no mail yet; idempotent. */
export async function mailCareLetters(
  runId: string,
): Promise<CareLetterSeries> {
  const series = await bffJson(
    "org",
    "POST /traeger/care-billing-runs/{id}/letters/mail",
    { params: { id: runId } },
  );
  return {
    queued: series.queued,
    already: series.already,
    withoutEmail: series.without_email,
    recipientChanged: series.recipient_changed ?? 0,
  };
}

/** The stored letter of an invoice or of its Storno. */
export async function downloadCareLetter(
  runId: string,
  invoiceId: string,
  kind: CareLetterKind,
): Promise<BillingFile> {
  return billingFile(
    bffFile(
      "org",
      "GET /traeger/care-billing-runs/{id}/invoices/{invoiceID}/letter",
      {
        params: { id: runId, invoiceID: invoiceId },
        query: { kind: kind === "cancellation" ? kind : undefined },
      },
    ),
    kind === "cancellation" ? "storno.pdf" : "rechnung.pdf",
  );
}

/** Mails one letter, first or again. */
export async function mailCareLetter(
  runId: string,
  invoiceId: string,
  kind: CareLetterKind,
): Promise<CareLetterMailing> {
  return careMailingFromBackend(
    await bffJson(
      "org",
      "POST /traeger/care-billing-runs/{id}/invoices/{invoiceID}/mail",
      {
        params: { id: runId, invoiceID: invoiceId },
        query: { kind: kind === "cancellation" ? kind : undefined },
      },
    ),
  );
}

/** Issues the Storno of an invoice with its reason. */
export async function cancelCareInvoice(
  runId: string,
  invoiceId: string,
  reason: string,
): Promise<CareLetters> {
  return careLettersFromBackend(
    await bffJson(
      "org",
      "POST /traeger/care-billing-runs/{id}/invoices/{invoiceID}/cancellation",
      {
        params: { id: runId, invoiceID: invoiceId },
        body: {
          reason,
        } satisfies traegerCareBillingRunsContract.CareCancellationRequest,
      },
    ),
  );
}
