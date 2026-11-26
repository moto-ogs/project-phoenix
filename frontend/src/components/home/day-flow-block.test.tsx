import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "~/lib/api-error";
import type { PlannedTimetableInstance } from "~/lib/timetable-operations-types";
import { catalogText } from "~/test/error-catalog-text";

const swr = vi.hoisted(() => ({
  data: undefined as PlannedTimetableInstance[] | undefined,
  error: undefined as Error | undefined,
  isLoading: false,
  mutate: vi.fn(),
}));

vi.mock("~/lib/swr", () => ({
  useSWRAuth: () => swr,
}));
vi.mock("~/lib/tenant-path", () => ({
  useTenantAwarePath: () => (path: string) => `/test-tenant${path}`,
}));
// Wohin die Karte führt, hängt daran, ob die Person den Plan als Seite hat;
// das prüft use-day-plan-href.test.ts. Hier zählt, was die Karte daraus macht.
const viewer = vi.hoisted(() => ({ opensPlan: true }));
vi.mock("~/lib/hooks/use-day-plan-href", () => ({
  useCarePlanTodayTarget: () => {
    const planHref = (date?: string, id?: string) =>
      viewer.opensPlan
        ? `/test-tenant/betreuungsplan?view=tag${date ? `&d=${date}` : ""}${id ? `&block=${id}` : ""}`
        : "/test-tenant/tagesplan";
    return {
      opensPlan: viewer.opensPlan,
      label: viewer.opensPlan ? "Plan öffnen" : "Heute öffnen",
      tooltip: viewer.opensPlan
        ? "Öffnet den Betreuungsplan von heute."
        : "Öffnet deinen Tagesplan für heute.",
      dayHref: (date?: string) => planHref(date),
      blockHref: (target: { date: string; id: string }) =>
        planHref(target.date, target.id),
    };
  },
}));
vi.mock("~/lib/timetable-operations-api", () => ({
  timetableOperationsApi: { plannedNow: vi.fn() },
}));
// Feste Uhrzeit: die Karte zeigt ab dem laufenden Block, und ein Test, der an
// der Wanduhr hängt, wird am Nachmittag rot.
vi.mock("~/components/home/home-card-rows", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/components/home/home-card-rows")
  >()),
  useBerlinClock: () => "07:00",
}));

const overviewScope = vi.hoisted(() => ({ current: "all_staff" }));
vi.mock("~/lib/tenant-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/tenant-context")>()),
  useOperationalOverviewScope: () => overviewScope.current,
}));
// Wer alle Blöcke sieht, sagt `useHomeBlockAccess`: die Einstellung der
// Schule oder die Admin-Rolle.
const account = vi.hoisted(() => ({ roles: ["user"] as string[] }));
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: { id: "1", roles: account.roles, permissions: [] },
      expires: "2099-12-31",
    },
  }),
}));

import { DayFlowBlock } from "./day-flow-block";

function block(
  overrides: Partial<PlannedTimetableInstance> = {},
): PlannedTimetableInstance {
  return {
    id: "1",
    title: "Lernzeit Jahrgang 1",
    date: "2026-09-07",
    startTime: "13:00",
    endTime: "14:00",
    roomId: "7",
    roomName: "OGS-Raum 1",
    status: "planned",
    isOverdue: false,
    minutesUntilStart: 10,
    expectedStudentsCount: 18,
    presentStudentsCount: 0,
    notScheduledStudentsCount: 0,
    assignedStaffIds: [],
    isAssigned: false,
    isPrimary: false,
    isSubstitute: false,
    isAbsent: false,
    rosterPreview: [],
    ...overrides,
  };
}

/** Zwölf Blöcke im Stundentakt ab `firstHour`, „Block 1“ bis „Block 12“. */
function hourly(count: number, firstHour: number): PlannedTimetableInstance[] {
  return Array.from({ length: count }, (_, index) => {
    const hour = String(firstHour + index).padStart(2, "0");
    const next = String(firstHour + index + 1).padStart(2, "0");
    return block({
      id: String(index + 1),
      title: `Block ${index + 1}`,
      startTime: `${hour}:00`,
      endTime: `${next}:00`,
    });
  });
}

