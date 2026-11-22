// Report-Vertrag der Klassenansicht (#1772): Tagesansicht einer Klasse;
// geschrieben werden Vormittagsanwesenheit, Übergabe an die OGS und
// Hausaufgaben. Das Backend scopt jeden Abruf auf die zugewiesenen Klassen der
// aufrufenden Person (education.class_teachers) und liefert hier nie
// Kontaktdaten der Sorgeberechtigten.
//
// Seit dem Cutover (#2207 PR 3) gibt es nur noch einen Abrufweg: das
// Schul-Portal über lib/school-class-day-api. Diese Datei trägt deshalb nur
// noch die Typen, die sich Ansicht und Abruf teilen.

import type * as schoolClassDayContract from "./contract/school-class-day.generated";

export type ClassDayRow = schoolClassDayContract.DayRow;
export type ClassDayHomework = schoolClassDayContract.DayHomework;
export type ClassDayHint = schoolClassDayContract.DayHint;
export type ClassDayHandover = schoolClassDayContract.DayHandover;

/** Der Tag einer Klasse; ohne Zeilen eine leere Liste. */
export type ClassDayReport = Omit<schoolClassDayContract.DayReport, "rows"> & {
  rows: ClassDayRow[];
};

export const MORNING_ATTENDANCE_STATUSES = ["present", "absent"] as const;
export type MorningAttendanceStatus =
  (typeof MORNING_ATTENDANCE_STATUSES)[number];

/** Der Verfasser eines Hinweises, wenn er nicht von der Lehrkraft selbst ist. */
export function dayHintAuthorSuffix(hint: ClassDayHint): string {
  if (hint.own || !hint.author_name) return "";
  return ` (von ${hint.author_name})`;
}
