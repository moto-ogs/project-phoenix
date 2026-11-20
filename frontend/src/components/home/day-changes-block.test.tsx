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
