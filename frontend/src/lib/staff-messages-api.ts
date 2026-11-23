import type { ErrorCode } from "~/lib/error-codes.generated";
import { ApiError, wireErrorCode } from "./api-error";
import { bffJson } from "./bff-fetch";
import type * as sharedContract from "./contract/shared.generated";
/**
 * Client for the OGS-internal colleague chat (#2598). Chat model: one
 * continuous conversation between two staff accounts of the same school (no
 * subject). Opening is get-or-create — there is at most one conversation per
 * pair.
 *
 * Talks to the BFF routes under /api/staff-messages, which forward to the Go
 * backend with the staff JWT. Backend int64 ids arrive already stringified.
 *
 * The school portal (#2208) reaches the SAME conversations through its own
 * session (/api/school/staff-messages): the functions are built by
 * createStaffMessagesApi(portal), and the named exports below are the
 * tenant-portal instance.
 *
 * Deliberately separate from parent-messages-api.ts: the two look alike on the
 * wire but are different surfaces with different audiences, and merging them
 * would make it possible to send an internal note into a parent conversation by
 * passing the wrong id.
 */

/**
 * A conversation with its lists; Go writes an empty list as null. A group
 * chat (#4776, `kind` "group") names `group_name` and its `members`.
 */
export type StaffThreadDetail = Omit<
  sharedContract.ThreadDetailResponse,
  "messages" | "members"
> & {
  messages: sharedContract.MessageResponse[];
  members: sharedContract.MemberResponse[];
};

/** Whether a thread is a group chat (#4776). */
export function isGroupThread(thread: { kind?: string }): boolean {
  return thread.kind === "group";
}

/**
 * The label a reader sees next to a colleague's name, or null when it would
 * only repeat what the reader already knows.
 *
 * In the OGS portal every colleague is OGS by default, so only "Lehrkraft"
 * carries information. In the school portal a Lehrkraft writes INTO the OGS
 * and needs to tell the leadership from the team - and sees fellow Lehrkräfte
 * marked as such.
 */
export function staffRoleKindLabel(
  kind: string | undefined,
  portal: "tenant" | "school",
): string | null {
  switch (kind) {
    case "lehrkraft":
      return "Lehrkraft";
    case "admin":
      return portal === "school" ? "OGS-Leitung" : null;
    case "staff":
      return portal === "school" ? "OGS-Team" : null;
    default:
      return null;
  }
}

/**
 * Wire contract with modules/communication/http/staffmessages: the school has the Team-Chat switched
 * off. Carried as a stable code rather than matched on the German sentence, so
 * polishing the wording cannot turn the read-only state back into a red
 * "loading failed" error with a dead-end compose button.
 */
const STAFF_MESSAGING_DISABLED: ErrorCode =
  "communication.staff_messaging_disabled";

/**
 * Wire contract with modules/communication/http/staffmessages: the other side of this conversation is
 * no longer a reachable colleague. Same reasoning as STAFF_MESSAGING_DISABLED -
 * a code, not a sentence, so the read-only branch survives a rewording.
 */
const COUNTERPART_UNAVAILABLE: ErrorCode =
  "communication.staff_counterpart_unavailable";

/** Whether an unknown thrown value is the "counterpart has left" case. */
export function isCounterpartUnavailable(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    wireErrorCode(err.code) === COUNTERPART_UNAVAILABLE
  );
}

/** Whether an unknown thrown value is the "school switched it off" case. */
export function isStaffMessagingDisabled(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    wireErrorCode(err.code) === STAFF_MESSAGING_DISABLED
  );
}

function withLists(
  detail: sharedContract.ThreadDetailResponse,
): StaffThreadDetail {
  return {
    ...detail,
    messages: detail.messages ?? [],
    members: detail.members ?? [],
  };
}

