"use client";

import { use } from "react";
import { TenantPage } from "~/components/ui/tenant-page";
import { RolloverForm } from "~/components/enrollment/rollover-form";
import { getPhase } from "~/lib/enrollment-phase-api";
import { useRequirePermission } from "~/lib/hooks/use-require-permission";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { useSWRAuth } from "~/lib/swr";
import { tenantAdminKeys } from "~/lib/swr/tenant-admin-keys";
import { useTenantRouter } from "~/lib/tenant-router";
import { useRefreshPhaseExpiryWarnings } from "~/components/enrollment/phase-expiry-warnings";

const ROLLOVER_INFO =
  "Mit einer Anschlussphase laufen bestätigte Anmeldungen in einem neuen Zeitraum weiter, zum Beispiel im nächsten Halbjahr. Prüfe zuerst die Vorschau. Danach trägst du Zeitraum, Modus und Frist ein.";

interface PageProps {
  readonly params: Promise<{ id: string }>;
}

export default function MobileRolloverPage({ params }: PageProps) {
  const { id } = use(params);
  const { isReady } = useRequirePermission("config:manage");
  const router = useTenantRouter();
  const refreshPhaseExpiryWarnings = useRefreshPhaseExpiryWarnings();
  const {
    data: phase,
    error: phaseError,
    mutate,
  } = useSWRAuth(
    isReady ? tenantAdminKeys.enrollmentPhase(id) : null,
    () => getPhase(id),
    { keepPreviousData: false },
  );
  const phaseLoad = useSwrResourceLoadError(
    [{ data: phase, error: phaseError }],
    "die Anmeldephase",
    () => mutate(),
  );

  if (!isReady || (!phase && !phaseLoad.failure)) {
    return (
      <TenantPage
        title="Anschlussphase erstellen"
        info={ROLLOVER_INFO}
        back
        backHref="/enrollment-phases"
        backLabel="Zurück zu den Anmeldephasen"
        statsLoading
        loading
      />
    );
  }

  // Titel, Statuszeile und Zurück-Knopf trägt das Formular selbst.
  if (!phase) {
    return (
      <TenantPage
        title="Anschlussphase erstellen"
        info={ROLLOVER_INFO}
        back
        backHref="/enrollment-phases"
        backLabel="Zurück zu den Anmeldephasen"
        error={phaseLoad.error}
      />
    );
  }

  return (
    <RolloverForm
      variant="page"
      info={ROLLOVER_INFO}
      source={phase}
      // Router navigation keeps the loaded shell; a full document load
      // would build it again (#5001).
      onCancel={() => router.replace("/home")}
      onSuccess={() => {
        refreshPhaseExpiryWarnings();
        router.replace("/home");
      }}
    />
  );
}
