import { describe, expect, it } from "vitest";

import { readDeviceSlots } from "./device-slots";

describe("readDeviceSlots", () => {
  it("maps the contract's answer of the catalog proxy", () => {
    expect(readDeviceSlots({ device_slots: 3, occupied: 2, free: 1 })).toEqual({
      booked: 3,
      occupied: 2,
      free: 1,
    });
  });

  it("keeps an unlimited school unlimited", () => {
    expect(
      readDeviceSlots({ device_slots: null, occupied: 4, free: null }),
    ).toEqual({ booked: null, occupied: 4, free: null });
  });

  it("reads the mapped shape the temporary route file still answers", () => {
    expect(readDeviceSlots({ booked: 5, occupied: 1, free: 4 })).toEqual({
      booked: 5,
      occupied: 1,
      free: 4,
    });
  });
});
