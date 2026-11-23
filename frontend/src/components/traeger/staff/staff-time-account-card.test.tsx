import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TraegerResourceTestProvider } from "~/test/traeger-resource-provider";
import type {
  TraegerTimeAccount,
  TraegerTimeAccountSchool,
} from "~/lib/traeger-time-account-api";

vi.unmock("swr");

const api = vi.hoisted(() => ({
  fetchTraegerTimeAccount: vi.fn(),
  closeTraegerTimeAccountMonth: vi.fn(),
  reopenTraegerTimeAccountMonth: vi.fn(),
}));

vi.mock("~/lib/traeger-time-account-api", () => api);

import { StaffTimeAccountCard } from "./staff-time-account-card";
import { TEST_CLOCK_TODAY } from "~/test/clock";
import { ApiError } from "~/lib/api-error";
import { catalogText } from "~/test/error-catalog-text";

/** The month before the test day: the card opens on it. */
const [todayYear = 0, todayMonth = 1] = TEST_CLOCK_TODAY.split("-").map(Number);
const LAST_MONTH =
  todayMonth === 1
    ? { year: todayYear - 1, month: 12 }
    : { year: todayYear, month: todayMonth - 1 };

const minutes = {
  targetMinutes: 600,
  actualMinutes: 540,
  creditedMinutes: 0,
  adjustmentMinutes: 0,
  balanceMinutes: -60,
  carryInMinutes: 0,
  closingBalanceMinutes: -60,
};

function school(
  name: string,
  overrides: Partial<TraegerTimeAccountSchool> = {},
): TraegerTimeAccountSchool {
  return {
    ...minutes,
    schoolId: name,
    schoolName: name,
    hasTarget: true,
    byTraeger: true,
    closed: false,
    closedByTraeger: false,
    closedAt: null,
    closeReason: "",
    driftMinutes: 0,
    laterClosed: null,
    ...overrides,
  };
}

function account(
  overrides: Partial<TraegerTimeAccount> = {},
): TraegerTimeAccount {
  return {
    ...minutes,
    targetMinutes: 1200,
    actualMinutes: 1080,
    balanceMinutes: -120,
    closingBalanceMinutes: -120,
    year: LAST_MONTH.year,
    month: LAST_MONTH.month,
    state: "open",
    ended: true,
    schools: [school("OGS Nord"), school("OGS Süd")],
    fingerprint: "month-1",
    ...overrides,
  };
}

function renderCard() {
  return render(
    <TraegerResourceTestProvider>
      <StaffTimeAccountCard recordId="5" />
    </TraegerResourceTestProvider>,
  );
}

