// Client-side API for Klassenlisteneinträge (#2382): Kinder des
// Klassenverbands OHNE OGS-Datensatz — nur Name + Klasse. Die Einträge
// erscheinen ausschließlich auf Klassenlisten und in der Klassenansicht
// ("Keine Betreuung"); Anwesenheit, Betreuungsplanung und Elternportal
// kennen sie strukturell nicht.

import { bffJson } from "./bff-fetch";
import type * as classListEntriesContract from "./contract/class-list-entries.generated";

export interface ClassListEntry {
  id: string;
  firstName: string;
  lastName: string;
  schoolClass: string;
  createdAt: string;
  // IDs regulärer Kinder mit gleichem Namen in derselben Klasse — der
  // Hinweis für die bewusste Zuordnung. Nie automatisch zusammengeführt.
  matchingStudentIds: string[];
}

export interface ClassListEntryInput {
  firstName: string;
  lastName: string;
  schoolClass: string;
}

function mapEntry(
  wire: classListEntriesContract.ClassListEntryResponse,
): ClassListEntry {
  return {
    id: wire.id,
    firstName: wire.first_name,
    lastName: wire.last_name,
    schoolClass: wire.school_class,
    createdAt: wire.created_at,
    matchingStudentIds: wire.matching_student_ids ?? [],
  };
}

// Code, Feldfehler und Vorgangskennung reisen im ApiError weiter (#2513);
// die Meldung des Backends steht in dessen `detail`.
const errorMessage = "Klassenlisteneintrag: Anfrage fehlgeschlagen";

function toWireInput(
  input: ClassListEntryInput,
): classListEntriesContract.ClassListEntryRequest {
  return {
    first_name: input.firstName.trim(),
    last_name: input.lastName.trim(),
    school_class: input.schoolClass.trim(),
  };
}

export async function fetchClassListEntries(): Promise<ClassListEntry[]> {
  const entries = await bffJson("tenant", "GET /api/class-list-entries/", {
    errorMessage,
  });
  return entries.map(mapEntry);
}

export async function createClassListEntry(
  input: ClassListEntryInput,
): Promise<ClassListEntry> {
  return mapEntry(
    await bffJson("tenant", "POST /api/class-list-entries/", {
      body: toWireInput(input),
      errorMessage,
    }),
  );
}

export async function updateClassListEntry(
  id: string,
  input: ClassListEntryInput,
): Promise<ClassListEntry> {
  return mapEntry(
    await bffJson("tenant", "PUT /api/class-list-entries/{id}", {
      params: { id },
      body: toWireInput(input),
      errorMessage,
    }),
  );
}

export async function deleteClassListEntry(id: string): Promise<void> {
  await bffJson("tenant", "DELETE /api/class-list-entries/{id}", {
    params: { id },
    errorMessage,
  });
}

export async function assignClassListEntry(
  id: string,
  studentId: string,
): Promise<void> {
  await bffJson("tenant", "POST /api/class-list-entries/{id}/assign", {
    params: { id },
    body: { student_id: studentId },
    errorMessage,
  });
}
