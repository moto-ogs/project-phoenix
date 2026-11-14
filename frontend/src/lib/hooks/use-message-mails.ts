"use client";

import { fetchGroupThreadMails } from "~/lib/parent-group-threads-api";
import { fetchThreadMails } from "~/lib/parent-messages-api";
import { useSWRAuth } from "~/lib/swr";
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

function refreshWhileOnItsWay(outcomes: Iterable<string>): number {
  for (const outcome of outcomes) {
    if (ON_ITS_WAY.has(outcome)) return MAIL_STATUS_REFRESH_MS;
  }
  return 0;
}

const MAIL_STATUS_OBJECT = "der Stand der E-Mails";

/** What became of the e-mail of each OGS message in a conversation (#7058). */
export function useThreadMails(threadId: string | undefined) {
  const { data, error, mutate } = useSWRAuth(
    threadId ? messageKeys.messageThreadMails(threadId) : null,
    () => fetchThreadMails(threadId ?? ""),
    {
      refreshInterval: (mails) =>
        refreshWhileOnItsWay(Object.values(mails ?? {})),
      revalidateOnFocus: true,
    },
  );
  const loadError = useSwrLoadError(error, MAIL_STATUS_OBJECT, mutate);
  return { mails: data ?? {}, loadError, refresh: mutate };
}

/** The e-mails of each group message, counted by result (#7058). */
export function useGroupThreadMails(groupThreadId: string | undefined) {
  const { data, error, mutate } = useSWRAuth(
    groupThreadId ? messageKeys.groupMessageMails(groupThreadId) : null,
    () => fetchGroupThreadMails(groupThreadId ?? ""),
    {
      refreshInterval: (mails) =>
        refreshWhileOnItsWay(
          Object.values(mails ?? {}).flatMap((counts) => Object.keys(counts)),
        ),
      revalidateOnFocus: true,
    },
  );
  const loadError = useSwrLoadError(error, MAIL_STATUS_OBJECT, mutate);
  return { mails: data ?? {}, loadError, refresh: mutate };
}
