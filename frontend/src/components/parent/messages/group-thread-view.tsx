"use client";

import { useParentAttachmentLabels } from "~/components/parent/messages/attachment-labels";
import {
  attachmentIdArgs,
  guardianMessageAttachments,
  type MessageAttachment,
} from "~/lib/message-attachments";
import { useMessageSendAttempt } from "~/lib/swr/optimistic";
import { InsetPanel } from "~/components/ui/inset-panel";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocale } from "next-intl";
import { ChatBubble } from "~/components/messaging/chat-bubble";
import { MessageComposer } from "~/components/messaging/message-composer";
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import NavigationLink from "~/components/ui/navigation-link";
import { SectionCard } from "~/components/ui/section-card";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { Skeleton } from "~/components/ui/skeleton";
import {
  ParentPage,
  ParentPageHeader,
  ParentPageSkeleton,
} from "~/components/parent/parent-page";
import { useApiFormError } from "~/contexts/ToastContext";
import {
  PARENT_RESOURCE_OPTIONS,
  useParentChildren,
  useParentFeatures,
} from "~/lib/hooks/use-parent-resources";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { useConfirmedSWR } from "~/lib/hooks/use-confirmed-resource";
import { useInvalidateFamily } from "~/lib/swr";
import { parentInboxKeys } from "~/lib/swr/parent-inbox-keys";
import { parentKeys } from "~/lib/swr/parent-keys";
import {
  type GroupThreadChild,
  getGroupThread,
  postChildMessage,
} from "~/lib/parent-api";
import { createLogger } from "~/lib/logger";
import {
  childConversationPath,
  parentReadersLine,
} from "~/lib/messaging-status";
import { parentPath } from "~/lib/parent-url";
import { useCareTermTranslations } from "~/lib/care-facility-term";
import { useParentCareTerms } from "~/lib/parent-care-term";

const logger = createLogger({ component: "ParentGroupThreadView" });

// Opening the thread marked it read server-side; the sidebar badge refetches.
function nudgeUnreadBadge(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("parent-messages-unread-refresh"));
  }
}

function childName(child: GroupThreadChild): string {
  return `${child.first_name} ${child.last_name}`.trim();
}

/**
 * Eine Gruppennachricht der OGS (#4784). Die OGS schreibt an die Gruppe,
 * Klasse oder AG; die Eltern lesen hier nur, was sie für ihre eigenen Kinder
 * erreicht hat. Eine Antwort geht nur an die OGS: sie landet im Chat des
 * Kindes mit der OGS, kein anderes Elternteil sieht sie.
 */
