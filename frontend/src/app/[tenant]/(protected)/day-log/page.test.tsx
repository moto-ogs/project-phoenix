import { ToastProvider } from "~/contexts/ToastContext";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { SessionProvider } from "next-auth/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetSWRScope } from "~/lib/swr/scope";
import { catalogText } from "~/test/error-catalog-text";
import { ApiError } from "~/lib/api-error";
import { berlinTodayISO } from "~/lib/date-helpers";
import { useSWRAuth } from "~/lib/swr";
import { SWRConfig } from "~/lib/swr/testing";
import { tenantStudentKeys } from "~/lib/swr/tenant-student-keys";
import DayLogPage from "./page";

vi.unmock("swr");
const { fetchDayLog } = vi.hoisted(() => ({ fetchDayLog: vi.fn() }));
vi.mock("~/lib/day-log-api", async (original) => ({
  ...(await original<typeof import("~/lib/day-log-api")>()),
  fetchDayLog,
}));
function Providers({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <SessionProvider
      session={{ user: { id: "1", scope: "tenant" }, expires: "2099-01-01" }}
      refetchOnWindowFocus={false}
    >
      <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
        <ToastProvider>{children}</ToastProvider>
      </SWRConfig>
    </SessionProvider>
  );
}

const counters = {
  present: 1,
  sick: 0,
  class_trip: 0,
  excused: 0,
  absent: 0,
  not_scheduled: 0,
  total: 1,
};
const report = {
  date: berlinTodayISO(),
  counters,
  groups: [
    {
      group_id: "7",
      name: "Igel",
      counters,
      students: [
        {
          student_id: "42",
          first_name: "Mia",
          last_name: "Muster",
          school_class: "1a",
          status: "present",
          label: "Anwesend",
        },
      ],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  resetSWRScope({ revalidate: false });
});

describe("DayLogPage access refusal", () => {
  it.each([
    ["students.day_log_disabled", "Anwesenheitsprotokoll ist ausgeschaltet"],
    ["students.day_log_no_groups", "Noch keine Gruppen für Ihr Konto"],
  ])("withdraws the cached report on %s", async (code, title) => {
    fetchDayLog.mockResolvedValue(report);
    let reload!: () => Promise<unknown>;
    function Probe() {
      const { mutate } = useSWRAuth(
        tenantStudentKeys.dayLog(berlinTodayISO()),
        fetchDayLog,
      );
      reload = () => mutate();
      return null;
    }
    render(
      <>
        <DayLogPage />
        <Probe />
      </>,
      { wrapper: Providers },
    );
    expect(await screen.findByText("Igel")).toBeVisible();
    const print = screen.getByRole("button", { name: "Drucken" });
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(await screen.findByText("Muster, Mia")).toBeVisible();
    fetchDayLog.mockRejectedValueOnce(new ApiError("refused", 403, { code }));
    await act(async () => {
      await reload();
    });
    // Anker: der fachliche Sperrzustand ersetzt das zuvor geladene Protokoll.
    expect(await screen.findByText(new RegExp(title))).toBeVisible();
    expect(screen.queryByText("Igel")).not.toBeInTheDocument();
    expect(screen.queryByText("Muster, Mia")).not.toBeInTheDocument();
    expect(print).toBeDisabled();
  });
});

it.each([401, 403])(
  "withdraws a cached report on a general %s until a successful authorized read",
  async (status) => {
    fetchDayLog.mockResolvedValue(report);
    let reload!: () => Promise<unknown>;
    function Probe() {
      const { mutate } = useSWRAuth(
        tenantStudentKeys.dayLog(berlinTodayISO()),
        fetchDayLog,
      );
      reload = () => mutate();
      return null;
    }
    render(
      <>
        <DayLogPage />
        <Probe />
      </>,
      { wrapper: Providers },
    );
    expect(await screen.findByText("Igel")).toBeVisible();
    const print = screen.getByRole("button", { name: "Drucken" });
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(await screen.findByText("Muster, Mia")).toBeVisible();
    fetchDayLog.mockRejectedValue(new ApiError("offline", 503));
    await act(async () => {
      await reload();
    });
    expect(screen.getByText("Muster, Mia")).toBeVisible();
    expect(print).toBeEnabled();
    fetchDayLog.mockRejectedValue(new ApiError("refused", status));
    await act(async () => {
      await reload();
    });
    if (status === 403)
      expect(
        await screen.findByText(
          catalogText("general.permission", "die Tagesauswertung"),
        ),
      ).toBeVisible();
    else
      await waitFor(() =>
        expect(
          document.querySelector('[aria-busy="true"]'),
        ).toBeInTheDocument(),
      );
    expect(screen.queryByText("Igel")).not.toBeInTheDocument();
    expect(screen.queryByText("Muster, Mia")).not.toBeInTheDocument();
    expect(print).toBeDisabled();
    fetchDayLog.mockRejectedValue(new ApiError("offline", 503));
    await act(async () => {
      await reload();
    });
    expect(screen.queryByText("Muster, Mia")).not.toBeInTheDocument();
    expect(print).toBeDisabled();
    fetchDayLog.mockResolvedValue(report);
    await act(async () => {
      await reload();
    });
    expect(await screen.findByText("Igel")).toBeVisible();
    expect(print).toBeEnabled();
  },
);
