"use client";

// Konten und Kostenstellen (#4821): auf welches Erlöskonto moto die Beiträge
// jeder Leistung und jedes Angebots bucht, welche Kostenstelle (KOST1) eine
// Schule, ihre Ferienbetreuung (#7357) und die Ferienbetreuung ohne Schule
// haben und welche zweite Kostenstelle (KOST2) ein Angebot hat, jeweils ab
// einem Tag. Beim Ausstellen hält jede Rechnungsposition ihre Werte fest;
// DATEV-Datei und Sollstellung buchen damit. Nur das Recht „Finanz-Export“
// sieht die Seite.

import {
  CostCentersCard,
  RevenueAccountsCard,
} from "~/components/traeger/booking-accounts-cards";
import {
  costCenterOn,
  costCenterTimeline,
} from "~/components/traeger/booking-accounts-format";
import { DATEV_SETTINGS_PATH } from "~/components/traeger/finance-export-datev";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { Alert } from "~/components/ui/alert";
import { ButtonLink } from "~/components/ui/button";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { useToast } from "~/contexts/ToastContext";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { traegerBillingKeys } from "~/lib/swr/traeger-billing-keys";
import {
  addCostCenter,
  deleteCostCenter,
  fetchBookingAccounts,
  saveRevenueAccount,
} from "~/lib/traeger-finance-exports-api";
import { traegerPath } from "~/lib/traeger-url";

const EXPORTS_PATH = "/traeger/abrechnung/exporte";

const INFO =
  "Ihr Steuerbüro bucht die Beiträge auf Erlöskonten und Kostenstellen. Legen Sie hier fest, welche Leistung wohin gehört. Eine Rechnung hält die Werte beim Ausstellen fest. Eine Änderung gilt nur für neue Rechnungen.";

export default function TraegerBookingAccountsPage() {
  const today = useBerlinToday();
  const {
    data: page,
    loading,
    error,
    mutate,
  } = useTraegerResource(
    traegerBillingKeys.bookingAccounts(),
    fetchBookingAccounts,
    "die Konten und Kostenstellen",
  );
  const { success } = useToast();

  const schoolsWithCenter = page
    ? page.schools.filter(
        (school) =>
          costCenterOn(
            costCenterTimeline(page.costCenters, "school", school.id),
            today,
          )?.code,
      ).length
    : 0;

  return (
    <TenantPage
      title="Konten und Kostenstellen"
      info={INFO}
      back
      backHref={traegerPath(EXPORTS_PATH)}
      backLabel="Zurück zu den Exporten"
      stats={
        page ? (
          <TenantPageStats
            items={[
              {
                value: page.standardAccount || "fehlt",
                label: "Standard-Erlöskonto",
              },
              {
                value: `${schoolsWithCenter} von ${page.schools.length}`,
                label:
                  page.schools.length === 1
                    ? "Schule mit Kostenstelle"
                    : "Schulen mit Kostenstelle",
              },
            ]}
          />
        ) : null
      }
      statsLoading={loading}
      error={error}
      loading={loading}
    >
      {page ? (
        <>
          {page.standardAccount ? null : (
            <Alert
              type="warning"
              title="Das Standard-Erlöskonto fehlt"
              message="Ohne Standard-Erlöskonto gibt es keine DATEV-Datei. Tragen Sie es in den DATEV-Werten ein."
              action={
                <ButtonLink
                  href={traegerPath(DATEV_SETTINGS_PATH)}
                  variant="ghost_tone"
                  size="compact"
                  tooltip="Öffnet die DATEV-Werte in den Einstellungen."
                >
                  DATEV-Werte eintragen
                </ButtonLink>
              }
            />
          )}
          <RevenueAccountsCard
            page={page}
            onSave={async (scope, scopeId, account) => {
              await mutate(await saveRevenueAccount(scope, scopeId, account), {
                revalidate: false,
              });
              success(
                account
                  ? "Das Erlöskonto ist gespeichert."
                  : "Das eigene Erlöskonto ist entfernt.",
              );
            }}
          />
          <CostCentersCard
            kind="kost1"
            page={page}
            today={today}
            onAdd={async (scope, scopeId, validFrom, code) => {
              await mutate(
                await addCostCenter({ scope, scopeId, validFrom, code }),
                { revalidate: false },
              );
              success("Die Kostenstelle ist gespeichert.");
            }}
            onDeleted={async (id) => {
              await mutate(await deleteCostCenter(id), { revalidate: false });
            }}
          />
          <CostCentersCard
            kind="kost2"
            page={page}
            today={today}
            onAdd={async (scope, scopeId, validFrom, code) => {
              await mutate(
                await addCostCenter({ scope, scopeId, validFrom, code }),
                { revalidate: false },
              );
              success("Die Kostenstelle ist gespeichert.");
            }}
            onDeleted={async (id) => {
              await mutate(await deleteCostCenter(id), { revalidate: false });
            }}
          />
        </>
      ) : null}
    </TenantPage>
  );
}
