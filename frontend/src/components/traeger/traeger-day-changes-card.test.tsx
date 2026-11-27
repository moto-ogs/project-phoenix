import { SWRConfig } from "~/lib/swr/testing";
vi.unmock("swr");
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import { TEST_CLOCK_INSTANT, testClockDay } from "~/test/clock";
import type {
  TraegerSchoolDayChanges,
  TraegerSchoolsDayChanges,
} from "~/lib/traeger-day-changes-api";

const { mockFetchDayChanges, mockUseSession, trackEvent } = vi.hoisted(() => ({
  mockFetchDayChanges: vi.fn(),
  mockUseSession: vi.fn(),
  trackEvent: vi.fn(),
}));

vi.mock("next-auth/react", () => ({ useSession: mockUseSession }));
vi.mock("~/lib/traeger-url", () => ({
  traegerPath: (path: string) => path,
}));
vi.mock("~/lib/traeger-day-changes-api", () => ({
  fetchTraegerSchoolsDayChanges: (...args: unknown[]) =>
    mockFetchDayChanges(...args),
}));
vi.mock("~/lib/analytics", () => ({ trackEvent }));

import { TraegerDayChangesCard } from "./traeger-day-changes-card";

function school(
  id: string,
  name: string,
  changes: Partial<TraegerSchoolDayChanges>,
): TraegerSchoolDayChanges {
  return {
    id,
    name,
    slug: name,
    subdomain: name,
    city: "",
    closingDays: [],
    cancelledBlocks: 0,
    openingChanges: [],
    mealCancelled: false,
    closedRooms: 0,
    ...changes,
  };
}

function answer(
  schools: readonly TraegerSchoolDayChanges[],
  day = testClockDay(0),
): TraegerSchoolsDayChanges {
  return {
    day,
    schools,
    asOf: TEST_CLOCK_INSTANT.toISOString(),
  };
}

function renderCard() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>
        <TraegerDayChangesCard />
      </ToastProvider>
    </SWRConfig>,
  );
}

