/**
 * Staff-side client for parent announcements (Elternmitteilungen, #1669):
 * tenant-authored broadcast news to guardians. Calls the registered routes
 * under /api/parent-announcements through bffJson (#7806); moto schule reaches
 * the same handlers under /school/parent-letters. Backend int64 ids arrive
 * already stringified.
 */

import type {
  EmailAddressMark,
  MailProviderBlock,
  MailOutcome,
} from "~/lib/email-delivery-status";
import { bffFile, bffFileHref, bffJson } from "~/lib/bff-fetch";
import type * as parentAnnouncementsContract from "~/lib/contract/parent-announcements.generated";
import type * as attachmentContract from "~/lib/contract/announcement-attachments.generated";
import type * as sharedContract from "~/lib/contract/shared.generated";
import { downloadBlob, filenameFromDisposition } from "~/lib/file-download";

export type AnnouncementPriority = "info" | "important";
export type AnnouncementStatus = "draft" | "published" | "expired";

export type AnnouncementTargetType =
  | "school_all"
  | "class"
  | "group"
  | "activity_group"
  | "student"
  | "pending_enrollment";

export type AnnouncementTarget = Omit<
  sharedContract.targetResponse,
  "target_type"
> & {
  target_type: AnnouncementTargetType;
};

/**
 * "none" is a plain Mitteilung; the two choice types make it an Umfrage that
 * parents answer per child (#1371).
 */
export type AnnouncementResponseType =
  "none" | "single_choice" | "multi_choice";

/**
 * How the announcement is delivered. "letter" is the Elternbrief (#2384):
 * e-mail and confirmation are mandatory and the mail carries the full text.
 * "declaration" is the Einverständnis (#3430): parents agree or decline per
 * child, with a frozen version and a proof.
 */
type AnnouncementDeliveryMode = "standard" | "letter" | "declaration";

/**
 * What an Einverständnis asks for (#3430). Only "consent" (Zustimmen or
 * Ablehnen) exists; a plain read confirmation is an Elternbrief with
 * Lesebestätigung. The backend defaults a missing kind to "consent".
 */
type DeclarationKind = "consent";

/** Whether one entitled guardian per child is enough, or all of them. */
export type DeclarationSigners = "any" | "all";

/**
 * Who receives the e-mail — a separate axis from who sees the announcement in
 * the portal. "portal_only" is the default and the safe one; "all_contacts"
 * additionally reaches guardians that have an address but no portal access.
 */
export type AnnouncementEmailAudience = "portal_only" | "all_contacts";

/**
 * An announcement with the values the backend writes for its open enums
 * and its lists never null. `system_kind` is set on rows the system wrote,
 * e.g. the cancellation notice (#2601). `sender_name` and
 * `sender_school_class` name the Lehrkraft of a class letter from moto schule
 * (#4800): the OGS reads such a letter but does not change it. A scheduled
 * reminder (#3162) carries `reminder_at`, `reminder_text` and, once sent,
 * `reminder_sent_at`. The `declaration_*` settings (#3430, signature #4785)
 * are present only for an Einverständnis; `declaration_locked_attachments` is
 * true once a version exists.
 */
export type Announcement = Omit<
  sharedContract.announcementResponse,
  | "priority"
  | "status"
  | "targets"
  | "response_type"
  | "options"
  | "delivery_mode"
  | "email_audience"
  | "system_kind"
  | "declaration_kind"
  | "declaration_signers"
> & {
  priority: AnnouncementPriority;
  status: AnnouncementStatus;
  targets: AnnouncementTarget[];
  response_type: AnnouncementResponseType;
  options: sharedContract.optionResponse[];
  delivery_mode: AnnouncementDeliveryMode;
  email_audience: AnnouncementEmailAudience;
  system_kind?: "care_cancellation";
  declaration_kind?: DeclarationKind;
  declaration_signers?: DeclarationSigners;
};

/** True when the announcement is an Einverständnis (#3430). */
export function isDeclaration(announcement: Announcement): boolean {
  return announcement.delivery_mode === "declaration";
}

