"use client";

// Zuständigkeiten einer Schule im Träger-Portal (#4811): wer Verträge
// schließt, abrechnet und Personal anstellt, und die Angaben zu Schulträger
// und Gemeinde dieser Schule. Die Wahl selbst ist eine Einstellung: für alle
// Schulen beim Träger, als eigener Wert in der Schul-App.

import { useSession } from "next-auth/react";
import { Alert } from "~/components/ui/alert";
import { ButtonLink } from "~/components/ui/button";
import { ConceptIconTile } from "~/components/ui/concept-icon-tile";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { FramedList } from "~/components/ui/framed-list";
import { SectionCard } from "~/components/ui/section-card";
import { hasPermission } from "~/lib/auth-utils";
import { settingsConcept } from "~/lib/concepts/settings";
import { useRefreshAfterWrite } from "~/lib/hooks/use-refresh-after-write";
import {
  type AreaResponsibility,
  RESPONSIBILITY_AREA_EFFECTS,
  RESPONSIBILITY_AREA_LABELS,
  SCHOOL_PARTY_KINDS,
  type SchoolResponsibility,
  partyOf,
} from "~/lib/traeger-responsibilities-api";
import { traegerPath } from "~/lib/traeger-url";
import { ResponsibilityValue } from "./responsibility-value";
import { SchoolPartyCard } from "./school-party-card";

/** The Träger right that changes master data and settings. */
const SETTINGS_RIGHT = "traeger_settings:manage";
const RESPONSIBILITY_SETTINGS_PATH = "/traeger/einstellungen/zustaendigkeiten";

const SOURCE_NOTES: Record<AreaResponsibility["source"], string> = {
  default: "Standard von moto",
  traeger: "Vom Träger für alle Schulen festgelegt",
  school: "Eigener Wert dieser Schule",
};

export function SchoolResponsibilityTab({
  school,
  reload,
}: Readonly<{
  school: SchoolResponsibility;
  /** Reads the schools again; rejects when the read fails (ADR 0311). */
  reload: () => Promise<readonly SchoolResponsibility[]>;
}>) {
  const { data: session } = useSession();
  const canEdit = hasPermission(session ?? null, SETTINGS_RIGHT);
  const afterWrite = useRefreshAfterWrite(
    "die Anzeige der Zuständigkeiten",
    reload,
  );
  return (
    <>
      {canEdit ? null : (
        <Alert
          type="info"
          message="Du kannst die Angaben nur ansehen. Ändern kann, wer im Träger-Büro die Rolle „Verwaltung“ hat."
        />
      )}
      <LoadErrorAlert error={afterWrite.error} />
      <SectionCard
        leading={<ConceptIconTile concept={settingsConcept} />}
        title="Wer ist zuständig?"
        description="Du legst das für alle Schulen in den Einstellungen fest. Einen eigenen Wert nur für diese Schule stellst du in der Schul-App ein: Einstellungen, Bereich „Zuständigkeiten“."
        actions={
          <ButtonLink
            href={traegerPath(RESPONSIBILITY_SETTINGS_PATH)}
            variant="outline"
            size="md"
            tooltip="Öffnet die Zuständigkeiten für alle Schulen."
          >
            Für alle Schulen festlegen
          </ButtonLink>
        }
      >
        <FramedList>
          {school.areas.map((area) => (
            <li
              key={area.area}
              className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 px-4 py-3"
            >
              <div className="min-w-48 flex-1">
                <p className="text-sm font-medium text-gray-900">
                  {RESPONSIBILITY_AREA_LABELS[area.area]}
                </p>
                <p className="mt-0.5 text-sm text-gray-500">
                  {RESPONSIBILITY_AREA_EFFECTS[area.area]}
                </p>
              </div>
              <div className="min-w-48 text-sm sm:w-64 sm:flex-none">
                <ResponsibilityValue school={school} area={area} />
                <p className="mt-1 text-sm text-gray-500">
                  {SOURCE_NOTES[area.source]}
                </p>
              </div>
            </li>
          ))}
        </FramedList>
      </SectionCard>
      {SCHOOL_PARTY_KINDS.map((kind) => (
        <SchoolPartyCard
          key={kind}
          schoolId={school.schoolId}
          schoolName={school.schoolName}
          kind={kind}
          party={partyOf(school, kind)}
          areas={school.areas}
          canEdit={canEdit}
          reload={async () => {
            const schools = await reload();
            const read = schools.find(
              (other) => other.schoolId === school.schoolId,
            );
            return read ? partyOf(read, kind) : undefined;
          }}
          onChanged={afterWrite.refresh}
        />
      ))}
    </>
  );
}
