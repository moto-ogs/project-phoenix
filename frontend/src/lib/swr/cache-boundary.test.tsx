import { act, render, renderHook } from "@testing-library/react";
import { waitFor } from "~/test/wait-for-state";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { SWRConfig, useSWRConfig, type Middleware } from "swr";
import { useOwnTimeRefresh } from "~/lib/hooks/use-own-time-refresh";
import { timeTrackingKeys } from "./portal-keys";
import { SWRSeedBoundary } from "./config-boundaries";
import {
  MUTATION_OPTION_KEYS,
  READER_OPTION_KEYS,
  useTenantMutate,
} from "./hooks";
import { _resetSWRFallbacksForTests } from "./generation";
import { messageKeys } from "./portal-keys";
import { roomKeys } from "./rooms-keys";
import { resetSWRScope, resumeSWRSession, suspendSWRSession } from "./scope";
import {
  mutate,
  useInvalidateMatching,
  useSWRAuth,
  useSWRSeedFrom,
  useTenantMutateMatching,
  writeSWRSeeds,
} from "./index";

vi.unmock("swr");
const { owner } = vi.hoisted(() => ({
  owner: { id: "account-7", scope: "tenant", tenantId: "42" },
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: owner, expires: "2099-01-01" },
    status: "authenticated",
  }),
}));
vi.mock("~/lib/tenant-context", () => ({
  useTenantSlugSafe: () => "school-a",
}));

beforeEach(() => {
  // Every case starts like a fresh page: no stamp released yet (#5223).
  _resetSWRFallbacksForTests();
  resetSWRScope({ revalidate: false });
  resumeSWRSession();
});

const own = (key: string) => `school-a:account-7:${key}`;

