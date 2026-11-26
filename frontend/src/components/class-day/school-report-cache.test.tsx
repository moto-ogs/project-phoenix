import type * as schoolClassDayContract from "~/lib/contract/school-class-day.generated";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { Session } from "next-auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useInvalidateMatching } from "~/lib/swr";
import { SWRConfig } from "~/lib/swr/testing";
import { schoolPortalKeys } from "~/lib/swr/portal-keys";
import { SWRScopeBoundary } from "~/lib/swr/scope-boundary";
import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import type { ClassDayReport } from "~/lib/class-day-api";
import { ClassDayOverview } from "./class-day-overview";
import { ClassDayClass } from "./class-day-class";
import {
  CLASS_DAY_REFRESH_DEBOUNCE_MS,
  CLASS_DAY_REFRESH_EVENT,
} from "./use-class-day-refresh";

vi.unmock("swr");
const identity = vi.hoisted(() => ({
  session: null as Session | null,
  search: "tag=2026-09-09",
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: identity.session,
    status: identity.session ? "authenticated" : "unauthenticated",
  }),
}));
vi.mock("~/lib/tenant-context", () => ({
  useTenantSlugSafe: () => null,
  useTenantRoutingModeSafe: () => "path",
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(identity.search),
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("~/lib/school-url", () => ({ schoolPath: (path: string) => path }));
vi.mock("~/lib/session-cache", () => ({ announceSessionChange: vi.fn() }));

const report: ClassDayReport = {
  school_class: "4a",
  date: "2026-09-09",
  weekday: "wed",
  school_day: true,
  enrollment_known: true,
  can_write_day_hints: false,
  can_record_morning_attendance: false,
  can_write_homework: false,
  can_read_shared_notes: false,
  can_hand_over: false,
  can_report_absences: false,
  totals: { students: 1, staying: 1, leaving: 0, absent: 0, list_entries: 0 },
  rows: [
    {
      student_id: "1",
      first_name: "Klara",
      last_name: "Klassentag",
      registered: true,
      stays_today: true,
      offerings: ["Ganztag"],
    },
  ],
};
function signIn(id = "A", tenantId = "1", admin = false) {
  identity.session = {
    user: {
      id,
      tenantId,
      scope: "school",
      permissions: admin ? ["class_day:all_classes"] : [],
    },
    expires: "2099-01-01",
  } as Session;
}
function setup() {
  const cache = new Map();
  let invalidate: ReturnType<typeof useInvalidateMatching>;
  function Revalidation() {
    invalidate = useInvalidateMatching();
    return null;
  }
  const fetchClasses = vi.fn().mockResolvedValue({
    classes: ["4a", "4b"],
    weekend_follows_friday: false,
  });
  const fetchClassDay = vi.fn().mockResolvedValue(report);
  const fetchAssignedClasses = vi
    .fn()
    .mockResolvedValue(assignedReport(["4a", "4b"]));
  function Wrapper({ children }: Readonly<{ children: React.ReactNode }>) {
    return (
      <SWRConfig
        value={{
          provider: () => cache,
          shouldRetryOnError: false,
        }}
      >
        <ToastProvider>
          <SWRScopeBoundary />
          <Revalidation />
          {children}
        </ToastProvider>
      </SWRConfig>
    );
  }
  return {
    wrapper: Wrapper,
    cache,
    fetchClasses,
    fetchClassDay,
    fetchAssignedClasses,
    refreshAssigned: () =>
      invalidate(
        (key) => key === schoolPortalKeys.assignedClasses(report.date),
      ),
    refresh: () =>
      invalidate((key) => key.startsWith("school-class-day-report-")),
    refreshSchoolDay: () =>
      invalidate((key) => key === schoolPortalKeys.schoolDay("2026-09-09")),
  };
}
function assignedReport(
  classes: string[],
): schoolClassDayContract.AssignedClassesReport {
  return {
    date: report.date,
    school_day: true,
    weekday: "wed",
    enrollment_known: true,
    classes: classes.map((schoolClass) => ({
      school_class: schoolClass,
      changes: 0,
      totals: report.totals,
      trips: [],
    })),
  };
}

beforeEach(() => {
  signIn();
  identity.search = "tag=2026-09-09";
});

describe("school report cache", () => {
  it.each([
    ["class", 403, false],
    ["class", 503, false],
    ["class", 403, true],
    ["school", 403, false],
    ["school", 503, false],
    ["school", 403, true],
  ] as const)(
    "handles %s post-write reload returning %s (retry: %s)",
    async (reader, status, retry) => {
      if (reader === "school") signIn("A", "1", true);
      const options = setup();
      const write = vi.fn().mockResolvedValue(undefined);
      const totals = {
        ...report.totals,
        missing: 1,
        unreported: 0,
        sick: 1,
        excused: 0,
        class_trip: 0,
        changes: 0,
      };
      const schoolDay: schoolClassDayContract.SchoolDayReport = {
        date: report.date,
        weekday: "wed",
        school_day: true,
        enrollment_known: true,
        totals,
        can_report_absences: true,
        classes: [
          {
            school_class: "4a",
            totals,
            children: [
              {
                student_id: "1",
                first_name: "Klara",
                last_name: "Klassentag",
                after_school: "stays",
                status: "sick",
                status_by_school: true,
              },
            ],
          },
        ],
      };
      const fetchSchoolDay = vi.fn().mockResolvedValue(schoolDay);
      options.fetchClasses.mockResolvedValue({
        classes: ["4a"],
        can_view_school_day: true,
      });
      options.fetchClassDay.mockResolvedValue({
        ...report,
        can_hand_over: true,
        handover: { handed_over_at: "2026-09-09T09:45:00Z", absent_count: 0 },
      });
      identity.search = "tag=2026-09-09&liste=kinder";
      const ui =
        reader === "class" ? (
          <ClassDayClass
            schoolClass="4a"
            {...options}
            handOverClass={write}
            withdrawClassHandover={write}
          />
        ) : (
          <ClassDayOverview
            {...options}
            fetchSchoolDay={fetchSchoolDay}
            reportAbsence={write}
            withdrawAbsenceReport={write}
          />
        );
      const view = render(ui, options);
      // Anker: der später entzogene Bericht zeigt zunächst das Kind.
      expect(await screen.findByText("Klassentag, Klara")).toBeVisible();
      const fetch = reader === "class" ? options.fetchClassDay : fetchSchoolDay;
      const failure = new ApiError("denied or unavailable", status);
      if (retry) fetch.mockRejectedValueOnce(new ApiError("down", 503));
      fetch.mockRejectedValueOnce(failure);
      if (reader === "class") {
        fireEvent.click(
          screen.getByRole("button", { name: "Übergabe zurücknehmen" }),
        );
        fireEvent.click(screen.getByRole("button", { name: "Zurücknehmen" }));
      } else {
        fireEvent.click(
          screen.getByRole("button", {
            name: "Meldung für Klara Klassentag zurücknehmen",
          }),
        );
        fireEvent.click(
          screen.getByRole("menuitem", { name: "Meldung zurücknehmen" }),
        );
        const dialog = await screen.findByRole("dialog", {
          name: "Meldung zurücknehmen?",
        });
        fireEvent.click(
          within(dialog).getByRole("button", { name: "Zurücknehmen" }),
        );
      }
      if (retry) {
        fireEvent.click(
          await screen.findByRole("button", { name: "Wiederholen" }),
        );
      }
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(retry ? 3 : 2));
      expect(await screen.findByRole("alert")).toBeVisible();
      const key =
        reader === "class"
          ? schoolPortalKeys.classDayReport("4a", report.date)
          : schoolPortalKeys.schoolDay(report.date);
      const cached = () =>
        [...options.cache.entries()].find(([entry]) =>
          entry.endsWith(`:${key}`),
        )?.[1];
      if (status === 403) {
        await waitFor(() => expect(cached()?.data).toBeUndefined());
        expect(cached()?.error).toBe(failure);
        expect(screen.queryByText("Klassentag, Klara")).not.toBeInTheDocument();
        fetch.mockImplementation(() => new Promise(() => undefined));
        view.rerender(<div key="reopened">{ui}</div>);
        expect(await screen.findByRole("alert")).toBeVisible();
        expect(screen.queryByText("Klassentag, Klara")).not.toBeInTheDocument();
      } else {
        expect(cached()?.data).toBeDefined();
        expect(screen.getByText("Klassentag, Klara")).toBeVisible();
      }
      expect(write).toHaveBeenCalledTimes(1);
    },
  );

  it.each([1, 3, 6])(
    "loads one aggregate for %s assigned classes and fetches the sheet only when opened",
    async (count) => {
      const options = setup();
      options.fetchAssignedClasses.mockResolvedValue(
        assignedReport(
          Array.from({ length: count }, (_, i) => String(i + 4) + "a"),
        ),
      );
      const view = render(<ClassDayOverview {...options} />, options);
      // Anker: Die erwarteten Klassenkacheln stehen mit geladenen Zahlen.
      expect(await screen.findAllByText(/1 Kinder · 1 bleiben/)).toHaveLength(
        count,
      );
      expect(options.fetchAssignedClasses).toHaveBeenCalledExactlyOnceWith(
        report.date,
      );
      expect(options.fetchClasses).not.toHaveBeenCalled();
      expect(options.fetchClassDay).not.toHaveBeenCalled();
      expect(screen.queryByText("Klassentag, Klara")).not.toBeInTheDocument();

      view.rerender(<ClassDayClass schoolClass="4a" {...options} />);
      expect(await screen.findByText("Klassentag, Klara")).toBeVisible();
      expect(options.fetchClassDay).toHaveBeenCalledExactlyOnceWith(
        "4a",
        report.date,
      );
    },
  );

  it("debounces live changes into one aggregate read and defers hidden refreshes", async () => {
    const options = setup();
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    render(<ClassDayOverview {...options} />, options);
    expect(
      await screen.findByRole("link", { name: /4a 1 Kinder/ }),
    ).toBeVisible();
    vi.useFakeTimers();
    const burst = () => {
      for (let i = 0; i < 3; i++)
        fireEvent(window, new Event(CLASS_DAY_REFRESH_EVENT));
    };
    const debounce = () =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(CLASS_DAY_REFRESH_DEBOUNCE_MS);
      });

    burst();
    await debounce();
    expect(options.fetchAssignedClasses).toHaveBeenCalledTimes(2);
    hidden.mockReturnValue(true);
    burst();
    await debounce();
    expect(options.fetchAssignedClasses).toHaveBeenCalledTimes(2);

    hidden.mockReturnValue(false);
    fireEvent(document, new Event("visibilitychange"));
    await debounce();
    expect(options.fetchAssignedClasses).toHaveBeenCalledTimes(3);
    hidden.mockRestore();
  });

  it("drops an old aggregate response when authorization changes mid-read", async () => {
    const options = setup();
    const view = render(<ClassDayOverview {...options} />, options);
    expect(
      await screen.findByRole("link", { name: /4a 1 Kinder/ }),
    ).toBeVisible();

    let finish!: (value: schoolClassDayContract.AssignedClassesReport) => void;
    options.fetchAssignedClasses.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let pending!: Promise<unknown>;
    act(() => {
      pending = options.refreshAssigned();
    });
    await waitFor(() =>
      expect(options.fetchAssignedClasses).toHaveBeenCalledTimes(2),
    );
    options.fetchAssignedClasses.mockResolvedValue(assignedReport(["5c"]));
    signIn("A", "2");
    view.rerender(<ClassDayOverview {...options} />);
    expect(
      await screen.findByRole("link", { name: /5c 1 Kinder/ }),
    ).toBeVisible();

    await act(async () => {
      finish(assignedReport(["4a", "4b"]));
      await pending;
    });
    // Anker: Die Antwort der aktuellen Schulsitzung bleibt sichtbar.
    expect(screen.getByRole("link", { name: /5c 1 Kinder/ })).toBeVisible();
    expect(
      screen.queryByRole("link", { name: /4a 1 Kinder/ }),
    ).not.toBeInTheDocument();
  });

  it.each([403, 503])(
    "handles a refused or transient class read (%s) even while re-opening",
    async (status) => {
      const options = setup();
      const view = render(
        <ClassDayClass schoolClass="4a" {...options} />,
        options,
      );
      expect(await screen.findByText("Klassentag, Klara")).toBeVisible();

      const failure = new ApiError("Report refresh failed", status);
      let refuse!: (failure: ApiError) => void;
      options.fetchClassDay.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            refuse = reject;
          }),
      );
      let pending!: Promise<unknown>;
      act(() => {
        pending = options.refresh();
      });
      await waitFor(() =>
        expect(options.fetchClassDay).toHaveBeenCalledTimes(2),
      );
      expect(screen.getByText("Klassentag, Klara")).toBeVisible();
      await act(async () => {
        refuse(failure);
        await pending;
      });
      const cached = [...options.cache.entries()].find(([key]) =>
        key.endsWith(":" + schoolPortalKeys.classDayReport("4a", report.date)),
      )?.[1];
      expect(cached).toBeDefined();
      expect(cached.data).toBe(status === 403 ? undefined : report);
      expect(cached.error).toBe(failure);

      options.fetchClassDay.mockImplementation(
        () => new Promise(() => undefined),
      );
      view.rerender(
        <ClassDayClass key="reopened" schoolClass="4a" {...options} />,
      );
      if (status === 403) {
        // Anker: Der neue Leser zeigt den echten Zugriffsfehler.
        expect(await screen.findByRole("alert")).toBeVisible();
        expect(screen.queryByText("Klassentag, Klara")).not.toBeInTheDocument();
      } else {
        // Anker: Ein temporärer Fehler lässt den bestätigten Report sichtbar.
        expect(screen.getByText("Klassentag, Klara")).toBeVisible();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      }
    },
  );

  it.each([403, 503])(
    "gates cached aggregate data after a refresh error (%s)",
    async (status) => {
      const options = setup();
      render(<ClassDayOverview {...options} />, options);
      expect(
        await screen.findByRole("link", { name: /4a 1 Kinder/ }),
      ).toBeVisible();

      options.fetchAssignedClasses.mockRejectedValue(
        new ApiError("Overview refresh failed", status),
      );
      await act(async () => {
        await options.refreshAssigned();
      });
      if (status === 403) {
        // Anker: Die Fehlerkarte zeigt den abgelehnten Zugriff.
        expect(await screen.findByRole("alert")).toBeVisible();
        expect(
          screen.queryByRole("link", { name: /4a 1 Kinder/ }),
        ).not.toBeInTheDocument();
      } else {
        expect(screen.getByRole("link", { name: /4a 1 Kinder/ })).toBeVisible();
      }
    },
  );

  it.each([403, 503])(
    "handles school-day revalidation returning %s without retaining refused children",
    async (status) => {
      signIn("A", "1", true);
      const options = setup();
      identity.search = "tag=2026-09-09&liste=kinder";
      options.fetchClasses.mockResolvedValue({
        classes: ["4a"],
        can_view_school_day: true,
      });
      const totals = {
        ...report.totals,
        staying: 0,
        absent: 1,
        missing: 1,
        unreported: 0,
        sick: 1,
        excused: 0,
        class_trip: 0,
        changes: 0,
      };
      const schoolDay: schoolClassDayContract.SchoolDayReport = {
        date: "2026-09-09",
        weekday: "wed",
        school_day: true,
        enrollment_known: true,
        totals,
        can_report_absences: true,
        classes: [
          {
            school_class: "4a",
            totals,
            children: [
              {
                student_id: "1",
                first_name: "Klara",
                last_name: "Klassentag",
                after_school: "stays",
                status: "sick",
                status_by_school: true,
              },
            ],
          },
        ],
      };
      const fetchSchoolDay = vi.fn().mockResolvedValue(schoolDay);
      const reportAbsence = vi.fn().mockResolvedValue(undefined);
      const ui = (
        <ClassDayOverview
          {...options}
          fetchSchoolDay={fetchSchoolDay}
          reportAbsence={reportAbsence}
          withdrawAbsenceReport={reportAbsence}
        />
      );
      const view = render(ui, options);
      // Anker: Schulverwaltungs-Liste samt erlaubter Meldeaktion ist geladen.
      const child = await screen.findByText("Klassentag, Klara");
      const actionName = "Meldung für Klara Klassentag zurücknehmen";
      const action = screen.getByRole("button", { name: actionName });
      expect(child).toBeVisible();
      expect(action).toBeVisible();
      fireEvent.click(action);
      fireEvent.click(
        screen.getByRole("menuitem", { name: "Meldung zurücknehmen" }),
      );
      const dialog = await screen.findByRole("dialog", {
        name: "Meldung zurücknehmen?",
      });
      expect(dialog).toBeVisible();
      await act(async () => {
        await import("~/lib/error-presentation");
      });
      fetchSchoolDay.mockRejectedValueOnce(
        new ApiError("school-day refresh failed", status),
      );
      await act(async () => {
        await options.refreshSchoolDay();
      });
      if (status === 403) {
        expect(await screen.findByRole("alert")).toBeVisible();
        expect(screen.queryByText("Klassentag, Klara")).not.toBeInTheDocument();
        expect(
          screen.queryByRole("button", { name: actionName }),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByRole("dialog", { name: "Meldung zurücknehmen?" }),
        ).not.toBeInTheDocument();
      } else {
        // Anker: ein temporärer Fehler behält dieselben Inhalte und Aktionen.
        expect(screen.getByText("Klassentag, Klara")).toBe(child);
        expect(screen.getByRole("button", { name: actionName })).toBe(action);
        expect(
          screen.getByRole("dialog", { name: "Meldung zurücknehmen?" }),
        ).toBe(dialog);
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      }
      fetchSchoolDay.mockImplementation(() => new Promise(() => undefined));
      view.rerender(
        <ClassDayOverview
          key="reopened"
          {...options}
          fetchSchoolDay={fetchSchoolDay}
          reportAbsence={reportAbsence}
          withdrawAbsenceReport={reportAbsence}
        />,
      );
      if (status === 403) {
        // Anker: auch der neue Leser zeigt nur den Zugriffsfehler.
        expect(await screen.findByRole("alert")).toBeVisible();
        expect(screen.queryByText("Klassentag, Klara")).not.toBeInTheDocument();
      } else expect(screen.getByText("Klassentag, Klara")).toBeVisible();
    },
  );

  it.each([
    "account",
    "school",
    "logout",
    "other-tab-account",
    "other-tab-school",
    "other-tab-logout",
  ])(
    "withdraws the loaded report after %s, even when an old response arrives",
    async (change) => {
      const options = setup();
      const view = render(
        <ClassDayClass schoolClass="4a" {...options} />,
        options,
      );
      expect(await screen.findByText("Klassentag, Klara")).toBeVisible();
      let finish!: (value: ClassDayReport) => void;
      options.fetchClassDay.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      let pending!: Promise<unknown>;
      act(() => {
        pending = options.refresh();
      });
      await waitFor(() =>
        expect(options.fetchClassDay).toHaveBeenCalledTimes(2),
      );

      options.fetchClassDay.mockImplementation(
        () => new Promise(() => undefined),
      );
      if (change.startsWith("other-tab")) {
        act(() =>
          globalThis.dispatchEvent(
            new StorageEvent("storage", {
              key: "moto:personal-storage-owner",
              newValue: change.endsWith("logout")
                ? null
                : change === "other-tab-school"
                  ? "2:A"
                  : "1:B",
            }),
          ),
        );
      } else {
        if (change === "logout") identity.session = null;
        else
          signIn(
            change === "account" ? "B" : "A",
            change === "school" ? "2" : "1",
          );
        view.rerender(<ClassDayClass schoolClass="4a" {...options} />);
      }
      expect(screen.queryByText("Klassentag, Klara")).not.toBeInTheDocument();
      await act(async () => {
        finish(report);
        await pending;
      });
      expect(screen.queryByText("Klassentag, Klara")).not.toBeInTheDocument();
      // A fresh lookup of the old school is not confirmation of its replacement.
      if (change === "other-tab-school") {
        signIn();
        view.rerender(<ClassDayClass schoolClass="4a" {...options} />);
        expect(screen.queryByText("Klassentag, Klara")).not.toBeInTheDocument();
        expect(options.fetchClassDay).toHaveBeenCalledTimes(2);
      }
      signIn(
        change === "other-tab-school" ? "A" : "B",
        change.includes("school") ? "2" : "1",
      );
      view.rerender(<ClassDayClass schoolClass="4a" {...options} />);
      expect(screen.queryByText("Klassentag, Klara")).not.toBeInTheDocument();
    },
  );
});

import { resumeSWRSession } from "~/lib/swr/scope";
afterEach(() => resumeSWRSession());
