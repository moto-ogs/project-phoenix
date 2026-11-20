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
    activity: null,
    roomName: null,
    previousRoomName: null,
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

describe("Termine aus dem Stundenplan (#7662)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    phone.value = false;
  });

  const block = (
    kind: string,
    title: string,
    extra: Partial<DayChange> = {},
  ): DayChange =>
    change({
      kind,
      activity: { id: title, title, startTime: "13:00", endTime: "14:00" },
      roomName: "Aula",
      link: { target: "day_plan", staffId: null },
      ...extra,
    });

  it("zeigt Absage, Rücknahme, Raum und Leitung mit Uhrzeit, Raum und Link zum Tagesplan", () => {
    serve({
      entries: [
        block("activity_lead_changed", "Chor", {
          section: "you",
          people: [
            { staffId: "1", name: "Anna", role: "substitute", isSelf: true },
            { staffId: "2", name: "Ben Krank", role: "absent", isSelf: false },
          ],
        }),
        block("activity_room_changed", "Fußball", {
          section: "you",
          roomName: "Turnhalle",
          previousRoomName: "Werkraum",
        }),
        block("activity_cancelled", "Basteln"),
        block("activity_reinstated", "Theater"),
      ],
    });
    render(<DayChangesBlock />);

    const mine = within(screen.getByRole("region", { name: "Betrifft dich" }));
    expect(
      mine.getByRole("link", {
        name: /Du übernimmst heute „Chor“ für Ben Krank\.\s*13:00–14:00 · Aula/,
      }),
    ).toHaveAttribute("href", "/schule/tagesplan");
    expect(
      mine.getByText("„Fußball“ ist heute in einem anderen Raum."),
    ).toBeInTheDocument();
    expect(
      mine.getByText("13:00–14:00 · Turnhalle statt Werkraum"),
    ).toBeInTheDocument();
    const school = within(screen.getByRole("region", { name: "Schule" }));
    expect(school.getByText("„Basteln“ fällt heute aus.")).toBeInTheDocument();
    expect(
      school.getByText("„Theater“ findet doch statt."),
    ).toBeInTheDocument();
  });

  it("nennt Vertretung und Ausfall aus Sicht der Person", async () => {
    const { dayChangeText } = await import("./day-changes-text");
    const lead = (people: DayChange["people"], title = "Chor") =>
      dayChangeText(block("activity_lead_changed", title, { people }));
    const sub = {
      staffId: "1",
      name: "Sara",
      role: "substitute",
      isSelf: false,
    };
    const gone = { staffId: "2", name: "Ben", role: "absent", isSelf: false };
    expect(lead([sub, { ...gone, isSelf: true }])).toBe(
      "Sara übernimmt heute „Chor“ für dich.",
    );
    expect(lead([sub, gone])).toBe("Sara übernimmt heute „Chor“ für Ben.");
    expect(lead([gone])).toBe("Bei „Chor“ ist Ben heute nicht da.");
    expect(lead([{ ...gone, isSelf: true }])).toBe(
      "Bei „Chor“ bist du heute nicht da.",
    );
    expect(lead([sub], " ")).toBe("Sara übernimmt heute einen Termin.");
    expect(lead([])).toBe("Bei „Chor“ ändert sich heute, wer betreut.");
  });

  it("zeigt bei einem Ausfall des Stundenplans einen Hinweis und nie die Entwarnung", () => {
    serve({ failedSources: ["activities"] });
    render(<DayChangesBlock />);
    expect(
      screen.getByText(
        "Änderungen an Angeboten und AGs konnten gerade nicht geladen werden.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Heute läuft alles wie geplant."),
    ).not.toBeInTheDocument();
  });

  it("erfasst beim Klick auf einen Termin nur seine Art", () => {
    serve({ entries: [block("activity_cancelled", "Basteln")] });
    render(<DayChangesBlock />);

    fireEvent.click(screen.getByRole("link", { name: /Basteln/ }));

    expect(trackEvent).toHaveBeenCalledWith("day_changes_entry_clicked", {
      day_change_kind: "activity_cancelled",
    });
  });
});
