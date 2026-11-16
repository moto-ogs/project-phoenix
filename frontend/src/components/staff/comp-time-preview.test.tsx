import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { SessionProvider } from "next-auth/react";
import { describe, expect, it, vi } from "vitest";
import { SWRConfig } from "~/lib/swr/testing";
import { deferred } from "~/test/helpers/form-modal-pending";
import { useCompTimePreview } from "./comp-time-preview";

vi.unmock("swr");
const { getPreview } = vi.hoisted(() => ({ getPreview: vi.fn() }));
vi.mock("~/lib/staff-api", () => ({
  staffAbsenceService: { getCompTimePreview: getPreview },
}));

function Providers({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <SessionProvider
      session={{ user: { id: "1", scope: "tenant" }, expires: "2099-01-01" }}
      refetchOnWindowFocus={false}
    >
      <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
        {children}
      </SWRConfig>
    </SessionProvider>
  );
}

describe("useCompTimePreview", () => {
  it("does not reuse an earlier opening's failure to stop waiting for a fresh preview", async () => {
    getPreview.mockRejectedValueOnce(new Error("offline"));
    const { result, rerender } = renderHook(
      ({ enabled }) =>
        useCompTimePreview({
          enabled,
          staffId: "4",
          dateStart: "2026-09-09",
          dateEnd: "2026-09-09",
          halfDay: false,
        }),
      { initialProps: { enabled: true }, wrapper: Providers },
    );
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    rerender({ enabled: false });
    const pending = deferred<never>();
    getPreview.mockReturnValueOnce(pending.promise);
    rerender({ enabled: true });
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
    await act(async () => pending.reject(new Error("still offline")));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it("waits for a fresh balance when reopening the same selection", async () => {
    const positive = {
      currentBalanceMinutes: 600,
      projectedBalanceMinutes: 120,
      deductionMinutes: 480,
      futureCommitmentMinutes: 0,
      futureAdjustmentMinutes: 0,
      realizedDeductionMinutes: 0,
    };
    getPreview.mockResolvedValue(positive);
    const { result, rerender } = renderHook(
      ({ enabled }) =>
        useCompTimePreview({
          enabled,
          staffId: "4",
          dateStart: "2026-09-09",
          dateEnd: "2026-09-09",
          halfDay: false,
        }),
      { initialProps: { enabled: true }, wrapper: Providers },
    );
    await waitFor(() => expect(result.current.preview).toEqual(positive));
    rerender({ enabled: false });
    const pending = deferred<typeof positive>();
    getPreview.mockReturnValueOnce(pending.promise);
    rerender({ enabled: true });
    expect(result.current.preview).toBeNull();
    expect(result.current.loading).toBe(true);
    await act(async () =>
      pending.resolve({ ...positive, projectedBalanceMinutes: -60 }),
    );
    await waitFor(() =>
      expect(result.current.preview?.projectedBalanceMinutes).toBe(-60),
    );
  });
});
