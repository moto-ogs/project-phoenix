"use client";

import type * as sharedContract from "~/lib/contract/shared.generated";
import {
  attachmentIdArgs,
  PARENT_MESSAGE_ATTACHMENTS,
} from "~/lib/message-attachments";
import { useMessageSendAttempt } from "~/lib/swr/optimistic";

import { messageKeys } from "~/lib/swr/portal-keys";
import { tenantDailyKeys } from "~/lib/swr/tenant-daily-keys";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useSWRSeedFrom } from "~/lib/swr";
import { PARENT_THREAD_SEND_REFUSALS } from "~/lib/message-send-refusals";
import { useOptimisticAction } from "~/lib/swr/optimistic";
import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import { Button } from "~/components/ui/button";
import { Alert } from "~/components/ui/alert";
import { EmptyState } from "~/components/ui/empty-state";
import { formErrorDetail, formErrorMessage } from "~/components/ui/form-error";
import {
  FormErrorAlert,
  LoadErrorAlert,
  errorAlertActions,
} from "~/components/ui/form-error-alert";
import { SectionCard } from "~/components/ui/section-card";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import NavigationLink from "~/components/ui/navigation-link";
import { OverflowMenu } from "~/components/ui/page-header/OverflowMenu";
import { MessageComposer } from "~/components/messaging/message-composer";
import {
  ChatBubble,
  ChatEventCard,
  type ChatEventAction,
} from "~/components/messaging/chat-bubble";
import { PickupRequestDetailModal } from "~/components/messaging/pickup-request-detail-modal";
import { RequestStatusBadge } from "~/components/messaging/request-status-badge";
import { useChatViewportLock } from "~/lib/hooks/use-chat-viewport-lock";
import { useDeviceContext } from "~/lib/device-context";
import { useMessagesActivity } from "~/lib/hooks/use-messages-activity";
import { useThreadMails } from "~/lib/hooks/use-message-mails";
import {
  MessageMailBadge,
  messageMailNote,
} from "~/components/messaging/message-mail-status";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import { useSwitchedOffWhileOpen } from "~/lib/hooks/use-switched-off-while-open";
import { useApiErrorDisplay, useApiFormError } from "~/contexts/ToastContext";
import { useTenant } from "~/lib/tenant-context";
import { useTenantAwarePath } from "~/lib/tenant-path";
import { useTenantRouter } from "~/lib/tenant-router";
import { ListRowLink } from "~/components/ui/list-row-link";
import { INBOX_SELECTION_PARAM } from "~/components/messaging/messages-inbox-app";
import {
  type InboxThread,
  type Message,
  type ThreadDetail,
  fetchThread,
  isParentMessagingDisabled,
  markThreadUnread,
  postMessage,
  readersLabel,
  relationshipLabel,
} from "~/lib/parent-messages-api";
import {
  LEADERSHIP_AUDIENCE_LABEL,
  pickupRequestRef,
  requestPillCoveredByReview,
  staffRequestStatusLabel,
} from "~/lib/messaging-status";
import type { StudentRequestReviewCoverage } from "~/lib/change-request-access";
import { fetchStudentRequestReviewCoverage } from "~/lib/change-requests-api";
import { useSWRAuth } from "~/lib/swr";
import {
  hasEffectiveAdminScope,
  hasPermission,
  isAdmin,
} from "~/lib/auth-utils";
import { createLogger } from "~/lib/logger";
import { formatChatDateTime } from "~/lib/date-helpers";
import { ThreadSkeleton, ThreadMessagesSkeleton } from "./page-skeleton";
import { childrenConcept } from "~/lib/concepts/children";

// Info-Knopf am Seitentitel (#7578): wofür die Seite da ist.
const THREAD_INFO =
  "Hier liest du die Unterhaltung mit den Eltern eines Kindes. Die neueste Nachricht steht unten. Wenn Eltern-Nachrichten eingeschaltet sind, kannst du darunter antworten.";

const logger = createLogger({ component: "MessageThreadPage" });

const MARK_UNREAD_LABEL = "Als ungelesen markieren";

export function isMessageSnapshotUnavailable(
  isLoading: boolean,
  isValidating: boolean,
  messageCount: number,
  loadError: unknown,
): boolean {
  return (
    Boolean(loadError) || ((isLoading || isValidating) && messageCount === 0)
  );
}

