/**
 * Single source of truth for the parent-OGS messaging wire types, shared by the
 * staff (tenant) portal and the parents portal so the two cannot drift.
 *
 * Beyond plain messages, a conversation timeline also carries system events and
 * structured change-requests. The staff portal is German-only and uses
 * STAFF_STATUS_LABELS directly; the parents portal is localized and maps each
 * status to a next-intl key in the `parentOgsMessaging` namespace. Both maps are
 * exhaustive `Record<RequestStatus, …>`, so adding a status to the union fails to
 * compile until both are updated.
 */

import type {
  ParentMessageResponse,
  ThreadSummaryResponse,
} from "~/lib/contract/parent-me.generated";
import type * as messagesContract from "~/lib/contract/messages.generated";
import { knownEnum } from "~/lib/contract/known-enum";
import type { MessageAttachment } from "~/lib/message-attachments";
import { formatDate } from "~/lib/date-helpers";

/** Who sent a message: the guardian, the OGS staff, or a system event. */
type MessageSenderKind = "guardian" | "staff" | "system";

/** A timeline entry kind: a plain message, a system event, or a request. */
export type MessageKind = "message" | "event" | "request";

/**
 * The structured change-request types a guardian can submit. `care_schedule` is
 * the permanent weekly plan, `pickup_change` a single day's pickup time — two
 * different promises to the parent, so they never share a label.
 */
type StructuredRequestType = "care_schedule" | "pickup_change";

/** Every request_type token emitted on the shared message/event wire. */
type WireRequestType =
  | StructuredRequestType
  | "master_data"
  | "excused_absence"
  | "sick_absence"
  | "care_offering";

/** The lifecycle status of a parent-OGS change request. */
type RequestStatus = "offen" | "erledigt" | "abgelehnt" | "zurueckgezogen";

/**
 * One message/event/request in a parent-OGS conversation, as the screens read
 * it. Derived from the staff answer (`ParentChatMessageResponse`), the wider of
 * the two; the parents' answer (`ParentMessageResponse`) carries a subset of its
 * fields. Shared by the staff client (parent-messages-api `Message`) and the
 * parent client (parent-api `ParentMessage`); both read the wire through
 * `chatMessageFieldsOf`. For staff messages on the parent side `sender_name` is
 * the "OGS [Schulname]" label.
 *
 * The contract types the enums as plain strings (#7808); this type names the
 * values this build knows. `payload` stays open on the wire because its keys
 * depend on the event or request type; the reader keeps only an object.
 */
export type ChatMessage = Omit<
  messagesContract.ParentChatMessageResponse,
  ChatMessageFieldKey | "attachments"
> & {
  readonly sender_kind: MessageSenderKind;
  // A plain message ("message"), a system event ("event"), or a structured
  // change-request ("request"). Defaults to a plain message when absent so an
  // older payload still renders as a bubble.
  readonly kind?: MessageKind;
  readonly event_actor_kind?: MessageSenderKind;
  readonly request_type?: WireRequestType;
  readonly request_status?: RequestStatus;
  readonly payload?: Record<string, unknown>;
  /** Fotos und Dateien der Nachricht (#6685). */
  readonly attachments?: readonly MessageAttachment[];
};

/** The fields chatMessageFieldsOf reads out of a wire message. */
type ChatMessageFieldKey =
  | "sender_kind"
  | "kind"
  | "event_actor_kind"
  | "request_type"
  | "request_status"
  | "payload";

const SENDER_KINDS = [
  "guardian",
  "staff",
  "system",
] as const satisfies readonly MessageSenderKind[];
const MESSAGE_KINDS = [
  "message",
  "event",
  "request",
] as const satisfies readonly MessageKind[];
const REQUEST_TYPES = [
  "care_schedule",
  "pickup_change",
  "master_data",
  "excused_absence",
  "sick_absence",
  "care_offering",
] as const satisfies readonly WireRequestType[];
const REQUEST_STATUSES = [
  "offen",
  "erledigt",
  "abgelehnt",
  "zurueckgezogen",
] as const satisfies readonly RequestStatus[];

/**
 * The fields the reader narrows, as the staff answer types them; the parents'
 * answer (`ParentMessageResponse`) fits, it only lacks `event_actor_kind`.
 */
type WireChatMessageFields = Pick<
  messagesContract.ParentChatMessageResponse,
  ChatMessageFieldKey
>;

/** Reads a sender kind the conversation list shows; unknown ones drop. */
export function knownSenderKind(
  value: string | undefined,
): MessageSenderKind | undefined {
  return knownEnum(SENDER_KINDS, value);
}

