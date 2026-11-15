import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import type { PoolWeek } from "~/lib/staff-pool-api";

const api = vi.hoisted(() => ({
  fetchTraegerPoolWeek: vi.fn(),
  liftTraegerBlock: vi.fn(),
}));

vi.mock("~/lib/staff-pool-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/staff-pool-api")>()),
  ...api,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/personal/vertretungspool",
  useSearchParams: () => new URLSearchParams(),
}));

import TraegerStaffPoolPage from "./page";

// The test clock stands on Wednesday 2026-09-09; its week starts 2026-09-07.
const WEEK: PoolWeek = {
  weekStart: "2026-09-07",
  today: "2026-09-09",
  available: true,
  springers: [
    {
      recordId: "7",
      firstName: "Lena",
      lastName: "Springer",
      poolFrom: "2026-08-01",
      poolUntil: "2027-07-31",
      proofs: [],
      blocks: [
        {
          id: "41",
          schoolId: "2",
          schoolName: "OGS Süd",
          own: false,
          date: "2026-09-10",
          startTime: "08:00",
          endTime: "12:00",
          lifted: false,
        },
      ],
    },
  ],
};

function renderPage() {
  return render(
    <ToastProvider>
      <TraegerStaffPoolPage />
    </ToastProvider>,
  );
}

describe("TraegerStaffPoolPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchTraegerPoolWeek.mockResolvedValue(WEEK);
  });

  it("shows every block with its school and lifts one after asking", async () => {
    api.liftTraegerBlock.mockResolvedValue(undefined);
    renderPage();
    const block = await screen.findByRole("button", {
      name: /08:00–12:00, geblockt von OGS Süd/,
    });
    expect(
      screen.getAllByText("Im Pool bis 31.07.2027").length,
    ).toBeGreaterThan(0);
    fireEvent.click(block);
    const dialog = await screen.findByRole("dialog", {
      name: "Blockung aufheben?",
    });
    expect(within(dialog).getByText(/geblockt von OGS Süd/)).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: "Aufheben" }));
    expect(await screen.findByText(/ist aufgehoben/)).toBeVisible();
    expect(api.liftTraegerBlock).toHaveBeenCalledWith("41");
    expect(api.fetchTraegerPoolWeek).toHaveBeenCalledTimes(2);
  });

  it("explains a Träger without the release", async () => {
    api.fetchTraegerPoolWeek.mockRejectedValue(
      new ApiError("locked", 409, {
        code: "workforce.traeger_staff_not_released",
      }),
    );
    renderPage();
    expect(
      await screen.findByText(
        "Personal beim Träger ist noch nicht freigeschaltet.",
      ),
    ).toBeVisible();
  });
});
