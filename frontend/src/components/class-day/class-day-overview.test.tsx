import type * as schoolClassDayContract from "~/lib/contract/school-class-day.generated";
import {
  act,
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { deferred } from "~/test/helpers/form-modal-pending";
import { ApiError } from "~/lib/api-error";
import { catalogText } from "~/test/error-catalog-text";
import { SAVED_BUT_STALE_SUFFIX } from "~/lib/hooks/use-refresh-after-write";
import { setTestClock } from "~/test/clock";
import { ClassDayOverview } from "./class-day-overview";

const navigation = vi.hoisted(() => ({
  search: "",
  replace: vi.fn(),
  admin: false,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(navigation.search),
  useRouter: () => ({ push: vi.fn(), replace: navigation.replace }),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: {
        id: "teacher",
        scope: "school",
        tenantId: "1",
        permissions: navigation.admin ? ["class_day:all_classes"] : [],
      },
      expires: "2099-01-01",
    },
    status: "authenticated",
  }),
}));

vi.mock("~/lib/school-url", () => ({
  schoolPath: (path: string) => path,
}));

vi.unmock("swr");
import { SWRConfig } from "~/lib/swr/testing";
import { ToastProvider } from "~/contexts/ToastContext";
import type { ReactElement } from "react";

function render(ui: ReactElement) {
  const cache = new Map();
  return rtlRender(ui, {
    wrapper: ({ children }) => (
      <SWRConfig value={{ provider: () => cache, shouldRetryOnError: false }}>
        <ToastProvider>{children}</ToastProvider>
      </SWRConfig>
    ),
  });
}

function assignedClasses(
  date: string,
  schoolDay = true,
): schoolClassDayContract.AssignedClassesReport {
  return {
    date,
    weekday: schoolDay ? "fri" : "",
    school_day: schoolDay,
    enrollment_known: true,
    classes: [
      {
        school_class: "4a",
        trips: [],
        totals: {
          students: 1,
          staying: schoolDay ? 1 : 0,
          leaving: 0,
          absent: 0,
          list_entries: 0,
        },
        changes: 0,
      },
    ],
  };
}

describe("ClassDayOverview on the weekend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigation.search = "";
    navigation.admin = false;
    setTestClock(new Date("2026-09-05T12:00:00+02:00")); // Samstag
  });

  it("shows no handover without the weekend plan", async () => {
    const fetchAssignedClasses = vi.fn(async (date: string) =>
      assignedClasses(date, false),
    );
    const fetchClasses = vi.fn();
    render(
      <ClassDayOverview
        fetchClasses={fetchClasses}
        fetchAssignedClasses={fetchAssignedClasses}
      />,
    );

    // Anker: die Antwort ohne Schultag ist geladen.
    expect(await screen.findByText("Kein Schultag")).toBeVisible();
    expect(screen.queryByRole("link", { name: /4a/ })).not.toBeInTheDocument();
    expect(fetchClasses).not.toHaveBeenCalled();
    expect(fetchAssignedClasses).toHaveBeenCalledExactlyOnceWith("2026-09-05");
  });

  it("greets without a name when the session carries none", async () => {
    render(
      <ClassDayOverview
        fetchClasses={vi.fn()}
        fetchAssignedClasses={async (date) => assignedClasses(date, false)}
      />,
    );

    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
      /^Guten (Morgen|Tag|Abend)$/,
    );
  });

  it("shows the assigned class when the weekend follows Friday's plan", async () => {
    const fetchAssignedClasses = vi.fn(async (date: string) =>
      assignedClasses(date),
    );
    render(
      <ClassDayOverview
        fetchClasses={vi.fn()}
        fetchAssignedClasses={fetchAssignedClasses}
      />,
    );

    expect(
      await screen.findByRole("link", { name: /4a 1 Kinder/ }),
    ).toBeVisible();
    expect(fetchAssignedClasses).toHaveBeenCalledExactlyOnceWith("2026-09-05");
  });
});

describe("ClassDayOverview day selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigation.search = "tag=2026-09-08";
    navigation.admin = false;
  });

  it("passes the day from the address to notices and class cards", async () => {
    const fetchAssignedClasses = vi.fn(async (date: string) =>
      assignedClasses(date),
    );
    const notices = vi.fn((date: string) => (
      <output data-testid="class-day-notices-date">{date}</output>
    ));

    render(
      <ClassDayOverview
        fetchClasses={vi.fn()}
        fetchAssignedClasses={fetchAssignedClasses}
        notices={notices}
      />,
    );

    expect(
      await screen.findByTestId("class-day-notices-date"),
    ).toHaveTextContent("2026-09-08");
    expect(notices).toHaveBeenLastCalledWith("2026-09-08");
    expect(fetchAssignedClasses).toHaveBeenCalledExactlyOnceWith("2026-09-08");
  });
});