/** Rückweg jeder Unterhaltung: der Posteingang der Elternnachrichten. */
const MESSAGES_BACK = {
  back: true,
  backHref: "/messages",
  backLabel: "Zurück zu Nachrichten",
} as const;

/**
 * Der Verlauf einer Unterhaltung. `embedded` (#8070, iPad quer): rechts
 * neben der Liste in `/messages`, ohne eigenes Seitengerüst.
 */
export function MessageThreadContent({
  threadId,
  embedded = false,
}: Readonly<{ threadId: string; embedded?: boolean }>) {
  // App (#8070): einzeiliger Kopf, Kinderprofil als Symbol, Pill aus.
  const { isApp } = useDeviceContext();
  const router = useTenantRouter();
  const { data: session } = useSession();
  // The Änderungsanfragen queue is gated on users:update (backend + page guard),
  // scoped per child in the service. One who lacks users:update sees the plain
  // info pill.
  const canReviewRequests =
    isAdmin(session ?? null) || hasPermission(session ?? null, "users:update");
  // Admin role and admin wildcard review school-wide in the backend policy.
  const schoolWideReviewer = hasEffectiveAdminScope(session ?? null);
  const { tenant } = useTenant();
  // Tenant-prefix every SWR key on this page so a tenant switch (multi-tab /
  // switch-tenant) can never render the previous school's cached thread under
  // the new tenant until revalidation 403/404s. Mirrors the inbox key, which is
  // also tenant-prefixed (frontend convention: useTenantSlugSafe for cache-key
  // prefixing).
  // When the school has parent-OGS messaging turned off, replying hits a
  // backend 403 (PostMessage → requireEnabled). The inbox already hides the
  // "Neue Nachricht" entry on the same flag; mirror it here so an existing
  // thread renders read-only instead of dead-ending staff on send. History
  // stays visible.
  const flagSaysEnabled = tenant?.messagingEnabled === true;
  const { switchedOff, markSwitchedOff } = useSwitchedOffWhileOpen(
    flagSaysEnabled,
    threadId,
  );
  const messagingEnabled = flagSaysEnabled && !switchedOff;

  const seedFrom = useSWRSeedFrom();
  const leavingAsUnreadRef = useRef(false);
  const pendingThreadLoadsRef = useRef(new Set<Promise<ThreadDetail>>());

  // Seed the header instantly from the inbox SWR cache (subject, guardian,
  // child) so opening a chat shows its structure immediately instead of a
  // full-page skeleton; the messages then fill in.
  const seed = useMemo<ThreadDetail | undefined>(() => {
    // The inbox is keyed ["messages-inbox", onlyUnread], so the seed must search
    // every filter combination that may be cached.
    for (const unread of [false, true]) {
      const seeded = seedFrom(
        messageKeys.messagesInbox(unread),
        messageKeys.messageThread(threadId),
        (inbox: InboxThread[]): ThreadDetail | undefined => {
          const row = inbox.find((t) => t.thread_id === threadId);
          return row
            ? {
                thread_id: row.thread_id,
                student_id: row.student_id,
                student_name: row.student_name,
                guardian_name: row.guardian_name,
                relationship_type: row.relationship_type,
                audience: row.audience,
                messages: [],
              }
            : undefined;
        },
      );
      if (seeded) return seeded;
    }
    return undefined;
  }, [seedFrom, threadId]);

  const {
    data: confirmedThread,
    error: readerError,
    isLoading,
    isValidating,
    mutate,
  } = useSWRAuth(
    messageKeys.messageThread(threadId),
    async () => {
      const load = fetchThread(threadId);
      pendingThreadLoadsRef.current.add(load);
      try {
        return await load;
      } finally {
        pendingThreadLoadsRef.current.delete(load);
      }
    },
    {
      keepPreviousData: false,
      revalidateOnFocus: false,
      isPaused: () => leavingAsUnreadRef.current,
      fallbackData: seed,
      onError: (err: unknown) =>
        logger.error("thread_load_failed", {
          error: err instanceof Error ? err.message : String(err),
          thread_id: threadId,
        }),
    },
  );

  // Eine gesendete Nachricht steht sofort im Verlauf (#5011), markiert, bis
  // die Antwort sie bestätigt oder ihr Fehlschlag sie als nicht gesendet
  // zeigt.
  const send = useOptimisticAction(
    messageKeys.messageThread(threadId),
    confirmedThread,
  );
  const thread = send.data;
  // Lehnt der Server beim Senden die Unterhaltung ab, ist sie verworfen
  // (#5011). Die Ablehnung steht dann dort, wo der Verlauf fehlt, bis ein
  // neuer Abruf wieder Daten liefert.
  const [refusal, setRefusal] = useState<{
    readonly id: string;
    readonly error: unknown;
  }>();
  const loadError =
    readerError ??
    (thread || refusal?.id !== threadId ? undefined : refusal.error);

  // The thread is readable school-wide, the request detail and queue only
  // within the review scope (#3886). Ask the backend whether that scope
  // reaches this child before offering a pill action; administrators are
  // school-wide and need no round trip. Until the answer is in, and on any
  // failure, the pills stay plain info.
  const studentId = thread?.student_id;
  const { data: fetchedCoverage } = useSWRAuth<StudentRequestReviewCoverage>(
    canReviewRequests && !schoolWideReviewer && studentId && session?.user.id
      ? tenantDailyKeys.requestReviewCoverage(session.user.id, studentId)
      : null,
    () => fetchStudentRequestReviewCoverage(studentId ?? ""),
    {
      // The policy can change while this thread stays open. Refresh on return
      // to remove actions that are no longer covered before they lead to a 403.
      revalidateOnFocus: true,
      shouldRetryOnError: false,
      onError: (err: unknown) =>
        logger.warn("request_review_coverage_failed", {
          error: err instanceof Error ? err.message : String(err),
          thread_id: threadId,
        }),
    },
  );
  const reviewCoverage: StudentRequestReviewCoverage | null = schoolWideReviewer
    ? { requests: true, absences: true }
    : (fetchedCoverage ?? null);

  // Katalogtext, Wiederholen und Vorgangskennung für einen Ladefehler
  // (#2517), dort, wo der Verlauf fehlt.
  const shownLoadError = useSwrLoadError(loadError, "die Unterhaltung", mutate);

  const messages: Message[] = thread?.messages ?? [];
  // The inbox seed is passed as fallbackData with messages: [], so isLoading is
  // already false on first render while the real fetchThread is still in flight.
  // Gate on isValidating too, or a thread WITH history flashes "Noch keine
  // Nachrichten…" until the GET resolves. A background revalidation of a thread
  // that already has messages keeps messages.length > 0, so this stays false.
  const messagesLoading = (isLoading || isValidating) && messages.length === 0;
  const snapshotUnavailable = isMessageSnapshotUnavailable(
    isLoading,
    isValidating,
    messages.length,
    loadError,
  );

  // Per-ROW open/closed tracking for "request_created" pills. A pill offers the
  // "Anfrage bearbeiten" action only while its request is still open; once
  // decided (bestätigt / abgelehnt / zurückgezogen) a "request_status" pill for
  // the SAME request row arrives, carrying the identical ref_table + ref_id.
  // Keying by ref_table:ref_id (not request_type) is required for multi-row
  // master-data submissions: those emit one request_created pill per changed
  // field, all of request_type "master_data", each a separate request row.
  // Deciding one row must NOT collapse the still-open sibling rows' actions.
  const refKey = (m: Message): string | null =>
    m.ref_table && m.ref_id ? `${m.ref_table}:${m.ref_id}` : null;
  const decidedRefs = new Set<string>();
  for (const m of messages) {
    if (m.kind === "event" && m.event_type === "request_status") {
      const key = refKey(m);
      if (key) decidedRefs.add(key);
    }
  }

  const requestStillOpen = (message: Message): boolean => {
    if (message.event_type !== "request_created") {
      return false;
    }
    const key = refKey(message);
    // No row reference (legacy pill): default to open — the action only
    // deep-links to the queue, so showing it is harmless while hiding a live
    // request is the real regression.
    return key === null || !decidedRefs.has(key);
  };

  // A pickup-change pill (created or decided) opens exactly the request row it
  // references, in a read-only view, for as long as the row exists (#3135).
  // Other request pills keep the deep-link to the queue while still open.
  // Either action needs the review scope to reach the child (#3886).
  const [openRequestId, setOpenRequestId] = useState<string | null>(null);
  const eventAction = (message: Message): ChatEventAction | undefined => {
    if (!canReviewRequests) return undefined;
    if (!requestPillCoveredByReview(message, reviewCoverage)) return undefined;
    const pickupRef = pickupRequestRef(message);
    if (pickupRef) {
      return {
        label: "Anfrage ansehen",
        description: "Zeigt die Anfrage der Eltern, ohne etwas zu ändern.",
        onClick: () => setOpenRequestId(pickupRef),
      };
    }
    if (requestStillOpen(message)) {
      return {
        label: "Anfrage bearbeiten",
        description: "Öffnet die offenen Anfragen der Eltern zum Entscheiden.",
        onClick: () => router.push("/anfragen"),
      };
    }
    return undefined;
  };

  const [draft, setDraft] = useState("");
  const draftRevision = useRef(0);
  const isSending = send.pending;
  // Ein Sendefehler steht direkt über dem Eingabefeld (#2517).
  const sendError = useApiFormError();
  const latestSendRef = useRef<() => void>(() => undefined);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Parent sent a message or staff replied → revalidate this thread. The fan-out
  // is tenant-wide, so only reload when the event names THIS thread (thread_id is
  // retained in the sanitized staff broadcast); unrelated threads are skipped.
  // Debounced so a burst of messages in the open thread collapses into one
  // fetchThread (each does list + read-receipt join + MarkReadUpTo).
  // refetchOnFocus: this view's only refresh path is SSE (revalidateOnFocus is off
  // above), so if the connection dropped while the tab slept a message could have
  // been missed entirely — refetch on return to heal in lockstep with the badge.
  // After "Als ungelesen markieren" the page is on its way to the inbox. A
  // refetch now would open the thread again and end the mark at once, so the
  // SSE refresh stands down while leaving.
  // What became of the e-mail of each OGS message (#7058); follows a send
  // and every live refresh of the conversation.
  const threadMails = useThreadMails(threadId);
  const refreshMails = threadMails.refresh;
  const refreshThread = useCallback(() => {
    if (leavingAsUnreadRef.current) return;
    void mutate();
    void refreshMails();
  }, [mutate, refreshMails]);
  useMessagesActivity({
    onMatch: refreshThread,
    threadId,
    debounceMs: 500,
    refetchOnFocus: true,
  });

  // Loading the thread marks it read server-side, so nudge the sidebar unread
  // badge to refetch. Gate on !isValidating (NOT !isLoading): the inbox seed is
  // passed as fallbackData, so `data` is defined on first render and isLoading is
  // already false while the real GET is still in flight — firing then would refetch
  // the badge against the STILL-stale (lit) count before the read cursor advanced.
  // isValidating stays true until the GET resolves, so this fires only once the
  // real read has happened (mirrors the messagesLoading gate above).
  // Only the server's data counts: a message on its way marks nothing read.
  useEffect(() => {
    if (confirmedThread && !isValidating && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("messages-unread-refresh"));
    }
  }, [confirmedThread, isValidating]);

  // Keep the newest message in view when the list changes.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    // A send error shrinks the list; keep the bubble marked as not sent in
    // view (#5011).
  }, [thread, sendError.error]);

  const attempt = useMessageSendAttempt(messageKeys.messageThread(threadId));
  // Die Dateien des letzten Versuchs: „Wiederholen“ sendet sie erneut.
  const sentFiles = useRef<readonly Readonly<sharedContract.UploadResponse>[]>(
    [],
  );
  // Ob der letzte Versuch ankam: sonst behält das Eingabefeld die Dateien.
  const sendArrived = useRef(true);
  const handleSend = async (
    picked?: readonly Readonly<sharedContract.UploadResponse>[],
  ) => {
    const attachments = picked ?? sentFiles.current;
    const body = draft.trim();
    if ((!body && attachments.length === 0) || isSending || !messagingEnabled)
      return;
    if (snapshotUnavailable) {
      sendError.invalid("Bitte warte, bis der Nachrichtenverlauf geladen ist.");
      return;
    }
    sentFiles.current = attachments;
    sendArrived.current = true;
    const clientMessageId = attempt.begin(
      [body, ...attachments.map((attachment) => attachment.id)].join("\u0000"),
    );
    sendError.clear();
    // Ein neuer Versuch ersetzt die als nicht gesendet markierte Blase.
    send.dismiss();
    // The handled boundary is the last message the server confirmed, never
    // a bubble still on its way.
    const lastConfirmedId = confirmedThread?.messages.at(-1)?.id;
    setDraft("");
    const sentDraftRevision = draftRevision.current;
    let failed = false;
    const outcome = await send.run({
      onConfirmed: () => {
        attempt.complete(clientMessageId);
        // Only the restored draft belongs to this failed send. User edits,
        // including retyping identical text, are a separate intent.
        if (failed && draftRevision.current === sentDraftRevision) {
          setDraft((current) => (current === body ? "" : current));
        }
        sendError.clear();
      },
      confirmed: (current) =>
        current.messages.some(
          (message) => message.client_message_id === clientMessageId,
        ),
      optimistic: (current, { id }) => ({
        ...current,
        messages: [
          ...current.messages,
          {
            id,
            kind: "message",
            sender_kind: "staff",
            sender_name: "",
            body,
            created_at: "",
            attachments,
          },
        ],
      }),
      request: () =>
        postMessage(
          threadId,
          body,
          lastConfirmedId,
          clientMessageId,
          ...attachmentIdArgs(attachments),
        ),
      // The postMessage response carries the rebuilt "current → requested"
      // diff inline on every still-open request (like the GET path), so the
      // review card keeps its comparison before the revalidate lands.
      // Revalidate stays as a freshness backstop.
      commit: (updated) =>
        void mutate((prev) => (prev ? { ...prev, messages: updated } : prev), {
          revalidate: true,
        }),
      keepFailed: true,
      refusal: {
        codes: PARENT_THREAD_SEND_REFUSALS,
        matches: (key) =>
          key === messageKeys.messageThread(threadId) ||
          key.startsWith(messageKeys.messagesInboxFamily()),
      },
    });
    sendArrived.current = outcome.status !== "failed";
    if (outcome.status !== "failed") void refreshMails();
    if (outcome.status === "done") {
      attempt.complete(clientMessageId);
      sentFiles.current = [];
    }
    if (
      outcome.status !== "failed" ||
      (!outcome.refused && !attempt.isActive(clientMessageId))
    )
      return;
    failed = true;
    const mayRestoreDraft =
      attempt.isActive(clientMessageId) &&
      draftRevision.current === sentDraftRevision;
    const err = outcome.error;
    // Der Text kommt zurück ins Feld, außer dort steht schon ein neuer.
    setDraft((current) => (mayRestoreDraft && current === "" ? body : current));
    logger.error("thread_message_send_failed", {
      error: err instanceof Error ? err.message : String(err),
      thread_id: threadId,
    });
    if (outcome.refused) {
      setRefusal({ id: threadId, error: err });
      return;
    }
    if (isParentMessagingDisabled(err)) {
      markSwitchedOff();
      return;
    }
    void sendError.show(err, {
      object: "die Nachricht",
      retry: () => latestSendRef.current(),
    });
  };
  // „Wiederholen“ sendet den Text, der dann im Feld steht.
  useLayoutEffect(() => {
    latestSendRef.current = () => void handleSend();
  });

  // Marks the conversation unread for the whole team and returns to the inbox.
  // Staying here is not an option: this page reloads the thread on every SSE
  // event, and loading it would mark it read again right away.
  // Eine Aktion ohne Formular: der Fehler kommt als Meldung mit Wiederholen.
  const { show: showActionError } = useApiErrorDisplay();
  const latestMarkUnreadRef = useRef<() => void>(() => undefined);
  const handleMarkUnread = async () => {
    if (leavingAsUnreadRef.current) return;
    leavingAsUnreadRef.current = true;
    try {
      // A GET already in flight can mark the thread read after the POST.
      // Let every started read finish before creating the new unread mark.
      await Promise.allSettled([...pendingThreadLoadsRef.current]);
      await markThreadUnread(threadId);
      window.dispatchEvent(new CustomEvent("messages-unread-refresh"));
      router.push("/messages");
    } catch (err) {
      leavingAsUnreadRef.current = false;
      logger.error("thread_mark_unread_failed", {
        error: err instanceof Error ? err.message : String(err),
        thread_id: threadId,
      });
      void showActionError(err, {
        object: "das Markieren als ungelesen",
        retry: () => latestMarkUnreadRef.current(),
      });
    }
  };
  useLayoutEffect(() => {
    latestMarkUnreadRef.current = () => void handleMarkUnread();
  });

  // Pin the chat to the viewport and lock page scroll (only the message list
  // scrolls). Measured once the thread renders so the layout is final.
  const containerRef = useChatViewportLock<HTMLDivElement>(
    Boolean(thread) && !isLoading,
  );

  // Skeleton only for a direct deep-link with no cached seed. The back link
  // and card frame are real chrome and render immediately regardless; only
  // the header (guardian name, "Zum Kinderprofil") and message list are
  // data-bound and skeletonize. The composer stays real — its structural
  // frame doesn't depend on thread data, and `disabled` already covers the
  // loading window via `snapshotUnavailable`.
  // Bis der Katalogtext eines Ladefehlers da ist, bleibt das Skelett stehen.
  const showSkeleton =
    !thread &&
    (isLoading ||
      (Boolean(loadError) && formErrorMessage(shownLoadError) === null));

  // Statuszeile unter dem Titel: Beziehung, Kind und die Zahl der geladenen
  // Nachrichten.
  // Eine Leitungs-Unterhaltung trägt das vorne in der Statuszeile (#5200).
  // Gezählt wird, was angekommen ist, nicht die Blase auf dem Weg (#5011).
  const sentCount = confirmedThread?.messages.length ?? 0;
  const statusLine = thread ? (
    <TenantPageStats
      items={[
        ...(thread.audience === "leadership"
          ? [{ label: LEADERSHIP_AUDIENCE_LABEL }]
          : []),
        {
          label: `${relationshipLabel(thread.relationship_type)} von ${thread.student_name}`,
        },
        ...(messagesLoading
          ? []
          : [
              {
                value: sentCount,
                label: sentCount === 1 ? "Nachricht" : "Nachrichten",
              },
            ]),
      ]}
    />
  ) : null;

  if (!showSkeleton && !thread) {
    return (
      <TenantPage
        info={THREAD_INFO}
        title="Unterhaltung"
        {...MESSAGES_BACK}
        error={
          loadError
            ? {
                message: formErrorMessage(shownLoadError) ?? "",
                action: errorAlertActions(formErrorDetail(shownLoadError)),
              }
            : "Unterhaltung nicht gefunden."
        }
      />
    );
  }

  // App: Beziehung und Kind stehen als beschriftete Zeile zum Kinderprofil
  // oben im Verlauf (`childRow`); der Kopf bleibt einzeilig. Nur eine
  // Leitungs-Unterhaltung trägt das als Chip im Kopf.
  const appStatusLine =
    thread?.audience === "leadership" ? (
      <TenantPageStats items={[{ label: LEADERSHIP_AUDIENCE_LABEL }]} />
    ) : null;

  const markUnreadMenu = (
    <OverflowMenu
      ariaLabel="Weitere Aktionen"
      items={[
        {
          label: MARK_UNREAD_LABEL,
          description: "Für das ganze Team, bis jemand die Unterhaltung öffnet",
          onClick: () => void handleMarkUnread(),
        },
      ]}
    />
  );
  // App und eingebetteter Verlauf: Der Weg zum Kind ist eine beschriftete
  // Zeile über dem Verlauf statt eines Symbols im Kopf, das niemand als
  // „Kinderprofil“ las (Jury #8070). Sie nennt zugleich, wessen Elternteil
  // hier schreibt.
  const childRow =
    isApp && thread ? (
      <ListRowLink
        onClick={() =>
          router.push(`/students/${thread.student_id}?from=/messages`)
        }
        className="mb-2 border-b border-gray-100 px-1 py-2"
        icon={<MotoConceptIcon concept={childrenConcept} size={20} />}
        title={`${relationshipLabel(thread.relationship_type)} von ${thread.student_name}`}
        subtitle="Zum Kinderprofil"
        aria-label={`Kinderprofil von ${thread.student_name} öffnen`}
      />
    ) : null;

  const chat = (
    <div
      ref={containerRef}
      className="flex min-h-[20rem] w-full flex-col overflow-hidden"
    >
      {/* `moto-scroll-surface`: die Höhe setzt `useChatViewportLock`, nicht
            die Wachs-Regel des Seitenrumpfs; nur die Liste scrollt (#3328). */}
      <SectionCard
        className="moto-scroll-surface flex min-h-0 flex-1 flex-col"
        bodyClassName="flex min-h-0 flex-1 flex-col"
        title={embedded ? (thread?.guardian_name ?? "Unterhaltung") : undefined}
        action={embedded && thread ? markUnreadMenu : undefined}
      >
        {childRow}
        {showSkeleton ? (
          <ThreadSkeleton />
        ) : (
          <div
            ref={scrollRef}
            data-chat-scroll=""
            role="log"
            aria-label="Nachrichtenverlauf"
            className={
              isApp
                ? "flex min-h-0 flex-1 flex-col overflow-y-auto pr-1"
                : "min-h-0 flex-1 space-y-3 overflow-y-auto pr-1"
            }
          >
            {/* App: Wie in Chat-Apps stehen wenige Nachrichten unten am
                Schreibfeld, nicht oben mit leerer Fläche darunter. `mt-auto`
                statt `justify-end`: so bleibt der Anfang scrollbar. */}
            <AnchorBottom enabled={isApp}>
              {messagesLoading ? (
                <ThreadMessagesSkeleton />
              ) : messages.length > 0 ? (
                messages.map((message) =>
                  message.kind === "request" ? (
                    <RequestHistoryCard key={message.id} message={message} />
                  ) : message.kind === "event" ? (
                    <ChatEventCard
                      key={message.id}
                      body={message.body}
                      createdAt={message.created_at}
                      action={eventAction(message)}
                    />
                  ) : (
                    <div key={message.id}>
                      {message.group_thread_id && (
                        <GroupThreadReference
                          id={message.group_thread_id}
                          title={message.group_thread_title}
                        />
                      )}
                      <ChatBubble
                        body={message.body}
                        own={message.sender_kind === "staff"}
                        senderName={message.sender_name}
                        createdAt={message.created_at}
                        pending={send.stateOf(message.id)}
                        attachments={message.attachments}
                        attachmentFiles={PARENT_MESSAGE_ATTACHMENTS}
                        readReceiptLabel={
                          message.sender_kind === "staff" &&
                          message.read_by_guardian
                            ? "Gelesen"
                            : undefined
                        }
                        mailStatus={
                          <MessageMailBadge
                            outcome={threadMails.mails[message.id]}
                          />
                        }
                        mailNote={messageMailNote(
                          threadMails.mails[message.id],
                        )}
                      />
                    </div>
                  ),
                )
              ) : loadError ? (
                // The header seed (fallbackData) keeps `thread` truthy with an empty
                // messages array, so a failed history fetch would otherwise render the
                // "no messages" empty state for a thread that actually has history.
                // Surface the load failure instead of a misleading empty conversation.
                <LoadErrorAlert error={shownLoadError} />
              ) : (
                <EmptyState
                  title="Noch keine Nachrichten"
                  description="In dieser Unterhaltung wurde noch nichts geschrieben."
                />
              )}
            </AnchorBottom>
          </div>
        )}

        <LoadErrorAlert error={threadMails.loadError} className="mt-3" />
        <FormErrorAlert message={sendError.error} className="mt-3" />

        {/* Wer mitliest, steht direkt über dem Schreibfeld (#5200). Die
              Angabe kommt vom Backend, das Frontend rät sie nie. */}
        <div className="mt-4">
          {thread?.readers ? (
            <p
              className="mb-2 text-sm text-gray-500"
              data-testid="thread-readers"
            >
              {readersLabel(thread.readers)}
            </p>
          ) : null}
          {messagingEnabled ? (
            <MessageComposer
              value={draft}
              onChange={(value) => {
                draftRevision.current += 1;
                setDraft(value);
              }}
              onSend={async (files) => {
                await handleSend(files);
                return sendArrived.current;
              }}
              sending={isSending}
              disabled={snapshotUnavailable}
              attachments={{
                upload: PARENT_MESSAGE_ATTACHMENTS.upload,
              }}
              sendHint={`Schickt die Nachricht sofort an ${thread?.guardian_name ?? "die Eltern"}.`}
              // App: kurz, damit er auch auf schmalen Telefonen ganz steht.
              placeholder={
                isApp
                  ? "Nachricht schreiben…"
                  : "Nachricht an die Eltern schreiben…"
              }
            />
          ) : (
            <Alert
              type="info"
              message="Die Eltern-Nachrichten sind für diese Schule ausgeschaltet. Du kannst den Verlauf weiterhin lesen, aber nicht antworten."
            />
          )}
        </div>
      </SectionCard>
    </div>
  );

  const requestModal = (
    <PickupRequestDetailModal
      requestId={openRequestId}
      onClose={() => setOpenRequestId(null)}
      onOpenQueue={() => router.push("/anfragen")}
    />
  );

  if (embedded) {
    return (
      <>
        {chat}
        {requestModal}
      </>
    );
  }

  return (
    <TenantPage
      info={THREAD_INFO}
      title={thread?.guardian_name ?? "Unterhaltung"}
      {...MESSAGES_BACK}
      stats={isApp ? appStatusLine : statusLine}
      statsLoading={showSkeleton}
      actions={
        isApp ? (
          thread ? (
            markUnreadMenu
          ) : null
        ) : thread ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={() =>
                router.push(`/students/${thread.student_id}?from=/messages`)
              }
              tooltip="Öffnet die Akte des Kindes."
              className="flex-shrink-0"
            >
              <MotoConceptIcon
                concept={childrenConcept}
                size={18}
                className="mr-1.5"
              />
              Zum Kinderprofil
            </Button>
            <OverflowMenu
              ariaLabel="Weitere Aktionen"
              items={[
                {
                  label: MARK_UNREAD_LABEL,
                  description:
                    "Für das ganze Team, bis jemand die Unterhaltung öffnet",
                  onClick: () => void handleMarkUnread(),
                },
              ]}
            />
          </>
        ) : null
      }
    >
      {chat}

      {requestModal}
    </TenantPage>
  );
}

