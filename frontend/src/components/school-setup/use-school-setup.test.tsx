import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";

import { SWRConfig } from "~/lib/swr/testing";
import { releaseFakeTimers } from "~/test/clock";
import { useSchoolSetup } from "./use-school-setup";

vi.unmock("swr");
const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("~/lib/school-setup-api", () => ({ fetchSchoolSetup: read }));
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    status: "authenticated",
    data: { user: { id: "1", roles: ["admin"] } },
  }),
}));

it.each(["completed", "dismissed"])(
  "stops the open checklist timer once %s",
  async (flag) => {
    vi.useFakeTimers();
    read
      .mockReset()
      .mockResolvedValueOnce({ completed: false, dismissed: false })
      .mockResolvedValue({ completed: false, dismissed: false, [flag]: true });
    const view = renderHook(() => useSchoolSetup(true), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <SWRConfig value={{ provider: () => new Map() }}>{children}</SWRConfig>
      ),
    });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(read).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(view.result.current.state).toMatchObject({ [flag]: true });
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(read).toHaveBeenCalledTimes(2);
    view.unmount();
    releaseFakeTimers();
  },
);
