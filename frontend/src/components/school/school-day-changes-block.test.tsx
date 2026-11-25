import { render, screen, waitFor, within } from "@testing-library/react";
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
        classes: { school_class: string; changes: number }[];
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

  it("sagt ohne Änderung, dass alles wie geplant läuft", () => {
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
