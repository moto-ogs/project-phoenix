import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import type { ReadDraftStatus } from "~/lib/swr/read-draft";
import { useReadDraftForm } from "./use-swr-load-error";

function draft(canSubmit: boolean, error?: unknown) {
  const status: ReadDraftStatus = canSubmit
    ? "ready"
    : error
      ? "loadFailed"
      : "reloading";
  return { canSubmit, error, retryLoad: vi.fn(), status };
}

// ADR 0311, rules 4 and 6: the one order of a form on a read draft.
describe("useReadDraftForm", () => {
  it("keeps the shown error while nothing can be sent", () => {
    const clear = vi.fn();
    const { result } = renderHook(
      () =>
        useReadDraftForm(draft(false), { error: "shown", clear }, "die Regel"),
      { wrapper: ToastProvider },
    );
    expect(result.current.begin()).toBe(false);
    expect(clear).not.toHaveBeenCalled();
  });

  it("clears the form's error when the draft can be sent, or nothing is read", () => {
    const clear = vi.fn();
    const { result, rerender } = renderHook(
      ({ edit }: { edit: ReturnType<typeof draft> | null }) =>
        useReadDraftForm(edit, { error: null, clear }, "die Regel"),
      {
        wrapper: ToastProvider,
        initialProps: { edit: draft(true) as ReturnType<typeof draft> | null },
      },
    );
    expect(result.current.begin()).toBe(true);
    rerender({ edit: null });
    expect(result.current.begin()).toBe(true);
    expect(clear).toHaveBeenCalledTimes(2);
  });

  it("shows the failed read unless the form's alert already names it", async () => {
    const failed = draft(false, new ApiError("down", 503));
    const { result, rerender } = renderHook(
      ({ formError }: { formError: unknown }) =>
        useReadDraftForm(
          failed,
          { error: formError, clear: vi.fn() },
          "die Regel",
        ),
      { wrapper: ToastProvider, initialProps: { formError: null as unknown } },
    );
    await waitFor(() => expect(result.current.loadError).not.toBeNull());
    expect(result.current.loadError).toMatchObject({
      retry: expect.anything(),
    });

    rerender({ formError: "shown" });
    expect(result.current.loadError).toBeNull();
  });

  it("names why saving waits, and nothing for a form that creates", () => {
    const { result, rerender } = renderHook(
      ({ edit }: { edit: ReturnType<typeof draft> | null }) =>
        useReadDraftForm(edit, { error: null, clear: vi.fn() }, "die Regel"),
      {
        wrapper: ToastProvider,
        initialProps: { edit: draft(false) as ReturnType<typeof draft> | null },
      },
    );
    expect(result.current.waitReason).toBe(
      "Die gespeicherten Angaben werden noch geladen.",
    );
    rerender({ edit: draft(false, new ApiError("down", 503)) });
    expect(result.current.waitReason).toMatch(/konnten nicht geladen werden/);
    rerender({ edit: draft(true) });
    expect(result.current.waitReason).toBeUndefined();
    rerender({ edit: null });
    expect(result.current.waitReason).toBeUndefined();
  });
});
