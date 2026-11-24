"use client";

import { fetchGroupThreadMails } from "~/lib/parent-group-threads-api";
import { fetchThreadMails } from "~/lib/parent-messages-api";
import {
  MAIL_RECONCILE_MS,
  useMailStatusRead,
} from "~/lib/hooks/use-mail-status-read";
import { messageKeys } from "~/lib/swr/portal-keys";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";

// A mail leaves within seconds and its provider reports within minutes; the
// open chat follows without a reload while a mail is still on its way. A
// settled chat asks no more; a new message or a live refresh asks again. SWR
// pauses while the tab is hidden.
const MAIL_STATUS_REFRESH_MS = 15_000;

const ON_ITS_WAY: ReadonlySet<string> = new Set([
  "queued",
  "accepted",
  "delayed",
]);

function reconcileLateFeedback(outcomes: Iterable<string>): number {
  for (const outcome of outcomes) {
    if (ON_ITS_WAY.has(outcome)) return MAIL_RECONCILE_MS;
  }
  return 0;
}

const MAIL_STATUS_OBJECT = "der Stand der E-Mails";

/** What became of the e-mail of each OGS message in a conversation (#7058). */
export function useThreadMails(threadId: string | undefined) {
  const { data, error, mutate } = useMailStatusRead(
    threadId ? messageKeys.messageThreadMails(threadId) : null,
    () => fetchThreadMails(threadId ?? ""),
    (latest) =>
      latest.awaitingFeedback
        ? MAIL_STATUS_REFRESH_MS
        : reconcileLateFeedback(Object.values(latest.mails)),
  );
  const loadError = useSwrLoadError(error, MAIL_STATUS_OBJECT, mutate);
  return { mails: data?.mails ?? {}, loadError, refresh: mutate };
}

/** The e-mails of each group message, counted by result (#7058). */
export function useGroupThreadMails(groupThreadId: string | undefined) {
  const { data, error, mutate } = useMailStatusRead(
    groupThreadId ? messageKeys.groupMessageMails(groupThreadId) : null,
    () => fetchGroupThreadMails(groupThreadId ?? ""),
    (latest) =>
      latest.awaitingFeedback
        ? MAIL_STATUS_REFRESH_MS
        : reconcileLateFeedback(
            Object.values(latest.mails).flatMap((counts) =>
              Object.keys(counts).filter(
                (key) => (counts[key as keyof typeof counts] ?? 0) > 0,
              ),
            ),
          ),
  );
  const loadError = useSwrLoadError(error, MAIL_STATUS_OBJECT, mutate);
  return { mails: data?.mails ?? {}, loadError, refresh: mutate };
}
