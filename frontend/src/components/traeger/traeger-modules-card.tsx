"use client";

import { FramedList } from "~/components/ui/framed-list";
import { ConceptIconTile } from "~/components/ui/concept-icon-tile";
import { SectionCard } from "~/components/ui/section-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { billingConcept } from "~/lib/concepts/billing";
import { careContractsConcept } from "~/lib/concepts/careContracts";
import { dashboardConcept } from "~/lib/concepts/dashboard";
import { holidayWeeksConcept } from "~/lib/concepts/holidayWeeks";
import type { MotoConcept } from "~/lib/moto-concepts";
import { MODULE_LABELS, type ModuleKey } from "~/lib/modules";
import {
  TRAEGER_MODULE_KEYS,
  TRAEGER_MODULE_SUMMARIES,
  type TraegerModuleKey,
} from "~/lib/traeger-modules";

/** Das Symbol des Bereichs, den das Modul in der Seitenleiste öffnet. */
const MODULE_CONCEPTS: Readonly<Record<TraegerModuleKey, MotoConcept>> = {
  traeger_uebersicht: dashboardConcept,
  ferienbetreuung: holidayWeeksConcept,
  vertraege: careContractsConcept,
  elternbeitraege: billingConcept,
};

/**
 * Die moto-Module des Träger-Portals mit ihrem Stand (#6052): gebucht oder
 * nicht. Eine reine Anzeige, wie der Reiter „Module“ einer Schule: Gebucht
 * wird im Vertrag mit moto, das moto-Team schaltet die Module je Schule.
 * Hierhin führt der erklärende Zustand einer gesperrten Seite.
 *
 * `bookedModules` ist `null`, solange der Rahmen des Portals lädt.
 */
export function TraegerModulesCard({
  bookedModules,
}: {
  readonly bookedModules: readonly ModuleKey[] | null;
}) {
  return (
    <SectionCard
      title="Gebuchte moto-Module"
      description="Ein moto-Modul gilt für deinen Träger, sobald eine deiner Schulen es gebucht hat. Was gebucht ist, steht im Vertrag mit moto. Für eine Änderung wende dich an das moto-Team."
      loading={bookedModules === null}
    >
      <FramedList>
        {TRAEGER_MODULE_KEYS.map((module) => {
          const booked = bookedModules?.includes(module) === true;
          return (
            <li
              key={module}
              data-traeger-module={module}
              className="flex items-start gap-3 px-4 py-3"
            >
              <ConceptIconTile concept={MODULE_CONCEPTS[module]} size="sm" />
              <div className="min-w-0 flex-1 space-y-0.5">
                {/* Name und Stand in einer Zeile; am Telefon steht der Stand
                    in jeder Zeile unter dem Namen, die Erklärung behält die
                    Breite. */}
                <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                  <p className="text-sm font-semibold wrap-anywhere text-gray-900">
                    {MODULE_LABELS[module]}
                  </p>
                  <StatusBadge
                    tone={booked ? "green" : "gray"}
                    label={booked ? "Gebucht" : "Nicht gebucht"}
                    className="shrink-0"
                  />
                </div>
                <p className="text-sm text-gray-600">
                  {TRAEGER_MODULE_SUMMARIES[module]}
                </p>
              </div>
            </li>
          );
        })}
      </FramedList>
    </SectionCard>
  );
}
