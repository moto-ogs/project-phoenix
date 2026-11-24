/**
 * The holiday contribution as the Elternabrechnung computes it (#4664): the
 * lines of the rule chain per child in whole cent. The public registration
 * form and the Träger portal share this shape, so neither imports the other
 * portal's client.
 */

import { knownEnum } from "./contract/known-enum";
import type * as traegerHolidayQuotesContract from "./contract/traeger-holiday-quotes.generated";

// Go does not register this set; the contract types it as string. A value
// this build does not know stays undefined instead of passing as a known one.
const CONTRIBUTION_LINE_KIND_VALUES = [
  "base",
  "sibling",
  "benefits_exemption",
  "cost_takeover",
  "meal",
] as const;

type ContributionLineKind = (typeof CONTRIBUTION_LINE_KIND_VALUES)[number];

export interface ContributionLine {
  /** undefined: a line this build does not know; its amount still counts. */
  readonly kind: ContributionLineKind | undefined;
  /** Negative for a discount. */
  readonly amountCents: number;
  readonly weekStartsOn: string | null;
  readonly weekEndsOn: string | null;
  readonly timeModelName: string;
  readonly childRank: number | null;
  readonly discountBasisPoints: number | null;
  readonly discountCents: number | null;
  readonly note: string;
  /** Cost takeover (#5627): the copied name of the cost bearer. */
  readonly costBearerName?: string;
  /**
   * Days a base line of a week by days prices (#4701), null for a week; on
   * a meal line the number of lunches it prices (#5631).
   */
  readonly bookedDays?: number | null;
}

/**
 * The price of one lunch of a meal line in cent (#5631): its amount is the
 * price of one lunch times its lunches. Null without the number of lunches.
 */
export function lunchPriceOf(line: {
  readonly amountCents: number;
  readonly bookedDays?: number | null;
}): number | null {
  if (!line.bookedDays || line.bookedDays <= 0) return null;
  // Whole cent, like the invoice text (integer division in mealLabel).
  return Math.trunc(Math.abs(line.amountCents) / line.bookedDays);
}

interface ChildContribution {
  /** The child of a registration; empty in a quote. */
  readonly childId: string;
  /** Place of the child in the form, from 1. */
  readonly position: number;
  readonly lines: readonly ContributionLine[];
  readonly totalCents: number;
}

export interface HolidayContribution {
  readonly children: readonly ChildContribution[];
  readonly totalCents: number;
  /** The Träger has a valid exemption rule. */
  readonly exemptionAvailable: boolean;
  /** The exemption applies. */
  readonly benefitsExemption: boolean;
  /** The cost bearer that pays instead of the family (#5627); null if none. */
  readonly costBearerId?: string | null;
  readonly costBearerName?: string;
  /** Frozen at the confirmation; a preview otherwise. */
  readonly frozen: boolean;
  readonly confirmedAt: string | null;
  /**
   * An issued invoice bills the registration; it keeps the debtor number
   * (#5621). Only the Träger read of a frozen contribution sets it.
   */
  readonly invoiced?: boolean;
  /**
   * The other registrations of the sibling group (#5628), with their
   * children; empty outside a group and in a quote.
   */
  readonly siblings?: readonly HolidaySibling[];
  /** The debtor number the sibling group already has. */
  readonly siblingDebtorNumber?: string;
  /** An issued invoice bills a registration of the group; it stays. */
  readonly siblingsInvoiced?: boolean;
  /**
   * The issued invoice billed another amount than the contribution has
   * now, for example after a sibling was cancelled (#5662).
   */
  readonly correctionNeeded?: boolean;
  /**
   * The token of a preview (ADR 0311): the confirmation sends it back and
   * freezes only the contribution shown. "" on a frozen contribution.
   */
  readonly fingerprint?: string;
}

interface HolidaySibling {
  readonly registrationId: string;
  readonly cancelled: boolean;
  readonly children: readonly { readonly id: string; readonly name: string }[];
}

/** The identifier as a string, "" for an absent one (Go's 0 or null). */
function presentId(value: string | null): string {
  return value === null || value === "0" ? "" : value;
}

/** Maps a contribution of the backend. */
export function contributionFromBackend(
  contribution: traegerHolidayQuotesContract.HolidayContribution,
): HolidayContribution {
  return {
    children: (contribution.children ?? []).map((child) => ({
      childId: presentId(child.child_id),
      position: child.position,
      totalCents: child.total_cents,
      // A meal line without lunches only records the selection of a week
      // whose care days are all closed (#5631); it shows nothing.
      lines: (child.lines ?? [])
        .filter((line) => line.kind !== "meal" || (line.booked_days ?? 0) > 0)
        .map((line) => ({
          kind: knownEnum(CONTRIBUTION_LINE_KIND_VALUES, line.kind),
          amountCents: line.amount_cents,
          weekStartsOn: line.week_starts_on,
          weekEndsOn: line.week_ends_on,
          timeModelName: line.time_model_name,
          childRank: line.child_rank,
          discountBasisPoints: line.discount_basis_points,
          discountCents: line.discount_cents,
          note: line.note,
          costBearerName: line.cost_bearer_name,
          bookedDays: line.booked_days,
        })),
    })),
    totalCents: contribution.total_cents,
    exemptionAvailable: contribution.exemption_available,
    benefitsExemption: contribution.benefits_exemption,
    costBearerId: presentId(contribution.cost_bearer_id) || null,
    costBearerName: contribution.cost_bearer_name,
    frozen: contribution.frozen,
    confirmedAt: contribution.confirmed_at,
    invoiced: contribution.invoiced,
    siblings: (contribution.siblings ?? []).map((sibling) => ({
      registrationId: sibling.registration_id,
      cancelled: sibling.status === "cancelled",
      children: (sibling.children ?? []).map((child) => ({
        id: child.id,
        name: `${child.first_name} ${child.last_name}`,
      })),
    })),
    siblingDebtorNumber: contribution.sibling_debtor_number ?? "",
    siblingsInvoiced: contribution.siblings_invoiced ?? false,
    correctionNeeded: contribution.correction_needed ?? false,
    fingerprint: contribution.fingerprint ?? "",
  };
}
