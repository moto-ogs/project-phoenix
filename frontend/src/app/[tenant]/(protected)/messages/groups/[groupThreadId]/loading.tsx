"use client";

import { SectionCard } from "~/components/ui/section-card";
import { TenantPage } from "~/components/ui/tenant-page";
import {
  ThreadComposerSkeleton,
  ThreadSkeleton,
} from "../../[threadId]/page-skeleton";

// Info-Knopf am Seitentitel (#7578): wofür die Seite da ist.
const GROUP_THREAD_INFO =
  "Hier liest du die Nachricht an alle Eltern dieser Gruppe. Solange sie offen ist und Eltern-Nachrichten eingeschaltet sind, kannst du etwas dazuschreiben. Unter „Gelesen“ siehst du pro Kind, ob ein Elternteil die neueste Nachricht gelesen hat.";

/**
 * Route-level loading UI einer Gruppennachricht (#4784): das Seitengerüst
 * rendert sofort, nur die Statuszeile, der Verlauf und das Eingabefeld
 * skelettieren.
 */
export default function GroupMessageLoading() {
  return (
    <TenantPage
      info={GROUP_THREAD_INFO}
      title="Gruppennachricht"
      statsLoading
      back
      backHref="/messages/groups"
      backLabel="Zurück zu Gruppennachrichten"
    >
      <SectionCard>
        <ThreadSkeleton />
        <ThreadComposerSkeleton />
      </SectionCard>
    </TenantPage>
  );
}
