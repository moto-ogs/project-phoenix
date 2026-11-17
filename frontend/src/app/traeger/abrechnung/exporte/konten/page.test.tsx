import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { TraegerResourceTestProvider } from "~/test/traeger-resource-provider";
import { ApiError } from "~/lib/api-error";
import type { BookingAccounts } from "~/lib/traeger-finance-exports-api";
import { TEST_CLOCK_TODAY, testClockDay } from "~/test/clock";
import TraegerBookingAccountsPage from "./page";

vi.unmock("swr");

const api = vi.hoisted(() => ({
  fetchBookingAccounts: vi.fn(),
  saveRevenueAccount: vi.fn(),
  addCostCenter: vi.fn(),
  deleteCostCenter: vi.fn(),
}));
vi.mock("~/lib/traeger-finance-exports-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));
vi.mock("~/lib/traeger-url", () => ({ traegerPath: (path: string) => path }));

// ISP holds today, ISP27 starts later.
const CURRENT_FROM = testClockDay(-251);
const NEXT_FROM = testClockDay(114);

const PAGE: BookingAccounts = {
  standardAccount: "4400",
  costCenterRequired: false,
  schools: [
    { id: "11", name: "GS Ispringen" },
    { id: "12", name: "GS Birkenfeld" },
  ],
  offerings: [{ schoolId: "11", offeringId: "501", moduleNames: ["Modul 1"] }],
  revenueAccounts: [{ scope: "meals", scopeId: "0", account: "4420" }],
  costCenters: [
    {
      id: "1",
      scope: "school",
      scopeId: "11",
      validFrom: CURRENT_FROM,
      code: "ISP",
    },
    {
      id: "2",
      scope: "school",
      scopeId: "11",
      validFrom: NEXT_FROM,
      code: "ISP27",
    },
  ],
};

/** The row of a school's group: its monthly contributions or its holiday care. */
function schoolRow(school: string, title: string): HTMLElement {
  const group = screen.getByRole("group", { name: school });
  return within(group).getByText(title).closest("li")!;
}

function renderPage() {
  return render(
    <TraegerResourceTestProvider>
      <TraegerBookingAccountsPage />
    </TraegerResourceTestProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  api.fetchBookingAccounts.mockResolvedValue(PAGE);
});

it("shows where each Leistung books and which cost center holds today", async () => {
  renderPage();
  const meals = (await screen.findByText("Mensa")).closest("li")!;
  expect(within(meals).getByText("4420")).toBeInTheDocument();
  const care = screen.getByText("Monatsbeiträge").closest("li")!;
  expect(within(care).getByText("4400")).toBeInTheDocument();
  expect(within(care).getByText("Standard-Erlöskonto")).toBeInTheDocument();
  const offering = screen.getAllByText("Modul 1")[0]!.closest("li")!;
  expect(within(offering).getByText("Standard-Erlöskonto")).toBeInTheDocument();

  const school = schoolRow("GS Ispringen", "Monatsbeiträge und Mensa");
  expect(within(school).getByText("ISP")).toBeInTheDocument();
  expect(
    within(school).getByText(
      `seit ${CURRENT_FROM.split("-").reverse().join(".")}`,
    ),
  ).toBeInTheDocument();
  expect(within(school).getByText("ISP27")).toBeInTheDocument();
  const other = schoolRow("GS Birkenfeld", "Monatsbeiträge und Mensa");
  expect(within(other).getByText("Keine Kostenstelle")).toBeInTheDocument();
  expect(screen.getByText("1 von 2")).toBeInTheDocument();
});

// #7357: a school books its holiday care on a cost center of its own; without
// one the row names the cost center its holiday weeks book on instead.
it("shows per school where its holiday care books", async () => {
  api.fetchBookingAccounts.mockResolvedValue({
    ...PAGE,
    schools: [...PAGE.schools, { id: "13", name: "GS Dillweißenstein" }],
    costCenters: [
      ...PAGE.costCenters,
      {
        id: "3",
        scope: "school_holiday",
        scopeId: "12",
        validFrom: CURRENT_FROM,
        code: "5569",
      },
      {
        id: "4",
        scope: "school_holiday",
        scopeId: "12",
        validFrom: NEXT_FROM,
        code: "5570",
      },
      {
        id: "5",
        scope: "holiday",
        scopeId: "0",
        validFrom: CURRENT_FROM,
        code: "FER",
      },
    ],
  });
  renderPage();
  await screen.findByRole("group", { name: "GS Ispringen" });

  const inherits = schoolRow("GS Ispringen", "Ferienbetreuung");
  expect(within(inherits).getByText("ISP")).toBeInTheDocument();
  expect(within(inherits).getByText("wie Monatsbeiträge")).toBeInTheDocument();
  expect(within(inherits).queryByText(/^seit /)).toBeNull();

  const own = schoolRow("GS Birkenfeld", "Ferienbetreuung");
  expect(within(own).getByText("5569")).toBeInTheDocument();
  expect(
    within(own).getByText(
      `seit ${CURRENT_FROM.split("-").reverse().join(".")}`,
    ),
  ).toBeInTheDocument();
  expect(within(own).getByText("5570")).toBeInTheDocument();
  fireEvent.click(
    within(own).getByRole("button", {
      name: "Neue KOST1 für die Ferienbetreuung an GS Birkenfeld",
    }),
  );
  expect(
    screen.getByText("Leer lassen: Ab diesem Tag gibt es keine eigene."),
    "an ended holiday cost center falls back, it does not end all",
  ).toBeInTheDocument();
  expect(
    within(schoolRow("GS Birkenfeld", "Monatsbeiträge und Mensa")).getByText(
      "Keine Kostenstelle",
    ),
    "the holiday cost center is none of the monthly contributions",
  ).toBeInTheDocument();

  const fallback = schoolRow("GS Dillweißenstein", "Ferienbetreuung");
  expect(within(fallback).getByText("FER")).toBeInTheDocument();
  expect(within(fallback).getByText("Ersatz-Kostenstelle")).toBeInTheDocument();
  const all = schoolRow("Alle Schulen", "Ersatz für die Ferienbetreuung");
  expect(within(all).getByText("FER")).toBeInTheDocument();
});

it("adds the holiday cost center of a school in its own scope", async () => {
  api.addCostCenter.mockResolvedValueOnce({
    ...PAGE,
    costCenters: [
      ...PAGE.costCenters,
      {
        id: "3",
        scope: "school_holiday",
        scopeId: "11",
        validFrom: TEST_CLOCK_TODAY,
        code: "5469",
      },
    ],
  });
  renderPage();
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Neue KOST1 für die Ferienbetreuung an GS Ispringen",
    }),
  );
  fireEvent.change(screen.getByLabelText("Kostenstelle"), {
    target: { value: "5469" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
  await waitFor(() =>
    expect(api.addCostCenter).toHaveBeenCalledWith({
      scope: "school_holiday",
      scopeId: "11",
      validFrom: TEST_CLOCK_TODAY,
      code: "5469",
    }),
  );
  const holiday = schoolRow("GS Ispringen", "Ferienbetreuung");
  expect(await within(holiday).findByText("5469")).toBeInTheDocument();
  expect(within(holiday).queryByText("wie Monatsbeiträge")).toBeNull();
  expect(
    within(schoolRow("GS Ispringen", "Monatsbeiträge und Mensa")).getByText(
      "ISP",
    ),
  ).toBeInTheDocument();
});

it("saves the revenue account of a Leistung after checking it like the export", async () => {
  api.saveRevenueAccount.mockResolvedValue({
    ...PAGE,
    revenueAccounts: [
      ...PAGE.revenueAccounts,
      { scope: "care", scopeId: "0", account: "4410" },
    ],
  });
  renderPage();
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Erlöskonto für Monatsbeiträge ändern",
    }),
  );
  const field = screen.getByLabelText("Erlöskonto für Monatsbeiträge");
  fireEvent.change(field, { target: { value: "0000" } });
  fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
  expect(
    await screen.findByText("Nur Ziffern, nicht nur Nullen."),
  ).toBeInTheDocument();
  expect(api.saveRevenueAccount).not.toHaveBeenCalled();

  fireEvent.change(field, { target: { value: " 4410 " } });
  fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
  await waitFor(() =>
    expect(api.saveRevenueAccount).toHaveBeenCalledWith("care", "0", "4410"),
  );
  const care = (await screen.findByText("Monatsbeiträge")).closest("li")!;
  expect(await within(care).findByText("4410")).toBeInTheDocument();
});

