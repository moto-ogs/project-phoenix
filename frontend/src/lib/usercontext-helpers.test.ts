import type * as meContract from "./contract/me.generated";
import { describe, expect, it } from "vitest";
import {
  mapActiveGroupResponse,
  mapEducationalGroupResponse,
  mapNavigationEducationalGroupResponse,
  mapStaffResponse,
  type NavigationEducationalGroup,
} from "./usercontext-helpers";

// The shapes the catalog proxy decodes (ADR 0270): IDs arrive as strings,
// fields outside the contract never arrive. The decoder's own tests cover the
// conversion of numeric IDs.

const ROW = {
  created_at: "2026-09-01T08:00:00+02:00",
  updated_at: "2026-09-01T08:00:00+02:00",
  tenant_id: "1",
};

describe("usercontext-helpers", () => {
  describe("mapEducationalGroupResponse", () => {
    it("maps a group with its room", () => {
      const group: meContract.CallerGroupRow = {
        ...ROW,
        id: "12345",
        name: "Eulen",
        room_id: "77",
        room: { ...ROW, id: "77", name: "Blauer Raum" },
        via_substitution: true,
      };
      expect(mapEducationalGroupResponse(group)).toEqual({
        id: "12345",
        name: "Eulen",
        roomId: "77",
        room: { id: "77", name: "Blauer Raum" },
        viaSubstitution: true,
      });
    });

    it("maps a group without room", () => {
      const group: meContract.CallerGroupRow = {
        ...ROW,
        id: "3",
        name: "Füchse",
        via_substitution: false,
      };
      expect(mapEducationalGroupResponse(group)).toEqual({
        id: "3",
        name: "Füchse",
        roomId: undefined,
        room: undefined,
        viaSubstitution: false,
      });
    });
  });

  describe("mapNavigationEducationalGroupResponse", () => {
    it("preserves string IDs and builds room data from the navigation view", () => {
      const navigationGroup: NavigationEducationalGroup = {
        id: "12345",
        name: "Eulen",
        room_id: "77",
        room_name: "Blauer Raum",
        via_substitution: true,
        is_personal: true,
      };

      expect(mapNavigationEducationalGroupResponse(navigationGroup)).toEqual({
        id: "12345",
        name: "Eulen",
        roomId: "77",
        room: { id: "77", name: "Blauer Raum" },
        viaSubstitution: true,
      });
    });
  });

  describe("mapActiveGroupResponse", () => {
    const session: meContract.ActiveGroup = {
      ...ROW,
      id: "9",
      start_time: "2026-09-09T10:00:00+02:00",
      last_activity: "2026-09-09T10:00:00+02:00",
      timeout_minutes: 30,
      group_id: null,
      room_id: "77",
    };

    // Go sends no name of its own (#2353): the view names the session by
    // its room.
    it("maps the session with its room", () => {
      const result = mapActiveGroupResponse({
        ...session,
        room: { name: "Turnhalle", id: "77" } as NonNullable<
          meContract.ActiveGroup["room"]
        >,
      });
      expect(result).toEqual({
        id: "9",
        room_id: "77",
        room: { id: "77", name: "Turnhalle" },
      });
    });
  });

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
