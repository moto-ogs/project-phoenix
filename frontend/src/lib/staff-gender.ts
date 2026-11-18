import type { StammdatenGender } from "~/lib/staff-api";

/** Bezeichnung des Geschlechts aus den Stammdaten der Mitarbeitenden. */
export const STAFF_GENDER_LABELS: Readonly<Record<StammdatenGender, string>> = {
  female: "Weiblich",
  male: "Männlich",
  diverse: "Divers",
};

/**
 * Auswahl für das Geschlecht, wo die Schule es einträgt: in den Stammdaten
 * und schon beim Einladen. "" ist „Keine Angabe“.
 */
export const STAFF_GENDER_OPTIONS: ReadonlyArray<{
  readonly value: "" | StammdatenGender;
  readonly label: string;
}> = [
  { value: "", label: "Keine Angabe" },
  { value: "female", label: STAFF_GENDER_LABELS.female },
  { value: "male", label: STAFF_GENDER_LABELS.male },
  { value: "diverse", label: STAFF_GENDER_LABELS.diverse },
];

/** Hinweis am Feld: wofür moto das Geschlecht nutzt. */
export const STAFF_GENDER_HINT =
  "Die Personalliste zeigt die Position passend, z. B. „Betreuerin“.";

export function isStaffGender(value: string): value is StammdatenGender {
  return Object.hasOwn(STAFF_GENDER_LABELS, value);
}
