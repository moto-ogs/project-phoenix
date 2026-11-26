"use client";

import type { ReactNode } from "react";
import {
  initialMealBillingMonth,
  type MealBillingSummary,
} from "~/lib/meal-billing-api";
import { SWRServerSeed, type ServerSeedInput } from "~/lib/swr/server-seed";
import { tenantDailyKeys } from "~/lib/swr/tenant-daily-keys";

const months = tenantDailyKeys.mealBillingMonths();
const monthClaims = {
  key: months,
  derive: (rows: MealBillingSummary[]) => {
    const month = initialMealBillingMonth(rows);
    return month ? [tenantDailyKeys.mealBillingMonth(month)] : [];
  },
};

export function MealBillingSeed({
  seed,
  children,
}: {
  seed: ServerSeedInput;
  children: ReactNode;
}) {
  return (
    <SWRServerSeed
      seed={seed}
      claims={[months]}
      claimsFrom={monthClaims}
      render
    >
      {children}
    </SWRServerSeed>
  );
}
