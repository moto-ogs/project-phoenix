/**
 * Client of the Mensa of the monthly run (#4686): how the Träger bills the
 * Mensa of each school (flat per child and month or per meal) and the Mensa
 * parts of a run (positions, months without a release, children not
 * billed). Money stays whole cent; backend int64 IDs leave as strings;
 * calendar dates stay "YYYY-MM-DD".
 */

import { knownEnum } from "./contract/known-enum";
import { requiredDay } from "./contract/required-day";
import type * as traegerCareBillingRunsContract from "./contract/traeger-care-billing-runs.generated";
import type * as traegerCareMealTariffsContract from "./contract/traeger-care-meal-tariffs.generated";
import { traegerRequest } from "./traeger-api";

// Go does not register these sets; the contract types them as string. A value
// this build does not know stays undefined instead of passing as a known one.
const MEAL_MODE_VALUES = ["flat", "per_meal"] as const;
const UNBILLED_REASON_VALUES = ["no_contract", "contract_billed"] as const;

export type CareMealMode = (typeof MEAL_MODE_VALUES)[number];

export interface CareMealTariff {
  readonly id: string;
  readonly schoolId: string;
  readonly validFrom: string;
  /** The day before the next price of the school; null while none follows. */
  readonly validUntil: string | null;
  /** undefined: a mode this build does not know. */
  readonly mode: CareMealMode | undefined;
  readonly amountCents: number;
}

export interface CareMealTariffs {
  readonly schools: readonly { readonly id: string; readonly name: string }[];
  readonly tariffs: readonly CareMealTariff[];
  /** Per school the last Mensa month an issued invoice bills. */
  readonly billedUntil: Readonly<Record<string, string>>;
}

/** One Mensa month of a child on an invoice. */
export interface CareMealPosition {
  readonly mealMonth: string;
  readonly mode: CareMealMode | undefined;
  readonly quantity: number;
  readonly unitCents: number;
  readonly amountCents: number;
  /** Names the position for a change of the review (#6197). */
  readonly key?: string;
}

/** An ended month a school has not released yet. */
export interface CareMealGap {
  readonly schoolId: string;
  readonly schoolName: string;
  readonly month: string;
  /** The attendance of the month is past the school's retention: nobody can release or bill it any more. */
  readonly expired: boolean;
}

/**
 * A Mensa month an issued invoice bills with an amount a later release of
 * the school changed (#4686): the office cancels and issues it again.
 */
export interface CareMealChanged {
  readonly schoolId: string;
  readonly schoolName: string;
  readonly studentId: string;
  readonly childFirstName: string;
  readonly childLastName: string;
  readonly month: string;
  readonly invoiceNumber: string;
  readonly billedQuantity: number;
  readonly billedCents: number;
  readonly newQuantity: number;
  readonly newCents: number;
}

export function mealChangedFromBackend(
  entries: readonly traegerCareBillingRunsContract.CareMealChanged[] | null,
): CareMealChanged[] {
  return (entries ?? []).map((entry) => ({
    schoolId: id(entry.school_id),
    schoolName: entry.school_name,
    studentId: id(entry.student_id),
    childFirstName: entry.child_first_name,
    childLastName: entry.child_last_name,
    month: requiredDay(entry.month, "care_meal_changed.month"),
    invoiceNumber: entry.invoice_number,
    billedQuantity: entry.billed_quantity,
    billedCents: entry.billed_cents,
    newQuantity: entry.new_quantity,
    newCents: entry.new_cents,
  }));
}

/** A released Mensa month of a child the run does not bill. */
export interface CareMealUnbilled {
  readonly schoolId: string;
  readonly schoolName: string;
  readonly studentId: string;
  readonly childFirstName: string;
  readonly childLastName: string;
  readonly month: string;
  readonly mealDays: number;
  /** undefined: a reason this build does not know. */
  readonly reason: (typeof UNBILLED_REASON_VALUES)[number] | undefined;
}

const MEAL_TARIFFS_PATH = "/api/traeger/care-meal-tariffs";

/** An ID of the contract; "0" is none. */
function id(value: string): string {
  return value === "0" ? "" : value;
}

