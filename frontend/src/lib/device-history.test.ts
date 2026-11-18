import { describe, expect, it } from "vitest";
import {
  describeDeviceHistoryEntry,
  deviceHistoryActor,
  groupDeviceHistoryByDay,
  mapDeviceHistoryEntry,
  type DeviceHistoryEntry,
} from "./device-history";
import { testClockDay } from "~/test/clock-instant";

function entry(overrides: Partial<DeviceHistoryEntry>): DeviceHistoryEntry {
  return {
    id: "1",
    action: "updated",
    actorKind: "school_staff",
    actorName: "Maria Muster",
    changes: {},
    occurredAt: `${testClockDay()}T10:00:00+02:00`,
    ...overrides,
  };
}

describe("describeDeviceHistoryEntry", () => {
  it("names an edit with each changed value before and after", () => {
    const described = describeDeviceHistoryEntry(
      entry({
        changes: {
          device_type: { before: "terminal", after: "info_point" },
          name: { before: "Eingang", after: null },
        },
      }),
    );
    expect(described).toEqual({
      title: "Angaben geändert",
      tone: "blue",
      details: ["Name: Eingang → –", "Typ: Terminal → Info-Point"],
    });
  });

  it("lets a block speak for itself instead of repeating the status", () => {
    const described = describeDeviceHistoryEntry(
      entry({
        action: "blocked",
        changes: { status: { before: "active", after: "inactive" } },
      }),
    );
    expect(described).toEqual({ title: "Gesperrt", tone: "red", details: [] });
  });

  it("lists what a new device started with", () => {
    const described = describeDeviceHistoryEntry(
      entry({
        action: "created",
        changes: {
          device_id: { before: null, after: "KIOSK-1" },
          device_type: { before: null, after: "terminal" },
          status: { before: null, after: "active" },
        },
      }),
    );
    expect(described.title).toBe("Angelegt");
    expect(described.details).toEqual(["Geräte-ID: KIOSK-1", "Typ: Terminal"]);
  });

  it("shows another status change with its readable names", () => {
    const described = describeDeviceHistoryEntry(
      entry({
        action: "status_changed",
        changes: { status: { before: "active", after: "maintenance" } },
      }),
    );
    expect(described.details).toEqual(["Status: Aktiv → Wartung"]);
  });

  it("keeps an unknown action readable", () => {
    expect(
      describeDeviceHistoryEntry(entry({ action: "migrated" })).title,
    ).toBe("Geändert");
  });
});

describe("deviceHistoryActor", () => {
  it("names the school's own staff to the school only", () => {
    expect(deviceHistoryActor(entry({}), "school")).toBe("Maria Muster");
    expect(deviceHistoryActor(entry({}), "operator")).toBe(
      "Personal der Schule",
    );
  });

  it("says the moto support for an operator and that an account is gone", () => {
    expect(
      deviceHistoryActor(
        entry({ actorKind: "operator", actorName: null }),
        "school",
      ),
    ).toBe("moto-Support");
    expect(deviceHistoryActor(entry({ actorName: null }), "school")).toBe(
      "Name nicht verfügbar",
    );
  });
});

describe("groupDeviceHistoryByDay", () => {
  it("groups the newest-first entries by their Berlin day", () => {
    const days = groupDeviceHistoryByDay([
      entry({ id: "3", occurredAt: `${testClockDay()}T11:00:00+02:00` }),
      entry({ id: "2", occurredAt: `${testClockDay()}T09:00:00+02:00` }),
      entry({ id: "1", occurredAt: `${testClockDay(-1)}T09:00:00+02:00` }),
      entry({ id: "0", occurredAt: `${testClockDay(-9)}T09:00:00+02:00` }),
    ]);
    expect(
      days.map((day) => [day.label, day.entries.map((e) => e.id)]),
    ).toEqual([
      ["Heute", ["3", "2"]],
      ["Gestern", ["1"]],
      [expect.stringMatching(/^[A-Z][a-z]+, \d\d\.\d\d\.\d{4}$/), ["0"]],
    ]);
  });
});

describe("mapDeviceHistoryEntry", () => {
  it("maps the wire entry and treats a blank name as none", () => {
    expect(
      mapDeviceHistoryEntry({
        id: "5",
        action: "created",
        actor_kind: "school_staff",
        actor_name: "  ",
        changes: null,
        occurred_at: "2026-11-18T10:00:00Z",
      }),
    ).toEqual({
      id: "5",
      action: "created",
      actorKind: "school_staff",
      actorName: null,
      changes: {},
      occurredAt: "2026-11-18T10:00:00Z",
    });
  });
});
