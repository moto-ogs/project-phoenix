import { act, renderHook, waitFor } from "@testing-library/react";
import { useSession } from "next-auth/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bffJson } from "~/lib/bff-fetch";
import { ApiError } from "~/lib/api-error";
import type { NavigationContext } from "~/lib/contract/active.generated";
import { mutate } from "~/lib/swr/testing";
import { SWRSeedBoundary } from "~/lib/swr/config-boundaries";
import { resetSWRScope, scopedSWRKey, tenantSWRScope } from "~/lib/swr/scope";
import { SWRScopeBoundary } from "~/lib/swr/scope-boundary";
import { stampSWRSeeds, writeSWRSeeds } from "~/lib/swr/seed";
import { supervisionContextKeys } from "~/lib/swr/supervision-keys";
import { deferred } from "~/test/helpers/form-modal-pending";
import { releaseFakeTimers } from "~/test/clock";
import {
  SupervisionProvider,
  useOptionalSupervision,
  useSupervision,
} from "./supervision-context";

vi.unmock("swr");
vi.mock("next-auth/react", () => ({ useSession: vi.fn() }));
vi.mock("~/lib/bff-fetch", () => ({ bffJson: vi.fn() }));
vi.mock("~/lib/tenant-context", () => ({
  useTenantSafe: () => ({
    tenantSlug: "schule",
    tenant: { tenantId: "10", slug: "schule" },
    routingMode: "path",
  }),
  useTenantSlugSafe: () => "schule",
}));

const route = "GET /api/active/supervision-context";
const snapshot: NavigationContext = {
  groups: {
    status: "ok",
    navigation: [
      {
        id: "4",
        name: "Fremde Gruppe",
        via_substitution: false,
        is_personal: false,
      },
      {
        id: "3",
        name: "Bernsteine",
        via_substitution: true,
        is_personal: true,
      },
    ],
    own_group_ids: ["3", "33"],
    own_room_names: ["Gruppenraum"],
  },
  released_rooms: { status: "ok", items: [{ id: "10", name: "Turnhalle" }] },
  sessions: {
    status: "ok",
    own_status: "ok",
    overview_status: "ok",
    items: [
      {
        id: "8",
        room_id: "10",
        room_name: "Turnhalle",
        activity_name: "Sport",
        is_own: true,
      },
      {
        id: "7",
        room_id: "23",
        room_name: "Werkraum",
        activity_name: "Holz",
        is_own: false,
      },
    ],
  },
};
const noSessions: NavigationContext = {
  sessions: {
    status: "ok",
    own_status: "ok",
    overview_status: "forbidden",
    items: [],
  },
};
const bff = vi.mocked(bffJson<"tenant", typeof route>);
function signIn(
  id = "2",
  tenantId = "10",
  scope = "",
  permissions = ["groups:read"],
) {
  vi.mocked(useSession).mockReturnValue({
    data: { user: { id, tenantId, scope, permissions }, expires: "2099-12-31" },
    status: "authenticated",
    update: vi.fn(),
  } as ReturnType<typeof useSession>);
}

function Wrapper({ children }: PropsWithChildren) {
  return (
    <>
      <SWRScopeBoundary expectedTenantId="10" />
      <SupervisionProvider>{children}</SupervisionProvider>
    </>
  );
}

function withSeed(data: NavigationContext) {
  const key = scopedSWRKey(
    tenantSWRScope("schule", "2"),
    supervisionContextKeys.snapshot(),
  );
  const entries = { [key]: data };
  stampSWRSeeds(entries);
  writeSWRSeeds(entries);
  return function Seeded({ children }: PropsWithChildren) {
    return (
      <SWRSeedBoundary seed={{ fallback: entries, cacheData: {} }}>
        <Wrapper>{children}</Wrapper>
      </SWRSeedBoundary>
    );
  };
}