export function mealPositionsFromBackend(
  positions: readonly traegerCareBillingRunsContract.CareMealPosition[] | null,
): CareMealPosition[] {
  return (positions ?? []).map((position) => ({
    mealMonth: requiredDay(
      position.meal_month,
      "care_meal_position.meal_month",
    ),
    mode: knownEnum(MEAL_MODE_VALUES, position.mode),
    quantity: position.quantity,
    unitCents: position.unit_cents,
    amountCents: position.amount_cents,
    key: position.key ?? "",
  }));
}

export function mealGapsFromBackend(
  gaps: readonly traegerCareBillingRunsContract.CareMealGap[] | null,
): CareMealGap[] {
  return (gaps ?? []).map((gap) => ({
    schoolId: id(gap.school_id),
    schoolName: gap.school_name,
    month: requiredDay(gap.month, "care_meal_gap.month"),
    expired: gap.expired,
  }));
}

export function mealUnbilledFromBackend(
  entries: readonly traegerCareBillingRunsContract.CareMealUnbilled[] | null,
): CareMealUnbilled[] {
  return (entries ?? []).map((entry) => ({
    schoolId: id(entry.school_id),
    schoolName: entry.school_name,
    studentId: id(entry.student_id),
    childFirstName: entry.child_first_name,
    childLastName: entry.child_last_name,
    month: requiredDay(entry.month, "care_meal_unbilled.month"),
    mealDays: entry.meal_days,
    reason: knownEnum(UNBILLED_REASON_VALUES, entry.reason),
  }));
}

function mealTariffsFromBackend(
  body: traegerCareMealTariffsContract.CareMealTariffs,
): CareMealTariffs {
  return {
    schools: (body.schools ?? []).map((school) => ({
      id: id(school.id),
      name: school.name,
    })),
    tariffs: (body.tariffs ?? []).map((tariff) => ({
      id: id(tariff.id),
      schoolId: id(tariff.school_id),
      validFrom: requiredDay(tariff.valid_from, "care_meal_tariff.valid_from"),
      validUntil: tariff.valid_until,
      mode: knownEnum(MEAL_MODE_VALUES, tariff.mode),
      amountCents: tariff.amount_cents,
    })),
    billedUntil: Object.fromEntries(
      Object.entries(body.billed_until ?? {}).flatMap(([school, month]) =>
        month ? [[school, month]] : [],
      ),
    ),
  };
}

export async function fetchCareMealTariffs(): Promise<CareMealTariffs> {
  return mealTariffsFromBackend(
    await traegerRequest<traegerCareMealTariffsContract.CareMealTariffs>(
      MEAL_TARIFFS_PATH,
    ),
  );
}

/** Sets how the Mensa of a school is billed from `validFrom` on. */
export async function saveCareMealTariff(input: {
  readonly schoolId: string;
  readonly validFrom: string;
  readonly mode: CareMealMode;
  readonly amountCents: number;
}): Promise<CareMealTariffs> {
  return mealTariffsFromBackend(
    await traegerRequest<traegerCareMealTariffsContract.CareMealTariffs>(
      MEAL_TARIFFS_PATH,
      {
        method: "PUT",
        body: {
          school_id: input.schoolId,
          valid_from: input.validFrom,
          mode: input.mode,
          amount_cents: input.amountCents,
        } satisfies traegerCareMealTariffsContract.CareMealPriceRequest,
      },
    ),
  );
}

/** Removes the Mensa price of a school that starts on `validFrom`. */
export async function deleteCareMealTariff(
  schoolId: string,
  validFrom: string,
): Promise<CareMealTariffs> {
  return mealTariffsFromBackend(
    await traegerRequest<traegerCareMealTariffsContract.CareMealTariffs>(
      `${MEAL_TARIFFS_PATH}/${encodeURIComponent(schoolId)}/${encodeURIComponent(validFrom)}`,
      { method: "DELETE" },
    ),
  );
}

/** The Mensa price of a school in a month, if any. */
export function mealTariffOn(
  tariffs: readonly CareMealTariff[],
  schoolId: string,
  month: string,
): CareMealTariff | null {
  let found: CareMealTariff | null = null;
  for (const tariff of tariffs) {
    if (
      tariff.schoolId === schoolId &&
      tariff.validFrom <= month &&
      (!found || tariff.validFrom > found.validFrom)
    ) {
      found = tariff;
    }
  }
  return found;
}
