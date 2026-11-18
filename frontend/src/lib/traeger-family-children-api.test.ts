import { beforeEach, describe, expect, it, vi } from "vitest";
import { removeFamilyChildren } from "./traeger-family-children-api";

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
          contract_id: 77,
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
