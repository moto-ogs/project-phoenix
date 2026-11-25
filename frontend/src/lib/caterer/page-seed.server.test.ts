import type { Session } from "next-auth";
import { beforeEach, expect, it, vi } from "vitest";
import { loadCatererPageSeed } from "./page-seed.server";
import { defaultPeriod, periodDays } from "~/lib/caterer-period";
import { catererKeys } from "~/lib/swr/portal-keys";
import { sessionGeneration } from "~/lib/swr/session-generation";
import { TEST_CLOCK_TODAY } from "~/test/clock";

const { snapshot, sendBackend } = vi.hoisted(() => ({
  snapshot: vi.fn(),
  sendBackend: vi.fn(),
}));

vi.mock("~/lib/portal-session-snapshot.server", () => ({
  readPortalSessionSnapshot: snapshot,
}));
vi.mock("~/lib/backend-client.server", async (original) => ({
  ...(await original<typeof import("~/lib/backend-client.server")>()),
  sendBackend,
}));

const session: Session = {
  user: { id: "7", scope: "caterer" },
  expires: "2099-01-01",
};
const signedIn = {
  session,
  accessToken: "server-only-token",
  notBooked: false,
};
const schools = [
  { id: "4", name: "Schule Vier" },
  { id: "6", name: "Schule Sechs" },
];
const days = periodDays(defaultPeriod(TEST_CLOCK_TODAY), TEST_CLOCK_TODAY);
const from = days[0]!;
const to = days[days.length - 1]!;
const ordersKey = catererKeys.orders(["4", "6"], from, to);

beforeEach(() => {
  snapshot.mockReset().mockResolvedValue(signedIn);
  sendBackend.mockReset();
});

function answerSchoolsAndOrders(refusedSchool?: string) {
  sendBackend.mockImplementation(async (path: string) => {
    if (path === "/caterer/schools") {
      return Response.json({
        status: "success",
        data: { caterer_name: "Küche", schools },
      });
    }
    const school = schools.find(
      ({ id }) =>
        path === `/caterer/schools/${id}/orders?from=${from}&to=${to}`,
    );
    if (!school) throw new Error(`Unexpected read: ${path}`);
    if (school.id === refusedSchool) return new Response(null, { status: 403 });
    return Response.json({
      status: "success",
      data: {
        school,
        delivery_address: "",
        format_version: 1,
        rhythm: "weekly",
        detail: "total",
        days: null,
      },
    });
  });
}

it("seeds the default window only for the schools in the current supply list", async () => {
  answerSchoolsAndOrders();
  const seed = await loadCatererPageSeed();
  expect(snapshot).toHaveBeenCalledWith("caterer");
  expect(seed?.generation).toBe(sessionGeneration(session));
  expect(seed?.entries.map((entry) => entry.key)).toEqual([
    catererKeys.schools(),
    ordersKey,
  ]);
  expect(await seed?.entries[0]?.value).toEqual({
    catererName: "Küche",
    schools,
  });
  expect(await seed?.entries[1]?.value).toMatchObject({
    orders: { "4": { school: schools[0] }, "6": { school: schools[1] } },
    failures: {},
  });
  expect(sendBackend.mock.calls.map(([path, token]) => [path, token])).toEqual([
    ["/caterer/schools", signedIn.accessToken],
    [`/caterer/schools/4/orders?from=${from}&to=${to}`, signedIn.accessToken],
    [`/caterer/schools/6/orders?from=${from}&to=${to}`, signedIn.accessToken],
  ]);
});

it("leaves only the orders window for the browser after a supply refusal", async () => {
  answerSchoolsAndOrders("6");
  const seed = await loadCatererPageSeed();
  expect(seed?.entries.map((entry) => entry.key)).toEqual([
    catererKeys.schools(),
    ordersKey,
  ]);
  expect(await seed?.entries[0]?.value).toEqual({
    catererName: "Küche",
    schools,
  });
  expect(await seed?.entries[1]?.value).toBeUndefined();
});

it("never starts order reads when the supply list could not be authorized", async () => {
  sendBackend.mockImplementation(
    async () => new Response(null, { status: 403 }),
  );
  const seed = await loadCatererPageSeed();
  expect(seed?.entries.map((entry) => entry.key)).toEqual([
    catererKeys.schools(),
  ]);
  expect(await seed?.entries[0]?.value).toBeUndefined();
  expect(sendBackend).toHaveBeenCalledExactlyOnceWith(
    "/caterer/schools",
    signedIn.accessToken,
    expect.anything(),
  );
});

it("ignores a non-caterer session before any read", async () => {
  snapshot.mockResolvedValueOnce({
    ...signedIn,
    session: { ...session, user: { id: "7", scope: "school", tenantId: "4" } },
  });
  expect(await loadCatererPageSeed()).toBeNull();
  expect(sendBackend).not.toHaveBeenCalled();
});
