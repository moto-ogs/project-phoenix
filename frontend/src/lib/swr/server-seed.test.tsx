import { render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setTestClock } from "~/test/clock";
import { _resetSWRFallbacksForTests, bumpDataGeneration } from "./generation";
import { mutate, useSWRAuth } from "./index";
import { resetSWRScope, resumeSWRSession } from "./scope";
import {
  SERVER_SEED_MAX_AGE_MS,
  SWRServerSeed,
  type ServerSeed,
  type ServerSeedEntry,
} from "./server-seed";
import { sessionGeneration } from "./session-generation";

vi.unmock("swr");
const { session } = vi.hoisted(() => ({
  session: {
    current: {
      user: { id: "account-7", scope: "tenant", tenantId: "42" },
      expires: "2099-01-01",
    },
  },
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: session.current, status: "authenticated" }),
}));
vi.mock("~/lib/tenant-context", () => ({
  useTenantSlugSafe: () => "school-a",
}));

const GRID = "timetable-week-2026-09-07-2026-09-11";
const GAPS = "timetable-gaps-2026-09-09-2026-09-11";
const own = (key: string) => `school-a:account-7:${key}`;

beforeEach(() => {
  _resetSWRFallbacksForTests();
  resetSWRScope({ revalidate: false });
  resumeSWRSession();
  session.current = {
    user: { id: "account-7", scope: "tenant", tenantId: "42" },
    expires: "2099-01-01",
  };
});

function seedOf(
  entries: readonly ServerSeedEntry[],
  overrides: Partial<ServerSeed> = {},
): ServerSeed {
  return {
    builtAt: Date.now(),
    generation: sessionGeneration(session.current as never)!,
    entries,
    ...overrides,
  };
}

/** A promise React's `use` reads synchronously, as one the stream delivered. */
function delivered<T>(value: T): Promise<T> {
  return Object.assign(Promise.resolve(value), {
    status: "fulfilled",
    value,
  });
}

function Reader({
  name,
  resourceKey,
  fetcher,
  dedupingInterval,
}: Readonly<{
  name: string;
  resourceKey: string;
  fetcher: () => Promise<string>;
  dedupingInterval?: number;
}>) {
  const { data, error } = useSWRAuth(resourceKey, fetcher, {
    revalidateIfStale: false,
    ...(dedupingInterval === undefined ? {} : { dedupingInterval }),
  });
  return (
    <p>
      {name}: {data ?? (error ? "error" : "loading")}
    </p>
  );
}

