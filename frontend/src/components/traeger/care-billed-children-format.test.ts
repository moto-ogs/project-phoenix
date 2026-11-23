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
      "Für Januar 2027 gibt es keine neue Rechnung. Ein Kind ist schon abgerechnet, siehe unten. Bei einem Kind ist die Betreuung noch nicht abgerechnet, siehe unten. Storniere die Rechnung. Danach rechnet dieser Lauf das Kind neu und zeigt, was noch offen ist.",
    );
    expect(
      emptyNoticeRunText(2027, [
        child("meal_only_invoice"),
        child("meal_only_invoice"),
      ]),
    ).toBe(
      "Für das Jahr 2027 gibt es keinen neuen Bescheid. Bei 2 Kindern ist die Betreuung noch nicht abgerechnet, siehe unten. Storniere die Rechnungen. Danach rechnet diese Vorschau den Monat neu und zeigt, was noch offen ist.",
    );
  });

  // A contract without a price keeps its notice, which bills days another
  // contract would assess anew (#7952): the price is missing, so the empty
  // Jahreslauf asks for it and never offers to discard the run.
  it("asks for the missing price and never to discard the Jahreslauf", () => {
    expect(emptyNoticeRunText(2027, [child("unpriced_notice")])).toBe(
      "Für das Jahr 2027 gibt es keinen neuen Bescheid. Bei einem Kind fehlt ein Preis, siehe unten. Trage ihn in der Preisliste ein. Danach rechnet diese Vorschau den Monat neu.",
    );
    expect(
      emptyNoticeRunText(2027, [
        child("already_billed"),
        child("unpriced_notice"),
        child("unpriced_notice"),
      ]),
    ).toBe(
      "Für das Jahr 2027 gibt es keinen neuen Bescheid. Für ein Kind ist ein Monat schon abgerechnet, siehe unten. Bei 2 Kindern fehlt ein Preis, siehe unten. Trage die Preise in der Preisliste ein. Danach rechnet diese Vorschau den Monat neu.",
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
      "Bei 2 Kindern bleibt die Betreuung offen: Die Rechnungen enthalten nur die Mensa.",
    ]);
  });
});
