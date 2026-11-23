import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoist mocks so vi.mock() below can reference them
const { mockBffJson } = vi.hoisted(() => ({
  mockBffJson: vi.fn(),
}));

vi.mock("~/lib/bff-fetch", () => ({
  bffJson: mockBffJson,
}));

// Import after mocks are set up
import {
  fetchBookingAuthorityImpact,
  fetchOperatorSettingsSchema,
  setOperatorSettingValue,
  resetOperatorSettingValue,
  revealOperatorSettingValue,
} from "./operator-settings-api";
import { ApiError } from "../api-error";

const SCHOOL_ID = "42";

describe("operator-settings-api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("fetchBookingAuthorityImpact", () => {
    it("loads the school-scoped impact preview", async () => {
      const wire = {
        reference_date: "2026-08-25",
        blocking_children: [],
        planned_completions: [],
      };
      mockBffJson.mockResolvedValue(wire);

      await expect(fetchBookingAuthorityImpact(SCHOOL_ID)).resolves.toEqual({
        referenceDate: "2026-08-25",
        blockingChildren: [],
        plannedCompletions: [],
      });
      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "GET /operator/schools/{id}/settings/booking-authority-impact",
        { params: { id: SCHOOL_ID } },
      );
    });
  });

  describe("fetchOperatorSettingsSchema", () => {
    it("calls the school-scoped schema endpoint and returns schema", async () => {
      const schema = {
        tabs: [{ key: "operations", label: "Ops", categories: [] }],
      };
      mockBffJson.mockResolvedValue(schema);

      const result = await fetchOperatorSettingsSchema(SCHOOL_ID);

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "GET /operator/schools/{id}/settings/schema",
        { params: { id: SCHOOL_ID } },
      );
      expect(result).toEqual(schema);
    });

    // #2519: an unknown school is an error the page shows, not "no schema".
    it("rethrows a 404", async () => {
      const error = new ApiError("not found", 404);
      mockBffJson.mockRejectedValue(error);

      await expect(fetchOperatorSettingsSchema(SCHOOL_ID)).rejects.toBe(error);
    });

    it("rethrows on non-404 error", async () => {
      mockBffJson.mockRejectedValue(new ApiError("server error", 500));

      await expect(fetchOperatorSettingsSchema(SCHOOL_ID)).rejects.toThrow(
        "server error",
      );
    });

    it("rethrows on generic Error", async () => {
      mockBffJson.mockRejectedValue(new Error("network down"));

      await expect(fetchOperatorSettingsSchema(SCHOOL_ID)).rejects.toThrow(
        "network down",
      );
    });

    it("rethrows on non-Error rejection (e.g. string)", async () => {
      mockBffJson.mockRejectedValue("raw-string-error");

      await expect(fetchOperatorSettingsSchema(SCHOOL_ID)).rejects.toBe(
        "raw-string-error",
      );
    });
  });

  describe("setOperatorSettingValue", () => {
    it("resolves on success", async () => {
      mockBffJson.mockResolvedValue(undefined);

      await expect(
        setOperatorSettingValue(
          SCHOOL_ID,
          "operations.session_end_time",
          "18:30",
        ),
      ).resolves.toBeUndefined();
      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "PUT /operator/schools/{id}/settings/values/{key}",
        {
          params: { id: SCHOOL_ID, key: "operations.session_end_time" },
          body: { value: "18:30" },
        },
      );
    });

    // The field shows the error on the shared path (#2519); the client no
    // longer turns the backend sentence into its own text.
    it.each([
      ["validation", new ApiError("below minimum 5", 400)],
      ["not found", new ApiError("not found", 404)],
      ["conflict", new ApiError("presence mode conflict", 409)],
      ["server", new ApiError("boom", 500)],
      ["network", new Error("fetch failed")],
    ])("rethrows the %s error unchanged", async (_, error) => {
      mockBffJson.mockRejectedValue(error);

      await expect(
        setOperatorSettingValue(SCHOOL_ID, "foo.bar", "x"),
      ).rejects.toBe(error);
    });
  });

  describe("resetOperatorSettingValue", () => {
    it("resolves on success", async () => {
      mockBffJson.mockResolvedValue(undefined);

      await expect(
        resetOperatorSettingValue(SCHOOL_ID, "foo.bar"),
      ).resolves.toBeUndefined();
      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "DELETE /operator/schools/{id}/settings/values/{key}",
        { params: { id: SCHOOL_ID, key: "foo.bar" } },
      );
    });

    it.each([
      ["server", new ApiError("boom", 500)],
      ["network", new Error("network down")],
    ])("rethrows the %s error unchanged", async (_, error) => {
      mockBffJson.mockRejectedValue(error);

      await expect(
        resetOperatorSettingValue(SCHOOL_ID, "foo.bar"),
      ).rejects.toBe(error);
    });
  });

  describe("revealOperatorSettingValue", () => {
    it("returns string value on success", async () => {
      mockBffJson.mockResolvedValue({ value: "1234" });

      const result = await revealOperatorSettingValue(
        SCHOOL_ID,
        "security.ogs_device_pin",
      );
      expect(result).toBe("1234");
      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "GET /operator/schools/{id}/settings/values/{key}/reveal",
        { params: { id: SCHOOL_ID, key: "security.ogs_device_pin" } },
      );
    });

    it("returns null when value is not a string", async () => {
      mockBffJson.mockResolvedValue({ value: 1234 });

      const result = await revealOperatorSettingValue(SCHOOL_ID, "foo.bar");
      expect(result).toBeNull();
    });

    // A failed reveal used to look like an empty value; the field now shows
    // it (#2519).
    it("rethrows a failed request", async () => {
      const error = new ApiError("not found", 404);
      mockBffJson.mockRejectedValue(error);

      await expect(
        revealOperatorSettingValue(SCHOOL_ID, "foo.bar"),
      ).rejects.toBe(error);
    });
  });
});