describe("SWRServerSeed", () => {
  it("shows a rendered entry in the server HTML, not one of another session", () => {
    const fetcher = vi.fn(async () => "browser");
    const html = (seed: ServerSeed) =>
      renderToString(
        <SWRServerSeed seed={delivered(seed)} render>
          <Reader name="grid" resourceKey={GRID} fetcher={fetcher} />
          <Reader name="gaps" resourceKey={GAPS} fetcher={fetcher} />
        </SWRServerSeed>,
      ).replaceAll("<!-- -->", "");
    const entries = [
      { key: GRID, value: delivered("server grid"), render: true },
      // Not awaited by the server render: the grid does not wait for it.
      { key: GAPS, value: delivered("server gaps") },
    ];

    const own = html(seedOf(entries));
    expect(own).toContain("grid: server grid");
    expect(own).toContain("gaps: loading");

    const foreign = html(seedOf(entries, { generation: "other" }));
    expect(foreign).toContain("grid: loading");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ["just before", 0],
    ["long before", 2 * SERVER_SEED_MAX_AGE_MS],
  ])(
    "hydrates no fallback of a key dropped %s the boundary hydrated",
    async (_, later) => {
      const seed = seedOf([
        { key: GRID, value: delivered("server grid"), render: true },
      ]);
      const tree = (fetcher: () => Promise<string>) => (
        <SWRServerSeed seed={delivered(seed)} render>
          <Reader name="grid" resourceKey={GRID} fetcher={fetcher} />
        </SWRServerSeed>
      );
      const container = document.createElement("div");
      container.innerHTML = renderToString(tree(async () => "unused"));
      document.body.append(container);
      expect(container.textContent).toBe("grid: server grid");
      // Another boundary hydrated first and its read was refused.
      act(() => bumpDataGeneration((key) => key === own(GRID)));
      setTestClock(new Date(Date.now() + later));
      const fetcher = vi.fn(async () => "browser grid");

      const root = await act(async () =>
        hydrateRoot(container, tree(fetcher), {
          // The server HTML shows a value the browser may no longer show.
          onRecoverableError: () => undefined,
        }),
      );

      expect(await screen.findByText("grid: browser grid")).toBeInTheDocument();
      expect(fetcher).toHaveBeenCalledTimes(1);
      act(() => root.unmount());
      container.remove();
    },
  );

  it("hands a claimed key the server value instead of a browser request", async () => {
    const fetcher = vi.fn(async () => "browser");
    let resolve: (seed: ServerSeed) => void = () => {};
    const seed = new Promise<ServerSeed>((done) => {
      resolve = done;
    });

    render(
      <SWRServerSeed seed={seed} claims={[GRID]}>
        <Reader name="grid" resourceKey={GRID} fetcher={fetcher} />
      </SWRServerSeed>,
    );
    expect(screen.getByText("grid: loading")).toBeInTheDocument();
    await act(async () => {
      resolve(seedOf([{ key: GRID, value: Promise.resolve("server") }]));
    });

    expect(await screen.findByText("grid: server")).toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("loads only the key the server could not read, through the browser", async () => {
    const grid = vi.fn(async () => "browser grid");
    const gaps = vi.fn(async () => "browser gaps");

    render(
      <SWRServerSeed
        seed={seedOf([
          { key: GRID, value: Promise.resolve("server grid") },
          { key: GAPS, value: Promise.resolve(undefined) },
        ])}
      >
        <Reader name="grid" resourceKey={GRID} fetcher={grid} />
        <Reader name="gaps" resourceKey={GAPS} fetcher={gaps} />
      </SWRServerSeed>,
    );

    expect(await screen.findByText("grid: server grid")).toBeInTheDocument();
    expect(await screen.findByText("gaps: browser gaps")).toBeInTheDocument();
    expect(grid).not.toHaveBeenCalled();
    expect(gaps).toHaveBeenCalledTimes(1);
  });

  it("shares a single recovery GET when shell and page readers receive no seed", async () => {
    const fetcher = vi.fn(async () => "browser family");
    render(
      <SWRServerSeed seed={Promise.resolve(null)} claims={[GRID]}>
        <Reader name="shell" resourceKey={GRID} fetcher={fetcher} />
        <SWRServerSeed seed={Promise.resolve(null)} claims={[GRID]} render>
          <Reader name="cards" resourceKey={GRID} fetcher={fetcher} />
          <Reader name="navigation" resourceKey={GRID} fetcher={fetcher} />
        </SWRServerSeed>
      </SWRServerSeed>,
    );
    for (const name of ["shell", "cards", "navigation"]) {
      expect(
        await screen.findByText(name + ": browser family"),
      ).toBeInTheDocument();
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps the browser's error path when its own load fails", async () => {
    const fetcher = vi.fn(async (): Promise<string> => {
      throw new Error("offline");
    });

    render(
      <SWRServerSeed
        seed={seedOf([{ key: GRID, value: Promise.resolve(undefined) }])}
      >
        <Reader name="grid" resourceKey={GRID} fetcher={fetcher} />
      </SWRServerSeed>,
    );

    expect(await screen.findByText("grid: error")).toBeInTheDocument();
    expect(screen.queryByText("grid: server")).not.toBeInTheDocument();
  });

  it.each([
    ["another session", { generation: "other" }],
    ["an old payload", { builtAt: Date.now() - SERVER_SEED_MAX_AGE_MS - 1 }],
  ])("does not stand in for the browser read for %s", async (_, overrides) => {
    const fetcher = vi.fn(async () => "browser");

    render(
      <SWRServerSeed
        seed={seedOf(
          [{ key: GRID, value: Promise.resolve("server") }],
          overrides,
        )}
        claims={[GRID]}
      >
        <Reader name="grid" resourceKey={GRID} fetcher={fetcher} />
      </SWRServerSeed>,
    );

    expect(await screen.findByText("grid: browser")).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("leaves a key dropped since the server read it to the browser", async () => {
    // A prefetched payload, first mounted after the key was dropped (a
    // refused child, a withdrawn relationship) without a session change.
    const seed = seedOf([{ key: GRID, value: Promise.resolve("server") }]);
    act(() => bumpDataGeneration((key) => key === own(GRID)));
    const fetcher = vi.fn(async () => "browser");

    render(
      <SWRServerSeed seed={seed} claims={[GRID]}>
        <Reader name="grid" resourceKey={GRID} fetcher={fetcher} />
      </SWRServerSeed>,
    );

    expect(await screen.findByText("grid: browser")).toBeInTheDocument();
    expect(screen.queryByText("grid: server")).not.toBeInTheDocument();
  });

  it("does not replace a value the cache already holds", async () => {
    const first = render(
      <Reader name="grid" resourceKey={GRID} fetcher={async () => "cached"} />,
    );
    expect(await screen.findByText("grid: cached")).toBeInTheDocument();
    first.unmount();
    const fetcher = vi.fn(async () => "browser");

    render(
      <SWRServerSeed
        seed={seedOf([{ key: GRID, value: Promise.resolve("server") }])}
        claims={[GRID]}
      >
        <Reader name="grid" resourceKey={GRID} fetcher={fetcher} />
      </SWRServerSeed>,
    );

    await act(async () => {});
    expect(screen.getByText("grid: cached")).toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("offers a payload once: a remount from the router cache loads anew", async () => {
    const seed = seedOf([{ key: GRID, value: Promise.resolve("server") }]);
    // No dedupe window: the remount's reader would otherwise join the
    // first reader's request instead of starting its own.
    const first = render(
      <SWRServerSeed seed={seed} claims={[GRID]}>
        <Reader
          name="grid"
          resourceKey={GRID}
          fetcher={async () => "x"}
          dedupingInterval={0}
        />
      </SWRServerSeed>,
    );
    expect(await screen.findByText("grid: server")).toBeInTheDocument();
    first.unmount();
    await act(async () => {
      await new Promise((done) => setTimeout(done, 0));
      await mutate(own(GRID), undefined, { revalidate: false });
    });
    const fetcher = vi.fn(async () => "browser");

    render(
      <SWRServerSeed seed={seed} claims={[GRID]}>
        <Reader
          name="grid"
          resourceKey={GRID}
          fetcher={fetcher}
          dedupingInterval={0}
        />
      </SWRServerSeed>,
    );

    expect(await screen.findByText("grid: browser")).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
