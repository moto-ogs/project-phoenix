import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TraegerResourceTestProvider } from "~/test/traeger-resource-provider";
import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import { catalogText } from "~/test/error-catalog-text";
import type { CareTariffs } from "~/lib/traeger-care-billing-api";
import type { CareRule } from "~/lib/traeger-care-reductions-api";
import { setTestClock } from "~/test/clock";

const { fetchCareTariffs, fetchCareRules, deleteCarePriceList } = vi.hoisted(
  () => ({
    fetchCareTariffs: vi.fn(),
    fetchCareRules: vi.fn(),
    deleteCarePriceList: vi.fn(),
  }),
);
vi.mock("~/lib/traeger-care-billing-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/traeger-care-billing-api")>()),
  fetchCareTariffs,
  deleteCarePriceList,
}));
vi.mock("~/lib/traeger-care-reductions-api", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/lib/traeger-care-reductions-api")
  >()),
  fetchCareRules,
}));
vi.mock("~/lib/traeger-url", () => ({
  traegerPath: (path: string) => path.replace(/^\/traeger/, "") || "/",
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/abrechnung/preise",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import TraegerPreislistePage from "./page";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { traegerBillingKeys } from "~/lib/swr/traeger-billing-keys";

vi.unmock("swr");

const data: CareTariffs = {
  schools: [{ id: "11", name: "Sonnenhof" }],
  modules: ["A", "B", "C"].map((name, index) => ({
    schoolId: "11",
    schoolName: "Sonnenhof",
    careOfferingId: String(index + 101),
    moduleName: `Modul ${name}`,
    endsAt: "14:00",
    bookedWeekdays: ["mon"],
    bookedDaysPerWeek: [1],
    contractCount: 1,
  })),
  tariffs: ["A", "B", "C"].map((name, index) => ({
    id: String(index + 1),
    schoolId: "11",
    careOfferingId: String(index + 101),
    moduleName: `Modul ${name}`,
    weekday: index === 2 ? "" : "mon",
    daysPerWeek: index === 2 ? 1 : null,
    validFrom: "2026-01-01",
    validUntil: null,
    monthlyCents: 1000,
    siblingCents: 500,
  })),
  billedUntil: {},
};

const rule: CareRule = {
  version: "v1",
  id: "1",
  kind: "sibling",
  name: "Geschwisterpreise",
  validFrom: "2026-01-01",
  validUntil: null,
  schoolIds: [],
  careOfferingIds: [],
  countSchoolIds: [],
  siblingFromChild: 2,
  discountBasisPoints: null,
  discountCents: null,
  priceCents: null,
  capCents: null,
  tariffSiblingPrice: true,
  countsFamilyChildren: false,
};

function renderPage(rules: readonly CareRule[]) {
  fetchCareRules.mockResolvedValue({ rules });
  return render(
    <TraegerResourceTestProvider>
      <TraegerPreislistePage />
    </TraegerResourceTestProvider>,
  );
}

function expectInactive(moduleName: string, inactive: boolean) {
  const row = screen
    .getAllByRole("row")
    .find((entry) => within(entry).queryByText(moduleName));
  expect(row).toBeDefined();
  const cells = within(row!);
  expect(cells.getByText("5,00 €")).toBeInTheDocument();
  expect(cells.queryByText("(gilt zurzeit nicht)") !== null).toBe(inactive);
}

describe("sibling prices of the displayed price list", () => {
  beforeEach(() => {
    setTestClock("2026-11-12T12:00:00+01:00");
    fetchCareTariffs.mockResolvedValue(data);
  });

  it.each(["101", "103"])(
    "applies a module-restricted rule only to module %s, for either price form",
    async (careOfferingId) => {
      renderPage([{ ...rule, careOfferingIds: [careOfferingId] }]);
      await screen.findAllByText("Modul A");
      await waitFor(() => {
        expectInactive("Modul A", careOfferingId !== "101");
        expectInactive("Modul B", true);
        expectInactive("Modul C", careOfferingId !== "103");
      });
      expect(screen.getByText(/„Modul B“/)).toHaveTextContent(/gelten.*nicht/);
    },
  );

  it.each([
    { validFrom: "2026-09-01", validUntil: null, inactive: false },
    { validFrom: "2026-01-01", validUntil: "2026-08-31", inactive: true },
  ])(
    "uses November for the list that started in January: %j",
    async (dates) => {
      renderPage([{ ...rule, ...dates }]);
      await screen.findAllByText("Modul A");
      await waitFor(() => expectInactive("Modul A", dates.inactive));
    },
  );

  it("keeps historical and future lists scoped to their own months", async () => {
    fetchCareTariffs.mockResolvedValue({
      ...data,
      tariffs: data.tariffs.map((tariff) => ({
        ...tariff,
        validFrom: "2025-01-01",
      })),
      lists: [
        { schoolId: "11", validFrom: "2025-01-01", freeMonths: [] },
        { schoolId: "11", validFrom: "2026-01-01", freeMonths: [] },
        { schoolId: "11", validFrom: "2027-01-01", freeMonths: [] },
      ],
    });
    renderPage([{ ...rule, validUntil: "2026-12-31" }]);
    await screen.findAllByText("Modul A");
    await waitFor(() => expectInactive("Modul A", false));
    fireEvent.click(screen.getByRole("combobox", { name: "Preise anzeigen" }));
    fireEvent.click(screen.getByRole("option", { name: /Januar 2025/ }));
    await waitFor(() => expectInactive("Modul A", true));
    fireEvent.click(screen.getByRole("combobox", { name: "Preise anzeigen" }));
    fireEvent.click(screen.getByRole("option", { name: /Januar 2027/ }));
    await waitFor(() => expectInactive("Modul A", true));
    fireEvent.click(screen.getByRole("combobox", { name: "Preise anzeigen" }));
    fireEvent.click(screen.getByRole("option", { name: /Januar 2026/ }));
    await waitFor(() => expectInactive("Modul A", false));
  });

  // #7304: the school cards sit in one grid, so the last one keeps its
  // height, and each keeps its jump anchor.
  it("puts every school card with its jump anchor into one grid", async () => {
    fetchCareTariffs.mockResolvedValue({
      ...data,
      schools: [
        { id: "11", name: "Sonnenhof" },
        { id: "12", name: "Am Berg" },
      ],
    });
    const { container } = renderPage([rule]);
    await screen.findAllByText("Modul A");
    const cards = ["11", "12"].map((id) =>
      container.querySelector(`#care-prices-${id}`),
    );
    const grid = cards[0]?.parentElement;
    expect(grid).toHaveClass("grid");
    for (const card of cards) expect(card?.parentElement).toBe(grid);
  });
});

// ADR 0311: a colleague changed the school's prices since the page read
// them. The removal sends the version the page showed, is refused, closes
// its dialog and shows the stored prices, so a second „Löschen“ cannot
// remove them unseen.
describe("removing a price list", () => {
  beforeEach(() => {
    setTestClock("2026-11-12T12:00:00+01:00");
  });

  it("shows the prices a colleague saved since instead of removing them", async () => {
    const read: CareTariffs = {
      ...data,
      lists: [{ schoolId: "11", validFrom: "2026-01-01", freeMonths: [] }],
      versions: { "11": "v-1" },
    };
    fetchCareTariffs.mockReset().mockResolvedValueOnce(read);
    fetchCareTariffs.mockResolvedValue({
      ...read,
      tariffs: read.tariffs.map((tariff) => ({
        ...tariff,
        monthlyCents: 1200,
      })),
      versions: { "11": "v-2" },
    });
    deleteCarePriceList
      .mockReset()
      .mockRejectedValue(
        new ApiError("changed", 409, { code: "general.changed_since_read" }),
      );
    fetchCareRules.mockResolvedValue({ rules: [rule] });
    render(
      <ToastProvider>
        <TraegerResourceTestProvider>
          <TraegerPreislistePage />
        </TraegerResourceTestProvider>
      </ToastProvider>,
    );
    await screen.findAllByText("Modul A");
    fireEvent.click(
      screen.getByRole("button", { name: "Weitere Aktionen: Sonnenhof" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: /Preise ab Januar 2026 löschen/,
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Ja, löschen" }));
    fireEvent.click(await screen.findByRole("button", { name: "Löschen" }));

    expect(
      await screen.findByText(
        catalogText("general.changed_since_read", "die Preisliste"),
      ),
    ).toBeInTheDocument();
    expect(deleteCarePriceList).toHaveBeenCalledWith("11", "2026-01-01", "v-1");
    expect((await screen.findAllByText("12,00 €")).length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: "Löschen" }),
    ).not.toBeInTheDocument();
  });

  // ADR 0311 rule 6: a failed read of the prices after a refused removal
  // says so instead of claiming the new state shows.
  it("names a failed read of the prices after a refused removal", async () => {
    const read: CareTariffs = {
      ...data,
      lists: [{ schoolId: "11", validFrom: "2026-01-01", freeMonths: [] }],
      versions: { "11": "v-1" },
    };
    fetchCareTariffs.mockReset().mockResolvedValueOnce(read);
    fetchCareTariffs.mockRejectedValue(
      new ApiError("down", 503, { code: "general.unavailable" }),
    );
    deleteCarePriceList
      .mockReset()
      .mockRejectedValue(
        new ApiError("changed", 409, { code: "general.changed_since_read" }),
      );
    fetchCareRules.mockResolvedValue({ rules: [rule] });
    render(
      <ToastProvider>
        <TraegerResourceTestProvider>
          <TraegerPreislistePage />
        </TraegerResourceTestProvider>
      </ToastProvider>,
    );
    await screen.findAllByText("Modul A");
    fireEvent.click(
      screen.getByRole("button", { name: "Weitere Aktionen: Sonnenhof" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: /Preise ab Januar 2026 löschen/,
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Ja, löschen" }));
    fireEvent.click(await screen.findByRole("button", { name: "Löschen" }));

    expect(
      await screen.findByText(/Der neue Stand konnte nicht geladen werden/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Du siehst jetzt den neuen Stand/),
    ).not.toBeInTheDocument();
  });

  it("removes with the version its dialog opened on, not a newer one read in the background", async () => {
    const read: CareTariffs = {
      ...data,
      lists: [{ schoolId: "11", validFrom: "2026-01-01", freeMonths: [] }],
      versions: { "11": "v-1" },
    };
    fetchCareTariffs.mockReset().mockResolvedValueOnce(read);
    fetchCareTariffs.mockResolvedValue({ ...read, versions: { "11": "v-2" } });
    deleteCarePriceList
      .mockReset()
      .mockRejectedValue(
        new ApiError("changed", 409, { code: "general.changed_since_read" }),
      );
    fetchCareRules.mockResolvedValue({ rules: [rule] });
    // Another surface on the same shared read refreshes it while the
    // dialog is open.
    function BackgroundRefresh() {
      const { data: shared, mutate } = useTraegerResource<CareTariffs>(
        traegerBillingKeys.careTariffs(),
        fetchCareTariffs,
        "die Preisliste",
      );
      return (
        <button type="button" onClick={() => void mutate()}>
          {`refresh ${shared?.versions?.["11"] ?? ""}`}
        </button>
      );
    }
    render(
      <ToastProvider>
        <TraegerResourceTestProvider>
          <TraegerPreislistePage />
          <BackgroundRefresh />
        </TraegerResourceTestProvider>
      </ToastProvider>,
    );
    await screen.findAllByText("Modul A");
    fireEvent.click(
      screen.getByRole("button", { name: "Weitere Aktionen: Sonnenhof" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: /Preise ab Januar 2026 löschen/,
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Ja, löschen" }));
    fireEvent.click(screen.getByRole("button", { name: "refresh v-1" }));
    await screen.findByRole("button", { name: "refresh v-2" });
    fireEvent.click(await screen.findByRole("button", { name: "Löschen" }));

    await waitFor(() =>
      expect(deleteCarePriceList).toHaveBeenCalledWith(
        "11",
        "2026-01-01",
        "v-1",
      ),
    );
  });
});
