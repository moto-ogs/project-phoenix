import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import * as Sentry from "@sentry/nextjs";
import GlobalError from "./global-error";

describe("GlobalError", () => {
  const mockReset = vi.fn();
  const testError = new Error("Something went wrong");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports the error to Sentry on mount", () => {
    render(<GlobalError error={testError} reset={mockReset} />);

    expect(Sentry.captureException).toHaveBeenCalledWith(testError);
  });

  it("logs the crash for Loki without its message (#2512)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    render(<GlobalError error={testError} reset={mockReset} />);

    expect(warn).toHaveBeenCalledWith("error_displayed", {
      surface: "page",
      error_class: "crash",
      error_name: "Error",
    });
    warn.mockRestore();
  });

  it("renders the German error message", () => {
    render(<GlobalError error={testError} reset={mockReset} />);

    expect(
      screen.getByText("Ein unerwarteter Fehler ist aufgetreten"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Bitte versuche es erneut/)).toBeInTheDocument();
  });

  it("renders the retry button", () => {
    render(<GlobalError error={testError} reset={mockReset} />);

    expect(
      screen.getByRole("button", { name: "Erneut versuchen" }),
    ).toBeInTheDocument();
  });

  it("calls reset when the retry button is clicked", () => {
    render(<GlobalError error={testError} reset={mockReset} />);

    fireEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));

    expect(mockReset).toHaveBeenCalledOnce();
  });

  it("reports a new error when the error prop changes", () => {
    const { rerender } = render(
      <GlobalError error={testError} reset={mockReset} />,
    );

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);

    const newError = new Error("Another error");
    rerender(<GlobalError error={newError} reset={mockReset} />);

    expect(Sentry.captureException).toHaveBeenCalledTimes(2);
    expect(Sentry.captureException).toHaveBeenLastCalledWith(newError);
  });

  it("reloads once for a chunk load error, then reports a repeat", () => {
    sessionStorage.clear();
    const reload = vi
      .spyOn(globalThis.location, "reload")
      .mockImplementation(() => undefined);
    const chunkError = new Error(
      "Failed to load chunk /_next/static/chunks/a.js",
    );
    chunkError.name = "ChunkLoadError";

    const { unmount } = render(
      <GlobalError error={chunkError} reset={mockReset} />,
    );
    expect(reload).toHaveBeenCalledOnce();
    expect(Sentry.captureException).not.toHaveBeenCalled();
    unmount();

    render(<GlobalError error={chunkError} reset={mockReset} />);
    expect(reload).toHaveBeenCalledOnce();
    expect(Sentry.captureException).toHaveBeenCalledWith(chunkError);

    reload.mockRestore();
    sessionStorage.clear();
  });
});