// The reviewed public surface (#5007): swr/no-cache-access lets code outside
// ~/lib/swr reach these modules only. A new export lands here in review; none
// may hand out the cache, a provider or a raw mutate.
const PUBLIC_SURFACE: Record<string, () => Promise<object>> = {
  index: () => import("./index"),
  hooks: () => import("./hooks"),
  mutate: () => import("./mutate"),
  "config-boundaries": () => import("./config-boundaries"),
  "scope-boundary": () => import("./scope-boundary"),
  "read-draft": () => import("./read-draft"),
  "course-waitlist-keys": () => import("./course-waitlist-keys"),
  "portal-keys": () => import("./portal-keys"),
  "traeger-keys": () => import("./traeger-keys"),
  "traeger-billing-keys": () => import("./traeger-billing-keys"),
  "traeger-billing-run-keys": () => import("./traeger-billing-run-keys"),
  "traeger-contract-keys": () => import("./traeger-contract-keys"),
  "traeger-staff-keys": () => import("./traeger-staff-keys"),
  "traeger-report-keys": () => import("./traeger-report-keys"),
  "operator-keys": () => import("./operator-keys"),
  "tenant-student-keys": () => import("./tenant-student-keys"),
  "tenant-admin-keys": () => import("./tenant-admin-keys"),
  "tenant-daily-keys": () => import("./tenant-daily-keys"),
  "enrollment-keys": () => import("./enrollment-keys"),
  "tenant-contact-keys": () => import("./tenant-contact-keys"),
  "tenant-list-keys": () => import("./tenant-list-keys"),
  "shell-keys": () => import("./shell-keys"),
  "supervision-keys": () => import("./supervision-keys"),
  supervision: () => import("./supervision"),
  "parent-keys": () => import("./parent-keys"),
  "parent-inbox-keys": () => import("./parent-inbox-keys"),
  "rooms-keys": () => import("./rooms-keys"),
  "groups-keys": () => import("./groups-keys"),
  "staff-keys": () => import("./staff-keys"),
  "me-keys": () => import("./me-keys"),
  rooms: () => import("./rooms"),
  groups: () => import("./groups"),
  staff: () => import("./staff"),
  me: () => import("./me"),
  "search-students-key": () => import("./search-students-key"),
  "room-derived-caches": () => import("./room-derived-caches"),
  optimistic: () => import("./optimistic"),
  "server-seed": () => import("./server-seed"),
  "session-generation": () => import("./session-generation"),
};
const REVIEWED_EXPORTS: Record<string, string[]> = {
  index: [
    "IsolatedSWRCache",
    "LIVE_FALLBACK_INTERVAL_MS",
    "LIVE_RECONCILE_INTERVAL_MS",
    "SWRScopeBoundary",
    "SWRSeedBoundary",
    "authGeneration",
    // Clears and resumes a paused session the server confirmed (#8082); it
    // hands out neither cache nor mutate.
    "confirmSWRSession",
    // Drops the cache when the session cookie changed under the tab (#8082);
    // it hands out neither cache nor mutate.
    "dropSWRSession",
    "mutate",
    // A session boundary listener; it hands out neither cache nor mutate
    // (#4675: the tab-wide refusals of use-traeger-confirmed-resource).
    "onSWRScopeReset",
    "revalidateOrThrow",
    "scopedSWRKey",
    "stampSWRSeeds",
    "tenantSWRScope",
    "useImmutableSWR",
    "useInvalidateFamily",
    "useInvalidateMatching",
    "useLiveEventScope",
    "useLiveRefreshInterval",
    "useOpeningRead",
    "usePublishLiveChannel",
    "useSWRAuth",
    "useSWRCacheKey",
    "useSWRPreload",
    "useSWRSeedFrom",
    "useSWRSessionRefresh",
    "useTenantMutate",
    "useTenantMutateMatching",
    "writeSWRSeeds",
  ],
  hooks: [
    "MUTATION_OPTION_KEYS",
    "READER_OPTION_KEYS",
    "revalidateOrThrow",
    "useDiscardRefusedEntity",
    "useImmutableSWR",
    "useInvalidateFamily",
    "useInvalidateMatching",
    "useOpeningRead",
    "useSWRAuth",
    "useSWRCacheKey",
    "useSWRPreload",
    "useSWRRequestGuard",
    "useScopedSWRKey",
    "useTenantMutate",
    "useTenantMutateMatching",
  ],
  mutate: ["mutate"],
  "config-boundaries": ["IsolatedSWRCache", "SWRSeedBoundary"],
  "scope-boundary": ["SWRScopeBoundary"],
  "read-draft": ["useActionOn", "useDraftOn", "useReadDraft"],
  "course-waitlist-keys": ["activityWaitlistKeys", "courseWaitlistKeys"],
  "portal-keys": [
    "STUDENT_KEY_FAMILIES",
    "announcementKeys",
    "catererKeys",
    "dashboardKeys",
    "databaseKeys",
    "devicePinKeys",
    "displayKeys",
    "fileKeys",
    "holidayKeys",
    "homeKeys",
    "homeLayoutKeys",
    "messageKeys",
    "notificationFeedKeys",
    "operatorAnnouncementKeys",
    "operatorBillingKeys",
    "operatorInvitationKeys",
    "operatorProvisioningKeys",
    "parentAnnouncementKeys",
    "parentKeys",
    "payrollKeys",
    "requestFeedKeys",
    "schoolPortalKeys",
    "schoolSetupKeys",
    "schoolTraegerDocumentKeys",
    "staffMergeKeys",
    "staffOnboardingKeys",
    "studentKeys",
    "timeTrackingKeys",
    "timetableKeys",
    "weekProtocolKeys",
  ],
  "traeger-keys": ["traegerKeys"],
  "traeger-billing-keys": ["traegerBillingKeys"],
  "traeger-billing-run-keys": [
    "REFRESH_WHILE_QUEUED_MS",
    "traegerBillingRunKeys",
  ],
  "traeger-contract-keys": ["traegerContractKeys"],
  "traeger-staff-keys": ["traegerStaffKeys"],
  "traeger-report-keys": ["traegerReportKeys"],
  "operator-keys": ["operatorKeys"],
  "tenant-student-keys": ["tenantStudentKeys"],
  "tenant-admin-keys": ["tenantAdminKeys"],
  "tenant-daily-keys": ["tenantDailyKeys"],
  "enrollment-keys": ["enrollmentKeys"],
  "tenant-contact-keys": ["tenantContactKeys"],
  "tenant-list-keys": ["tenantListKeys"],
  "shell-keys": [
    "SWR_FAMILIES",
    "announcementKeys",
    "dashboardKeys",
    "ownSupervisionKeys",
    "shellResourceKeys",
  ],
  "supervision-keys": ["supervisionContextKeys"],
  supervision: ["useSupervisionSnapshot"],
  "parent-keys": ["parentKeys"],
  "parent-inbox-keys": ["parentInboxKeys"],
  "rooms-keys": ["checkinTargetKeys", "roomKeys"],
  "groups-keys": ["groupKeys"],
  "staff-keys": [
    "absenceMailKeys",
    "closingDayKeys",
    "staffAbsenceKeys",
    "staffAccessKeys",
    "staffKeys",
    "staffMonthSummaryKeys",
    "staffNoticeKeys",
    "staffQualificationKeys",
    "staffRecordKeys",
    "staffTimeKeys",
    "traegerMonthStaffKeys",
    "workTimeModelKeys",
  ],
  "me-keys": ["meKeys", "profileKeys"],
  rooms: ["rooms"],
  groups: ["groups"],
  staff: ["staff"],
  me: ["me"],
  "search-students-key": [
    "SEARCH_STUDENTS_ALL_GROUPS_KEY",
    "SEARCH_STUDENTS_KEY_PREFIX",
    "normalizeSearchStudentsGroupId",
    "searchStudentsGroupScope",
    "searchStudentsKeyTargetsGroup",
  ],
  "room-derived-caches": ["ROOM_DERIVED_CACHE_KEY_FRAGMENTS"],
  optimistic: ["useMessageSendAttempt", "useOptimisticAction"],
  "server-seed": ["SERVER_SEED_MAX_AGE_MS", "SWRServerSeed"],
  "session-generation": ["sessionGeneration"],
};

