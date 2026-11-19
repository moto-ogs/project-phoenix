import { describe, expect, it } from "vitest";

import { mapDeviceSlots } from "./device-slots";

describe("mapDeviceSlots", () => {
  it("maps the contract's answer of the catalog proxy", () => {
    expect(mapDeviceSlots({ device_slots: 3, occupied: 2, free: 1 })).toEqual({
      booked: 3,
      occupied: 2,
      free: 1,
    });
  });

  it("keeps an unlimited school unlimited", () => {
    expect(
      mapDeviceSlots({ device_slots: null, occupied: 4, free: null }),
    ).toEqual({ booked: null, occupied: 4, free: null });
  });
});
