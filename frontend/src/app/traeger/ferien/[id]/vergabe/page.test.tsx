import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TraegerResourceTestProvider } from "~/test/traeger-resource-provider";
import { ApiError } from "~/lib/api-error";
import type { HolidayPeriod } from "~/lib/traeger-api";
import {
  allocationBoard,
  allocationEntry,
  allocationWeek,
} from "~/test/fixtures/holiday-allocation";
import { HOLIDAY_PERIOD } from "~/test/fixtures/holiday-registrations";

vi.unmock("swr");
const { fetchBoard, decide, period } = vi.hoisted(() => ({
  fetchBoard: vi.fn(),
  decide: vi.fn(),
  period: { current: null as HolidayPeriod | null },
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "5" }) }));
vi.mock("~/components/traeger/use-traeger-resources", () => ({
  useTraegerHolidayPeriod: () => ({ data: period.current }),
}));
vi.mock("~/components/traeger/use-traeger-schools", () => ({
  useTraegerSchools: () => ({
    schools: [
      { id: "31", name: "OGS Nord", slug: "nord", subdomain: "nord", city: "" },
    ],
  }),
}));
vi.mock("~/components/traeger/holiday-allocation-week", async (original) => {
  const actual =
    await original<
      typeof import("~/components/traeger/holiday-allocation-week")
    >();
  const ActualHolidayAllocationWeekCard = actual.HolidayAllocationWeekCard;
  return {
    ...actual,
    HolidayAllocationWeekCard: (
      props: ComponentProps<typeof ActualHolidayAllocationWeekCard>,
    ) =>
      props.week.pending.length > 500 ? (
        <button type="button" onClick={props.onTakeProposal}>
          Vorschlag für die Woche übernehmen
        </button>
      ) : (
        <ActualHolidayAllocationWeekCard {...props} />
      ),
  };
});
vi.mock("~/lib/traeger-holiday-allocation-api", async (original) => ({
  ...(await original<typeof import("~/lib/traeger-holiday-allocation-api")>()),
  fetchHolidayAllocation: () => fetchBoard(),
  decideHolidayAllocation: (...args: unknown[]) => decide(...args),
}));
vi.mock("~/components/ui/tenant-page", async (original) => ({
  TenantPageStats: (
    await original<typeof import("~/components/ui/tenant-page")>()
  ).TenantPageStats,
  TenantPage: ({
    stats,
    actions,
    empty,
    loading,
    children,
  }: {
    stats: ReactNode;
    actions: ReactNode;
    empty?: { title: string; description: string };
    loading?: boolean;
    children: ReactNode;
  }) => (
    <div>
      {stats}
      {actions}
      {empty ? <p>{empty.title}</p> : null}
      {loading ? <p>Lädt</p> : null}
      {children}
    </div>
  ),
}));
vi.mock("~/lib/traeger-url", () => ({ traegerPath: (path: string) => path }));

import AllocationPage from "./page";

const CRITERIA_PERIOD: HolidayPeriod = {
  ...HOLIDAY_PERIOD,
  allocationMode: "criteria",
};

function renderPage() {
  return render(
    <TraegerResourceTestProvider>
      <AllocationPage />
    </TraegerResourceTestProvider>,
  );
}