it("adds a cost center from a day and keeps a refused one in the form", async () => {
  api.addCostCenter.mockRejectedValueOnce(
    new ApiError("taken", 409, {
      code: "parent_billing.cost_center_date_taken",
    }),
  );
  api.addCostCenter.mockResolvedValueOnce(PAGE);
  renderPage();
  fireEvent.click(
    await screen.findByRole("button", { name: "Neue KOST1 für GS Birkenfeld" }),
  );
  fireEvent.change(screen.getByLabelText("Kostenstelle"), {
    target: { value: "BIR-1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
  expect(
    await screen.findByText(
      "Nur Buchstaben ohne Umlaute, Ziffern, Leerzeichen und _.",
    ),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Kostenstelle"), {
    target: { value: "BIR 1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
  await waitFor(() =>
    expect(api.addCostCenter).toHaveBeenCalledWith({
      scope: "school",
      scopeId: "12",
      validFrom: TEST_CLOCK_TODAY,
      code: "BIR 1",
    }),
  );
  expect(
    await screen.findByText(/Ab diesem Tag gibt es schon eine Kostenstelle/),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Kostenstelle")).toHaveValue("BIR 1");
  fireEvent.click(await screen.findByRole("button", { name: "Speichern" }));
  await waitFor(() => expect(api.addCostCenter).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(screen.queryByLabelText("Kostenstelle")).toBeNull(),
  );
  expect(
    screen.getByRole("button", { name: "Neue KOST1 für GS Birkenfeld" }),
  ).toBeEnabled();
});

it("names a missing standard account with the way to the DATEV values", async () => {
  api.fetchBookingAccounts.mockResolvedValue({
    ...PAGE,
    standardAccount: "",
    revenueAccounts: [],
  });
  renderPage();
  expect(
    await screen.findByText("Das Standard-Erlöskonto fehlt"),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "DATEV-Werte eintragen" }),
  ).toHaveAttribute("href", "/traeger/einstellungen?bereich=datev");
  const meals = screen.getByText("Mensa").closest("li")!;
  expect(within(meals).getByText("Kein Konto")).toBeInTheDocument();
});
