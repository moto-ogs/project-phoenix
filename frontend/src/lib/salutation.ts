// Die Anrede, die eine Person freiwillig für sich selbst wählt (#7362).
// Sie färbt nur das Grußwort deutscher E-Mails („Liebe Karin“, „Lieber
// Jonas“); ohne Angabe bleibt jede Begrüßung neutral.
export type Salutation = "ms" | "mr";

export const SALUTATIONS: readonly Salutation[] = ["ms", "mr"];

const GERMAN_TITLE: Record<Salutation, string> = { ms: "Frau", mr: "Herr" };

/** Der deutsche Titel zur Anrede: „Frau“ oder „Herr“. */
export function salutationTitle(salutation: Salutation): string {
  return GERMAN_TITLE[salutation];
}