/** True when the announcement is a binding Elternbrief. */
export function isLetter(announcement: Announcement): boolean {
  return announcement.delivery_mode === "letter";
}

/** True when a Lehrkraft wrote the announcement in moto schule (#4800). */
export function isClassLetter(announcement: Announcement): boolean {
  return !!announcement.sender_school_class;
}

/** True when the announcement asks the parents a question. */
export function isPoll(announcement: Announcement): boolean {
  return announcement.response_type !== "none";
}

/** The tally of a poll: per option, how many reached children picked it. */
export type PollResults = Omit<
  parentAnnouncementsContract.pollResultsResponse,
  "options"
> & {
  options: parentAnnouncementsContract.pollOptionResultResponse[];
};

/** One reached child with the answer given for them (empty = still open). */
export type PollChild = Omit<
  parentAnnouncementsContract.pollChildResponse,
  "answer_labels"
> & {
  answer_labels: string[];
};

type AnnouncementRecipientStatus = "pending" | "read" | "acknowledged";

/** One guardian account in the live audience with their read/ack state. */
export type AnnouncementRecipient = Omit<
  sharedContract.recipientResponse,
  "status"
> & {
  status: AnnouncementRecipientStatus;
};

/**
 * What the form sends. Omit `response_type` or send "none" for a plain
 * Mitteilung; a choice type requires `options`, the answer labels in display
 * order (the backend assigns the option ids). "letter" as `delivery_mode`
 * makes it an Elternbrief: the backend then forces `send_email` and
 * `requires_acknowledgement` on. `reminder_at` is an instant (ISO) or null for
 * no reminder (#3162); the `declaration_*` settings apply only with
 * delivery_mode "declaration" (#3430).
 */
export type AnnouncementInput = Omit<
  sharedContract.announcementRequest,
  | "title"
  | "body"
  | "priority"
  | "requires_acknowledgement"
  | "send_email"
  | "targets"
  | "response_type"
  | "options"
  | "delivery_mode"
  | "email_audience"
  | "declaration_kind"
  | "declaration_signers"
> &
  Required<
    Pick<
      sharedContract.announcementRequest,
      "title" | "body" | "requires_acknowledgement" | "send_email"
    >
  > & {
    priority: AnnouncementPriority;
    targets: AnnouncementTarget[];
    response_type?: AnnouncementResponseType;
    options?: string[];
    delivery_mode?: AnnouncementDeliveryMode;
    email_audience?: AnnouncementEmailAudience;
    declaration_kind?: DeclarationKind;
    declaration_signers?: DeclarationSigners;
  };

/**
 * The one edit a published announcement still accepts (#3162): move, reword
 * or remove (reminder_at null) its scheduled reminder, until it has been sent.
 */
export type AnnouncementReminderInput = Omit<
  parentAnnouncementsContract.reminderRequest,
  "reminder_at"
> & {
  reminder_at: string | null;
};

/**
 * One addressed person in the recipient matrix. The two channels are reported
 * separately on purpose (#2384): "die E-Mail ist raus" and "jemand hat in moto
 * bestätigt" are different facts.
 *
 * email_status "sent" means handed to the mail server — label it "Versendet",
 * never "Zugestellt", until provider delivery events exist (#1937).
 * "not_sent" means nothing was queued — `reachability` says why. The two are
 * separate vocabularies on purpose; collapsing them is what would let a
 * school read "kein Portalzugang" as a delivery failure. `mail_outcome` is
 * what became of the mail (only a provider's report says delivered),
 * `stopped` that the school stopped mail to this person, `stop_shared` that
 * another holder of the address carries no stop, `departed` that no holder of
 * the address has a child in care at the school now, and `mailed_to` where
 * the mail went (`email` is the current address).
 */
export type LetterRecipient = Omit<
  sharedContract.letterRecipientResponse,
  | "email_status"
  | "mail_outcome"
  | "address_mark"
  | "provider_block"
  | "reachability"
