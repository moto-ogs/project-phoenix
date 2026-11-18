import { describe, expect, it } from "vitest";

import { positionForForm } from "./position-title";

describe("positionForForm", () => {
  it.each([
    ["Betreuer", "feminine", "Betreuerin"],
    ["Betreuer", "masculine", "Betreuer"],
    ["Betreuer", null, "Betreuer:in"],
    ["Betreuerin", "masculine", "Betreuer"],
    ["Betreuerin", null, "Betreuerin"],
    ["Betreuer:in", "feminine", "Betreuerin"],
    ["Betreuer*in", null, "Betreuer*in"],
    ["BetreuerIn", "masculine", "Betreuer"],
    ["OGS-Leiter", "feminine", "OGS-Leiterin"],
    ["Mitarbeiter", "feminine", "Mitarbeiterin"],
    ["Sozialpädagoge", "feminine", "Sozialpädagogin"],
    ["Sozialpädagogin", "masculine", "Sozialpädagoge"],
    ["Sozialpädagoge", null, "Sozialpädagog:in"],
    ["Praktikant", "feminine", "Praktikantin"],
    ["Assistentin", "masculine", "Assistent"],
  ] as const)("%s with %s reads %s", (position, gender, expected) => {
    expect(positionForForm(position, gender)).toBe(expected);
  });

  it.each([
    "Admin",
    "Extern",
    "Pädagogische Fachkraft",
    "OGS-Leitung",
    "OGS-Büro",
    "Pädagogischer Mitarbeiter",
    "Pädagogische Mitarbeiterin",
    "",
  ])("leaves %j unchanged for every form", (position) => {
    for (const gender of ["feminine", "masculine", null] as const) {
      expect(positionForForm(position, gender)).toBe(position);
    }
  });
});
