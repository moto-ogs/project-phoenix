"use client";

import { TenantPage } from "~/components/ui/tenant-page";
import { MessagesSkeleton } from "../page-skeleton";

// Info-Knopf am Seitentitel (#7578): wofür die Seite da ist.
const GROUP_MESSAGES_INFO =
  "Hier schreibst du allen Eltern einer Gruppe, Klasse oder AG auf einmal. Die Eltern antworten nur der OGS, nicht den anderen Familien. Ihre Antworten findest du unter „Unterhaltungen“.";

/**
 * Route-level loading UI der Gruppennachrichten (#4784): das Seitengerüst
 * rendert sofort, nur die Statuszeile und die Liste skelettieren.
 */
export default function GroupMessagesLoading() {
  return (
    <TenantPage
      info={GROUP_MESSAGES_INFO}
      title="Gruppennachrichten"
      statsLoading
    >
      <MessagesSkeleton />
    </TenantPage>
  );
}
