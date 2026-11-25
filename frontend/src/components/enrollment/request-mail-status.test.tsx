import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { SWRConfig } from "~/lib/swr/testing";
import { releaseFakeTimers } from "~/test/clock";
import { useRequestMails } from "./request-mail-status";

vi.unmock("swr");
const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("~/lib/enrollment-admin-api", () => ({ getAdminRequestMails: read }));
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    status: "authenticated",
    data: { user: { id: "1", scope: "tenant" }, expires: "2099-01-01" },
  }),
}));
function Providers({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <SWRConfig value={{ provider: () => new Map() }}>{children}</SWRConfig>
  );
}

it("recovers its polling after the retry budget is exhausted", async () => {
  vi.useFakeTimers();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  read
    .mockResolvedValueOnce([
      {
        kind: "enrollment_approved",
        outcome: "queued",
        awaiting_feedback: true,
      },
    ])
    .mockRejectedValue(new Error("offline"));
  const view = renderHook(() => useRequestMails("request-1"), {
    wrapper: Providers,
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(view.result.current.mails[0]?.outcome).toBe("queued");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(45_000);
  });
  read.mockResolvedValue([
    { kind: "enrollment_approved", outcome: "delivered" },
  ]);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_000);
  });
  expect(view.result.current.mails[0]?.outcome).toBe("delivered");
  view.unmount();
  releaseFakeTimers();
});

it("checks a quiet request on focus without waiting for reconciliation", async () => {
  vi.useFakeTimers();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  read
    .mockReset()
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      {
        kind: "enrollment_approved",
        outcome: "accepted",
        awaiting_feedback: true,
      },
    ])
    .mockResolvedValue([{ kind: "enrollment_approved", outcome: "delivered" }]);
  const view = renderHook(() => useRequestMails("focus"), {
    wrapper: Providers,
  });
  await act(() => vi.advanceTimersByTimeAsync(6_000));
  expect(read).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new Event("focus"));
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(view.result.current.mails[0]?.outcome).toBe("accepted");
  await act(() => vi.advanceTimersByTimeAsync(15_000));
  expect(view.result.current.mails[0]?.outcome).toBe("delivered");
  view.unmount();
  releaseFakeTimers();
});
