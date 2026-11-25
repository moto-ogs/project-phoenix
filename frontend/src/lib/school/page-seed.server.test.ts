import type { Session } from "next-auth";
import { beforeEach, expect, it, vi } from "vitest";
import {
  schoolPageSeed,
  schoolClasses,
  schoolNotices,
} from "./page-seed.server";
import { sessionGeneration } from "~/lib/swr/session-generation";
import { schoolPortalKeys } from "~/lib/swr/portal-keys";

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
  user: { id: "7", scope: "school", tenantId: "4" },
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
    if (path === "/school/staff-notices/today") {
      return Response.json({ status: "success", data: [] });
    }
    if (path === "/school/class-day/classes") {
      return Response.json({
        status: "success",
        data: ["not a class-list response"],
      });
    }
    throw new Error(`Unexpected read: ${path}`);
  });
  const seed = await schoolPageSeed([schoolNotices, schoolClasses]).seed;
  expect(snapshot).toHaveBeenCalledWith("school");
  expect(sendBackend.mock.calls.map(([path, token]) => [path, token])).toEqual([
    ["/school/staff-notices/today", signedIn.accessToken],
    ["/school/class-day/classes", signedIn.accessToken],
  ]);
  expect(seed?.generation).toBe(sessionGeneration(session));
  expect(seed?.entries.map((entry) => entry.key)).toEqual([
    schoolPortalKeys.noticesToday(),
    schoolPortalKeys.classDayClasses(),
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
      await schoolPageSeed([schoolNotices, schoolClasses]).seed,
    ).toBeNull();
  expect(sendBackend).not.toHaveBeenCalled();
});
