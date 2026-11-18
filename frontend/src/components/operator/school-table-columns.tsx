import { DataTableStatusBadge } from "~/components/ui/data-table";
import type { DataTableColumn } from "~/components/ui/data-table";
import { formatCount } from "~/lib/format-utils";
import type {
  SchoolRequiredDetails,
  SchoolSummary,
} from "~/lib/operator/provisioning-helpers";
import { StatusColorBadge } from "~/components/ui/status-color-badge";
import { LOCATION_COLORS } from "~/lib/location-helper";

interface BuildSchoolColumnsOptions {
  readonly showOrgColumn?: boolean;
  /**
   * What each school still lacks (#7174), by school id. Undefined hides the
   * column; a school missing from a loaded map shows "–".
   */
  readonly requiredDetails?: ReadonlyMap<string, SchoolRequiredDetails>;
}

/** The required details a school lacks, as badge labels (#7174). */
function missingRequiredDetails(
  details: SchoolRequiredDetails | undefined,
): string[] {
  return details?.replyAddressMissing ? ["Antwortadresse fehlt"] : [];
}

/** Whether a school lacks any required detail (#7174). */
export function lacksRequiredDetails(
  details: SchoolRequiredDetails | undefined,
): boolean {
  return missingRequiredDetails(details).length > 0;
}

export function buildSchoolColumns(
  options: BuildSchoolColumnsOptions = {},
): DataTableColumn<SchoolSummary>[] {
  const { showOrgColumn = false, requiredDetails } = options;
  const columns: DataTableColumn<SchoolSummary>[] = [
    {
      key: "name",
      header: "Schule",
      render: (row) => (
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-900">{row.name}</span>
            {row.hidden && (
              <StatusColorBadge
                label="Verborgen"
                color={LOCATION_COLORS.WARNING}
                compact
              />
            )}
          </div>
          <div className="font-mono text-xs text-gray-500">{row.subdomain}</div>
        </div>
      ),
      sortValue: (row) => row.name.toLowerCase(),
    },
  ];

  if (showOrgColumn) {
    columns.push({
      key: "traeger",
      header: "Träger",
      render: (row) => (
        <span className="text-gray-700">{row.organizationName}</span>
      ),
      sortValue: (row) => row.organizationName.toLowerCase(),
    });
  }

  columns.push(
    {
      key: "konten",
      header: "Konten",
      align: "right",
      render: (row) => formatCount(row.kontenCount),
      sortValue: (row) => row.kontenCount,
    },
    {
      key: "geraete",
      header: "Geräte",
      align: "right",
      render: (row) => formatCount(row.geraeteCount),
      sortValue: (row) => row.geraeteCount,
    },
    {
      key: "personen",
      header: "Personen",
      align: "right",
      render: (row) => formatCount(row.personenCount),
      sortValue: (row) => row.personenCount,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <DataTableStatusBadge active={row.active} />,
      sortValue: (row) => (row.active ? 0 : 1),
    },
  );

  if (requiredDetails) {
    columns.push({
      key: "pflichtangaben",
      header: "Pflichtangaben",
      render: (row) => {
        const details = requiredDetails.get(row.id);
        if (!details) return <span className="text-gray-500">–</span>;
        const missing = missingRequiredDetails(details);
        if (missing.length === 0) {
          return <span className="text-gray-500">Vollständig</span>;
        }
        return (
          <div className="flex flex-wrap gap-1">
            {missing.map((label) => (
              <StatusColorBadge
                key={label}
                label={label}
                color={LOCATION_COLORS.WARNING}
                compact
              />
            ))}
          </div>
        );
      },
      sortValue: (row) =>
        -missingRequiredDetails(requiredDetails.get(row.id)).length,
    });
  }

  return columns;
}
