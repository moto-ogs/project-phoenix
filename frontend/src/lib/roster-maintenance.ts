import type { RosterDeviation } from "~/lib/roster-deviation";
import { schoolClassesLabel } from "~/lib/school-class-label";
import type {
  RosterMaintenanceMode,
  TemplateRosterMaintenance,
  TimetableTemplate,
} from "~/lib/timetable-types";

/**
 * Wording of the Regeltermin indicator (#3140). The indicator names how
 * later children reach a Regeltermin; it is information, never a warning.
 * Every state keeps its own label and icon so colour is never the only cue.
 */
export interface RosterMaintenanceDescription {
  mode: RosterMaintenanceMode;
  label: string;
  explanation: string;
}

const LABELS: Record<RosterMaintenanceMode, string> = {
  automatic: "Automatisch",
  partial: "Teils automatisch",
  manual: "Manuell",
};

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} und ${names.at(-1)}`;
}

function offeringPhrase(names: readonly string[]): string {
  return names.length === 1
    ? `Betreuungsangebot „${names[0]}“`
    : `Betreuungsangebote ${joinNames(names.map((name) => `„${name}“`))}`;
}

function filterSentence(state: TemplateRosterMaintenance): string | null {
  if (state.schoolClasses.length > 0) {
    return `Nur ${schoolClassesLabel(state.schoolClasses, joinNames)}.`;
  }
  if (state.gradeLevels.length > 0) {
    const grades = [...state.gradeLevels].sort((a, b) => a - b).map(String);
    return grades.length === 1
      ? `Nur Jahrgang ${grades[0]}.`
      : `Nur Jahrgänge ${joinNames(grades)}.`;
  }
  return null;
}

function inactiveSentence(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  return names.length === 1
    ? `Das Betreuungsangebot „${names[0]}“ ist ausgeschaltet.`
    : `Die Betreuungsangebote ${joinNames(names.map((name) => `„${name}“`))} sind ausgeschaltet.`;
}

function invalidSourceSentence(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  return names.length === 1
    ? `Das Betreuungsangebot „${names[0]}“ passt nicht zu diesem Regeltermin.`
    : `Die Betreuungsangebote ${joinNames(names.map((name) => `„${name}“`))} passen nicht zu diesem Regeltermin.`;
}

function quotedNames(names: readonly string[]): string {
  return joinNames(names.map((name) => `„${name}“`));
}

/**
 * Sources of an ended phase (#8203). They are invalid as well; the sentence
 * says why instead of the general „passt nicht“.
 */
function expiredSentence(state: TemplateRosterMaintenance): string | null {
  const names = (state.expiredOfferings ?? []).map((offering) => offering.name);
  if (names.length === 0) return null;
  return names.length === 1
    ? `${quotedNames(names)} ist ein Angebot aus abgelaufener Phase. Neue Anmeldungen kommen hier nicht mehr an.`
    : `${quotedNames(names)} sind Angebote aus abgelaufener Phase. Neue Anmeldungen kommen hier nicht mehr an.`;
}

/** Invalid sources other than the expired ones, which have their own sentence. */
function otherInvalidNames(state: TemplateRosterMaintenance): string[] {
  const expired = new Set(
    (state.expiredOfferings ?? []).map((offering) => offering.name),
  );
  return state.invalidOfferingNames.filter((name) => !expired.has(name));
}

const TARGETS_SENTENCE =
  "Wechselt ein Kind Klasse oder Gruppe, passt moto die kommenden Termine an. Neue Kinder stehen erst in später geplanten Terminen.";

export function describeRosterMaintenance(
  state: TemplateRosterMaintenance,
): RosterMaintenanceDescription {
  const sentences: string[] = [];
  if (state.mode === "automatic") {
    sentences.push("Neue Anmeldungen werden automatisch übernommen.");
    sentences.push(`Quelle: ${offeringPhrase(state.offeringNames)}.`);
    const filter = filterSentence(state);
    if (filter) sentences.push(filter);
  } else if (state.mode === "partial") {
    sentences.push(
      `Neue Anmeldungen für ${state.offeringNames.length === 1 ? "das" : "die"} ${offeringPhrase(state.offeringNames)} werden automatisch übernommen.`,
    );
    const filter = filterSentence(state);
    if (filter) sentences.push(filter);
    const inactive = inactiveSentence(state.inactiveOfferingNames);
    if (inactive) sentences.push(inactive);
    const expired = expiredSentence(state);
    if (expired) sentences.push(expired);
    const invalid = invalidSourceSentence(otherInvalidNames(state));
    if (invalid) sentences.push(invalid);
    if (state.dynamicTargets) sentences.push(TARGETS_SENTENCE);
    sentences.push("Weitere Kinder musst du selbst ergänzen.");
  } else {
    sentences.push(
      "An- und Abmeldungen werden hier nicht übernommen. Kinder pflegst du selbst.",
    );
    if (state.careOfferingsDisabled) {
      sentences.push("Betreuungsangebote sind an deiner Schule ausgeschaltet.");
    } else {
      const inactive = inactiveSentence(state.inactiveOfferingNames);
      if (inactive) sentences.push(inactive);
      const expired = expiredSentence(state);
      if (expired) sentences.push(expired);
      const invalid = invalidSourceSentence(otherInvalidNames(state));
      if (invalid) sentences.push(invalid);
    }
    if (state.dynamicTargets) sentences.push(TARGETS_SENTENCE);
  }
  return {
    mode: state.mode,
    label: LABELS[state.mode],
    explanation: sentences.join(" "),
  };
}

/**
 * „Mit neuem Angebot verbinden“ (#8203): the connection a Regeltermin with a
 * source of an ended phase is offered. The suggested successors are
 * preselected, the Klassen- or Jahrgangsfilter stays. A source of an ended
 * phase leaves the others invalid too (one phase per source), so the dialog
 * starts from the successors and the school may add more. Shaped as a
 * roster deviation, so the existing connect dialog shows the preview and
 * confirms it. Null when no source expired; without any successor nothing
 * is preselected and the school picks the offering in the dialog.
 */
export function expiredSourceConnection(
  template: Pick<
    TimetableTemplate,
    "id" | "rosterMaintenance" | "sourceGradeLevels" | "sourceSchoolClasses"
  >,
): RosterDeviation | null {
  const expired = template.rosterMaintenance?.expiredOfferings ?? [];
  if (expired.length === 0) return null;
  const offerings: Array<{ id: string; name: string }> = [];
  for (const { successor } of expired) {
    if (successor && !offerings.some((known) => known.id === successor.id)) {
      offerings.push(successor);
    }
  }
  return {
    templateId: template.id,
    offerings,
    gradeLevels: template.sourceGradeLevels ?? [],
    schoolClasses: template.sourceSchoolClasses ?? [],
    unbookedCount: 0,
    missingCount: 0,
    candidates: [],
    combinations: [],
    // Without a successor nothing is preselected; the dialog asks for one.
    ambiguous: false,
  };
}
