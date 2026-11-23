import { act } from "@testing-library/react";
import { setTestClock, TEST_CLOCK_TODAY } from "~/test/clock";
import { schoolDateCases, setSchoolDateClock } from "~/test/school-date-cases";
import { afterEach as restoreZoneAfterEach, vi as zoneVi } from "vitest";
import { SessionProvider } from "next-auth/react";
import { SWRConfig } from "~/lib/swr/testing";

vi.unmock("swr");
restoreZoneAfterEach(() => zoneVi.unstubAllEnvs());
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "~/lib/api-error";
import { SAVED_BUT_STALE_SUFFIX } from "~/lib/hooks/use-refresh-after-write";
import { catalogText } from "~/test/error-catalog-text";

vi.mock("~/components/ui/date-picker", async () =>
  (await import("~/test/mocks/date-picker")).datePickerModuleMock(),
);

vi.mock("~/components/ui/modal", () => ({
  Modal: ({
    isOpen,
    title,
    children,
    footer,
  }: {
    isOpen: boolean;
    title: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        {children}
        {footer}
      </div>
    ) : null,
}));

vi.mock("~/lib/tenant-path", () => ({
  useTenantAwarePath: () => (path: string) => `/demo${path}`,
}));

const stable = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  mutateMatching: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/contexts/ToastContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/contexts/ToastContext")>()),
  useToast: () => stable.toast,
  useApiErrorDisplay: () => ({ show: actionErrors.show }),
}));
const actionErrors = vi.hoisted(() => ({ show: vi.fn() }));
vi.mock("~/lib/swr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/swr")>();
  return {
    ...actual,
    useTenantMutateMatching: () => stable.mutateMatching,
    // Soll-Hinweis des Buchungsdialogs (#6887): unbekannt, also kein Hinweis.
    useSWRAuth: ((key: unknown, ...rest: unknown[]) => {
      const monthSummary =
        typeof key === "string" && key.startsWith("staff-month-summary-");
      const result = (actual.useSWRAuth as (...args: unknown[]) => object)(
        monthSummary ? null : key,
        ...rest,
      );
      return monthSummary ? { ...result, data: undefined } : result;
    }) as typeof actual.useSWRAuth,
  };
});

const mocks = vi.hoisted(() => ({
  getVacationQuota: vi.fn(),
  getAbsences: vi.fn(),
  getAbsenceTypes: vi.fn(),
  getAllowance: vi.fn(),
  setAllowance: vi.fn(),
  createAbsence: vi.fn(),
}));

vi.mock("~/lib/staff-api", () => ({
  staffAbsenceService: {
    getVacationQuota: mocks.getVacationQuota,
    getAbsences: mocks.getAbsences,
    createAbsence: mocks.createAbsence,
    getCompTimePreview: vi.fn(),
    approve: vi.fn(),
    deleteAbsence: vi.fn(),
  },
}));
vi.mock("~/lib/absence-type-api", () => ({
  absenceTypeService: {
    getAbsenceTypes: mocks.getAbsenceTypes,
    getAllowance: mocks.getAllowance,
    setAllowance: mocks.setAllowance,
  },
}));

import { AbwesenheitenTab } from "./abwesenheiten-tab";

// #6652: the second load of the tab (the reload after the write) fails once.
function failSecondLoad(mock: ReturnType<typeof vi.fn>) {
  const original = mock.getMockImplementation() as (
    ...args: unknown[]
  ) => unknown;
  let calls = 0;
  mock.mockImplementation((...args: unknown[]) => {
    calls += 1;
    return calls === 2
      ? Promise.reject(
          new ApiError("down", 503, { code: "general.unavailable" }),
        )
      : original(...args);
  });
}
const RELOAD_TEXT = `${catalogText("general.unavailable", "die Anzeige der Abwesenheiten")} ${SAVED_BUT_STALE_SUFFIX}`;

