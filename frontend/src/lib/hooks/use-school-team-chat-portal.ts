"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { SCHOOL_STAFF_MESSAGE_ATTACHMENTS } from "~/lib/message-attachments";
import type { TeamChatPortal } from "~/lib/team-chat-portal";
import { schoolStaffMessagesApi } from "~/lib/school-staff-messages-api";
import { SCHOOL_MESSAGES_ROUTE } from "~/lib/school-team-chat-links";
import { schoolPath } from "~/lib/school-url";

export { SCHOOL_MESSAGES_ROUTE };

/**
 * The school-portal binding of the shared Team-Chat surfaces (#2208). No
 * tenant context here: the school session is bound to one school, and the
 * feature flag is not cached client-side — the backend's stable
 * `communication.staff_messaging_disabled` code decides the off-state.
 */
export function useSchoolTeamChatPortal(): TeamChatPortal {
  const router = useRouter();
  const { data: session } = useSession();
  // Team-Chat uses useSWR directly (rather than the tenant-aware wrapper), so
  // its scope must carry the authenticated school session itself. Otherwise a
  // logout followed by a login at another school could render cached threads.
  const cacheScope = `school:${session?.user.tenantId ?? "pending"}:${session?.user.id ?? "pending"}`;
  return useMemo(
    () => ({
      kind: "school",
      api: schoolStaffMessagesApi,
      attachments: SCHOOL_STAFF_MESSAGE_ATTACHMENTS,
      cacheScope,
      inboxHref: SCHOOL_MESSAGES_ROUTE,
      threadHref: (threadId) => `${SCHOOL_MESSAGES_ROUTE}/${threadId}`,
      navigate: (href) => router.push(schoolPath(href)),
      flagSaysEnabled: undefined,
      title: "Nachrichten",
      emptyDescription:
        "Hier stehen deine Unterhaltungen mit der OGS. Du schreibst an die Leitung oder an eine Betreuungskraft deiner Schule. Eltern sehen davon nichts.",
      info: "Hier schreibst du mit der Leitung und den Betreuungskräften deiner OGS. Wähle eine Unterhaltung, um zu lesen und zu antworten. Mit „Neue Nachricht“ schreibst du jemandem zum ersten Mal.",
      recipientHint:
        "Du schreibst an Personen der OGS deiner Schule. Die Nachricht kommt in deren Team-Chat an.",
    }),
    [router, cacheScope],
  );
}
