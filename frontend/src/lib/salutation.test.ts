import { describe, expect, it } from "vitest";
import { greetingName } from "./salutation";

describe("greetingName", () => {
  const person = { firstName: " Karin ", lastName: " Klein " };

  it("spricht auf Deutsch mit gewählter Anrede und Nachnamen an", () => {
    expect(greetingName({ ...person, locale: "de", salutation: "ms" })).toBe(
      "Frau Klein",
    );
    expect(greetingName({ ...person, locale: "de", salutation: "mr" })).toBe(
      "Herr Klein",
    );
  });

  it("bleibt ohne Angabe beim Vornamen", () => {
    expect(greetingName({ ...person, locale: "de" })).toBe("Karin");
    expect(greetingName({ ...person, locale: "de", salutation: null })).toBe(
      "Karin",
    );
  });

  it("nutzt die deutsche Anrede nicht in anderen Sprachen", () => {
    expect(greetingName({ ...person, locale: "tr", salutation: "ms" })).toBe(
      "Karin",
    );
  });

  it("fällt ohne Nachnamen auf den Vornamen zurück", () => {
    expect(
      greetingName({ firstName: "Karin", locale: "de", salutation: "ms" }),
    ).toBe("Karin");
  });
});
