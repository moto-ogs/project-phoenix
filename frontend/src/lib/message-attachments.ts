/**
 * Fotos und Dateien an Nachrichten (#6685), für alle drei Chats und beide
 * Portale. Eine Datei wird zuerst hochgeladen; die Nachricht nennt dann die
 * IDs ihrer Uploads. Die Grenzen hier spiegeln das Backend
 * (modules/communication/message_attachments.go), das sie erneut prüft.
 */
import { bffFile, bffJson, bffPath } from "~/lib/bff-fetch";
import type * as sharedContract from "~/lib/contract/shared.generated";

/** Ein Anhang, wie ihn der Upload und jede Unterhaltung liefert. */
export type MessageAttachment = Readonly<sharedContract.UploadResponse>;

export const MAX_MESSAGE_ATTACHMENTS = 5;
export const MAX_MESSAGE_ATTACHMENT_MB = 10;
const MAX_MESSAGE_ATTACHMENT_BYTES = MAX_MESSAGE_ATTACHMENT_MB * 1024 * 1024;

/** Endungen, die der Dateidialog anbietet und der Upload annimmt. */
export const MESSAGE_ATTACHMENT_ACCEPT =
  ".png,.jpg,.jpeg,.pdf,.docx,.xlsx,.pptx";
const ACCEPTED_EXTENSIONS = MESSAGE_ATTACHMENT_ACCEPT.split(",");

/** Warum eine gewählte Datei nicht angehängt wird. */
export type AttachmentRefusal =
  | { readonly kind: "too_many" }
  | { readonly kind: "too_large"; readonly filename: string }
  | { readonly kind: "type"; readonly filename: string };

/**
 * Teilt die gewählten Dateien in die, die angehängt werden, und die Gründe
 * für den Rest. `held` ist die Zahl der Anhänge, die die Nachricht schon hat.
 */
export function checkAttachmentFiles(
  held: number,
  files: readonly File[],
): { accepted: File[]; refusals: AttachmentRefusal[] } {
  const accepted: File[] = [];
  const refusals: AttachmentRefusal[] = [];
  for (const file of files) {
    const name = file.name.toLowerCase();
    if (!ACCEPTED_EXTENSIONS.some((extension) => name.endsWith(extension))) {
      refusals.push({ kind: "type", filename: file.name });
    } else if (file.size > MAX_MESSAGE_ATTACHMENT_BYTES) {
      refusals.push({ kind: "too_large", filename: file.name });
    } else if (held + accepted.length >= MAX_MESSAGE_ATTACHMENTS) {
      if (!refusals.some((refusal) => refusal.kind === "too_many")) {
        refusals.push({ kind: "too_many" });
      }
    } else {
      accepted.push(file);
    }
  }
  return { accepted, refusals };
}

/** Wo ein Chat seine Anhänge hochlädt und abruft. */
export interface MessageAttachmentRoutes {
  /** Lädt eine Datei hoch und liefert den Anhang für die nächste Nachricht. */
  readonly upload: (
    file: File,
    signal?: AbortSignal,
  ) => Promise<MessageAttachment>;
  /** Die Adresse, die einen Anhang speichert (`<a href>`, `<img src>`). */
  readonly downloadUrl: (attachmentId: string) => string;
  /**
   * Lädt die Bytes eines Anhangs für die Ansicht in der Seite: ein PDF zeigt
   * der Betrachter aus einer Object-URL, weil die App sich nicht rahmen lässt.
   */
  readonly loadFile: (attachmentId: string) => Promise<Blob>;
}

const UPLOAD_FAILED = "Die Datei konnte nicht hochgeladen werden";
const LOAD_FAILED = "Die Datei konnte nicht geladen werden";

function uploadForm(file: File): FormData {
  const form = new FormData();
  form.append("file", file, file.name);
  return form;
}

const blobOf = (response: Response): Promise<Blob> => response.blob();

export const PARENT_MESSAGE_ATTACHMENTS: MessageAttachmentRoutes = {
  upload: (file, signal) =>
    bffJson("tenant", "POST /api/messages/attachments", {
      body: uploadForm(file),
      signal,
      errorMessage: UPLOAD_FAILED,
    }),
  downloadUrl: (attachmentId) =>
    bffPath("tenant", "/api/messages/attachments/{attachmentId}/download", {
      attachmentId,
    }),
  loadFile: (attachmentId) =>
    bffFile("tenant", "GET /api/messages/attachments/{attachmentId}/download", {
      params: { attachmentId },
      query: { inline: "1" },
      errorMessage: LOAD_FAILED,
    }).then(blobOf),
};

export const STAFF_MESSAGE_ATTACHMENTS: MessageAttachmentRoutes = {
  upload: (file, signal) =>
    bffJson("tenant", "POST /api/staff-messages/attachments", {
      body: uploadForm(file),
      signal,
      errorMessage: UPLOAD_FAILED,
    }),
  downloadUrl: (attachmentId) =>
    bffPath(
      "tenant",
      "/api/staff-messages/attachments/{attachmentId}/download",
      { attachmentId },
    ),
  loadFile: (attachmentId) =>
    bffFile(
      "tenant",
      "GET /api/staff-messages/attachments/{attachmentId}/download",
      {
        params: { attachmentId },
        query: { inline: "1" },
        errorMessage: LOAD_FAILED,
      },
    ).then(blobOf),
};

// The school portal's chat files live beside its mount, at
// /school-staff-messages (#6685); its proxy reaches them under its prefix.
export const SCHOOL_STAFF_MESSAGE_ATTACHMENTS: MessageAttachmentRoutes = {
  upload: (file, signal) =>
    bffJson("school", "POST /school-staff-messages/attachments", {
      body: uploadForm(file),
      signal,
      errorMessage: UPLOAD_FAILED,
    }),
  downloadUrl: (attachmentId) =>
    bffPath(
      "school",
      "/school-staff-messages/attachments/{attachmentId}/download",
      { attachmentId },
    ),
  loadFile: (attachmentId) =>
    bffFile(
      "school",
      "GET /school-staff-messages/attachments/{attachmentId}/download",
      {
        params: { attachmentId },
        query: { inline: "1" },
        errorMessage: LOAD_FAILED,
      },
    ).then(blobOf),
};

/** Die Anhänge der Eltern hängen am Kind, über das sie schreiben. */
export function guardianMessageAttachments(
  studentId: string,
): MessageAttachmentRoutes {
  return {
    upload: (file, signal) =>
      bffJson(
        "parent",
        "POST /parent/me/messages/children/{studentId}/attachments",
        {
          params: { studentId },
          body: uploadForm(file),
          signal,
          errorMessage: UPLOAD_FAILED,
        },
      ),
    downloadUrl: (attachmentId) =>
      bffPath(
        "parent",
        "/parent/me/messages/children/{studentId}/attachments/{attachmentId}/download",
        { studentId, attachmentId },
      ),
    loadFile: (attachmentId) =>
      bffFile(
        "parent",
        "GET /parent/me/messages/children/{studentId}/attachments/{attachmentId}/download",
        {
          params: { studentId, attachmentId },
          query: { inline: "1" },
          errorMessage: LOAD_FAILED,
        },
      ).then(blobOf),
  };
}

/**
 * Die IDs als letztes Argument eines Sende-Aufrufs: ohne Anhänge entfällt
 * es, damit eine Nachricht nur mit Text genau wie bisher gesendet wird.
 */
export function attachmentIdArgs(
  attachments: readonly MessageAttachment[],
): [] | [string[]] {
  return attachments.length === 0
    ? []
    : [attachments.map((attachment) => attachment.id)];
}
