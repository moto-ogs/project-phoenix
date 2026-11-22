import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "~/lib/api-error";
import type {
  ContractFamilyBilling,
  FamilyBilling,
} from "~/lib/traeger-billing-terms-api";
import { TraegerResourceTestProvider } from "~/test/traeger-resource-provider";
import { FamilyBillingStatusCard } from "./family-billing-status-card";

vi.unmock("swr");

const api = vi.hoisted(() => ({ fetchContractFamilyBilling: vi.fn() }));
vi.mock("~/lib/traeger-billing-terms-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));
vi.mock("~/lib/traeger-url", () => ({ traegerPath: (path: string) => path }));

const STORED: FamilyBilling = {
  id: "5",
  familyEmail: "anna@example.org",
  contractId: "42",
  recipientKind: "payer",
  secondFirstName: "",
  secondLastName: "",
  payerFirstName: "Carla",
  payerLastName: "Muster",
  payerEmail: "carla@example.org",
  payerAddress: { street: "Weg 1", postalCode: "12345", city: "Ort" },
  paymentMethod: "direct_debit",
  dueDay: 15,
  debtorNumber: "",
  updatedAt: "2026-09-01T10:00:00Z",
};

const READ: ContractFamilyBilling = {
  contractId: "42",
  familyEmail: "anna@example.org",
  partyName: "Anna Muster",
  partyLastName: "Muster",
  family: STORED,
};

function renderCard() {
  render(
    <TraegerResourceTestProvider>
      <FamilyBillingStatusCard contractId="42" />
    </TraegerResourceTestProvider>,
  );
}

describe("FamilyBillingStatusCard (#7770)", () => {
  beforeEach(() => {
    api.fetchContractFamilyBilling.mockReset();
  });

  it("shows recipient, payment method and due day of the stored deviation", async () => {
    api.fetchContractFamilyBilling.mockResolvedValue(READ);
    renderCard();

    expect(
      await screen.findByText("Carla Muster (andere Person)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Lastschrift")).toBeInTheDocument();
    expect(screen.getByText("Am 15. des Monats")).toBeInTheDocument();
    expect(api.fetchContractFamilyBilling).toHaveBeenCalledWith("42");
    expect(screen.getByRole("link", { name: "Ändern" })).toHaveAttribute(
      "href",
      "/traeger/abrechnung/familien/zahlung/42?von=vertrag",
    );
  });

  it("names both parents of the stored deviation", async () => {
    api.fetchContractFamilyBilling.mockResolvedValue({
      ...READ,
      family: {
        ...STORED,
        recipientKind: "both",
        secondFirstName: "Ben",
        secondLastName: "Muster",
      },
    });
    renderCard();
    expect(
      await screen.findByText("Anna Muster und Ben Muster"),
    ).toBeInTheDocument();
  });

  it("shows the fallbacks without a deviation", async () => {
    api.fetchContractFamilyBilling.mockResolvedValue({
      ...READ,
      family: null,
    });
    renderCard();

    expect(await screen.findByText("Anna Muster")).toBeInTheDocument();
    expect(
      screen.getByText("Wie in den Abrechnungsvorgaben"),
    ).toBeInTheDocument();
    expect(screen.getByText("Wie im Lauf")).toBeInTheDocument();
  });

  it("stays away for a role without the right „Abrechnung“", async () => {
    let refuse: (error: unknown) => void = () => undefined;
    api.fetchContractFamilyBilling.mockReturnValue(
      new Promise((_, reject) => {
        refuse = reject;
      }),
    );
    renderCard();
    // Anker: while it loads, the card shows its title.
    expect(
      await screen.findByText("Empfänger und Zahlung"),
    ).toBeInTheDocument();
    refuse(new ApiError("forbidden", 403));
    await waitFor(() =>
      expect(
        screen.queryByText("Empfänger und Zahlung"),
      ).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says that it could not load on another failure", async () => {
    api.fetchContractFamilyBilling.mockRejectedValue(
      new ApiError("offline", 503),
    );
    renderCard();

    expect(
      await screen.findByText(
        "Empfänger und Zahlung konnten nicht geladen werden.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Empfänger und Zahlung")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ändern" })).toBeInTheDocument();
  });
});
