import { describe, expect, it } from "vitest";
import { buildActivityFormSections } from "./activity-form-sections";
import type { Activity } from "@/lib/activity-helpers";

const baseActivity: Activity = {
  id: "1",
  name: "Mathe AG",
  max_participant: 12,
  is_open_ags: false,
  supervisor_id: "1",
  ag_category_id: "1",
  category_name: "Sport",
  created_at: new Date(),
  updated_at: new Date(),
};

describe("buildActivityFormSections", () => {
  it("leaves the name field editable for regular activities", () => {
    const sections = buildActivityFormSections(baseActivity);
    const nameField = sections
      .flatMap((section) => section.fields)
      .find((field) => field.name === "name");

    expect(nameField?.disabled).toBeFalsy();
  });

  it("disables the name field for system activities", () => {
    const sections = buildActivityFormSections({
      ...baseActivity,
      name: "Schulhof Freispiel",
    });
    const nameField = sections
      .flatMap((section) => section.fields)
      .find((field) => field.name === "name");

    expect(nameField?.disabled).toBe(true);
    expect(nameField?.helperText).toBe(
      "Systemaktivität: Name kann nicht geändert werden",
    );
  });

  it("shows the category of a system activity locked instead of an empty choice", () => {
    const sections = buildActivityFormSections({
      ...baseActivity,
      name: "WC",
      ag_category_id: "7",
      category_name: "WC",
    });
    const categoryField = sections
      .flatMap((section) => section.fields)
      .find((field) => field.name === "ag_category_id");

    expect(categoryField?.disabled).toBe(true);
    expect(categoryField?.helperText).toBe(
      "Systemaktivität: Kategorie kann nicht geändert werden",
    );
    expect(categoryField?.options).toEqual([{ value: "7", label: "WC" }]);
  });

  it("keeps the category choice of regular activities", () => {
    const sections = buildActivityFormSections(baseActivity);
    const categoryField = sections
      .flatMap((section) => section.fields)
      .find((field) => field.name === "ag_category_id");

    expect(categoryField?.disabled).toBeFalsy();
    expect(typeof categoryField?.options).toBe("function");
  });
});
