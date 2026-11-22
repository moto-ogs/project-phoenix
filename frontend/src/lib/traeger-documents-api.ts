import { bffFile, bffJson } from "~/lib/bff-fetch";
/**
 * Dokumente, die ein Träger mit Eltern und Schulen teilt (#4692).
 *
 * Der Träger lädt eine vorhandene Datei hoch und gibt sie frei: für die Eltern
 * aller Schulen, einer Schule oder einer Gruppe, oder für die Schulen. Eine
 * Freigabe lässt sich zurücknehmen. Die OGS-Leitung liest auf „Dateien“, was
 * für ihre Schule freigegeben ist. Backend-IDs werden hier zu Strings.
 */
import { apiErrorFromBody } from "~/lib/api-error";
import { filenameFromDisposition } from "~/lib/file-download";
import { knownEnum } from "./contract/known-enum";
import type * as traegerDocumentsContract from "./contract/traeger-documents.generated";

// Go does not register the set; the contract types it as string.
const AUDIENCE_VALUES = ["parents", "schools"] as const;

/** Größte Datei, die ein Träger teilt; das Backend prüft sie ebenso. */
export const TRAEGER_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

/** Die Dateiendungen, die das Backend annimmt (Inhalt wird mitgeprüft). */
export const TRAEGER_DOCUMENT_ACCEPT =
  ".pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg";

export type TraegerDocumentAudience = (typeof AUDIENCE_VALUES)[number];

export interface TraegerDocumentRelease {
  readonly id: string;
  readonly audience: TraegerDocumentAudience;
  /** `null`: alle Schulen des Trägers. */
  readonly schoolId: string | null;
  readonly groupId: string | null;
  /** Name der Gruppe bei der Freigabe. */
  readonly groupName: string;
  readonly releasedAt: string;
}

export interface TraegerDocument {
  readonly id: string;
  readonly title: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly createdAt: string;
  readonly releases: readonly TraegerDocumentRelease[];
  /** Wie oft Eltern und Schulen das Dokument geöffnet haben. */
  readonly reads: number;
}

/** Ein Dokument, wie die Schule es sieht. */
export interface SharedTraegerDocument {
  readonly id: string;
  readonly title: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly releasedAt: string;
  readonly releases: readonly TraegerDocumentRelease[];
}

interface TraegerDocumentGroup {
  readonly id: string;
  readonly name: string;
}

export interface TraegerDocumentSchool {
  readonly id: string;
  readonly name: string;
  readonly groups: readonly TraegerDocumentGroup[];
}

export interface TraegerDocumentReleaseInput {
  readonly audience: TraegerDocumentAudience;
  readonly schoolId: string | null;
  readonly groupId: string | null;
}

/**
 * The releases this build knows; a release to an audience it does not know
 * has no row to show and is left out.
 */
function releasesFromBackend(
  releases: readonly traegerDocumentsContract.TraegerDocumentRelease[] | null,
): TraegerDocumentRelease[] {
  return (releases ?? []).flatMap((release) => {
    const mapped = mapTraegerDocumentRelease(release);
    return mapped ? [mapped] : [];
  });
}

function mapTraegerDocumentRelease(
  release: traegerDocumentsContract.TraegerDocumentRelease,
): TraegerDocumentRelease | null {
  const audience = knownEnum(AUDIENCE_VALUES, release.audience);
  if (!audience) return null;
  return {
    id: release.id,
    audience,
    schoolId: release.school_id,
    groupId: release.group_id,
    groupName: release.group_name,
    releasedAt: release.released_at,
  };
}

function mapDocument(
  document: traegerDocumentsContract.TraegerDocument,
): TraegerDocument {
  return {
    id: document.id,
    title: document.title,
    fileName: document.file_name,
    contentType: document.content_type,
    sizeBytes: document.size_bytes,
    createdAt: document.created_at,
    releases: releasesFromBackend(document.releases),
    reads: document.reads,
  };
}

