import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import type { PendingHolidayClosures } from "~/lib/traeger-closing-days";

const { mockNotifyAll } = vi.hoisted(() => ({ mockNotifyAll: vi.fn() }));

vi.mock("~/lib/traeger-closing-days", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  notifyPendingHolidayClosures: mockNotifyAll,
}));

import { TraegerHolidayClosureNotices } from "./traeger-holiday-closure-notices";

const notice = (id: string, reason: string) => ({
  id,
  schoolId: "1",
  schoolName: "OGS Am Park",
  closingDayId: id,
  reason,
  previous: null,
  current: { startDate: "2026-10-12", endDate: "2026-10-14" },
  revision: 2,
  token: `impact-${id}`,
  status: "suggested" as const,
  changed: false,
  canNotify: true,
  families: 3,
  confirmedAt: null,
  updatedAt: "2026-09-08T10:00:00Z",
  weeks: [],
  children: 4,
});

// „Alle Eltern informieren“ shows from two waiting notices on.
const pending: PendingHolidayClosures = {
  weeks: [],
  children: 8,
  families: 6,
  token: "pending-v1",
  keepsContribution: false,
  notices: [notice("7", "Pädagogischer Tag"), notice("8", "Betriebsausflug")],
};

describe("TraegerHolidayClosureNotices", () => {
  // ADR 0311 rule 6: a refused „Alle Eltern informieren“ waits for the list
  // read again. A failed read says so instead of claiming the new state.
  it("names a failed read after a refused notify-all and reads only once", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockNotifyAll.mockRejectedValue(
      new ApiError("changed", 409, { code: "general.changed_since_read" }),
    );
    const reload = vi
      .fn()
      .mockRejectedValue(
        new ApiError("down", 503, { code: "general.unavailable" }),
      );
    render(
      <ToastProvider>
        <TraegerHolidayClosureNotices
          pending={pending}
          loadError={null}
          schoolName={() => "OGS Am Park"}
          reload={reload}
        />
      </ToastProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Alle Eltern informieren" }),
    );
    expect(
      await screen.findByText(/Der neue Stand konnte nicht geladen werden\./),
    ).toBeInTheDocument();
    expect(mockNotifyAll).toHaveBeenCalledWith("pending-v1");
    expect(reload).toHaveBeenCalledOnce();
  });
});
