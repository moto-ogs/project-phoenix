import { ApiError } from "~/lib/api-error";
import { catalogText } from "~/test/error-catalog-text";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { TraegerResourceTestProvider } from "~/test/traeger-resource-provider";
import { DESKTOP_WIDTH, setViewportWidth } from "~/test/helpers/viewport";
import type { BillingFamily } from "~/lib/traeger-billing-families-api";

const { api, mockPush, mockReplace, nav } = vi.hoisted(() => ({
  api: {
    fetchBillingFamilies: vi.fn(),
    setFamilyDebtorNumber: vi.fn(),
    fetchDebtorNumberSettings: vi.fn(),
    fetchFamilyChildren: vi.fn(),
    setChildDebtorNumber: vi.fn(),
  },
  mockPush: vi.fn(),
  mockReplace: vi.fn(),
  nav: { search: "" },
}));

vi.mock("~/lib/traeger-billing-families-api", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/lib/traeger-billing-families-api")
  >()),
  ...api,
}));
vi.mock("~/lib/traeger-url", () => ({
  traegerPath: (path: string) => path.replace(/^\/traeger/, "") || "/",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  usePathname: () => "/abrechnung/familien",
  useSearchParams: () => new URLSearchParams(nav.search),
}));

import TraegerBillingFamiliesPage from "./page";

vi.unmock("swr");

const SCHNEIDER: BillingFamily = {
  id: "4",
  recipientFirstName: "Sabine",
  recipientLastName: "Schneider",
  recipientEmail: "sabine@example.org",
  debtorNumbers: ["10 4711"],
  payments: [{ kind: "family", costBearerName: "" }],
  invoiceCount: 1,
  openInvoiceCount: 1,
  documentCount: 2,
  lastIssuedOn: "2026-09-02",
  familyEmail: "sabine@example.org",
  familyDebtorNumber: "10 4711",
  holidayOnly: false,
  hasDocuments: true,
  issuedCents: 11250,
  cancelledCents: 0,
  creditedCents: 500,
  openCents: 10750,
};

const BERGER: BillingFamily = {
  ...SCHNEIDER,
  id: "7",
  recipientFirstName: "Tom",
  recipientLastName: "Berger",
  recipientEmail: "tom@example.org",
  familyEmail: "tom@example.org",
  familyDebtorNumber: "",
  debtorNumbers: [],
  payments: [{ kind: "cost_bearer", costBearerName: "Jugendamt Enzkreis" }],
  openInvoiceCount: 0,
  documentCount: 1,
  issuedCents: 0,
  creditedCents: 0,
  openCents: 0,
};

const MAIER: BillingFamily = {
  ...BERGER,
  id: "0",
  recipientFirstName: "Petra",
  recipientLastName: "Maier",
  recipientEmail: "petra.maier@example.org",
  familyEmail: "petra.maier@example.org",
  familyDebtorNumber: "20 815",
  holidayOnly: true,
  hasDocuments: false,
  payments: [],
  invoiceCount: 0,
  documentCount: 0,
  lastIssuedOn: "",
};

function renderPage() {
  render(
    <TraegerResourceTestProvider>
      <TraegerBillingFamiliesPage />
    </TraegerResourceTestProvider>,
  );
}