/** Steht die Zeile nur in zwei Spalten da (Container-Abfrage `@3xl`)? */
function wideOnly(title: string): boolean {
  return (
    screen.getByText(title).closest("li")?.className.includes("hidden") ?? false
  );
}

describe("Betreuungsplan heute (#2180, #8134)", () => {
  beforeEach(() => {
    swr.data = undefined;
    swr.error = undefined;
    swr.isLoading = false;
    overviewScope.current = "all_staff";
    account.roles = ["user"];
    viewer.opensPlan = true;
  });

  it("trägt den Namen des Plans und führt in seinen heutigen Tag (#8134)", () => {
    swr.data = [block()];

    render(<DayFlowBlock />);

    expect(
      screen.getByRole("heading", { name: "Betreuungsplan heute" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Betreuungsplan heute: Plan öffnen" }),
    ).toHaveAttribute(
      "href",
      "/test-tenant/betreuungsplan?view=tag&d=2026-09-07",
    );
  });

  // #4350: dieselbe Markierung wie im Tagesplan. Der eigene Block ist in
  // seiner Farbe hinterlegt, der Raum trägt sein Symbol.
  it("hinterlegt eigene Blöcke in ihrer Farbe und zeigt das Raumsymbol (#4350)", () => {
    swr.data = [
      block({
        id: "1",
        title: "Basteln",
        isAssigned: true,
        planningTrackColor: "#5080D8",
      }),
      block({ id: "2", title: "Fußball-AG", startTime: "14:00" }),
    ];

    render(<DayFlowBlock />);

    const own = screen.getByRole("link", {
      name: /Basteln.*Dein Block.*, im Betreuungsplan öffnen\b/,
    });
    const other = screen.getByRole("link", {
      name: /Fußball-AG(?!.*Dein Block).* ?, im Betreuungsplan öffnen\b/,
    });
    expect(own).toHaveStyle({ backgroundColor: "#5080D81A" });
    expect(own).not.toHaveClass("border-l-4");
    expect(own.style.borderLeftColor).toBe("");
    expect(other.style.backgroundColor).toBe("");
    expect(
      own
        .querySelector("[data-moto-duotone-tone]")
        ?.getAttribute("aria-hidden"),
    ).toBe("true");
  });

  it("hinterlegt nichts, wenn nur die eigene Einteilung zu sehen ist (#4350)", () => {
    overviewScope.current = "own";
    swr.data = [block({ title: "Basteln", isAssigned: true })];

    render(<DayFlowBlock />);

    const own = screen.getByRole("link", {
      name: /Basteln(?!.*Dein Block).* ?, im Betreuungsplan öffnen\b/,
    });
    expect(own.style.backgroundColor).toBe("");
  });

  // Die Leitung sieht alle Blöcke, auch wenn die Schule nur die eigene
  // Einteilung zeigt: dann stehen eigene und fremde nebeneinander.
  it("hinterlegt eigene Blöcke für die Leitung auch bei enger Sicht der Schule", () => {
    overviewScope.current = "own";
    account.roles = ["admin"];
    swr.data = [
      block({
        id: "1",
        title: "Basteln",
        isAssigned: true,
        planningTrackColor: "#5080D8",
      }),
      block({ id: "2", title: "Fußball-AG", startTime: "14:00" }),
    ];

    render(<DayFlowBlock />);

    const own = screen.getByRole("link", {
      name: /Basteln.*Dein Block.*, im Betreuungsplan öffnen\b/,
    });
    expect(own).toHaveStyle({ backgroundColor: "#5080D81A" });
  });

  // Dieselbe Zeile wie in „Mein Tag“ (#8134): Beginn und Ende, Name und
  // darunter Raum, Gruppe, Kinder und Team.
  it("zeigt Zeit, Name, Ort, Gruppe, Belegung und Team eines Blocks", () => {
    swr.data = [
      block({
        groupName: "Sternengruppe",
        staffNames: [
          { staffId: "1", displayName: "Anna Müller", isSubstitute: false },
          { staffId: "2", displayName: "Mai Pham", isSubstitute: true },
        ],
      }),
    ];

    render(<DayFlowBlock />);

    const row = screen.getByRole("link", { name: /Lernzeit Jahrgang 1/ });
    expect(row).toHaveTextContent("13:00");
    expect(row).toHaveTextContent("bis 14:00");
    // Vor dem Start zählt, wer erwartet wird (#3921).
    expect(row).toHaveTextContent(
      "OGS-Raum 1 · Sternengruppe · 18 Kinder · Anna Müller, Mai Pham (Vertretung)",
    );
  });

  // Rechts steht nur, was jetzt zählt. Die Uhr steht auf 07:00: ein Block um
  // 13:00 trägt keine Marke „in 6 Std“, seine Uhrzeit steht links.
  it("zählt nur in der Stunde vor dem Beginn herunter", () => {
    swr.data = [
      block({ id: "1", title: "Frühdienst", startTime: "08:00" }),
      block({ id: "2", title: "Lernzeit", startTime: "08:01" }),
      block({ id: "3", title: "Mittagessen", startTime: "13:00" }),
    ];

    render(<DayFlowBlock />);

    expect(screen.getByRole("link", { name: /Frühdienst/ })).toHaveTextContent(
      "in 1 Std",
    );
    expect(
      screen.getByRole("link", { name: /Lernzeit/ }),
    ).not.toHaveTextContent(/in \d/);
    expect(
      screen.getByRole("link", { name: /Mittagessen/ }),
    ).not.toHaveTextContent(/in \d/);
  });

  // Die Karte beginnt bei dem, was läuft oder kommt: sonst stünde um 16 Uhr
  // immer noch die Frühbetreuung oben. Was davor lag, nennt sie als Zahl mit
  // Weg in den Tag, damit drei Zeilen nicht wie der ganze Tag aussehen.
  it("beginnt bei jetzt und nennt, was heute schon vorbei ist", () => {
    // Die Uhr steht auf 07:00: drei Blöcke sind vorbei, zwei kommen.
    swr.data = hourly(5, 4);

    render(<DayFlowBlock />);

    expect(
      screen.getAllByRole("listitem").map((row) => row.textContent),
    ).toEqual([
      expect.stringContaining("Block 4"),
      expect.stringContaining("Block 5"),
    ]);
    expect(screen.queryByText("Block 3")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Jetzt, 07:00 Uhr")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "3 frühere Blöcke ansehen" }),
    ).toHaveAttribute(
      "href",
      "/test-tenant/betreuungsplan?view=tag&d=2026-09-07",
    );
  });

  it("nennt einen einzelnen früheren Block in der Einzahl und keinen, wo keiner war", () => {
    swr.data = hourly(3, 6);

    const { unmount } = render(<DayFlowBlock />);
    expect(
      screen.getByRole("link", { name: "1 früheren Block ansehen" }),
    ).toBeInTheDocument();
    unmount();

    swr.data = hourly(3, 8);
    render(<DayFlowBlock />);
    expect(
      screen.queryByRole("link", { name: /früher/ }),
    ).not.toBeInTheDocument();
  });

  // Ein vorzeitig beendeter Block ist vorbei, auch wenn seine geplante Zeit
  // noch läuft: er steht nicht unter der Jetzt-Linie.
  it("zählt einen vorzeitig beendeten Block zu dem, was vorbei ist", () => {
    swr.data = [
      block({
        id: "1",
        title: "Frühdienst",
        startTime: "06:30",
        endTime: "07:30",
        status: "completed",
      }),
      block({ id: "2", title: "Lernzeit", startTime: "08:00" }),
    ];

    render(<DayFlowBlock />);

    expect(screen.queryByText("Frühdienst")).not.toBeInTheDocument();
    expect(screen.getByText("Lernzeit")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "1 früheren Block ansehen" }),
    ).toBeInTheDocument();
  });

  // Eine Spalte fasst fünf Zeilen, zwei Spalten zehn. Beide Mengen stehen im
  // Dokument, CSS wählt nach der Breite der Karte.
  it("zeigt in einer Spalte fünf Blöcke, in zwei Spalten zehn", () => {
    // 07:00: Block 1 bis 3 sind vorbei, Block 4 bis 12 kommen.
    swr.data = hourly(12, 4);

    render(<DayFlowBlock />);

    // Eine Spalte: vier Blöcke ab jetzt und der Rest als Zahl.
    for (const title of ["Block 4", "Block 5", "Block 6", "Block 7"]) {
      expect(wideOnly(title)).toBe(false);
    }
    // Zwei Spalten: alle neun, die noch kommen.
    for (const title of ["Block 8", "Block 12"]) {
      expect(wideOnly(title)).toBe(true);
    }

    const more = screen.getAllByRole("link", { name: /^Noch \d+ Blöcke/ });
    expect(more.map((link) => link.textContent)).toEqual([
      "Noch 5 Blöcke ansehen",
    ]);
    expect(more[0]?.closest("li")?.className).toContain("@3xl:hidden");
  });

  // Zwei oder drei Blöcke nebeneinander läse man quer: zwei Spalten gibt es
  // erst, wenn eine nicht reicht.
  it("bleibt bei bis zu fünf Blöcken einspaltig", () => {
    swr.data = hourly(5, 8);
    const { unmount } = render(<DayFlowBlock />);
    expect(screen.getByRole("list").className).not.toContain("columns-2");
    unmount();

    swr.data = hourly(6, 8);
    render(<DayFlowBlock />);
    expect(screen.getByRole("list").className).toContain("@3xl:columns-2");
  });

  it("zählt auch in zwei Spalten den Rest, wenn der Tag nicht hineinpasst", () => {
    // 07:00: alle zwölf Blöcke kommen noch.
    swr.data = hourly(12, 8);

    render(<DayFlowBlock />);

    expect(wideOnly("Block 9")).toBe(true);
    expect(screen.queryByText("Block 10")).not.toBeInTheDocument();
    const more = screen.getAllByRole("link", { name: /^Noch \d+ Blöcke/ });
    expect(more.map((link) => link.textContent)).toEqual([
      "Noch 8 Blöcke ansehen",
      "Noch 3 Blöcke ansehen",
    ]);
    // Der Rest steht in der Tagesansicht des Plans.
    for (const link of more) {
      expect(link).toHaveAttribute(
        "href",
        "/test-tenant/betreuungsplan?view=tag&d=2026-09-07",
      );
    }
  });

  // Ist der Tag vorbei, bleibt der Tag stehen: „heute war das" ist eine
  // Antwort, eine leere Karte ist keine.
  // Zehn graue Zeilen mit „Nicht gestartet“ lasen sich abends wie offene
  // Arbeit (#8134). Ein Satz sagt, dass der Tag vorbei ist und wo er steht.
  it("zeigt nach Tagesende einen Satz statt der vergangenen Blöcke", () => {
    swr.data = hourly(4, 3);

    render(<DayFlowBlock />);

    expect(
      screen.getByText("Für heute ist nichts mehr geplant"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Alle 4 Blöcke von heute sind vorbei. 4 Blöcke wurden nicht gestartet.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(
      screen.getByRole("link", { name: "Betreuungsplan heute: Plan öffnen" }),
    ).toBeInTheDocument();
  });

  it("nennt abends, was ausgefallen ist", () => {
    swr.data = [
      block({
        id: "1",
        startTime: "03:00",
        endTime: "04:00",
        status: "completed",
      }),
      block({
        id: "2",
        startTime: "04:00",
        endTime: "05:00",
        status: "cancelled",
      }),
    ];

    render(<DayFlowBlock />);

    expect(
      screen.getByText(
        "Alle 2 Blöcke von heute sind vorbei. Ausgefallen: „Lernzeit Jahrgang 1“.",
      ),
    ).toBeInTheDocument();
  });

  // Ein Ausfall hinter „Noch 8 Blöcke ansehen“ bliebe sonst unsichtbar.
  it("nennt am Rest der Liste, wie viele der nicht gezeigten Blöcke ausfallen", () => {
    const day = hourly(13, 8);
    swr.data = day.map((entry, index) =>
      index === 12 ? { ...entry, status: "cancelled" as const } : entry,
    );

    const { container } = render(<DayFlowBlock />);

    expect(
      container.querySelector('[data-plan-more="narrow"]'),
    ).toHaveTextContent(/Noch 9 Blöcke ansehen.*1 fällt aus/);
    expect(
      container.querySelector('[data-plan-more="wide"]'),
    ).toHaveTextContent(/Noch 4 Blöcke ansehen.*1 fällt aus/);
  });

  // Die Karte ist so hoch wie ihr Inhalt: nachmittags stünden drei
  // Rasterzeilen halb leer (`READ_CELL_CLASSES`).
  it("gibt die feste Höhe frei, sobald Blöcke dastehen", () => {
    swr.data = [block()];

    const { container } = render(<DayFlowBlock />);

    expect(container.querySelector("[data-home-card-fit]")).not.toBeNull();
  });

  // Dieselben Wörter wie im Tagesplan; für das Kommende die Zeit bis zum
  // Beginn statt eines „Geplant", das nichts sagt (Uhr steht auf 07:00).
  it("kennzeichnet laufende, ausgefallene und nicht gestartete Blöcke", () => {
    swr.data = [
      block({ id: "1", status: "active" }),
      block({ id: "2", status: "cancelled" }),
      block({ id: "3", isOverdue: true }),
    ];

    render(<DayFlowBlock />);

    expect(screen.getByText("Läuft")).toBeInTheDocument();
    expect(screen.getByText("Fällt aus")).toBeInTheDocument();
    expect(screen.getByText("Nicht gestartet")).toBeInTheDocument();
  });

  it("nennt für einen kommenden Block die Zeit bis zum Beginn", () => {
    swr.data = [block({ startTime: "07:25", endTime: "08:00" })];

    render(<DayFlowBlock />);

    expect(screen.getByText("in 25 Min")).toBeInTheDocument();
  });

  // „Fällt aus“ sagt die Marke; darunter steht der Grund, nicht das Wort
  // ein zweites Mal.
  it("nennt bei einer Absage den Grund neben der Marke", () => {
    swr.data = [
      block({ status: "cancelled", cancelReason: "Die Leitung ist krank" }),
    ];

    render(<DayFlowBlock />);

    expect(screen.getAllByText(/Fällt aus/)).toHaveLength(1);
    expect(screen.getByText("Die Leitung ist krank")).toBeInTheDocument();
  });

  // Die Karte trägt den Namen des Plans, also führt jede Zeile in ihren
  // Termin im Plan, auch in der Leseansicht (#8134).
  it("führt aus jeder Zeile in den Termin im Betreuungsplan", () => {
    swr.data = [block({ id: "86", title: "Lernzeit" })];

    render(<DayFlowBlock />);

    expect(
      screen.getByRole("link", {
        name: /Lernzeit.* ?, im Betreuungsplan öffnen\b/,
      }),
    ).toHaveAttribute(
      "href",
      "/test-tenant/betreuungsplan?view=tag&d=2026-09-07&block=86",
    );
  });

  // Wer den Plan nicht als Seite hat (AG-Leitung), bleibt im Tagesplan.
  it("führt ohne den Plan als Seite in den Tagesplan", () => {
    viewer.opensPlan = false;
    swr.data = [block({ id: "1", title: "Lernzeit" })];

    render(<DayFlowBlock />);

    expect(
      screen.getByRole("link", { name: /Lernzeit.* ?, unter Heute öffnen\b/ }),
    ).toHaveAttribute("href", "/test-tenant/tagesplan");
    expect(
      screen.getByRole("link", { name: "Betreuungsplan heute: Heute öffnen" }),
    ).toHaveAttribute("href", "/test-tenant/tagesplan");
  });

  it("sagt es, wenn heute nichts geplant ist", () => {
    swr.data = [];

    render(<DayFlowBlock />);

    expect(screen.getByText("Heute ist nichts geplant")).toBeInTheDocument();
  });

  // Ein Ladefehler darf nicht wie "nichts geplant" aussehen: sonst verlässt
  // sich jemand auf einen leeren Tag, den es nicht gibt.
  it("unterscheidet einen Ladefehler von einem leeren Tag", async () => {
    swr.data = [];
    swr.error = new ApiError("boom", 503, { code: "general.unavailable" });

    render(<DayFlowBlock />);

    expect(
      await screen.findByText(
        catalogText("general.unavailable", "die Karte „Betreuungsplan heute“"),
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Heute ist nichts geplant"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    expect(swr.mutate).toHaveBeenCalled();
  });
});
