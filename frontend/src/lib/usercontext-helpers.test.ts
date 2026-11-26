import type * as meContract from "./contract/me.generated";
import { describe, expect, it } from "vitest";
import { mapStaffResponse } from "./usercontext-helpers";

// The shapes the catalog proxy decodes (ADR 0270): IDs arrive as strings,
// fields outside the contract never arrive. The decoder's own tests cover the
// conversion of numeric IDs.

const ROW = {
  created_at: "2026-09-01T08:00:00+02:00",
  updated_at: "2026-09-01T08:00:00+02:00",
  tenant_id: "1",
};

describe("usercontext-helpers", () => {
  describe("mapStaffResponse", () => {
    const staff: meContract.Staff = {
      ...ROW,
      id: "5",
      person_id: "8",
      birthday_display_opt_out: false,
    };

    it("maps the record with its person", () => {
      expect(
        mapStaffResponse({
          ...staff,
          person: {
            ...ROW,
            id: "8",
            first_name: "Eva",
            last_name: "Muster",
          },
        }),
      ).toEqual({
        id: "5",
        person_id: "8",
        person: { id: "8", first_name: "Eva", last_name: "Muster" },
      });
    });

    it("maps a record without person", () => {
      expect(mapStaffResponse(staff)).toEqual({
        id: "5",
        person_id: "8",
        person: undefined,
      });
    });
  });
});