function mapSharedDocument(
  document: traegerDocumentsContract.SharedDocument,
): SharedTraegerDocument {
  return {
    id: document.id,
    title: document.title,
    fileName: document.file_name,
    contentType: document.content_type,
    sizeBytes: document.size_bytes,
    releasedAt: document.released_at,
    releases: releasesFromBackend(document.releases),
  };
}

/** Die Dokumente des Trägers, das neueste zuerst. */
export async function fetchTraegerDocuments(): Promise<TraegerDocument[]> {
  const documents = await bffJson("org", "GET /traeger/documents/");
  return documents.map(mapDocument);
}

/** Die Schulen des Trägers mit ihren Gruppen, für eine Freigabe. */
export async function fetchTraegerDocumentAudiences(): Promise<
  TraegerDocumentSchool[]
> {
  const schools = await bffJson("org", "GET /traeger/documents/audiences");
  return schools.map((school) => ({
    id: school.id,
    name: school.name,
    groups: (school.groups ?? []).map((group) => ({
      id: group.id,
      name: group.name,
    })),
  }));
}

/** Lädt eine Datei mit Titel hoch. Wirft einen ApiError bei Ablehnung. */
export async function uploadTraegerDocument(
  title: string,
  file: File,
): Promise<TraegerDocument> {
  const form = new FormData();
  form.append("title", title);
  form.append("file", file);
  return mapDocument(
    await bffJson("org", "POST /traeger/documents/", { body: form }),
  );
}

/** Gibt ein Dokument frei. Wirft einen ApiError bei Ablehnung. */
export async function releaseTraegerDocument(
  documentId: string,
  input: TraegerDocumentReleaseInput,
): Promise<TraegerDocumentRelease> {
  const release = await bffJson(
    "org",
    "POST /traeger/documents/{id}/releases",
    {
      params: { id: documentId },
      body: {
        audience: input.audience,
        school_id: input.schoolId === null ? null : input.schoolId,
        group_id: input.groupId === null ? null : input.groupId,
      } satisfies traegerDocumentsContract.ReleaseRequest,
    },
  );
  const mapped = mapTraegerDocumentRelease(release);
  if (!mapped) {
    throw apiErrorFromBody("Release with an unknown audience", 502, release);
  }
  return mapped;
}

/** Nimmt eine Freigabe zurück. Wirft einen ApiError bei Ablehnung. */
export async function revokeTraegerDocumentRelease(
  documentId: string,
  releaseId: string,
): Promise<void> {
  await bffJson("org", "DELETE /traeger/documents/{id}/releases/{releaseId}", {
    params: { id: documentId, releaseId },
  });
}

/**
 * Löscht ein Dokument mit allen Freigaben (#5993). Wirft einen ApiError bei
 * Ablehnung; dann ist nichts geändert.
 */
export async function deleteTraegerDocument(documentId: string): Promise<void> {
  await bffJson("org", "DELETE /traeger/documents/{id}", {
    params: { id: documentId },
  });
}

async function downloadFrom(
  file: Promise<Response>,
): Promise<{ readonly blob: Blob; readonly filename: string | null }> {
  const response = await file;
  return {
    blob: await response.blob(),
    filename: filenameFromDisposition(response),
  };
}

/** Die Datei eines Dokuments des Trägers. */
export function downloadTraegerDocument(documentId: string) {
  return downloadFrom(
    bffFile("org", "GET /traeger/documents/{id}/file", {
      params: { id: documentId },
    }),
  );
}

/** Die Dokumente, die der Träger für die eigene Schule freigegeben hat. */
export async function fetchSchoolTraegerDocuments(): Promise<
  SharedTraegerDocument[]
> {
  const documents = await bffJson("tenant", "GET /api/traeger-documents/");
  return (documents ?? []).map(mapSharedDocument);
}

/** Die Datei eines Dokuments, das der Träger für die Schule freigab. */
export function downloadSchoolTraegerDocument(documentId: string) {
  return downloadFrom(
    bffFile("tenant", "GET /api/traeger-documents/{id}/file", {
      params: { id: documentId },
    }),
  );
}
