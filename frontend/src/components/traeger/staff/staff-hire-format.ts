/**
 * „Person einstellen“ im Träger-Portal (#7206): der Entwurf des Formulars,
 * die Prüfung je Schritt und die Anfrage, die daraus wird.
 */
import type {
  StaffContractKind,
  StaffHireInput,
} from "~/lib/traeger-staff-api";
import {
  hoursFields,
  hoursFieldsEmpty,
  parseHoursFields,
  weekMinutes,
} from "./staff-contract-format";

export const HIRE_STEPS = [
  "Person",
  "Arbeitsvertrag",
  "Einsatzorte",
  "Prüfen",
] as const;

/** Der Schritt „Prüfen“, von dem aus die Einstellung abgeschickt wird. */
export const HIRE_REVIEW_STEP = HIRE_STEPS.length - 1;

/** Eine gewählte Schule mit ihren Stunden Montag bis Freitag. */
export interface HireSiteDraft {
  readonly schoolId: string;
  readonly schoolName: string;
  readonly hours: readonly string[];
}

export interface HireDraft {
  readonly firstName: string;
  readonly lastName: string;
  /** Kalendertag `YYYY-MM-DD`; leer, solange es fehlt. */
  readonly birthday: string;
  readonly personnelNumber: string;
  readonly email: string;
  readonly phone: string;
  readonly kind: StaffContractKind;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly sites: readonly HireSiteDraft[];
}

interface HireSchool {
  readonly id: string;
  readonly name: string;
}

export function hireSite(school: HireSchool): HireSiteDraft {
  return {
    schoolId: school.id,
    schoolName: school.name,
    hours: hoursFields(null),
  };
}

/** Ein leerer Entwurf. Gibt es nur eine Schule, ist sie schon gewählt. */
export function emptyHireDraft(schools: readonly HireSchool[]): HireDraft {
  const only = schools.length === 1 ? schools[0] : undefined;
  return {
    firstName: "",
    lastName: "",
    birthday: "",
    personnelNumber: "",
    email: "",
    phone: "",
    kind: "part_time",
    startsOn: "",
    endsOn: "",
    sites: only ? [hireSite(only)] : [],
  };
}

/** Die Felder jedes Schritts, mit den Namen aus der Antwort des Servers. */
const STEP_FIELDS: readonly (readonly string[])[] = [
  ["first_name", "last_name", "birthday", "personnel_number", "email", "phone"],
  ["kind", "starts_on", "ends_on"],
  ["sites"],
];

/** Der Schritt, auf dem ein Feld steht; ohne Treffer der Schritt „Prüfen“. */
export function hireStepOfField(field: string): number {
  const step = STEP_FIELDS.findIndex((fields) => fields.includes(field));
  return step === -1 ? HIRE_REVIEW_STEP : step;
}

function personErrors(draft: HireDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!draft.firstName.trim()) {
    errors.first_name = "Bitte den Vornamen eintragen.";
  }
  if (!draft.lastName.trim()) {
    errors.last_name = "Bitte den Nachnamen eintragen.";
  }
  if (!draft.birthday) {
    errors.birthday = "Bitte das Geburtsdatum wählen.";
  }
  const number = draft.personnelNumber.trim();
  if (number && !/^\d{1,9}$/.test(number)) {
    errors.personnel_number = "Bitte nur Ziffern eingeben, höchstens 9.";
  }
  const email = draft.email.trim();
  if (email && (!email.includes("@") || /\s/.test(email))) {
    errors.email = "Bitte eine gültige E-Mail-Adresse eintragen.";
  }
  return errors;
}

function contractErrors(draft: HireDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!draft.startsOn) {
    errors.starts_on = "Bitte den ersten Tag wählen.";
  } else if (draft.endsOn && draft.endsOn < draft.startsOn) {
    errors.ends_on = "Der letzte Tag liegt vor dem ersten Tag.";
  }
  return errors;
}

function siteErrors(draft: HireDraft): Record<string, string> {
  if (draft.sites.length === 0) {
    return { sites: "Bitte mindestens eine Schule wählen." };
  }
  if (draft.sites.some((site) => parseHoursFields(site.hours) === null)) {
    return { sites: "Bitte pro Tag 0 bis 12 Stunden eingeben." };
  }
  if (draft.sites.some((site) => hoursFieldsEmpty(site.hours))) {
    return { sites: "Bitte für jede gewählte Schule Stunden eintragen." };
  }
  return {};
}

/** Die Hinweise eines Schritts, nach Feld; leer, wenn alles passt. */
export function hireStepErrors(
  draft: HireDraft,
  step: number,
): Record<string, string> {
  if (step === 0) return personErrors(draft);
  if (step === 1) return contractErrors(draft);
  if (step === 2) return siteErrors(draft);
  return {};
}

/** Der erste Schritt mit einem Hinweis, oder `null`. */
export function firstInvalidHireStep(draft: HireDraft): number | null {
  for (let step = 0; step < HIRE_REVIEW_STEP; step++) {
    if (Object.keys(hireStepErrors(draft, step)).length > 0) return step;
  }
  return null;
}

/** Die Minuten aller gewählten Schulen in einer Woche. */
export function hireWeekMinutes(draft: HireDraft): number {
  return draft.sites.reduce(
    (sum, site) => sum + weekMinutes(parseHoursFields(site.hours) ?? []),
    0,
  );
}

/** Die Anfrage aus einem geprüften Entwurf. */
export function hireInput(
  draft: HireDraft,
  confirmDuplicate: boolean,
): StaffHireInput {
  return {
    firstName: draft.firstName.trim(),
    lastName: draft.lastName.trim(),
    birthday: draft.birthday,
    email: draft.email.trim(),
    phone: draft.phone.trim(),
    personnelNumber: draft.personnelNumber.trim(),
    kind: draft.kind,
    startsOn: draft.startsOn,
    endsOn: draft.endsOn || null,
    sites: draft.sites.map((site) => ({
      schoolId: site.schoolId,
      weekdayMinutes: parseHoursFields(site.hours) ?? [],
    })),
    confirmDuplicate,
  };
}