> & {
  email_status: "not_sent" | "pending" | "sent" | "failed" | "cancelled";
  mail_outcome?: MailOutcome;
  address_mark?: EmailAddressMark;
  provider_block?: MailProviderBlock;
  reachability: "ok" | "no_email" | "no_portal" | "excluded";
};

/**
 * The Elternbrief recipient matrix. A child with `can_confirm` false has NO
 * guardian who can acknowledge in moto: reached by the letter but never
 * confirmable, a data gap a reminder cannot close, so never counted "offen".
 */
export type LetterStatus = Omit<
  sharedContract.letterStatusResponse,
  "recipients" | "children"
> & {
  recipients: LetterRecipient[];
  children: sharedContract.letterChildResponse[];
};

/* --- Einverständnisse (#3430) --------------------------------------------- */

/** Per-child state of an Einverständnis for its current version. */
export type DeclarationChildState =
  | "open"
  | "partial"
  | "agreed"
  | "declined"
  | "revoked"
  | "no_signer"
  | "expired";

/** What one guardian did. */
export type DeclarationAction = "agreed" | "declined" | "revoked";

/**
 * A frozen version (Fassung) of the Einverständnis, created on publish, with
 * title and full text as frozen; `integrity_ok` is false when the stored text
 * no longer matches its checksum.
 */
export type DeclarationVersion = Omit<
  sharedContract.declarationVersionResponse,
  "attachments"
> & {
  attachments: sharedContract.declarationAttachmentResponse[];
};

type DeclarationSigner = Omit<
  sharedContract.declarationSignerResponse,
  "action"
> & {
  action: DeclarationAction | null;
};

export type DeclarationChild = Omit<
  sharedContract.declarationChildResponse,
  "state" | "signers"
> & {
  state: DeclarationChildState;
  signers: DeclarationSigner[];
};

/**
 * One entry of the full history, across all versions, newest first, with the
 * stored signature without the image (#4785); the signature's `integrity_ok`
 * is false when the image or its record changed after signing.
 */
export type DeclarationSubmission = Omit<
  sharedContract.declarationSubmissionResponse,
  "action" | "signature"
> & {
  action: DeclarationAction;
  signature:
    | (Omit<sharedContract.declarationSignatureResponse, "method"> & {
        method: "drawn" | "typed";
      })
    | null;
};

const DECLARATION_SUMMARY_KEYS = [
  "children_total",
  "agreed",
  "declined",
  "revoked",
  "partial",
  "open",
  "no_signer",
  "expired",
] as const;

/** The children of an Einverständnis counted per state. */
type DeclarationSummary = Readonly<
  Record<(typeof DECLARATION_SUMMARY_KEYS)[number], number>
>;

/** `integrity_ok` is false when any version or history entry fails its checksum. */
export type DeclarationStatus = Omit<
  sharedContract.declarationStatusResponse,
  | "kind"
  | "signers"
  | "current_version"
  | "versions"
  | "summary"
  | "children"
  | "submissions"
> & {
  kind: DeclarationKind;
  signers: DeclarationSigners;
  current_version: DeclarationVersion | null;
  versions: DeclarationVersion[];
  summary: DeclarationSummary;
  children: DeclarationChild[];
  submissions: DeclarationSubmission[];
};

const BASE = "tenant";

/**
 * The routes of a class letter in moto schule (#4800): the same announcement
 * calls behind the school session. Every call below takes the portal selector; the OGS
 * portal uses the default.
 */
export const SCHOOL_PARENT_LETTERS_BASE = "school";

/** Where an announcement call goes: the OGS portal or moto schule. */
export type AnnouncementApiBase =
  typeof BASE | typeof SCHOOL_PARENT_LETTERS_BASE;

/** Runs the call of the portal the base names. */
function onPortal<T>(
  base: AnnouncementApiBase,
  tenant: () => Promise<T>,
  school: () => Promise<T>,
): Promise<T> {
  return base === SCHOOL_PARENT_LETTERS_BASE ? school() : tenant();
}

