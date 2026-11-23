import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider, useApiErrorDisplay } from "~/contexts/ToastContext";
import { ApiError, isReadStateRefusal } from "~/lib/api-error";

// A write refused on a changed state (ADR 0311): the error path reads the
// stored state again and tells the truth about that read.

const changed = () =>
  new ApiError("changed", 409, { code: "general.changed_since_read" });

function Action({
  error,
  reload,
  retry,
  action,
}: Readonly<{
  error: unknown;
  reload?: () => Promise<unknown>;
  retry?: () => void;
  action?: { label: string; onClick: () => void };
}>) {
  const display = useApiErrorDisplay();
  return (
    <button
      type="button"
      onClick={() =>
        void display.show(error, {
          object: "die Anfrage",
          reload,
          retry,
          action,
        })
      }
    >
      Senden
    </button>
  );
}

function renderAction(props: Parameters<typeof Action>[0]) {
  render(
    <ToastProvider>
      <Action {...props} />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Senden" }));
}

describe("isReadStateRefusal", () => {
  it.each([
    "general.changed_since_read",
    "students.change_request_stale",
    "grade_transition.preview_stale",
    "parent_billing.sepa_import_changed",
  ])("knows %s", (code) => {
    expect(isReadStateRefusal(new ApiError("x", 409, { code }))).toBe(true);
  });

  it("is no other refusal", () => {
    expect(
      isReadStateRefusal(
        new ApiError("x", 409, { code: "general.business_rejection" }),
      ),
    ).toBe(false);
    expect(isReadStateRefusal(new Error("x"))).toBe(false);
  });
});

describe("show(error, { reload })", () => {
  it("says that the new state shows once the reload answered, without retry or action", async () => {
    let answer!: () => void;
    const reload = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          answer = resolve;
        }),
    );
    renderAction({
      error: changed(),
      reload,
      retry: vi.fn(),
      action: { label: "Nochmal senden", onClick: vi.fn() },
    });
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    answer();
    const toast = await screen.findByRole("alert", {
      name: /Die Anfrage wurde inzwischen geändert\. Du siehst jetzt den neuen Stand/,
    });
    expect(toast).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Nochmal senden|Wiederholen/ }),
    ).not.toBeInTheDocument();
  });

  it("drops a given action for a legacy read-state code as well", async () => {
    renderAction({
      error: new ApiError("stale", 409, {
        code: "students.change_request_stale",
      }),
      action: { label: "Nochmal senden", onClick: vi.fn() },
    });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Nochmal senden" }),
    ).not.toBeInTheDocument();
  });

  it("shows the failed reload instead, with a retry that reads only again", async () => {
    const reload = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(
        new ApiError("offline", 503, { code: "general.unavailable" }),
      )
      .mockResolvedValueOnce(undefined);
    const retry = vi.fn();
    renderAction({ error: changed(), reload, retry });

    const failed = await screen.findByRole("alert", {
      name: /Der neue Stand konnte nicht geladen werden\. Die Anfrage ist gerade nicht erreichbar/,
    });
    expect(failed).not.toHaveAccessibleName(/Du siehst jetzt den neuen Stand/);

    fireEvent.click(screen.getByRole("button", { name: /Wiederholen/ }));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByRole("alert", {
        name: /Du siehst jetzt den neuen Stand/,
      }),
    ).toBeInTheDocument();
    // The refused write is never sent again.
    expect(retry).not.toHaveBeenCalled();
  });

  it("ignores reload for any other failure", async () => {
    const reload = vi.fn(() => Promise.resolve());
    const retry = vi.fn();
    renderAction({
      error: new ApiError("down", 503, { code: "general.unavailable" }),
      reload,
      retry,
    });
    fireEvent.click(await screen.findByRole("button", { name: /Wiederholen/ }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });
});