// The tab opens on the year of the test day.
const year = Number(TEST_CLOCK_TODAY.slice(0, 4));
const allowance = {
  staffId: "4",
  absenceTypeId: "12",
  year,
  entitledDays: 3.5,
  takenDays: 0.5,
  reservedDays: 1,
  remainingDays: 2,
  expiresOn: `${year}-12-31`,
  expiredDays: 0,
  bookingDays: 0,
  carriedIn: null,
  version: "claim-read",
};
const regeneration = {
  id: "12",
  name: "Regenerationstag",
  baseType: "other",
  isActive: true,
  allowanceEnabled: true,
  carryoverUntil: null,
};

function renderTab(props: Partial<{ canEditQuota: boolean }> = {}) {
  return renderWithCache(
    <AbwesenheitenTab
      staffId="4"
      canEdit
      canEditQuota={props.canEditQuota ?? true}
      canManageSickReports
      staff={{ id: "4", firstName: "Rena", lastName: "Generation" }}
    />,
  );
}

describe("AbwesenheitenTab Kontingente (#3256)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getVacationQuota.mockImplementation((_id: string, y: number) =>
      Promise.resolve({
        staff_id: 4,
        year: y,
        entitled_days: 28,
        carryover_days: 2,
        taken_before_days: 3,
        taken_days: 5,
        reserved_days: 2,
        remaining_days: 20,
      }),
    );
    mocks.getAbsences.mockResolvedValue([]);
    mocks.getAbsenceTypes.mockResolvedValue([regeneration]);
    mocks.getAllowance.mockImplementation(
      (_type: string, _id: string, y: number) =>
        Promise.resolve({ ...allowance, year: y }),
    );
    mocks.setAllowance.mockResolvedValue(allowance);
  });

  it("shows vacation and every own account with claim, taken, reserved and rest", async () => {
    renderTab();

    const vacation = await screen.findByRole("region", {
      name: `Urlaub ${year}`,
    });
    expect(within(vacation).getByText("30 Tage")).toBeInTheDocument();
    expect(
      within(vacation).getByText("28 + 2 aus dem Vorjahr"),
    ).toBeInTheDocument();
    expect(within(vacation).getByText("8 Tage")).toBeInTheDocument();
    expect(
      within(vacation).getByText("davon 3 Tage vor moto"),
    ).toBeInTheDocument();
    expect(within(vacation).getByText("20 Tage")).toBeInTheDocument();

    const own = screen.getByRole("region", {
      name: `Regenerationstag ${year}`,
    });
    for (const label of ["Anspruch", "Genommen", "Vorgemerkt", "Übrig"]) {
      expect(within(own).getByText(label)).toBeInTheDocument();
    }
    expect(within(own).getByText("3,5 Tage")).toBeInTheDocument();
    expect(within(own).getByText("2 Tage")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Abwesenheitsarten verwalten/ }),
    ).toHaveAttribute("href", "/demo/database/absence-types");
  });

  it("says when the rest expires and what was carried over (#3257)", async () => {
    mocks.getAllowance.mockImplementation(
      (_type: string, _id: string, y: number) =>
        Promise.resolve({
          ...allowance,
          year: y,
          expiresOn: `${y + 1}-03-31`,
          carriedIn: {
            year: y - 1,
            remainingDays: 0,
            expiredDays: 4,
            expiresOn: `${y}-03-31`,
          },
        }),
    );
    renderTab();

    const card = await screen.findByRole("region", {
      name: `Regenerationstag ${year}`,
    });
    expect(
      within(card).getByText(`Rest verfällt am 31.03.${year + 1}.`),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(
        `4 Tage aus ${year - 1} am 31.03.${year} verfallen.`,
      ),
    ).toBeInTheDocument();
  });

  it("shows an expired rest and a usable carryover", async () => {
    mocks.getAllowance.mockImplementation(
      (_type: string, _id: string, y: number) =>
        Promise.resolve({
          ...allowance,
          year: y,
          remainingDays: 0,
          expiredDays: 1.5,
          expiresOn: `${y}-12-31`,
          carriedIn: {
            year: y - 1,
            remainingDays: 3,
            expiredDays: 0,
            expiresOn: `${y + 1}-03-31`,
          },
        }),
    );
    renderTab();

    const card = await screen.findByRole("region", {
      name: `Regenerationstag ${year}`,
    });
    expect(
      within(card).getByText(`1,5 Tage am 31.12.${year} verfallen.`),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(
        `Dazu noch 3 Tage aus ${year - 1}, nutzbar bis 31.03.${year + 1}. Diese gehen zuerst ab.`,
      ),
    ).toBeInTheDocument();
    expect(within(card).queryByText(/Rest verfällt/)).not.toBeInTheDocument();
  });

  it("raises a claim with plus and requires a reason", async () => {
    renderTab();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Anspruch ändern: Regenerationstag",
      }),
    );
    const days = screen.getByLabelText(`Anspruch ${year} in Tagen`);
    expect(days).toHaveValue("3,5");

    const plus = screen.getByRole("button", { name: "Einen Tag mehr" });
    fireEvent.click(plus);
    fireEvent.click(plus);
    expect(days).toHaveValue("5,5");

    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(
      screen.getByText("Bitte kurz sagen, warum sich der Anspruch ändert."),
    ).toBeInTheDocument();
    expect(mocks.setAllowance).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Begründung"), {
      target: { value: "In den Sommerferien krank" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(mocks.setAllowance).toHaveBeenCalledWith("12", "4", {
        year,
        entitledDays: 5.5,
        reason: "In den Sommerferien krank",
        expectedVersion: "claim-read",
      }),
    );
  });

  // ADR 0311: a claim a colleague changed since the form opened is not
  // overwritten; the form closes and the card reads the stored claim.
  it("closes the form and reloads the claim after a changed-since-read refusal", async () => {
    mocks.setAllowance.mockRejectedValue(
      new ApiError("changed since it was read", 409, {
        code: "general.changed_since_read",
      }),
    );
    renderTab();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Anspruch ändern: Regenerationstag",
      }),
    );
    const loads = mocks.getAbsenceTypes.mock.calls.length + mocks.getAllowance.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Einen Tag mehr" }));
    fireEvent.change(screen.getByLabelText("Begründung"), {
      target: { value: "In den Sommerferien krank" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(actionErrors.show).toHaveBeenCalledWith(
        expect.objectContaining({ code: "general.changed_since_read" }),
        expect.objectContaining({
          object: "die Änderung am Anspruch",
          reload: expect.any(Function),
        }),
      ),
    );
    expect(screen.queryByLabelText("Begründung")).toBeNull();
    const [, options] = actionErrors.show.mock.calls[0] as [
      unknown,
      { reload: () => Promise<unknown> },
    ];
    await options.reload();
    await waitFor(() =>
      expect(
        mocks.getAbsenceTypes.mock.calls.length +
          mocks.getAllowance.mock.calls.length,
      ).toBeGreaterThan(loads),
    );
    expect(mocks.setAllowance).toHaveBeenCalledTimes(1);
  });

  it("keeps a raised claim saved when the reload fails (#6652)", async () => {
    mocks.setAllowance.mockResolvedValue(undefined);
    failSecondLoad(mocks.getAbsences);
    renderTab();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Anspruch ändern: Regenerationstag",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Einen Tag mehr" }));
    fireEvent.change(screen.getByLabelText("Begründung"), {
      target: { value: "In den Sommerferien krank" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(await screen.findByText(RELOAD_TEXT)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    await waitFor(() => expect(mocks.getAbsences).toHaveBeenCalledTimes(3));
    expect(mocks.setAllowance).toHaveBeenCalledTimes(1);
  });

  it("does not let a claim drop below the days already used", async () => {
    renderTab();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Anspruch ändern: Regenerationstag",
      }),
    );
    // 0,5 taken + 1 reserved: one step down from 3,5 is still fine, the
    // next one would cut into used days.
    const minus = screen.getByRole("button", { name: "Einen Tag weniger" });
    fireEvent.click(minus);
    fireEvent.click(minus);
    expect(screen.getByLabelText(`Anspruch ${year} in Tagen`)).toHaveValue(
      "1,5",
    );
    expect(minus).toBeDisabled();

    fireEvent.change(screen.getByLabelText(`Anspruch ${year} in Tagen`), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText("Begründung"), {
      target: { value: "Teilzeit" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(
      screen.getByText(
        "Mindestens 1,5 Tage. So viele sind schon eingetragen oder beantragt.",
      ),
    ).toBeInTheDocument();
    expect(mocks.setAllowance).not.toHaveBeenCalled();
  });

  it("loads all accounts for the chosen year", async () => {
    renderTab();
    await screen.findByRole("region", { name: `Urlaub ${year}` });

    fireEvent.click(screen.getByRole("button", { name: String(year + 1) }));

    expect(
      await screen.findByRole("region", { name: `Urlaub ${year + 1}` }),
    ).toBeInTheDocument();
    expect(mocks.getVacationQuota).toHaveBeenCalledWith("4", year + 1);
    expect(mocks.getAllowance).toHaveBeenCalledWith("12", "4", year + 1);
  });

  it("keeps a retired account visible but out of new bookings", async () => {
    mocks.getAbsenceTypes.mockResolvedValue([
      { ...regeneration, isActive: false },
    ]);
    renderTab();

    expect(
      await screen.findByRole("region", { name: `Regenerationstag ${year}` }),
    ).toBeInTheDocument();
    expect(screen.getByText("ausgeschaltet")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Abwesenheit eintragen" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Abwesenheit eintragen: Rena Generation",
    });
    expect(
      within(dialog).getByRole("radio", { name: /^Urlaub/ }),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("radio", { name: /Regenerationstag/ }),
    ).not.toBeInTheDocument();
  });

  it("points to the art catalog when no own account exists", async () => {
    mocks.getAbsenceTypes.mockResolvedValue([]);
    renderTab();

    expect(
      await screen.findByText(
        /Regenerationstage oder Krank-Urlaubstage zählen/,
      ),
    ).toBeInTheDocument();
  });

  it("hides every edit entry without time_tracking:manage", async () => {
    renderTab({ canEditQuota: false });

    await screen.findByRole("region", { name: `Urlaub ${year}` });
    expect(
      screen.queryByRole("button", { name: /Anspruch ändern/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Abwesenheitsarten verwalten/ }),
    ).not.toBeInTheDocument();
  });

  it.each(schoolDateCases("2026-05-27"))(
    "moves ended absences to history at Berlin midnight in %s",
    async (zone, instant) => {
      setSchoolDateClock(zone, instant, "2026-05-27");
      vi.useFakeTimers({ shouldAdvanceTime: true });
      mocks.getAbsences.mockResolvedValue([
        {
          id: 1,
          absence_type: "sick",
          date_start: "2026-05-27",
          date_end: "2026-05-27",
          status: "reported",
          note: "Heute krank",
        },
      ]);
      renderTab();
      const upcoming = (
        await screen.findByRole("heading", { name: "Kommende Abwesenheiten" })
      ).closest("section")!;
      expect(
        await within(upcoming).findByText("Heute krank"),
      ).toBeInTheDocument();
      await act(async () => {
        setTestClock("2026-05-27T22:01:00Z");
        vi.advanceTimersByTime(60_000);
      });
      const history = screen
        .getByRole("heading", { name: /Historie/ })
        .closest("section")!;
      expect(within(history).getByText("Heute krank")).toBeInTheDocument();
    },
  );
});

// Echter SWR-Cache je Render und eine Sitzung mit Konto, sonst liest
// useSWRAuth nichts.
function TenantSWR({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider
      session={{
        user: { id: "staff-test", tenantId: 1 },
        expires: "2099-01-01",
      }}
      refetchOnWindowFocus={false}
    >
      <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
        {children}
      </SWRConfig>
    </SessionProvider>
  );
}
const renderWithCache = (ui: React.ReactElement) =>
  render(ui, { wrapper: TenantSWR });