/**
 * Calls an announcement route of the given portal. Without a base the call
 * stays exactly the OGS call, so its default applies.
 */
export function withApiBase<T>(
  call: (id: string, base?: AnnouncementApiBase) => Promise<T>,
  id: string,
  base: AnnouncementApiBase | undefined,
): Promise<T> {
  return base === undefined ? call(id) : call(id, base);
}

export function toAnnouncement(
  announcement: sharedContract.announcementResponse,
): Announcement {
  // The backend writes the enum values listed above.
  return {
    ...announcement,
    targets: announcement.targets ?? [],
    options: announcement.options ?? [],
  } as Announcement;
}

function toSigner(
  signer: sharedContract.declarationSignerResponse,
): DeclarationSigner {
  return signer as DeclarationSigner;
}

function toVersion(
  version: sharedContract.declarationVersionResponse,
): DeclarationVersion {
  return { ...version, attachments: version.attachments ?? [] };
}

export async function fetchAnnouncements(
  includeInactive = true,
  base: AnnouncementApiBase = BASE,
): Promise<Announcement[]> {
  const errorMessage = "Elternmitteilungen konnten nicht geladen werden";
  const rows = await onPortal(
    base,
    () =>
      bffJson("tenant", "GET /api/parent-announcements/", {
        ...(includeInactive && { query: { include_inactive: true } }),
        errorMessage,
      }),
    () => bffJson("school", "GET /school/parent-letters/", { errorMessage }),
  );
  return rows.map(toAnnouncement);
}

/**
 * One announcement with its targets, for the object page
 * /parent-announcements/[id] (#3115).
 */
export async function fetchAnnouncement(
  id: string,
  base: AnnouncementApiBase = BASE,
): Promise<Announcement> {
  const errorMessage = "Elternmitteilung konnte nicht geladen werden";
  const params = { announcementId: id };
  return toAnnouncement(
    await onPortal(
      base,
      () =>
        bffJson("tenant", "GET /api/parent-announcements/{announcementId}", {
          params,
          errorMessage,
        }),
      () =>
        bffJson("school", "GET /school/parent-letters/{announcementId}", {
          params,
          errorMessage,
        }),
    ),
  );
}

export async function createAnnouncement(
  input: AnnouncementInput,
  base: AnnouncementApiBase = BASE,
): Promise<Announcement> {
  const errorMessage = "Elternmitteilung konnte nicht erstellt werden";
  return toAnnouncement(
    await onPortal(
      base,
      () =>
        bffJson("tenant", "POST /api/parent-announcements/", {
          body: input,
          errorMessage,
        }),
      () =>
        bffJson("school", "POST /school/parent-letters/", {
          body: input,
          errorMessage,
        }),
    ),
  );
}

/**
 * Speichert den Entwurf, der mit `expectedVersion` gelesen wurde (ADR 0311);
 * hat ihn jemand seitdem geändert, lehnt der Server ab.
 */
export async function updateAnnouncement(
  id: string,
  input: AnnouncementInput,
  expectedVersion: string,
): Promise<Announcement> {
  return toAnnouncement(
    await bffJson("tenant", "PUT /api/parent-announcements/{announcementId}", {
      params: { announcementId: id },
      body: { ...input, expected_version: expectedVersion },
      errorMessage: "Elternmitteilung konnte nicht gespeichert werden",
    }),
  );
}

export async function updateAnnouncementReminder(
  id: string,
  input: AnnouncementReminderInput,
): Promise<Announcement> {
  return toAnnouncement(
    await bffJson(
      "tenant",
      "PUT /api/parent-announcements/{announcementId}/reminder",
      {
        params: { announcementId: id },
        body: input,
        errorMessage: "Erinnerung konnte nicht gespeichert werden",
      },
    ),
  );
}

