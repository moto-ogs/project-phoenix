import { describe, expect, it } from "vitest";
import type {
  ContextSession,
  NavigationContext,
} from "~/lib/contract/active.generated";
import {
  deriveSupervision,
  isCompleteSupervisionSeed,
  isSharedOpenRoom,
} from "./supervision-derive";

const session = (
  id: string,
  roomId: string,
  roomName: string,
  activity: string,
  own: boolean,
): ContextSession => ({
  id,
  room_id: roomId,
  room_name: roomName,
  activity_name: activity,
  is_own: own,
});

describe("supervision navigation", () => {
  it("uses stable room IDs, keeps empty releases and resolves previous session links", () => {
    const result = deriveSupervision({
      sessions: {
        status: "ok",
        overview_status: "ok",
        own_status: "ok",
        items: [
          session("30", "5", "Garten", "Natur", false),
          session("31", "5", "Garten", "Gartenrunde", true),
          session("32", "6", "Turnhalle", "Sport", false),
        ],
      },
      released_rooms: {
        status: "ok",
        items: [
          { id: "5", name: "Garten" },
          { id: "6", name: "Turnhalle" },
          { id: "7", name: "Atelier" },
        ],
      },
    });

    expect(result.supervisedRoomId).toBe("5");
    expect(result.supervisedRooms).toMatchObject([
      { id: "7", name: "Atelier", isOwnSupervision: false, isOpenRoom: true },
      {
        id: "5",
        groupId: "",
        sessionIds: ["30", "31"],
        isOwnSupervision: true,
      },
      { id: "6", groupId: "", sessionIds: ["32"], isOwnSupervision: false },
    ]);
    expect(
      isSharedOpenRoom(result.supervisedRooms, {
        roomId: null,
        sessionId: "32",
      }),
    ).toBe(true);
    expect(
      isSharedOpenRoom(result.supervisedRooms, {
        roomId: null,
        sessionId: "31",
      }),
    ).toBe(false);
  });

  it("keeps parallel non-released sessions separate and puts own sessions first", () => {
    const result = deriveSupervision({
      sessions: {
        status: "ok",
        overview_status: "ok",
        own_status: "ok",
        items: [
          session("11", "5", "Halle", "Anfang", false),
          session("12", "5", "Halle", "Ziel", true),
        ],
      },
    });
    expect(result.supervisedRooms).toMatchObject([
      { id: "5", groupId: "12", name: "Ziel · Halle", isOwnSupervision: true },
      {
        id: "5",
        groupId: "11",
        name: "Anfang · Halle",
        isOwnSupervision: false,
      },
    ]);
    expect(result.ownSupervisedRooms.map((room) => room.name)).toEqual([
      "Halle",
    ]);
  });

  it("does not grant supervision by release or guess own sessions when ownership was unavailable", () => {
    const result = deriveSupervision({
      sessions: {
        status: "ok",
        overview_status: "ok",
        own_status: "unavailable",
        items: [
          { ...session("11", "5", "Turnhalle", "Sport", true), is_own: null },
        ],
      },
      released_rooms: { status: "ok", items: [{ id: "5", name: "Turnhalle" }] },
    });
    expect(result.supervisedRooms).toMatchObject([
      { id: "5", isOwnSupervision: false },
    ]);
    expect(result.ownSupervision).toBe(false);
  });

  it("seeds known refusals, but recovers a missing or technically failed section", () => {
    const empty: NavigationContext = {
      groups: {
        status: "forbidden",
        navigation: null,
        own_group_ids: null,
        own_room_names: null,
      },
      sessions: {
        status: "ok",
        overview_status: "forbidden",
        own_status: "ok",
        items: [],
      },
      released_rooms: { status: "forbidden", items: null },
    };
    expect(isCompleteSupervisionSeed(empty)).toBe(true);
    expect(
      isCompleteSupervisionSeed({ ...empty, released_rooms: undefined }),
    ).toBe(false);
    expect(
      isCompleteSupervisionSeed({
        ...empty,
        released_rooms: { status: "unavailable", items: null },
      }),
    ).toBe(false);
  });
});
