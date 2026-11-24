/**
 * Staff-side client for the Gruppennachrichten (#4784): the OGS writes to
 * every family of a group, class or AG. Parents answer only the OGS, in the
 * conversation of their child; their answers never appear here.
 *
 * Talks to the catalog BFF under /api/messages/group-threads.
 * Backend int64 ids arrive already stringified.
 */

import {
  knownMailOutcome,
  type MailOutcome,
  type MailOutcomeCounts,
} from "./email-delivery-status";
import { bffJson } from "~/lib/bff-fetch";
import type * as messagesContract from "~/lib/contract/messages.generated";

export type GroupTargetType = "group" | "class" | "activity_group";

/** A group thread with its lists; Go writes an empty list as null. */
export type GroupThreadDetail = Omit<
  messagesContract.GroupThreadDetailResponse,
  "messages" | "children"
> & {
  messages: messagesContract.StaffGroupMessageResponse[];
  children: messagesContract.GroupChildResponse[];
};

export interface GroupTarget {
  type: GroupTargetType;
  id: string;
  label: string;
}

function withLists(
  detail: messagesContract.GroupThreadDetailResponse,
): GroupThreadDetail {
  return {
    ...detail,
    messages: detail.messages ?? [],
    children: detail.children ?? [],
  };
}

export function fetchGroupThreads(): Promise<
  messagesContract.StaffGroupThreadSummaryResponse[]
> {
  return bffJson("tenant", "GET /api/messages/group-threads", {
    errorMessage: "Gruppennachrichten konnten nicht geladen werden",
  });
}

export function fetchGroupAudience(
  type: GroupTargetType,
  id: string,
): Promise<messagesContract.GroupChildResponse[]> {
  return bffJson("tenant", "GET /api/messages/group-threads/audience", {
    query: { target_type: type, target_id: id },
    errorMessage: "Empfänger konnten nicht geladen werden",
  });
}

export async function createGroupThread(input: {
  client_message_id?: string;
  target: GroupTarget;
  title: string;
  body: string;
}): Promise<GroupThreadDetail> {
  const detail = await bffJson("tenant", "POST /api/messages/group-threads", {
    body: {
      target_type: input.target.type,
      target_id: input.target.id,
      target_label: input.target.label,
      title: input.title,
      body: input.body,
      client_message_id: input.client_message_id,
    },
    errorMessage: "Gruppennachricht konnte nicht gesendet werden",
  });
  return withLists(detail);
}

export async function fetchGroupThread(id: string): Promise<GroupThreadDetail> {
  const detail = await bffJson(
    "tenant",
    "GET /api/messages/group-threads/{groupThreadId}",
    {
      params: { groupThreadId: id },
      errorMessage: "Gruppennachricht konnte nicht geladen werden",
    },
  );
  return withLists(detail);
}

/**
 * The e-mails of each group message, counted by result (#7058), keyed by
 * message id. A message without a mail has no key; an outcome this build does
 * not know is not counted.
 */
export async function fetchGroupThreadMails(
  id: string,
): Promise<Readonly<Record<string, MailOutcomeCounts>>> {
  const data = await bffJson(
    "tenant",
    "GET /api/messages/group-threads/{groupThreadId}/mails",
    {
      params: { groupThreadId: id },
      errorMessage: "Der Stand der E-Mails konnte nicht geladen werden",
    },
  );
  const mails: Record<string, MailOutcomeCounts> = {};
  for (const [messageId, counts] of Object.entries(data.messages ?? {})) {
    const known: Partial<Record<MailOutcome, number>> = {};
    for (const [outcome, count] of Object.entries(counts ?? {})) {
      const name = knownMailOutcome(outcome);
      if (name) known[name] = count;
    }
    mails[messageId] = known;
  }
  return mails;
}

export async function postGroupMessage(
  id: string,
  body: string,
  clientMessageId?: string,
  attachmentIds?: readonly string[],
): Promise<GroupThreadDetail> {
  const detail = await bffJson(
    "tenant",
    "POST /api/messages/group-threads/{groupThreadId}/messages",
    {
      params: { groupThreadId: id },
      body: {
        body,
        client_message_id: clientMessageId,
        ...(attachmentIds?.length
          ? { attachment_ids: [...attachmentIds] }
          : {}),
      },
      errorMessage: "Nachricht konnte nicht gesendet werden",
    },
  );
  return withLists(detail);
}

export async function closeGroupThread(id: string): Promise<GroupThreadDetail> {
  const detail = await bffJson(
    "tenant",
    "POST /api/messages/group-threads/{groupThreadId}/close",
    {
      params: { groupThreadId: id },
      errorMessage: "Gruppennachricht konnte nicht geschlossen werden",
    },
  );
  return withLists(detail);
}

/** "3 von 5 Familien gelesen". */
export function familyReadLabel(read: number, families: number): string {
  return `${read} von ${families} ${families === 1 ? "Familie" : "Familien"} gelesen`;
}

/**
 * „Ging an: Gruppe Bären (12 Familien).“ — where a group thread went (#5200). The
 * target label already names its kind („Gruppe“, „Klasse“, „AG“).
 */
export function groupRecipientsLabel(
  readers: messagesContract.GroupReadersResponse,
): string {
  const families = `${readers.recipient_count} ${readers.recipient_count === 1 ? "Familie" : "Familien"}`;
  return `Ging an: ${readers.target_label} (${families}).`;
}
