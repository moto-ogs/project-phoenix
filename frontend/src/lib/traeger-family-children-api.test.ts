import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  confirmFamilyChildren,
  removeFamilyChildren,
} from "./traeger-family-children-api";

const { bffJson } = vi.hoisted(() => ({ bffJson: vi.fn() }));
vi.mock("~/lib/bff-fetch", () => ({ bffJson }));

describe("removeFamilyChildren", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // The route answers a DELETE with 204 and no body: the list comes from a
  // read after it, never from the removal's answer.
  it("reads the families again after the removal", async () => {
    bffJson.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
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
    expect(bffJson).toHaveBeenNthCalledWith(
      1,
      "org",
      "DELETE /traeger/family-children/{contractId}",
      { params: { contractId: "77" } },
    );
    expect(bffJson).toHaveBeenNthCalledWith(
      2,
      "org",
      "GET /traeger/family-children/",
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

  // bffJson writes the JSON itself. A body handed over as a string
  // went out as a JSON string, and Go refused every confirmation with
  // parent_billing.family_children_invalid (#2353).
  it("hands the body over as an object, not as JSON text", async () => {
    bffJson.mockResolvedValueOnce({ families: null, rules: null });
    await confirmFamilyChildren(
      {
        contractId: "77",
        children: 3,
        validFrom: "2026-09-01",
        validUntil: null,
      },
      "v1",
    );
    expect(bffJson).toHaveBeenCalledWith(
      "org",
      "PUT /traeger/family-children/",
      {
        body: {
          contract_id: "77",
          children: 3,
          valid_from: "2026-09-01",
          valid_until: null,
          expected_version: "v1",
        },
      },
    );
  });
});
