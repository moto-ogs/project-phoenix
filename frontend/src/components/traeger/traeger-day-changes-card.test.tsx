import { SWRConfig } from "~/lib/swr/testing";
vi.unmock("swr");
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import { TEST_CLOCK_INSTANT, testClockDay } from "~/test/clock";
import type {
  TraegerSchoolDayChanges,
  TraegerSchoolsDayChanges,
} from "~/lib/traeger-day-changes-api";

const { mockFetchDayChanges, mockUseSession } = vi.hoisted(() => ({
  mockFetchDayChanges: vi.fn(),
  mockUseSession: vi.fn(),
}));

vi.mock("next-auth/react", () => ({ useSession: mockUseSession }));
vi.mock("~/lib/traeger-url", () => ({
  traegerPath: (path: string) => path,
}));
vi.mock("~/lib/traeger-day-changes-api", () => ({
  fetchTraegerSchoolsDayChanges: () => mockFetchDayChanges(),
}));

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
    ...changes,
  };
}

function answer(
  schools: readonly TraegerSchoolDayChanges[],
): TraegerSchoolsDayChanges {
  return {
    day: testClockDay(0),
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

describe("TraegerDayChangesCard (#7672)", () => {
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
});
