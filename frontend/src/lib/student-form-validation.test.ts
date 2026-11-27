import { describe, it, expect } from "vitest";
import { validateStudentForm } from "./student-form-validation";
import type { Student } from "~/lib/student-helpers";

const requiredFields = {
  first_name: "Max",
  second_name: "Mustermann",
  school_class: "5a",
};

describe("validateStudentForm retention days", () => {
  const RETENTION_HINT = "Bitte gib eine Zahl von 1 bis 31 ein.";

  it.each([null, undefined, 0, 32])("marks %s as outside 1 to 31", (days) => {
    expect(
      // The number field hands null for an emptied input.
      validateStudentForm({
        ...requiredFields,
        data_retention_days: days,
      } as unknown as Partial<Student>),
    ).toMatchObject({ data_retention_days: RETENTION_HINT });
  });

  it.each([1, 15, 31])("accepts %i", (days) => {
    expect(
      validateStudentForm({ ...requiredFields, data_retention_days: days }),
    ).toEqual({});
  });

  // A form that leaves the consent pair out writes none (the school default
  // applies), so there is nothing to check.
  it("checks nothing when the form carries no retention", () => {
    expect(validateStudentForm(requiredFields)).toEqual({});
  });
});

describe("validateStudentForm", () => {
  it("returns empty object when all required fields are valid", () => {
    const formData: Partial<Student> = {
      first_name: "Max",
      second_name: "Mustermann",
      school_class: "5a",
      data_retention_days: 30,
    };

    const errors = validateStudentForm(formData);

    expect(errors).toEqual({});
  });

  it("requires a companion note when an accompanied day is selected", () => {
    const errors = validateStudentForm({
      ...requiredFields,
      data_retention_days: 30,
      allowed_departure_modes: { mon: ["accompanied"] },
      departure_companion_note: "   ",
    });

    expect(errors.departure_companion_note).toBe(
      "Bitte gib an, mit wem das Kind nach Hause geht.",
    );
  });

  it("accepts a filled companion note for an accompanied day", () => {
    const errors = validateStudentForm({
      ...requiredFields,
      data_retention_days: 30,
      allowed_departure_modes: { mon: ["accompanied"] },
      departure_companion_note: "Geschwisterkind Lena",
    });

    expect(errors.departure_companion_note).toBeUndefined();
  });

  it("does not require a companion note without an accompanied day", () => {
    const errors = validateStudentForm({
      ...requiredFields,
      data_retention_days: 30,
      allowed_departure_modes: { mon: ["bus"] },
    });

    expect(errors.departure_companion_note).toBeUndefined();
  });

  it("validates first name when required", () => {
    const formData: Partial<Student> = {
      first_name: "",
      second_name: "Mustermann",
      school_class: "5a",
      data_retention_days: 30,
    };

    const errors = validateStudentForm(formData);

    expect(errors.first_name).toBe("Bitte gib den Vornamen ein.");
  });

  it("validates last name when required", () => {
    const formData: Partial<Student> = {
      first_name: "Max",
      second_name: "",
      school_class: "5a",
      data_retention_days: 30,
    };

    const errors = validateStudentForm(formData);

    expect(errors.last_name).toBe("Bitte gib den Nachnamen ein.");
  });

  it("validates school class when required", () => {
    const formData: Partial<Student> = {
      first_name: "Max",
      second_name: "Mustermann",
      school_class: "",
      data_retention_days: 30,
    };

    const errors = validateStudentForm(formData);

    expect(errors.school_class).toBe("Bitte gib die Klasse ein.");
  });

  it("validates trimmed values", () => {
    const formData: Partial<Student> = {
      first_name: "  ",
      second_name: "  ",
      school_class: "  ",
      data_retention_days: 30,
    };

    const errors = validateStudentForm(formData);

    expect(errors.first_name).toBe("Bitte gib den Vornamen ein.");
    expect(errors.last_name).toBe("Bitte gib den Nachnamen ein.");
    expect(errors.school_class).toBe("Bitte gib die Klasse ein.");
  });

  it("validates invalid data retention days", () => {
    const formData: Partial<Student> = {
      first_name: "Max",
      second_name: "Mustermann",
      school_class: "5a",
      data_retention_days: 35,
    };

    const errors = validateStudentForm(formData);

    expect(errors.data_retention_days).toBe(
      "Bitte gib eine Zahl von 1 bis 31 ein.",
    );
  });

  it("returns multiple errors when multiple fields invalid", () => {
    const formData: Partial<Student> = {
      first_name: "",
      second_name: "",
      school_class: "",
      data_retention_days: 0,
    };

    const errors = validateStudentForm(formData);

    expect(errors.first_name).toBe("Bitte gib den Vornamen ein.");
    expect(errors.last_name).toBe("Bitte gib den Nachnamen ein.");
    expect(errors.school_class).toBe("Bitte gib die Klasse ein.");
    expect(errors.data_retention_days).toBe(
      "Bitte gib eine Zahl von 1 bis 31 ein.",
    );
  });
});
