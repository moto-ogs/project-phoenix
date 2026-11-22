import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ContractFamilyBilling as WireContractFamilyBilling,
  FamilyBilling as WireFamilyBilling,
} from "./contract/traeger-family-billing.generated";
import {
  fetchContractFamilyBilling,
  fetchFamilyBillings,
} from "./traeger-billing-terms-api";

const request = vi.hoisted(() => vi.fn());
vi.mock("./traeger-api", () => ({ traegerRequest: request }));
afterEach(() => request.mockReset());

const STORED: WireFamilyBilling = {
  id: "5",
  family_email: "anna@example.org",
  contract_id: "42",
  recipient_kind: "payer",
  second_first_name: "",
  second_last_name: "",
  payer_first_name: "Carla",
  payer_last_name: "Muster",
  payer_email: "carla@example.org",
  payer_address: { street: "Weg 1", postal_code: "12345", city: "Ort" },
  payment_method: "direct_debit",
  due_day: 15,
  debtor_number: "10 4711",
  holder_first_name: "",
  holder_last_name: "",
  last_used_on: null,
  updated_at: "2026-09-01T10:00:00Z",
};

const CONTRACT: WireContractFamilyBilling = {
  contract_id: "42",
  family_email: "anna@example.org",
  party_first_name: " Anna",
  party_last_name: "Muster ",
  family: null,
};

describe("fetchContractFamilyBilling (#7770)", () => {
  it("reads the encoded contract and keeps a family without deviation null", async () => {
    request.mockResolvedValue(CONTRACT);

    await expect(fetchContractFamilyBilling("4/2")).resolves.toEqual({
      contractId: "42",
      familyEmail: "anna@example.org",
      partyName: "Anna Muster",
      partyLastName: "Muster ",
      family: null,
    });
    expect(request).toHaveBeenCalledWith(
      "/api/traeger/family-billing/contracts/4%2F2",
    );
  });

  it("names a party without first name and maps a stored deviation like the list", async () => {
    request.mockResolvedValueOnce({
      ...CONTRACT,
      party_first_name: "",
      party_last_name: "Muster",
      family: STORED,
    });
    const read = await fetchContractFamilyBilling("42");
    request.mockResolvedValueOnce([STORED]);
    const [listed] = await fetchFamilyBillings();

    expect(read.partyName).toBe("Muster");
    expect(read.family).toEqual(listed);
    expect(read.family).toEqual({
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
      debtorNumber: "10 4711",
      updatedAt: "2026-09-01T10:00:00Z",
    });
  });

  it("keeps an unknown payment method apart and a missing contract empty", async () => {
    request.mockResolvedValue({
      ...CONTRACT,
      family: { ...STORED, contract_id: "0", payment_method: "cash" },
    });
    const read = await fetchContractFamilyBilling("42");
    expect(read.family).toMatchObject({
      contractId: "",
      paymentMethod: undefined,
    });
  });
});
