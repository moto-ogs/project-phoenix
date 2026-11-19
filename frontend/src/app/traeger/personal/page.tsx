"use client";

// Personalakten des Trägers über alle Schulen (#4705, ADR 0089): die Akten
// mit ihren Einsatzorten, die Vorschläge, welche Beschäftigungen dieselbe
// Person sind, und das Personal, das noch keine Akte hat. Ein Vorschlag oder
// eine Person öffnet den Dialog zum Verknüpfen; eine Akte ihre Seite.

import {
  IdentificationCardIcon,
  LinkSimpleIcon,
  MagnifyingGlassIcon,
  UploadSimpleIcon,
  UserPlusIcon,
} from "@phosphor-icons/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { StaffLinkModal } from "~/components/traeger/staff/staff-link-modal";
import { StaffNotReleasedPage } from "~/components/traeger/staff/staff-not-released-page";
import {
  parseStaffCreateRecord,
  parseStaffOverviewTab,
  staffSubpageHref,
  type StaffOverviewTab,
} from "~/components/traeger/staff/staff-overview-tab";
import { useTraegerListExportItems } from "~/components/traeger/traeger-list-export-menu";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import {
  STAFF_MATCH_LABELS,
  STAFF_MATCH_TONES,
} from "~/components/traeger/staff/staff-record-format";
import { ButtonLink } from "~/components/ui/button";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import type {
  ActiveFilter,
  FilterConfig,
} from "~/components/ui/page-header/types";
import { StatusBadge } from "~/components/ui/status-badge";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { useToast } from "~/contexts/ToastContext";
import { formatDate } from "~/lib/date-helpers";
import { foldForSearch } from "~/lib/search-fold";
import { traegerStaffKeys } from "~/lib/swr/traeger-staff-keys";
import {
  downloadStaffRecordList,
  fetchStaffOverview,
  staffName,
  type StaffCandidate,
  type StaffLinkInput,
  type StaffRecordSummary,
  type StaffSuggestion,
} from "~/lib/traeger-staff-api";

const INFO = (
  <div className="space-y-2">
    <p>
      Hier führst du jede Person, die dein Träger beschäftigt, mit einer Akte
      über alle Schulen. Die Akte führt die Personalnummer des Trägers und die
      Bank- und Steuerdaten. Die Schulen arbeiten weiter mit ihrem Personal wie
      bisher. Lehrkräfte des Landes und Kräfte anderer Träger bekommen keine
      Akte.
    </p>
    <p>
      Unter „Vorschläge“ stehen Beschäftigungen, die wohl dieselbe Person sind.
      Öffne einen Vorschlag, prüfe die Werte und lege die Akte an.
    </p>
    <p>
      Unter „Akten“ gilt jede Akte für alle Schulen. Öffne eine Akte für
      Personalnummer, Bank und Steuer und den Verlauf.
    </p>
    <p>
      Unter „Ohne Akte“ stehen Personen, die an einer Schule arbeiten und noch
      keine Akte haben. Öffne eine Person, um ihre Akte anzulegen.
    </p>
  </div>
);

