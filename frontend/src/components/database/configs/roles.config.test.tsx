/**
 * Tests for Roles Configuration
 * Tests role config structure and response mapping
 */
import { describe, it, expect } from "vitest";
import {
  roleEditSections,
  rolesConfig,
  toCreateRoleRequest,
  toUpdateRoleRequest,
} from "./roles.config";

describe("rolesConfig", () => {
  it("exports a valid entity config", () => {
    expect(rolesConfig).toBeDefined();
    expect(rolesConfig.name).toEqual({
      singular: "Rolle",
      plural: "Rollen",
    });
  });

  it("has form sections configured", () => {
    expect(rolesConfig.form.sections).toHaveLength(1);
    expect(rolesConfig.form.sections[0]?.title).toBe("Rolleninformationen");
  });

  it("creates a role from a template and edits its tier (#4574)", () => {
    const createFields = rolesConfig.form.sections[0]?.fields ?? [];
    expect(createFields.map((f) => f.name)).toEqual([
      "name",
      "description",
      "template",
    ]);
    expect(createFields.find((f) => f.name === "template")).toMatchObject({
      label: "Vorlage",
      required: true,
      options: [
        { value: "user", label: "Wie Betreuung" },
        { value: "admin", label: "Wie Verwaltung" },
        { value: "lehrkraft", label: "Wie Lehrkraft" },
      ],
    });

    const editFields = roleEditSections[0]?.fields ?? [];
    expect(editFields.map((f) => f.name)).toEqual([
      "name",
      "description",
      "baseRole",
    ]);
    expect(editFields.find((f) => f.name === "baseRole")?.label).toBe(
      "Gilt als",
    );
  });

  it("does not offer Eltern under „Gilt als“ (#4574)", () => {
    const options = roleEditSections[0]?.fields.find(
      (f) => f.name === "baseRole",
    )?.options;

    expect(options).toEqual([
      { value: "admin", label: "Verwaltung" },
      { value: "user", label: "Betreuung" },
    ]);
  });

  it("sends the template instead of base_role when creating", () => {
    expect(
      toCreateRoleRequest({
        name: "Springkraft",
        description: "",
        template: "user",
      }),
    ).toEqual({ name: "Springkraft", description: "", template: "user" });
    expect(
      toUpdateRoleRequest(
        { name: "Springkraft", description: "", baseRole: "admin" },
        { version: "v1" },
      ),
    ).toEqual({
      name: "Springkraft",
      description: "",
      base_role: "admin",
      expected_version: "v1",
    });
  });
});
