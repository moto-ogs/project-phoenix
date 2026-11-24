/**
 * Staff-side client for the parent-OGS messaging feature. Chat model: one
 * continuous conversation between the OGS and ONE guardian about ONE child (no
 * subject). Sending is get-or-create — there is at most one conversation per
 * (child, guardian).
 *
 * Talks to the catalog BFF under /api/messages, which forward to the
 * Go backend with the staff JWT. Backend int64 ids arrive already stringified.
 */

import { knownMailOutcome, type MailOutcome } from "./email-delivery-status";
import { ApiError, wireErrorCode } from "~/lib/api-error";
import { bffJson } from "~/lib/bff-fetch";
import type * as messagesContract from "~/lib/contract/messages.generated";
import {
  type ChatMessage,
  type MessageAudience,
  type SchoolReaders,
  chatMessageFieldsOf,
  endSentence,
  leadershipNameList,
} from "~/lib/messaging-status";
import { getRelationshipTypeLabel } from "~/lib/guardian-helpers";

/** The school switched sending off; existing conversations remain readable. */
export function isParentMessagingDisabled(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    wireErrorCode(error.code) === "communication.parent_messaging_disabled"
  );
}

/** Leadership accounts without a person name (#5200), as staff read them. */
const UNNAMED_LEADER_LABEL = "Schulverwaltung";

// The message view is shared with the parent client; see ChatMessage. A
// guardian's answer to a Gruppennachricht (#4784) names that thread in
// group_thread_id and group_thread_title.
export type Message = ChatMessage;

/**
 * Which conversation of a guardian about a child (#5200). Staff without the
 * leadership permission never receive a leadership one.
 */
export type ThreadAudience = MessageAudience;

/**
 * Who reads a conversation (#5200), as the backend reports it: the ONE
 * guardian it belongs to (other guardians of the child do not read along)
 * and the school side, everyone or the leadership. `school.names` (short
 * names such as „Swantje M.“) is empty on inbox rows.
 */
export interface ThreadReaders {
  guardian: messagesContract.GuardianReaderResponse;
  school: SchoolReaders;
}

/** A row or detail with its readers and audience read for the screen. */
type WithReaders<T> = Omit<T, "readers" | "audience"> & {
  readers: ThreadReaders;
  audience: ThreadAudience;
};

export type InboxThread =
  WithReaders<messagesContract.ParentChatInboxThreadResponse>;

/**
 * `readers` is missing only while the chat window shows the row the inbox
 * already had, until the conversation itself has loaded.
 */
export type ThreadDetail = Omit<
  WithReaders<messagesContract.ParentChatThreadDetailResponse>,
  "messages" | "readers"
> & { messages: Message[]; readers?: ThreadReaders };

export type Guardian = Omit<
  messagesContract.MessageableGuardianResponse,
  "readers"
> & {
  /** Who would read the conversation with this guardian in the asked audience. */
  readers: ThreadReaders;
};

function toAudience(audience: string): ThreadAudience {
  return audience === "leadership" ? "leadership" : "team";
}

function toReaders(readers: messagesContract.ReadersResponse): ThreadReaders {
  return {
    guardian: readers.guardian,
    school: {
      kind: readers.school.kind === "leadership" ? "leadership" : "all_staff",
      names: readers.school.names ?? [],
      unnamed_count: readers.school.unnamed_count,
    },
  };
}

function toInboxThread(
  thread: messagesContract.ParentChatInboxThreadResponse,
): InboxThread {
  return {
    ...thread,
    audience: toAudience(thread.audience),
    readers: toReaders(thread.readers),
  };
}

/**
 * The contract types a message's enums as plain strings and its `payload` as
 * `unknown` (#7808); the conversation reads them in the shape ChatMessage
 * names, through the same reader as the parent client.
 */
function toMessages(
  messages: readonly messagesContract.ParentChatMessageResponse[] | null,
): Message[] {
  return (messages ?? []).flatMap((message) => {
    const fields = chatMessageFieldsOf(message);
    return fields ? [{ ...message, ...fields }] : [];
  });
}

function toThreadDetail(
  detail: messagesContract.ParentChatThreadDetailResponse,
): ThreadDetail {
  return {
    ...detail,
    audience: toAudience(detail.audience),
    readers: toReaders(detail.readers),
    messages: toMessages(detail.messages),
  };
}

/**
 * German label for a guardian relationship type. Delegates to the shared
 * getRelationshipTypeLabel (lib/guardian-helpers) — the SAME label set the
 * guardian admin UI uses — so a guardian never reads differently in the
 * messages inbox than in the guardian manager. Empty/unset falls back to the
 * neutral "Bezugsperson" (getRelationshipTypeLabel would echo the empty value).
 */
