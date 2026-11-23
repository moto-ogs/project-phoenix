// Texte zu Kindern, die ein Lauf wegen einer schon ausgestellten Rechnung
// zurückhält (ADR 0158, Nachtrag „Schon abgerechnet je Kind“, #7892). Es
// gibt zwei Fälle mit verschiedenem Ausweg: Der Monat ist schon abgerechnet
// (prüfen, sonst nichts tun), oder die Rechnung enthält nur die Mensa (die
// Betreuung fehlt, die Rechnung muss storniert werden). Kein Text darf beim
// zweiten Fall „nichts tun“ oder „verwerfen“ nahelegen.

import type { CareBilledChild } from "~/lib/traeger-care-billing-api";

/** The children by what the office does about them. */
export function splitBilledChildren(children: readonly CareBilledChild[]): {
  /** Their month has an invoice already. */
  readonly billed: CareBilledChild[];
  /** Their invoice carries only the Mensa: the care is not billed. */
  readonly mealOnly: CareBilledChild[];
} {
  return {
    billed: children.filter((child) => child.reason !== "meal_only_invoice"),
    mealOnly: children.filter((child) => child.reason === "meal_only_invoice"),
  };
}

/** What an empty run says about held children; empty without one. */
function heldSentences(
  children: readonly CareBilledChild[],
  billedText: (one: boolean, count: number) => string,
  afterCancel: (one: boolean) => string,
): string[] {
  const { billed, mealOnly } = splitBilledChildren(children);
  const sentences: string[] = [];
  if (billed.length > 0) {
    sentences.push(billedText(billed.length === 1, billed.length));
  }
  if (mealOnly.length > 0) {
    const one = mealOnly.length === 1;
    sentences.push(
      `${one ? "Bei einem Kind" : `Bei ${mealOnly.length} Kindern`} ist die Betreuung noch nicht abgerechnet, siehe unten.`,
      `Storniere ${one ? "die Rechnung" : "die Rechnungen"}. ${afterCancel(one)}`,
    );
  } else if (billed.length > 0) {
    // Only when every held child is billed already is nothing left to do.
    sentences.push("Stimmt das, kannst du den Lauf verwerfen.");
  }
  return sentences;
}

/** The empty monthly run; it names the children it holds back. */
export function emptyCareRunText(
  month: string,
  children: readonly CareBilledChild[],
): string {
  const held = heldSentences(
    children,
    (one, count) =>
      `${one ? "Ein Kind ist" : `${count} Kinder sind`} schon abgerechnet, siehe unten.`,
    (one) =>
      `Danach rechnet dieser Lauf ${one ? "das Kind" : "die Kinder"} neu und zeigt, was noch offen ist.`,
  );
  if (held.length === 0) {
    return `Für ${month} gibt es keine Rechnung. Es fehlt auch kein Preis. Du kannst den Lauf verwerfen. Danach ist der Monat frei für einen neuen Lauf.`;
  }
  return [`Für ${month} gibt es keine neue Rechnung.`, ...held].join(" ");
}

/** The empty Jahreslauf; it names the children it holds back. */
export function emptyNoticeRunText(
  year: number,
  children: readonly CareBilledChild[],
): string {
  const held = heldSentences(
    children,
    (one, count) =>
      `${one ? "Für ein Kind ist" : `Für ${count} Kinder ist`} ein Monat schon abgerechnet, siehe unten.`,
    () =>
      "Danach rechnet diese Vorschau den Monat neu und zeigt, was noch offen ist.",
  );
  if (held.length === 0) {
    return `Für das Jahr ${year} gibt es keinen Bescheid. Es fehlt auch kein Preis. Du kannst den Lauf verwerfen. Danach ist das Jahr frei für einen neuen Lauf.`;
  }
  return [`Für das Jahr ${year} gibt es keinen neuen Bescheid.`, ...held].join(
    " ",
  );
}

/** What the release question says about the children the run holds back. */
export function releaseBilledLines(
  children: readonly CareBilledChild[],
): string[] {
  const { billed, mealOnly } = splitBilledChildren(children);
  const lines: string[] = [];
  if (billed.length > 0) {
    lines.push(
      billed.length === 1
        ? "1 Kind hat schon eine Rechnung und bekommt keine weitere."
        : `${billed.length} Kinder haben schon eine Rechnung und bekommen keine weitere.`,
    );
  }
  if (mealOnly.length > 0) {
    lines.push(
      mealOnly.length === 1
        ? "Bei 1 Kind bleibt die Betreuung offen: Seine Rechnung enthält nur die Mensa."
        : `Bei ${mealOnly.length} Kindern bleibt die Betreuung offen: Die Rechnungen enthalten nur die Mensa.`,
    );
  }
  return lines;
}
