/**
 * The care-facility term of a school (`enrollment.care_facility_term`,
 * #6042): what the fixed texts of the enrollment flow call the school's care,
 * for example „Die OGS prüft deine Angaben“ or „Die GTS prüft …“. Pure, so
 * server code and the tenant client share it.
 *
 * A school with its own name also chooses the article
 * (`enrollment.care_facility_article`, #8136). The German messages decline
 * the name through the placeholders of `careTermValues`: „{careNomCap} prüft
 * deine Angaben“ reads „Der Hort prüft …“ or „Das Lernhaus prüft …“. Every
 * other language keeps the bare `{careTerm}`.
 */
const DEFAULT_CARE_FACILITY_TERM = "OGS";
const PRESET_CARE_TERMS: ReadonlySet<string> = new Set(["OGS", "GTS"]);

/** The term the backend sent, or „OGS“ for missing metadata. */
export function normalizeCareFacilityTerm(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_CARE_FACILITY_TERM;
  const trimmed = value.trim();
  return trimmed === "" ? DEFAULT_CARE_FACILITY_TERM : trimmed;
}

export const CARE_ARTICLES = ["der", "die", "das"] as const;
export type CareArticle = (typeof CARE_ARTICLES)[number];

/**
 * The article the backend sent, or „die“ for missing metadata: schools that
 * never chose one and the presets OGS and GTS are feminine.
 */
export function normalizeCareArticle(value: unknown): CareArticle {
  return value === "der" || value === "das" ? value : "die";
}

/** A school's care name with its article. */
export interface CareFacilityName {
  readonly term: string;
  readonly article: CareArticle;
}

export function careFacilityName(
  term: unknown,
  article?: unknown,
): CareFacilityName {
  const name = normalizeCareFacilityTerm(term);
  return {
    term: name,
    // As the backend (textnorm.CareArticle): the presets are feminine
    // whatever article is stored.
    article: PRESET_CARE_TERMS.has(name)
      ? "die"
      : normalizeCareArticle(article),
  };
}

/**
 * The words in front of the name, per article. The name itself is never
 * inflected, so no text needs a real genitive („des Horts“): `careGen` keeps
 * „der OGS“ and says „vom Hort“ / „vom Lernhaus“ for the other two.
 */
const DECLENSION = {
  /** Subject: „die OGS prüft“. */
  careNom: { der: "der", die: "die", das: "das" },
  /** Object and after an, für, auf, durch, in (where to): „an die OGS“. */
  careAcc: { der: "den", die: "die", das: "das" },
  /** After mit, and as the receiver: „schreibe der OGS“. */
  careDat: { der: "dem", die: "der", das: "dem" },
  /** Whose: „die Antwort der OGS“, „die Antwort vom Hort“. */
  careGen: { der: "vom", die: "der", das: "vom" },
  /** Where: „in der OGS“, „im Hort“. */
  careIn: { der: "im", die: "in der", das: "im" },
  /** „bei der OGS“, „beim Hort“. */
  careBei: { der: "beim", die: "bei der", das: "beim" },
  /** „von der OGS“, „vom Hort“. */
  careVon: { der: "vom", die: "von der", das: "vom" },
  /** The reader's own care as a subject: „deine OGS“, „dein Hort“. */
  careYourNom: { der: "dein", die: "deine", das: "dein" },
  /** The reader's own care as an object: „für deine OGS“, „für deinen Hort“. */
  careYourAcc: { der: "deinen", die: "deine", das: "dein" },
  /** Whose, for the reader's own care: „deiner OGS“, „von deinem Hort“. */
  careYourGen: { der: "von deinem", die: "deiner", das: "von deinem" },
  /** „für diese OGS“, „für diesen Hort“, „für dieses Lernhaus“. */
  careThisAcc: { der: "diesen", die: "diese", das: "dieses" },
  /** „bei dieser OGS“, „in diesem Hort“. */
  careThisDat: { der: "diesem", die: "dieser", das: "diesem" },
} as const satisfies Record<string, Record<CareArticle, string>>;