/** Reads a last-message kind of a conversation row. */
export function knownMessageKind(
  value: string | undefined,
): MessageKind | undefined {
  return knownEnum(MESSAGE_KINDS, value);
}

/**
 * Narrows the string enums and the payload of one wire message to the values
 * ChatMessage names. Null for a sender this build does not know: such a
 * message is left out rather than shown under a guessed sender.
 */
export function chatMessageFieldsOf(
  raw: WireChatMessageFields,
): { readonly [K in ChatMessageFieldKey]: ChatMessage[K] } | null {
  const senderKind = knownEnum(SENDER_KINDS, raw.sender_kind);
  if (!senderKind) return null;
  const payload = raw.payload;
  return {
    sender_kind: senderKind,
    kind: knownEnum(MESSAGE_KINDS, raw.kind),
    event_actor_kind: knownEnum(SENDER_KINDS, raw.event_actor_kind),
    request_type: knownEnum(REQUEST_TYPES, raw.request_type),
    request_status: knownEnum(REQUEST_STATUSES, raw.request_status),
    payload:
      payload !== null && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : undefined,
  };
}

/**
 * The care-schedule request row a pickup-change pill points at, as the id the
 * staff detail endpoint takes — or null when the pill is not a pickup change,
 * carries no usable reference, or references another table. Both the
 * "Abholzeit angefragt" pill and the decision pill of the same request carry
 * the same ref, so "Anfrage ansehen" opens the identical row from either
 * (#3135). Legacy pills without a ref get no action rather than a guess.
 */
export function pickupRequestRef(
  message: Pick<ChatMessage, "kind" | "request_type" | "ref_table" | "ref_id">,
): string | null {
  if (message.kind !== "event" || message.request_type !== "pickup_change") {
    return null;
  }
  if (message.ref_table !== "schedule.care_schedule_change_requests") {
    return null;
  }
  const id = message.ref_id?.trim();
  return id && /^[1-9]\d*$/.test(id) ? id : null;
}

/**
 * Does the reader's review scope reach the request a pill points at (#3886)?
 * Sick and excused requests follow the absence scope, which a school may set
 * apart from the scope of every other request kind. Without a known coverage
 * the answer is no: offering a request the detail or queue would refuse with
 * 403 is the bug this guards against.
 */
export function requestPillCoveredByReview(
  message: Pick<ChatMessage, "request_type">,
  coverage: { readonly requests: boolean; readonly absences: boolean } | null,
): boolean {
  if (coverage === null) return false;
  const absence =
    message.request_type === "sick_absence" ||
    message.request_type === "excused_absence";
  return absence ? coverage.absences : coverage.requests;
}

const STAFF_STATUS_LABELS: Record<RequestStatus, string> = {
  offen: "Offen",
  erledigt: "Erledigt",
  abgelehnt: "Abgelehnt",
  zurueckgezogen: "Zurückgezogen",
};

const PARENT_STATUS_I18N_KEYS: Record<RequestStatus, string> = {
  offen: "statusOpen",
  erledigt: "statusDone",
  abgelehnt: "statusRejected",
  zurueckgezogen: "statusWithdrawn",
};

const PARENT_REQUEST_TYPE_I18N_KEYS: Record<StructuredRequestType, string> = {
  care_schedule: "requestTypeCareSchedule",
  pickup_change: "requestTypePickupChange",
};

/** German label for the German-only staff portal. Unknown → "Offen". */
export function staffRequestStatusLabel(status?: string): string {
  return (
    STAFF_STATUS_LABELS[status as RequestStatus] ?? STAFF_STATUS_LABELS.offen
  );
}

/**
 * next-intl key (parentOgsMessaging namespace) for the localized parents portal.
 * Unknown → the "open" key, matching the previous default branch.
 */
export function parentRequestStatusI18nKey(status?: string): string {
  return (
    PARENT_STATUS_I18N_KEYS[status as RequestStatus] ??
    PARENT_STATUS_I18N_KEYS.offen
  );
}

/**
 * next-intl key (parentOgsMessaging namespace) for a request card's title,
 * derived from request_type so the localized parents portal never displays the
 * backend's German message body verbatim. Unknown → a generic "Request" key.
 */
export function parentRequestTypeI18nKey(requestType?: string): string {
  return (
    PARENT_REQUEST_TYPE_I18N_KEYS[requestType as StructuredRequestType] ??
    "requestTitleFallback"
  );
}