describe("TraegerBillingFamiliesPage", () => {
  beforeEach(() => {
    api.fetchBillingFamilies.mockReset();
    api.setFamilyDebtorNumber.mockReset();
    mockPush.mockReset();
    mockReplace.mockReset();
    nav.search = "";
    api.fetchBillingFamilies.mockResolvedValue([SCHNEIDER, BERGER]);
    api.fetchDebtorNumberSettings.mockReset();
    api.fetchDebtorNumberSettings.mockResolvedValue({
      format: { digitsOnly: false, minDigits: 0, maxDigits: 0 },
      scope: "payer",
    });
    api.fetchFamilyChildren.mockReset();
    api.setChildDebtorNumber.mockReset();
  });

  it("clears the settings failure after a successful retry", async () => {
    api.fetchDebtorNumberSettings.mockRejectedValueOnce(
      new ApiError("offline", 503),
    );
    renderPage();
    const error = await screen.findByText(
      catalogText(
        "general.unavailable",
        "die Einstellungen der Debitorennummer",
      ),
    );
    expect(error).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    expect((await screen.findAllByText("Sabine Schneider"))[0]).toBeVisible();
    expect(
      screen.queryByText(
        catalogText(
          "general.unavailable",
          "die Einstellungen der Debitorennummer",
        ),
      ),
    ).not.toBeInTheDocument();
  });

  it("lists every family with who pays and its sums", async () => {
    renderPage();

    expect(
      (await screen.findAllByText("Sabine Schneider"))[0],
    ).toBeInTheDocument();
    expect(screen.getAllByText("Familie zahlt selbst")[0]).toBeInTheDocument();
    expect(
      screen.getAllByText("Kostenübernahme: Jugendamt Enzkreis")[0],
    ).toBeInTheDocument();
    const tab = screen
      .getAllByText("Familien")
      .map((element) => element.closest("a"))
      .find((link) => link !== null);
    expect(tab).toHaveAttribute("href", "/abrechnung/familien");
    expect(screen.getAllByText("107,50 €").length).toBeGreaterThan(0);
  });

  it("names the open sum a claim before payment", async () => {
    // #6348: moto sees no incoming payment. The open sum is what the
    // invoices still ask for, never a checked arrear.
    renderPage();
    await screen.findAllByText("Sabine Schneider");

    expect(screen.getAllByText("Offene Forderung").length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        "Stand vor Zahlungseingang. Zahlungen sieht moto nicht.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("mit offener Forderung")).toBeInTheDocument();
  });

  it("finds a family by its debtor number", async () => {
    renderPage();
    await screen.findAllByText("Tom Berger");

    fireEvent.change(
      screen.getAllByPlaceholderText("Name, E-Mail, Debitorennummer")[0]!,
      { target: { value: "4711" } },
    );

    expect(
      (await screen.findAllByText("Sabine Schneider"))[0],
    ).toBeInTheDocument();
    expect(screen.queryByText("Tom Berger")).not.toBeInTheDocument();
  });

  it("opens a family", async () => {
    renderPage();
    const row = (await screen.findAllByText("Sabine Schneider"))[0]!.closest(
      "[role='button'], tr",
    );
    expect(row).not.toBeNull();
    fireEvent.click(row!);

    expect(mockPush).toHaveBeenCalledWith("/abrechnung/familien/4");
  });

  it("says when no family is known yet", async () => {
    // #6692: a family stands here from the confirmed holiday registration
    // on, not only from the first released run.
    api.fetchBillingFamilies.mockResolvedValue([]);
    renderPage();

    expect(
      (await screen.findAllByText("Noch keine Familie."))[0],
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(
        "Eine Familie steht hier, sobald du eine Ferienanmeldung bestätigst oder eine Rechnung freigibst.",
      )[0],
    ).toBeInTheDocument();
  });

  it("lists a holiday family before its first invoice and does not open it", async () => {
    api.fetchBillingFamilies.mockResolvedValue([SCHNEIDER, MAIER]);
    renderPage();

    const name = (await screen.findAllByText("Petra Maier"))[0]!;
    expect(screen.getAllByText("Nur Ferien")[0]).toBeInTheDocument();
    expect(screen.getAllByText("20 815")[0]).toBeInTheDocument();
    expect(screen.getByText("ohne Debitorennummer")).toBeInTheDocument();
    const row = name.closest("tr")!;
    fireEvent.click(row);
    expect(mockPush).not.toHaveBeenCalled();
    expect(row).not.toHaveClass("cursor-pointer");
  });

  it.each([320, 1440])(
    "offers number entry through the row menu at %s px without opening the family",
    async (width) => {
      setViewportWidth(width);
      onTestFinished(() => setViewportWidth(DESKTOP_WIDTH));
      api.fetchBillingFamilies.mockResolvedValue([BERGER]);
      renderPage();
      await screen.findAllByText("Tom Berger");
      fireEvent.click(
        screen.getByRole("button", { name: "Aktionen für Tom Berger" }),
      );
      expect(mockPush).not.toHaveBeenCalled();
      fireEvent.click(
        screen.getByRole("menuitem", { name: "Debitorennummer eintragen" }),
      );
      expect(await screen.findByLabelText("Debitorennummer")).toHaveValue("");
      expect(mockPush).not.toHaveBeenCalled();
    },
  );

  it("changes the debtor number of a family in its cell", async () => {
    api.fetchBillingFamilies.mockResolvedValue([MAIER]);
    api.setFamilyDebtorNumber.mockResolvedValue("20 816");
    renderPage();

    await screen.findAllByText("Petra Maier");
    fireEvent.click(
      screen.getAllByRole("button", {
        name: "Aktionen für Petra Maier",
      })[0]!,
    );
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Debitorennummer ändern" }),
    );
    const field = await screen.findByLabelText("Debitorennummer");
    expect(field).toHaveValue("20 815");
    fireEvent.change(field, { target: { value: " 20 816 " } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(api.setFamilyDebtorNumber).toHaveBeenCalledWith(
        "petra.maier@example.org",
        "20 816",
      ),
    );
    await waitFor(() =>
      expect(api.fetchBillingFamilies).toHaveBeenCalledTimes(2),
    );
  });

  it("offers „Eintragen“ for a family without a number and filters by the count (#6675)", async () => {
    renderPage();

    await screen.findAllByText("Tom Berger");
    expect(
      screen.getAllByRole("button", {
        name: "Aktionen für Tom Berger",
      })[0],
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Aktionen für Tom Berger" }),
    );
    expect(
      screen.getByRole("menuitem", { name: "Debitorennummer eintragen" }),
    ).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Familien ohne Debitorennummer zeigen",
      }),
    );
    await waitFor(() =>
      expect(screen.queryAllByText("Sabine Schneider")).toHaveLength(0),
    );
    expect(screen.getAllByText("Tom Berger")[0]).toBeInTheDocument();
    expect(screen.getAllByText("Ohne Debitorennummer")[0]).toBeInTheDocument();
  });

  it("checks the Träger's format before it saves a number (#6675)", async () => {
    api.fetchBillingFamilies.mockResolvedValue([MAIER]);
    api.fetchDebtorNumberSettings.mockResolvedValue({
      format: { digitsOnly: true, minDigits: 5, maxDigits: 5 },
      scope: "payer",
    });
    renderPage();

    await screen.findAllByText("Petra Maier");
    await waitFor(() =>
      expect(api.fetchDebtorNumberSettings).toHaveBeenCalled(),
    );
    fireEvent.click(
      screen.getAllByRole("button", {
        name: "Aktionen für Petra Maier",
      })[0]!,
    );
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Debitorennummer ändern" }),
    );
    const field = await screen.findByLabelText("Debitorennummer");
    await waitFor(() => expect(field).toHaveAttribute("inputmode", "numeric"));
    expect(field).toHaveAccessibleDescription(
      /Die Nummer hat 5 Ziffern, zum Beispiel 20815\./,
    );
    fireEvent.change(field, { target: { value: "20 816" } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(
      await screen.findByText(
        "Die Debitorennummer hat 5 Ziffern, zum Beispiel 20815.",
      ),
    ).toBeInTheDocument();
    expect(api.setFamilyDebtorNumber).not.toHaveBeenCalled();
  });
  it("shows and sets the number of each child when the Träger keeps one per child (#7007)", async () => {
    api.fetchDebtorNumberSettings.mockResolvedValue({
      format: { digitsOnly: false, minDigits: 0, maxDigits: 0 },
      scope: "child",
    });
    api.fetchBillingFamilies.mockResolvedValue([SCHNEIDER]);
    api.fetchFamilyChildren.mockResolvedValue([
      {
        familyEmail: "sabine@example.org",
        recipientFirstName: "Sabine",
        recipientLastName: "Schneider",
        children: [
          {
            firstName: "Mia",
            lastName: "Schneider",
            birthDate: "2018-03-04",
            debtorNumber: "60101",
          },
          {
            firstName: "Noah",
            lastName: "Schneider",
            birthDate: null,
            debtorNumber: "",
          },
        ],
      },
      {
        familyEmail: "eva@example.org",
        recipientFirstName: "Eva",
        recipientLastName: "Neu",
        children: [
          {
            firstName: "Lia",
            lastName: "Neu",
            birthDate: null,
            debtorNumber: "",
          },
        ],
      },
    ]);
    api.setChildDebtorNumber.mockResolvedValue({
      firstName: "Noah",
      lastName: "Schneider",
      birthDate: null,
      debtorNumber: "60102",
    });
    renderPage();

    expect((await screen.findAllByText("Eva Neu"))[0]).toBeInTheDocument();
    expect(screen.getAllByText("Nummern der Kinder")[0]).toBeInTheDocument();
    expect(screen.getAllByText("60101")[0]).toBeInTheDocument();
    expect(screen.getAllByText("mit Kind ohne Nummer")[0]).toBeInTheDocument();

    fireEvent.click(
      screen.getAllByRole("button", {
        name: "Aktionen für Sabine Schneider",
      })[0]!,
    );
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Nummern der Kinder eintragen" }),
    );
    expect(
      await screen.findByLabelText("Mia Schneider, geb. 04.03.2018"),
    ).toHaveValue("60101");
    fireEvent.change(screen.getByLabelText("Noah Schneider"), {
      target: { value: " 60102 " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(api.setChildDebtorNumber).toHaveBeenCalledTimes(1),
    );
    expect(api.setChildDebtorNumber).toHaveBeenCalledWith(
      "sabine@example.org",
      expect.objectContaining({ firstName: "Noah" }),
      "60102",
    );
  });
  it("shows the failed read of the scope instead of guessing it (#7007)", async () => {
    api.fetchDebtorNumberSettings.mockRejectedValue(new Error("offline"));
    renderPage();

    expect(
      (await screen.findAllByText(/Einstellungen der Debitorennummer/))[0],
    ).toBeInTheDocument();
    expect(api.fetchBillingFamilies).not.toHaveBeenCalled();
  });

  it("keeps a child saved before a failed save for the retry (#7007)", async () => {
    api.fetchDebtorNumberSettings.mockResolvedValue({
      format: { digitsOnly: false, minDigits: 0, maxDigits: 0 },
      scope: "child",
    });
    api.fetchBillingFamilies.mockResolvedValue([SCHNEIDER]);
    api.fetchFamilyChildren.mockResolvedValue([
      {
        familyEmail: "sabine@example.org",
        recipientFirstName: "Sabine",
        recipientLastName: "Schneider",
        children: [
          {
            firstName: "Mia",
            lastName: "Schneider",
            birthDate: null,
            debtorNumber: "",
          },
          {
            firstName: "Noah",
            lastName: "Schneider",
            birthDate: null,
            debtorNumber: "",
          },
        ],
      },
    ]);
    api.setChildDebtorNumber
      .mockResolvedValueOnce({
        firstName: "Mia",
        lastName: "Schneider",
        birthDate: null,
        debtorNumber: "1",
      })
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({
        firstName: "Mia",
        lastName: "Schneider",
        birthDate: null,
        debtorNumber: "",
      });
    renderPage();

    await screen.findAllByText("Sabine Schneider");
    fireEvent.click(
      screen.getAllByRole("button", {
        name: "Aktionen für Sabine Schneider",
      })[0]!,
    );
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Nummern der Kinder eintragen" }),
    );
    fireEvent.change(await screen.findByLabelText("Mia Schneider"), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText("Noah Schneider"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(api.setChildDebtorNumber).toHaveBeenCalledTimes(2),
    );

    // Mia's number is stored; taking it back out must remove it.
    fireEvent.change(screen.getByLabelText("Mia Schneider"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Noah Schneider"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(api.setChildDebtorNumber).toHaveBeenCalledTimes(3),
    );
    expect(api.setChildDebtorNumber).toHaveBeenLastCalledWith(
      "sabine@example.org",
      expect.objectContaining({ firstName: "Mia" }),
      "",
    );
  });
});

describe("TraegerBillingFamiliesPage: payment method of a family (#7770)", () => {
  const DEBIT: BillingFamily = {
    ...MAIER,
    id: "0",
    recipientFirstName: "Anna",
    recipientLastName: "Muster",
    recipientEmail: "anna@example.org",
    familyEmail: "anna@example.org",
    familyDebtorNumber: "",
    holidayOnly: false,
    paymentMethods: [],
    familyPaymentMethod: "direct_debit",
    contractId: "42",
  };

  beforeEach(() => {
    api.fetchBillingFamilies.mockReset();
    mockPush.mockReset();
    mockReplace.mockReset();
    nav.search = "";
    api.fetchDebtorNumberSettings.mockReset();
    api.fetchDebtorNumberSettings.mockResolvedValue({
      format: { digitsOnly: false, minDigits: 0, maxDigits: 0 },
      scope: "payer",
    });
    api.fetchFamilyChildren.mockReset();
  });

  it("shows the payment method set for a family before its first invoice", async () => {
    api.fetchBillingFamilies.mockResolvedValue([DEBIT]);
    renderPage();

    await screen.findAllByText("Anna Muster");
    expect(screen.getAllByText("Festgelegt:")[0]).toBeInTheDocument();
    expect(screen.getAllByText("Lastschrift")[0]).toBeInTheDocument();
  });

  it("names the invoices' method when it differs from the one set", async () => {
    api.fetchBillingFamilies.mockResolvedValue([
      {
        ...SCHNEIDER,
        paymentMethods: ["transfer"],
        familyPaymentMethod: "direct_debit",
      },
    ]);
    renderPage();

    await screen.findAllByText("Sabine Schneider");
    expect(screen.getAllByText("Lastschrift")[0]).toBeInTheDocument();
    expect(
      screen.getAllByText("Auf Rechnungen: Überweisung")[0],
    ).toBeInTheDocument();
  });

  it("opens recipient and payment from the row menu under the active filter", async () => {
    nav.search = "zahlung=lastschrift";
    api.fetchBillingFamilies.mockResolvedValue([DEBIT]);
    renderPage();

    await screen.findAllByText("Anna Muster");
    fireEvent.click(
      screen.getAllByRole("button", { name: "Aktionen für Anna Muster" })[0]!,
    );
    expect(
      screen.getByRole("menuitem", { name: /Empfänger und Zahlung ändern/ }),
    ).toHaveAttribute(
      "href",
      "/abrechnung/familien/zahlung/42?zahlung=lastschrift",
    );
  });

  it("offers no payment entry for a family without a contract", async () => {
    api.fetchBillingFamilies.mockResolvedValue([{ ...DEBIT, contractId: "" }]);
    renderPage();

    await screen.findAllByText("Anna Muster");
    fireEvent.click(
      screen.getAllByRole("button", { name: "Aktionen für Anna Muster" })[0]!,
    );
    // Anker: the row menu of the family is open.
    expect(
      screen.getByRole("menuitem", { name: /Debitorennummer eintragen/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: /Empfänger und Zahlung ändern/ }),
    ).not.toBeInTheDocument();
  });

  it("shows only families without a set method under „?zahlung=ohne“", async () => {
    nav.search = "zahlung=ohne";
    api.fetchBillingFamilies.mockResolvedValue([SCHNEIDER, DEBIT]);
    renderPage();

    // Anker: the family without a method stays, with the filter as a chip.
    expect(
      (await screen.findAllByText("Sabine Schneider"))[0],
    ).toBeInTheDocument();
    const chip = screen.getAllByRole("button", {
      name: "Filter Zahlungsweg nicht festgelegt entfernen",
    })[0]!;
    expect(chip).toBeInTheDocument();
    expect(screen.queryByText("Anna Muster")).not.toBeInTheDocument();
    fireEvent.click(chip);
    expect(mockReplace).toHaveBeenCalledWith("/abrechnung/familien", {
      scroll: false,
    });
  });

  it("puts the chosen payment filter into the address", async () => {
    api.fetchBillingFamilies.mockResolvedValue([SCHNEIDER, DEBIT]);
    renderPage();

    await screen.findAllByText("Anna Muster");
    fireEvent.click(screen.getAllByText("Alle Zahlungswege")[0]!);
    fireEvent.click((await screen.findAllByText("Lastschrift festgelegt"))[0]!);
    expect(mockReplace).toHaveBeenCalledWith(
      "/abrechnung/familien?zahlung=lastschrift",
      { scroll: false },
    );
  });
});
