import { describe, expect, it } from "vitest";
import { validateDeviceSlotsDraft } from "./device-slots";

describe("validateDeviceSlotsDraft", () => {
  it("accepts a whole number from the occupied places up to the maximum", () => {
    expect(validateDeviceSlotsDraft("4", 4)).toEqual({ ok: true, slots: 4 });
    expect(validateDeviceSlotsDraft(" 1000 ", 0)).toEqual({
      ok: true,
      slots: 1000,
    });
  });

  it("rejects a number below the registered devices with the reason", () => {
    const result = validateDeviceSlotsDraft("2", 3);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("3 registrierte Geräte");
  });

  it.each(["", "-1", "1.5", "abc", "1001"])("rejects %j", (value) => {
    expect(validateDeviceSlotsDraft(value, 0).ok).toBe(false);
  });
});

describe("validateDeviceSlotsDraft wording", () => {
  it("speaks of one registered device in the singular", () => {
    const result = validateDeviceSlotsDraft("0", 1);
    expect(!result.ok && result.error).toContain("1 registriertes Gerät.");
  });
});
