import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchBillingFamily } from "./traeger-billing-families-api";
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
