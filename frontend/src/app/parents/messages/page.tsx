import { ParentConversationMessages } from "~/i18n/shared-page-messages";
import { ParentMessagesPage } from "~/components/parent/messages/parent-messages-page";

export default function ParentsMessagesPage() {
  return (
    <ParentConversationMessages>
      <ParentMessagesPage />
    </ParentConversationMessages>
  );
}
