import { describe, expect, it } from "vitest";
import { dataOrBare } from "./envelope-or-bare";

describe("dataOrBare", () => {
  it("reads the data of the catalog proxy's envelope", () => {
    expect(
      dataOrBare({ success: true, message: "Success", data: [{ id: "1" }] }),
    ).toEqual([{ id: "1" }]);
  });

  it("reads the data of the backend's envelope a route passes on", () => {
    expect(dataOrBare({ status: "success", data: { enabled: true } })).toEqual({
      enabled: true,
    });
  });

  it("keeps a bare answer, also one with a field named data", () => {
    expect(dataOrBare([{ id: "1" }])).toEqual([{ id: "1" }]);
    expect(dataOrBare({ enabled: false, data: "x" })).toEqual({
      enabled: false,
      data: "x",
    });
  });
});
