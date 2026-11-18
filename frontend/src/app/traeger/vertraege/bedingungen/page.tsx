"use client";

// Vertragsbedingungen je Angebot (#4678): Laufzeit, Kündigung,
// Sonderkündigung, Satzung und Vertragspartner. Jeder neue Vertrag eines
// Angebots übernimmt sie; ohne sie entsteht für das Angebot kein Entwurf.

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { CareContractConditions } from "~/components/traeger/care-contract-conditions";
import { careContractTabs } from "~/components/traeger/care-contract-tabs";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { useUpdateUrlParams } from "~/hooks/useUpdateUrlParams";
import { useInvalidateFamily } from "~/lib/swr";
import { traegerContractKeys } from "~/lib/swr/traeger-contract-keys";
import { fetchContractTemplates } from "~/lib/traeger-care-contracts-api";

/** The chosen offering in the address: `?angebot=<schoolId>-<offeringId>`. */
const OFFERING_PARAM = "angebot";

export default function TraegerVertragsbedingungenPage() {
  return (
    <Suspense fallback={null}>
      <VertragsbedingungenContent />
    </Suspense>
  );
}

function VertragsbedingungenContent() {
  const searchParams = useSearchParams();
  const updateUrlParams = useUpdateUrlParams();
  const {
    data: offerings,
    loading,
    error,
    mutate,
  } = useTraegerResource(
    traegerContractKeys.templates(),
    fetchContractTemplates,
    "die Übersicht der Vertragsbedingungen",
  );
  const invalidateFamily = useInvalidateFamily();

  const active = offerings?.filter((offering) => offering.active) ?? [];
  const missing = active.filter((offering) => !offering.template).length;

  return (
    <TenantPage
      title="Verträge"
      info="Vertragsbedingungen legen fest, was in jedem Vertrag eines Angebots steht: Laufzeit, Kündigung, Sonderkündigung und Satzung. Den Brieftext änderst du unter „Einstellungen“ → „Briefkopf und Vorlagen“."
      tabs={careContractTabs("bedingungen", missing)}
      stats={
        offerings && active.length > 0 ? (
          <TenantPageStats
            items={[
              {
                value: active.length,
                label: active.length === 1 ? "Angebot" : "Angebote",
              },
              { value: active.length - missing, label: "festgelegt" },
              { value: missing, label: "fehlen" },
            ]}
          />
        ) : null
      }
      statsLoading={loading}
      error={error}
      loading={loading}
    >
      {offerings ? (
        <CareContractConditions
          offerings={offerings}
          selectedKey={searchParams.get(OFFERING_PARAM)}
          onSelect={(key) => updateUrlParams({ [OFFERING_PARAM]: key })}
          onSaved={(saved) => {
            void mutate(
              offerings.map((offering) =>
                offering.schoolId === saved.schoolId &&
                offering.offeringId === saved.offeringId
                  ? saved
                  : offering,
              ),
              { revalidate: false },
            );
            // Whether a child can get a draft depends on the conditions.
            void invalidateFamily(traegerContractKeys.candidates());
          }}
        />
      ) : null}
    </TenantPage>
  );
}
