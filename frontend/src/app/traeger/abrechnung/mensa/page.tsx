"use client";

// Mensa-Abrechnung des Trägers (#4686): je Schule, ob der Monatslauf die
// Mensa je Essen oder als Pauschale je Kind und Monat abrechnet, ab welchem
// Monat und zu welchem Preis. Gezählt wird nur ein Monat, den die
// OGS-Leitung freigegeben hat.

import { ForkKnifeIcon } from "@phosphor-icons/react";
import { useState } from "react";
import {
  billingAreaTitle,
  billingTabs,
} from "~/components/traeger/billing-family-format";
import { formatMonth, monthOf } from "~/components/traeger/care-billing-format";
import { CareMealPriceModal } from "~/components/traeger/care-meal-price-modal";
import { CareMealSchoolCard } from "~/components/traeger/care-meal-school-card";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { ConfirmDeleteModal } from "~/components/ui/confirm-delete-modal";
import { EmptyState } from "~/components/ui/empty-state";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { berlinTodayISO } from "~/lib/date-helpers";
import { createLogger } from "~/lib/logger";
import { traegerBillingKeys } from "~/lib/swr/traeger-billing-keys";
import {
  type CareMealTariff,
  deleteCareMealTariff,
  fetchCareMealTariffs,
  mealTariffOn,
} from "~/lib/traeger-care-meal-api";

const logger = createLogger({ component: "TraegerMensaPage" });

interface SchoolRef {
  readonly id: string;
  readonly name: string;
}

export default function TraegerMensaPage() {
  const currentMonth = monthOf(berlinTodayISO());
  const {
    data,
    loading,
    error: loadError,
    mutate,
  } = useTraegerResource(
    traegerBillingKeys.careMealTariffs(),
    fetchCareMealTariffs,
    "die Übersicht der Mensa-Preise",
  );
  const [editing, setEditing] = useState<SchoolRef | null>(null);
  const [deleting, setDeleting] = useState<
    (SchoolRef & { tariff: CareMealTariff }) | null
  >(null);
  const [busy, setBusy] = useState(false);
  const deleteErrors = useApiFormError();
  const { success } = useToast();

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    deleteErrors.clear();
    try {
      await mutate(
        await deleteCareMealTariff(deleting.id, deleting.tariff.validFrom),
        { revalidate: false },
      );
      success(
        `Der Mensa-Preis ab ${formatMonth(deleting.tariff.validFrom)} ist gelöscht.`,
      );
      setDeleting(null);
    } catch (err) {
      logger.error("care_meal_tariff_delete_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void deleteErrors.show(err, { object: "die Preisangabe für die Mensa" });
    } finally {
      setBusy(false);
    }
  };

  const schools = data?.schools ?? [];
  const priced = data
    ? schools.filter((school) =>
        mealTariffOn(data.tariffs, school.id, currentMonth),
      ).length
    : 0;

  return (
    <TenantPage
      title={billingAreaTitle("mensa")}
      info="Hier legst du fest, wie die Mensa jeder Schule abgerechnet wird: je Essen oder als feste Pauschale je Kind und Monat. Gezählt wird nur ein Monat, den die OGS-Leitung freigegeben hat. Der Monatslauf setzt die Mensa auf die Rechnung des Kindes."
      stats={
        data && schools.length > 0 ? (
          <TenantPageStats
            items={[
              {
                value: schools.length,
                label: schools.length === 1 ? "Schule" : "Schulen",
              },
              { value: priced, label: "mit Mensa-Preis" },
            ]}
          />
        ) : null
      }
      statsLoading={loading}
      tabs={billingTabs("mensa")}
      error={loadError}
      loading={loading}
      overlays={
        data ? (
          <>
            <CareMealPriceModal
              data={data}
              school={editing}
              currentMonth={currentMonth}
              onClose={() => setEditing(null)}
              onSaved={(next) => {
                void mutate(next, { revalidate: false });
                setEditing(null);
              }}
            />
            <ConfirmDeleteModal
              isOpen={deleting !== null}
              onClose={() => {
                setDeleting(null);
                deleteErrors.clear();
              }}
              onConfirm={() => void remove()}
              title="Mensa-Preis löschen?"
              description={
                deleting
                  ? `Der Mensa-Preis von ${deleting.name} ab ${formatMonth(deleting.tariff.validFrom)} fällt weg. Dann gilt wieder der Preis davor.`
                  : ""
              }
              confirmLabel="Löschen"
              loadingLabel="Wird gelöscht …"
              gate={{ mode: "twoStep", firstStepLabel: "Ja, löschen" }}
              loading={busy}
              error={deleteErrors.error}
            />
          </>
        ) : null
      }
    >
      {data && schools.length === 0 ? (
        <EmptyState
          icon={<ForkKnifeIcon className="h-12 w-12" aria-hidden="true" />}
          title="Noch keine Schule."
          description="Mensa-Preise gibt es für die Schulen deines Trägers."
        />
      ) : null}
      {/* Equal school cards in a grid: grids do not grow (TenantPage body
          rule), so the last school keeps its height like its siblings. */}
      {data && schools.length > 0 ? (
        <div className="compact:gap-4 grid gap-6 max-sm:gap-3">
          {schools.map((school) => (
            <CareMealSchoolCard
              key={school.id}
              data={data}
              school={school}
              currentMonth={currentMonth}
              onEdit={() => setEditing(school)}
              onDelete={(tariff) => setDeleting({ ...school, tariff })}
            />
          ))}
        </div>
      ) : null}
    </TenantPage>
  );
}
