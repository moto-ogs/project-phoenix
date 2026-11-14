"use client";

import { fetchGroupThreadMails } from "~/lib/parent-group-threads-api";
import { fetchThreadMails } from "~/lib/parent-messages-api";
import { useSWRAuth } from "~/lib/swr";
import { messageKeys } from "~/lib/swr/portal-keys";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";

// A mail leaves within seconds and its provider reports within minutes; the
// open chat follows without a reload. SWR pauses while the tab is hidden.
const MAIL_STATUS_REFRESH_MS = 15_000;

const MAIL_STATUS_OBJECT = "der Stand der E-Mails";

/** What became of the e-mail of each OGS message in a conversation (#7058). */
export function useThreadMails(threadId: string | undefined) {
  const { data, error, mutate } = useSWRAuth(
    threadId ? messageKeys.messageThreadMails(threadId) : null,
    () => fetchThreadMails(threadId ?? ""),
    { refreshInterval: MAIL_STATUS_REFRESH_MS, revalidateOnFocus: true },
  );
  const loadError = useSwrLoadError(error, MAIL_STATUS_OBJECT, mutate);
  return { mails: data ?? {}, loadError, refresh: mutate };
}

/** The e-mails of each group message, counted by result (#7058). */
export function useGroupThreadMails(groupThreadId: string | undefined) {
  const { data, error, mutate } = useSWRAuth(
    groupThreadId ? messageKeys.groupMessageMails(groupThreadId) : null,
    () => fetchGroupThreadMails(groupThreadId ?? ""),
    { refreshInterval: MAIL_STATUS_REFRESH_MS, revalidateOnFocus: true },
  );
  const loadError = useSwrLoadError(error, MAIL_STATUS_OBJECT, mutate);
  return { mails: data ?? {}, loadError, refresh: mutate };
}
