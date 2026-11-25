import type { Session } from "next-auth";
import { beforeEach, expect, it, vi } from "vitest";
import { traegerPageSeed, traegerSchools, profile } from "./page-seed.server";
import { sessionGeneration } from "~/lib/swr/session-generation";
import { traegerKeys } from "~/lib/swr/traeger-keys";

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
  user: { id: "7", scope: "org", orgId: "3" },
  expires: "2099-01-01",
};
const signedIn = {
  session,
  accessToken: "server-only-token",
  notBooked: false,
};

beforeEach(() => {
  snapshot.mockReset().mockResolvedValue(signedIn);
  sendBackend.mockReset();
});

it("keeps the complete value and drops only the key rejected by its decoder", async () => {
  sendBackend.mockImplementation(async (path: string) => {
    if (path === "/traeger/schools/") {
      return Response.json({
        status: "success",
        data: [
          {
            id: "6",
            name: "Muster",
            slug: "muster",
            subdomain: "muster",
            city: "Münster",
          },
        ],
      });
    }
    if (path === "/traeger/profile/") {
      return Response.json({ status: "success", data: ["not a profile"] });
    }
    throw new Error(`Unexpected read: ${path}`);
  });
  const seed = await traegerPageSeed([traegerSchools, profile]).seed;
  expect(snapshot).toHaveBeenCalledWith("traeger");
  expect(sendBackend.mock.calls.map(([path, token]) => [path, token])).toEqual([
    ["/traeger/schools/", signedIn.accessToken],
    ["/traeger/profile/", signedIn.accessToken],
  ]);
  expect(seed?.generation).toBe(sessionGeneration(session));
  expect(seed?.entries.map((entry) => entry.key)).toEqual([
    traegerKeys.schools(),
    traegerKeys.profile(),
  ]);
  expect(await seed?.entries[0]?.value).toEqual([
    {
      id: "6",
      name: "Muster",
      slug: "muster",
      subdomain: "muster",
      city: "Münster",
    },
  ]);
  expect(await seed?.entries[1]?.value).toBeUndefined();
});

it("reads no data with a different portal, a dead session or a missing booking", async () => {
  snapshot.mockResolvedValueOnce({
    ...signedIn,
    session: { ...session, user: { ...session.user, scope: "parent" } },
  });
  snapshot.mockResolvedValueOnce(null);
  snapshot.mockResolvedValueOnce({ ...signedIn, notBooked: true });
  for (let i = 0; i < 3; i += 1)
    expect(await traegerPageSeed([traegerSchools, profile]).seed).toBeNull();
  expect(sendBackend).not.toHaveBeenCalled();
});

it("does not start a dependent billing read when the module is not booked", async () => {
  snapshot.mockResolvedValueOnce({
    ...signedIn,
    session: {
      ...session,
      user: { ...session.user, permissions: ["traeger_billing:manage"] },
    },
  });
  sendBackend.mockImplementation(async (path: string) => {
    if (path !== "/traeger/organization/")
      throw new Error(`Unexpected read: ${path}`);
    return Response.json({
      status: "success",
      data: {
        id: "3",
        name: "Muster",
        test_system: false,
        federal_states: [],
        booked_modules: [],
      },
    });
  });
  const after = vi.fn(async () => true);
  const load = vi.fn(async () => "unexpected");
  const key = traegerKeys.billingTerms();
  const { seed, claims } = traegerPageSeed([
    {
      key,
      module: "elternbeitraege",
      permission: "traeger_billing:manage",
      load,
      after,
    },
  ]);
  expect(claims).toEqual([key]);
  const built = await seed;
  expect(built?.entries[0]?.key).toBe(key);
  expect(await built?.entries[0]?.value).toBeUndefined();
  expect(sendBackend).toHaveBeenCalledExactlyOnceWith(
    "/traeger/organization/",
    signedIn.accessToken,
    expect.anything(),
  );
  expect(after).not.toHaveBeenCalled();
  expect(load).not.toHaveBeenCalled();
});
