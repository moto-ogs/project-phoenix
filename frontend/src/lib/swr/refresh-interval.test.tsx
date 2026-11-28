import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSWRAuth } from "./index";
import { resetSWRScope, resumeSWRSession } from "./scope";
import { SWRConfig } from "./testing";

vi.unmock("swr");
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: { id: "account-7", scope: "tenant", tenantId: "42" },
      expires: "2099-01-01",
    },
    status: "authenticated",
  }),
}));
vi.mock("~/lib/tenant-context", () => ({
  useTenantSlugSafe: () => "school-a",
}));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map() }}>{children}</SWRConfig>
  );
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const POLL_MS = 5000;

/** One function for the module's lifetime, like `sendingRefreshInterval`. */
function pollWhileSending(latest: string | undefined): number {
  return latest === "sending" ? POLL_MS : 0;
}

beforeEach(() => {
  vi.useFakeTimers();
  resetSWRScope({ revalidate: false });
  resumeSWRSession();
});

// A reader polls only while its data asks for it, such as a mail that is
// still being sent (#8271). SWR alone asks a stable function only after its
// own poll: a list that loaded idle never polled, even once a write's reload
// brought a sending state, and kept showing „Wird gesendet“.
describe("refreshInterval from the data", () => {
  it("starts polling when a reload brings data that asks for it, and stops after", async () => {
    let server = "idle";
    const fetcher = vi.fn(async () => server);
    const { result } = renderHook(
      () =>
        useSWRAuth("refresh-interval-reader", fetcher, {
          refreshInterval: pollWhileSending,
        }),
      { wrapper },
    );
    await advance(0);
    expect(result.current.data).toBe("idle");
    expect(fetcher).toHaveBeenCalledTimes(1);

    // The click's reload: the server now sends.
    server = "sending";
    await act(async () => {
      await result.current.mutate();
    });
    expect(result.current.data).toBe("sending");
    expect(fetcher).toHaveBeenCalledTimes(2);

    // Still sending at the first poll, done at the second.
    await advance(POLL_MS);
    expect(fetcher).toHaveBeenCalledTimes(3);
    server = "sent";
    await advance(POLL_MS);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(result.current.data).toBe("sent");

    // Done: no further poll.
    await advance(POLL_MS * 3);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});