// Historical change-request card (read-only). Since #1803 care-schedule change
// requests are decided on the Änderungsanfragen (change-requests) admin page,
// not inline in the chat — so past kind="request" rows render as a plain card
// (title/body + status + timestamp) with no confirm/reject buttons and no diff
// (messages no longer carry one). Live request activity now arrives as
// non-interactive "event" pills (ChatEventCard) with a German body.
function RequestHistoryCard({ message }: Readonly<{ message: Message }>) {
  return (
    <SectionCard>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">{message.body}</p>
          <p className="mt-1 text-xs text-gray-500">
            {message.sender_name} • {formatChatDateTime(message.created_at)}
          </p>
        </div>
        <RequestStatusBadge
          label={staffRequestStatusLabel(message.request_status)}
        />
      </div>
    </SectionCard>
  );
}

// A guardian's answer to a Gruppennachricht (#4784) names the thread it
// answers, so the OGS reads it in context. The other families never see it.
function GroupThreadReference({
  id,
  title,
}: Readonly<{ id: string; title?: string }>) {
  const tenantPath = useTenantAwarePath();

  return (
    <p className="mb-1 px-1 text-xs text-gray-500">
      Antwort auf Gruppennachricht:{" "}
      <NavigationLink
        href={tenantPath(`/messages/groups/${encodeURIComponent(id)}`)}
        className="font-medium text-gray-700 underline underline-offset-2 hover:text-gray-900"
      >
        {title ?? "Gruppennachricht"}
      </NavigationLink>
    </p>
  );
}

