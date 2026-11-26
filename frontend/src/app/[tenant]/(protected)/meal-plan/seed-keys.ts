import { parseISODate } from "~/lib/date-helpers";
import {
  mealParticipantDate,
  mondayOf,
  workWeekDates,
} from "~/lib/meal-plan-api";
import { tenantContactKeys } from "~/lib/swr/tenant-contact-keys";
import { tenantListKeys } from "~/lib/swr/tenant-list-keys";

export function mealPlanSeedKeys(today: string) {
  const from = mondayOf(parseISODate(today));
  const to = workWeekDates(from)[4]!;
  const date = mealParticipantDate(today);
  return {
    from,
    to,
    date,
    plan: tenantListKeys.mealPlanWeek(from),
    orders: tenantContactKeys.mealOrders(from, to),
    participants: tenantContactKeys.mealParticipantsDay(date, false),
    caterer: tenantContactKeys.mealCaterer(),
  };
}
