import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CLASS_DAY_REFRESH_EVENT } from "~/components/class-day/use-class-day-refresh";
import {
  DAY_CHANGE_ANCHOR,
  DAY_CHANGE_ROW_ATTRIBUTE,
  useJumpToDayChange,
} from "~/components/class-day/use-jump-to-day-change";
import type { DayChange, DayChangesOverview } from "~/lib/day-changes";
import { SchoolDayChangesBlock } from "./school-day-changes-block";

const reloadChanges = vi.hoisted(() => vi.fn());
const reloadClasses = vi.hoisted(() => vi.fn());
const requestedChangeKeys = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({
  today: "2026-09-09",
  selectedDate: "2026-09-09",
  overview: undefined as DayChangesOverview | undefined,
  classes: undefined as
    | {
        school_day: boolean;
        classes: {
          school_class: string;
          changes: number;
          trips?: { return_time: string | null; children: number }[];
        }[];
      }
    | undefined,
  permissions: ["class_day:read"] as string[],
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "1", permissions: state.permissions } },
  }),
}));

vi.mock("~/lib/hooks/use-berlin-today", () => ({
  useBerlinToday: () => state.today,
}));

vi.mock("~/lib/swr", () => ({
  useSWRAuth: (key: string | null) => {
    if (key?.startsWith("school-day-changes-")) {
      requestedChangeKeys(key);
      return { data: state.overview, error: undefined, mutate: reloadChanges };
    }
    if (key?.startsWith("school-assigned-classes-")) {
      return { data: state.classes, error: undefined, mutate: reloadClasses };
    }
    return { data: undefined, error: undefined, mutate: vi.fn() };
  },
}));

vi.mock("~/lib/school-url", () => ({ schoolPath: (path: string) => path }));

function change(overrides: Partial<DayChange>): DayChange {
  return {
    kind: "closing_day",
    section: "school",
    halfDay: false,
    since: null,
    until: null,
    startsAt: null,
    endsAt: null,
    people: [],
    groupName: null,
    link: null,
    count: null,
    ...overrides,
  };
}

function renderBlock() {
  return render(
    <SchoolDayChangesBlock
      selectedDate={state.selectedDate}
      fetchAssignedClasses={vi.fn()}
    />,
  );
}

