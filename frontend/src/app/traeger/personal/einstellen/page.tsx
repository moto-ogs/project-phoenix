"use client";

// „Person einstellen“ (#7206, ADR 0089 Abschnitte 1 und 3): Die
// Personalverwaltung stellt eine neue Person ein, ohne dass eine Schule sie
// vorher anlegt. moto legt die Akte und den Arbeitsvertrag beim Träger an und
// an jedem Einsatzort die Person mit ihrer Beschäftigung.

import { BuildingsIcon } from "@phosphor-icons/react";
import { Suspense } from "react";
import { StaffHireWizard } from "~/components/traeger/staff/staff-hire-wizard";
import { StaffNotReleasedPage } from "~/components/traeger/staff/staff-not-released-page";
import { useStaffOverviewReturn } from "~/components/traeger/staff/staff-overview-tab";
import { TenantPage } from "~/components/ui/tenant-page";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { traegerStaffKeys } from "~/lib/swr/traeger-staff-keys";
import { fetchStaffOverview } from "~/lib/traeger-staff-api";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";

const INFO =
  "Hier stellst du eine Person ein, die noch an keiner deiner Schulen arbeitet. moto legt die Personalakte und den Arbeitsvertrag an. An jeder gewählten Schule entsteht die Person. Zugang, Transponder und Rolle richtet danach die Schule ein. Arbeitet die Person schon an einer Schule? Dann legst du ihre Akte bei den Personalakten unter „Ohne Akte“ an.";

export default function TraegerStaffHirePage() {
  // `useSearchParams` braucht eine Suspense-Grenze.
  return (
    <Suspense fallback={<TenantPage title="Person einstellen" loading />}>
      <StaffHireContent />
    </Suspense>
  );
}

function StaffHireContent() {
  const today = useBerlinToday();
  const { from, backHref } = useStaffOverviewReturn();
  const {
    data: overview,
    loading,
    error,
  } = useTraegerResource(
    traegerStaffKeys.overview(),
    fetchStaffOverview,
    "die Schulen",
  );

  if (overview && overview.release === null) {
    return (
      <StaffNotReleasedPage
        title="Person einstellen"
        description="Bis zur Freischaltung legt jede Schule ihr Personal selbst an."
      />
    );
  }

  return (
    <TenantPage
      title="Person einstellen"
      info={INFO}
      back
      backHref={backHref}
      backLabel="Zurück zu den Personalakten"
      error={error}
      loading={loading}
      empty={
        overview?.release && overview.schools.length === 0
          ? {
              icon: <BuildingsIcon className="h-12 w-12" aria-hidden="true" />,
              title: "Dein Träger hat noch keine Schule.",
              description:
                "Eine Person arbeitet immer an mindestens einer Schule. Sobald das moto-Team eine Schule für dich angelegt hat, kannst du hier einstellen.",
            }
          : undefined
      }
    >
      {overview?.release && overview.schools.length > 0 ? (
        <StaffHireWizard schools={overview.schools} today={today} from={from} />
      ) : null}
    </TenantPage>
  );
}