export async function deleteAnnouncement(
  id: string,
  base: AnnouncementApiBase = BASE,
): Promise<void> {
  const errorMessage = "Elternmitteilung konnte nicht gelöscht werden";
  const params = { announcementId: id };
  await onPortal(
    base,
    () =>
      bffJson("tenant", "DELETE /api/parent-announcements/{announcementId}", {
        params,
        errorMessage,
      }),
    () =>
      bffJson("school", "DELETE /school/parent-letters/{announcementId}", {
        params,
        errorMessage,
      }),
  );
}

/**
 * Veröffentlicht den Entwurf, wie er gelesen wurde: `expectedVersion` ist
 * seine `version` (ADR 0311).
 */
export async function publishAnnouncement(
  id: string,
  expectedVersion: string,
  base: AnnouncementApiBase = BASE,
): Promise<Announcement> {
  const errorMessage = "Elternmitteilung konnte nicht veröffentlicht werden";
  const params = { announcementId: id };
  const body = { expected_version: expectedVersion };
  return toAnnouncement(
    await onPortal(
      base,
      () =>
        bffJson(
          "tenant",
          "POST /api/parent-announcements/{announcementId}/publish",
          { params, body, errorMessage },
        ),
      () =>
        bffJson(
          "school",
          "POST /school/parent-letters/{announcementId}/publish",
          { params, body, errorMessage },
        ),
    ),
  );
}

export async function unpublishAnnouncement(
  id: string,
  base: AnnouncementApiBase = BASE,
): Promise<Announcement> {
  const errorMessage = "Elternmitteilung konnte nicht zurückgezogen werden";
  const params = { announcementId: id };
  return toAnnouncement(
    await onPortal(
      base,
      () =>
        bffJson(
          "tenant",
          "POST /api/parent-announcements/{announcementId}/unpublish",
          { params, errorMessage },
        ),
      () =>
        bffJson(
          "school",
          "POST /school/parent-letters/{announcementId}/unpublish",
          { params, errorMessage },
        ),
    ),
  );
}

/**
 * The read and confirmation counts. `recorded`: they refer to the parents
 * the publication reached (#6988); false for a draft and for announcements
 * published before recording, which count whoever the targets reach today.
 */
export async function fetchAnnouncementStats(
  id: string,
  base: AnnouncementApiBase = BASE,
): Promise<sharedContract.statsResponse> {
  const errorMessage = "Statistik konnte nicht geladen werden";
  const params = { announcementId: id };
  return onPortal(
    base,
    () =>
      bffJson(
        "tenant",
        "GET /api/parent-announcements/{announcementId}/stats",
        { params, errorMessage },
      ),
    () =>
      bffJson("school", "GET /school/parent-letters/{announcementId}/stats", {
        params,
        errorMessage,
      }),
  );
}

export async function fetchPollResults(id: string): Promise<PollResults> {
  const results = await bffJson(
    "tenant",
    "GET /api/parent-announcements/{announcementId}/poll-results",
    {
      params: { announcementId: id },
      errorMessage: "Umfrageergebnis konnte nicht geladen werden",
    },
  );
  return { ...results, options: results.options ?? [] };
}

export async function fetchPollChildren(id: string): Promise<PollChild[]> {
  const children = await bffJson(
    "tenant",
    "GET /api/parent-announcements/{announcementId}/poll-children",
    {
      params: { announcementId: id },
      errorMessage: "Antwortliste konnte nicht geladen werden",
    },
  );
  return children.map((child) => ({
    ...child,
    answer_labels: child.answer_labels ?? [],
  }));
}

/**
 * Notifies the guardians of children without an answer. Returns how many people
 * were reached so the UI can say "8 Eltern erinnert" instead of a silent OK.
 */
export async function remindUnanswered(
  id: string,
  base: AnnouncementApiBase = BASE,
): Promise<number> {
  const errorMessage = "Erinnerung konnte nicht gesendet werden";
  const params = { announcementId: id };
  const result = await onPortal(
    base,
    () =>
      bffJson(
        "tenant",
        "POST /api/parent-announcements/{announcementId}/remind",
        { params, errorMessage },
      ),
    () =>
      bffJson("school", "POST /school/parent-letters/{announcementId}/remind", {
        params,
        errorMessage,
      }),
  );
  return result.reminded_count;
}