/** The calls a Team-Chat surface needs, bound to one proxy base path. */
export interface StaffMessagesApi {
  /** The caller's conversations, newest activity first. */
  fetchInbox(filters: {
    onlyUnread?: boolean;
  }): Promise<sharedContract.InboxThreadResponse[]>;
  /** Unread total for the navigation badge. */
  fetchUnreadCount(): Promise<number>;
  /** Colleagues the caller may write to. */
  fetchRecipients(): Promise<sharedContract.RecipientResponse[]>;
  /** The full conversation (messages oldest-first) for the chat window. */
  fetchThread(threadId: string): Promise<StaffThreadDetail>;
  /** Open (or create) the conversation with one colleague. */
  openThread(accountId: string): Promise<StaffThreadDetail>;
  /** Send one message into a conversation. */
  postMessage(
    threadId: string,
    body: string,
    clientMessageId?: string,
    attachmentIds?: readonly string[],
  ): Promise<sharedContract.MessageResponse>;
  /** Start a group chat (#4776). OGS portal only. */
  createGroup(name: string, accountIds: string[]): Promise<StaffThreadDetail>;
  /** Rename a group chat. OGS portal only. */
  renameGroup(threadId: string, name: string): Promise<StaffThreadDetail>;
  /** Add members to a group chat. OGS portal only. */
  addGroupMembers(
    threadId: string,
    accountIds: string[],
  ): Promise<StaffThreadDetail>;
  /** Remove one member from a group chat. OGS portal only. */
  removeGroupMember(
    threadId: string,
    accountId: string,
  ): Promise<StaffThreadDetail>;
  /** Leave a group chat. Both portals. */
  leaveGroup(threadId: string): Promise<void>;
}

/** The group calls the school portal has no route for (#2208). */
function onlyInTheOgsPortal(): Promise<never> {
  return Promise.reject(
    new ApiError("Gruppen verwaltet nur das OGS-Portal", 404),
  );
}

const FAILED = {
  inbox: "Nachrichten konnten nicht geladen werden",
  unread: "Ungelesene Nachrichten konnten nicht geladen werden",
  recipients: "Die Liste konnte nicht geladen werden",
  thread: "Der Verlauf konnte nicht geladen werden",
  open: "Die Unterhaltung konnte nicht geöffnet werden",
  send: "Die Nachricht konnte nicht gesendet werden",
  create: "Die Gruppe konnte nicht angelegt werden",
  rename: "Der Name konnte nicht gespeichert werden",
  add: "Die Personen konnten nicht hinzugefügt werden",
  remove: "Die Person konnte nicht entfernt werden",
  leave: "Die Gruppe konnte nicht verlassen werden",
} as const;

function messageBody(
  body: string,
  clientMessageId?: string,
  attachmentIds?: readonly string[],
): sharedContract.postMessageRequest {
  return {
    body,
    client_message_id: clientMessageId,
    ...(attachmentIds?.length ? { attachment_ids: [...attachmentIds] } : {}),
  };
}