describe("holiday allocation page (#4700)", () => {
  beforeEach(() => {
    period.current = CRITERIA_PERIOD;
    fetchBoard.mockReset();
    decide.mockReset();
  });

  it("lists the open bookings in proposal order with criteria and the capacity line", async () => {
    fetchBoard.mockResolvedValue(allocationBoard());
    renderPage();

    const rows = await screen.findAllByRole("link", { name: /Rang \d/ });
    expect(rows.map((row) => row.textContent)).toEqual([
      "Rang 1: Mia Muster",
      "Rang 2: Ben Beispiel",
      "Rang 3: Lea Beispiel",
    ]);
    expect(screen.getAllByText("1. Beide Eltern berufstätig")).not.toHaveLength(
      0,
    );
    expect(
      screen.getByText("2. Geschwisterkind ist schon angemeldet: ungeklärt"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "2 freie Plätze oben · ab hier schlägt moto die Warteliste vor",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Vorschlag: Platz")).toHaveLength(2);
    expect(screen.getByText("Vorschlag: Warteliste")).toBeInTheDocument();
  });

  it("asks for a reason before a decision that differs from the proposal", async () => {
    fetchBoard.mockResolvedValue(allocationBoard());
    decide.mockResolvedValue(
      allocationBoard({ weeks: [allocationWeek({ pending: [] })] }),
    );
    renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "Lea Beispiel: Platz geben" }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Platz geben" }),
    );
    expect(
      await within(dialog).findByText("Bitte geben Sie eine Begründung ein."),
    ).toBeInTheDocument();
    expect(decide).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(/Begründung/), {
      target: { value: "Härtefall nach Gespräch" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Platz geben" }),
    );
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith("5", [
        {
          bookingId: "102",
          placement: "placed",
          proposal: "waitlisted",
          reason: "Härtefall nach Gespräch",
        },
      ]),
    );
    expect(await screen.findByText("Alles entschieden")).toBeInTheDocument();
  });

  it("sends a decision that follows the proposal without a reason field", async () => {
    fetchBoard.mockResolvedValue(allocationBoard());
    decide.mockResolvedValue(allocationBoard());
    renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "Mia Muster: Platz geben" }),
    );
    const dialog = await screen.findByRole("dialog");
    // Anker: der Dialog nennt den Vorschlag.
    expect(within(dialog).getByText("Platz, Rang 1")).toBeInTheDocument();
    expect(
      within(dialog).queryByLabelText(/Begründung/),
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Platz geben" }),
    );
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith("5", [
        {
          bookingId: "100",
          placement: "placed",
          proposal: "placed",
          reason: "",
        },
      ]),
    );
  });

  // #7111: the decided row and its button left the DOM with the focus.
  it("focuses the week heading after a decision removed its row", async () => {
    fetchBoard.mockResolvedValue(allocationBoard());
    decide.mockResolvedValue(
      allocationBoard({
        weeks: [
          allocationWeek({
            pending: allocationWeek().pending.filter(
              (entry) => entry.bookingId !== "100",
            ),
          }),
        ],
      }),
    );
    renderPage();

    const trigger = await screen.findByRole("button", {
      name: "Mia Muster: Platz geben",
    });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Platz geben" }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Mia Muster: Platz geben" }),
      ).not.toBeInTheDocument(),
    );
    const week = screen.getByRole("heading", { name: "05.07. bis 09.07.2027" });
    await waitFor(() => expect(week).toHaveFocus());
  });

  it("focuses „Alles entschieden“ once no week is open", async () => {
    fetchBoard.mockResolvedValue(allocationBoard());
    decide.mockResolvedValue(
      allocationBoard({ weeks: [allocationWeek({ pending: [] })] }),
    );
    renderPage();

    // A click focuses its button in a browser; the dialog returns there.
    const trigger = await screen.findByRole("button", {
      name: "Vorschlag für die Woche 05.07. bis 09.07.2027 übernehmen",
    });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(
      await screen.findByRole("button", { name: "Vorschlag übernehmen" }),
    );

    const done = await screen.findByRole("heading", {
      name: "Alles entschieden",
    });
    await waitFor(() => expect(done).toHaveFocus());
  });

  it("takes over the proposal of a week after the confirmation", async () => {
    fetchBoard.mockResolvedValue(allocationBoard());
    decide.mockResolvedValue(
      allocationBoard({ weeks: [allocationWeek({ pending: [] })] }),
    );
    renderPage();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Vorschlag für die Woche 05.07. bis 09.07.2027 übernehmen",
      }),
    );
    expect(
      await screen.findByText(
        "2 Kinder bekommen einen Platz. 1 Kind kommt auf die Warteliste.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Die Eltern von 2 Anmeldungen bekommen eine E-Mail."),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Vorschlag übernehmen" }),
    );
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith("5", [
        {
          bookingId: "100",
          placement: "placed",
          proposal: "placed",
          reason: "",
        },
        {
          bookingId: "101",
          placement: "placed",
          proposal: "placed",
          reason: "",
        },
        {
          bookingId: "102",
          placement: "waitlisted",
          proposal: "waitlisted",
          reason: "",
        },
      ]),
    );
  });

  it("allows a Tuesday-only place when Monday has filled the weekly minimum", async () => {
    fetchBoard.mockResolvedValue(
      allocationBoard({
        weeks: [
          allocationWeek({
            bookingUnit: "day",
            free: 0,
            placed: 1,
            pending: [allocationEntry({ days: ["2027-07-06"] })],
          }),
        ],
      }),
    );
    decide.mockResolvedValue(allocationBoard({ weeks: [] }));
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "Mia Muster: Platz geben" }),
    );
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Platz geben" });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(decide).toHaveBeenCalledTimes(1));
  });

  it("keeps the confirmed decisions across batches and excludes new bookings", async () => {
    const pending = Array.from({ length: 501 }, (_, i) =>
      allocationEntry({ bookingId: String(1000 + i), rank: i + 1 }),
    );
    fetchBoard.mockResolvedValue(
      allocationBoard({
        weeks: [allocationWeek({ capacity: null, free: null, pending })],
      }),
    );
    decide
      .mockResolvedValueOnce(
        allocationBoard({
          weeks: [
            allocationWeek({
              pending: [
                allocationEntry({ bookingId: "1500" }),
                allocationEntry({ bookingId: "9000" }),
              ],
            }),
          ],
        }),
      )
      .mockResolvedValueOnce(allocationBoard({ weeks: [] }));
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: /Vorschlag für die Woche/ }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Vorschlag übernehmen" }),
    );
    await screen.findByText("Alles entschieden");
    expect(decide).toHaveBeenCalledTimes(2);
    expect(decide.mock.calls[0]?.[1]).toHaveLength(500);
    expect(decide.mock.calls[1]?.[1]).toEqual([
      {
        bookingId: "1500",
        placement: "placed",
        proposal: "placed",
        reason: "",
      },
    ]);
  });

  it("stops for review when a later batch no longer matches the confirmed proposal", async () => {
    const pending = Array.from({ length: 501 }, (_, i) =>
      allocationEntry({ bookingId: String(1000 + i), rank: i + 1 }),
    );
    const changed = allocationBoard({
      weeks: [
        allocationWeek({
          pending: [
            allocationEntry({ bookingId: "1500", proposal: "waitlisted" }),
          ],
        }),
      ],
    });
    fetchBoard
      .mockResolvedValueOnce(
        allocationBoard({
          weeks: [allocationWeek({ capacity: null, free: null, pending })],
        }),
      )
      .mockResolvedValue(changed);
    decide
      .mockResolvedValueOnce(changed)
      .mockImplementationOnce(async (_id, choices) => {
        if (choices[0].proposal === "placed") {
          throw new ApiError("changed", 409, {
            code: "enrollment.holiday_allocation_changed",
          });
        }
        return allocationBoard({ weeks: [] });
      });
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: /Vorschlag für die Woche/ }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Vorschlag übernehmen" }),
    );
    await screen.findByText(
      "Die Liste hat sich geändert. Bitte prüfen Sie Ihre Entscheidung neu.",
    );
    expect(decide).toHaveBeenCalledTimes(2);
    expect(decide.mock.calls[1]?.[1]).toEqual([
      {
        bookingId: "1500",
        placement: "placed",
        proposal: "placed",
        reason: "",
      },
    ]);
    expect(
      await screen.findByText("Vorschlag: Warteliste"),
    ).toBeInTheDocument();
    expect(fetchBoard).toHaveBeenCalledTimes(2);
  });

  it("reads the list again when it changed meanwhile", async () => {
    fetchBoard.mockResolvedValue(allocationBoard());
    decide.mockRejectedValue(
      new ApiError("changed", 409, {
        code: "enrollment.holiday_allocation_changed",
      }),
    );
    renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "Mia Muster: Platz geben" }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Platz geben" }),
    );
    await waitFor(() => expect(fetchBoard).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByText(
        "Die Liste hat sich geändert. Bitte prüfen Sie Ihre Entscheidung neu.",
      ),
    ).toBeInTheDocument();
  });

  it("explains a period by arrival instead of loading a list", async () => {
    period.current = { ...HOLIDAY_PERIOD, allocationMode: "arrival" };
    renderPage();
    expect(
      await screen.findByText(
        "Dieser Ferienzeitraum vergibt Plätze nach Eingang",
      ),
    ).toBeInTheDocument();
    expect(fetchBoard).not.toHaveBeenCalled();
  });
});
