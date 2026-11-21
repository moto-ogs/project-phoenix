import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  confirmFamilyChildren,
  removeFamilyChildren,
} from "./traeger-family-children-api";

const { traegerRequest } = vi.hoisted(() => ({ traegerRequest: vi.fn() }));
vi.mock("./traeger-api", () => ({ traegerRequest }));

describe("removeFamilyChildren", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // The route answers a DELETE with 204 and no body: the list comes from a
  // read after it, never from the removal's answer.
  it("reads the families again after the removal", async () => {
    traegerRequest.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
      families: [
        {
          contract_id: "77",
          recipient_first_name: "",
          recipient_last_name: "",
          recipient_email: "",
          children: null,
          count: null,
          status: "missing",
        },
      ],
      rules: null,
    });
    const set = await removeFamilyChildren("77");
    expect(traegerRequest).toHaveBeenNthCalledWith(
      1,
      "/api/traeger/family-children/77",
      { method: "DELETE" },
    );
    expect(traegerRequest).toHaveBeenNthCalledWith(
      2,
      "/api/traeger/family-children",
    );
    expect(set.families).toEqual([
      expect.objectContaining({ contractId: "77", status: "missing" }),
    ]);
  });
});

describe("confirmFamilyChildren", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // traegerRequest writes the JSON itself. A body handed over as a string
  // went out as a JSON string, and Go refused every confirmation with
  // parent_billing.family_children_invalid (#2353).
  it("hands the body over as an object, not as JSON text", async () => {
    traegerRequest.mockResolvedValueOnce({ families: null, rules: null });
    await confirmFamilyChildren({
      contractId: "77",
      children: 3,
      validFrom: "2026-09-01",
      validUntil: null,
    });
    expect(traegerRequest).toHaveBeenCalledWith(
      "/api/traeger/family-children",
      {
        method: "PUT",
        body: {
          contract_id: 77,
          children: 3,
          valid_from: "2026-09-01",
          valid_until: null,
        },
      },
    );
  });
});