export function relationshipLabel(rel?: string): string {
  if (!rel) return "Bezugsperson";
  return getRelationshipTypeLabel(rel);
}

/**
 * „Lesen können: Maria Muster (Mutter) und alle Mitarbeitenden.“ from the
 * backend's readers (#5200). Names the one guardian, so nobody assumes the
 * other parent reads along.
 */
export function readersLabel(readers: ThreadReaders): string {
  const { guardian, school } = readers;
  const parent = guardian.name
    ? `${guardian.name} (${relationshipLabel(guardian.relationship_type)})`
    : relationshipLabel(guardian.relationship_type);
  if (school.kind !== "leadership") {
    return `Lesen können: ${parent} und alle Mitarbeitenden.`;
  }
  const names = leadershipNameList(school, UNNAMED_LEADER_LABEL);
  return names
    ? endSentence(`Lesen können: ${parent} und die Leitung: ${names}`)
    : `Lesen können: ${parent} und die Leitung.`;
}

export async function fetchInboxWithFilters(filters: {
  onlyUnread?: boolean;
}): Promise<InboxThread[]> {
  const threads = await bffJson("tenant", "GET /api/messages/", {
    query: { unread: filters.onlyUnread ? true : undefined },
    errorMessage: "Nachrichten konnten nicht geladen werden",
  });
  return threads.map(toInboxThread);
}

/**
 * Fetch one child's threads (staff view) for the student-detail card, scoped
 * server-side so the card no longer pulls the whole tenant inbox and filters by
 * student_id client-side.
 */
export async function fetchStudentThreads(
  studentId: string,
): Promise<InboxThread[]> {
  // The child page shows a failed load through the shared display path
  // (#2513), which reads the code and request ID, not the backend sentence.
  const threads = await bffJson(
    "tenant",
    "GET /api/messages/students/{studentId}/threads",
    {
      params: { studentId },
      errorMessage: "Nachrichten konnten nicht geladen werden",
    },
  );
  return threads.map(toInboxThread);
}

/**
 * Fetch the number of unread message threads for the unread badge.
 */
export async function fetchUnreadCount(): Promise<number> {
  const result = await bffJson("tenant", "GET /api/messages/unread-count", {
    errorMessage: "Ungelesene Nachrichten konnten nicht geladen werden",
  });
  return result.unread_count;
}

/**
 * Fetch the full conversation (child/guardian metadata, messages oldest-first)
 * for the chat window.
 */
export async function fetchThread(threadId: string): Promise<ThreadDetail> {
  const detail = await bffJson(
    "tenant",
    "GET /api/messages/threads/{threadId}",
    {
      params: { threadId },
      errorMessage: "Nachrichtenverlauf konnte nicht geladen werden",
    },
  );
  return toThreadDetail(detail);
}

/**
 * What became of the e-mail of each OGS message in a conversation (#7058),
 * keyed by message id. A message without a mail has no key.
 */
export async function fetchThreadMails(
  threadId: string,
): Promise<Readonly<Record<string, MailOutcome>>> {
  const result = await bffJson(
    "tenant",
    "GET /api/messages/threads/{threadId}/mails",
    {
      params: { threadId },
      errorMessage: "Der Stand der E-Mails konnte nicht geladen werden",
    },
  );
  // An outcome this build does not know shows no status.
  const mails: Record<string, MailOutcome> = {};
  for (const [messageId, outcome] of Object.entries(result.messages ?? {})) {
    const known = knownMailOutcome(outcome);
    if (known) mails[messageId] = known;
  }
  return mails;
}

/**
 * Send a staff reply to a thread. Returns the full updated message list.
 */
export async function postMessage(
  threadId: string,
  body: string,
  handledUpToMessageId?: string,
  clientMessageId?: string,
  attachmentIds?: readonly string[],
): Promise<Message[]> {
  const messages = await bffJson(
    "tenant",
    "POST /api/messages/threads/{threadId}",
    {
      params: { threadId },
      body: {
        body,
        client_message_id: clientMessageId,
        ...(attachmentIds?.length
          ? { attachment_ids: [...attachmentIds] }
          : {}),
        ...(handledUpToMessageId
          ? { handled_up_to_message_id: handledUpToMessageId }
          : {}),
      },
      errorMessage: "Nachricht konnte nicht gesendet werden",
    },
  );
  return toMessages(messages);
}

/**
 * Mark the conversation unread for the whole team. Every staff member who may
 * read the child sees it as unread again until someone opens or answers it.
 * Parents see no change.
 */
