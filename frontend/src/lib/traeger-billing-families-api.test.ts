import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type BillingFamily,
  type FamilyChildNumbers,
  fetchBillingFamilies,
  fetchBillingFamily,
  withFamilyChildren,
} from "./traeger-billing-families-api";
import { fetchContributionRules } from "./traeger-contributions-api";

const request = vi.hoisted(() => vi.fn());
vi.mock("~/lib/bff-fetch", () => ({ bffJson: request }));
afterEach(() => request.mockReset());

const FAMILY = {
  id: "41",
  recipient_first_name: "Eva",
  recipient_last_name: "Muster",
  recipient_email: "eva@example.org",
  debtor_numbers: null,
  payments: [{ kind: "foundation", cost_bearer_name: "" }],
  payment_methods: ["transfer", "cash"],
  invoice_count: 1,
  open_invoice_count: 1,
  document_count: 1,
  last_issued_on: null,
  family_email: "eva@example.org",
  family_debtor_number: "",
  holiday_only: false,
  issued_cents: 100,
  cancelled_cents: 0,
  credited_cents: 0,
  open_cents: 100,
};

// ADR 0270 point 6: values a newer backend adds are not passed on as known
// ones (#2353).
describe("billing families", () => {
  it("keeps unknown kinds, methods and states apart from the known ones", async () => {
    request.mockResolvedValue({
      ...FAMILY,
      documents: [
        {
          id: "7",
          service: "camp",
          run_id: "3",
          kind: "reminder",
          number: "FE-1",
          issued_on: null,
          period_name: "Ostern",
          service_from: null,
          service_until: null,
          reference_number: "",
          reason: "",
          child_names: null,
          debtor_number: "",
          total_cents: 100,
          payment: null,
          status: "disputed",
          open_cents: 100,
          payment_method: "cash",
          due_on: null,
        },
      ],
    });
    const family = await fetchBillingFamily("41");
    expect(family.payments).toEqual([{ kind: undefined, costBearerName: "" }]);
    expect(family.paymentMethods).toEqual(["transfer"]);
    expect(family.documents[0]).toMatchObject({
      service: undefined,
      kind: undefined,
      status: null,
      paymentMethod: undefined,
      issuedOn: null,
    });
  });

  it("leaves a contribution rule of an unknown kind out", async () => {
    const rule = {
      id: "1",
      service: "holiday",
      valid_from: "2026-08-01",
      valid_until: null,
      sibling_from_child: 2,
      discount_basis_points: 1000,
      discount_cents: null,
      note: "",
      name: "",
      school_ids: null,
      care_offering_ids: null,
      count_school_ids: null,
      price_cents: null,
      cap_cents: null,
      tariff_sibling_price: false,
      counts_family_children: false,
      updated_at: "2026-08-01T08:00:00+02:00",
    };
    request.mockResolvedValue([
      { ...rule, kind: "sibling" },
      { ...rule, id: "2", kind: "income_level" },
    ]);
    const rules = await fetchContributionRules();
    expect(rules.map((entry) => entry.id)).toEqual(["1"]);
  });
});

describe("the family's own payment method and contract (#7770)", () => {
  it('maps a known method, keeps "" and drops an unknown one', async () => {
    request.mockResolvedValue([
      { ...FAMILY, family_payment_method: "direct_debit", contract_id: "42" },
      { ...FAMILY, id: "42", family_payment_method: "", contract_id: "0" },
      { ...FAMILY, id: "43", family_payment_method: "cash", contract_id: "7" },
    ]);
    const families = await fetchBillingFamilies();
    expect(
      families.map((family) => [family.familyPaymentMethod, family.contractId]),
    ).toEqual([
      ["direct_debit", "42"],
      ["", ""],
      ["", "7"],
    ]);
  });

  const LISTED: BillingFamily = {
    id: "41",
    recipientFirstName: "Anna",
    recipientLastName: "Muster",
    recipientEmail: "anna@example.org",
    debtorNumbers: [],
    payments: [],
    paymentMethods: [],
    invoiceCount: 1,
    openInvoiceCount: 0,
    documentCount: 1,
    lastIssuedOn: "",
    familyEmail: "anna@example.org",
    familyDebtorNumber: "",
    holidayOnly: false,
    hasDocuments: true,
    familyPaymentMethod: "transfer",
    contractId: "",
    issuedCents: 0,
    cancelledCents: 0,
    creditedCents: 0,
    openCents: 0,
  };
  const CHILDREN: FamilyChildNumbers = {
    contractId: "9",
    familyEmail: "anna@example.org",
    recipientFirstName: "Anna",
    recipientLastName: "Muster",
    children: [
      {
        firstName: "Mia",
        lastName: "Muster",
        birthDate: null,
        debtorNumber: "",
      },
    ],
  };

  it("keeps the contract of the family's own deviation", () => {
    const [family] = withFamilyChildren(
      [{ ...LISTED, contractId: "42" }],
      [CHILDREN],
    );
    expect(family).toMatchObject({
      contractId: "42",
      children: CHILDREN.children,
    });
  });

  it("takes the contract of the children entry when the family has none", () => {
    const [family] = withFamilyChildren([LISTED], [CHILDREN]);
    expect(family).toMatchObject({
      contractId: "9",
      familyPaymentMethod: "transfer",
    });
    const [withoutAny] = withFamilyChildren(
      [{ ...LISTED, contractId: undefined }],
      [{ ...CHILDREN, contractId: undefined }],
    );
    expect(withoutAny?.contractId).toBe("");
  });

  it("gives a family only the children list knows its contract and no method", () => {
    const families = withFamilyChildren(
      [LISTED],
      [
        CHILDREN,
        {
          ...CHILDREN,
          contractId: "11",
          familyEmail: "ben@example.org",
          recipientFirstName: "Ben",
        },
      ],
    );
    expect(families).toHaveLength(2);
    expect(families[1]).toMatchObject({
      id: "0",
      familyEmail: "ben@example.org",
      contractId: "11",
      familyPaymentMethod: "",
      hasDocuments: false,
    });
  });
  it("keeps contract families and drops number-only families per payer", () => {
    const families = withFamilyChildren(
      [LISTED],
      [
        { ...CHILDREN, contractId: "11", familyEmail: "ben@example.org" },
        { ...CHILDREN, contractId: undefined, familyEmail: "nur@example.org" },
      ],
      false,
    );
    // The family with a contract joins without children and is marked as
    // known by its contract alone; the one known only by a child's number
    // has nothing to show per payer.
    expect(families.map((family) => family.familyEmail)).toEqual([
      LISTED.familyEmail,
      "ben@example.org",
    ]);
    expect(families[1]).toMatchObject({ contractId: "11", contractOnly: true });
    expect(families[1]?.children).toBeUndefined();
    expect(families[0]?.children).toBeUndefined();
  });
});
