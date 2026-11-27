import { Suspense } from "react";
import TraegerInvoiceJournalPage from "./page-content";

// Kein Server-Seed: Jedes Lesen der Liste steht im Protokoll der gezeigten
// Läufe und gehört deshalb zum Öffnen der Seite (docs/agents/frontend-api.md).
export default function Page() {
  return (
    <Suspense fallback={null}>
      <TraegerInvoiceJournalPage />
    </Suspense>
  );
}
