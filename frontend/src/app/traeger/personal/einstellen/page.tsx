"use client";

// „Person einstellen“ (#7206, ADR 0089 Abschnitte 1 und 3): Die
// Personalverwaltung stellt eine neue Person ein, ohne dass eine Schule sie
// vorher anlegt. moto legt die Akte und den Arbeitsvertrag beim Träger an und
// an jedem Einsatzort die Person mit ihrer Beschäftigung.

import { BuildingsIcon, LockKeyIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { StaffHireWizard } from "~/components/traeger/staff/staff-hire-wizard";
import { EmptyState } from "~/components/ui/empty-state";
import { SectionCard } from "~/components/ui/section-card";
import { TenantPage } from "~/components/ui/tenant-page";
import { useApiLoadError } from "~/contexts/ToastContext";
import { createLogger } from "~/lib/logger";
import {
  fetchStaffOverview,
  type StaffOverview,
} from "~/lib/traeger-staff-api";
import { traegerPath } from "~/lib/traeger-url";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";

const logger = createLogger({ component: "TraegerStaffHirePage" });

const INFO =
  "Hier stellen Sie eine Person ein, die noch an keiner Ihrer Schulen arbeitet. moto legt die Personalakte und den Arbeitsvertrag an. An jeder gewählten Schule entsteht die Person. Zugang, Transponder und Rolle richtet danach die Schule ein. Arbeitet die Person schon an einer Schule? Dann legen Sie ihre Akte bei den Personalakten unter „Ohne Akte“ an.";

export default function TraegerStaffHirePage() {
  const today = useBerlinToday();
  const [overview, setOverview] = useState<StaffOverview | null>(null);
  const pageLoad = useApiLoadError();
  const { show: showLoadError, clear: clearLoadError } = pageLoad;

  const load = useCallback(async () => {
    try {
      setOverview(await fetchStaffOverview());
      clearLoadError();
    } catch (err) {
      logger.error("traeger_staff_hire_load_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      await showLoadError(err, {
        object: "die Schulen",
        retry: () => void load(),
      });
    }
  }, [clearLoadError, showLoadError]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <TenantPage
      title="Person einstellen"
      info={INFO}
      back
      backHref={traegerPath("/traeger/personal")}
      backLabel="Zurück zu den Personalakten"
      error={pageLoad.error}
      loading={!overview && !pageLoad.error}
    >
      {overview && overview.release === null ? (
        <SectionCard>
          <EmptyState
            icon={<LockKeyIcon className="h-12 w-12" aria-hidden="true" />}
            title="Personal beim Träger ist noch nicht freigeschaltet."
            description="Das moto-Team schaltet es frei, sobald Ihr Träger bestätigt hat: Es gibt eine Vereinbarung mit Betriebsrat oder Mitarbeitervertretung, oder es gibt keine Vertretung. Bis dahin legt jede Schule ihr Personal selbst an."
          />
        </SectionCard>
      ) : null}
      {overview?.release && overview.schools.length === 0 ? (
        <SectionCard>
          <EmptyState
            icon={<BuildingsIcon className="h-12 w-12" aria-hidden="true" />}
            title="Ihr Träger hat noch keine Schule."
            description="Eine Person arbeitet immer an mindestens einer Schule. Sobald das moto-Team eine Schule für Sie angelegt hat, können Sie hier einstellen."
          />
        </SectionCard>
      ) : null}
      {overview?.release && overview.schools.length > 0 ? (
        <StaffHireWizard schools={overview.schools} today={today} />
      ) : null}
    </TenantPage>
  );
}
