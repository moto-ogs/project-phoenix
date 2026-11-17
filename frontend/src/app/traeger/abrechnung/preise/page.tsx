"use client";

// Preisliste der Monatsbeiträge (#4684): je Schule ein Monatspreis für jeden
// gebuchten Wochentag eines Moduls, gültig ab dem 1. eines Monats bis zum
// nächsten Preis. Der Monatslauf rechnet damit ab. Ein Monat, den schon eine
// Rechnung abrechnet, behält seine Preise. Der Filter `?schule=` öffnet die
// Preise einer Schule, zum Beispiel aus „Ohne Preis“ im Monatslauf.

import { Tags } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import {
  billingAreaTitle,
  billingTabs,
} from "~/components/traeger/billing-family-format";
import {
  careSchools,
  formatMonth,
  missingPrices,
  monthOf,
  priceRowsAt,
  priceStands,
  standAt,
} from "~/components/traeger/care-billing-format";
import { CarePriceListCard } from "~/components/traeger/care-price-list-card";
import { CarePriceListModal } from "~/components/traeger/care-price-list-modal";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { ConfirmDeleteModal } from "~/components/ui/confirm-delete-modal";
import { EmptyState } from "~/components/ui/empty-state";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { fetchCareRules } from "~/lib/traeger-care-reductions-api";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { createLogger } from "~/lib/logger";
import { traegerBillingKeys } from "~/lib/swr/traeger-billing-keys";
import {
  deleteCarePriceList,
  fetchCareTariffs,
} from "~/lib/traeger-care-billing-api";

const logger = createLogger({ component: "TraegerPreislistePage" });

const SCHOOL_PARAM = "schule";

interface SchoolRef {
  readonly id: string;
  readonly name: string;
}

export default function TraegerPreislistePage() {
  // `useSearchParams` braucht eine Suspense-Grenze; bis dahin lädt die Seite.
  return (
    <Suspense
      fallback={<TenantPage title={billingAreaTitle("preise")} loading />}
    >
      <PriceListPage />
    </Suspense>
  );
}

