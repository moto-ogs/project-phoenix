import { DEFAULT_REMINDER_TIME } from "~/components/announcements/announcement-reminder-dialog";
import { berlinClockFromISO, berlinDayFromISO } from "~/lib/date-helpers";
import type {
  Announcement,
  AnnouncementEmailAudience,
  AnnouncementPriority,
  AnnouncementTarget,
  DeclarationSigners,
} from "~/lib/parent-announcements-api";

/**
 * What the announcement editor edits (ADR 0311): one object, so the draft of
 * `useDraftOn` holds the whole form and a refusal or a newer read replaces
 * all of it at once. Days are Berlin days, the reminder a day plus a clock
 * time, both read back from the stored instants so re-saving an untouched
 * draft keeps the moment.
 */
export interface AnnouncementDraft {
  readonly title: string;
  readonly body: string;
  readonly linkUrl: string;
  readonly priority: AnnouncementPriority;
  readonly requiresAck: boolean;
  readonly sendEmail: boolean;
  readonly emailAudience: AnnouncementEmailAudience;
  readonly expiresAt: Date | null;
  readonly reminderDay: Date | null;
  readonly reminderTime: string;
  readonly reminderText: string;
  readonly targets: AnnouncementTarget[];
  readonly multiChoice: boolean;
  /** The answer rows as typed; blanks stay until saving drops them. */
  readonly optionRows: string[];
  readonly declarationSigners: DeclarationSigners;
  readonly declarationRequiresPassword: boolean;
  readonly declarationRequiresSignature: boolean;
  readonly deadline: Date | null;
}

/** The draft of a stored announcement. */
export function announcementDraftOf(a: Announcement): AnnouncementDraft {
  return {
    title: a.title,
    body: a.body,
    linkUrl: a.link_url ?? "",
    priority: a.priority,
    requiresAck: a.requires_acknowledgement,
    sendEmail: a.send_email,
    emailAudience: a.email_audience,
    // Both cut-offs were written as the END of a Berlin day, so they are
    // read back as that Berlin day: a plain `new Date(...)` shows the next
    // day east of Berlin and re-saving would move the date by one day.
    expiresAt: a.expires_at ? berlinDayFromISO(a.expires_at) : null,
    reminderDay: a.reminder_at ? berlinDayFromISO(a.reminder_at) : null,
    reminderTime: a.reminder_at
      ? berlinClockFromISO(a.reminder_at)
      : DEFAULT_REMINDER_TIME,
    reminderText: a.reminder_text ?? "",
    targets: a.targets,
    multiChoice: a.response_type === "multi_choice",
    optionRows: a.options.map((o) => o.label),
    declarationSigners: a.declaration_signers ?? "any",
    declarationRequiresPassword: a.declaration_requires_password ?? false,
    declarationRequiresSignature: a.declaration_requires_signature ?? false,
    deadline: a.response_deadline
      ? berlinDayFromISO(a.response_deadline)
      : null,
  };
}

/**
 * The draft of a new announcement. A fresh poll starts as the question
 * schools ask most often, so the common case is two clicks away instead of
 * two text fields; the mail goes to the narrow audience, so an oversight
 * never discloses the text to someone kept out of the portal.
 */
export function newAnnouncementDraft(
  isPoll: boolean,
  targets: AnnouncementTarget[],
): AnnouncementDraft {
  return {
    title: "",
    body: "",
    linkUrl: "",
    priority: "info",
    requiresAck: false,
    sendEmail: false,
    emailAudience: "portal_only",
    expiresAt: null,
    reminderDay: null,
    reminderTime: DEFAULT_REMINDER_TIME,
    reminderText: "",
    targets,
    multiChoice: false,
    optionRows: isPoll ? ["Ja", "Nein"] : [],
    declarationSigners: "any",
    declarationRequiresPassword: false,
    declarationRequiresSignature: false,
    deadline: null,
  };
}
