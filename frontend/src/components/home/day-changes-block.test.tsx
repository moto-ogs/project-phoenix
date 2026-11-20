import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DayChange, DayChangesOverview } from "~/lib/day-changes";
import { setTestClock } from "~/test/clock";

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
    startsAt: null,
    endsAt: null,
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

function overviewOf(overview: Partial<DayChangesOverview>) {
  return { date: "2026-09-09", failedSources: [], entries: [], ...overview };
}

function serve(overview: Partial<DayChangesOverview>) {
  useSWRAuth.mockReturnValue({
    data: overviewOf(overview),
    error: undefined,
    isLoading: false,
    mutate: vi.fn(),
  });
}

/** Die Texte der Zeilen eines Abschnitts in ihrer Reihenfolge. */
function rowTexts(region: HTMLElement): string[] {
  return within(region)
    .queryAllByRole("listitem")
    .map((row) => row.textContent ?? "");
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

describe("DayChangesBlock über den Tag (#7660)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    phone.value = false;
    // Ein fester Mittwochmittag: was um 9:00 endete, ist vorbei.
    setTestClock("2026-09-09T12:00:00+02:00");
  });

  // Die Reihenfolge der Antwort: neu ganztägig, mit Uhrzeit nach Beginn,
  // lange seit einem früheren Tag; dazu eine schon vorbei.
  const dayEntries = () => [
    absent("Neu", "school", { until: "2026-09-21" }),
    absent("Mittag", "school", {
      startsAt: "2026-09-09T11:30:00+02:00",
      endsAt: "2026-09-09T14:00:00+02:00",
    }),
    absent("Lang", "school", { since: "2026-09-03" }),
    absent("Morgens", "school", {
      startsAt: "2026-09-09T08:00:00+02:00",
      endsAt: "2026-09-09T09:00:00+02:00",
    }),
  ];

  it("ordnet neu, Uhrzeit und lang und klappt Erledigtes ein", () => {
    serve({ entries: dayEntries() });
    render(<DayChangesBlock />);

    const school = screen.getByRole("region", { name: "Schule" });
    // Der Link nennt den Zeitraum mit Leerzeichen, ohne den Trennpunkt.
    expect(
      within(school).getByRole("link", {
        name: "Lang ist heute nicht da. seit 3.9.",
      }),
    ).toBeInTheDocument();
    expect(rowTexts(school)).toEqual([
      "Neu ist heute nicht da.bis 21.9.",
      "Mittag ist heute nicht da.11:30 bis 14:00 Uhr",
      "Lang ist heute nicht da. · seit 3.9.",
    ]);
    const toggle = within(school).getByRole("button", { name: "1 erledigt" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByText("Morgens ist heute nicht da."),
    ).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(rowTexts(school).at(-1)).toBe(
      "Morgens ist heute nicht da.08:00 bis 09:00 Uhr",
    );
    expect(trackEvent).toHaveBeenCalledWith("day_changes_done_expanded");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(trackEvent).toHaveBeenCalledTimes(1);
  });

  it("zeigt am Telefon „Betrifft dich“ ganz und von „Schule“ drei", () => {
    phone.value = true;
    serve({
      entries: [
        absent("Ich1", "you"),
        absent("Ich2", "you"),
        absent("Ich3", "you"),
        absent("Ich4", "you"),
        ...dayEntries(),
        absent("Viert"),
      ],
    });
    render(<DayChangesBlock />);

    expect(
      rowTexts(screen.getByRole("region", { name: "Betrifft dich" })),
    ).toHaveLength(4);
    const school = screen.getByRole("region", { name: "Schule" });
    expect(rowTexts(school)).toHaveLength(3);
    // Erledigtes bleibt eingeklappt erreichbar und zählt nicht mit.
    expect(
      within(school).getByRole("button", { name: "1 erledigt" }),
    ).toBeInTheDocument();
    const showAll = within(school).getByRole("button", {
      name: "Alle anzeigen (4)",
    });
    expect(showAll).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(showAll);

    expect(rowTexts(school)).toHaveLength(4);
    expect(trackEvent).toHaveBeenCalledWith("day_changes_show_all");
  });

  it("zeigt am Desktop alles ohne „Alle anzeigen“", () => {
    serve({ entries: [...dayEntries(), absent("Viert"), absent("Fünft")] });
    render(<DayChangesBlock />);

    expect(
      rowTexts(screen.getByRole("region", { name: "Schule" })),
    ).toHaveLength(5);
    expect(
      screen.queryByRole("button", { name: /Alle anzeigen/ }),
    ).not.toBeInTheDocument();
  });

  it("sagt nur an, was ein Neuladen geändert hat", () => {
    serve({ entries: [absent("Ben", "you")] });
    const { rerender } = render(<DayChangesBlock />);
    const live = document.querySelector('[aria-live="polite"]');
    expect(live).toHaveTextContent("");

    serve({ entries: [absent("Ben", "you")] });
    rerender(<DayChangesBlock />);
    expect(live).toHaveTextContent("");

    serve({
      entries: [
        absent("Ben", "you"),
        absent("Clara", "school", {
          people: [
            { staffId: "8", name: "Clara", role: "absent", isSelf: false },
          ],
        }),
      ],
    });
    rerender(<DayChangesBlock />);
    expect(live).toHaveTextContent("„Heute anders“: 1 neue Änderung.");
    expect(live).not.toHaveTextContent("Ben");
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
