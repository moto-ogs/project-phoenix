// Die Anrede, die eine Person freiwillig für sich selbst wählt (#7362).
// Ohne Angabe bleibt jede Begrüßung bei Vor- und Nachname.
export type Salutation = "ms" | "mr";

export const SALUTATIONS: readonly Salutation[] = ["ms", "mr"];

const GERMAN_TITLE: Record<Salutation, string> = { ms: "Frau", mr: "Herr" };

/** Der deutsche Titel zur Anrede: „Frau“ oder „Herr“. */
export function salutationTitle(salutation: Salutation): string {
  return GERMAN_TITLE[salutation];
}

/**
 * Der Name, mit dem eine Begrüßung die Person anspricht. Die Anrede mit
 * Nachnamen („Frau Klein“) ist eine deutsche Form: andere Sprachen und
 * Personen ohne Angabe behalten den Vornamen.
 */
export function greetingName(person: {
  readonly locale: string;
  readonly salutation?: Salutation | null;
  readonly firstName?: string | null;
  readonly lastName?: string | null;
}): string {
  const firstName = person.firstName?.trim() ?? "";
  const lastName = person.lastName?.trim() ?? "";
  if (person.locale === "de" && person.salutation && lastName) {
    return `${GERMAN_TITLE[person.salutation]} ${lastName}`;
  }
  return firstName;
}
