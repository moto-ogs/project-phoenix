"use client";

// Dokumentart je Leistung (#4688): Die Abrechnung wählt, ob ein Lauf eine
// Rechnung, einen Gebührenbescheid oder (Ferien) eine Bestätigung mit
// Rechnung ausstellt. Der Gebührenbescheid druckt die
// Rechtsbehelfsbelehrung der Vorlage „Bescheid“; ohne sie wird er nicht
// freigegeben. Wählen darf, wer das Recht „Abrechnung“ hat.

import { useSession } from "next-auth/react";
import { DocumentKindCard } from "~/components/traeger/document-kind-card";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { Alert } from "~/components/ui/alert";
import { ButtonLink } from "~/components/ui/button";
import { SectionCard } from "~/components/ui/section-card";
import { TenantPage } from "~/components/ui/tenant-page";
import { hasPermission } from "~/lib/auth-utils";
import { contributionsConcept } from "~/lib/concepts/contributions";
import { documentTemplatesConcept } from "~/lib/concepts/documentTemplates";
import { holidayWeeksConcept } from "~/lib/concepts/holidayWeeks";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import { fetchBillingIssuerStatuses } from "~/lib/traeger-billing-issuers-api";
import {
  fetchDocumentKinds,
  mergeSavedService,
} from "~/lib/traeger-document-kinds-api";
import { traegerPath } from "~/lib/traeger-url";

const BILLING_RIGHT = "traeger_billing:manage";
const NOTICE_TEMPLATE_PATH =
  "/traeger/einstellungen/briefkopf/vorlagen/bescheid";

const INFO =
  "Hier legst du fest, welches Schreiben die Familien pro Leistung bekommen. Die Wahl gilt ab der nächsten Freigabe. Schon ausgestellte Schreiben bleiben, wie sie sind.";

export default function TraegerDocumentKindsPage() {
  const { data: session } = useSession();
  const canBill = hasPermission(session ?? null, BILLING_RIGHT);
  const canEditTemplates = hasPermission(
    session ?? null,
    "traeger_settings:manage",
  );
  const remedyInstruction = canEditTemplates
    ? "Trage sie zuerst in der Vorlage ein."
    : "Frag eine Person mit der Rolle „Verwaltung“, ob sie es einträgt.";
  const {
    data: overview,
    loading,
    error,
    mutate,
  } = useTraegerResource(
    canBill ? traegerKeys.documentKinds() : null,
    fetchDocumentKinds,
    "die Liste der Dokumentarten",
  );
  // A Schulträger or a Gemeinde that bills a school itself chooses its own
  // kinds (#8040); its standard is the fee notice.
  const issuers = useTraegerResource(
    canBill ? traegerKeys.billingIssuers() : null,
    fetchBillingIssuerStatuses,
    "die Liste der Stellen, die selbst abrechnen",
  );
  const reloadIssuers = issuers.reload;
  const notice =
    overview?.services.some(
      (service) => service.documentKind === "fee_notice",
    ) ||
    issuers.data?.some((status) =>
      status.services.some((service) => service.documentKind === "fee_notice"),
    );

  return (
    <TenantPage
      title="Dokumentarten"
      info={INFO}
      error={error ?? issuers.error}
      loading={loading}
    >
      {canBill ? null : (
        <Alert
          type="info"
          message="Die Dokumentarten wählt die Rolle „Abrechnung“."
        />
      )}
      {overview ? (
        <>
          {overview.services.map((service) => (
            <DocumentKindCard
              key={service.service}
              service={service}
              legalRemedyMissing={!overview.legalRemedySet}
              concept={
                service.service === "holiday"
                  ? holidayWeeksConcept
                  : contributionsConcept
              }
              onSaved={(next) =>
                void mutate(
                  (current) =>
                    mergeSavedService(current ?? null, next, service.service),
                  { revalidate: false },
                )
              }
            />
          ))}
          {issuers.data?.flatMap((status) =>
            status.services.map((service) => (
              <DocumentKindCard
                key={`${status.issuer.key}-${service.service}`}
                issuer={status.issuer}
                service={{ ...service, updatedAt: null }}
                legalRemedyMissing={!overview.legalRemedySet}
                concept={
                  service.service === "holiday"
                    ? holidayWeeksConcept
                    : contributionsConcept
                }
                onSaved={() => void reloadIssuers()}
              />
            )),
          )}
          <SectionCard
            title="Rechtsbehelfsbelehrung"
            description="Steht auf jedem Gebührenbescheid. Den Text ändert, wer die Rolle „Verwaltung“ hat."
            concept={documentTemplatesConcept}
            action={
              <ButtonLink
                href={traegerPath(NOTICE_TEMPLATE_PATH)}
                variant={
                  overview.legalRemedySet || !canEditTemplates
                    ? "outline"
                    : "primary"
                }
                size="md"
                tooltip={
                  overview.legalRemedySet || !canEditTemplates
                    ? "Öffnet die Vorlage der Rechtsbehelfsbelehrung für die Bescheide."
                    : "Öffnet die Vorlage, damit du die Rechtsbehelfsbelehrung einträgst."
                }
              >
                {overview.legalRemedySet || !canEditTemplates
                  ? "Vorlage ansehen"
                  : "Belehrung eintragen"}
              </ButtonLink>
            }
          >
            {overview.legalRemedySet ? (
              <Alert
                type="success"
                message={`Deine Vorlage „Bescheid“ hat eine Rechtsbehelfsbelehrung (Version ${overview.feeNoticeTemplateVersion}).`}
              />
            ) : (
              <Alert
                type={notice ? "warning" : "info"}
                title="Noch keine Rechtsbehelfsbelehrung"
                message={
                  notice
                    ? `Ohne Belehrung kannst du keinen Gebührenbescheid freigeben. ${remedyInstruction}`
                    : "Du brauchst sie erst, wenn eine Leistung Gebührenbescheide ausstellt."
                }
              />
            )}
          </SectionCard>
        </>
      ) : null}
    </TenantPage>
  );
}
