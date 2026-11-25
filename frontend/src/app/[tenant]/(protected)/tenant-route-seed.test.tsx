import type { Session } from "next-auth";
import { isValidElement, type ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModuleKey } from "~/lib/modules";
import type { PortalSessionSnapshot } from "~/lib/portal-session-snapshot.server";
import { messageKeys, weekProtocolKeys } from "~/lib/swr/portal-keys";
import { groupKeys } from "~/lib/swr/groups-keys";
import type { ServerSeed } from "~/lib/swr/server-seed";

const state = vi.hoisted(() => ({
  snapshot: null as PortalSessionSnapshot | null,
  modules: [] as ModuleKey[],
  host: "",
  schoolId: "",
  send: vi.fn(),
  openCare: false,
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: state.host }),
}));
vi.mock("~/lib/portal-session-snapshot.server", () => ({
  readPortalSessionSnapshot: async () => state.snapshot,
}));
vi.mock("~/lib/tenant-resolve.server", () => ({
  resolveTenantCached: async () => ({ settings: null }),
}));
vi.mock("~/lib/tenant-api", async (original) => ({
  ...(await original<typeof import("~/lib/tenant-api")>()),
  projectTenantResolve: () => ({
    tenantId: state.schoolId,
    subdomain: "school-a",
    bookedModules: state.modules,
    groupMode: state.openCare ? "open_care" : "fixed_groups",
  }),
}));
vi.mock("~/lib/backend-client.server", async (original) => ({
  ...(await original<typeof import("~/lib/backend-client.server")>()),
  sendBackend: state.send,
}));
vi.mock("./messages/groups/page-content", () => ({ default: () => null }));
vi.mock("./wochenprotokolle/page-content", () => ({ default: () => null }));
vi.mock("./ogs-groups/page-content", () => ({ default: () => null }));

import GroupMessagesPage from "./messages/groups/page";
import OGSGroupPage from "./ogs-groups/page";
import { TenantRouteSeed } from "./tenant-route-seed";
import WeekProtocolsPage from "./wochenprotokolle/page";

const params = Promise.resolve({ tenant: "school-a" });

async function readSeed(
  page: ReturnType<typeof GroupMessagesPage>,
): Promise<ServerSeed | undefined> {
  const route = await page;
  const result = await TenantRouteSeed(
    route.props as ComponentProps<typeof TenantRouteSeed>,
  );
  return isValidElement<{ seed?: ServerSeed }>(result)
    ? result.props.seed
    : undefined;
}

function setSession(
  permissions: string[],
  scope?: Session["user"]["scope"],
): void {
  state.snapshot = {
    session: {
      expires: "2099-01-01",
      user: { id: "7", tenantId: "1", roles: ["staff"], permissions, scope },
    },
    notBooked: false,
    accessToken: "test",
  };
}

beforeEach(() => {
  vi.stubEnv("TENANT_DOMAIN", "localhost");
  setSession(["users:read"]);
  state.modules = ["eltern_app"];
  state.host = "school-a.localhost:3000";
  state.schoolId = "1";
  state.openCare = false;
  state.send.mockReset();
  state.send.mockImplementation(async () =>
    Response.json({ status: "success", data: [] }),
  );
});

describe("tenant route seeds", () => {
  it("starts only the requested group and leaves a refusal to the browser", async () => {
    setSession(["users:read", "groups:read"]);
    state.send.mockResolvedValueOnce(new Response(null, { status: 403 }));
    const seed = await readSeed(
      OGSGroupPage({
        params,
        searchParams: Promise.resolve({ group: ["11", "22"] }),
      }),
    );
    expect(seed?.entries.map((entry) => entry.key)).toEqual([
      groupKeys.live("11"),
    ]);
    expect(await seed?.entries[0]?.value).toBeUndefined();
    expect(state.send).toHaveBeenCalledExactlyOnceWith(
      "/api/students/ogs-group-live?group_id=11",
      "test",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("does not guess the stored group or seed when an open-care school redirects", async () => {
    setSession(["users:read", "groups:read"]);
    expect(
      await readSeed(
        OGSGroupPage({ params, searchParams: Promise.resolve({}) }),
      ),
    ).toBeUndefined();
    state.openCare = true;
    expect(
      await readSeed(
        OGSGroupPage({
          params,
          searchParams: Promise.resolve({ group: "11" }),
        }),
      ),
    ).toBeUndefined();
    expect(state.send).not.toHaveBeenCalled();
  });

  it("starts the group inbox read under the exact reader key", async () => {
    const seed = await readSeed(GroupMessagesPage({ params }));
    expect(seed?.entries.map((entry) => entry.key)).toEqual([
      messageKeys.groupMessages(),
    ]);
    expect(await seed?.entries[0]?.value).toEqual([]);
    expect(state.send).toHaveBeenCalledExactlyOnceWith(
      "/api/messages/group-threads",
      "test",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it.each(["host", "school", "scope", "module", "permission"] as const)(
    "starts no protected read on a %s mismatch",
    async (kind) => {
      if (kind === "host") state.host = "school-b.localhost:3000";
      if (kind === "school") state.schoolId = "2";
      if (kind === "scope") setSession(["users:read"], "school");
      if (kind === "module") state.modules = [];
      if (kind === "permission") setSession([]);
      expect(await readSeed(GroupMessagesPage({ params }))).toBeUndefined();
      expect(state.send).not.toHaveBeenCalled();
    },
  );

  it("claims only the visible group filter and leaves a failed list to its browser retry", async () => {
    setSession(["groups:update"]);
    state.send.mockResolvedValueOnce(new Response(null, { status: 503 }));
    const seed = await readSeed(
      WeekProtocolsPage({
        params,
        searchParams: Promise.resolve({ group: ["11", "22"] }),
      }),
    );
    expect(seed?.entries.map((entry) => entry.key)).toEqual([
      weekProtocolKeys.list("11"),
    ]);
    expect(await seed?.entries[0]?.value).toBeUndefined();
    expect(state.send).toHaveBeenCalledExactlyOnceWith(
      "/api/week-protocols/?group_id=11",
      "test",
      expect.objectContaining({ method: "GET" }),
    );
  });
});
