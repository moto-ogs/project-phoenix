import type * as parentMeContract from "~/lib/contract/parent-me.generated";
import { parentFamilyFixture } from "~/test/parent-family-fixture";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyCards, familyCards } from "~/lib/parent-family-cards";
import { ParentServerSeed } from "~/components/parent/parent-server-seed";
import { sessionGeneration } from "~/lib/swr/session-generation";
import { berlinTodayISO } from "~/lib/date-helpers";
import { setTestClock } from "~/test/clock";
import { Profiler } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { useParentChildren } from "~/lib/hooks/use-parent-resources";
import type { Session } from "next-auth";
import { SWRConfig } from "~/lib/swr/testing";
import { SWRScopeBoundary } from "~/lib/swr/scope-boundary";
import { ApiError } from "~/lib/api-error";
import { resetSWRScope, resumeSWRSession } from "~/lib/swr/scope";
import { ParentRealtimeBridge } from "~/components/parent/parent-realtime-bridge";
import {
  getFamilyStart,
  fetchParentProfile,
  listMessageThreads,
  listAnnouncements,
} from "~/lib/parent-api";
import { useSWRAuth } from "~/lib/swr";
import { parentKeys } from "~/lib/swr/parent-keys";
import { ParentStartPage } from "./parent-start-page";
import type { SSEHookOptions } from "~/lib/sse-types";

const family = parentFamilyFixture();

vi.unmock("swr");
const useSSE = vi.hoisted(() => vi.fn().mockReturnValue({ isConnected: true }));
vi.mock("~/lib/hooks/use-sse", () => ({ useSSE }));
const state = vi.hoisted(() => ({ account: "A" as string | null }));
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    status: state.account ? "authenticated" : "unauthenticated",
    data: state.account
      ? ({
          user: { id: state.account, scope: "parent" },
          expires: "2099-01-01",
        } satisfies Session)
      : null,
  }),
}));
vi.mock("~/lib/tenant-context", () => ({
  useTenantSlugSafe: () => null,
  useTenantSafe: () => null,
}));
vi.mock("~/lib/shell-auth-context", () => ({
  useShellAuth: () => ({ profile: { firstName: "Eltern" } }),
  useShellAuthSafe: () => undefined,
}));
vi.mock("~/lib/parent-api", async (original) => ({
  ...(await original<typeof import("~/lib/parent-api")>()),

  fetchParentProfile: vi.fn(async () => ({ first_name: "Eltern" })),
  listAnnouncements: vi.fn(async () => []),
  listMessageThreads: vi.fn(async () => []),
  listHolidayRegistrationEntries: vi.fn(async () => []),
  listHolidayOffers: vi.fn(async () => []),
}));
vi.mock("~/lib/personal-calendar-api", () => ({
  getParentCalendar: vi.fn(async () => ({ events: [] })),
}));

beforeEach(() => {
  family.mockRead();
  resumeSWRSession();
  resetSWRScope({ revalidate: false });
  state.account = "A";
  vi.clearAllMocks();
  vi.mocked(listAnnouncements).mockResolvedValue([]);
  family.today.mockResolvedValue({
    at_ogs: null,
    state: "unknown",
  });
  vi.mocked(listMessageThreads).mockResolvedValue([]);
  vi.mocked(fetchParentProfile).mockResolvedValue({
    last_name: "",
    first_name: "Eltern",
    portal_locale: null,
  });
  family.children.mockImplementation(async () => [
    {
      care_ended: false,
      student_id: "42",
      tenant_id: "7",
      first_name: `Kind ${state.account}`,
      last_name: "Test",
      school_name: "Schule",
      school_class: "1a",
      status: "active",
      school_slug: "schule",
    },
  ]);
  family.features.mockResolvedValue(
    {} as parentMeContract.ChildFeaturesResponse,
  );
});
afterEach(() => {
  resumeSWRSession();
});

