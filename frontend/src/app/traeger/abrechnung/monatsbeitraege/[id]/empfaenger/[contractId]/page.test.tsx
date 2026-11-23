import { act, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { TraegerResourceTestProvider } from "~/test/traeger-resource-provider";
import { deferred } from "~/test/helpers/form-modal-pending";
import type {
  ContractFamilyBilling,
  FamilyBilling,
} from "~/lib/traeger-billing-terms-api";
import type { CareRunDetail } from "~/lib/traeger-care-billing-api";
import { ApiError } from "~/lib/api-error";
import { catalogText } from "~/test/error-catalog-text";

vi.unmock("swr");
const api = vi.hoisted(() => ({
  fetchCareRun: vi.fn(),
  fetchContractFamilyBilling: vi.fn(),
}));
vi.mock("~/lib/traeger-care-billing-api", () => ({
  fetchCareRun: api.fetchCareRun,
}));
vi.mock("~/lib/traeger-billing-terms-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchContractFamilyBilling: api.fetchContractFamilyBilling,
}));
vi.mock("~/lib/traeger-url", () => ({ traegerPath: (path: string) => path }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "7", contractId: "42" }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("~/components/traeger/use-debtor-number-format", () => ({
  useDebtorNumberFormat: () => ({}),
}));
vi.mock("~/components/traeger/sepa-mandate-status-card", () => ({
  SepaMandateStatusCard: () => null,
}));
// Assert the page's mount boundary. The form's draft and save contract have
// their own coverage in family-billing-form.test.tsx.
vi.mock("~/components/traeger/family-billing-form", () => ({
  FamilyBillingForm: ({
    existing,
    version,
    target,
  }: {
    existing: FamilyBilling;
    version: string;
    target: { childName: string };
  }) => (
    <div data-testid="billing-form" data-version={version}>
      {target.childName}: {existing.payerFirstName}
    </div>
  ),
}));
import Page from "./page";

const family: FamilyBilling = {
  id: "1",
  familyEmail: "family@example.org",
  contractId: "42",
  recipientKind: "payer",
  secondFirstName: "",
  secondLastName: "",
  payerFirstName: "Old payer",
  payerLastName: "Muster",
  payerEmail: "payer@example.org",
  payerAddress: null,
  paymentMethod: "",
  dueDay: null,
  debtorNumber: "",
  updatedAt: "2026-09-09T10:00:00Z",
};
// The family of the invoice's contract, the one the save writes.
const read = (payerFirstName: string): ContractFamilyBilling => ({
  contractId: "42",
  familyEmail: family.familyEmail,
  partyName: "Eva Muster",
  partyLastName: "Muster",
  family: { ...family, payerFirstName },
  version: `v-${payerFirstName}`,
});
// Only the run's invoice identity and recipient are consumed on this page.
const run = {
  id: "7",
  billingMonth: "2026-09-01",
  dueDates: [],
  invoices: [
    {
      contractId: "42",
      familyEmail: family.familyEmail,
      number: "",
      childFirstName: "Old child",
      childLastName: "Muster",
      recipient: {
        kind: "payer",
        firstName: "Old payer",
        lastName: "Muster",
        email: family.payerEmail,
      },
    },
  ],
} as unknown as CareRunDetail;

it("waits for both fresh reads before mounting a billing draft on every visit", async () => {
  api.fetchCareRun.mockResolvedValue(run);
  api.fetchContractFamilyBilling.mockResolvedValue(read("Old payer"));
  const view = render(<Page />, { wrapper: TraegerResourceTestProvider });
  expect(await screen.findByTestId("billing-form")).toHaveTextContent(
    "Old child Muster: Old payer",
  );
  expect(screen.getByTestId("billing-form")).toHaveAttribute(
    "data-version",
    "v-Old payer",
  );
  view.rerender(<div>away</div>);
  const freshRun = deferred<CareRunDetail>();
  const freshFamily = deferred<ContractFamilyBilling>();
  api.fetchCareRun.mockReturnValue(freshRun.promise);
  api.fetchContractFamilyBilling.mockReturnValue(freshFamily.promise);
  view.rerender(<Page />);
  expect(screen.queryByTestId("billing-form")).not.toBeInTheDocument();
  await act(async () =>
    freshRun.resolve({
      ...run,
      invoices: run.invoices.map((i) => ({
        ...i,
        childFirstName: "Fresh child",
      })),
    }),
  );
  expect(screen.queryByTestId("billing-form")).not.toBeInTheDocument();
  await act(async () => freshFamily.reject(new ApiError("offline", 503)));
  expect(
    await screen.findByText(
      catalogText("general.unavailable", "die Angabe zu Empfänger und Zahlung"),
    ),
  ).toBeVisible();
  expect(screen.queryByTestId("billing-form")).not.toBeInTheDocument();
  view.rerender(<div>away</div>);
  api.fetchCareRun.mockResolvedValue(run);
  api.fetchContractFamilyBilling.mockResolvedValue(read("Fresh payer"));
  view.rerender(<Page />);
  await waitFor(() =>
    expect(screen.getByTestId("billing-form")).toHaveTextContent("Fresh payer"),
  );
  expect(api.fetchContractFamilyBilling).toHaveBeenLastCalledWith("42");
});