const PARENT_REQUEST_CREATED_I18N_KEYS: Readonly<Record<string, string>> = {
  care_schedule: "eventRequestCreatedCareSchedule",
  pickup_change: "eventRequestCreatedPickupChange",
  master_data: "eventRequestCreatedMasterData",
  excused_absence: "eventRequestCreatedExcusedAbsence",
  sick_absence: "eventRequestCreatedSickAbsence",
  care_offering: "eventRequestCreatedCareOffering",
};

const PARENT_REQUEST_CONFIRMED_I18N_KEYS: Readonly<Record<string, string>> = {
  care_schedule: "eventRequestConfirmedCareSchedule",
  pickup_change: "eventRequestConfirmedPickupChange",
  master_data: "eventRequestConfirmedMasterData",
  excused_absence: "eventRequestConfirmedExcusedAbsence",
  sick_absence: "eventRequestConfirmedSickAbsence",
  care_offering: "eventRequestConfirmedCareOffering",
};

/**
 * A one-day request that also changes the Abholart (#3945) names the whole
 * Abholung, not only the Abholzeit. The pill payload carries the mode.
 */
function pickupChangeWithMode(message: {
  readonly request_type?: string;
  readonly payload?: Record<string, unknown>;
}): boolean {
  return (
    message.request_type === "pickup_change" &&
    typeof message.payload?.departure_mode === "string" &&
    message.payload.departure_mode !== ""
  );
}

/**
 * Descriptor for localizing a request-decision system event on the parents
 * portal. Backend system-event bodies are German ("Anfrage bestätigt",
 * "Anfrage abgelehnt: …", "Anfrage zurückgezogen"), so the parent side renders
 * from the event's structured fields (event_type + request_status + request_type
 * + decision_reason) instead. Returns null for any event the parent side can't
 * localize from fields — the caller then falls back to the raw German body
 * (matching the previous behavior for unknown events).
 */
export function parentEventI18nDescriptor(
  message: Pick<
    ParentMessageResponse,
    "event_type" | "request_status" | "request_type" | "decision_reason"
  > & { kind?: MessageKind; payload?: Record<string, unknown> },
  locale = "de-DE",
): { key: string; values?: Record<string, string> } | null {
  if (message.kind !== "event") {
    return null;
  }
  // A new request was just submitted from the Stammdaten page (#1803). The pill
  // announces it in the chat; the text differs per request_type so a guardian
  // reads which domain the request touches.
  if (message.event_type === "request_created") {
    if (pickupChangeWithMode(message)) {
      return { key: "eventRequestCreatedPickupChangeWithMode" };
    }
    const key = message.request_type
      ? PARENT_REQUEST_CREATED_I18N_KEYS[message.request_type]
      : undefined;
    return key ? { key } : null;
  }
  // sick_note / care_exception / care_exception_correction pills carry a
  // German-only body with dates and times embedded, so there is nothing
  // structured to localize — return null and let the caller render the raw
  // body verbatim. (Same fallback used for any unrecognized event below.)
  if (message.event_type !== "request_status" || !message.request_status) {
    return null;
  }
  switch (message.request_status) {
    case "erledigt": {
      // Eine bestätigte Angebots-Änderung gilt ab einem Tag, den die OGS
      // festlegt (#2484). Steht er im Payload, nennt die Meldung ihn — die
      // Frage „ab wann?" ist die, die als nächstes gestellt wird.
      const effectiveFrom = message.payload?.effective_from;
      if (
        message.request_type === "care_offering" &&
        typeof effectiveFrom === "string" &&
        effectiveFrom !== ""
      ) {
        return {
          key: "eventRequestConfirmedCareOfferingDated",
          values: { date: formatDate(effectiveFrom, false, locale) },
        };
      }
      if (pickupChangeWithMode(message)) {
        return { key: "eventRequestConfirmedPickupChangeWithMode" };
      }
      const key = message.request_type
        ? PARENT_REQUEST_CONFIRMED_I18N_KEYS[message.request_type]
        : undefined;
      return { key: key ?? "eventRequestConfirmed" };
    }
    case "abgelehnt":
      return message.decision_reason
        ? {
            key: "eventRequestRejectedReason",
            values: { reason: message.decision_reason },
          }
        : { key: "eventRequestRejected" };
    case "zurueckgezogen":
      return { key: "eventRequestWithdrawn" };
    default:
      return null;
  }
}

