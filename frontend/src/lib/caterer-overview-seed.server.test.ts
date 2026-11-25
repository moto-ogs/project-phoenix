import { beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { loadCatererOverviewSeed } from "./caterer-overview-seed.server";
import { catererKeys } from "./swr/portal-keys";

const { snapshot, send } = vi.hoisted(() => ({
  snapshot: vi.fn(),
  send: vi.fn(),
}));
vi.mock("./portal-session-snapshot.server", () => ({
  readPortalSessionSnapshot: snapshot,
}));
vi.mock("./backend-client.server", async (original) => ({
  ...(await original<typeof import("./backend-client.server")>()),
  sendBackend: send,
}));

const from = "2026-09-07";
const to = "2026-09-11";
const key = catererKeys.overview(from, to);
const session: Session = {
  user: { id: "7", scope: "caterer" },
  expires: "2099-01-01",
};
beforeEach(() => vi.resetAllMocks());

it("seeds the selected window with one compact read, even with no schools", async () => {
  snapshot.mockResolvedValue({
    session,
    accessToken: "test",
    notBooked: false,
  });
  send.mockResolvedValue(
    Response.json({
      status: "success",
      data: { caterer_name: "Küche", schools: [] },
    }),
  );
  const seed = await loadCatererOverviewSeed(from, to, key);
  expect(snapshot).toHaveBeenCalledWith("caterer");
  expect(seed?.entries.map((entry) => entry.key)).toEqual([key]);
  expect(await seed?.entries[0]?.value).toEqual({
    catererName: "Küche",
    schools: [],
  });
  expect(send.mock.calls.map(([path]) => path)).toEqual([
    "/caterer/schools?from=2026-09-07&to=2026-09-11",
  ]);
});

it.each([
  null,
  {
    session: { ...session, user: { id: "7", scope: "parent" } },
    accessToken: "test",
  },
  { session: { ...session, error: "RefreshTokenError" }, accessToken: "test" },
])("does not seed outside a live caterer session", async (state) => {
  snapshot.mockResolvedValue(state);
  expect(await loadCatererOverviewSeed(from, to, key)).toBeNull();
  expect(send).not.toHaveBeenCalled();
});