// #5007: outside ~/lib/swr no cache access bypasses the generation lock.
describe("cache boundary of ~/lib/swr", () => {
  it.each(Object.keys(PUBLIC_SURFACE))(
    "keeps the reviewed exports of the public module %s",
    async (name) => {
      const exports = await PUBLIC_SURFACE[name]!();
      expect(Object.keys(exports).sort()).toEqual(REVIEWED_EXPORTS[name]);
      // Neither SWR's provider nor anything carrying its cache or mutate.
      for (const value of Object.values(exports)) {
        expect(value).not.toHaveProperty("defaultValue");
        expect(value).not.toHaveProperty("cache");
      }
    },
  );

  it("passes only revalidate to a clear, never written data", async () => {
    const { result } = renderHook(() => useSWRConfig().cache);
    result.current.set(own("held"), { data: "server" });
    const options = {
      revalidate: false,
      optimisticData: "smuggled",
      populateCache: false,
    };
    await act(async () => {
      await mutate(own("held"), undefined, options);
    });
    expect(result.current.get(own("held"))?.data).toBeUndefined();
  });

  it("refuses a raw data write, also after a scope bump", async () => {
    const key = roomKeys.key();
    const reader = renderHook(() =>
      useSWRAuth(key, async () => ["server"], { revalidateIfStale: false }),
    );
    await waitFor(() => expect(reader.result.current.data).toEqual(["server"]));
    act(() => resetSWRScope({ revalidate: false }));

    await expect(
      // @ts-expect-error a data write is no longer part of the contract
      mutate(own(key), ["late-raw"]),
    ).rejects.toThrow(TypeError);
    await expect(
      // @ts-expect-error neither through a key filter
      mutate(() => true, ["late-raw"]),
    ).rejects.toThrow(TypeError);
    expect(reader.result.current.data).not.toEqual(["late-raw"]);
  });

  it("still revalidates and clears through key filters", async () => {
    const fetcher = vi.fn(async () => ["server"]);
    const reader = renderHook(() => useSWRAuth(roomKeys.key(), fetcher));
    await waitFor(() => expect(reader.result.current.data).toEqual(["server"]));
    await act(async () => {
      await mutate((key) => typeof key === "string" && key.includes("rooms-"));
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("useInvalidateMatching", () => {
  it("passes the resource key and touches only the session's scope", async () => {
    const { result } = renderHook(() => ({
      cache: useSWRConfig().cache,
      invalidate: useInvalidateMatching(),
    }));
    const keys = [
      own("staff-month-summary-1"),
      "school-a:account-8:staff-month-summary-1",
      "school-b:account-7:staff-month-summary-1",
      own("students-list"),
    ];
    for (const key of keys) result.current.cache.set(key, { data: [key] });
    const seen: string[] = [];
    await act(async () => {
      await result.current.invalidate(
        (key) => {
          seen.push(key);
          return key.startsWith("staff-month-summary-");
        },
        { clear: true },
      );
    });
    expect(seen).toEqual(
      expect.arrayContaining(["staff-month-summary-1", "students-list"]),
    );
    expect(result.current.cache.get(keys[0]!)?.data).toBeUndefined();
    for (const key of keys.slice(1))
      expect(result.current.cache.get(key)?.data).toEqual([key]);
  });

  it("refreshes every reader of the session for `() => true`", async () => {
    const rooms = vi.fn(async () => ["rooms"]);
    const inbox = vi.fn(async () => ["inbox"]);
    const readers = renderHook(() => ({
      rooms: useSWRAuth(roomKeys.key(), rooms),
      inbox: useSWRAuth(messageKeys.messagesInbox(false), inbox),
      invalidate: useInvalidateMatching(),
    }));
    await waitFor(() => {
      expect(readers.result.current.rooms.data).toEqual(["rooms"]);
      expect(readers.result.current.inbox.data).toEqual(["inbox"]);
    });
    await act(async () => {
      await readers.result.current.invalidate(() => true);
    });
    expect(rooms).toHaveBeenCalledTimes(2);
    expect(inbox).toHaveBeenCalledTimes(2);
  });

  it("unites a time write with its SSE echo, expiring only affected inactive keys", async () => {
    const overview = vi.fn(async () => ({ ready: true }));
    const period = vi.fn(async () => ({ ready: true }));
    const leave = vi.fn(async () => ({ ready: true }));
    const active = timeTrackingKeys.period("week", "2026-11-23");
    const inactive = timeTrackingKeys.period("month", "2026-10-01");

    const readers = renderHook(() => ({
      cache: useSWRConfig().cache,
      overview: useSWRAuth(timeTrackingKeys.overview("2026-11-25"), overview),
      period: useSWRAuth(active, period),
      leave: useSWRAuth(timeTrackingKeys.leaveOverview(2026), leave),
      localWrite: useOwnTimeRefresh(),
      sse: useOwnTimeRefresh(),
    }));
    await waitFor(() =>
      expect(readers.result.current.period.data).toBeDefined(),
    );
    const cache = readers.result.current.cache;
    cache.set(own(inactive), { data: { old: true } });
    cache.set(`school-b:account-7:${inactive}`, { data: { other: true } });

    await act(async () => {
      const write = readers.result.current.localWrite("time");
      const echo = readers.result.current.sse("time");
      expect(write).toBe(echo);
      await write;
    });
    expect(overview).toHaveBeenCalledTimes(2);
    expect(period).toHaveBeenCalledTimes(2);
    expect(leave).toHaveBeenCalledTimes(1);
    expect(cache.get(own(inactive))?.data).toBeUndefined();
    expect(cache.get(`school-b:account-7:${inactive}`)?.data).toEqual({
      other: true,
    });
  });

  it("matches nothing while the session is being confirmed", async () => {
    const { result } = renderHook(() => ({
      cache: useSWRConfig().cache,
      invalidate: useInvalidateMatching(),
    }));
    result.current.cache.set(own("students-list"), { data: ["kept"] });
    act(() => suspendSWRSession());
    await act(async () => {
      await result.current.invalidate(() => true, { clear: true });
    });
    expect(result.current.cache.get(own("students-list"))?.data).toEqual([
      "kept",
    ]);
  });
});

describe("seed helpers", () => {
  type Row = { thread_id: string; subject: string };
  const derive = (rows: Row[]) => rows.find((row) => row.thread_id === "t1");

  it("seeds a target from current source data and drops it with the source", async () => {
    const inboxKey = messageKeys.messagesInbox(false);
    const threadKey = messageKeys.messageThread("t1");
    const tools = renderHook(() => ({
      inbox: useSWRAuth(inboxKey, async () => [
        { thread_id: "t1", subject: "Ausflug" },
      ]),
      seedFrom: useSWRSeedFrom(),
      clear: useTenantMutateMatching([inboxKey, threadKey]),
    }));
    await waitFor(() => expect(tools.result.current.inbox.data).toBeDefined());
    const seed = tools.result.current.seedFrom(inboxKey, threadKey, derive);
    expect(seed).toEqual({ thread_id: "t1", subject: "Ausflug" });

    // The seed shows under the target's reader without a request.
    const fetcher = vi.fn(async () => ({ thread_id: "t1", subject: "neu" }));
    const reader = renderHook(() =>
      useSWRAuth(threadKey, fetcher, {
        fallbackData: seed,
        revalidateOnMount: false,
      }),
    );
    expect(reader.result.current.data).toBe(seed);

    // A drop of the source ends the seed: nothing older is seeded or shown.
    await act(async () => {
      await tools.result.current.clear({ clear: true });
    });
    expect(
      tools.result.current.seedFrom(inboxKey, threadKey, derive),
    ).toBeUndefined();
    expect(reader.result.current.data).not.toBe(seed);
  });

  it("writes server seeds without replacing an entry a reader holds", async () => {
    const { result } = renderHook(() => useSWRConfig().cache);
    result.current.set(own("held"), { data: "reader" });
    act(() => {
      writeSWRSeeds({ [own("held")]: "seed", [own("fresh")]: "seed" });
    });
    await waitFor(() =>
      expect(result.current.get(own("fresh"))?.data).toBe("seed"),
    );
    expect(result.current.get(own("held"))?.data).toBe("reader");
  });
});

// #5007, third review: options and configuration objects are the fifth way
// into the cache. Each public reader, mutation and boundary copies an
// allowlist; nothing else reaches SWR, whatever the static type let through.
describe("option allowlists of ~/lib/swr", () => {
  it("keeps the reviewed reader and mutation options", () => {
    expect([...READER_OPTION_KEYS].sort()).toEqual([
      "dedupingInterval",
      "errorRetryCount",
      "fallbackData",
      "focusThrottleInterval",
      "isPaused",
      "keepPreviousData",
      "onDiscarded",
      "onError",
      "onSuccess",
      "recoverDiscardedRefusals",
      "refreshInterval",
      "revalidateIfStale",
      "revalidateOnFocus",
      "revalidateOnMount",
      "revalidateOnReconnect",
      "shouldRetryOnError",
    ]);
    expect([...MUTATION_OPTION_KEYS].sort()).toEqual([
      "optimisticData",
      "populateCache",
      "revalidate",
      "rollbackOnError",
      "throwOnError",
    ]);
  });

  // Every key SWR's configuration knows, plus the hook-only ones: a key
  // outside the allowlist that slipped through would fail here.
  const swrKeys = [
    ...new Set([
      ...Object.keys(SWRConfig.defaultValue),
      "use",
      "provider",
      "fallback",
      "fetcher",
      "compare",
      "onErrorRetry",
      "suspense",
      "strictServerPrefetchWarning",
    ]),
  ].filter((name) => !(READER_OPTION_KEYS as readonly string[]).includes(name));

  it.each(swrKeys)("refuses the reader option %s", (name) => {
    expect(() =>
      renderHook(() =>
        useSWRAuth(roomKeys.key(), async () => [], {
          [name]: () => undefined,
        } as never),
      ),
    ).toThrow(`takes no option '${name}'`);
  });

  it("runs no middleware from the options", () => {
    const middleware = vi.fn<Middleware>((next) => next);
    // Typed wide, as a caller could build it; no cast at the call.
    const options: { refreshInterval: number; use: Middleware[] } = {
      refreshInterval: 0,
      use: [middleware],
    };
    expect(() =>
      renderHook(() => useSWRAuth(roomKeys.key(), async () => [], options)),
    ).toThrow("takes no option 'use'");
    expect(middleware).not.toHaveBeenCalled();
  });

  it("passes only the seed to SWR, no middleware or provider", async () => {
    const middleware = vi.fn<Middleware>((next) => next);
    const provider = vi.fn(() => new Map());
    const seed = {
      fallback: {},
      cacheData: {},
      use: [middleware],
      provider,
    };
    function Reader() {
      useSWRAuth(roomKeys.key(), async () => ["server"]);
      return null;
    }
    render(
      <SWRSeedBoundary seed={seed}>
        <Reader />
      </SWRSeedBoundary>,
    );
    await waitFor(() => expect(middleware).not.toHaveBeenCalled());
    expect(provider).not.toHaveBeenCalled();
  });

  it("hands a reader's callbacks the value alone, never SWR's configuration", async () => {
    const onSuccess = vi.fn();
    renderHook(() =>
      useSWRAuth(roomKeys.key(), async () => ["server"], { onSuccess }),
    );
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(onSuccess.mock.calls[0]).toEqual([["server"]]);
  });

  // Production drops what development refuses: no option outside the
  // allowlist reaches SWR there either.
  function inProduction() {
    vi.stubEnv("NODE_ENV", "production");
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });
  }

  it("drops a refused reader option in production", () => {
    inProduction();
    const middleware = vi.fn<Middleware>((next) => next);
    const options = { refreshInterval: 0, use: [middleware] };
    renderHook(() => useSWRAuth(roomKeys.key(), async () => [], options));
    expect(middleware).not.toHaveBeenCalled();
  });

  async function boundReader() {
    const reader = renderHook(() =>
      useSWRAuth(roomKeys.key(), async () => ["server"], {
        revalidateIfStale: false,
      }),
    );
    await waitFor(() => expect(reader.result.current.data).toEqual(["server"]));
    const { result } = renderHook(() => useSWRConfig().cache);
    return { reader, cache: result.current };
  }

  it("lets a bound clear take only revalidate and throwOnError", async () => {
    const { reader, cache } = await boundReader();
    await act(async () => {
      await reader.result.current.mutate(undefined, {
        revalidate: false,
        throwOnError: true,
      });
    });
    expect(cache.get(own(roomKeys.key()))?.data).toBeUndefined();
    const middleware = vi.fn<Middleware>((next) => next);
    const options = {
      revalidate: false,
      populateCache: () => ["raw-populate"],
      use: [middleware],
    };
    expect(() => reader.result.current.mutate(undefined, options)).toThrow(
      "takes no option 'populateCache'",
    );
  });

  it("clears without the refused options in production", async () => {
    const { reader, cache } = await boundReader();
    inProduction();
    const options = {
      revalidate: false,
      populateCache: () => ["raw-populate"],
      optimisticData: ["raw-optimistic"],
    };
    await act(async () => {
      await reader.result.current.mutate(undefined, options);
    });
    // Neither populateCache nor optimisticData wrote: the entry is cleared.
    expect(cache.get(own(roomKeys.key()))?.data).toBeUndefined();
  });

  it("refuses a mutation option outside the allowlist on the bound mutate", async () => {
    const { reader } = await boundReader();
    const options = { revalidate: false, extra: 1 };
    expect(() => reader.result.current.mutate(["saved"], options)).toThrow(
      "takes no option 'extra'",
    );
  });

  it("drops a refused mutation option in production", async () => {
    const { reader, cache } = await boundReader();
    inProduction();
    const options = { revalidate: false, populateCache: true, extra: 1 };
    await act(async () => {
      await reader.result.current.mutate(["saved"], options);
    });
    expect(cache.get(own(roomKeys.key()))?.data).toEqual(["saved"]);
  });

  it("refuses a mutation option outside the allowlist", () => {
    const { result } = renderHook(() => useTenantMutate());
    const options = { revalidate: false, optimisticData: ["x"], extra: 1 };
    expect(() => result.current(roomKeys.key(), ["saved"], options)).toThrow(
      "takes no option 'extra'",
    );
  });
});
