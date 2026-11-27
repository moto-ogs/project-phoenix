/**
 * Tests for Devices Configuration
 * Tests device config structure and helper functions
 */
import { describe, it, expect } from "vitest";
import { devicesConfig } from "./devices.config";
import type { Device } from "@/lib/iot-helpers";

describe("devicesConfig", () => {
  it("exports a valid entity config", () => {
    expect(devicesConfig).toBeDefined();
    expect(devicesConfig.name).toEqual({
      singular: "Gerät",
      plural: "Geräte",
    });
  });

  it("has form sections configured", () => {
    expect(devicesConfig.form.sections).toHaveLength(1);
    expect(devicesConfig.form.sections[0]?.title).toBe("Geräteinformationen");
  });

  it("has required form fields", () => {
    const fields = devicesConfig.form.sections[0]?.fields ?? [];
    const fieldNames = fields.map((f) => f.name);

    expect(fieldNames).toContain("device_id");
    expect(fieldNames).toContain("device_type");
    expect(fieldNames).toContain("name");
  });

  it("has default values", () => {
    expect(devicesConfig.form.defaultValues?.device_type).toBe("terminal");
  });

  it("transforms data before submit with auto-generated name", () => {
    const data: Partial<Device> = {
      device_id: "RFID-001",
      device_type: "terminal",
      status: "active",
    };

    const transformed = devicesConfig.form.transformBeforeSubmit?.(data);
    expect(transformed?.name).toBeDefined();
  });

  it("preserves provided name in transform", () => {
    const data: Partial<Device> = {
      device_id: "RFID-001",
      name: "Custom Name",
      device_type: "terminal",
      status: "active",
    };

    const transformed = devicesConfig.form.transformBeforeSubmit?.(data);
    expect(transformed?.name).toBe("Custom Name");
  });
});
