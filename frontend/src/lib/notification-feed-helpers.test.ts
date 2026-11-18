import { describe, expect, it } from "vitest";

import {
  mapNotificationFeedEntry,
  mapNotificationFeedPage,
} from "./notification-feed-helpers";

const wire = {
  id: 9007199254740,
  type: "instance_cancelled",
  title: "Termin abgesagt",
  body: "„Fußball-AG“ am Fr., 20.11., um 14:00 Uhr fällt aus.",
  deep_link: "/mein-dienstplan?d=2026-11-20",
  created_at: "2026-11-15T09:00:00Z",
  updated_at: "2026-11-15T09:05:00Z",
  read_at: null,
};

describe("notification feed mapping", () => {
  it("maps an entry: string ID, camelCase, nullable readAt kept", () => {
    expect(mapNotificationFeedEntry(wire)).toEqual({
      id: "9007199254740",
      type: "instance_cancelled",
      title: "Termin abgesagt",
      body: "„Fußball-AG“ am Fr., 20.11., um 14:00 Uhr fällt aus.",
      deepLink: "/mein-dienstplan?d=2026-11-20",
      createdAt: "2026-11-15T09:00:00Z",
      updatedAt: "2026-11-15T09:05:00Z",
      readAt: null,
    });
    expect(
      mapNotificationFeedEntry({ ...wire, read_at: "2026-11-15T10:00:00Z" })
        .readAt,
    ).toBe("2026-11-15T10:00:00Z");
  });

  it("names the school of an entry in the Träger-Portal (#7146)", () => {
    expect(
      mapNotificationFeedEntry({ ...wire, school_name: "OGS Sonnenhof" })
        .schoolName,
    ).toBe("OGS Sonnenhof");
  });

  it("maps a page; an empty cursor means no further page", () => {
    expect(
      mapNotificationFeedPage({
        entries: [wire],
        next_cursor: "abc",
        unread_count: 4,
      }),
    ).toMatchObject({ nextCursor: "abc", unreadCount: 4 });
    expect(
      mapNotificationFeedPage({ entries: [], next_cursor: "", unread_count: 0 })
        .nextCursor,
    ).toBeNull();
    expect(
      mapNotificationFeedPage({
        entries: [],
        next_cursor: null,
        unread_count: 0,
      }).nextCursor,
    ).toBeNull();
  });
});
