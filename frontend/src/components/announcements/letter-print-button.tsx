"use client";

import { Printer } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { useApiErrorDisplay } from "~/contexts/ToastContext";
import { downloadLetterPrint } from "~/lib/parent-announcements-api";
import type { AnnouncementApiBase } from "~/lib/parent-announcements-api";

/**
 * Lädt alle Briefe eines veröffentlichten Elternbriefs als ein PDF zum
 * Drucken (#4813): ein Brief je Kind, mit Name und Logo der Schule. Für
 * Familien, die den Brief nicht in moto lesen.
 */
export function LetterPrintButton({
  announcementId,
  apiBase,
}: Readonly<{ announcementId: string; apiBase?: AnnouncementApiBase }>) {
  const { show: showError } = useApiErrorDisplay();
  const [busy, setBusy] = useState(false);

  const print = async () => {
    setBusy(true);
    try {
      await downloadLetterPrint(announcementId, apiBase);
    } catch (error) {
      void showError(error, {
        object: "die Briefe zum Drucken",
        retry: () => void print(),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="md"
      onClick={() => void print()}
      isLoading={busy}
      loadingText="PDF wird erstellt…"
      tooltip="Lädt alle Briefe als PDF, ein Brief je Kind zum Ausdrucken."
      className="gap-2"
    >
      <Printer className="h-4 w-4" aria-hidden />
      Briefe drucken
    </Button>
  );
}