const schoolTotals = {
  students: 0,
  missing: 0,
  unreported: 0,
  absent: 0,
  sick: 0,
  excused: 0,
  class_trip: 0,
  staying: 0,
  leaving: 0,
  list_entries: 0,
  changes: 0,
};

function schoolDay(date: string): schoolClassDayContract.SchoolDayReport {
  return {
    date,
    weekday: "wed",
    school_day: true,
    enrollment_known: true,
    can_report_absences: false,
    totals: {
      ...schoolTotals,
      students: 3,
      missing: 1,
      unreported: 0,
      absent: 1,
      sick: 1,
      staying: 1,
      leaving: 1,
    },
    classes: [
      {
        school_class: "1a",
        totals: {
          ...schoolTotals,
          students: 2,
          missing: 1,
          unreported: 0,
          absent: 1,
          sick: 1,
          staying: 1,
          changes: 1,
        },
        children: [
          {
            student_id: "1",
            first_name: "Anna",
            last_name: "Arndt",
            after_school: "stays",
          },
          {
            student_id: "2",
            first_name: "Ben",
            last_name: "Busch",
            status: "sick",
            missing: true,
            changed: true,
          },
        ],
      },
      {
        school_class: "2b",
        totals: { ...schoolTotals, students: 1, leaving: 1 },
        children: [
          {
            student_id: "3",
            first_name: "Carl",
            last_name: "Claus",
            after_school: "goes_home",
          },
        ],
      },
    ],
  };
}

// Die Schulverwaltung sieht alle Klassen (#4802): die Startseite lädt die
// Tagesübersicht der Schule einmal statt einen Report je Klasse, und jede
// Zahl öffnet die Kinder dahinter, nach Klasse gruppiert.
describe("ClassDayOverview for the Schulverwaltung", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigation.search = "";
    navigation.admin = true;
    setTestClock(new Date("2026-09-09T12:00:00+02:00")); // Mittwoch
  });

  const classes = () =>
    Promise.resolve({
      classes: ["1a", "2b"],
      can_report_class_trip: false,
      weekend_follows_friday: false,
      can_write_arrival_exception: false,
      can_view_school_day: true,
    });

  it("loads the school once instead of one report per class", async () => {
    const fetchAssignedClasses = vi.fn();
    const fetchSchoolDay = vi.fn((date: string) =>
      Promise.resolve(schoolDay(date)),
    );
    render(
      <ClassDayOverview
        fetchClasses={classes}
        fetchAssignedClasses={fetchAssignedClasses}
        fetchSchoolDay={fetchSchoolDay}
      />,
    );

    expect(await screen.findByText("Ganze Schule")).toBeVisible();
    expect(fetchSchoolDay).toHaveBeenCalledWith("2026-09-09");
    expect(fetchAssignedClasses).not.toHaveBeenCalled();
    expect(
      screen.getByRole("link", { name: /^Krank 1 ?, Liste öffnen$/ }),
    ).toHaveAttribute("href", "/school?tag=2026-09-09&liste=krank");
    // Die Klassenzeilen kommen aus derselben Antwort.
    expect(screen.getByText("Alle Klassen")).toBeVisible();
    expect(
      screen.getByText(/2 Kinder · 1 bleiben · 0 gehen heim/),
    ).toBeVisible();
    expect(screen.getByText("1 Kind anders als sonst")).toBeVisible();
  });

  it("lists the children of an opened number by class", async () => {
    navigation.search = "tag=2026-09-09&liste=gehen-heim";
    render(
      <ClassDayOverview
        fetchClasses={classes}
        fetchAssignedClasses={vi.fn()}
        fetchSchoolDay={(date) => Promise.resolve(schoolDay(date))}
      />,
    );

    expect(await screen.findByText("Gehen heim: 1")).toBeVisible();
    expect(screen.getByText("Claus, Carl")).toBeVisible();
    expect(screen.getByRole("link", { name: /2b · 1/ })).toHaveAttribute(
      "href",
      "/school/klasse?klasse=2b&tag=2026-09-09&liste=gehen-heim",
    );
    expect(screen.getByRole("link", { name: /2b 1 Kinder/ })).toHaveAttribute(
      "href",
      "/school/klasse?klasse=2b&tag=2026-09-09&liste=gehen-heim",
    );
    expect(screen.queryByText("Busch, Ben")).not.toBeInTheDocument();
  });

  it("labels a child without a care place in the school roster", async () => {
    navigation.search = "tag=2026-09-09&liste=kinder";
    const data = schoolDay("2026-09-09");
    data.classes![1]!.children = [
      {
        student_id: "3",
        first_name: "Carl",
        last_name: "Claus",
        without_care_place: true,
      },
    ];
    data.classes![1]!.totals = {
      ...schoolTotals,
      students: 1,
      list_entries: 1,
    };
    data.totals = { ...data.totals, leaving: 0, list_entries: 1 };
    render(
      <ClassDayOverview
        fetchClasses={classes}
        fetchAssignedClasses={vi.fn()}
        fetchSchoolDay={() => Promise.resolve(data)}
      />,
    );

    const child = await screen.findByText("Claus, Carl");
    expect(child).toBeVisible();
    expect(child.closest("li")).toHaveTextContent("keine Betreuung");
  });

  it("keeps the opened list when the day changes", async () => {
    navigation.search = "tag=2026-09-09&liste=krank";
    render(
      <ClassDayOverview
        fetchClasses={classes}
        fetchAssignedClasses={vi.fn()}
        fetchSchoolDay={(date) => Promise.resolve(schoolDay(date))}
      />,
    );

    expect(await screen.findByText("Krank: 1")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Vorheriger Tag" }));
    expect(navigation.replace).toHaveBeenCalledWith(
      "/school?tag=2026-09-08&liste=krank",
      { scroll: false },
    );
  });
});