describe("StaffTimeAccountCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sums the schools of last month and closes it at every school with a reason", async () => {
    const closed = account({
      state: "closed",
      schools: [
        school("OGS Nord", { closed: true, closedByTraeger: true }),
        school("OGS Süd", { closed: true, closedByTraeger: true }),
      ],
    });
    api.fetchTraegerTimeAccount.mockResolvedValue(account());
    api.closeTraegerTimeAccountMonth.mockResolvedValue(closed);
    renderCard();

    // The card opens on the month before the test day.
    expect(await screen.findByText("Saldo des Monats")).toBeInTheDocument();
    expect(api.fetchTraegerTimeAccount).toHaveBeenCalledWith(
      "5",
      LAST_MONTH.year,
      LAST_MONTH.month,
    );
    expect(screen.getAllByText("−2h").length).toBeGreaterThan(0);
    expect(screen.getAllByText("OGS Süd").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Monat abschließen/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Begründung/), {
      target: { value: "Lohnabrechnung August" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Monat abschließen" }),
    );
    await vi.waitFor(() =>
      expect(api.closeTraegerTimeAccountMonth).toHaveBeenCalledWith("5", {
        year: LAST_MONTH.year,
        month: LAST_MONTH.month,
        reason: "Lohnabrechnung August",
        expectedFingerprint: "month-1",
      }),
    );
    expect(
      (await screen.findAllByText("Vom Träger abgeschlossen")).length,
    ).toBe(2);
    expect(
      screen.getByRole("button", { name: /Wieder öffnen/ }),
    ).toBeInTheDocument();
  });

  it("reads the month again without a retry when it changed since the read", async () => {
    api.fetchTraegerTimeAccount.mockResolvedValue(account());
    api.closeTraegerTimeAccountMonth.mockRejectedValueOnce(
      new ApiError("changed since it was read", 409, {
        code: "general.changed_since_read",
      }),
    );
    renderCard();
    expect(await screen.findByText("Saldo des Monats")).toBeInTheDocument();
    const reads = api.fetchTraegerTimeAccount.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /Monat abschließen/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Begründung/), {
      target: { value: "Lohnabrechnung August" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Monat abschließen" }),
    );

    expect(
      await within(dialog).findByText(
        catalogText("general.changed_since_read", "das Abschließen des Monats"),
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Wiederholen" }),
    ).not.toBeInTheDocument();
    await vi.waitFor(() =>
      expect(api.fetchTraegerTimeAccount.mock.calls.length).toBeGreaterThan(
        reads,
      ),
    );
  });

  it("names the school whose later month blocks the close", async () => {
    api.fetchTraegerTimeAccount.mockResolvedValue(
      account({
        schools: [
          school("OGS Nord"),
          school("OGS Süd", { laterClosed: "2026-09" }),
        ],
      }),
    );
    renderCard();
    // As the notice above the table and as the reason of the blocked button.
    expect(
      (
        await screen.findAllByText(
          "An der Schule OGS Süd ist September 2026 schon abgeschlossen. Öffne zuerst diesen Monat.",
        )
      ).length,
    ).toBe(2);
    expect(
      screen.getByRole("button", { name: /Monat abschließen/ }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  // ADR 0243 point 4: a close that stopped halfway can be finished and
  // undone; a month only the schools closed offers no reopen.
  it("offers reopen exactly where the Träger closed a school", async () => {
    api.fetchTraegerTimeAccount.mockResolvedValue(
      account({
        schools: [
          school("OGS Nord", { closed: true, closedByTraeger: true }),
          school("OGS Süd"),
        ],
      }),
    );
    const { unmount } = renderCard();
    expect(
      await screen.findByRole("button", { name: /Wieder öffnen/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Monat abschließen/ }),
    ).toBeInTheDocument();
    unmount();

    api.fetchTraegerTimeAccount.mockResolvedValue(
      account({
        state: "closed",
        schools: [school("OGS Nord", { closed: true })],
      }),
    );
    renderCard();
    expect(
      await screen.findByText("Von der Schule abgeschlossen"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Wieder öffnen/ }),
    ).not.toBeInTheDocument();
  });

  it("leaves a month without a contract to the schools", async () => {
    api.fetchTraegerTimeAccount.mockResolvedValue(
      account({
        state: "school",
        schools: [school("OGS Nord", { byTraeger: false })],
      }),
    );
    renderCard();
    expect(
      await screen.findByText(
        "Kein Arbeitsvertrag beim Träger gilt in diesem Monat. Jede Schule schließt ihn selbst ab.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("Schule schließt selbst ab").length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: /Monat abschließen/ }),
    ).not.toBeInTheDocument();
  });
});

it("performs a new audited read on immediate reopening", async () => {
  api.fetchTraegerTimeAccount.mockReset().mockResolvedValue(account());
  const view = render(<StaffTimeAccountCard recordId="5" />, {
    wrapper: TraegerResourceTestProvider,
  });
  expect(await screen.findByText("Saldo des Monats")).toBeVisible();
  expect(api.fetchTraegerTimeAccount).toHaveBeenCalledTimes(1);
  view.rerender(<div>away</div>);
  view.rerender(<StaffTimeAccountCard recordId="5" />);
  await vi.waitFor(() =>
    expect(api.fetchTraegerTimeAccount).toHaveBeenCalledTimes(2),
  );
});