/** The OGS portal's client: every call, group chats included. */
function tenantApi(): StaffMessagesApi {
  return {
    fetchInbox: (filters) =>
      bffJson("tenant", "GET /api/staff-messages/", {
        query: { only_unread: filters.onlyUnread ? true : undefined },
        errorMessage: FAILED.inbox,
      }),
    fetchUnreadCount: async () =>
      (
        await bffJson("tenant", "GET /api/staff-messages/unread-count", {
          errorMessage: FAILED.unread,
        })
      ).unread_count,
    fetchRecipients: () =>
      bffJson("tenant", "GET /api/staff-messages/recipients", {
        errorMessage: FAILED.recipients,
      }),
    fetchThread: async (threadId) =>
      withLists(
        await bffJson("tenant", "GET /api/staff-messages/threads/{threadID}", {
          params: { threadID: threadId },
          errorMessage: FAILED.thread,
        }),
      ),
    openThread: async (accountId) =>
      withLists(
        await bffJson("tenant", "POST /api/staff-messages/threads/open", {
          body: { account_id: accountId },
          errorMessage: FAILED.open,
        }),
      ),
    postMessage: (threadId, body, clientMessageId, attachmentIds) =>
      bffJson("tenant", "POST /api/staff-messages/threads/{threadID}", {
        params: { threadID: threadId },
        body: messageBody(body, clientMessageId, attachmentIds),
        errorMessage: FAILED.send,
      }),
    createGroup: async (name, accountIds) =>
      withLists(
        await bffJson("tenant", "POST /api/staff-messages/groups", {
          body: { name, account_ids: accountIds },
          errorMessage: FAILED.create,
        }),
      ),
    renameGroup: async (threadId, name) =>
      withLists(
        await bffJson(
          "tenant",
          "PUT /api/staff-messages/threads/{threadID}/name",
          {
            params: { threadID: threadId },
            body: { name },
            errorMessage: FAILED.rename,
          },
        ),
      ),
    addGroupMembers: async (threadId, accountIds) =>
      withLists(
        await bffJson(
          "tenant",
          "POST /api/staff-messages/threads/{threadID}/members",
          {
            params: { threadID: threadId },
            body: { account_ids: accountIds },
            errorMessage: FAILED.add,
          },
        ),
      ),
    removeGroupMember: async (threadId, accountId) => {
      const detail = await bffJson(
        "tenant",
        "DELETE /api/staff-messages/threads/{threadID}/members/{accountID}",
        {
          params: { threadID: threadId, accountID: accountId },
          errorMessage: FAILED.remove,
        },
      );
      if (!detail) throw new ApiError(FAILED.remove, 500);
      return withLists(detail);
    },
    leaveGroup: async (threadId) => {
      await bffJson(
        "tenant",
        "POST /api/staff-messages/threads/{threadID}/leave",
        { params: { threadID: threadId }, errorMessage: FAILED.leave },
      );
    },
  };
}

/** The school portal's client (#2208): the same chats, no group management. */
function schoolApi(): StaffMessagesApi {
  return {
    fetchInbox: (filters) =>
      bffJson("school", "GET /school/staff-messages/", {
        query: { only_unread: filters.onlyUnread ? true : undefined },
        errorMessage: FAILED.inbox,
      }),
    fetchUnreadCount: async () =>
      (
        await bffJson("school", "GET /school/staff-messages/unread-count", {
          errorMessage: FAILED.unread,
        })
      ).unread_count,
    fetchRecipients: () =>
      bffJson("school", "GET /school/staff-messages/recipients", {
        errorMessage: FAILED.recipients,
      }),
    fetchThread: async (threadId) =>
      withLists(
        await bffJson(
          "school",
          "GET /school/staff-messages/threads/{threadID}",
          {
            params: { threadID: threadId },
            errorMessage: FAILED.thread,
          },
        ),
      ),
    openThread: async (accountId) =>
      withLists(
        await bffJson("school", "POST /school/staff-messages/threads/open", {
          body: { account_id: accountId },
          errorMessage: FAILED.open,
        }),
      ),
    postMessage: (threadId, body, clientMessageId, attachmentIds) =>
      bffJson("school", "POST /school/staff-messages/threads/{threadID}", {
        params: { threadID: threadId },
        body: messageBody(body, clientMessageId, attachmentIds),
        errorMessage: FAILED.send,
      }),
    createGroup: onlyInTheOgsPortal,
    renameGroup: onlyInTheOgsPortal,
    addGroupMembers: onlyInTheOgsPortal,
    removeGroupMember: onlyInTheOgsPortal,
    leaveGroup: async (threadId) => {
      await bffJson(
        "school",
        "POST /school/staff-messages/threads/{threadID}/leave",
        { params: { threadID: threadId }, errorMessage: FAILED.leave },
      );
    },
  };
}

/** Builds the client for one portal; both reach the same backend surface. */
export function createStaffMessagesApi(
  portal: "tenant" | "school",
): StaffMessagesApi {
  return portal === "school" ? schoolApi() : tenantApi();
}

/** The OGS (tenant) portal instance. */
export const tenantStaffMessagesApi = createStaffMessagesApi("tenant");

/** Unread total for the sidebar badge (tenant portal). */
export const fetchStaffUnreadCount = tenantStaffMessagesApi.fetchUnreadCount;