function PriceListPage() {
  const searchParams = useSearchParams();
  const focusSchool = searchParams?.get(SCHOOL_PARAM) ?? "";
  const currentMonth = monthOf(useBerlinToday());
  const {
    data,
    loading,
    error: loadError,
    mutate,
  } = useTraegerResource(
    traegerBillingKeys.careTariffs(),
    fetchCareTariffs,
    "die Preisliste",
  );
  const [shown, setShown] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<SchoolRef | null>(null);
  const [deleting, setDeleting] = useState<
    (SchoolRef & { validFrom: string }) | null
  >(null);
  const [busy, setBusy] = useState(false);
  const deleteErrors = useApiFormError();
  const { success } = useToast();

  // The sibling rules decide whether the list's sibling prices are charged;
  // without them (not loaded, no right) the cells keep showing them. Their
  // failure stays silent: the page shows the sibling prices as before.
  const { data: ruleSet } = useTraegerResource(
    traegerBillingKeys.careRules(),
    fetchCareRules,
    "die Regeln der Ermäßigungen",
  );
  const siblingRules = useMemo(
    () => ruleSet?.rules.filter((rule) => rule.kind === "sibling") ?? null,
    [ruleSet],
  );

  // Open a school asked for in the address once its data is there.
  useEffect(() => {
    if (!data || !focusSchool) return;
    const school = data.schools.find((entry) => entry.id === focusSchool);
    if (!school) return;
    globalThis.document
      ?.getElementById(`care-prices-${school.id}`)
      ?.scrollIntoView({ block: "start" });
  }, [data, focusSchool]);

  const shownMonth = (schoolId: string) =>
    data
      ? (shown[schoolId] ?? standAt(priceStands(data, schoolId), currentMonth))
      : "";

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    deleteErrors.clear();
    try {
      await mutate(await deleteCarePriceList(deleting.id, deleting.validFrom), {
        revalidate: false,
      });
      setShown(({ [deleting.id]: _removed, ...rest }) => rest);
      success(
        `Die Preise ab ${formatMonth(deleting.validFrom)} sind gelöscht.`,
      );
      setDeleting(null);
    } catch (err) {
      logger.error("care_price_list_delete_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void deleteErrors.show(err, { object: "die Preisliste" });
    } finally {
      setBusy(false);
    }
  };

  const schools = data ? careSchools(data) : [];
  const gaps = data
    ? schools.reduce(
        (count, school) =>
          count +
          priceRowsAt(data, school.id, currentMonth).filter(
            (row) => missingPrices(row).length > 0,
          ).length,
        0,
      )
    : 0;
  const modules = data?.modules.length ?? 0;

  return (
    <TenantPage
      title={billingAreaTitle("preise")}
      info="Hier legen Sie die Monatspreise fest. Jede Schule hat eigene Preise, je Modul und gebuchtem Wochentag. Neue Preise gelten ab dem 1. eines Monats. Ferienpreise legen Sie im Ferienzeitraum fest."
      stats={
        data && modules > 0 ? (
          <TenantPageStats
            items={[
              {
                value: schools.length,
                label: schools.length === 1 ? "Schule" : "Schulen",
              },
              { value: modules, label: modules === 1 ? "Modul" : "Module" },
              ...(gaps > 0
                ? [
                    {
                      value: gaps,
                      label:
                        gaps === 1
                          ? "Modul ohne vollen Preis"
                          : "Module ohne vollen Preis",
                    },
                  ]
                : []),
            ]}
          />
        ) : null
      }
      statsLoading={loading}
      tabs={billingTabs("preise")}
      error={loadError}
      loading={loading}
      overlays={
        data ? (
          <>
            <CarePriceListModal
              data={data}
              school={editing}
              currentMonth={currentMonth}
              initialMonth={editing ? shown[editing.id] : undefined}
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
              title="Preise löschen?"
              description={
                deleting
                  ? `Die Preise von ${deleting.name} ab ${formatMonth(deleting.validFrom)} fallen weg. Dann gelten wieder die Preise davor.`
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
          icon={<Tags className="h-12 w-12" aria-hidden="true" />}
          title="Noch keine Schule."
          description="Preise gibt es für die Schulen Ihres Trägers."
        />
      ) : null}
      {data
        ? schools.map((school) => {
            const selectedMonth = shownMonth(school.id);
            const currentStand = standAt(
              priceStands(data, school.id),
              currentMonth,
            );
            // A list that holds now uses today’s month, not its start month.
            // Earlier and planned lists keep their selected month.
            const ruleMonth =
              selectedMonth <= currentMonth && selectedMonth === currentStand
                ? currentMonth
                : selectedMonth || currentMonth;
            return (
              <div
                key={school.id}
                id={`care-prices-${school.id}`}
                className="scroll-mt-24"
              >
                <CarePriceListCard
                  data={data}
                  school={school}
                  shownMonth={selectedMonth}
                  currentMonth={currentMonth}
                  onShownMonthChange={(month) =>
                    setShown((current) => ({ ...current, [school.id]: month }))
                  }
                  onEdit={() => setEditing(school)}
                  onDelete={(validFrom) =>
                    setDeleting({ ...school, validFrom })
                  }
                  siblingPricesApply={(careOfferingId) =>
                    siblingRules === null ||
                    siblingRules.some(
                      (rule) =>
                        rule.tariffSiblingPrice === true &&
                        (rule.schoolIds.length === 0 ||
                          rule.schoolIds.includes(school.id)) &&
                        (rule.careOfferingIds.length === 0 ||
                          rule.careOfferingIds.includes(careOfferingId)) &&
                        rule.validFrom <= ruleMonth &&
                        (rule.validUntil === null ||
                          rule.validUntil >= ruleMonth),
                    )
                  }
                />
              </div>
            );
          })
        : null}
    </TenantPage>
  );
}