/** The Elternbrief recipient matrix: per person, per child, plus the counts. */
export async function fetchLetterStatus(
  id: string,
  base: AnnouncementApiBase = BASE,
): Promise<LetterStatus> {
  const errorMessage = "Status konnte nicht geladen werden";
  const params = { announcementId: id };
  const status = await onPortal(
    base,
    () =>
      bffJson(
        "tenant",
        "GET /api/parent-announcements/{announcementId}/letter-status",
        { params, errorMessage },
      ),
    () =>
      bffJson(
        "school",
        "GET /school/parent-letters/{announcementId}/letter-status",
        { params, errorMessage },
      ),
  );
  return {
    ...status,
    // The backend writes the enum values listed above.
    recipients: (status.recipients ?? []) as LetterRecipient[],
    children: status.children ?? [],
  };
}

/**
 * The Einverständnis status (#3430): per child the state and who acted, the
 * frozen versions with their checksums, and the full history.
 */
export async function fetchDeclarationStatus(
  id: string,
  base: AnnouncementApiBase = BASE,
): Promise<DeclarationStatus> {
  const errorMessage = "Status konnte nicht geladen werden";
  const params = { announcementId: id };
  const status = await onPortal(
    base,
    () =>
      bffJson(
        "tenant",
        "GET /api/parent-announcements/{announcementId}/declaration-status",
        { params, errorMessage },
      ),
    () =>
      bffJson(
        "school",
        "GET /school/parent-letters/{announcementId}/declaration-status",
        { params, errorMessage },
      ),
  );
  const summary = Object.fromEntries(
    DECLARATION_SUMMARY_KEYS.map((key) => [key, status.summary?.[key] ?? 0]),
  ) as Record<(typeof DECLARATION_SUMMARY_KEYS)[number], number>;
  // The backend writes the enum values listed above.
  return {
    ...status,
    kind: status.kind as DeclarationKind,
    signers: status.signers as DeclarationSigners,
    current_version: status.current_version
      ? toVersion(status.current_version)
      : null,
    versions: (status.versions ?? []).map(toVersion),
    summary,
    children: (status.children ?? []).map((child) => ({
      ...child,
      state: child.state as DeclarationChildState,
      signers: (child.signers ?? []).map(toSigner),
    })),
    submissions: (status.submissions ?? []) as DeclarationSubmission[],
  };
}

/**
 * Downloads the Einverständnis report (PDF) or history (CSV) under the file name
 * the backend chose. Fetched first rather than opened as a link, so a failure
 * stays on the page as a message instead of replacing it with an error body.
 * With a child the proof holds only that child (Kinderakte, #4814).
 */
export async function downloadDeclarationExport(
  id: string,
  format: "csv" | "pdf",
  base: AnnouncementApiBase = BASE,
  studentId?: string,
): Promise<void> {
  const errorMessage = "Die Datei konnte nicht erstellt werden";
  const params = { announcementId: id };
  const query = { format, ...(studentId && { student_id: studentId }) };
  const response = await onPortal(
    base,
    () =>
      bffFile(
        "tenant",
        "GET /api/parent-announcements/{announcementId}/declaration-export",
        { params, query, errorMessage },
      ),
    () =>
      bffFile(
        "school",
        "GET /school/parent-letters/{announcementId}/declaration-export",
        { params, query, errorMessage },
      ),
  );
  const blob = await response.blob();
  downloadBlob(
    blob,
    filenameFromDisposition(response) ?? `erklaerung-${id}.${format}`,
  );
}

/* --- Kinderakte (#4814) ---------------------------------------------------- */

/** One Einverständnis of the child with its state on the current version. */
export type StudentParentDeclaration = Omit<
  parentAnnouncementsContract.studentDeclarationResponse,
  "state" | "signers"
