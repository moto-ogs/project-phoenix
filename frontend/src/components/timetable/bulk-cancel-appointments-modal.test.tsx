import {
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { SessionProvider } from "next-auth/react";
import { useTenantMutateMatching } from "~/lib/swr";
import { tenantDailyKeys } from "~/lib/swr/tenant-daily-keys";
import { SWRConfig } from "~/lib/swr/testing";
import type { DateRange } from "react-day-picker";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "~/lib/api-error";
import type { BulkCancelResult } from "~/lib/timetable-types";
import { catalogText } from "~/test/error-catalog-text";

const { mockBulkCancel, mockToastSuccess, mockRefreshPlan } = vi.hoisted(
  () => ({
    mockBulkCancel: vi.fn(),
    mockToastSuccess: vi.fn(),
    mockRefreshPlan: vi.fn(),
  }),
);

vi.mock("~/lib/timetable-api", () => ({
  timetableService: { bulkCancel: mockBulkCancel },
}));

vi.mock("~/lib/swr", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/swr")>()),
  useTenantMutateMatching: vi.fn(() => mockRefreshPlan),
}));

vi.mock("~/contexts/ToastContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/contexts/ToastContext")>()),
  useToast: () => ({ success: mockToastSuccess, error: vi.fn() }),
}));