/** Hüllt die Nachrichten in der App ein, damit `mt-auto` sie nach unten schiebt. */
function AnchorBottom({
  enabled,
  children,
}: Readonly<{ enabled: boolean; children: ReactNode }>) {
  if (!enabled) return <>{children}</>;
  return <div className="mt-auto space-y-3">{children}</div>;
}

export default function MessageThreadPage() {
  const params = useParams();
  const threadId = params.threadId as string;
  const { isSplit } = useDeviceContext();
  // iPad quer: Der Verlauf steht immer rechts neben der Liste (⅓ : ⅔), auch
  // bei direktem Aufruf oder aus einer Mitteilung. Die Liste mit Auswahl
  // ist dieselbe Ansicht; ersetzt wird nur der Verlaufseintrag, Zurück führt
  // dorthin, woher man kam.
  if (isSplit) return <OpenInSplit threadId={threadId} />;
  return <MessageThreadContent threadId={threadId} />;
}

function OpenInSplit({ threadId }: Readonly<{ threadId: string }>) {
  const router = useTenantRouter();
  useEffect(() => {
    router.replace(
      `/messages?${INBOX_SELECTION_PARAM}=${encodeURIComponent(threadId)}`,
    );
  }, [router, threadId]);
  return <TenantPage title="Nachrichten" loading />;
}