> & {
  state: DeclarationChildState;
  signers: DeclarationSigner[];
};

/**
 * The letters and declarations of one child, newest first. A letter's
 * `can_confirm` is false when no guardian of the child has a parent account.
 */
export interface StudentParentRecords {
  letters: parentAnnouncementsContract.studentLetterResponse[];
  declarations: StudentParentDeclaration[];
}

/**
 * What the school sent one child's family and what the family declared, read
 * from the Elternbriefe and Einverständnisse themselves. The backend writes
 * every read to the access log.
 */
export async function fetchStudentParentRecords(
  studentId: string,
): Promise<StudentParentRecords> {
  const records = await bffJson(
    "tenant",
    "GET /api/parent-announcements/students/{studentId}",
    {
      params: { studentId },
      errorMessage:
        "Elternbriefe und Einverständnisse konnten nicht geladen werden",
    },
  );
  return {
    letters: records.letters ?? [],
    declarations: (records.declarations ?? []).map((declaration) => ({
      ...declaration,
      state: declaration.state as DeclarationChildState,
      signers: (declaration.signers ?? []).map(toSigner),
    })),
  };
}

/** Re-queue only the mails that failed. Separate from remindUnanswered. */
export async function resendFailedEmails(
  id: string,
  base: AnnouncementApiBase = BASE,
): Promise<number> {
  const errorMessage = "Erneuter Versand fehlgeschlagen";
  const params = { announcementId: id };
  const result = await onPortal(
    base,
    () =>
      bffJson(
        "tenant",
        "POST /api/parent-announcements/{announcementId}/resend-failed",
        { params, errorMessage },
      ),
    () =>
      bffJson(
        "school",
        "POST /school/parent-letters/{announcementId}/resend-failed",
        { params, errorMessage },
      ),
  );
  return result.resent_count;
}

export async function fetchAnnouncementRecipients(
  id: string,
  base: AnnouncementApiBase = BASE,
): Promise<AnnouncementRecipient[]> {
  const errorMessage = "Empfängerliste konnte nicht geladen werden";
  const params = { announcementId: id };
  const recipients = await onPortal(
    base,
    () =>
      bffJson(
        "tenant",
        "GET /api/parent-announcements/{announcementId}/recipients",
        { params, errorMessage },
      ),
    () =>
      bffJson(
        "school",
        "GET /school/parent-letters/{announcementId}/recipients",
        { params, errorMessage },
      ),
  );
  // The backend writes the statuses listed above.
  return recipients as AnnouncementRecipient[];
}

/* --- Anhänge (#2890) -------------------------------------------------------
 *
 * Eigener Pfad statt einer Unterroute von /api/parent-announcements: die
 * Bytes gehören der Dateiablage, die Mitteilung steuert nur den
 * Empfängerkreis bei.
 */

/**
 * Die Anhänge einer Mitteilung mit `max_count` (Höchstzahl je Mitteilung),
 * `max_bytes` (Größengrenze je Datei), `editable` (false, sobald die
 * Mitteilung veröffentlicht ist) und `announcement_version`: der Stand des
 * Entwurfs, zu dem die Liste gehört (ADR 0311).
 */
export type AnnouncementAttachmentList = Omit<
  attachmentContract.StaffAttachmentListResponse,
  "attachments"
> & {
  attachments: sharedContract.AnnouncementAttachmentResponse[];
};

export async function fetchAnnouncementAttachments(
  announcementId: string,
): Promise<AnnouncementAttachmentList> {
  const list = await bffJson(
    "tenant",
    "GET /api/announcement-attachments/{announcementId}",
    {
      params: { announcementId },
      errorMessage: "Anhänge konnten nicht geladen werden",
    },
  );
  return { ...list, attachments: list.attachments ?? [] };
}

/**
 * Lädt eine Datei an den Entwurf der Version `expectedVersion` (ADR 0311).
 * Die Anhänge gehören zu dem Stand, den die Veröffentlichung bestätigt: die
 * Antwort trägt die neue Version des Entwurfs, die das nächste Speichern
 * oder Veröffentlichen schickt.
 */
