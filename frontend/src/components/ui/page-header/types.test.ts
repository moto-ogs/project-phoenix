/**
 * Tests for Types and Utility Functions
 * Tests normalizeFilterValues and the active-filter rule (#6734)
 */
import { describe, it, expect } from "vitest";
import {
  isFilterRestricting,
  isMultiSelectRestricting,
  normalizeFilterValues,
  type FilterConfig,
} from "./types";

describe("normalizeFilterValues", () => {
  it("returns array as-is when value is already an array", () => {
    const input = ["value1", "value2", "value3"];
    const result = normalizeFilterValues(input);

    expect(result).toEqual(["value1", "value2", "value3"]);
    expect(result).toBe(input); // Same reference
  });

  it("wraps string value in an array", () => {
    const result = normalizeFilterValues("single-value");

    expect(result).toEqual(["single-value"]);
  });

  it("returns empty array when value is undefined", () => {
    const result = normalizeFilterValues(undefined);

    expect(result).toEqual([]);
  });

  it("returns empty array when value is empty string", () => {
    const result = normalizeFilterValues("");

    expect(result).toEqual([]);
  });

  it("handles empty array", () => {
    const result = normalizeFilterValues([]);

    expect(result).toEqual([]);
  });

  it("preserves array with single element", () => {
    const result = normalizeFilterValues(["only-one"]);

    expect(result).toEqual(["only-one"]);
  });

  it("handles numeric string values", () => {
    const result = normalizeFilterValues("123");

    expect(result).toEqual(["123"]);
  });

  it("handles arrays with numeric strings", () => {
    const result = normalizeFilterValues(["1", "2", "3"]);

    expect(result).toEqual(["1", "2", "3"]);
  });

  it("handles special characters in string values", () => {
    const result = normalizeFilterValues("value-with-dash_and_underscore");

    expect(result).toEqual(["value-with-dash_and_underscore"]);
  });

  it("handles whitespace in string values", () => {
    const result = normalizeFilterValues("value with spaces");

    expect(result).toEqual(["value with spaces"]);
  });
});

describe("isMultiSelectRestricting", () => {
  const options = [{ value: "3a" }, { value: "4b" }];

  it("treats the empty selection as no restriction", () => {
    expect(isMultiSelectRestricting([], options)).toBe(false);
  });

  it("treats a partial selection as a restriction", () => {
    expect(isMultiSelectRestricting(["3a"], options)).toBe(true);
  });

  it("treats every option chosen as no restriction", () => {
    expect(isMultiSelectRestricting(["4b", "3a"], options)).toBe(false);
  });

  it("counts a chosen value outside the options as a restriction", () => {
    expect(isMultiSelectRestricting(["3a", "4b", "5c"], options)).toBe(true);
    // Same length as the options, but 4b is excluded.
    expect(isMultiSelectRestricting(["3a", "5c"], options)).toBe(true);
  });

  it("counts an entry kept only to lift it as outside the options", () => {
    // A restored class while the class list is not there yet: it is the only
    // entry, but the list is still narrowed to it.
    expect(
      isMultiSelectRestricting(["3a"], [{ value: "3a", outsideOptions: true }]),
    ).toBe(true);
    expect(
      isMultiSelectRestricting(
        ["3a", "4b", "5c"],
        [...options, { value: "5c", outsideOptions: true }],
      ),
    ).toBe(true);
  });
});

describe("isFilterRestricting", () => {
  const base: FilterConfig = {
    id: "f",
    label: "F",
    type: "dropdown",
    value: "all",
    onChange: () => undefined,
    options: [
      { value: "all", label: "Alle" },
      { value: "x", label: "X" },
    ],
  };

  it("compares a single choice with its first option", () => {
    expect(isFilterRestricting(base)).toBe(false);
    expect(isFilterRestricting({ ...base, value: "x" })).toBe(true);
  });

  it("applies the multi-select rule to a multi-select", () => {
    const multi: FilterConfig = {
      ...base,
      multiSelect: true,
      options: [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ],
    };
    expect(isFilterRestricting({ ...multi, value: [] })).toBe(false);
    expect(isFilterRestricting({ ...multi, value: ["a"] })).toBe(true);
    expect(isFilterRestricting({ ...multi, value: ["a", "b"] })).toBe(false);
    expect(isFilterRestricting({ ...multi, value: ["a", "b", "c"] })).toBe(
      true,
    );
  });

  it("never reports a custom filter, whose value is a stub", () => {
    expect(
      isFilterRestricting({ ...base, type: "custom", value: "", options: [] }),
    ).toBe(false);
  });
});