vi.mock("~/lib/logger", () => ({
  createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

// The kit picker is covered by its own tests; here it only has to report a
// new range the way the real one does.
vi.mock("~/components/ui/date-range-picker", () => ({
  DateRangePicker: ({
    onChange,
  }: {
    onChange: (range: DateRange | undefined) => void;
  }) => (
    <>
      <button
        type="button"
        onClick={() =>
          onChange({
            from: new Date(2026, 9, 12),
            to: new Date(2026, 9, 16),
          })
        }
      >
        Mock Zeitraum 12.–16. Okt.
      </button>
      <button
        type="button"
        onClick={() =>
          onChange({ from: new Date(2026, 9, 12), to: new Date(2026, 9, 25) })
        }
      >
        Mock Ausgangszeitraum
      </button>
    </>
  ),
}));

import { BulkCancelAppointmentsModal } from "./bulk-cancel-appointments-modal";

vi.unmock("swr");

function SWRTestWrapper({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <SessionProvider
      session={{ user: { id: "1" }, expires: "2099-01-01" }}
      refetchOnWindowFocus={false}
    >
      <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
        {children}
      </SWRConfig>
    </SessionProvider>
  );
}

function render(
  ui: Parameters<typeof rtlRender>[0],
  options?: Parameters<typeof rtlRender>[1],
) {
  return rtlRender(ui, { wrapper: SWRTestWrapper, ...options });
}

function preview(overrides: Partial<BulkCancelResult>): BulkCancelResult {
  return {
    from: "2026-10-12",
    to: "2026-10-25",
    dryRun: true,
    count: 0,
    days: [],
    kept: 0,
    keptSeries: [],
    fingerprint: "zaehlung",
    ...overrides,
  };
}

const HOLIDAY_SERIES = [
  { name: "Ferienbetreuung", count: 5 },
  { name: "Ferienspiele", count: 1 },
];

function renderModal() {
  return render(
    <BulkCancelAppointmentsModal
      isOpen
      initialFrom="2026-10-12"
      initialTo="2026-10-25"
      onClose={vi.fn()}
    />,
  );
}

describe("BulkCancelAppointmentsModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRefreshPlan.mockResolvedValue(undefined);
  });

  it("nennt die Serien, die im Plan bleiben, mit Namen und Anzahl", async () => {
    mockBulkCancel.mockResolvedValue(
      preview({ count: 23, kept: 6, keptSeries: HOLIDAY_SERIES }),
    );

    renderModal();

    expect(
      await screen.findByText(
        "Serien, die auch an Schließtagen stattfinden, bleiben: Ferienbetreuung (5 Termine), Ferienspiele (1 Termin).",
      ),
    ).toBeInTheDocument();
    const checkbox = screen.getByRole("checkbox", {
      name: "Auch diese Serien absagen",
    });
    expect(checkbox).not.toBeChecked();
    expect(mockBulkCancel).toHaveBeenCalledWith(
      "2026-10-12",
      "2026-10-25",
      true,
      false,
    );
  });

  it("zeigt keinen Widerspruch, wenn nur noch Serien an Schließtagen übrig sind", async () => {
    mockBulkCancel.mockImplementation(
      (_from: string, _to: string, dryRun: boolean, include: boolean) =>
        Promise.resolve(
          include
            ? preview({ dryRun, count: 6 })
            : preview({
                dryRun,
                count: 0,
                kept: 6,
                keptSeries: HOLIDAY_SERIES,
              }),
        ),
    );

    renderModal();

    expect(
      await screen.findByText(
        "Im Zeitraum 12.10.2026 – 25.10.2026 sind nur noch Serien geplant, die auch an Schließtagen stattfinden: Ferienbetreuung (5 Termine), Ferienspiele (1 Termin). Zum Absagen setzt du unten das Häkchen.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/sind keine Termine mehr geplant/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Termine absagen" }),
    ).toBeDisabled();

    // Das Häkchen zählt neu, jetzt mit den Serien.
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Auch diese Serien absagen",
      }),
    );
    expect(
      await screen.findByText(
        "Im Zeitraum 12.10.2026 – 25.10.2026 werden 6 Termine abgesagt. Eltern bekommen keine Nachricht.",
      ),
    ).toBeInTheDocument();
    expect(mockBulkCancel).toHaveBeenCalledWith(
      "2026-10-12",
      "2026-10-25",
      true,
      true,
    );
    // Nach dem Neuzählen bleibt das Häkchen sichtbar und abwählbar.
    expect(
      screen.getByRole("checkbox", {
        name: "Auch diese Serien absagen",
      }),
    ).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Termine absagen" }));
    fireEvent.click(screen.getByRole("button", { name: "Endgültig absagen" }));

    await waitFor(() =>
      expect(mockBulkCancel).toHaveBeenCalledWith(
        "2026-10-12",
        "2026-10-25",
        false,
        true,
        "zaehlung",
      ),
    );
    await waitFor(() =>
      expect(mockToastSuccess).toHaveBeenCalledWith("6 Termine sind abgesagt."),
    );
    expect(mockRefreshPlan).toHaveBeenCalled();
    const detail = tenantDailyKeys.planInstanceDetail("42", "2026-10-12");
    const prefixes = vi.mocked(useTenantMutateMatching).mock.lastCall?.[0];
    expect(prefixes?.some((prefix) => detail.startsWith(prefix))).toBe(true);
  });

  it("zeigt einen Fehler beim Zählen vor Ort und zählt mit Wiederholen neu", async () => {
    mockBulkCancel
      .mockRejectedValueOnce(
        new ApiError("Failed to fetch", 503, { code: "general.unavailable" }),
      )
      .mockResolvedValueOnce(preview({ count: 4 }));

    renderModal();

    expect(
      await screen.findByText(
        catalogText("general.unavailable", "das Zählen der Termine"),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    expect(
      await screen.findByText(/werden 4 Termine abgesagt/),
    ).toBeInTheDocument();
    expect(mockBulkCancel).toHaveBeenCalledTimes(2);
  });

  it("zeigt einen Fehler beim Absagen im Dialog und wiederholt ihn", async () => {
    mockBulkCancel.mockImplementation(
      (_from: string, _to: string, dryRun: boolean) =>
        dryRun
          ? Promise.resolve(preview({ count: 3 }))
          : Promise.reject(
              new ApiError("boom", 500, { code: "general.server" }),
            ),
    );

    renderModal();
    await screen.findByText(/werden 3 Termine abgesagt/);
    fireEvent.click(screen.getByRole("button", { name: "Termine absagen" }));
    fireEvent.click(screen.getByRole("button", { name: "Endgültig absagen" }));

    expect(
      await screen.findByText(
        catalogText("general.server", "die Absage der Termine"),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("boom")).not.toBeInTheDocument();
    expect(mockToastSuccess).not.toHaveBeenCalled();

    mockBulkCancel.mockImplementation(
      (_from: string, _to: string, dryRun: boolean) =>
        Promise.resolve(preview({ dryRun, count: 3 })),
    );
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    await waitFor(() =>
      expect(mockToastSuccess).toHaveBeenCalledWith("3 Termine sind abgesagt."),
    );
  });

  it("zählt neu, wenn der Zeitraum geändert wird", async () => {
    mockBulkCancel.mockImplementation((from: string, to: string) =>
      Promise.resolve(
        preview({ from, to, count: to === "2026-10-16" ? 12 : 40 }),
      ),
    );

    renderModal();

    expect(
      await screen.findByText(/werden 40 Termine abgesagt/),
    ).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Zeitraum" })).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Mock Zeitraum 12.–16. Okt." }),
    );

    expect(
      await screen.findByText(
        "Im Zeitraum 12.10.2026 – 16.10.2026 werden 12 Termine abgesagt. Eltern bekommen keine Nachricht.",
      ),
    ).toBeInTheDocument();
    expect(mockBulkCancel).toHaveBeenLastCalledWith(
      "2026-10-12",
      "2026-10-16",
      true,
      false,
    );
  });

  it("schreibt einen einzelnen Tag als ein Datum", async () => {
    mockBulkCancel.mockResolvedValue(preview({ count: 1 }));

    render(
      <BulkCancelAppointmentsModal
        isOpen
        initialFrom="2026-10-12"
        initialTo="2026-10-12"
        onClose={vi.fn()}
      />,
    );

    expect(
      await screen.findByText(
        "Am 12.10.2026 wird 1 Termin abgesagt. Eltern bekommen keine Nachricht.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", {
        name: "Auch diese Serien absagen",
      }),
    ).not.toBeInTheDocument();
  });
});