// Fehlen ohne Meldung (#4791): die Schulverwaltung trägt für ein Kind, das
// die Lehrkraft als fehlend eingetragen hat und das niemand gemeldet hat,
// „krank“ oder „entschuldigt“ nach, und nimmt ihre eigene Meldung zurück.
describe("ClassDayOverview: Meldung nachtragen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigation.search = "";
    navigation.admin = true;
    setTestClock(new Date("2026-09-09T12:00:00+02:00")); // Mittwoch
  });

  const classes = () =>
    Promise.resolve({
      classes: ["1a"],
      can_report_class_trip: false,
      weekend_follows_friday: false,
      can_write_arrival_exception: false,
      can_view_school_day: true,
    });

  function unreportedDay(
    date: string,
    reported: "sick" | null,
    canReport = true,
  ): schoolClassDayContract.SchoolDayReport {
    const child = reported
      ? {
          student_id: "5",
          first_name: "Dana",
          last_name: "Dorn",
          missing: true,
          status: reported,
          status_by_school: true,
        }
      : {
          student_id: "5",
          first_name: "Dana",
          last_name: "Dorn",
          missing: true,
          unreported: true,
        };
    return {
      ...schoolDay(date),
      can_report_absences: canReport,
      totals: {
        ...schoolDay(date).totals,
        unreported: reported ? 0 : 1,
        sick: reported ? 1 : 0,
      },
      classes: [
        {
          school_class: "1a",
          totals: schoolDay(date).totals,
          children: [child],
        },
      ],
    };
  }

  it("enters a report and reloads the list", async () => {
    navigation.search = "tag=2026-09-09&liste=ohne-meldung";
    let reported = false;
    const fetchSchoolDay = vi.fn((date: string) =>
      Promise.resolve(unreportedDay(date, reported ? "sick" : null)),
    );
    const reportAbsence = vi.fn(() => {
      reported = true;
      return Promise.resolve();
    });
    render(
      <ClassDayOverview
        fetchClasses={classes}
        fetchAssignedClasses={vi.fn()}
        fetchSchoolDay={fetchSchoolDay}
        reportAbsence={reportAbsence}
        withdrawAbsenceReport={vi.fn(() => Promise.resolve())}
      />,
    );

    expect(await screen.findByText("Fehlen ohne Meldung: 1")).toBeVisible();
    expect(screen.getByText(/Es gibt keine Krankmeldung/)).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", {
        name: /^Meldung eintragen ?, Meldung für Dana Dorn eintragen$/,
      }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Krank" }));

    await waitFor(() =>
      expect(reportAbsence).toHaveBeenCalledWith(
        "1a",
        "2026-09-09",
        "5",
        "sick",
      ),
    );
    await waitFor(() => expect(fetchSchoolDay).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Fehlen ohne Meldung: 0")).toBeVisible();
  });

  // Die Lehrkraft hat das Kind inzwischen wieder als da eingetragen: die
  // Meldung scheitert, und die Liste lädt neu, statt das Kind stehen zu lassen.
  it("reloads the list when a report fails", async () => {
    navigation.search = "tag=2026-09-09&liste=ohne-meldung";
    let stale = true;
    const fetchSchoolDay = vi.fn((date: string) =>
      Promise.resolve(
        stale
          ? unreportedDay(date, null)
          : {
              ...unreportedDay(date, null),
              totals: { ...unreportedDay(date, null).totals, unreported: 0 },
            },
      ),
    );
    const reportAbsence = vi.fn(() => {
      stale = false;
      return Promise.reject(new Error("not missing"));
    });
    render(
      <ClassDayOverview
        fetchClasses={classes}
        fetchAssignedClasses={vi.fn()}
        fetchSchoolDay={fetchSchoolDay}
        reportAbsence={reportAbsence}
        withdrawAbsenceReport={vi.fn(() => Promise.resolve())}
      />,
    );

    expect(await screen.findByText("Fehlen ohne Meldung: 1")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", {
        name: /^Meldung eintragen ?, Meldung für Dana Dorn eintragen$/,
      }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Krank" }));

    await waitFor(() => expect(reportAbsence).toHaveBeenCalled());
    await waitFor(() => expect(fetchSchoolDay).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Fehlen ohne Meldung: 0")).toBeVisible();
  });

  it("does not claim a rejected report was saved when recovery also fails", async () => {
    navigation.search = "tag=2026-09-09&liste=ohne-meldung";
    const reload = new ApiError("down", 503, { code: "general.unavailable" });
    const refused = new ApiError("not missing", 409, {
      code: "general.business_rejection",
    });
    const recovery = deferred<schoolClassDayContract.SchoolDayReport>();
    const fetchSchoolDay = vi
      .fn()
      .mockResolvedValueOnce(unreportedDay("2026-09-09", null))
      .mockReturnValueOnce(recovery.promise);
    render(
      <ClassDayOverview
        fetchClasses={classes}
        fetchAssignedClasses={vi.fn()}
        fetchSchoolDay={fetchSchoolDay}
        reportAbsence={() => Promise.reject(refused)}
        withdrawAbsenceReport={vi.fn()}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: /^Meldung eintragen ?, Meldung für Dana Dorn eintragen$/,
      }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Krank" }));
    expect(
      await screen.findByText(
        catalogText("general.business_rejection", "die Meldung"),
      ),
    ).toBeVisible();
    await waitFor(() => expect(fetchSchoolDay).toHaveBeenCalledTimes(2));
    await act(async () => recovery.reject(reload));
    // Anker: the refused report remains the visible error after recovery.
    expect(
      screen.getByText(
        catalogText("general.business_rejection", "die Meldung"),
      ),
    ).toBeVisible();
    expect(
      screen.queryByText((text) => text.endsWith(SAVED_BUT_STALE_SUFFIX)),
    ).not.toBeInTheDocument();
  });

  it("shows a failed withdrawal once, in the dialog", async () => {
    navigation.search = "tag=2026-09-09&liste=krank";
    render(
      <ClassDayOverview
        fetchClasses={classes}
        fetchAssignedClasses={vi.fn()}
        fetchSchoolDay={(date) => Promise.resolve(unreportedDay(date, "sick"))}
        reportAbsence={vi.fn(() => Promise.resolve())}
        withdrawAbsenceReport={vi.fn(() =>
          Promise.reject(new Error("withdraw failed")),
        )}
      />,
    );

    expect(await screen.findByText(/nachgetragen/)).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Meldung für Dana Dorn zurücknehmen",
      }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Meldung zurücknehmen" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Zurücknehmen" }),
    );
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(1));
  });

  it("asks before it takes the school's report back", async () => {
    navigation.search = "tag=2026-09-09&liste=krank";
    const withdrawAbsenceReport = vi.fn(() => Promise.resolve());
    render(
      <ClassDayOverview
        fetchClasses={classes}
        fetchAssignedClasses={vi.fn()}
        fetchSchoolDay={(date) => Promise.resolve(unreportedDay(date, "sick"))}
        reportAbsence={vi.fn(() => Promise.resolve())}
        withdrawAbsenceReport={withdrawAbsenceReport}
      />,
    );

    expect(await screen.findByText(/nachgetragen/)).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Meldung für Dana Dorn zurücknehmen",
      }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Meldung zurücknehmen" }),
    );
    expect(await screen.findByText("Meldung zurücknehmen?")).toBeVisible();
    expect(withdrawAbsenceReport).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Zurücknehmen" }));
    await waitFor(() =>
      expect(withdrawAbsenceReport).toHaveBeenCalledWith(
        "1a",
        "2026-09-09",
        "5",
      ),
    );
  });

  it("offers no report without the right", async () => {
    navigation.search = "tag=2026-09-09&liste=ohne-meldung";
    render(
      <ClassDayOverview
        fetchClasses={classes}
        fetchAssignedClasses={vi.fn()}
        fetchSchoolDay={(date) =>
          Promise.resolve(unreportedDay(date, null, false))
        }
        reportAbsence={vi.fn(() => Promise.resolve())}
        withdrawAbsenceReport={vi.fn(() => Promise.resolve())}
      />,
    );

    expect(await screen.findByText("Dorn, Dana")).toBeVisible();
    expect(
      screen.queryByRole("button", {
        name: /^Meldung eintragen ?, Meldung für Dana Dorn eintragen$/,
      }),
    ).not.toBeInTheDocument();
  });
});

vi.mock("~/lib/tenant-context", () => ({ useTenantSlugSafe: () => null }));
