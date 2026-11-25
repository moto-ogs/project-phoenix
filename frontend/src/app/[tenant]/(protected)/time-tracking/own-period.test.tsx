import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type {
  OwnTimeBlock,
  OwnTimePeriod,
} from "~/lib/contract/time-tracking.generated";
import { parseISODate, toISODate } from "~/lib/date-helpers";
import type { StaffAbsenceRow, StaffHistorySession } from "~/lib/staff-api";
import { endOfWeek } from "~/lib/staff-metrics-helpers";
import { SWRConfig } from "~/lib/swr/testing";
import { ToastProvider } from "~/contexts/ToastContext";
import { deferred } from "~/test/helpers/form-modal-pending";
import { OwnPeriod, type OwnPeriodEdit } from "./own-period";

vi.unmock("swr");
const { getPeriod, identity } = vi.hoisted(() => ({
  getPeriod: vi.fn(),
  identity: { account: "a", school: "school-a" },
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    status: "authenticated",
    data: { user: { id: identity.account }, expires: "2099-01-01" },
  }),
}));
vi.mock("~/lib/tenant-context", async (original) => ({
  ...(await original<typeof import("~/lib/tenant-context")>()),
  useTenantSlugSafe: () => identity.school,
}));
vi.mock("~/lib/time-tracking-api", () => ({
  timeTrackingService: { getPeriod, getSessionEdits: vi.fn() },
}));
vi.mock("~/components/staff/staff-session-table", () => ({
  StaffSessionTable: ({
    from,
    sessions,
    absences,
    absencesUnresolved,
    onEditDay,
    editsUnresolved,
  }: {
    from: Date;
    sessions: StaffHistorySession[];
    absences?: readonly StaffAbsenceRow[];
    absencesUnresolved: boolean;
    editsUnresolved: boolean;
    onEditDay: (date: Date, row: StaffHistorySession) => void;
  }) => (
    <div>
      <p>Woche {toISODate(from)}</p>
      {!absencesUnresolved &&
        absences?.map((absence) => (
          <p key={absence.id}>
            {absence.staff_id}: {absence.absence_type}
          </p>
        ))}
      {sessions.map((row) => (
        <button
          key={row.id}
          type="button"
          disabled={editsUnresolved}
          onClick={() => onEditDay(from, row)}
        >
          Bearbeiten {row.id}
        </button>
      ))}
    </div>
  ),
}));

const FIRST = "2026-11-02";
const SECOND = "2026-11-09";
const THIRD = "2026-11-16";

function block(id: string, day: string): OwnTimeBlock {
  return {
    id,
    date: day,
    check_in_time: `${day}T22:00:00+01:00`,
    check_out_time: "2026-11-17T02:00:00+01:00",
    status: "present",
    source: "app",
    auto_checked_out: false,
    net_minutes: 240,
    break_minutes: 0,
    is_overtime: false,
    is_break_compliant: true,
    pack_up_minutes: 0,
    rounding_minutes: 0,
    edit_count: 0,
    audit_count: 0,
    version: `read-${id}`,
    breaks: [],
  };
}

function week(start: string, sessions: OwnTimeBlock[]): OwnTimePeriod {
  const end = toISODate(endOfWeek(parseISODate(start)));
  return {
    staff_id: "42",
    view: "week",
    start,
    end,
    week_start: start,
    week_end: end,
    account_start: "2026-01-01",
    sessions,
    absences: [],
    days: [],
    labor_days: [],
    rest_hints: [],
    weekly_summaries: [],
    shifts: { state: "not_booked", rows: null },
    holidays: [],
    closing_days: [],
  };
}

function ui(start: string, onEdit = vi.fn<(edit: OwnPeriodEdit) => void>()) {
  return (
    <SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false }}>
      <ToastProvider>
        <OwnPeriod
          view="week"
          start={start}
          today={THIRD}
          isCurrent={start === THIRD}
          isSessionOpen={false}
          onEdit={onEdit}
        />
      </ToastProvider>
    </SWRConfig>
  );
}

beforeEach(() => {
  getPeriod.mockReset();
  identity.account = "a";
  identity.school = "school-a";
});

it("shows absences from the period without waiting for the overview", async () => {
  getPeriod.mockResolvedValue({
    ...week(FIRST, []),
    absences: [
      {
        id: "3",
        date_start: FIRST,
        date_end: FIRST,
        absence_type: "vacation",
        half_day: false,
        start_half_day: false,
        end_half_day: false,
        status: "approved",
        requested_at: "2026-10-01T09:00:00Z",
        duration_days: 1,
      },
    ],
  } satisfies OwnTimePeriod);
  render(ui(FIRST));
  expect(await screen.findByText("42: vacation")).toBeInTheDocument();
});

it("drops a late week when switching quickly and reloads the exact chosen block's read", async () => {
  const late = deferred<OwnTimePeriod>();
  const edit = vi.fn<(edit: OwnPeriodEdit) => void>();
  getPeriod.mockImplementation((_view, start) => {
    if (start === FIRST)
      return Promise.resolve(week(FIRST, [block("1", FIRST)]));
    if (start === SECOND) return late.promise;
    return Promise.resolve(week(THIRD, [block("2", THIRD), block("3", THIRD)]));
  });

  const page = render(ui(FIRST, edit));
  await screen.findByRole("button", { name: "Bearbeiten 1" });
  page.rerender(ui(SECOND, edit));
  expect(
    screen.queryByRole("button", { name: "Bearbeiten 1" }),
  ).not.toBeInTheDocument();
  page.rerender(ui(THIRD, edit));
  const chosen = await screen.findByRole("button", { name: "Bearbeiten 3" });
  await act(async () => late.resolve(week(SECOND, [block("4", SECOND)])));
  expect(
    screen.queryByRole("button", { name: "Bearbeiten 4" }),
  ).not.toBeInTheDocument();

  fireEvent.click(chosen);
  const draft = edit.mock.calls[0]![0];
  expect(draft.staffId).toBe("42");
  expect(draft.session).toMatchObject({ id: "3", version: "read-3" });
  const refresh = deferred<OwnTimePeriod>();
  getPeriod.mockReturnValueOnce(refresh.promise);
  void act(() => {
    void draft.reloadDay();
  });
  expect(chosen).toBeEnabled();
  await act(async () => refresh.resolve(week(THIRD, [block("3", THIRD)])));

  const offline = new Error("Lesung fehlgeschlagen");
  getPeriod.mockRejectedValueOnce(offline);
  await act(async () => {
    await expect(draft.reloadDay()).rejects.toBe(offline);
  });
  expect(getPeriod).toHaveBeenLastCalledWith("week", THIRD);
  expect(screen.getByRole("button", { name: "Bearbeiten 3" })).toBeDisabled();
});

it.each(["account", "school"] as const)(
  "shows no cache data or edit from the previous %s",
  async (scope) => {
    const next = deferred<OwnTimePeriod>();
    getPeriod
      .mockResolvedValueOnce(week(THIRD, [block("1", THIRD)]))
      .mockReturnValueOnce(next.promise);
    const page = render(ui(THIRD));
    await screen.findByRole("button", { name: "Bearbeiten 1" });
    identity[scope] = "changed";
    page.rerender(ui(THIRD));
    expect(
      screen.queryByRole("button", { name: "Bearbeiten 1" }),
    ).not.toBeInTheDocument();
    await act(async () => next.resolve(week(THIRD, [block("2", THIRD)])));
    expect(
      await screen.findByRole("button", { name: "Bearbeiten 2" }),
    ).toBeEnabled();
  },
);
