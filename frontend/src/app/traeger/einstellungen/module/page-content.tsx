"use client";

// Die moto-Module des Träger-Portals (#6052): gebucht oder nicht. Die
// Schalter gelten je Schule und liegen beim moto-Team; das Träger-Büro sieht
// hier nur ihren Stand. Ein Modul gilt für den Träger, sobald eine seiner
// Schulen es gebucht hat. Hierhin führt der erklärende Zustand einer Seite,
// deren moto-Modul nicht gebucht ist.

import { TraegerModulesCard } from "~/components/traeger/traeger-modules-card";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { TenantPage } from "~/components/ui/tenant-page";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import { fetchTraegerOrganization } from "~/lib/traeger-api";

const INFO =
  "Hier siehst du, welche moto-Module dein Träger gebucht hat. Schulen, Schließtage, Anmeldephasen, Dokumente und Personal gehören immer dazu.";

export default function TraegerModulesPage() {
  const {
    data: organization,
    loading,
    error,
  } = useTraegerResource(
    traegerKeys.organization(),
    fetchTraegerOrganization,
    "die Liste der moto-Module",
  );
  return (
    <TenantPage
      title="moto-Module"
      info={INFO}
      error={error}
      loading={loading && !organization}
    >
      {organization ? (
        <TraegerModulesCard bookedModules={organization.bookedModules} />
      ) : null}
    </TenantPage>
  );
}