type DeclinedPlaceholder = keyof typeof DECLENSION;

/** Words that refer back to the care without naming it again. */
const PRONOUNS = {
  /** „{carePronCap} prüft deine Meldung“: sie, er, es. */
  carePron: { der: "er", die: "sie", das: "es" },
  /** Whose, before a masculine or neuter noun: „ihr Eintrag“, „sein Eintrag“. */
  carePoss: { der: "sein", die: "ihr", das: "sein" },
} as const satisfies Record<string, Record<CareArticle, string>>;

type PronounPlaceholder = keyof typeof PRONOUNS;

/** The forms that also open a sentence: „{careNomCap} prüft …“. */
const SENTENCE_START = [
  "careNom",
  "careIn",
  "careVon",
  "careYourNom",
  "carePron",
] as const satisfies readonly (DeclinedPlaceholder | PronounPlaceholder)[];

type SentenceStartPlaceholder = `${(typeof SENTENCE_START)[number]}Cap`;

type CareTermPlaceholder =
  | "careTerm"
  | "careAccShort"
  | DeclinedPlaceholder
  | PronounPlaceholder
  | SentenceStartPlaceholder;

/** The ICU values every text with a care placeholder is formatted with. */
export type CareTermValues = Readonly<Record<CareTermPlaceholder, string>>;

function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase("de") + text.slice(1);
}

/**
 * The values for one school's name. An account with children at schools of
 * different names passes all of them: every form then names each school once
 * („in der OGS/GTS“, or „die OGS/der Hort“ for different articles), so no family reads a name or an
 * article that is wrong for one of its schools (#6082).
 */
export function careTermValues(
  names: CareFacilityName | readonly CareFacilityName[],
): CareTermValues {
  const distinct = distinctNames(Array.isArray(names) ? names : [names]);
  const all = sharedArticle(distinct);
  const join = (form: (name: CareFacilityName) => string) =>
    all.map(form).join("/");
  const values: Partial<Record<CareTermPlaceholder, string>> = {
    careTerm: [...new Set(all.map((name) => name.term))].join("/"),
    // The object on a button that named a preset without an article before
    // #8136: stays „an OGS“; an own name gets its article, „an den Hort“.
    careAccShort: [
      ...new Set(
        (distinct.length > 0 ? distinct : all).map((name) =>
          PRESET_CARE_TERMS.has(name.term)
            ? name.term
            : `${DECLENSION.careAcc[name.article]} ${name.term}`,
        ),
      ),
    ].join("/"),
  };
  for (const key of Object.keys(DECLENSION) as DeclinedPlaceholder[]) {
    values[key] = join((name) =>
      `${DECLENSION[key][name.article]} ${name.term}`.trim(),
    );
  }
  for (const key of Object.keys(PRONOUNS) as PronounPlaceholder[]) {
    values[key] = [
      ...new Set(all.map((name) => PRONOUNS[key][name.article])),
    ].join("/");
  }
  for (const key of SENTENCE_START) {
    values[`${key}Cap`] = capitalize(values[key]!);
  }
  return values as CareTermValues;
}

function distinctNames(
  names: readonly CareFacilityName[],
): readonly CareFacilityName[] {
  const seen = new Set<string>();
  return names.filter((name) => {
    const key = `${name.article} ${name.term}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Schools that share an article read as one name, as before #8136: „in der
 * OGS/GTS“. Only different articles repeat the words in front of each name.
 */
function sharedArticle(
  names: readonly CareFacilityName[],
): readonly CareFacilityName[] {
  const first = names[0];
  if (first === undefined) return [careFacilityName(undefined)];
  if (names.some((name) => name.article !== first.article)) return names;
  return [
    {
      term: [...new Set(names.map((name) => name.term))].join("/"),
      article: first.article,
    },
  ];
}

/** The values for a term without an article: „die“, as before #8136. */
export function careTermValuesOf(
  term: unknown,
  article?: unknown,
): CareTermValues {
  return careTermValues(careFacilityName(term, article));
}
