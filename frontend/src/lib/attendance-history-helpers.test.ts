import { describe, it, expect } from "vitest";
import {
  mapAttendanceHistoryResponse,
  formatTime,
  formatDate,
  formatAttendanceSlotStatus,
  formatDuration,
  type AttendanceHistoryWire,
} from "./attendance-history-helpers";

describe("mapAttendanceHistoryResponse", () => {
  const raw: AttendanceHistoryWire = {
    student_id: "42",
    days: [
      {
        date: "2026-04-06",
        attendance: {
          check_in_time: "2026-04-06T08:00:00Z",
          check_out_time: "2026-04-06T15:30:00Z",
          duration_minutes: 450,
          checked_in_by: "11",
          checked_out_by: "11",
          checked_in_actor: { kind: "staff", name: "Anna Muster" },
          checked_out_actor: { kind: "device" },
          device_id: "3",
          sessions: [
            {
              check_in_time: "2026-04-06T08:00:00Z",
              check_out_time: "2026-04-06T09:00:00Z",
              duration_minutes: 60,
            },
          ],
        },
        slots: [
          {
            instance_id: "9223372036854775807",
            instance_status: "completed",
            title: "Morgenbetreuung",
            start_time: "07:00",
            end_time: "08:00",
            status: "present",
            checked_in_at: "2026-04-06T08:00:00Z",
            checked_out_at: "2026-04-06T09:00:00Z",
            is_unplanned: false,
          },
        ],
        status_entries: null,
        room_detail_available: true,
        visits: [
          {
            room_id: "5",
            room_name: "Gruppenraum A",
            entry_time: "2026-04-06T08:10:00Z",
            exit_time: "2026-04-06T10:30:00Z",
            duration_minutes: 140,
          },
        ],
      },
      {
        date: "2026-03-20",
        attendance: {
          check_in_time: "2026-03-20T08:00:00Z",
          checked_in_by: "11",
          device_id: "3",
          sessions: null,
        },
        status_entries: null,
        room_detail_available: false,
        visits: null,
        slots: null,
      },
      {
        date: "2026-04-07",
        attendance: null,
        status_entries: [
          {
            status: "sick",
            label: "Krank",
            reported_at: "2026-04-07T07:30:00Z",
            cleared_at: "2026-04-07T16:00:00Z",
          },
        ],
        slots: null,
        room_detail_available: true,
        visits: [],
      },
    ],
    range: {
      start: "2026-03-07T00:00:00Z",
      end: "2026-04-06T23:59:59Z",
    },
    clamped: false,
    caps: { attendance_days: 30, room_detail_days: 7 },
  };

  it("maps top-level fields correctly", () => {
    const result = mapAttendanceHistoryResponse(raw);
    expect(result.studentId).toBe("42");
    expect(result.clamped).toBe(false);
    expect(result.caps.attendanceDays).toBe(30);
    expect(result.caps.roomDetailDays).toBe(7);
    expect(result.range.start).toBeInstanceOf(Date);
    expect(result.range.end).toBeInstanceOf(Date);
  });

  it("maps days with attendance and visits", () => {
    const result = mapAttendanceHistoryResponse(raw);
    expect(result.days).toHaveLength(3);

    const day1 = result.days[0]!;
    expect(day1.date).toBe("2026-04-06");
    expect(day1.roomDetailAvailable).toBe(true);
    expect(day1.attendance).not.toBeNull();
    expect(day1.attendance!.checkInTime).toBeInstanceOf(Date);
    expect(day1.attendance!.checkOutTime).toBeInstanceOf(Date);
    expect(day1.attendance!.durationMinutes).toBe(450);
    expect(day1.attendance!.checkedInBy).toBe("11");
    expect(day1.attendance!.deviceId).toBe("3");

    expect(day1.attendance!.sessions).toHaveLength(1);
    expect(day1.attendance!.sessions[0]!.checkInTime).toBeInstanceOf(Date);
    expect(day1.attendance!.sessions[0]!.checkOutTime).toBeInstanceOf(Date);
    expect(day1.attendance!.sessions[0]!.durationMinutes).toBe(60);

    expect(day1.slots).toHaveLength(1);
    expect(day1.slots[0]).toMatchObject({
      instanceId: "9223372036854775807",
      instanceStatus: "completed",
      title: "Morgenbetreuung",
      status: "present",
      substatus: null,
      isUnplanned: false,
    });
    expect(day1.slots[0]!.checkedInAt).toBeInstanceOf(Date);
    expect(day1.slots[0]!.checkedOutAt).toBeInstanceOf(Date);

    expect(day1.visits).toHaveLength(1);
    expect(day1.visits[0]!.roomName).toBe("Gruppenraum A");
    expect(day1.visits[0]!.roomId).toBe("5");
    expect(day1.visits[0]!.entryTime).toBeInstanceOf(Date);
    expect(day1.visits[0]!.exitTime).toBeInstanceOf(Date);
    expect(day1.visits[0]!.durationMinutes).toBe(140);
  });

  it("maps days without room detail and null visits", () => {
    const result = mapAttendanceHistoryResponse(raw);
    const day2 = result.days[1]!;
    expect(day2.roomDetailAvailable).toBe(false);
    expect(day2.visits).toEqual([]);
    expect(day2.attendance!.checkOutTime).toBeNull();
    expect(day2.attendance!.durationMinutes).toBeNull();
    // Without the actors (older answer), nobody is named.
    expect(day2.attendance!.checkedInActor).toBeNull();
    expect(day2.attendance!.checkedOutActor).toBeNull();
  });

  it("maps who recorded the arrival and the pickup (#4761)", () => {
    const day1 = mapAttendanceHistoryResponse(raw).days[0]!;
    expect(day1.attendance!.checkedInActor).toEqual({
      kind: "staff",
      name: "Anna Muster",
    });
    expect(day1.attendance!.checkedOutActor).toEqual({ kind: "device" });
  });

  it("maps status-only days", () => {
    const result = mapAttendanceHistoryResponse(raw);
    const day = result.days[2]!;
    expect(day.attendance).toBeNull();
    expect(day.statusEntries).toHaveLength(1);
    expect(day.statusEntries[0]!.status).toBe("sick");
    expect(day.statusEntries[0]!.label).toBe("Krank");
    expect(day.statusEntries[0]!.reportedAt).toBeInstanceOf(Date);
    expect(day.statusEntries[0]!.clearedAt).toBeInstanceOf(Date);
  });
});