describe("SchoolDayChangesBlock", () => {
  beforeEach(() => {
    reloadChanges.mockReset();
    reloadClasses.mockReset();
    requestedChangeKeys.mockReset();
    state.today = "2026-09-09";
    state.selectedDate = "2026-09-09";
    state.permissions = ["class_day:read"];
    state.classes = {
      school_day: true,
      classes: [
        { school_class: "3a", changes: 3 },
        { school_class: "4b", changes: 0 },
      ],
    };
    state.overview = {
      date: "2026-09-09",
      failedSources: [],
      entries: [
        change({
          kind: "class_dismissal_changed",
          section: "you",
          schoolClass: { name: "3a", time: "11:30", children: 0 },
          link: { target: "school_class", staffId: null },
        }),
        change({
          closing: { name: "Pädagogischer Tag", traeger: false },
          link: { target: "school_calendar", staffId: null },
        }),
      ],
    };
  });

  it("zeigt die eigenen Klassen vor der Schule und springt zur Zeile im Klassentag", () => {
    renderBlock();
    const own = screen.getByRole("region", { name: "Betrifft dich" });
    expect(
      within(own).getByText(
        "Bei Klasse 3a endet der Unterricht heute um 11:30 Uhr.",
      ),
    ).toBeInTheDocument();
    const children = within(own).getByRole("link", {
      name: "Klasse 3a: 3 Kinder anders als sonst",
    });
    expect(children.getAttribute("href")).toMatch(
      new RegExp(
        `^/school/klasse\\?klasse=3a&tag=\\d{4}-\\d{2}-\\d{2}#${DAY_CHANGE_ANCHOR}$`,
      ),
    );
    expect(within(own).queryByText(/Klasse 4b/)).toBeNull();
    const school = screen.getByRole("region", { name: "Schule" });
    expect(
      within(school).getByRole("link", {
        name: "Die OGS ist heute geschlossen: Pädagogischer Tag.",
      }),
    ).toHaveAttribute("href", "/school/kalender");
    expect(
      screen.getByRole("link", { name: "Hinweise der Leitung" }),
    ).toHaveAttribute("href", "/school/tagesinformationen");
    expect(screen.queryByText("Heute läuft alles wie geplant.")).toBeNull();
  });

  it("zeigt Vertretungen bei den eigenen Aufsichten ohne Namen und führt zu den Aufsichten", () => {
    const self = { staffId: "5", name: "", isSelf: true };
    state.overview = {
      date: "2026-09-09",
      failedSources: [],
      entries: [
        change({
          kind: "block_substitution",
          section: "you",
          activity: { id: "1", title: "Pausenaufsicht Hof" },
          people: [{ ...self, role: "substitute" }],
          link: { target: "school_supervisions", staffId: null },
        }),
        change({
          kind: "block_substitution",
          section: "you",
          activity: { id: "2", title: "Mittagsaufsicht" },
          people: [
            { staffId: "0", name: "", isSelf: false, role: "substitute" },
            { ...self, role: "replaced" },
          ],
          link: { target: "school_supervisions", staffId: null },
        }),
      ],
    };
    renderBlock();
    const own = screen.getByRole("region", { name: "Betrifft dich" });
    expect(
      within(own).getByRole("link", {
        name: "Du übernimmst heute „Pausenaufsicht Hof“.",
      }),
    ).toHaveAttribute("href", "/school/aufsichten");
    expect(
      within(own).getByRole("link", {
        name: "Jemand aus dem Team übernimmt heute „Mittagsaufsicht“ für dich.",
      }),
    ).toHaveAttribute("href", "/school/aufsichten");
  });

  it("zeigt Ausflüge der eigenen Klassen ohne Kind und Grund und führt zum Klassentag", () => {
    state.overview = { date: "2026-09-09", failedSources: [], entries: [] };
    state.classes = {
      school_day: true,
      classes: [
        {
          school_class: "3a",
          changes: 1,
          trips: [
            { return_time: null, children: 1 },
            { return_time: "13:30", children: 22 },
          ],
        },
        { school_class: "4b", changes: 0, trips: [] },
      ],
    };
    renderBlock();
    const own = screen.getByRole("region", { name: "Betrifft dich" });
    const outing = within(own).getByRole("link", {
      name: "22 Kinder aus Klasse 3a sind heute auf Ausflug und kommen um 13:30 Uhr zurück.",
    });
    expect(outing.getAttribute("href")).toMatch(
      /^\/school\/klasse\?klasse=3a&tag=\d{4}-\d{2}-\d{2}$/,
    );
    expect(
      within(own).getByRole("link", {
        name: "1 Kind aus Klasse 3a ist heute den ganzen Tag unterwegs.",
      }),
    ).toBeInTheDocument();
    expect(within(own).queryByText(/4b/)).toBeNull();
  });

  it("zeigt abgesagte und geänderte eigene Termine und führt zum Kalender", () => {
    state.overview = {
      date: "2026-09-09",
      failedSources: [],
      entries: [
        change({
          kind: "appointment_cancelled",
          section: "you",
          appointment: {
            id: "7",
            occurrenceDate: "2026-09-09",
            title: "Konferenz",
            location: "Lehrerzimmer",
            locationChanged: false,
            timeChanged: false,
          },
          link: { target: "school_calendar", staffId: null },
        }),
        change({
          kind: "appointment_changed",
          section: "you",
          appointment: {
            id: "8",
            occurrenceDate: "2026-09-09",
            title: "Elternabend 3a",
            location: "Raum 12",
            locationChanged: true,
            timeChanged: false,
          },
          link: { target: "school_calendar", staffId: null },
        }),
      ],
    };
    state.classes = { school_day: true, classes: [] };
    renderBlock();
    const own = screen.getByRole("region", { name: "Betrifft dich" });
    expect(
      within(own).getByRole("link", { name: /„Konferenz“ fällt heute aus\./ }),
    ).toHaveAttribute("href", "/school/kalender");
    expect(
      within(own).getByRole("link", {
        name: "„Elternabend 3a“ ist heute an einem anderen Ort. Neuer Ort: Raum 12.",
      }),
    ).toHaveAttribute("href", "/school/kalender");
  });

  it("sagt ohne Änderung, dass alles wie geplant läuft", () => {
    state.permissions = ["class_day:read", "calendar:school"];
    state.overview = { date: "2026-09-09", failedSources: [], entries: [] };
    state.classes = {
      school_day: true,
      classes: [{ school_class: "3a", changes: 0 }],
    };
    renderBlock();
    expect(
      screen.getByText("Heute läuft alles wie geplant."),
    ).toBeInTheDocument();
  });

  it("entwarnt ohne Zugang zum Schulkalender nicht", () => {
    state.overview = { date: "2026-09-09", failedSources: [], entries: [] };
    state.classes = {
      school_day: true,
      classes: [{ school_class: "3a", changes: 0 }],
    };

    const { container } = renderBlock();

    expect(container.firstChild).toBeNull();
  });

  it("gibt bei einem Teilausfall nie Entwarnung", () => {
    state.overview = {
      date: "2026-09-09",
      failedSources: ["classes"],
      entries: [],
    };
    state.classes = { school_day: true, classes: [] };
    renderBlock();
    expect(
      screen.getByText(
        "Änderungen am Unterrichtsschluss der Klassen konnten gerade nicht geladen werden.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Heute läuft alles wie geplant.")).toBeNull();
  });

  it("zählt für die Schulverwaltung keine Kinder, die Schulzahlen stehen darunter", () => {
    state.permissions = ["class_day:read", "class_day:all_classes"];
    renderBlock();
    // Anker: der geladene Block zeigt den Unterrichtsschluss.
    expect(
      screen.getByText(
        "Bei Klasse 3a endet der Unterricht heute um 11:30 Uhr.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/anders als sonst/)).toBeNull();
  });

  it("lädt neu, wenn sich ein Klassentag der Schule ändert", async () => {
    renderBlock();
    window.dispatchEvent(new CustomEvent(CLASS_DAY_REFRESH_EVENT));
    await waitFor(() => expect(reloadChanges).toHaveBeenCalled(), {
      timeout: 3000,
    });
    expect(reloadClasses).toHaveBeenCalled();
  });

  it("liest nach Berliner Mitternacht eine neue Übersicht", () => {
    const { rerender } = renderBlock();
    expect(requestedChangeKeys).toHaveBeenLastCalledWith(
      "school-day-changes-2026-09-09",
    );

    state.today = "2026-09-10";
    state.selectedDate = "2026-09-10";
    rerender(
      <SchoolDayChangesBlock
        selectedDate={state.selectedDate}
        fetchAssignedClasses={vi.fn()}
      />,
    );

    expect(requestedChangeKeys).toHaveBeenLastCalledWith(
      "school-day-changes-2026-09-10",
    );
  });

  it("zeigt keine heutigen Änderungen neben einem anderen Klassentag", () => {
    state.selectedDate = "2026-09-08";

    const { container } = renderBlock();

    expect(container.firstChild).toBeNull();
    expect(requestedChangeKeys).not.toHaveBeenCalled();
  });
});

function JumpTarget({ ready }: { readonly ready: boolean }) {
  useJumpToDayChange(ready);
  return (
    <ul>
      <li tabIndex={-1}>Anna, gleich wie sonst</li>
      <li {...{ [DAY_CHANGE_ROW_ATTRIBUTE]: "" }} tabIndex={-1}>
        Ben, heute krank
      </li>
    </ul>
  );
}

describe("useJumpToDayChange", () => {
  it("fokussiert nach dem Laden die erste Zeile, die heute anders ist", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    window.location.hash = `#${DAY_CHANGE_ANCHOR}`;
    const { rerender } = render(<JumpTarget ready={false} />);
    expect(document.activeElement).toBe(document.body);
    rerender(<JumpTarget ready />);
    expect(document.activeElement).toHaveTextContent("Ben, heute krank");
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    window.location.hash = "";
  });
});

describe("SchoolDayChangesBlock: Vorschau auf morgen (#7657)", () => {
  beforeEach(() => {
    requestedChangeKeys.mockReset();
    state.today = "2026-09-09";
    state.selectedDate = "2026-09-09";
    state.permissions = ["class_day:read", "calendar:school"];
    state.classes = { school_day: true, classes: [] };
    state.overview = {
      date: state.today,
      failedSources: [],
      entries: [
        change({
          kind: "class_dismissal_changed",
          section: "you",
          schoolClass: { name: "3a", time: "11:30", children: 0 },
          link: { target: "school_class", staffId: null },
        }),
      ],
    };
  });

  it("liest morgen und verlinkt in den Klassentag von morgen", async () => {
    const { nextDayISO } = await import("~/components/home/day-switch");
    const tomorrow = nextDayISO(state.today);
    renderBlock();
    expect(requestedChangeKeys).toHaveBeenLastCalledWith(
      `school-day-changes-${state.today}`,
    );

    fireEvent.click(screen.getByRole("button", { name: "Morgen" }));

    expect(requestedChangeKeys).toHaveBeenLastCalledWith(
      `school-day-changes-${tomorrow}`,
    );
    const row = screen.getByRole("link", {
      name: "Bei Klasse 3a endet der Unterricht morgen um 11:30 Uhr.",
    });
    expect(row.getAttribute("href")).toContain(`tag=${tomorrow}`);
  });

  it("sagt ohne Einträge, dass morgen alles wie geplant läuft", () => {
    state.overview = { date: state.today, failedSources: [], entries: [] };
    renderBlock();
    fireEvent.click(screen.getByRole("button", { name: "Morgen" }));
    expect(screen.getByText("Morgen läuft alles wie geplant.")).toBeVisible();
  });
});
