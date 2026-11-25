"use client";

// Die Schulen des Trägers mit ihren Zuständigkeiten (#4811): je Bereich die
// Stelle, die wirklich zuständig ist. „Eigener Wert“ heißt, die Schule weicht
// vom Träger ab; ein Hinweis nennt, welche Angaben einer gewählten Stelle
// noch fehlen. Die Zeile führt zur Schule, wo die Angaben stehen.

import { useRouter } from "next/navigation";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { EmptyState } from "~/components/ui/empty-state";
import { SectionCard } from "~/components/ui/section-card";
import {
  RESPONSIBILITY_AREAS,
  RESPONSIBILITY_AREA_LABELS,
  type ResponsibilityArea,
  type SchoolResponsibility,
} from "~/lib/traeger-responsibilities-api";
import { traegerPath } from "~/lib/traeger-url";
import { ResponsibilityValue } from "./responsibility-value";

/** The school's tab with its responsibilities and bodies. */
function schoolResponsibilityHref(schoolId: string): string {
  return traegerPath(
    `/traeger/schulen/${encodeURIComponent(schoolId)}?bereich=zustaendigkeiten`,
  );
}

function areaColumn(
  area: ResponsibilityArea,
): DataTableColumn<SchoolResponsibility> {
  return {
    key: area,
    header: RESPONSIBILITY_AREA_LABELS[area],
    render: (school) => {
      const entry = school.areas.find((candidate) => candidate.area === area);
      return entry ? <ResponsibilityValue school={school} area={entry} /> : "–";
    },
    stacked: "field",
  };
}

const COLUMNS: DataTableColumn<SchoolResponsibility>[] = [
  {
    key: "school",
    header: "Schule",
    render: (school) => (
      <span className="font-medium text-gray-900">{school.schoolName}</span>
    ),
    sortValue: (school) => school.schoolName,
    stacked: "title",
  },
  ...RESPONSIBILITY_AREAS.map(areaColumn),
];

export function ResponsibilitySchoolsCard({
  schools,
}: Readonly<{ schools: readonly SchoolResponsibility[] }>) {
  const router = useRouter();
  return (
    <SectionCard
      title="Pro Schule"
      description="Wer an jeder Schule zuständig ist. Name und Anschrift von Schulträger und Gemeinde trägst du bei der Schule ein. Solange sie fehlen, bleibt dein Träger zuständig."
    >
      <DataTable
        columns={COLUMNS}
        rows={[...schools]}
        getRowKey={(school) => school.schoolId}
        onRowClick={(school) =>
          router.push(schoolResponsibilityHref(school.schoolId))
        }
        emptyState={
          <EmptyState
            variant="compact"
            title="Dein Träger hat noch keine Schule."
          />
        }
      />
    </SectionCard>
  );
}
