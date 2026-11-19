"use client";

import { SectionCard } from "~/components/ui/section-card";
import { TenantPage } from "~/components/ui/tenant-page";
import { ThreadSkeleton, ThreadComposerSkeleton } from "./page-skeleton";

// Info-Knopf am Seitentitel (#7578): wofür die Seite da ist.
const THREAD_INFO =
  "Hier liest du die Unterhaltung mit den Eltern eines Kindes. Die neueste Nachricht steht unten. Wenn Eltern-Nachrichten eingeschaltet sind, kannst du darunter antworten.";

/**
 * Route-level loading UI: das Seitengerüst rendert sofort, nur die
 * Statuszeile, der Verlauf und das Eingabefeld skelettieren.
 */
export default function MessageThreadLoading() {
  return (
    <TenantPage
      info={THREAD_INFO}
      title="Unterhaltung"
      statsLoading
      back
      backHref="/messages"
      backLabel="Zurück zu Nachrichten"
    >
      <div className="flex min-h-[20rem] w-full flex-col overflow-hidden">
        <SectionCard
          className="flex min-h-0 flex-1 flex-col"
          bodyClassName="flex min-h-0 flex-1 flex-col"
        >
          <ThreadSkeleton />
          <ThreadComposerSkeleton />
        </SectionCard>
      </div>
    </TenantPage>
  );
}