function Fixture({ visible = true }: Readonly<{ visible?: boolean }>) {
  return (
    <>
      <SWRScopeBoundary />
      <ParentRealtimeBridge />
      {visible ? <ParentStartPage /> : null}
    </>
  );
}
function mount(onCommit?: () => void) {
  const cache = new Map();
  return render(<Fixture />, {
    wrapper: ({ children }) => (
      <SWRConfig value={{ provider: () => cache, dedupingInterval: 60_000 }}>
        <Profiler id="parent-cache" onRender={() => onCommit?.()}>
          {children}
        </Profiler>
      </SWRConfig>
    ),
  });
}

describe("parent start cache isolation", () => {
  it.each([1, 2, 3])(
    "shows %i children in one GET even when the device has the wrong date",
    async (count) => {
      const [first] = await family.children();
      if (!first) throw new Error("Missing test child");
      family.children.mockResolvedValue(
        Array.from({ length: count }, (_, i) => ({
          ...first,
          student_id: String(42 + i),
          first_name: "Kind " + String(i + 1),
        })),
      );
      vi.mocked(getFamilyStart).mockImplementation(async () => ({
        ...(await family.read()),
        day: "2030-01-01",
      }));
      mount();
      expect(
        await screen.findByText("Kind " + String(count) + " Test"),
      ).toBeInTheDocument();
      expect(vi.mocked(getFamilyStart).mock.calls).toEqual([[undefined]]);
    },
  );

  it("retries a partial card without reloading its successful sibling, then stops", async () => {
    vi.useFakeTimers();
    const [first] = await family.children();
    if (!first) throw new Error("Missing test child");
    family.children.mockResolvedValue([
      first,
      { ...first, student_id: "43", first_name: "Geschwister" },
    ]);
    family.today.mockRejectedValueOnce(new Error("temporarily unavailable"));
    mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("Geschwister Test")).toBeInTheDocument();
    expect(getFamilyStart).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1001);
    });
    expect(vi.mocked(getFamilyStart).mock.calls).toEqual([[undefined], ["42"]]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(getFamilyStart).toHaveBeenCalledTimes(2);
  });

  it.each(["42", "43"])(
    "retries a throttled child %s only after Retry-After, including a newly linked child",
    async (id) => {
      vi.useFakeTimers();
      mount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const [first] = await family.children();
      if (!first) throw new Error("Missing test child");
      family.children.mockResolvedValue([
        { ...first, student_id: id, first_name: "Aktuell" },
      ]);
      const throttled = new ApiError("wait", 429);
      throttled.retryAfterSeconds = 5;
      vi.mocked(getFamilyStart).mockRejectedValueOnce(throttled);
      await act(async () => {
        window.dispatchEvent(
          new CustomEvent("parent-child-status-refresh", {
            detail: { studentId: id },
          }),
        );
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4999);
      });
      expect(vi.mocked(getFamilyStart).mock.calls).toEqual([[undefined], [id]]);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(vi.mocked(getFamilyStart).mock.calls).toEqual([
        [undefined],
        [id],
        [id],
      ]);
      expect(screen.getByText("Aktuell Test")).toBeInTheDocument();
    },
  );

  it("stops after two targeted retries even when each response asks for a different wait", async () => {
    vi.useFakeTimers();
    mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const unavailable = new ApiError("wait", 503);
    unavailable.retryAfterSeconds = 4;
    vi.mocked(getFamilyStart)
      .mockRejectedValueOnce(new ApiError("input", 400))
      .mockRejectedValue(unavailable);
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("parent-child-status-refresh", {
          detail: { studentId: "42" },
        }),
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(getFamilyStart).toHaveBeenCalledTimes(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3999);
    });
    expect(getFamilyStart).toHaveBeenCalledTimes(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(getFamilyStart).toHaveBeenCalledTimes(4);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(vi.mocked(getFamilyStart).mock.calls).toEqual([
      [undefined],
      ["42"],
      ["42"],
      ["42"],
    ]);
  });

  it("reconciles at server midnight after a seed even when the device clock is slow", async () => {
    vi.useFakeTimers();
    const builtAt = Date.now();
    const cards = await family.read();
    const seeded = structuredClone(
      applyCards(
        undefined,
        familyCards({ ...cards, day_remaining_seconds: 3 }),
      ),
    );
    const key = parentKeys.familyStart(berlinTodayISO());
    setTestClock(new Date(builtAt - 20000));
    const seed = {
      builtAt,
      generation: sessionGeneration({
        user: { id: "A", scope: "parent" },
        expires: "2099-01-01",
      })!,
      entries: [{ key, render: true, value: Promise.resolve(seeded) }],
    };
    const cache = new Map();
    render(
      <SWRConfig value={{ provider: () => cache }}>
        <ParentServerSeed day={seeded.day} seed={seed} render>
          <Fixture />
        </ParentServerSeed>
      </SWRConfig>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("Kind A Test")).toBeInTheDocument();
    expect(getFamilyStart).not.toHaveBeenCalled();
    family.children.mockResolvedValue([]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3010);
    });
    expect(getFamilyStart).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Kind A Test")).not.toBeInTheDocument();
  });

  it("hydrates the roster sent before Berlin midnight, then reads the device's new key", async () => {
    setTestClock("2026-09-09T23:59:58+02:00");
    const seeded = applyCards(undefined, familyCards(await family.read()));
    const key = parentKeys.familyStart(berlinTodayISO());
    const seed = {
      builtAt: Date.now(),
      generation: sessionGeneration({
        user: { id: "A", scope: "parent" },
        expires: "2099-01-01",
      })!,
      entries: [
        {
          key,
          render: true,
          value: Object.assign(Promise.resolve(seeded), {
            status: "fulfilled",
            value: seeded,
          }),
        },
      ],
    };
    function Roster() {
      return (
        <output>
          {useParentChildren()
            .data?.map((child) => child.first_name)
            .join(",") ?? "loading"}
        </output>
      );
    }
    const tree = (
      <ParentServerSeed day={seeded.day} seed={seed} render>
        <Roster />
      </ParentServerSeed>
    );
    const host = document.createElement("div");
    host.innerHTML = renderToString(tree);
    expect(host.textContent).toBe("Kind A");
    setTestClock("2026-09-10T00:00:01+02:00");
    const recover = vi.fn();
    const root = hydrateRoot(host, tree, { onRecoverableError: recover });
    try {
      await waitFor(() => expect(getFamilyStart).toHaveBeenCalledTimes(1));
      expect(host.textContent).toBe("Kind A");
      expect(recover).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("discards day-independent child details when the first new-day roster removes the relationship", async () => {
    vi.useFakeTimers();
    const detail = vi.fn(async () => "old detail");
    function Detail() {
      const read = useSWRAuth(parentKeys.masterData("42"), detail);
      return <output>{read.data}</output>;
    }
    render(
      <>
        <Fixture />
        <Detail />
      </>,
      {
        wrapper: ({ children }) => (
          <SWRConfig value={{ provider: () => new Map() }}>
            {children}
          </SWRConfig>
        ),
      },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("old detail")).toBeInTheDocument();
    expect(screen.getByText("Kind A Test")).toBeInTheDocument();
    family.children.mockResolvedValue([]);
    detail.mockImplementation(() => new Promise(() => undefined));
    setTestClock("2026-09-10T00:00:01+02:00");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_010);
    });
    expect(screen.queryByText("Kind A Test")).not.toBeInTheDocument();
    expect(screen.queryByText("old detail")).not.toBeInTheDocument();
  });
  it("refreshes at server midnight if the device is ahead, without a focus or child event", async () => {
    vi.useFakeTimers();
    const response = await family.read();
    vi.mocked(getFamilyStart)
      .mockResolvedValueOnce({
        ...response,
        day: "2026-09-08",
        day_remaining_seconds: 3,
      })
      .mockResolvedValue({
        ...response,
        day: "2026-09-09",
        day_remaining_seconds: 86400,
        cards: [],
      });
    mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("Kind A Test")).toBeInTheDocument();
    expect(getFamilyStart).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3010);
    });
    expect(screen.queryByText("Kind A Test")).not.toBeInTheDocument();
    expect(getFamilyStart).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120000);
    });
    expect(getFamilyStart).toHaveBeenCalledTimes(2);
  });
  it("keeps a revocation at server midnight even when the ensuing family read fails", async () => {
    mount();
    expect(await screen.findByText("Kind A Test")).toBeInTheDocument();
    vi.mocked(getFamilyStart)
      .mockResolvedValueOnce({
        day: "2030-01-01",
        day_remaining_seconds: 86400,
        cards: [],
      })
      .mockRejectedValue(new ApiError("offline", 503));
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("parent-child-status-refresh", {
          detail: { studentId: "42" },
        }),
      );
    });
    await waitFor(() =>
      expect(vi.mocked(getFamilyStart).mock.calls).toEqual([
        [undefined],
        ["42"],
        [undefined],
      ]),
    );
    expect(screen.queryByText("Kind A Test")).not.toBeInTheDocument();
  });
  it("narrows child events, reconciles missing IDs and reconnects, and ignores a late card after revocation", async () => {
    const rows = await family.children();
    const child = rows[0]!;
    family.children.mockResolvedValue([
      child,
      { ...child, student_id: "43", first_name: "Geschwister" },
    ]);
    const view = mount();
    expect(await screen.findByText("Geschwister Test")).toBeInTheDocument();
    const update = async (studentId?: string) => {
      const options = useSSE.mock.calls.at(-1)?.[1] as SSEHookOptions;
      await act(async () => {
        options.onMessage?.({
          type: "parent_child_updated",
          active_group_id: "",
          data: studentId ? { student_id: studentId } : {},
          timestamp: new Date().toISOString(),
        });
      });
    };
    const oldCard = await family.read("42");
    let resolveCard!: (answer: typeof oldCard) => void;
    vi.mocked(getFamilyStart).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCard = resolve;
      }),
    );
    await update("42");
    family.children.mockResolvedValue([
      { ...child, student_id: "43", first_name: "Geschwister" },
    ]);
    await update();
    await waitFor(() =>
      expect(screen.queryByText("Kind A Test")).not.toBeInTheDocument(),
    );
    await act(async () => {
      resolveCard(oldCard);
    });
    expect(screen.queryByText("Kind A Test")).not.toBeInTheDocument();
    expect(screen.getByText("Geschwister Test")).toBeInTheDocument();
    useSSE.mockReturnValueOnce({ isConnected: false });
    view.rerender(<Fixture />);
    view.rerender(<Fixture />);
    await waitFor(() =>
      expect(vi.mocked(getFamilyStart).mock.calls).toEqual([
        [undefined],
        ["42"],
        [undefined],
        [undefined],
      ]),
    );
  });
  it("withdraws the old child's data on account change", async () => {
    const view = mount();
    expect(await screen.findByText("Kind A Test")).toBeInTheDocument();
    state.account = "B";
    view.rerender(<Fixture />);
    // Anker: der bestehende Ladekasten oder die neue Kindkarte ersetzt A.
    expect(
      screen.getByText(/Kinder werden geladen|Kind B Test/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Kind A Test")).not.toBeInTheDocument();
    expect(await screen.findByText("Kind B Test")).toBeInTheDocument();
  });
  it("withdraws child data immediately on logout in another tab", async () => {
    mount();
    expect(await screen.findByText("Kind A Test")).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "moto:personal-storage-owner",
          newValue: null,
        }),
      );
    });
    // Anker: das echte Kind-Ladeskelett ersetzt die alte Karte.
    expect(
      screen.getByTestId("parent-start-child-skeleton"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Kind A Test")).not.toBeInTheDocument();
  });
  it("withdraws every child view after the server refuses the relationship", async () => {
    mount();
    expect(await screen.findByText("Kind A Test")).toBeInTheDocument();
    family.features.mockImplementation(async () => {
      family.children.mockResolvedValue([]);
      throw new ApiError("not linked", 403, { code: "care.child_not_linked" });
    });
    act(() => {
      window.dispatchEvent(
        new CustomEvent("parent-child-status-refresh", {
          detail: { studentId: "42" },
        }),
      );
    });
    // Anker: die neu bestätigte leere Kinderliste ersetzt die entzogene Karte.
    expect(
      await screen.findByText(
        "Mit deinem Konto ist noch kein Kind verknüpft. Die OGS deiner Schule kann das einrichten.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Kind A Test")).not.toBeInTheDocument();
  });

  it("shows a returning page synchronously without repeating shared GETs", async () => {
    const view = mount();
    expect(await screen.findByText("Kind A Test")).toBeInTheDocument();
    expect(getFamilyStart).toHaveBeenCalledTimes(1);
    view.rerender(<Fixture visible={false} />);
    view.rerender(<Fixture />);
    // Anker: bestätigte Kindkarte bereits beim ersten Render, kein Kaltstart.
    expect(screen.getByText("Kind A Test")).toBeInTheDocument();
    expect(
      screen.queryByTestId("parent-start-child-skeleton"),
    ).not.toBeInTheDocument();
    expect(getFamilyStart).toHaveBeenCalledTimes(1);
  });
  it("withdraws child data when another tab reports a relationship refusal", async () => {
    mount();
    expect(await screen.findByText("Kind A Test")).toBeInTheDocument();
    family.children.mockResolvedValue([]);
    const channel = new BroadcastChannel("moto:parent-access-refused");
    channel.postMessage({
      source: "other-tab",
      account: "A",
      code: "care.child_not_linked",
      status: 403,
    });
    channel.close();
    // Anker: die neue Kinderliste bestätigt, dass diese Beziehung fehlt.
    expect(
      await screen.findByText(
        "Mit deinem Konto ist noch kein Kind verknüpft. Die OGS deiner Schule kann das einrichten.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Kind A Test")).not.toBeInTheDocument();
  });
  it("starts child features and day status without waiting for the profile", async () => {
    vi.mocked(fetchParentProfile).mockReturnValue(new Promise(() => undefined));
    mount();
    await waitFor(() => expect(family.features).toHaveBeenCalledWith("42"));
    expect(family.today).toHaveBeenCalledWith("42");
    expect(await screen.findByText("Kind A Test")).toBeInTheDocument();
  });
  it("never paints the no-children state while presenting a load failure", async () => {
    const commits: string[] = [];
    family.children.mockRejectedValue(
      new ApiError("offline", 503, { code: "general.unavailable" }),
    );
    mount(() => commits.push(document.body.textContent ?? ""));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(
      commits.some((text) =>
        text.includes("Mit deinem Konto ist noch kein Kind verknüpft"),
      ),
    ).toBe(false);
  });
  it("never paints all-done while presenting an incomplete todo feed", async () => {
    const commits: string[] = [];
    let rejectFeed!: (error: unknown) => void;
    vi.mocked(listAnnouncements).mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectFeed = reject;
      }),
    );
    mount(() => commits.push(document.body.textContent ?? ""));
    expect(await screen.findByText("Kind A Test")).toBeInTheDocument();
    await act(async () => {
      rejectFeed(new ApiError("offline", 503, { code: "general.unavailable" }));
    });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(commits.some((text) => text.includes("Alles erledigt"))).toBe(false);
  });
  it.each([
    ["parent-child-status-refresh", family.children, "Kind A Test"],
    ["parent-child-status-refresh", family.features, "Kind A Test"],
    ["parent-child-status-refresh", family.today, "Kind A Test"],
    ["parent-news-unread-refresh", listAnnouncements, "Alles erledigt"],
  ] as const)(
    "keeps the mounted start content after a failed %s",
    async (event, request, label) => {
      await import("~/lib/error-presentation");
      mount();
      const content = await screen.findByText(label);
      vi.mocked(request).mockRejectedValue(
        new ApiError("offline", 503, { code: "general.unavailable" }),
      );
      await act(async () => {
        window.dispatchEvent(new CustomEvent(event));
      });
      await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
      expect(screen.getByText(label)).toBe(content);
    },
  );

  it("revalidates messages without repeating unrelated child requests", async () => {
    mount();
    expect(await screen.findByText("Kind A Test")).toBeInTheDocument();
    expect(listMessageThreads).toHaveBeenCalledTimes(1);
    act(() => {
      window.dispatchEvent(new CustomEvent("parent-messages-unread-refresh"));
    });
    await waitFor(() => expect(listMessageThreads).toHaveBeenCalledTimes(2));
    expect(getFamilyStart).toHaveBeenCalledTimes(1);
  });
  it("refreshes the shared message list only once for one incoming SSE message", async () => {
    mount();
    expect(await screen.findByText("Kind A Test")).toBeInTheDocument();
    const options = useSSE.mock.calls.at(-1)?.[1] as SSEHookOptions | undefined;
    if (!options?.onMessage) throw new Error("SSE handler was not registered");
    await act(async () => {
      options.onMessage?.({
        type: "parent_message",
        active_group_id: "",
        data: { student_id: "42" },
        timestamp: new Date().toISOString(),
      });
    });
    await waitFor(() => expect(listMessageThreads).toHaveBeenCalledTimes(2));
    expect(getFamilyStart).toHaveBeenCalledTimes(1);
  });

  it("removes a read conversation from the start tasks on a warm return", async () => {
    const unread = {
      thread_id: "thread-42",
      student_id: "42",
      student_name: "Kind A Test",
      school_name: "Schule",
      counterpart_name: "OGS Schule",
      last_message_read_by_staff: false,
      unread: 1,
    };
    vi.mocked(listMessageThreads).mockResolvedValue([unread]);
    const view = mount();
    expect(await screen.findByText("Neue Nachricht")).toBeInTheDocument();
    view.rerender(<Fixture visible={false} />);
    vi.mocked(listMessageThreads).mockResolvedValue([{ ...unread, unread: 0 }]);
    act(() => {
      window.dispatchEvent(new CustomEvent("parent-messages-unread-refresh"));
    });
    view.rerender(<Fixture />);
    expect(await screen.findByText("Kind A Test")).toBeInTheDocument();
    await waitFor(() => expect(listMessageThreads).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByText("Neue Nachricht")).not.toBeInTheDocument(),
    );
    expect(getFamilyStart).toHaveBeenCalledTimes(1);
  });

  it("does not reuse yesterday's day status or date-dependent features on a warm mount", async () => {
    const view = mount();
    expect(await screen.findByText("Kind A Test")).toBeInTheDocument();
    expect(family.today).toHaveBeenCalledTimes(1);
    view.rerender(<Fixture visible={false} />);
    setTestClock("2026-09-10T12:00:00+02:00");
    view.rerender(<Fixture />);
    await waitFor(() => expect(family.today).toHaveBeenCalledTimes(2));
    expect(getFamilyStart).toHaveBeenCalledTimes(2);
  });

  it("revalidates a message list invalidated while its page was unmounted", async () => {
    const view = mount();
    expect(await screen.findByText("Kind A Test")).toBeInTheDocument();
    expect(listMessageThreads).toHaveBeenCalledTimes(1);
    view.rerender(<Fixture visible={false} />);
    act(() => {
      window.dispatchEvent(new CustomEvent("parent-messages-unread-refresh"));
    });
    view.rerender(<Fixture />);
    await waitFor(() => expect(listMessageThreads).toHaveBeenCalledTimes(2));
    expect(family.children).toHaveBeenCalledTimes(1);
  });
});
