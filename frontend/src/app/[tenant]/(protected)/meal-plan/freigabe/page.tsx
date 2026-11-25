import { hasPermission, isAdmin } from "~/lib/auth-utils";
import { routes } from "~/lib/contract/meal-billing-months.generated";
import {
  initialMealBillingMonth,
  mapMealBillingSummary,
  monthFromBackend,
} from "~/lib/meal-billing-api";
import { readContract, seedOf, seedRead } from "~/lib/server-seed.server";
import type { ServerSeedEntry } from "~/lib/swr/server-seed";
import { tenantDailyKeys } from "~/lib/swr/tenant-daily-keys";
import { readTenantPageContext } from "~/lib/tenant-page-seed.server";
import MealBillingContent from "./page-content";
import { MealBillingSeed } from "./page-seed";

async function loadMealBillingSeed(slug: string) {
  const builtAt = Date.now();
  const context = await readTenantPageContext(slug, "mittagessen");
  if (!context || context.tenant.mealRegistrationEnabled !== true) return null;
  const { token, session, snapshot } = context;
  if (
    !isAdmin(session) &&
    !(
      hasPermission(session, "meals:manage") &&
      hasPermission(session, "meals:orders")
    )
  )
    return null;
  const months = seedRead("mealBillingMonths", async (signal) =>
    (
      await readContract(routes["GET /api/meal-billing-months/"], {
        token,
        signal,
      })
    ).data.map(mapMealBillingSummary),
  );
  const entries: ServerSeedEntry[] = [
    { key: tenantDailyKeys.mealBillingMonths(), value: months, render: true },
  ];
  const month = initialMealBillingMonth(await months);
  if (month)
    entries.push({
      key: tenantDailyKeys.mealBillingMonth(month),
      value: seedRead("mealBillingMonth", async (signal) =>
        monthFromBackend(
          (
            await readContract(routes["GET /api/meal-billing-months/{month}"], {
              token,
              signal,
              params: { month },
            })
          ).data,
        ),
      ),
    });
  return seedOf(snapshot, entries, builtAt);
}

export default async function MealBillingPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  const seed = loadMealBillingSeed(tenant).catch(() => null);
  return (
    <MealBillingSeed seed={seed}>
      <MealBillingContent />
    </MealBillingSeed>
  );
}