export async function markThreadUnread(threadId: string): Promise<void> {
  await bffJson("tenant", "POST /api/messages/threads/{threadId}/unread", {
    params: { threadId },
    errorMessage: "Die Unterhaltung wurde nicht als ungelesen markiert.",
  });
}

/**
 * Confirm the guardian activity up to the given message for the whole team,
 * without a reply (#6486). Colleagues no longer see it as new; parents see no
 * change. The message id is the last one the dialog showed, so a message that
 * arrived meanwhile stays new.
 */
export async function confirmThreadForTeam(
  threadId: string,
  handledUpToMessageId: string,
): Promise<void> {
  await bffJson("tenant", "POST /api/messages/threads/{threadId}/handled", {
    params: { threadId },
    body: { handled_up_to_message_id: handledUpToMessageId },
    errorMessage: "Die Nachricht wurde nicht als gelesen bestätigt.",
  });
}

/**
 * Clear the caller's own unread numbers for every conversation they see as
 * unread. Colleagues see no change, and parents get no read receipt (#3673).
 * Returns the caller's new unread count: above zero only while conversations
 * the team marked unread remain.
 */
export async function markAllMessagesRead(): Promise<number> {
  const result = await bffJson("tenant", "POST /api/messages/mark-all-read", {
    errorMessage: "Die Nachrichten wurden nicht als gelesen markiert.",
  });
  return result.unread_count;
}

/**
 * Which parent conversations the own counter at "Nachrichten" counts (#3673).
 * Personal: colleagues and parents see no change.
 */
export type MessageCountScope = "all" | "own_groups" | "none";

export interface MessageCountSetting {
  scope: MessageCountScope;
  /** Without an OGS group today, "own_groups" counts nothing. */
  hasOwnGroups: boolean;
}

const COUNT_SCOPES: readonly MessageCountScope[] = [
  "all",
  "own_groups",
  "none",
];

function toCountScope(value: unknown): MessageCountScope {
  return COUNT_SCOPES.includes(value as MessageCountScope)
    ? (value as MessageCountScope)
    : "all";
}

export async function fetchMessageCountSetting(): Promise<MessageCountSetting> {
  // Own error path (#2517): the settings card shows the catalog text, so the
  // ApiError keeps code and request ID instead of a fixed sentence.
  const result = await bffJson("tenant", "GET /api/messages/count-scope");
  return {
    scope: toCountScope(result.scope),
    hasOwnGroups: result.has_own_groups,
  };
}

export async function saveMessageCountScope(
  scope: MessageCountScope,
): Promise<void> {
  await bffJson("tenant", "PUT /api/messages/count-scope", { body: { scope } });
}

/**
 * Get-or-create the conversation for a (child, guardian) pair and return it
 * (with history if any) WITHOUT sending a message — opens the chat window
 * directly from the recipient picker, WhatsApp-style. The empty thread stays
 * hidden from the inbox until the first message is sent.
 */
export async function openThread(input: {
  studentId: string;
  guardianAccountId: string;
  /** Leadership members may open the conversation with the leadership only. */
  audience?: ThreadAudience;
}): Promise<ThreadDetail> {
  const detail = await bffJson("tenant", "POST /api/messages/threads/open", {
    body: {
      student_id: input.studentId,
      guardian_account_id: input.guardianAccountId,
      ...(input.audience === "leadership" ? { audience: input.audience } : {}),
    },
    errorMessage: "Unterhaltung konnte nicht geöffnet werden",
  });
  return toThreadDetail(detail);
}

/**
 * IDs of the school's children with at least one guardian fetchGuardians
 * would offer. „Neue Nachricht“ marks every other child (#4362).
 */
export async function fetchReachableStudentIds(): Promise<ReadonlySet<string>> {
  const result = await bffJson(
    "tenant",
    "GET /api/messages/reachable-students",
    {
      errorMessage: "Erreichbare Kinder konnten nicht geladen werden",
    },
  );
  return new Set(result.student_ids ?? []);
}

/**
 * Fetch the guardians of a child who have a parents-portal account and can
 * receive a new message thread.
 */
export async function fetchGuardians(
  studentId: string,
  audience: ThreadAudience = "team",
): Promise<Guardian[]> {
  const guardians = await bffJson(
    "tenant",
    "GET /api/messages/students/{studentId}/guardians",
    {
      params: { studentId },
      query: { audience: audience === "leadership" ? audience : undefined },
      errorMessage: "Bezugspersonen konnten nicht geladen werden",
    },
  );
  return guardians.map((guardian) => ({
    ...guardian,
    readers: toReaders(guardian.readers),
  }));
}
