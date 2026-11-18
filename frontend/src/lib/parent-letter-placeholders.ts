/**
 * The placeholders of an Elternbrief (#4813), written `{{name}}`. The grammar
 * mirrors the backend's check in
 * `backend/modules/communication/parent_letter_placeholders.go`: names are
 * matched in lower case with the surrounding space trimmed, and a brace left
 * over from a placeholder written wrongly counts as unknown. The list of
 * names and their labels comes from the backend (GET `letter-placeholders`).
 */

const TOKEN = /\{\{\s*([^{}]*?)\s*\}\}/g;
const STRAY_BRACE = /\S*[{}]\S*/g;

/** Whether a text names any placeholder. */
export function hasLetterPlaceholders(text: string): boolean {
  return new RegExp(TOKEN.source).test(text);
}

/** The placeholder names a text uses, in lower case, once each. */
function letterPlaceholderNames(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(TOKEN)) {
    names.add((match[1] ?? "").toLowerCase());
  }
  return [...names];
}

/**
 * Everything in a text the backend would refuse: placeholders that are not
 * in `known`, shown as `{{name}}`, and leftover braces as they stand.
 */
export function unknownLetterPlaceholders(
  text: string,
  known: ReadonlySet<string>,
): string[] {
  const unknown = new Set<string>();
  for (const name of letterPlaceholderNames(text)) {
    if (name === "" || !known.has(name)) unknown.add(`{{${name}}}`);
  }
  for (const stray of text.replace(TOKEN, " ").match(STRAY_BRACE) ?? []) {
    unknown.add(stray);
  }
  return [...unknown];
}

/** A letter text cut into plain text and the placeholders between it. */
export type LetterTextPart =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "placeholder"; readonly name: string };

export function splitLetterText(text: string): LetterTextPart[] {
  const parts: LetterTextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const start = match.index ?? 0;
    if (start > last)
      parts.push({ kind: "text", text: text.slice(last, start) });
    parts.push({ kind: "placeholder", name: (match[1] ?? "").toLowerCase() });
    last = start + match[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts;
}
