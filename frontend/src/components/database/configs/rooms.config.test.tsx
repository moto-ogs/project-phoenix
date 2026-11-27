/**
 * Tests for Rooms Configuration
 * Tests room config structure and validation
 */
import { describe, it, expect } from "vitest";
import { roomsConfig } from "./rooms.config";
import type { Room } from "@/lib/room-helpers";
import { formValuesFor } from "~/components/database/database-form";
import {
  configToFormSection,
  type EntityFormConfig,
} from "~/lib/database/types";

describe("roomsConfig", () => {
  it("exports a valid entity config", () => {
    expect(roomsConfig).toBeDefined();
    expect(roomsConfig.name).toEqual({
      singular: "Raum",
      plural: "Räume",
    });
  });

  it("has form sections configured", () => {
    expect(roomsConfig.form.sections).toHaveLength(1);
    expect(roomsConfig.form.sections[0]?.title).toBe("Raumdetails");
  });

  it("has required form fields", () => {
    const fields = roomsConfig.form.sections[0]?.fields ?? [];
    const fieldNames = fields.map((f) => f.name);

    expect(fieldNames).toContain("name");
    expect(fieldNames).toContain("category");
    expect(fieldNames).toContain("building");
    expect(fieldNames).toContain("floor");
    expect(fieldNames).toContain("capacity");
    // Color picker is part of the form (Issue #1324) so admins can override
    // the default OTHER_ROOM blue per room.
    expect(fieldNames).toContain("color");
  });

  it("configures room capacity as an optional positive number", () => {
    const fields = roomsConfig.form.sections[0]?.fields ?? [];
    const capacityField = fields.find((field) => field.name === "capacity");

    expect(capacityField).toMatchObject({
      type: "number",
      required: false,
      min: 1,
      placeholder: "Keine Begrenzung",
    });
    expect(capacityField?.helperText).toContain("gleichzeitig eingecheckt");
  });

  it("does not force a default color (Issue #1324)", () => {
    // The previous "#4F46E5" default forced every saved room into the same
    // hue, defeating the whole point of the color picker. New rooms now
    // start with no color and the badge falls back to OTHER_ROOM blue until
    // an admin picks one.
    const { form }: EntityFormConfig<Room> = roomsConfig;
    const draft = formValuesFor(
      form.sections.map(configToFormSection),
      form.defaultValues,
    );
    expect(draft).toMatchObject({ color: "" });
  });

  it("preserves color through transformBeforeSubmit", () => {
    // Whatever the picker emits — a hex, null, or undefined — must reach
    // the backend untouched. Forcing a default here would clobber the
    // user's "Zurücksetzen" action and re-introduce the all-blue bug.
    const explicit = roomsConfig.form.transformBeforeSubmit?.({
      name: "Room 101",
      color: "#A3D977",
    } as Partial<Room>);
    expect(explicit?.color).toBe("#A3D977");

    const cleared = roomsConfig.form.transformBeforeSubmit?.({
      name: "Room 101",
      color: null,
    } as unknown as Partial<Room>);
    expect(cleared?.color).toBeNull();

    const omitted = roomsConfig.form.transformBeforeSubmit?.({
      name: "Room 101",
      color: undefined,
    } as unknown as Partial<Room>);
    expect(omitted?.color).toBeUndefined();
  });

  it("transforms name and floor before submit", () => {
    const data = {
      name: "  Room 101  ",
      floor: "2",
    } as unknown as Partial<Room>;

    const transformed = roomsConfig.form.transformBeforeSubmit?.(data);
    expect(transformed?.name).toBe("Room 101");
    expect(transformed?.floor).toBe(2);
  });

  it("validates floor field", () => {
    const fields = roomsConfig.form.sections[0]?.fields ?? [];
    const floorField = fields.find((f) => f.name === "floor");

    const validation = floorField?.validation?.("invalid");
    expect(validation).toBe("Bitte gib eine gültige Etage ein");
  });

  it("accepts valid floor value", () => {
    const fields = roomsConfig.form.sections[0]?.fields ?? [];
    const floorField = fields.find((f) => f.name === "floor");

    const validation = floorField?.validation?.("2");
    expect(validation).toBeNull();
  });
});