beforeEach(() => {
  resetSWRScope({ revalidate: false });
  signIn();
  bff.mockReset();
  bff.mockResolvedValue(snapshot);
});
afterEach(() => resetSWRScope({ revalidate: false }));

describe("staff supervision SWR binding", () => {
  it("uses personal filters and own sessions from the complete seed without reading on mount", async () => {
    const { result } = renderHook(useSupervision, {
      wrapper: withSeed(snapshot),
    });
    expect(result.current.groups.map((group) => group.name)).toEqual([
      "Bernsteine",
      "Fremde Gruppe",
    ]);
    expect(result.current.ownGroupIds).toEqual(["3", "33"]);
    expect(result.current.ownSessions.map((session) => session.id)).toEqual([
      "8",
    ]);
    expect(result.current.ownSupervision).toBe(true);
    await act(async () => {});
    expect(bff).toHaveBeenCalledTimes(0);
  });

  it("fills a cold cache once, even without groups:read", async () => {
    signIn("2", "10", "", ["schedules:read"]);
    bff.mockResolvedValue({
      ...snapshot,
      groups: {
        status: "forbidden",
        navigation: null,
        own_group_ids: null,
        own_room_names: null,
      },
      sessions: {
        ...snapshot.sessions!,
        overview_status: "forbidden",
        items: [snapshot.sessions!.items![0]!],
      },
    });
    const { result } = renderHook(useSupervision, { wrapper: Wrapper });
    await waitFor(() =>
      expect(result.current.ownSessions.map((session) => session.id)).toEqual([
        "8",
      ]),
    );
    expect(result.current.groups).toEqual([]);
    expect(bff.mock.calls).toEqual([["tenant", route, undefined]]);
  });

  it("coalesces a mixed invalidation and preserves unrequested data", async () => {
    const { result } = renderHook(useSupervision, {
      wrapper: withSeed(snapshot),
    });
    bff.mockResolvedValue({
      groups: snapshot.groups,
      sessions: noSessions.sessions,
    });
    await act(async () => {
      await Promise.all([
        result.current.refresh(["groups"]),
        result.current.refresh(["sessions"]),
      ]);
    });
    expect(bff.mock.calls).toEqual([
      ["tenant", route, { query: { section: ["groups", "sessions"] } }],
    ]);
    expect(result.current.supervisedRooms).toMatchObject([
      { id: "10", isOpenRoom: true },
    ]);
    expect(result.current.ownSupervision).toBe(false);
  });

  it.each([
    ["confirmed write", ["sessions"]],
    ["new SSE burst", ["groups"]],
    ["both", ["groups", "sessions"]],
  ] as const)(
    "awaits one trailing request for %s during a read",
    async (_trigger, sections) => {
      const first = deferred<NavigationContext>();
      const followup = deferred<NavigationContext>();
      bff
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(followup.promise);
      const { result } = renderHook(useSupervision, {
        wrapper: withSeed(snapshot),
      });
      let confirmed = false;
      let waiting = Promise.resolve();
      act(() => {
        void result.current.refresh(["sessions"]);
      });
      await waitFor(() => expect(bff).toHaveBeenCalledTimes(1));
      act(() => {
        waiting = Promise.all(
          sections.map((section) => result.current.refresh([section])),
        ).then(() => {
          confirmed = true;
        });
      });
      await act(async () => {
        first.resolve(noSessions);
      });
      expect(confirmed).toBe(false);
      await waitFor(() => expect(bff).toHaveBeenCalledTimes(2));
      expect(bff.mock.calls[1]).toEqual([
        "tenant",
        route,
        { query: { section: sections } },
      ]);
      await act(async () => {
        followup.resolve({
          groups: snapshot.groups,
          sessions: snapshot.sessions,
        });
        await waiting;
      });
      expect(confirmed).toBe(true);
      expect(bff).toHaveBeenCalledTimes(2);
      expect(result.current.ownSupervision).toBe(
        sections.some((section) => section === "sessions"),
      );
    },
  );

  it("retries an awaited read if a shell seed makes SWR discard it", async () => {
    const first = deferred<NavigationContext>();
    const retry = deferred<NavigationContext>();
    bff.mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise);
    const { result } = renderHook(useSupervision, {
      wrapper: withSeed(snapshot),
    });
    const key = scopedSWRKey(
      tenantSWRScope("schule", "2"),
      supervisionContextKeys.snapshot(),
    );
    let running = Promise.resolve();
    let confirmed = false;
    act(() => {
      running = result.current.refresh(["sessions"]).then(() => {
        confirmed = true;
      });
    });
    await waitFor(() => expect(bff).toHaveBeenCalledTimes(1));
    await act(async () => {
      const seed = { [key]: { ...snapshot } };
      stampSWRSeeds(seed);
      writeSWRSeeds(seed);
    });
    await act(async () => {
      first.resolve(noSessions);
    });
    await waitFor(() => expect(bff).toHaveBeenCalledTimes(2));
    expect(confirmed).toBe(false);
    await act(async () => {
      retry.resolve(noSessions);
      await running;
    });
    expect(confirmed).toBe(true);
    expect(bff).toHaveBeenCalledTimes(2);
    expect(bff).toHaveBeenLastCalledWith("tenant", route, {
      query: { section: ["sessions"] },
    });
    expect(result.current.ownSupervision).toBe(false);
  });

  it("continues if a delayed refusal eviction discards the recovery read", async () => {
    const refused = deferred<NavigationContext>();
    const recovery = deferred<NavigationContext>();
    bff
      .mockReturnValueOnce(refused.promise)
      .mockReturnValueOnce(recovery.promise);
    const { result } = renderHook(useSupervision, {
      wrapper: withSeed(snapshot),
    });
    const key = scopedSWRKey(
      tenantSWRScope("schule", "2"),
      supervisionContextKeys.snapshot(),
    );
    let queued = Promise.resolve();
    act(() => {
      void result.current.refresh(["sessions"]);
    });
    await waitFor(() => expect(bff).toHaveBeenCalledTimes(1));
    act(() => {
      queued = result.current.refresh(["groups"]);
    });
    await act(async () => {
      refused.reject(new ApiError("Access refused", 403));
    });
    await waitFor(() => expect(bff).toHaveBeenCalledTimes(2));
    // The same SWR cache mutation the refusal withdrawal performs.
    await act(async () => {
      await mutate(key, undefined, { revalidate: false });
    });
    await act(async () => {
      recovery.resolve(noSessions);
      await queued;
    });
    expect(bff).toHaveBeenCalledTimes(3);
    expect(bff).toHaveBeenLastCalledWith("tenant", route, undefined);
    expect(result.current.ownSupervision).toBe(true);
  });

  it("joins a running full read for poll and transport recovery", async () => {
    const full = deferred<NavigationContext>();
    bff.mockReturnValueOnce(full.promise);
    const { result } = renderHook(useSupervision, {
      wrapper: withSeed(snapshot),
    });
    let recovery = Promise.resolve();
    let poll = Promise.resolve();
    act(() => {
      poll = result.current.refresh(undefined, "reconcile");
    });
    await waitFor(() => expect(bff).toHaveBeenCalledTimes(1));
    act(() => {
      recovery = result.current.refresh(undefined, "reconcile");
    });
    await act(async () => {
      full.resolve(snapshot);
      await Promise.all([poll, recovery]);
    });
    expect(bff.mock.calls).toEqual([["tenant", route, undefined]]);
  });

  it("drops denied groups and foreign sessions but retains authorized own sessions and rooms", async () => {
    const { result } = renderHook(useSupervision, {
      wrapper: withSeed(snapshot),
    });
    bff.mockResolvedValueOnce({
      groups: { ...snapshot.groups!, status: "forbidden" },
      sessions: { ...snapshot.sessions!, overview_status: "unavailable" },
    });
    await act(async () => result.current.refresh(["groups", "sessions"]));
    expect(result.current.ownGroupIds).toEqual([]);
    expect(result.current.supervisedRooms.map((room) => room.id)).toEqual([
      "10",
    ]);
    expect(result.current.ownSessions.map((session) => session.id)).toEqual([
      "8",
    ]);
    expect(result.current.overviewEnabled).toBe(false);
    expect(result.current.sessionsLoadFailed).toBe(true);
    bff.mockRejectedValueOnce(new Error("network failed"));
    await act(async () => result.current.refresh(["groups"]));
    expect(result.current.groupsLoadFailed).toBe(true);
    expect(result.current.ownSessions.map((session) => session.id)).toEqual([
      "8",
    ]);
  });

  it("discards a late response and does not start a read while school or portal is inconsistent", async () => {
    const first = deferred<NavigationContext>();
    bff.mockReturnValueOnce(first.promise);
    const { result, rerender } = renderHook(useSupervision, {
      wrapper: withSeed(snapshot),
    });
    const retainedRefresh = result.current.refresh;
    act(() => {
      void retainedRefresh(["sessions"]);
    });
    await waitFor(() => expect(bff).toHaveBeenCalledTimes(1));

    signIn("2", "20");
    rerender();
    expect(result.current.groups).toEqual([]);
    signIn("2", "10", "school");
    rerender();
    await act(async () => {
      await retainedRefresh(["groups"]);
      first.resolve(snapshot);
    });
    expect(result.current.ownSupervision).toBe(false);
    expect(bff).toHaveBeenCalledTimes(1);

    signIn("5");
    bff.mockResolvedValueOnce({ ...snapshot, ...noSessions });
    rerender();
    await waitFor(() => expect(bff).toHaveBeenCalledTimes(2));
    expect(result.current.ownSupervision).toBe(false);
  });

  it("withdraws all data on a read refusal and loads a full snapshot to recover", async () => {
    const { result } = renderHook(useSupervision, {
      wrapper: withSeed(snapshot),
    });
    expect(result.current.ownSupervision).toBe(true);
    bff.mockRejectedValueOnce(new ApiError("Access refused", 403));
    await act(async () => result.current.refresh(["sessions"]));
    expect(result.current.supervisedRooms).toEqual([]);
    bff.mockRejectedValueOnce(new ApiError("Temporarily unavailable", 503));
    await act(async () => result.current.refresh(["groups"]));
    expect(result.current.supervisedRooms).toEqual([]);
    expect(bff).toHaveBeenLastCalledWith("tenant", route, undefined);
    bff.mockResolvedValueOnce({ ...snapshot, ...noSessions });
    await act(async () => result.current.refresh(["sessions"]));
    expect(bff).toHaveBeenLastCalledWith("tenant", route, undefined);
    expect(result.current.ownSupervision).toBe(false);
    expect(result.current.groups).toHaveLength(2);
  });

  it("keeps the five-minute visible fallback without a stream", async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, "visibilityState", "get");
    try {
      renderHook(useSupervision, { wrapper: withSeed(snapshot) });
      visibility.mockReturnValue("hidden");
      await act(async () => vi.advanceTimersByTimeAsync(5 * 60_000));
      expect(bff).toHaveBeenCalledTimes(0);
      visibility.mockReturnValue("visible");
      await act(async () => vi.advanceTimersByTimeAsync(5 * 60_000));
      expect(bff.mock.calls).toEqual([["tenant", route, undefined]]);
    } finally {
      visibility.mockRestore();
      releaseFakeTimers();
    }
  });

  it("does not load outside the staff provider", () => {
    const { result } = renderHook(useOptionalSupervision);
    expect(result.current.groups).toEqual([]);
    expect(bff).toHaveBeenCalledTimes(0);
  });
});