export function uploadAnnouncementAttachment(
  announcementId: string,
  file: File,
  expectedVersion: string,
): Promise<attachmentContract.UploadedAttachmentResponse> {
  const form = new FormData();
  form.append("file", file);
  return bffJson(
    "tenant",
    "POST /api/announcement-attachments/{announcementId}",
    {
      params: { announcementId },
      query: { expected_version: expectedVersion },
      body: form,
      errorMessage: "Die Datei konnte nicht hochgeladen werden",
    },
  );
}

/** Entfernt einen Anhang vom Entwurf der Version `expectedVersion` und
 * antwortet die neue Version des Entwurfs (ADR 0311). */
export async function deleteAnnouncementAttachment(
  announcementId: string,
  attachmentId: string,
  expectedVersion: string,
): Promise<string> {
  const removed = await bffJson(
    "tenant",
    "DELETE /api/announcement-attachments/{announcementId}/{attachmentId}",
    {
      params: { announcementId, attachmentId },
      body: { expected_version: expectedVersion },
      errorMessage: "Der Anhang konnte nicht entfernt werden",
    },
  );
  return removed.announcement_version;
}

/** Adresse, unter der das Personal einen Anhang zur Kontrolle öffnet. */
export function announcementAttachmentDownloadUrl(
  announcementId: string,
  attachmentId: string,
  inline = false,
): string {
  return bffFileHref(
    "tenant",
    "GET /api/announcement-attachments/{announcementId}/{attachmentId}/download",
    {
      params: { announcementId, attachmentId },
      query: inline ? { inline: "1" } : {},
    },
  );
}

// --- Serienbriefe (#4813) ----------------------------------------------------

/** The fixed list of placeholders a letter may name, written {{name}}. */
export function fetchLetterPlaceholders(
  base: AnnouncementApiBase = BASE,
): Promise<sharedContract.letterPlaceholderResponse[]> {
  const errorMessage = "Die Platzhalter konnten nicht geladen werden";
  return onPortal(
    base,
    () =>
      bffJson("tenant", "GET /api/parent-announcements/letter-placeholders", {
        errorMessage,
      }),
    () =>
      bffJson("school", "GET /school/parent-letters/letter-placeholders", {
        errorMessage,
      }),
  );
}

/**
 * Fills a letter text for one child of the school, before it is sent. Reads
 * the child's data, so the backend writes the access to the data access log.
 */
export function previewLetter(
  body: string,
  studentId: string,
  base: AnnouncementApiBase = BASE,
): Promise<sharedContract.letterPreviewResponse> {
  const errorMessage = "Die Vorschau konnte nicht erstellt werden";
  const request = { body, student_id: studentId };
  return onPortal(
    base,
    () =>
      bffJson("tenant", "POST /api/parent-announcements/letter-preview", {
        body: request,
        errorMessage,
      }),
    () =>
      bffJson("school", "POST /school/parent-letters/letter-preview", {
        body: request,
        errorMessage,
      }),
  );
}

/**
 * Downloads every letter of a published Elternbrief as one PDF to print, one
 * letter per child, under the file name the backend chose.
 */
export async function downloadLetterPrint(
  id: string,
  base: AnnouncementApiBase = BASE,
): Promise<void> {
  const errorMessage = "Die Briefe konnten nicht erstellt werden";
  const params = { announcementId: id };
  const response = await onPortal(
    base,
    () =>
      bffFile(
        "tenant",
        "GET /api/parent-announcements/{announcementId}/letters-pdf",
        { params, errorMessage },
      ),
    () =>
      bffFile(
        "school",
        "GET /school/parent-letters/{announcementId}/letters-pdf",
        { params, errorMessage },
      ),
  );
  const blob = await response.blob();
  downloadBlob(
    blob,
    filenameFromDisposition(response) ?? `elternbriefe-${id}.pdf`,
  );
}
