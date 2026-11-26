import { hasPermission, isAdmin } from "~/lib/auth-utils";
import * as catererContract from "~/lib/contract/meal-caterer.generated";
import * as mealContract from "~/lib/contract/meal-plan.generated";
import { berlinTodayISO } from "~/lib/date-helpers";
import { mapMealCaterer } from "~/lib/meal-caterer-api";
import {
  mapDailyMealList,
  mapMealOrders,
  mapMealPlanDay,
} from "~/lib/meal-plan-api";
import { readContract, seedOf, seedRead } from "~/lib/server-seed.server";
import type { ServerSeedEntry } from "~/lib/swr/server-seed";
import { readTenantPageContext } from "~/lib/tenant-page-seed.server";
import MealPlanContent from "./page-content";
import { MealPlanSeed } from "./page-seed";
import { mealPlanSeedKeys } from "./seed-keys";

async function loadMealPlanSeed(slug: string) {
  const context = await readTenantPageContext(slug, "mittagessen");
  if (!context) return null;
  const builtAt = Date.now();
  const { token, session, snapshot, tenant } = context;
  const { from, to, date, plan, cancellations, orders, participants, caterer } =
    mealPlanSeedKeys(berlinTodayISO());
  const entries: ServerSeedEntry[] = [];
  const admin = isAdmin(session);
  const readsPlan = admin || hasPermission(session, "meals:read");
  if (readsPlan && tenant.mealPlanEnabled === true) {
    entries.push({
      key: plan,
      render: true,
      value: seedRead("mealPlanWeek", async (signal) =>
        (
          await readContract(mealContract.routes["GET /api/meal-plan/days"], {
            token,
            signal,
            query: { week_start: from },
          })
        ).data.map(mapMealPlanDay),
      ),
    });
    entries.push({
      key: cancellations,
      render: true,
      value: seedRead(
        "mealCancellations",
        async (signal) =>
          (
            await readContract(
              mealContract.routes["GET /api/meal-plan/cancellations"],
              {
                token,
                signal,
                query: { from, to },
              },
            )
          ).data,
      ),
    });
  }
  if (tenant.mealRegistrationEnabled === true) {
    if (readsPlan) {
      entries.push({
        key: orders,
        value: seedRead("mealOrdersWeek", async (signal) =>
          mapMealOrders(
            (
              await readContract(
                mealContract.routes["GET /api/meal-plan/orders"],
                { token, signal, query: { from, to } },
              )
            ).data,
          ),
        ),
      });
    }
    if (
      admin ||
      hasPermission(session, "meals:orders") ||
      hasPermission(session, "meals:register")
    ) {
      entries.push({
        key: participants,
        value: seedRead("dailyMealParticipants", async (signal) =>
          mapDailyMealList(
            (
              await readContract(
                mealContract.routes["GET /api/meal-plan/participants"],
                { token, signal, query: { date } },
              )
            ).data,
          ),
        ),
      });
    }
    if (admin || hasPermission(session, "meals:manage")) {
      entries.push({
        key: caterer,
        value: seedRead("schoolMealCaterer", async (signal) =>
          mapMealCaterer(
            (
              await readContract(
                catererContract.routes["GET /api/meal-caterer/"],
                { token, signal },
              )
            ).data,
          ),
        ),
      });
    }
  }
  return seedOf(snapshot, entries, builtAt);
}

export default async function MealPlanPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  const seed = loadMealPlanSeed(tenant).catch(() => null);
  return (
    <MealPlanSeed seed={seed}>
      <MealPlanContent />
    </MealPlanSeed>
  );
}
