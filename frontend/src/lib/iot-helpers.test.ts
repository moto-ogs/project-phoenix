import { describe, it, expect } from "vitest";
import {
  mapDeviceResponse,
  prepareDeviceForBackend,
  getDeviceTypeDisplayName,
  getDeviceStatusDisplayName,
  getDeviceStatusColor,
  formatLastSeen,
  getDeviceTypeEmoji,
  generateDefaultDeviceName,
  type Device,
} from "./iot-helpers";
import type {
  DeviceCreationResponse,
  DeviceResponse,
} from "./contract/iot.generated";
import { LOCATION_COLORS } from "./location-helper";

describe("iot-helpers", () => {
  describe("mapDeviceResponse", () => {
    it("maps the created device of the contract with its one-time key", () => {
      const backendDevice: DeviceCreationResponse = {
        id: "123",
        device_id: "RFID-001",
        device_type: "terminal",
        name: "Main Reader",
        status: "active",
        last_seen: "2024-01-15T10:30:00Z",
        registered_by_id: "456",
        is_online: true,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-15T10:30:00Z",
        api_key: "test-api-key",
      };

      const result = mapDeviceResponse(backendDevice);

      expect(result).toEqual({
        id: "123",
        device_id: "RFID-001",
        device_type: "terminal",
        name: "Main Reader",
        status: "active",
        last_seen: "2024-01-15T10:30:00Z",
        registered_by_id: "456",
        is_online: true,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-15T10:30:00Z",
        api_key: "test-api-key",
      });
    });

    it("should handle device without optional fields", () => {
      const backendDevice: DeviceResponse = {
        id: "123",
        device_id: "RFID-001",
        device_type: "terminal",
        status: "active",
        is_online: false,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-15T10:30:00Z",
      };

      const result = mapDeviceResponse(backendDevice);

      expect(result.name).toBeUndefined();
      expect(result.last_seen).toBeUndefined();
      expect(result.registered_by_id).toBeUndefined();
      expect(result.api_key).toBeUndefined();
      expect(result.is_online).toBe(false);
    });

    it("should throw error for null input", () => {
      expect(() =>
        mapDeviceResponse(null as unknown as DeviceResponse),
      ).toThrow("Invalid device data provided to mapper");
    });

    it("should throw error for undefined input", () => {
      expect(() =>
        mapDeviceResponse(undefined as unknown as DeviceResponse),
      ).toThrow("Invalid device data provided to mapper");
    });

    it("should throw error for non-object input", () => {
      expect(() =>
        mapDeviceResponse("invalid" as unknown as DeviceResponse),
      ).toThrow("Invalid device data provided to mapper");
    });

    it("should throw error when id is missing", () => {
      const backendDevice = {
        device_id: "RFID-001",
        device_type: "terminal",
        status: "active",
        is_online: true,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-15T10:30:00Z",
      } as unknown as DeviceResponse;

      expect(() => mapDeviceResponse(backendDevice)).toThrow(
        "Required device fields are missing",
      );
    });

    it("should throw error when device_id is missing", () => {
      const backendDevice = {
        id: 123,
        device_type: "terminal",
        status: "active",
        is_online: true,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-15T10:30:00Z",
      } as unknown as DeviceResponse;

      expect(() => mapDeviceResponse(backendDevice)).toThrow(
        "Required device fields are missing",
      );
    });

    it("should throw error when device_type is missing", () => {
      const backendDevice = {
        id: 123,
        device_id: "RFID-001",
        status: "active",
        is_online: true,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-15T10:30:00Z",
      } as unknown as DeviceResponse;

      expect(() => mapDeviceResponse(backendDevice)).toThrow(
        "Required device fields are missing",
      );
    });

    it("should handle is_online as false when undefined", () => {
      const backendDevice = {
        id: "123",
        device_id: "RFID-001",
        device_type: "terminal",
        status: "active",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-15T10:30:00Z",
      } as DeviceResponse;

      const result = mapDeviceResponse(backendDevice);
      expect(result.is_online).toBe(false);
    });
  });

  describe("prepareDeviceForBackend", () => {
    it("never sends the status, so a save cannot undo a block (#2317)", () => {
      const device: Partial<Device> = {
        device_id: "RFID-001",
        device_type: "terminal",
        name: "Main Reader",
        status: "active",
        registered_by_id: "456",
      };

      const result = prepareDeviceForBackend(device);

      expect(result).toEqual({
        device_id: "RFID-001",
        device_type: "terminal",
        name: "Main Reader",
        registered_by_id: "456",
      });
    });

    it("should handle device without registered_by_id", () => {
      const device: Partial<Device> = {
        device_id: "RFID-001",
        device_type: "terminal",
        name: "Main Reader",
        status: "active",
      };

      const result = prepareDeviceForBackend(device);

      expect(result).toEqual({
        device_id: "RFID-001",
        device_type: "terminal",
        name: "Main Reader",
        registered_by_id: undefined,
      });
    });

    it("should handle device with minimal fields", () => {
      const device: Partial<Device> = {
        device_id: "RFID-001",
        device_type: "terminal",
      };

      const result = prepareDeviceForBackend(device);

      expect(result).toEqual({
        device_id: "RFID-001",
        device_type: "terminal",
        name: undefined,
        registered_by_id: undefined,
      });
    });
  });

  describe("getDeviceTypeDisplayName", () => {
    it("should return German name for terminal", () => {
      expect(getDeviceTypeDisplayName("terminal")).toBe("Terminal");
    });

    it("should return German name for info_point", () => {
      expect(getDeviceTypeDisplayName("info_point")).toBe("Info-Point");
    });

    it("should return original type for unknown device type", () => {
      expect(getDeviceTypeDisplayName("unknown_type")).toBe("unknown_type");
    });
  });

  describe("getDeviceStatusDisplayName", () => {
    it("should return German name for active status", () => {
      expect(getDeviceStatusDisplayName("active")).toBe("Aktiv");
    });

    it("names an inactive device blocked (#2317)", () => {
      expect(getDeviceStatusDisplayName("inactive")).toBe("Gesperrt");
    });

    it("should return German name for maintenance status", () => {
      expect(getDeviceStatusDisplayName("maintenance")).toBe("Wartung");
    });

    it("should return German name for offline status", () => {
      expect(getDeviceStatusDisplayName("offline")).toBe("Offline");
    });

    it("should return original status for unknown status", () => {
      expect(getDeviceStatusDisplayName("unknown_status")).toBe(
        "unknown_status",
      );
    });

    it("should return original status for inherited status-map keys", () => {
      expect(getDeviceStatusDisplayName("constructor")).toBe("constructor");
    });
  });

  describe("getDeviceStatusColor", () => {
    it("should return the green colour for active status", () => {
      expect(getDeviceStatusColor("active")).toBe(LOCATION_COLORS.GROUP_ROOM);
    });

    it("should return the red colour for a blocked device", () => {
      expect(getDeviceStatusColor("inactive")).toBe(LOCATION_COLORS.DANGER);
    });

    it("should return the amber colour for maintenance status", () => {
      expect(getDeviceStatusColor("maintenance")).toBe(LOCATION_COLORS.WARNING);
    });

    it("keeps offline apart from blocked in the neutral colour", () => {
      expect(getDeviceStatusColor("offline")).toBe(LOCATION_COLORS.HOME);
    });

    it("should return the neutral colour for unknown status", () => {
      expect(getDeviceStatusColor("unknown")).toBe(LOCATION_COLORS.HOME);
    });

    it("should return the neutral colour for inherited status-map keys", () => {
      expect(getDeviceStatusColor("constructor")).toBe(LOCATION_COLORS.HOME);
    });
  });

  describe("formatLastSeen", () => {
    it("should return 'Nie' for undefined", () => {
      expect(formatLastSeen(undefined)).toBe("Nie");
    });

    it("should format valid date string", () => {
      const result = formatLastSeen("2024-01-15T10:30:00Z");
      // Result format: dd.MM.yyyy, HH:mm (German locale)
      expect(result).toMatch(/\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}/);
    });

    it("should handle date at midnight", () => {
      const result = formatLastSeen("2024-01-15T00:00:00Z");
      expect(result).toMatch(/\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}/);
    });
  });

  describe("getDeviceTypeEmoji", () => {
    it("should return emoji for terminal", () => {
      expect(getDeviceTypeEmoji("terminal")).toBe("📡");
    });

    it("should return emoji for info_point", () => {
      expect(getDeviceTypeEmoji("info_point")).toBe("ℹ️");
    });

    it("should return wrench emoji for unknown type", () => {
      expect(getDeviceTypeEmoji("unknown")).toBe("🔧");
    });
  });

  describe("generateDefaultDeviceName", () => {
    it("should generate name for terminal", () => {
      expect(generateDefaultDeviceName("terminal", "001")).toBe("Terminal 001");
    });

    it("should generate name for info_point", () => {
      expect(generateDefaultDeviceName("info_point", "002")).toBe(
        "Info-Point 002",
      );
    });

    it("should generate default name for unknown type", () => {
      expect(generateDefaultDeviceName("unknown", "007")).toBe("Gerät 007");
    });
  });
});
