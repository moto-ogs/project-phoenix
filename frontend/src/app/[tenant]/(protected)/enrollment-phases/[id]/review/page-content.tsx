"use client";

import { use } from "react";
import { RolloverReviewQueue } from "~/components/enrollment/rollover-review-queue";
import { TenantPage } from "~/components/ui/tenant-page";
import { useRequirePermission } from "~/lib/hooks/use-require-permission";

const ROLLOVER_REVIEW_INFO =
  "Hier stehen Kinder, die moto nicht selbst in die nächste Phase übernehmen konnte. Du entscheidest pro Kind. Ist die Liste leer, gibt es nichts zu tun.";

interface PageProps {
  readonly params: Promise<{ tenant: string; id: string }>;
}

/**
 * Admin review queue for rolled-over enrollments that could not be
 * carried forward automatically (grade above cap, missing grade, etc).
 */
export default function RolloverReviewPage({ params }: PageProps) {
  const { id } = use(params);
  const { isReady } = useRequirePermission("config:manage");

  // Titel, Statuszeile und Zurück-Knopf trägt die Prüfliste selbst.
  if (!isReady) {
    return (
      <TenantPage
        title="Prüfliste"
        info={ROLLOVER_REVIEW_INFO}
        back
        backHref="/enrollment-phases"
        backLabel="Zurück zu den Anmeldephasen"
        statsLoading
        loading
      />
    );
  }

  return <RolloverReviewQueue phaseID={id} info={ROLLOVER_REVIEW_INFO} />;
}
