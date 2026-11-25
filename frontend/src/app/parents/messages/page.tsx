import { ParentPageSkeleton } from "~/components/parent/parent-page";
import { Suspense } from "react";
import { ParentPageSeed } from "~/app/parents/parent-page-seed";
import { ParentConversationMessages } from "~/i18n/shared-page-messages";
import { ParentMessagesPage } from "~/components/parent/messages/parent-messages-page";

export default function ParentsMessagesPage() {
  return (
    <ParentConversationMessages>
      <Suspense fallback={<ParentPageSkeleton rows={2} />}>
        <ParentPageSeed page={{ kind: "messages" }}>
          <ParentMessagesPage />
        </ParentPageSeed>
      </Suspense>
    </ParentConversationMessages>
  );
}