/**
 * Localized preview (parentOgsMessaging namespace key) for a thread's last
 * message on the parents portal, or null when the last message is a plain
 * guardian/staff message whose body is already language-neutral — the caller
 * then shows `last_message_body` verbatim.
 *
 * System-generated bodies are German on the wire: a structured request keeps its
 * German title ("Anfrage: …"), and a decision/withdrawal system event keeps its
 * German body ("Anfrage bestätigt", "Anfrage abgelehnt: …", "Anfrage
 * zurückgezogen"). The thread list / child-detail preview only receive
 * `last_message_body`, so without this they show that German text to a
 * non-German guardian until the next plain message arrives. Mirrors how the full
 * conversation localizes each card from structured fields.
 *
 * The reject reason is deliberately NOT passed through: it is staff free text
 * (not localizable), so a preview shows the localized status only ("Anfrage
 * abgelehnt") rather than appending a German sentence; the full conversation
 * still renders the reason.
 */
export function parentThreadPreviewI18nDescriptor(
  thread: Pick<
    ThreadSummaryResponse,
    | "last_message_kind"
    | "last_event_type"
    | "last_request_type"
    | "last_request_status"
  > & { last_message_payload?: Record<string, unknown> },
  locale = "de-DE",
): { key: string; values?: Record<string, string> } | null {
  if (thread.last_message_kind === "request") {
    return { key: parentRequestTypeI18nKey(thread.last_request_type) };
  }
  if (thread.last_message_kind === "event") {
    return parentEventI18nDescriptor(
      {
        kind: "event",
        event_type: thread.last_event_type,
        request_status: thread.last_request_status,
        request_type: thread.last_request_type,
        payload: thread.last_message_payload,
      },
      locale,
    );
  }
  return null;
}

/**
 * Which conversation of a guardian about a child (#5200): with the whole
 * team, or the one only the leadership reads. A missing value is the team.
 */
export type MessageAudience = "team" | "leadership";

/** Short staff label of a leadership conversation (inbox, child profile). */
export const LEADERSHIP_AUDIENCE_LABEL = "Nur Leitung";

/** `?audience=leadership` for the leadership conversation, "" for the team. */
function audienceQuery(audience: MessageAudience = "team"): string {
  return audience === "leadership" ? "?audience=leadership" : "";
}

/** The school side of a conversation's readers, as both APIs send it. */
export interface SchoolReaders {
  readonly kind: "all_staff" | "leadership";
  /** Leadership persons with a name, short form („Swantje M.“). */
  readonly names: readonly string[];
  /** Leadership accounts without a person name, named by the client. */
  readonly unnamed_count?: number;
}

/** Whether the backend named anyone of the leadership (person or account). */
export function hasLeadershipReaders(school: SchoolReaders): boolean {
  return school.names.length > 0 || (school.unnamed_count ?? 0) > 0;
}

/**
 * The leadership as a list for a reader sentence: the named persons, then
 * once the label for accounts without a name (the school's administration).
 * Empty when the backend named nobody.
 */
export function leadershipNameList(
  school: SchoolReaders,
  unnamedLabel: string,
): string {
  const names = [...school.names];
  if ((school.unnamed_count ?? 0) > 0) names.push(unnamedLabel);
  return names.join(", ");
}

/**
 * Ends a sentence with exactly one period. Short names end with one
 * already („Swantje M.“), other names and labels do not (#5200).
 */
export function endSentence(text: string): string {
  return text.endsWith(".") ? text : `${text}.`;
}

/** The translator of the `parentMessages` namespace, as far as needed here. */
type ParentMessagesTranslator = (
  key:
    | "readersTeam"
    | "readersLeadership"
    | "readersLeadershipUnnamed"
    | "readersUnnamedLeader",
  values?: { names: string },
) => string;

/**
 * „Lesen können: …“ of a parent conversation (#5200), built only from the
 * readers the backend reports: the parent is „Sie“, the school side everyone
 * at the OGS or the leadership by name.
 */
export function parentReadersLine(
  readers: { readonly school: SchoolReaders },
  t: ParentMessagesTranslator,
): string {
  if (readers.school.kind !== "leadership") return t("readersTeam");
  const names = leadershipNameList(readers.school, t("readersUnnamedLeader"));
  return names
    ? endSentence(t("readersLeadership", { names }))
    : t("readersLeadershipUnnamed");
}

/**
 * Parents-portal path of a child's conversation (#5200); the team one needs
 * no parameter, the leadership one carries `?audience=leadership`.
 */
export function childConversationPath(
  studentId: string,
  audience: MessageAudience = "team",
): string {
  return `/parents/messages/${encodeURIComponent(studentId)}${audienceQuery(audience)}`;
}