it("zählt neu statt zu wiederholen, wenn sich die Termine seit dem Zählen geändert haben", async () => {
  mockBulkCancel.mockImplementation(
    (_from: string, _to: string, dryRun: boolean) =>
      dryRun
        ? Promise.resolve(preview({ count: 3, fingerprint: "erste" }))
        : Promise.reject(
            new ApiError("changed", 409, {
              code: "general.changed_since_read",
            }),
          ),
  );
  renderModal();
  await screen.findByText(/werden 3 Termine abgesagt/);

  mockBulkCancel.mockImplementation(
    (_from: string, _to: string, dryRun: boolean) =>
      dryRun
        ? Promise.resolve(preview({ count: 5, fingerprint: "zweite" }))
        : Promise.resolve(preview({ dryRun, count: 5 })),
  );
  // Der erste Versuch scheitert noch an der alten Zählung.
  mockBulkCancel.mockImplementationOnce(() =>
    Promise.reject(
      new ApiError("changed", 409, { code: "general.changed_since_read" }),
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Termine absagen" }));
  fireEvent.click(screen.getByRole("button", { name: "Endgültig absagen" }));

  expect(
    await screen.findByText(/werden 5 Termine abgesagt/),
  ).toBeInTheDocument();
  expect(mockBulkCancel).toHaveBeenCalledWith(
    "2026-10-12",
    "2026-10-25",
    false,
    false,
    "erste",
  );
  expect(
    await screen.findByText(
      catalogText("general.changed_since_read", "die Absage der Termine"),
    ),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Wiederholen" }),
  ).not.toBeInTheDocument();
  expect(mockToastSuccess).not.toHaveBeenCalled();
});

// ADR 0311 rule 6: a failed recount after a refusal says so, and the
// refused count is not confirmed again.
it("nennt ein gescheitertes Neuzählen nach einer Ablehnung und sagt nichts ab", async () => {
  mockBulkCancel.mockReset();
  mockBulkCancel.mockResolvedValue(preview({ count: 3, fingerprint: "erste" }));
  renderModal();
  await screen.findByText(/werden 3 Termine abgesagt/);
  mockBulkCancel.mockImplementation(
    (_from: string, _to: string, dryRun: boolean) =>
      Promise.reject(
        dryRun
          ? new ApiError("down", 503, { code: "general.unavailable" })
          : new ApiError("changed", 409, {
              code: "general.changed_since_read",
            }),
      ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Termine absagen" }));
  fireEvent.click(screen.getByRole("button", { name: "Endgültig absagen" }));

  expect(
    await screen.findByText(/Der neue Stand konnte nicht geladen werden/),
  ).toBeInTheDocument();
  expect(
    screen.queryByText(/Du siehst jetzt den neuen Stand/),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText(/werden 3 Termine abgesagt/),
  ).not.toBeInTheDocument();
  expect(
    mockBulkCancel.mock.calls.filter(([, , dryRun]) => dryRun === false),
  ).toHaveLength(1);
});
