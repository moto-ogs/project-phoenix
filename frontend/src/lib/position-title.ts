/**
 * Die Position einer Person (Freitext am Personal, z. B. „Betreuer“) in der
 * Form, die zu ihrem Geschlecht aus den Stammdaten passt.
 *
 * Schulen tragen die Position oft einmal ein und übernehmen sie dann per
 * Vorschlag für alle; so stand bei Frauen „Betreuer“. Das Backend schickt
 * statt des Geschlechts nur die Form (`role_form`): „Betreuerin“ bei
 * weiblich, „Betreuer“ bei männlich. Ohne Form (keine Angabe oder divers)
 * bleibt eine bewusst weibliche oder schon neutrale Eingabe stehen, nur die
 * männliche Form wird zu „Betreuer:in“.
 *
 * Geändert wird nur eine Position aus einem Wort, auch mit Bindestrich
 * („OGS-Betreuer“ → „OGS-Betreuerin“), und nur, wenn sie wie eine
 * Personenbezeichnung endet (-er, -ant, -ent, -ist, -oge). Mehrere Wörter
 * („Pädagogischer Mitarbeiter“) bleiben, wie sie sind: das Beiwort müsste
 * mitwandern. „Admin“, „Fachkraft“ oder „OGS-Leitung“ bleiben ebenso.
 */
/** Die Form der Position, wie `role_form` sie liefert. */
export type RoleForm = "feminine" | "masculine";

const MASCULINE_ENDING = /(?:er|ant|ent|ist|oge)$/i;
const INCLUSIVE_SUFFIX = /(?::|\*|_|\/-?)in(?:nen)?$|\(in\)$|(?<=[a-zäöüß])In$/;
const LAST_WORD = /^([^\s]*-)?([^\s-]+)$/;

interface WordForms {
  readonly masculine: string;
  readonly feminine: string;
  readonly inclusive: string;
}

function formsFromMasculine(masculine: string): WordForms | null {
  if (masculine.length < 4 || !MASCULINE_ENDING.test(masculine)) return null;
  if (/oge$/i.test(masculine)) {
    const stem = masculine.slice(0, -1);
    return { masculine, feminine: `${stem}in`, inclusive: `${stem}:in` };
  }
  return {
    masculine,
    feminine: `${masculine}in`,
    inclusive: `${masculine}:in`,
  };
}

type Written = "masculine" | "feminine" | "inclusive";

function readWord(word: string): { forms: WordForms; written: Written } | null {
  const inclusive = word.replace(INCLUSIVE_SUFFIX, "");
  if (inclusive !== word) {
    const forms = formsFromMasculine(inclusive.replace(/og$/i, "oge"));
    return forms ? { forms, written: "inclusive" } : null;
  }
  if (/in$/.test(word)) {
    const stem = word.slice(0, -2);
    const forms = formsFromMasculine(/og$/i.test(stem) ? `${stem}e` : stem);
    if (forms) return { forms, written: "feminine" };
  }
  const forms = formsFromMasculine(word);
  return forms ? { forms, written: "masculine" } : null;
}

export function positionForForm(
  position: string,
  form: RoleForm | null | undefined,
): string {
  const trimmed = position.trim();
  const match = LAST_WORD.exec(trimmed);
  if (!match) return position;
  const prefix = match[1] ?? "";
  const read = readWord(match[2]!);
  if (!read) return position;
  const target: Written =
    form ?? (read.written === "masculine" ? "inclusive" : read.written);
  if (target === read.written) return position;
  return `${prefix}${read.forms[target]}`;
}
