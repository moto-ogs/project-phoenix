import { describe, expect, it } from "vitest";
import type { CareBilledChild } from "~/lib/traeger-care-billing-api";
import {
  emptyCareRunText,
  emptyNoticeRunText,
  releaseBilledLines,
} from "./care-billed-children-format";

const child = (reason: CareBilledChild["reason"]): CareBilledChild => ({
  childFirstName: "Noah",
  childLastName: "Muster",
  reason,
  contracts: [],
  invoices: [],
});

describe("texts about children a run holds back for an issued invoice", () => {
  it("keeps the plain empty run as it was", () => {
    expect(emptyCareRunText("Januar 2027", [])).toBe(
      "Für Januar 2027 gibt es keine Rechnung. Es fehlt auch kein Preis. Du kannst den Lauf verwerfen. Danach ist der Monat frei für einen neuen Lauf.",
    );
    expect(emptyNoticeRunText(2027, [])).toBe(
      "Für das Jahr 2027 gibt es keinen Bescheid. Es fehlt auch kein Preis. Du kannst den Lauf verwerfen. Danach ist das Jahr frei für einen neuen Lauf.",
    );
    expect(releaseBilledLines([])).toEqual([]);
  });

  it("offers to discard only when every held child is billed already", () => {
    expect(emptyCareRunText("Januar 2027", [child("already_billed")])).toBe(
      "Für Januar 2027 gibt es keine neue Rechnung. Ein Kind ist schon abgerechnet, siehe unten. Stimmt das, kannst du den Lauf verwerfen.",
    );
    expect(
      emptyNoticeRunText(2027, [
        child("already_billed"),
        child("already_billed"),
      ]),
    ).toBe(
      "Für das Jahr 2027 gibt es keinen neuen Bescheid. Für 2 Kinder ist ein Monat schon abgerechnet, siehe unten. Stimmt das, kannst du den Lauf verwerfen.",
    );
  });

  it("tells to cancel a Mensa-only invoice and never to discard the run", () => {
    expect(
      emptyCareRunText("Januar 2027", [
        child("already_billed"),
        child("meal_only_invoice"),
      ]),
    ).toBe(
      "Für Januar 2027 gibt es keine neue Rechnung. Ein Kind ist schon abgerechnet, siehe unten. Bei einem Kind ist die Betreuung noch nicht abgerechnet, siehe unten. Storniere die Rechnung. Dann rechnet dieser Lauf Betreuung und Mensa ab.",
    );
    expect(
      emptyNoticeRunText(2027, [
        child("meal_only_invoice"),
        child("meal_only_invoice"),
      ]),
    ).toBe(
      "Für das Jahr 2027 gibt es keinen neuen Bescheid. Bei 2 Kindern ist die Betreuung noch nicht abgerechnet, siehe unten. Storniere die Rechnungen. Dann nimmt diese Vorschau den Monat auf.",
    );
  });

  it("names both kinds in the release question", () => {
    expect(
      releaseBilledLines([
        child("already_billed"),
        child("meal_only_invoice"),
        child("meal_only_invoice"),
      ]),
    ).toEqual([
      "1 Kind hat schon eine Rechnung und bekommt keine weitere.",
      "Bei 2 Kindern bleibt die Betreuung offen: Ihre Rechnungen enthalten nur die Mensa.",
    ]);
  });
});
