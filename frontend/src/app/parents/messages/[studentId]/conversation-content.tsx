"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  type MessageAudience,
  childConversationPath,
} from "~/lib/messaging-status";
import { parentPath } from "~/lib/parent-url";
import { OgsConversation } from "~/components/parent/ogs-conversation";
import { ParentChildCareTermScope } from "~/lib/parent-care-term";

export function ParentChildConversationContent({
  studentId,
}: {
  readonly studentId: string;
}) {
  // `?audience=leadership` shows the conversation with the leadership only
  // (#5200); the switch writes it back, so reload and back keep the choice.
  const router = useRouter();
  const audience: MessageAudience =
    useSearchParams().get("audience") === "leadership" ? "leadership" : "team";
  // Reached only by multi-child parents picking a child from the list, so show
  // the back link and the child (to disambiguate which conversation this is).
  return (
    <ParentChildCareTermScope studentId={studentId}>
      <OgsConversation
        studentId={studentId}
        showBack
        audience={audience}
        onAudienceChange={(next) =>
          router.replace(parentPath(childConversationPath(studentId, next)))
        }
      />
    </ParentChildCareTermScope>
  );
}