/** Passt der Name (oder die Personalnummer) zur Suche? */
function matchesSearch(
  query: string,
  person: {
    readonly firstName: string;
    readonly lastName: string;
    readonly personnelNumber?: string | null;
  },
): boolean {
  if (query === "") return true;
  const haystack = foldForSearch(
    `${person.firstName} ${person.lastName} ${person.lastName} ${person.firstName} ${person.personnelNumber ?? ""}`,
  );
  return foldForSearch(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

const RECORD_COLUMNS: DataTableColumn<StaffRecordSummary>[] = [
  {
    key: "name",
    header: "Name",
    render: (record) => (
      <span className="block min-w-0">
        <span className="block truncate font-medium text-gray-900">
          {staffName(record)}
        </span>
        {record.birthday ? (
          <span className="block text-sm text-gray-500 tabular-nums">
            geboren am {formatDate(record.birthday)}
          </span>
        ) : null}
      </span>
    ),
    sortValue: (record) =>
      `${record.lastName} ${record.firstName}`.toLowerCase(),
    stacked: "title",
  },
  {
    key: "number",
    header: "Personalnummer",
    render: (record) => (
      <span className="font-mono text-sm text-gray-700 tabular-nums">
        {record.personnelNumber ?? "–"}
      </span>
    ),
    sortValue: (record) => record.personnelNumber ?? "",
    stacked: "field",
  },
  {
    key: "employments",
    header: "Einsatzorte",
    render: (record) =>
      record.employments.length === 0 ? (
        <span className="text-sm text-gray-500">–</span>
      ) : (
        <span className="flex max-w-full min-w-0 flex-wrap gap-1.5">
          {record.employments.map((employment) => (
            <StatusBadge
              key={`${employment.schoolId}-${employment.staffId}`}
              label={
                employment.active
                  ? employment.schoolName
                  : `${employment.schoolName} (beendet)`
              }
              tone={employment.active ? "outline" : "gray"}
              wrap
            />
          ))}
        </span>
      ),
    sortValue: (record) => record.employments.length,
    stacked: "field",
  },
  {
    key: "financial",
    header: "Bank und Steuer",
    render: (record) =>
      record.hasFinancial ? (
        <StatusBadge label="Hinterlegt" tone="green" />
      ) : (
        <span className="text-sm text-gray-500">–</span>
      ),
    sortValue: (record) => (record.hasFinancial ? 1 : 0),
    stacked: "hidden",
  },
];

function suggestionColumns(
  records: ReadonlyMap<string, StaffRecordSummary>,
): DataTableColumn<StaffSuggestion>[] {
  return [
    {
      key: "people",
      header: "Wer",
      render: (suggestion) => {
        const record = suggestion.recordId
          ? records.get(suggestion.recordId)
          : undefined;
        return (
          <span className="block min-w-0 space-y-0.5">
            {record ? (
              <span className="block truncate font-medium text-gray-900">
                Akte {staffName(record)}
              </span>
            ) : null}
            {suggestion.members.map((member) => (
              <span
                key={`${member.schoolId}-${member.staffId}`}
                className="block truncate text-sm text-gray-700"
              >
                <span className="font-medium text-gray-900">
                  {staffName(member)}
                </span>
                {" · "}
                {member.schoolName}
              </span>
            ))}
          </span>
        );
      },
      stacked: "title",
    },
    {
      key: "reason",
      header: "Warum",
      render: (suggestion) => (
        <span className="flex flex-wrap gap-1.5">
          <StatusBadge
            label={STAFF_MATCH_LABELS[suggestion.reason]}
            tone={STAFF_MATCH_TONES[suggestion.reason]}
          />
          {suggestion.recordId ? (
            <StatusBadge label="Passt zu einer Akte" tone="purple" />
          ) : null}
        </span>
      ),
      stacked: "field",
    },
  ];
}

const CANDIDATE_COLUMNS: DataTableColumn<StaffCandidate>[] = [
  {
    key: "name",
    header: "Name",
    render: (candidate) => (
      <span className="block truncate font-medium text-gray-900">
        {staffName(candidate)}
      </span>
    ),
    sortValue: (candidate) =>
      `${candidate.lastName} ${candidate.firstName}`.toLowerCase(),
    stacked: "title",
  },
  {
    key: "school",
    header: "Schule",
    render: (candidate) => (
      <span className="text-sm text-gray-700">{candidate.schoolName}</span>
    ),
    sortValue: (candidate) => candidate.schoolName,
    stacked: "field",
  },
  {
    key: "number",
    header: "Personalnummer",
    render: (candidate) => (
      <span className="font-mono text-sm text-gray-700 tabular-nums">
        {candidate.personnelNumber ?? "–"}
      </span>
    ),
    sortValue: (candidate) => candidate.personnelNumber ?? "",
    stacked: "hidden",
  },
];

const linkRequestOf = (suggestion: StaffSuggestion) => ({
  recordId: suggestion.recordId,
  members: suggestion.members.map((member) => ({
    schoolId: member.schoolId,
    staffId: member.staffId,
  })),
});

export default function TraegerStaffRecordsPage() {
  // `useSearchParams` braucht eine Suspense-Grenze.
  return (
    <Suspense fallback={<TenantPage title="Personalakten" loading />}>
      <StaffRecordsContent />
    </Suspense>
  );
}

function StaffRecordsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { success } = useToast();
  const {
    data: overview,
    loading,
    error,
    reload,
  } = useTraegerResource(
    traegerStaffKeys.overview(),
    fetchStaffOverview,
    "die Personalakten",
  );
  // Der Reiter steht in der Adresse (#7377): Abbrechen und Zurück einer
  // Unterseite führen so auf ihn zurück, und der Zurück-Knopf des Browsers
  // auch.
  const tab = parseStaffOverviewTab(searchParams?.get("tab"));
  const [linking, setLinking] = useState<Omit<
    StaffLinkInput,
    "choices"
  > | null>(null);
  // Suche nach Name oder Personalnummer und Filter nach Schule (#7415), wie
  // die Personalliste der Schule. Sie gelten in allen drei Reitern.
  const [query, setQuery] = useState("");
  const [schoolId, setSchoolId] = useState("");
  // „Akte anlegen“ aus der Rückfrage beim Einstellen (#7378) öffnet den
  // Dialog für genau diese Person; die Adresse trägt sie, bis er schließt.
  const requested = parseStaffCreateRecord(searchParams);
  const requestedSchool = requested?.schoolId;
  const requestedStaff = requested?.staffId;
  // Dieselbe Anfrage, solange dieselbe Person in der Adresse steht: der
  // Dialog beginnt bei einer neuen Anfrage von vorn.
  const requestedLink = useMemo(
    () =>
      requestedSchool && requestedStaff
        ? {
            recordId: null,
            members: [{ schoolId: requestedSchool, staffId: requestedStaff }],
          }
        : null,
    [requestedSchool, requestedStaff],
  );

  const records = useMemo(
    () =>
      new Map((overview?.records ?? []).map((record) => [record.id, record])),
    [overview],
  );
  const proposals = useMemo(
    () =>
      (overview?.suggestions ?? []).filter(
        (suggestion) =>
          suggestion.members.length > 1 || suggestion.recordId !== null,
      ),
    [overview],
  );
  const singles = useMemo(
    () =>
      (overview?.suggestions ?? [])
        .filter(
          (suggestion) =>
            suggestion.members.length === 1 && suggestion.recordId === null,
        )
        .flatMap((suggestion) => suggestion.members),
    [overview],
  );
  const shownProposals = useMemo(
    () =>
      proposals.filter((suggestion) => {
        const record = suggestion.recordId
          ? records.get(suggestion.recordId)
          : undefined;
        const inSchool =
          schoolId === "" ||
          suggestion.members.some((member) => member.schoolId === schoolId);
        const found =
          (record !== undefined && matchesSearch(query, record)) ||
          suggestion.members.some((member) => matchesSearch(query, member));
        return inSchool && found;
      }),
    [proposals, records, query, schoolId],
  );
  const shownRecords = useMemo(
    () =>
      (overview?.records ?? []).filter(
        (record) =>
          matchesSearch(query, record) &&
          (schoolId === "" ||
            record.employments.some(
              (employment) => employment.schoolId === schoolId,
            )),
      ),
    [overview, query, schoolId],
  );
  const shownSingles = useMemo(
    () =>
      singles.filter(
        (candidate) =>
          matchesSearch(query, candidate) &&
          (schoolId === "" || candidate.schoolId === schoolId),
      ),
    [singles, query, schoolId],
  );
  const columns = useMemo(() => suggestionColumns(records), [records]);
  const released = overview?.release != null;
  const active: StaffOverviewTab =
    tab ?? (proposals.length > 0 ? "vorschlaege" : "akten");
  const changeTab = (next: string) => {
    const params = new URLSearchParams(searchParams?.toString());
    params.set("tab", next);
    router.replace(`?${params.toString()}`, { scroll: false });
  };
  // Nach Schließen oder Anlegen öffnet dieselbe Person in der Adresse den
  // Dialog nicht noch einmal, auch bevor der Router die Adresse geändert hat.
  const requestedKey =
    requestedSchool && requestedStaff
      ? `${requestedSchool}-${requestedStaff}`
      : null;
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  // Verlässt die Adresse die Person, gilt das Schließen nicht mehr: kommt
  // sie wieder, öffnet der Dialog erneut.
  if (requestedKey === null && dismissedKey !== null) setDismissedKey(null);
  const linkRequest =
    linking ??
    (released && requestedKey !== dismissedKey ? requestedLink : null);
  const closeLink = () => {
    setLinking(null);
    setDismissedKey(requestedKey);
    if (!requested) return;
    const params = new URLSearchParams(searchParams?.toString());
    params.delete("schule");
    params.delete("person");
    router.replace(`?${params.toString()}`, { scroll: false });
  };
  // Unterseiten merken sich auch den aufgelösten Standard-Reiter. Ein Import
  // kann Vorschläge erzeugen; der Rückweg bleibt trotzdem auf dem Reiter,
  // von dem das Träger-Büro kam.
  const recordHref = (id: string) =>
    staffSubpageHref(`/traeger/personal/${id}`, active);

  const exportItems = useTraegerListExportItems({
    download: downloadStaffRecordList,
    scope:
      "Alle Akten, ohne Suche und Filter. Jeder Download steht im Zugriffsprotokoll der Schulen.",
    fallbackName: "personalakten",
    errorObject: "die Personalakten",
    unavailable: !overview || overview.records.length === 0,
  });

  if (overview && !released) {
    return (
      <StaffNotReleasedPage
        title="Personalakten"
        description="Bis zur Freischaltung führt jede Schule ihr Personal selbst."
      />
    );
  }

  const schools = overview?.schools ?? [];
  const chosenSchool = schools.find((school) => school.id === schoolId);
  const filters: FilterConfig[] =
    schools.length > 1
      ? [
          {
            id: "school",
            label: "Schule",
            type: "dropdown",
            value: schoolId,
            onChange: (value) => setSchoolId(value as string),
            options: [
              { value: "", label: "Alle Schulen" },
              ...schools.map((school) => ({
                value: school.id,
                label: school.name,
              })),
            ],
          },
        ]
      : [];
  const activeFilters: ActiveFilter[] = [
    ...(query
      ? [{ id: "search", label: `„${query}“`, onRemove: () => setQuery("") }]
      : []),
    ...(chosenSchool
      ? [
          {
            id: "school",
            label: chosenSchool.name,
            onRemove: () => setSchoolId(""),
          },
        ]
      : []),
  ];
  const filtering = activeFilters.length > 0;
  const clearFilters = () => {
    setQuery("");
    setSchoolId("");
  };
  // Findet die Suche nichts, nennt der Leerzustand das und setzt zurück.
  const noMatch = (
    <EmptyState
      icon={<MagnifyingGlassIcon className="h-12 w-12" aria-hidden="true" />}
      title="Kein Treffer."
      description="Niemand passt zu Suche und Schule. Prüfe die Schreibweise oder wähle alle Schulen."
      action={
        <Button
          type="button"
          variant="outline"
          size="md"
          onClick={clearFilters}
          noTooltip="Filter zurücksetzen sagt, was passiert; es ändert keine Daten."
        >
          Filter zurücksetzen
        </Button>
      }
    />
  );

  return (
    <TenantPage
      title="Personalakten"
      info={INFO}
      stats={
        overview ? (
          <TenantPageStats
            items={[
              {
                value: overview.records.length,
                label: overview.records.length === 1 ? "Akte" : "Akten",
              },
              {
                value: proposals.length,
                label: proposals.length === 1 ? "Vorschlag" : "Vorschläge",
              },
              {
                value: overview.schools.length,
                label: overview.schools.length === 1 ? "Schule" : "Schulen",
              },
            ]}
          />
        ) : null
      }
      statsLoading={loading}
      actions={
        overview ? (
          <ButtonLink
            href={staffSubpageHref("/traeger/personal/einstellen", active)}
            className="gap-2"
            variant="primary"
            size="md"
            tooltip="Öffnet das Formular für eine neue Person mit Akte, Vertrag und Schulen."
          >
            <UserPlusIcon className="h-4 w-4" aria-hidden="true" />
            Person einstellen
          </ButtonLink>
        ) : undefined
      }
      search={
        overview
          ? {
              value: query,
              onChange: setQuery,
              placeholder: "Name oder Nummer suchen…",
            }
          : undefined
      }
      filters={filters}
      activeFilters={activeFilters}
      onClearAllFilters={clearFilters}
      overflowMenu={
        overview
          ? [
              {
                label: "Personal importieren",
                description: "Übernimmt Personal aus einer CSV-Datei.",
                icon: (
                  <UploadSimpleIcon className="h-4 w-4" aria-hidden="true" />
                ),
                href: staffSubpageHref("/traeger/personal/import", active),
                onClick: () => undefined,
              },
              ...exportItems,
            ]
          : undefined
      }
      error={error}
      loading={loading}
      tabs={
        overview
          ? {
              value: active,
              onChange: changeTab,
              label: "Bereiche der Personalakten",
              inUrl: true,
              items: [
                {
                  value: "vorschlaege",
                  label: "Vorschläge",
                  badge: proposals.length,
                },
                { value: "akten", label: "Akten" },
                { value: "ohne-akte", label: "Ohne Akte" },
              ],
            }
          : undefined
      }
      overlays={
        <StaffLinkModal
          request={linkRequest}
          onClose={closeLink}
          onLinked={(record) => {
            setLinking(null);
            setDismissedKey(requestedKey);
            success(`Die Akte von ${staffName(record)} ist verknüpft.`);
            reload();
            router.push(recordHref(record.id));
          }}
        />
      }
    >
      {overview && active === "vorschlaege" ? (
        <DataTable
          columns={columns}
          rows={[...shownProposals]}
          getRowKey={(suggestion) =>
            suggestion.members
              .map((member) => `${member.schoolId}-${member.staffId}`)
              .join("+")
          }
          stackedOnMobile
          onRowClick={(suggestion) => setLinking(linkRequestOf(suggestion))}
          emptyState={
            filtering && proposals.length > 0 ? (
              noMatch
            ) : (
              <EmptyState
                icon={
                  <LinkSimpleIcon className="h-12 w-12" aria-hidden="true" />
                }
                title="Kein offener Vorschlag."
                description="Sobald dieselbe Person an zwei Schulen arbeitet, steht der Vorschlag hier."
              />
            )
          }
        />
      ) : null}

      {overview && active === "akten" ? (
        <DataTable
          columns={RECORD_COLUMNS}
          rows={[...shownRecords]}
          getRowKey={(record) => record.id}
          stackedOnMobile
          onRowClick={(record) => router.push(recordHref(record.id))}
          emptyState={
            filtering && overview.records.length > 0 ? (
              noMatch
            ) : (
              <EmptyState
                icon={
                  <IdentificationCardIcon
                    className="h-12 w-12"
                    aria-hidden="true"
                  />
                }
                title="Noch keine Akte."
                description="Stelle oben mit „Person einstellen“ eine neue Person ein. Für Personal, das schon an einer Schule arbeitet: Verknüpfe einen Vorschlag, lege unter „Ohne Akte“ eine Akte an, oder wähle im Menü mit den drei Punkten „Personal importieren“."
              />
            )
          }
        />
      ) : null}

      {overview && active === "ohne-akte" ? (
        <DataTable
          columns={CANDIDATE_COLUMNS}
          rows={[...shownSingles]}
          getRowKey={(candidate) =>
            `${candidate.schoolId}-${candidate.staffId}`
          }
          stackedOnMobile
          onRowClick={(candidate) =>
            setLinking({
              recordId: null,
              members: [
                { schoolId: candidate.schoolId, staffId: candidate.staffId },
              ],
            })
          }
          emptyState={
            filtering && singles.length > 0 ? (
              noMatch
            ) : (
              <EmptyState
                title="Alle Personen haben eine Akte."
                description="Personal, das eine Schule selbst anlegt, erscheint hier."
              />
            )
          }
        />
      ) : null}
    </TenantPage>
  );
}
