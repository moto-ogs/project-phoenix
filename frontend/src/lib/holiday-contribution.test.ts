import { describe, expect, it } from "vitest";
import { contributionFromBackend } from "./holiday-contribution";

describe("contributionFromBackend (#2353)", () => {
  it("keeps a line of an unknown kind with its amount, without a known kind", () => {
    const contribution = contributionFromBackend({
      children: [
        {
          child_id: "0",
          position: 1,
          total_cents: 4000,
          lines: [
            {
              kind: "late_fee",
              amount_cents: 500,
              week_starts_on: null,
              week_ends_on: null,
              time_model_name: "",
              child_rank: null,
              discount_basis_points: null,
              discount_cents: null,
              note: "",
              cost_bearer_id: null,
              cost_bearer_name: "",
              booked_days: null,
            },
          ],
        },
      ],
      total_cents: 4000,
      exemption_available: false,
      benefits_exemption: false,
      cost_bearer_id: "0",
      cost_bearer_name: "",
      frozen: false,
      confirmed_at: null,
      invoiced: false,
    });
    const [line] = contribution.children[0]?.lines ?? [];
    expect(line?.amountCents).toBe(500);
    expect(line?.kind).toBeUndefined();
    expect(contribution.children[0]?.childId).toBe("");
    expect(contribution.costBearerId).toBeNull();
  });
});
