import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DayChange, DayChangesOverview } from "~/lib/day-changes";

const useSWRAuth = vi.hoisted(() => vi.fn());
const trackEvent = vi.hoisted(() => vi.fn());
const phone = vi.hoisted(() => ({ value: false }));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "account-a" } } }),
}));
vi.mock("~/lib/swr", () => ({ useSWRAuth }));
vi.mock("~/lib/analytics", () => ({ trackEvent }));
vi.mock("~/lib/tenant-path", () => ({
  useTenantAwarePath: () => (path: string) => `/schule${path}`,
}));
vi.mock("~/lib/hooks/use-media-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/hooks/use-media-query")>()),
  useMediaQuery: () => phone.value,
}));

import { DayChangesBlock } from "./day-changes-block";

function change(overrides: Partial<DayChange>): DayChange {
  return {
    kind: "staff_absent",
    section: "school",
    halfDay: false,
    since: null,
    until: null,
    people: [],
    groupName: null,
    link: null,
    count: null,
    ...overrides,
  };
}

const absent = (
  name: string,
  section = "school",
  extra: Partial<DayChange> = {},
) =>
  change({
    section,
    people: [{ staffId: "7", name, role: "absent", isSelf: false }],
    link: { target: "staff_member", staffId: "7" },
    ...extra,
  });

function serve(overview: Partial<DayChangesOverview>) {
  useSWRAuth.mockReturnValue({
    data: { date: "2026-09-09", failedSources: [], entries: [], ...overview },
    error: undefined,
    isLoading: false,
    mutate: vi.fn(),
  });
}

describe("DayChangesBlock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    phone.value = false;
  });

  it("liest die Übersicht je Konto", () => {
    serve({});
    render(<DayChangesBlock />);
    expect(useSWRAuth).toHaveBeenCalledWith(
      "home-day-changes:account-a",
      expect.any(Function),
      { revalidateOnFocus: true },
    );
  });

  it("zeigt „Betrifft dich“ vor „Schule“ mit Text, Zeitraum und Link", () => {
    serve({
      entries: [
        absent("Ben Kollege", "you", { until: "2026-09-11" }),
        change({
          kind: "group_substitution",
          section: "you",
          groupName: "Igel",
          people: [
            { staffId: "1", name: "Anna", role: "substitute", isSelf: true },
          ],
          link: { target: "group_handovers", staffId: null },
        }),
        absent("Clara Andere", "school", {
          since: "2026-09-06",
          halfDay: true,
        }),
        change({
          kind: "staff_absent_count",
          count: 2,
          link: { target: "staff_list", staffId: null },
        }),
      ],
    });
    render(<DayChangesBlock />);

    const headings = screen.getAllByRole("heading", { level: 3 });
    expect(headings.map((heading) => heading.textContent)).toEqual([
      "Betrifft dich",
      "Schule",
    ]);
    const mine = within(screen.getByRole("region", { name: "Betrifft dich" }));
    expect(
      mine.getByRole("link", {
        name: /Ben Kollege ist heute nicht da\.\s*bis 11\.9\./,
      }),
    ).toHaveAttribute("href", "/schule/staff/7");
    expect(
      mine.getByRole("link", { name: "Du vertrittst heute die Gruppe Igel." }),
    ).toHaveAttribute("href", "/schule/substitutions");
    const school = within(screen.getByRole("region", { name: "Schule" }));
    expect(
      school.getByText("Clara Andere ist heute einen halben Tag nicht da."),
    ).toBeInTheDocument();
    expect(school.getByText("seit 6.9.")).toBeInTheDocument();
    expect(
      school.getByRole("link", {
        name: "2 weitere Personen aus dem Team sind heute nicht da.",
      }),
    ).toHaveAttribute("href", "/schule/staff");
    expect(
      screen.queryByText("Heute läuft alles wie geplant."),
    ).not.toBeInTheDocument();
  });

  it("sagt ohne Einträge, dass alles wie geplant läuft", () => {
    serve({});
    render(<DayChangesBlock />);
    expect(
      screen.getByText("Heute läuft alles wie geplant."),
    ).toBeInTheDocument();
  });

  it("zeigt bei einer ausgefallenen Quelle einen Hinweis und nie die Entwarnung", () => {
    serve({ failedSources: ["staff"] });
    render(<DayChangesBlock />);
    expect(
      screen.getByText(
        "Ausfälle und Vertretungen konnten gerade nicht geladen werden.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Heute läuft alles wie geplant."),
    ).not.toBeInTheDocument();
  });

  it("kürzt „Schule“ am Telefon auf drei Einträge und zeigt auf Wunsch alle", () => {
    phone.value = true;
    serve({
      entries: [
        absent("Ben", "you"),
        absent("Clara"),
        absent("Dora"),
        absent("Emil"),
        absent("Finn"),
      ],
    });
    render(<DayChangesBlock />);

    expect(screen.getByText("Ben ist heute nicht da.")).toBeInTheDocument();
    expect(screen.getByText("Emil ist heute nicht da.")).toBeInTheDocument();
    expect(
      screen.queryByText("Finn ist heute nicht da."),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Alle anzeigen (4)" }));

    expect(screen.getByText("Finn ist heute nicht da.")).toBeInTheDocument();
    expect(trackEvent).toHaveBeenCalledWith("day_changes_show_all");
  });

  it("erfasst beim Klick auf einen Eintrag nur seine Art", () => {
    serve({ entries: [absent("Ben Kollege", "you")] });
    render(<DayChangesBlock />);

    fireEvent.click(
      screen.getByRole("link", { name: "Ben Kollege ist heute nicht da." }),
    );

    expect(trackEvent).toHaveBeenCalledWith("day_changes_entry_clicked", {
      day_change_kind: "staff_absent",
    });
  });
});

