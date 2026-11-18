"use client";

// Ein Betreuungsangebot einer Anmeldephase des Trägers ändern (#4704).

import { useParams, useRouter } from "next/navigation";
import { CatalogOfferingForm } from "~/components/traeger/catalog-offering-form";
import {
  CatalogOfferingSummary,
  offeringStatus,
} from "~/components/traeger/catalog-phase-cards";
import { useTraegerCatalogPhase } from "~/components/traeger/use-traeger-catalog";
import { StatusBadge } from "~/components/ui/status-badge";
import { TenantPage } from "~/components/ui/tenant-page";
import { useToast } from "~/contexts/ToastContext";
import { useInvalidateFamily } from "~/lib/swr";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import { updateTraegerOffering } from "~/lib/traeger-catalog-api";
import { traegerPath } from "~/lib/traeger-url";

export default function TraegerCatalogOfferingPage() {
  const router = useRouter();
  const params = useParams<{ id: string; offeringId: string }>();
  const id = params?.id ?? "";
  const offeringId = params?.offeringId ?? "";
  const { data: phase, loadError } = useTraegerCatalogPhase(id);
  const invalidate = useInvalidateFamily();
  const { success } = useToast();
  const phaseHref = traegerPath(`/traeger/anmeldephasen/${id}`);
  const offering = phase?.offerings.find((entry) => entry.id === offeringId);
  const editable = Boolean(
    offering && !offering.withdrawnAt && !phase?.withdrawnAt,
  );

  return (
    <TenantPage
      title={offering?.draft.fields.name ?? "Betreuungsangebot"}
      info="Deine Änderung erreicht die Schulen erst, wenn du überträgst. Hat eine Schule ein Feld selbst geändert, behält sie ihren Wert."
      back
      backHref={phaseHref}
      backLabel={
        phase ? `Zurück zu „${phase.draft.name}“` : "Zurück zur Anmeldephase"
      }
      actions={
        offering && !editable ? (
          <StatusBadge {...offeringStatus(offering)} />
        ) : null
      }
      error={loadError}
      loading={!loadError && !phase}
      empty={
        phase && !offering ? { title: "Dieses Angebot gibt es nicht." } : null
      }
    >
      {phase && offering && editable ? (
        <CatalogOfferingForm
          key={offering.id}
          offering={offering}
          saveLabel="Speichern"
          onSave={(draft) => updateTraegerOffering(offering.id, draft)}
          onCancel={() => router.push(phaseHref)}
          onSaved={() => {
            void invalidate(traegerKeys.catalogFamily);
            success(
              "Gespeichert. Die Schulen bekommen die Änderung, wenn du überträgst.",
            );
            router.push(phaseHref);
          }}
        />
      ) : null}
      {phase && offering && !editable ? (
        <CatalogOfferingSummary
          offering={offering}
          phaseWithdrawn={Boolean(phase.withdrawnAt)}
        />
      ) : null}
    </TenantPage>
  );
}
