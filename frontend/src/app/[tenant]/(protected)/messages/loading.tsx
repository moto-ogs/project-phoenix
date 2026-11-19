"use client";

import { TenantPage } from "~/components/ui/tenant-page";
import { MessagesSkeleton } from "./page-skeleton";

// Info-Knopf am Seitentitel (#7578): wofür die Seite da ist.
const MESSAGES_INFO =
  "Hier schreibst du mit den Eltern der Kinder. Jede Unterhaltung gehört zu einer Person und ihrem Kind. Tippe auf eine Unterhaltung, um sie zu öffnen.";

/**
 * Route-level loading UI: das Seitengerüst mit Titel rendert sofort, nur die
 * Statuszeile und die Liste skelettieren. Suche und Filter fehlen hier
 * bewusst, es gibt noch keinen Seitenzustand, den sie bedienen könnten.
 */
export default function MessagesLoading() {
  return (
    <TenantPage info={MESSAGES_INFO} title="Nachrichten" statsLoading>
      <MessagesSkeleton />
    </TenantPage>
  );
}