describe("TraegerDayChangesCard (#7672, #8146)", () => {
  beforeEach(() => {
    mockFetchDayChanges.mockReset();
    mockUseSession.mockReturnValue({
      data: { user: { id: "A", scope: "org", orgId: "7", permissions: [] } },
      status: "authenticated",
    });
  });

  it("says that everything runs as planned when no school has a change", async () => {
    mockFetchDayChanges.mockResolvedValue(answer([]));
    renderCard();

    expect(
      await screen.findByText(
        "Heute läuft an allen Schulen alles wie geplant.",
      ),
    ).toBeInTheDocument();
    const card = screen.getByTestId("traeger-day-changes");
    expect(within(card).getByText("Heute anders")).toBeInTheDocument();
    expect(
      within(card).queryByRole("link", { name: /Zur Schule/ }),
    ).not.toBeInTheDocument();
  });

  it("lists each school with its closing days and cancelled blocks and links into the school view", async () => {
    mockFetchDayChanges.mockResolvedValue(
      answer([
        school("11", "OGS Am Bach", {
          city: "Köln",
          closingDays: [
            { name: "Studientag", traeger: false, since: null, until: null },
          ],
        }),
        school("12", "OGS Lindenweg", {
          closingDays: [
            {
              name: "Betriebsausflug",
              traeger: true,
              since: "2026-07-09",
              until: "2026-07-11",
            },
          ],
          cancelledBlocks: 1,
        }),
        school("13", "OGS Mühlenteich", { cancelledBlocks: 3 }),
      ]),
    );
    renderCard();

    expect(await screen.findByText("3 Schulen")).toBeInTheDocument();
    expect(screen.getByText("Schließtag der Schule:")).toBeInTheDocument();
    expect(screen.getByText("Studientag")).toBeInTheDocument();
    expect(screen.getByText("Schließtag des Trägers:")).toBeInTheDocument();
    expect(
      screen.getByText("Betriebsausflug, seit 9.7., bis 11.7."),
    ).toBeInTheDocument();
    expect(screen.getByText("1 Termin abgesagt")).toBeInTheDocument();
    expect(screen.getByText("3 Termine abgesagt")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Zur Schule: OGS Lindenweg" }),
    ).toHaveAttribute("href", "/traeger/schulen/12");
    expect(
      screen.queryByText("Heute läuft an allen Schulen alles wie geplant."),
    ).not.toBeInTheDocument();
  });

  it("shows the changed opening hours, the cancelled lunch and the closed rooms of a school (#8146)", async () => {
    mockFetchDayChanges.mockResolvedValue(
      answer([
        school("21", "OGS Kurzer Tag", {
          openingChanges: [
            {
              opensAt: "08:00",
              closesAt: "12:30",
              since: "2026-07-09",
              until: "2026-07-11",
            },
          ],
        }),
        school("22", "OGS Ohne Essen", { mealCancelled: true }),
        school("23", "OGS Räume zu", { closedRooms: 2 }),
        school("24", "OGS Ein Raum", { closedRooms: 1 }),
      ]),
    );
    renderCard();

    expect(await screen.findByText("4 Schulen")).toBeInTheDocument();
    expect(screen.getByText("Geänderte Öffnungszeit:")).toBeInTheDocument();
    expect(
      screen.getByText("8:00 bis 12:30 Uhr, seit 9.7., bis 11.7."),
    ).toBeInTheDocument();
    expect(screen.getByText("Mittagessen:")).toBeInTheDocument();
    expect(screen.getByText("fällt heute aus")).toBeInTheDocument();
    expect(screen.getByText("2 Räume gesperrt")).toBeInTheDocument();
    expect(screen.getByText("1 Raum gesperrt")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Zur Schule: OGS Ohne Essen" }),
    ).toHaveAttribute("href", "/traeger/schulen/22");
  });

  it("leaves out a school whose answer has no change", async () => {
    mockFetchDayChanges.mockResolvedValue(
      answer([
        school("31", "OGS Ruhig", {}),
        school("32", "OGS Ohne Essen", { mealCancelled: true }),
      ]),
    );
    renderCard();

    expect(await screen.findByText("1 Schule")).toBeInTheDocument();
    expect(screen.queryByText("OGS Ruhig")).not.toBeInTheDocument();
  });

  it("switches to tomorrow with the same card and says „morgen“ (#8236)", async () => {
    const tomorrow = testClockDay(1);
    mockFetchDayChanges.mockImplementation((date?: string) =>
      Promise.resolve(
        date === tomorrow
          ? answer(
              [school("41", "OGS Morgen", { mealCancelled: true })],
              tomorrow,
            )
          : answer([school("42", "OGS Heute", { cancelledBlocks: 1 })]),
      ),
    );
    trackEvent.mockReset();
    renderCard();

    expect(await screen.findByText("OGS Heute")).toBeInTheDocument();
    expect(mockFetchDayChanges).toHaveBeenLastCalledWith(undefined);
    expect(screen.getByRole("button", { name: "Heute" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Morgen" }));

    expect(await screen.findByText("OGS Morgen")).toBeInTheDocument();
    expect(mockFetchDayChanges).toHaveBeenLastCalledWith(tomorrow);
    expect(trackEvent).toHaveBeenCalledWith("day_changes_tomorrow_shown");
    expect(screen.getByText("fällt morgen aus")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Hier stehen die Schulen, an denen morgen etwas anders läuft als geplant.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("OGS Heute")).not.toBeInTheDocument();
  });

  it("says that everything runs as planned tomorrow", async () => {
    const tomorrow = testClockDay(1);
    mockFetchDayChanges.mockImplementation((date?: string) =>
      Promise.resolve(answer([], date ?? testClockDay(0))),
    );
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Morgen" }));

    expect(
      await screen.findByText(
        "Morgen läuft an allen Schulen alles wie geplant.",
      ),
    ).toBeInTheDocument();
    expect(mockFetchDayChanges).toHaveBeenLastCalledWith(tomorrow);
  });

  it("never shows the answer of another day under tomorrow", async () => {
    // A stale answer of today must not stand with the sentences of tomorrow.
    mockFetchDayChanges.mockResolvedValue(
      answer([school("51", "OGS Nur heute", { mealCancelled: true })]),
    );
    renderCard();
    expect(await screen.findByText("OGS Nur heute")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Morgen" }));

    await screen.findByRole("button", { name: "Morgen", pressed: true });
    expect(screen.queryByText("OGS Nur heute")).not.toBeInTheDocument();
    expect(screen.queryByText("fällt morgen aus")).not.toBeInTheDocument();
  });
});
