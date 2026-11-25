import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "~/lib/api-error";
import type {
  BillingTerms,
  ContractFamilyBilling,
  FamilyBilling,
} from "~/lib/traeger-billing-terms-api";
import { catalogText } from "~/test/error-catalog-text";
import { deferred } from "~/test/helpers/form-modal-pending";
import { TraegerResourceTestProvider } from "~/test/traeger-resource-provider";

vi.unmock("swr");
const { api, nav, form } = vi.hoisted(() => ({
  api: {
    fetchContractFamilyBilling: vi.fn(),
    fetchBillingTerms: vi.fn(),
  },
  nav: { push: vi.fn(), search: "" },
  form: { props: null as null | Record<string, unknown> },
}));
vi.mock("~/lib/traeger-billing-terms-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));
vi.mock("~/lib/traeger-url", () => ({ traegerPath: (path: string) => path }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ contractId: "42" }),
  useRouter: () => ({ push: nav.push, replace: vi.fn() }),
  usePathname: () => "/traeger/abrechnung/familien/zahlung/42",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("~/components/traeger/use-debtor-number-format", () => ({
  useDebtorNumberFormat: () => ({}),
}));
vi.mock("~/components/traeger/sepa-mandate-status-card", () => ({
  useSepaMandateStatus: () => ({
    mandates: [],
    failure: null,
    inForce: undefined,
    collectable: false,
  }),
  SepaMandateStatusView: () => null,
}));
// Assert the page's mount boundary and what it hands the form. The form's
// draft and save contract have their own coverage in family-billing-form.test.tsx.
vi.mock("~/components/traeger/family-billing-form", () => ({
  FamilyBillingForm: (props: {
    existing: FamilyBilling | null;
    onSaved: (family: FamilyBilling | null) => void;
  }) => {
    form.props = props;
    return (
      <div data-testid="billing-form">
        {props.existing?.payerFirstName ?? "ohne Abweichung"}
      </div>
    );
  },
}));
import Page from "./page-content";

const family: FamilyBilling = {
  id: "5",
  familyEmail: "anna@example.org",
  contractId: "42",
  recipientKind: "payer",
  secondFirstName: "",
  secondLastName: "",
  payerFirstName: "Carla",
  payerLastName: "Muster",
  payerEmail: "carla@example.org",
  payerAddress: null,
  paymentMethod: "transfer",
  dueDay: 15,
  debtorNumber: "",
  updatedAt: "2026-09-01T10:00:00Z",
};
const read: ContractFamilyBilling = {
  contractId: "42",
  familyEmail: "anna@example.org",
  partyName: "Anna Muster",
  partyLastName: "Muster",
  family,
  version: "v-7",
};
const terms: BillingTerms = {
  services: [],
  terms: [
    {
      version: "v1",
      service: "care",
      paymentMethod: "transfer",
      dueDays: 14,
      bundleWith: "",
      custom: false,
      updatedAt: null,
    },
  ],
};

function renderPage() {
  return render(<Page />, { wrapper: TraegerResourceTestProvider });
}

describe("TraegerFamilyPaymentPage (#7770)", () => {
  beforeEach(() => {
    api.fetchContractFamilyBilling.mockReset();
    api.fetchBillingTerms.mockReset();
    api.fetchBillingTerms.mockResolvedValue(terms);
    nav.push.mockReset();
    nav.search = "";
    form.props = null;
  });

  it("mounts the form only after the fresh read answered, with what it needs", async () => {
    const fresh = deferred<ContractFamilyBilling>();
    api.fetchContractFamilyBilling.mockReturnValue(fresh.promise);
    renderPage();
    await waitFor(() =>
      expect(api.fetchContractFamilyBilling).toHaveBeenCalledWith("42"),
    );
    // Anker: the page shows its back link while the read is pending.
    expect(
      screen.getAllByRole("link", { name: /Zurück zu den Familien/ })[0],
    ).toBeInTheDocument();
    expect(screen.queryByTestId("billing-form")).not.toBeInTheDocument();

    await act(async () => fresh.resolve(read));
    expect(await screen.findByTestId("billing-form")).toHaveTextContent(
      "Carla",
    );
    expect(
      screen.getByRole("heading", {
        name: "Empfänger und Zahlung: Familie Muster",
      }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(form.props).toMatchObject({
        termsText: "Überweisung für alle Leistungen",
      }),
    );
    expect(form.props).toMatchObject({
      existing: family,
      version: "v-7",
      target: {
        contractId: "42",
        applicantName: "Anna Muster",
        issued: false,
        withoutRun: true,
      },
      mandateInForce: false,
    });
  });

  it("hands a family without deviation null", async () => {
    api.fetchContractFamilyBilling.mockResolvedValue({ ...read, family: null });
    renderPage();
    expect(await screen.findByTestId("billing-form")).toHaveTextContent(
      "ohne Abweichung",
    );
    expect(form.props).toMatchObject({ existing: null });
  });

  it.each([
    ["", "/traeger/abrechnung/familien", /Zurück zu den Familien/],
    [
      "zahlung=ohne",
      "/traeger/abrechnung/familien?zahlung=ohne",
      /Zurück zu den Familien/,
    ],
    ["zahlung=bar", "/traeger/abrechnung/familien", /Zurück zu den Familien/],
    ["von=vertrag", "/traeger/vertraege/42", /Zurück zum Vertrag/],
  ])(
    "leads back with „%s“ to %s, also after saving",
    async (search, target, label) => {
      nav.search = search;
      api.fetchContractFamilyBilling.mockResolvedValue(read);
      renderPage();
      await screen.findByTestId("billing-form");

      // The test harness's tenant path stands in front of every back link.
      for (const link of screen.getAllByRole("link", { name: label })) {
        expect(link.getAttribute("href")).toMatch(
          new RegExp(`${target.replace(/[?]/g, "\\?")}$`),
        );
      }
      const props = form.props as {
        onSaved: (family: FamilyBilling | null) => void;
        onCancel: () => void;
      };
      act(() => props.onSaved(family));
      expect(nav.push).toHaveBeenCalledWith(target);
      nav.push.mockReset();
      act(() => props.onCancel());
      expect(nav.push).toHaveBeenCalledWith(target);
    },
  );

  // ADR 0311: a save refused as changed since makes the page read the
  // family again; the form gets the new state and its version.
  it("reads the family again when a save was refused as changed", async () => {
    api.fetchContractFamilyBilling
      .mockResolvedValueOnce(read)
      .mockResolvedValueOnce({
        ...read,
        family: { ...family, payerFirstName: "Dora" },
        version: "v-8",
      });
    renderPage();
    expect(await screen.findByTestId("billing-form")).toHaveTextContent(
      "Carla",
    );
    const props = form.props as { reload: () => Promise<undefined> };
    await act(() => props.reload());
    expect(await screen.findByText("Dora")).toBeInTheDocument();
    expect(api.fetchContractFamilyBilling).toHaveBeenCalledTimes(2);
    expect(form.props).toMatchObject({ version: "v-8" });
  });

  it("shows the load error and no form when the read fails", async () => {
    api.fetchContractFamilyBilling.mockRejectedValue(
      new ApiError("offline", 503),
    );
    renderPage();
    expect(
      await screen.findByText(
        catalogText(
          "general.unavailable",
          "die Angabe zu Empfänger und Zahlung",
        ),
      ),
    ).toBeVisible();
    expect(screen.queryByTestId("billing-form")).not.toBeInTheDocument();
  });
});
