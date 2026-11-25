import type { Session } from "next-auth";
import { beforeEach, expect, it, vi } from "vitest";
import {
  operatorPageSeed,
  organizationSummaries,
  provisioningStats,
} from "./page-seed.server";
import { sessionGeneration } from "~/lib/swr/session-generation";
import { operatorProvisioningKeys } from "~/lib/swr/portal-keys";

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
  user: { id: "7", scope: "platform" },
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
    if (path === "/operator/organizations/summaries") {
      return Response.json({ status: "success", data: [] });
    }
    if (path === "/operator/stats") {
      return Response.json({
        status: "success",
        data: ["not a stats response"],
      });
    }
    throw new Error(`Unexpected read: ${path}`);
  });
  const seed = await operatorPageSeed([
    organizationSummaries,
    provisioningStats,
  ]).seed;
  expect(snapshot).toHaveBeenCalledWith("operator");
  expect(sendBackend.mock.calls.map(([path, token]) => [path, token])).toEqual([
    ["/operator/organizations/summaries", signedIn.accessToken],
    ["/operator/stats", signedIn.accessToken],
  ]);
  expect(seed?.generation).toBe(sessionGeneration(session));
  expect(seed?.entries.map((entry) => entry.key)).toEqual([
    operatorProvisioningKeys.organizationSummaries(),
    operatorProvisioningKeys.provisioningStats(),
  ]);
  expect(await seed?.entries[0]?.value).toEqual([]);
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
    expect(
      await operatorPageSeed([organizationSummaries, provisioningStats]).seed,
    ).toBeNull();
  expect(sendBackend).not.toHaveBeenCalled();
});