describe("formatDuration", () => {
  it("returns dash for null", () => {
    expect(formatDuration(null)).toBe("–");
  });

  it("formats minutes only", () => {
    expect(formatDuration(45)).toBe("45 min");
  });

  it("formats hours only", () => {
    expect(formatDuration(120)).toBe("2 h");
  });

  it("formats hours + minutes", () => {
    expect(formatDuration(150)).toBe("2 h 30 min");
  });

  it("formats zero", () => {
    expect(formatDuration(0)).toBe("0 min");
  });
});

describe("formatDate", () => {
  it("formats a date key to German locale", () => {
    const result = formatDate("2026-04-06");
    // Should contain the German day name and month
    expect(result).toContain("2026");
    expect(result).toContain("April");
  });
});

describe("formatTime", () => {
  it("formats a Date to HH:MM", () => {
    const d = new Date("2026-04-06T08:15:00Z");
    const result = formatTime(d);
    // Should be "HH:MM" format (exact value depends on test runner TZ)
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe("formatAttendanceSlotStatus", () => {
  it.each([
    ["present", null, "Anwesend"],
    ["absent", "sick", "Krank"],
    ["absent", "excused", "Entschuldigt"],
    ["absent", "field_trip", "Klassenfahrt"],
    ["absent", null, "Abwesend"],
    ["expected", null, "Erwartet"],
  ] as const)("formats %s/%s", (status, substatus, expected) => {
    expect(formatAttendanceSlotStatus(status, substatus)).toBe(expected);
  });

  // The contract sends the status as an open string (#2353): a value this
  // build does not know shows the empty glyph instead of „Erwartet“.
  it("shows the empty glyph for an unknown status", () => {
    const mapped = mapAttendanceHistoryResponse({
      student_id: "42",
      days: [
        {
          date: "2026-04-07",
          attendance: null,
          status_entries: null,
          room_detail_available: true,
          visits: null,
          slots: [
            {
              instance_id: "7",
              instance_status: "archived",
              title: "Fußball",
              start_time: "14:00",
              end_time: "15:00",
              status: "late",
              is_unplanned: false,
            },
          ],
        },
      ],
      range: { start: "2026-04-01T00:00:00Z", end: "2026-04-30T00:00:00Z" },
      clamped: false,
      caps: { attendance_days: 90, room_detail_days: 30 },
    });
    const slot = mapped.days[0]!.slots[0]!;
    expect(slot.status).toBeUndefined();
    expect(slot.instanceStatus).toBeNull();
    expect(formatAttendanceSlotStatus(slot.status, slot.substatus)).toBe("–");
  });
});

describe("mapAttendanceHistoryResponse checkout note (#3324)", () => {
  it("joins the early-checkout notes of the day's stays", () => {
    const mapped = mapAttendanceHistoryResponse({
      student_id: "42",
      days: [
        {
          date: "2026-04-07",
          attendance: {
            check_in_time: "2026-04-07T06:00:00Z",
            check_out_time: "2026-04-07T14:00:00Z",
            checked_in_by: "11",
            device_id: "3",
            sessions: [
              {
                check_in_time: "2026-04-07T06:00:00Z",
                check_out_time: "2026-04-07T09:00:00Z",
                check_out_note: "Arzttermin",
              },
              {
                check_in_time: "2026-04-07T11:00:00Z",
                check_out_time: "2026-04-07T14:00:00Z",
              },
            ],
          },
          status_entries: null,
          slots: null,
          room_detail_available: false,
          visits: [],
        },
        {
          date: "2026-04-08",
          attendance: {
            check_in_time: "2026-04-08T06:00:00Z",
            check_out_time: "2026-04-08T14:00:00Z",
            checked_in_by: "11",
            device_id: "3",
            sessions: null,
          },
          status_entries: null,
          slots: null,
          room_detail_available: false,
          visits: [],
        },
      ],
      range: { start: "2026-04-01T00:00:00Z", end: "2026-04-08T00:00:00Z" },
      clamped: false,
      caps: { attendance_days: 30, room_detail_days: 7 },
    });

    const [noted, plain] = mapped.days;
    expect(noted?.attendance?.checkOutNote).toBe("Arzttermin");
    expect(noted?.attendance?.sessions[0]?.checkOutNote).toBe("Arzttermin");
    expect(noted?.attendance?.sessions[1]?.checkOutNote).toBeNull();
    expect(plain?.attendance?.checkOutNote).toBeNull();
  });
});

describe("mapAttendanceHistoryResponse class checkout (#5656)", () => {
  it("lists only the stays that ended with going to class", () => {
    const mapped = mapAttendanceHistoryResponse({
      student_id: "42",
      days: [
        {
          date: "2026-04-07",
          attendance: {
            check_in_time: "2026-04-07T06:00:00Z",
            check_out_time: "2026-04-07T14:00:00Z",
            checked_in_by: "11",
            device_id: "3",
            sessions: [
              {
                check_in_time: "2026-04-07T06:00:00Z",
                check_out_time: "2026-04-07T07:00:00Z",
                check_out_reason: "class",
              },
              {
                check_in_time: "2026-04-07T11:00:00Z",
                check_out_time: "2026-04-07T14:00:00Z",
              },
            ],
          },
          status_entries: null,
          slots: null,
          room_detail_available: false,
          visits: [],
        },
      ],
      range: { start: "2026-04-01T00:00:00Z", end: "2026-04-08T00:00:00Z" },
      clamped: false,
      caps: { attendance_days: 30, room_detail_days: 7 },
    });

    expect(mapped.days[0]?.attendance?.leftForClassAt).toEqual([
      new Date("2026-04-07T07:00:00Z"),
    ]);
  });
});