describe("Texte der Gruppen-Vertretung", () => {
  it("nennt die Gruppe mit passendem Artikel", async () => {
    const { dayChangeText } = await import("./day-changes-text");
    const handover = (groupName: string, people: DayChange["people"]) =>
      dayChangeText(change({ kind: "group_substitution", groupName, people }));
    expect(
      handover("Sternengruppe", [
        {
          staffId: "1",
          name: "Daria Nowak",
          role: "substitute",
          isSelf: false,
        },
      ]),
    ).toBe("Daria Nowak vertritt heute die Sternengruppe.");
    expect(
      handover("Igel", [
        {
          staffId: "1",
          name: "Daria Nowak",
          role: "substitute",
          isSelf: false,
        },
        { staffId: "2", name: "Anna", role: "replaced", isSelf: true },
      ]),
    ).toBe("Daria Nowak vertritt dich heute in der Gruppe Igel.");
  });
});

describe("DayChangesBlock — Kinder (#7665)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    phone.value = false;
  });

  const child = (studentId: string, name: string) => ({
    studentId,
    name,
    status: null,
    pickupTime: null,
    note: null,
  });

  it("zeigt Kinder der eigenen Gruppe einzeln und klappt die Zusammenfassung auf", () => {
    serve({
      entries: [
        change({
          kind: "child_absent",
          section: "you",
          groupName: "Igel",
          child: { ...child("11", "Mia Kind"), status: "sick" },
          link: { target: "student", staffId: null, studentId: "11" },
        }),
        change({
          kind: "child_pickup_changed",
          section: "you",
          groupName: "Igel",
          child: { ...child("12", "Leo Kind"), pickupTime: "14:30" },
          link: { target: "student", staffId: null, studentId: "12" },
        }),
        change({
          kind: "child_summary",
          groupName: "Fuchs",
          childSummary: {
            schoolClass: "",
            counts: {
              sick: 4,
              excused: 0,
              pickupChanged: 0,
              goesAlone: 1,
              pickupNote: 0,
            },
            items: [
              {
                kind: "child_goes_alone",
                child: child("21", "Lou Kind"),
                link: { target: "student", staffId: null, studentId: "21" },
              },
              {
                kind: "child_absent",
                child: { ...child("22", "Pia Kind"), status: "sick" },
                link: { target: "student", staffId: null, studentId: "22" },
              },
            ],
          },
        }),
        change({
          kind: "child_summary",
          childSummary: {
            schoolClass: "4c",
            counts: {
              sick: 0,
              excused: 1,
              pickupChanged: 0,
              goesAlone: 0,
              pickupNote: 0,
            },
            items: [],
          },
        }),
      ],
    });
    render(<DayChangesBlock />);

    const mine = within(screen.getByRole("region", { name: "Betrifft dich" }));
    expect(
      mine.getByRole("link", { name: "Mia Kind ist heute krank gemeldet." }),
    ).toHaveAttribute("href", "/schule/students/11");
    expect(
      mine.getByRole("link", { name: "Leo Kind geht heute um 14:30 Uhr." }),
    ).toHaveAttribute("href", "/schule/students/12");

    const school = within(screen.getByRole("region", { name: "Schule" }));
    expect(school.getByText("4 krank, 1 geht allein")).toBeInTheDocument();
    expect(school.getByText("1 entschuldigt")).toBeInTheDocument();
    expect(school.getByRole("button", { name: /Klasse 4c/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    const toggle = school.getByRole("button", { name: /Gruppe Fuchs/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(school.queryByText(/Lou Kind/)).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(
      school.getByRole("link", {
        name: "Lou Kind geht heute allein nach Hause.",
      }),
    ).toHaveAttribute("href", "/schule/students/21");
    const sick = school.getByRole("link", {
      name: "Pia Kind ist heute krank gemeldet.",
    });
    fireEvent.click(sick);
    expect(trackEvent).toHaveBeenCalledWith("day_changes_entry_clicked", {
      day_change_kind: "child_absent",
    });
  });

  it("nennt den Ausfall der Kinder-Quelle und gibt keine Entwarnung", () => {
    serve({ failedSources: ["children"] });
    render(<DayChangesBlock />);
    expect(
      screen.getByText(
        "Krankmeldungen und Abholzeiten der Kinder konnten gerade nicht geladen werden.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Heute läuft alles wie geplant."),
    ).not.toBeInTheDocument();
  });
});