export function ParentGroupThreadView({
  groupThreadId,
}: Readonly<{ groupThreadId: string }>) {
  const threadResource = useConfirmedSWR(
    parentInboxKeys.groupThread(groupThreadId),
    () => getGroupThread(groupThreadId),
    // Opening the thread marks it read: the sidebar badge refetches. Every
    // opening reads anew, as the unread refresh leaves the thread out
    // (parentKeys.isMessagesResource).
    {
      ...PARENT_RESOURCE_OPTIONS,
      revalidateOnMount: true,
      dedupingInterval: 0,
      onSuccess: nudgeUnreadBadge,
    },
  );
  const thread = threadResource.data ?? null;
  // Eine Gruppennachricht kommt von einer Schule: ihre Texte nennen die
  // Betreuung so, wie diese Schule sie nennt (#6082).
  const { termOfSchool } = useParentCareTerms();
  const threadTerm = termOfSchool(thread?.school_name);
  const t = useCareTermTranslations("parentGroupThreads", threadTerm);
  const tm = useCareTermTranslations("parentMessages", threadTerm);
  const locale = useLocale();
  // The composer follows the 1:1 chat's rule: only children whose
  // relationship grants writing (child features notes_enabled). A child
  // whose features do not load stays out of the picker: offering it would
  // end in a refused answer.
  const linked = useParentChildren();
  const features = useParentFeatures(linked.data);
  const featuresPending =
    (!linked.data && !linked.error) ||
    (linked.data !== undefined && !features.data && !features.error);
  const writable = useMemo(
    () =>
      !thread || featuresPending
        ? null
        : thread.children.filter(
            (child) => features.data?.[child.student_id]?.notes_enabled,
          ),
    [thread, featuresPending, features.data],
  );
  const [chosen, setSelected] = useState<string | null>(null);
  const selected =
    chosen && writable?.some((child) => child.student_id === chosen)
      ? chosen
      : (writable?.[0]?.student_id ?? null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sentFor, setSentFor] = useState<string | null>(null);
  const { error: loadError } = useSwrResourceLoadError(
    [{ data: threadResource.data ?? undefined, error: threadResource.failure }],
    t("errorObjectThread"),
    () => threadResource.mutate(),
  );
  const {
    error: sendError,
    show: showSendError,
    clear: clearSendError,
  } = useApiFormError();
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const invalidateFamily = useInvalidateFamily();
  const attachmentLabels = useParentAttachmentLabels();
  const attempt = useMessageSendAttempt(
    `parent-group-reply:${groupThreadId}:${selected ?? ""}`,
  );
  // The files of the last attempt: a retry sends them again.
  const sentFiles = useRef<readonly MessageAttachment[]>([]);
  // Whether the last attempt arrived: otherwise the composer keeps the files.
  const sendArrived = useRef(true);
  const handleSend = useCallback(
    async (picked?: readonly MessageAttachment[]) => {
      const attachments = picked ?? sentFiles.current;
      const body = draft.trim();
      if ((!body && attachments.length === 0) || sending || !selected) return;
      sentFiles.current = attachments;
      sendArrived.current = true;
      const clientMessageId = attempt.begin(
        [body, ...attachments.map((attachment) => attachment.id)].join(
          "\u0000",
        ),
      );
      setSending(true);
      clearSendError();
      try {
        await postChildMessage(
          selected,
          body,
          groupThreadId,
          "team",
          clientMessageId,
          ...attachmentIdArgs(attachments),
        );
        attempt.complete(clientMessageId);
        sentFiles.current = [];
        // The answer lands in the child's chat: a cached copy without it
        // goes, so the chat opens with the answer instead of seeming lost.
        void invalidateFamily(parentKeys.conversationFamily(selected), {
          clear: true,
        });
        if (!mountedRef.current) return;
        setDraft("");
        setSentFor(selected);
      } catch (err) {
        sendArrived.current = false;
        logger.warn("group_thread_answer_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        void showSendError(err, {
          object: t("errorObjectAnswer"),
          retry: () => void sendRef.current(),
        });
      } finally {
        if (mountedRef.current) setSending(false);
      }
    },
    [
      draft,
      sending,
      selected,
      groupThreadId,
      attempt,
      invalidateFamily,
      clearSendError,
      showSendError,
      t,
    ],
  );
  const sendRef = useRef(handleSend);
  useLayoutEffect(() => {
    sendRef.current = handleSend;
  });

  if (!thread && !threadResource.failure)
    return <ParentPageSkeleton rows={2} />;

  if (!thread) {
    return (
      <ParentPage
        header={
          <ParentPageHeader
            title={tm("title")}
            backHref={parentPath("/parents/messages")}
            backLabel={tm("back")}
          />
        }
        error={loadError}
      />
    );
  }

  const counterpart = thread.school_name
    ? tm("ogsTeam", { school: thread.school_name })
    : thread.counterpart_name;
  const readersLine = thread.readers
    ? parentReadersLine(thread.readers, tm)
    : null;
  // A child without an OGS place (#4803) has no chat with the OGS, so the
  // link leads to the conversation of a child that has one, or is left out.
  const withoutPlace = new Set(
    (linked.data ?? [])
      .filter((child) => child.without_care_place === true)
      .map((child) => child.student_id),
  );
  const chatChild = [
    sentFor,
    selected,
    ...thread.children.map((child) => child.student_id),
  ].find((id): id is string => !!id && !withoutPlace.has(id));
  // Any of the guardian's children the thread reached opens its files.
  const firstChild = thread.children[0]?.student_id;
  const chatLink = chatChild ? (
    <NavigationLink
      href={parentPath(childConversationPath(chatChild))}
      className="text-moto-blue-strong text-sm font-semibold underline-offset-2 hover:underline"
    >
      {t("toChat")}
    </NavigationLink>
  ) : null;

  return (
    <ParentPage>
      <ParentPageHeader
        kicker={thread.target_label}
        title={thread.title}
        description={`${counterpart} · ${t("forChildren", {
          names: thread.children.map(childName).join(", "),
        })}`}
        backHref={parentPath("/parents/messages")}
        backLabel={tm("back")}
      />
      {loadError && <LoadErrorAlert error={loadError} />}

      <SectionCard>
        <div
          className="space-y-2.5"
          data-testid="group-thread-messages"
          role="log"
          aria-label={tm("historyLabel")}
        >
          {thread.messages.map((message) => (
            <ChatBubble
              key={message.id}
              body={message.body}
              own={false}
              senderName={counterpart}
              createdAt={message.created_at}
              locale={locale}
              tone="parent"
              attachments={message.attachments}
              attachmentUrl={
                firstChild
                  ? guardianMessageAttachments(firstChild).downloadUrl
                  : undefined
              }
              attachmentLabels={attachmentLabels.bubble}
            />
          ))}
        </div>
      </SectionCard>

      {/* Danach steht, wer auf OGS-Seite die Antwort liest (#5200). */}
      <SectionCard
        title={t("replyTitle")}
        description={
          readersLine ? `${t("privacyNote")} ${readersLine}` : t("privacyNote")
        }
      >
        {sentFor ? (
          <div className="space-y-2" role="status">
            <p className="text-sm font-semibold text-gray-900">
              {t("sentConfirmation")}
            </p>
            {chatLink}
          </div>
        ) : thread.closed ? (
          <div className="space-y-2">
            <p className="text-sm leading-6 text-gray-600">
              {/* Ohne Kind mit OGS-Platz gibt es keinen Chat (#4803). */}
              {chatLink ? t("closedNote") : t("closedNoteWithoutChat")}
            </p>
            {chatLink}
          </div>
        ) : writable === null ? (
          <Skeleton shape="control" className="h-16 w-full" />
        ) : writable.length === 0 ? (
          <InsetPanel as="p" padding="md" className="text-sm text-gray-600">
            {t("writingDisabled")}
          </InsetPanel>
        ) : (
          <div className="space-y-3">
            {writable.length > 1 && (
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-gray-700">
                  {t("replyChildLabel")}
                </p>
                <SegmentedControl
                  items={writable.map((child) => ({
                    value: child.student_id,
                    label: childName(child),
                  }))}
                  value={selected}
                  onChange={setSelected}
                  ariaLabel={t("replyChildLabel")}
                />
              </div>
            )}
            <FormErrorAlert message={sendError} />
            <MessageComposer
              value={draft}
              onChange={setDraft}
              onSend={async (files) => {
                await handleSend(files);
                return sendArrived.current;
              }}
              sending={sending}
              attachments={
                selected
                  ? {
                      uploadUrl: guardianMessageAttachments(selected).uploadUrl,
                      labels: attachmentLabels.composer,
                    }
                  : undefined
              }
              placeholder={t("replyPlaceholder")}
              tone="parent"
              sendLabel={tm("send")}
              sendingLabel={tm("sending")}
              fieldLabel={t("replyFieldLabel")}
            />
          </div>
        )}
      </SectionCard>
    </ParentPage>
  );
}
