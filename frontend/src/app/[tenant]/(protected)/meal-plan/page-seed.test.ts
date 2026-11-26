import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerSeed } from "~/lib/swr/server-seed";
import { tenantListKeys } from "~/lib/swr/tenant-list-keys";

const state = vi.hoisted(() => ({
  context: undefined as unknown,
  readTenantPageContext: vi.fn(),
  readContract: vi.fn(),
}));

vi.mock("~/lib/auth-utils", () => ({
  hasPermission: () => false,
  isAdmin: () => true,
}));
vi.mock("~/lib/tenant-page-seed.server", () => ({
  readTenantPageContext: state.readTenantPageContext,
}));
vi.mock("~/lib/server-seed.server", async (original) => ({
  ...(await original<typeof import("~/lib/server-seed.server")>()),
  readContract: state.readContract,
}));
vi.mock("./page-content", () => ({ default: () => null }));

import MealPlanPage from "./page";
import { mealPlanSeedClaims } from "./page-seed";
import { mealPlanSeedKeys } from "./seed-keys";

const today = "2026-09-09";
const keys = mealPlanSeedKeys(today);

beforeEach(() => {
  state.context = {
    token: "seed-token",
    session: {
      expires: "2099-01-01",
      user: { id: "7", tenantId: "1", roles: ["admin"], permissions: [] },
    },
    snapshot: {
      accessToken: "seed-token",
      notBooked: false,
      session: {
        expires: "2099-01-01",
        user: {
          id: "7",
          tenantId: "1",
          roles: ["admin"],
          permissions: [],
        },
      },
    },
    tenant: { mealPlanEnabled: true, mealRegistrationEnabled: false },
  };
  state.readTenantPageContext.mockReset();
  state.readTenantPageContext.mockResolvedValue(state.context);
  state.readContract.mockReset();
  state.readContract.mockImplementation(async (route: { pattern: string }) => {
    if (route.pattern === "/api/meal-plan/days") return { data: [] };
    if (route.pattern === "/api/meal-plan/cancellations")
      return {
        data: [{ date: "2026-09-09", reason: "Der Caterer liefert nicht." }],
      };
    throw new Error(`unexpected route ${route.pattern}`);
  });
});

describe("meal plan first-display seed", () => {
  it("claims the cancellation key for the week the page reads", () => {
    expect(mealPlanSeedClaims(today)).toEqual([
      keys.plan,
      keys.cancellations,
      keys.orders,
      keys.participants,
      keys.caterer,
    ]);
    expect(keys.cancellations).toBe(
      tenantListKeys.mealCancellations("2026-09-07"),
    );
  });

  it("renders this week's meal cancellations from the server seed", async () => {
    const page = await MealPlanPage({
      params: Promise.resolve({ tenant: "school-a" }),
    });
    const seed = (await page.props.seed) as ServerSeed;
    const cancellation = seed.entries.find(
      (entry) => entry.key === keys.cancellations,
    );

    expect(cancellation).toMatchObject({
      key: keys.cancellations,
      render: true,
    });
    expect(await cancellation?.value).toEqual([
      { date: "2026-09-09", reason: "Der Caterer liefert nicht." },
    ]);
    expect(state.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ pattern: "/api/meal-plan/cancellations" }),
      expect.objectContaining({
        token: "seed-token",
        query: { from: "2026-09-07", to: "2026-09-11" },
      }),
    );
  });
});
