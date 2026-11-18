"use client";

// Personalnachweise des Trägers (#4707, ADR 0089 Abschnitt 7, ADR 0238):
// die Ablaufliste über alle Personalakten, die Nachweisarten mit Gültigkeit,
// Warnung und Pflicht, und die Zuordnung der Nachweisarten jeder Schule.
// Eingetragen wird ein Nachweis in der Personalakte. Jedes Anzeigen der
// Liste und jeder Export steht im Zugriffsprotokoll der Einsatzorte.

import { CertificateIcon, PlusIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import {
  StaffProofTypeModal,
  type StaffProofTypeTarget,
} from "~/components/traeger/staff/staff-proof-type-modal";
import { Button, ButtonLink } from "~/components/ui/button";
import { CustomSelect } from "~/components/ui/custom-select";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { EditActions } from "~/components/ui/edit-actions";
import { EmptyState } from "~/components/ui/empty-state";
import { FormErrorAlert } from "~/components/ui/form-error-alert";
import type {
  ActiveFilter,
  FilterConfig,
} from "~/components/ui/page-header/types";
import {
  ResponsiveActionList,
  ResponsiveActionRow,
} from "~/components/ui/responsive-action-list";
import { SectionCard } from "~/components/ui/section-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { TenantPage } from "~/components/ui/tenant-page";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { schoolsConcept } from "~/lib/concepts/schools";
import { formatDate } from "~/lib/date-helpers";
import { formatCount } from "~/lib/format-utils";
import { TraegerListExportMenu } from "~/components/traeger/traeger-list-export-menu";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { createLogger } from "~/lib/logger";
import { traegerReportKeys } from "~/lib/swr/traeger-report-keys";
import { foldForSearch } from "~/lib/search-fold";
import { staffName } from "~/lib/traeger-staff-api";
import {
  downloadStaffProofList,
  fetchSchoolProofKinds,
  fetchStaffProofList,
  mapSchoolProofKind,
  STAFF_PROOF_STATUS,
  type SchoolProofKinds,
  type StaffProofEntry,
  type StaffProofList,
  type StaffProofStatus,
  type StaffProofType,
} from "~/lib/traeger-staff-proofs-api";
import { traegerPath } from "~/lib/traeger-url";

const logger = createLogger({ component: "TraegerStaffProofsPage" });

type Tab = "ablaufliste" | "arten" | "schulen";

/** „Offen“ zeigt, was zu tun ist: abgelaufen, fehlt, läuft bald ab. */
type StatusFilter = "open" | "all" | StaffProofStatus;

const STATUS_ORDER: readonly StaffProofStatus[] = [
  "expired",
  "missing",
  "expiring_soon",
  "valid",
];

const NO_MAPPING = "";

const INFO =
  "Hier siehst du, welcher Nachweis fehlt, abgelaufen ist oder bald abläuft. Den Nachweis trägst du in der Personalakte ein. Vor dem Ablauf warnt moto die Leitung jedes Einsatzorts und die Person. Wie früh, legst du je Nachweisart fest. Vom Führungszeugnis speichert moto keine Kopie. Jedes Anzeigen dieser Liste steht im Zugriffsprotokoll der Schulen.";

const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

function validityText(kind: StaffProofType): string {
  if (kind.validityMonths === null) return "Läuft nicht ab";
  if (kind.validityMonths % 12 === 0) {
    const years = kind.validityMonths / 12;
    return years === 1 ? "1 Jahr" : `${years} Jahre`;
  }
  return kind.validityMonths === 1
    ? "1 Monat"
    : `${kind.validityMonths} Monate`;
}

function leadText(weeks: number): string {
  if (weeks === 0) return "Nur am Ablauftag";
  return weeks === 1 ? "1 Woche vorher" : `${weeks} Wochen vorher`;
}

function entryKey(entry: StaffProofEntry): string {
  return `${entry.recordId}-${entry.typeId}`;
}

const NO_LIST: StaffProofList = {
  today: "",
  types: [],
  entries: [],
  counts: { expired: 0, missing: 0, expiringSoon: 0, valid: 0 },
};

/** Search, filters, export and table of the Ablaufliste in the page head. */
function useProofListView(loaded: StaffProofList | null) {
  const list = loaded ?? NO_LIST;
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("open");
  const [kind, setKind] = useState("all");

  const kindOptions = useMemo(
    () => [
      { value: "all", label: "Alle Arten" },
      ...list.types
        .filter((type) => !type.archived)
        .map((type) => ({ value: type.id, label: type.name })),
    ],
    [list.types],
  );
  const rows = useMemo(() => {
    const needle = foldForSearch(search.trim());
    return list.entries.filter(
      (entry) =>
        (status === "all" ||
          (status === "open"
            ? entry.status !== "valid"
            : entry.status === status)) &&
        (kind === "all" || entry.typeId === kind) &&
        (needle === "" ||
          foldForSearch(staffName(entry)).includes(needle) ||
          foldForSearch(entry.typeName).includes(needle) ||
          entry.schools.some((school) =>
            foldForSearch(school).includes(needle),
          )),
    );
  }, [list.entries, search, status, kind]);

  const columns: DataTableColumn<StaffProofEntry>[] = [
    {
      key: "person",
      header: "Person",
      stacked: "title",
      sortValue: (entry) =>
        `${entry.lastName} ${entry.firstName}`.toLowerCase(),
      render: (entry) => (
        <span className="block min-w-0">
          <ButtonLink
            href={traegerPath(`/traeger/personal/${entry.recordId}`)}
            tooltip="Öffnet die Personalakte. Dort trägst du den Nachweis ein."
            variant="link"
          >
            {staffName(entry)}
          </ButtonLink>
          {entry.personnelNumber ? (
            <span className="block font-mono text-xs text-gray-500 tabular-nums">
              Nr. {entry.personnelNumber}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "kind",
      header: "Nachweis",
      stacked: "field",
      sortValue: (entry) => entry.typeName,
      render: (entry) => (
        <span className="text-sm text-gray-900">{entry.typeName}</span>
      ),
    },
    {
      key: "schools",
      header: "Einsatzorte",
      stacked: "field",
      sortValue: (entry) => entry.schools.join(", "),
      render: (entry) =>
        entry.schools.length > 0 ? (
          <span className="text-sm text-gray-700">
            {entry.schools.join(", ")}
          </span>
        ) : (
          <span className="text-sm text-gray-500">–</span>
        ),
    },
    {
      key: "expiresOn",
      header: "Gültig bis",
      stacked: "field",
      sortValue: (entry) => entry.expiresOn || "9999",
      render: (entry) => (
        <span className="text-sm text-gray-700 tabular-nums">
          {entry.expiresOn
            ? formatDate(entry.expiresOn)
            : entry.status === "missing"
              ? "–"
              : "Unbegrenzt"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Stand",
      stacked: "meta",
      sortValue: (entry) => STATUS_ORDER.indexOf(entry.status),
      render: (entry) => (
        <StatusBadge
          label={STAFF_PROOF_STATUS[entry.status].label}
          tone={STAFF_PROOF_STATUS[entry.status].tone}
        />
      ),
    },
  ];

  const filters: FilterConfig[] = [
    {
      id: "status",
      label: "Stand",
      type: "buttons",
      value: status,
      onChange: (value) => setStatus(value as StatusFilter),
      options: [
        { value: "open", label: "Offen" },
        ...STATUS_ORDER.map((value) => ({
          value,
          label: STAFF_PROOF_STATUS[value].label,
        })),
        { value: "all", label: "Alle" },
      ],
    },
    {
      id: "kind",
      label: "Art",
      type: "dropdown",
      value: kind,
      onChange: (value) => setKind(String(value)),
      options: kindOptions,
    },
  ];
  const activeFilters: ActiveFilter[] = [
    ...(status === "open"
      ? []
      : [
          {
            id: "status",
            label: status === "all" ? "Alle" : STAFF_PROOF_STATUS[status].label,
            onRemove: () => setStatus("open"),
          },
        ]),
    ...(kind === "all"
      ? []
      : [
          {
            id: "kind",
            label:
              kindOptions.find((option) => option.value === kind)?.label ??
              "Art",
            onRemove: () => setKind("all"),
          },
        ]),
  ];

  return {
    search: {
      value: search,
      onChange: setSearch,
      placeholder: "Name, Nachweis oder Schule suchen…",
    },
    filters,
    activeFilters,
    onClearAllFilters: () => {
      setStatus("open");
      setKind("all");
    },
    actions: (
      <TraegerListExportMenu
        download={downloadStaffProofList}
        scope="Alle Nachweise"
        ariaLabel="Ablaufliste herunterladen"
        tooltip="Zeigt die Formate für alle Nachweise. Jeder Download steht im Zugriffsprotokoll der Schulen."
        fallbackName={`nachweise-${list.today || "heute"}`}
        errorObject="die Ablaufliste"
        unavailable={list.entries.length === 0}
      />
    ),
    body: (
      <SectionCard>
        <DataTable
          rows={rows}
          columns={columns}
          getRowKey={entryKey}
          stackedOnMobile
          emptyState={
            list.entries.length === 0 ? (
              <EmptyState
                icon={
                  <CertificateIcon className="h-12 w-12" aria-hidden="true" />
                }
                title="Noch keine Personalakte mit Nachweisen."
                description="Sobald dein Träger Personalakten führt, steht hier für jede Person der Stand ihrer Nachweise."
              />
            ) : status === "open" && kind === "all" && search.trim() === "" ? (
              <EmptyState
                tone="success"
                icon={
                  <CertificateIcon className="h-6 w-6" aria-hidden="true" />
                }
                title="Alle Nachweise sind gültig."
                description="Kein Nachweis fehlt, keiner ist abgelaufen und keiner läuft bald ab."
              />
            ) : (
              <EmptyState
                title="Kein Nachweis gefunden."
                description="Ändere die Suche oder die Filter."
              />
            )
          }
        />
      </SectionCard>
    ),
  };
}

function ProofTypes({
  types,
  onEdit,
}: Readonly<{
  types: readonly StaffProofType[];
  onEdit: (target: StaffProofTypeTarget) => void;
}>) {
  const columns: DataTableColumn<StaffProofType>[] = [
    {
      key: "name",
      header: "Nachweisart",
      stacked: "title",
      sortValue: (kind) => kind.name,
      render: (kind) => (
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="font-medium text-gray-900">{kind.name}</span>
          {kind.archived ? (
            <StatusBadge label="Archiviert" tone="gray" />
          ) : null}
        </span>
      ),
    },
    {
      key: "validity",
      header: "Gilt",
      stacked: "field",
      sortValue: (kind) => kind.validityMonths ?? 9999,
      render: (kind) => (
        <span className="text-sm text-gray-700">{validityText(kind)}</span>
      ),
    },
    {
      key: "lead",
      header: "Warnung",
      stacked: "field",
      sortValue: (kind) => kind.reminderLeadWeeks,
      render: (kind) => (
        <span className="text-sm text-gray-700">
          {leadText(kind.reminderLeadWeeks)}
        </span>
      ),
    },
    {
      key: "mandatory",
      header: "Pflicht",
      stacked: "meta",
      sortValue: (kind) => (kind.mandatory ? 0 : 1),
      render: (kind) =>
        kind.mandatory ? (
          <StatusBadge label="Pflicht" tone="outline" />
        ) : (
          <span className="text-sm text-gray-500">Freiwillig</span>
        ),
    },
  ];
  return (
    <SectionCard
      title="Nachweisarten"
      description="Welche Nachweise dein Träger verlangt, wie lange sie gelten und wie früh moto vor dem Ablauf warnt. Öffne eine Art, um sie zu ändern oder zu archivieren."
      action={
        <Button
          type="button"
          size="md"
          variant="primary"
          className="gap-2"
          tooltip="Öffnet das Formular für eine neue Nachweisart."
          onClick={() => onEdit("new")}
        >
          <PlusIcon className="size-4" aria-hidden="true" />
          Nachweisart anlegen
        </Button>
      }
    >
      <DataTable
        rows={[...types]}
        columns={columns}
        getRowKey={(kind) => kind.id}
        stackedOnMobile
        onRowClick={(kind) => onEdit(kind)}
        emptyState={<EmptyState title="Noch keine Nachweisart." />}
      />
    </SectionCard>
  );
}

function SchoolKinds({
  school,
  types,
  onSaved,
}: Readonly<{
  school: SchoolProofKinds;
  types: readonly StaffProofType[];
  onSaved: (schools: SchoolProofKinds[]) => void;
}>) {
  const initial = useMemo(
    () =>
      Object.fromEntries(
        school.kinds.map((kind) => [
          kind.schoolTypeId,
          kind.proofTypeId ?? NO_MAPPING,
        ]),
      ),
    [school.kinds],
  );
  const [draft, setDraft] = useState<Record<string, string>>(initial);
  const [saving, setSaving] = useState(false);
  const errors = useApiFormError();
  const { success } = useToast();
  useEffect(() => setDraft(initial), [initial]);

  const options = useMemo(
    () => [
      { value: NO_MAPPING, label: "Keine Zuordnung, die Schule erinnert" },
      ...types
        .filter((type) => !type.archived)
        .map((type) => ({ value: type.id, label: type.name })),
    ],
    [types],
  );
  const changed = school.kinds.filter(
    (kind) =>
      (draft[kind.schoolTypeId] ?? NO_MAPPING) !== initial[kind.schoolTypeId],
  );

  const save = async () => {
    setSaving(true);
    try {
      let latest: SchoolProofKinds[] | null = null;
      for (const kind of changed) {
        const proofType = draft[kind.schoolTypeId] ?? NO_MAPPING;
        latest = await mapSchoolProofKind(
          school.schoolId,
          kind.schoolTypeId,
          proofType === NO_MAPPING ? null : proofType,
        );
      }
      if (latest) onSaved(latest);
      success(`Die Zuordnung für ${school.schoolName} ist gespeichert.`);
    } catch (err) {
      logger.error("traeger_school_proof_kind_map_failed", {
        error: errorMessage(err),
      });
      void errors.show(err, { object: "die Zuordnung" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard
      concept={schoolsConcept}
      title={school.schoolName}
      description={
        school.kinds.length > 0
          ? "Ordne jede Nachweisart der Schule einer Art deines Trägers zu. Für Personen mit Akte erinnert dann nur noch der Nachweis des Trägers."
          : undefined
      }
      footer={
        changed.length > 0 ? (
          <EditActions
            onCancel={() => setDraft(initial)}
            onSave={() => void save()}
            saving={saving}
            saveLabel="Zuordnung speichern"
            saveTooltip="Speichert die Zuordnung. Die Schule erinnert danach nicht mehr doppelt."
          />
        ) : undefined
      }
    >
      <FormErrorAlert message={errors.error} className="mb-4" />
      {school.kinds.length > 0 ? (
        <ResponsiveActionList>
          {school.kinds.map((kind) => (
            <ResponsiveActionRow key={kind.schoolTypeId}>
              <div className="min-w-0">
                <p className="text-sm font-semibold wrap-anywhere text-gray-900">
                  {kind.name}
                </p>
              </div>
              <div className="sm:w-72">
                <CustomSelect
                  ariaLabel={`Art des Trägers für ${kind.name}`}
                  value={draft[kind.schoolTypeId] ?? NO_MAPPING}
                  options={options}
                  onChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      [kind.schoolTypeId]: value,
                    }))
                  }
                  controlSize="dense"
                />
              </div>
            </ResponsiveActionRow>
          ))}
        </ResponsiveActionList>
      ) : (
        <EmptyState
          variant="compact"
          title="Die Schule hat noch keine Nachweisarten."
          description="Sobald die Schule Nachweisarten anlegt, ordnest du sie hier zu."
        />
      )}
    </SectionCard>
  );
}

export default function TraegerStaffProofsPage() {
  const [tab, setTab] = useState<Tab>("ablaufliste");
  const [editing, setEditing] = useState<StaffProofTypeTarget>(null);
  const {
    data: list,
    loading: listLoading,
    error: listError,
    reload: reloadList,
  } = useTraegerResource(
    traegerReportKeys.staffProofList(),
    fetchStaffProofList,
    "die Personalnachweise",
  );
  const {
    data: schools,
    loading: schoolsLoading,
    error: schoolsError,
    mutate: mutateSchools,
    reload: reloadSchools,
  } = useTraegerResource(
    traegerReportKeys.schoolProofKinds(),
    fetchSchoolProofKinds,
    "die Personalnachweise",
  );
  const loadError = listError ?? schoolsError;

  const listView = useProofListView(list);
  const loading = (listLoading || schoolsLoading) && !loadError;
  const open = list
    ? list.counts.expired + list.counts.missing + list.counts.expiringSoon
    : 0;

  return (
    <TenantPage
      title="Personalnachweise"
      info={INFO}
      stats={
        list
          ? [
              `${formatCount(list.counts.expired)} abgelaufen`,
              `${formatCount(list.counts.missing)} fehlen`,
              `${formatCount(list.counts.expiringSoon)} laufen bald ab`,
            ].join(" · ")
          : undefined
      }
      statsLoading={loading}
      loading={loading}
      error={loadError}
      tabs={{
        value: tab,
        onChange: (value) => setTab(value as Tab),
        label: "Bereiche der Personalnachweise",
        items: [
          { value: "ablaufliste", label: "Ablaufliste", badge: open },
          { value: "arten", label: "Nachweisarten" },
          { value: "schulen", label: "Arten der Schulen" },
        ],
      }}
      search={tab === "ablaufliste" && list ? listView.search : undefined}
      filters={tab === "ablaufliste" && list ? listView.filters : undefined}
      activeFilters={
        tab === "ablaufliste" && list ? listView.activeFilters : undefined
      }
      onClearAllFilters={
        tab === "ablaufliste" && list ? listView.onClearAllFilters : undefined
      }
      actions={tab === "ablaufliste" && list ? listView.actions : undefined}
      overlays={
        <StaffProofTypeModal
          target={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reloadList();
            reloadSchools();
          }}
        />
      }
    >
      {list && tab === "ablaufliste" ? listView.body : null}
      {list && tab === "arten" ? (
        <ProofTypes types={list.types} onEdit={setEditing} />
      ) : null}
      {list && schools && tab === "schulen" ? (
        schools.length > 0 ? (
          // Equal school cards in a grid: grids do not grow (TenantPage body
          // rule), so the last school keeps its height like its siblings.
          <div className="compact:gap-4 grid gap-6 max-sm:gap-3">
            {schools.map((school) => (
              <SchoolKinds
                key={school.schoolId}
                school={school}
                types={list.types}
                onSaved={(next) =>
                  void mutateSchools(next, { revalidate: false })
                }
              />
            ))}
          </div>
        ) : (
          <SectionCard>
            <EmptyState title="Dein Träger hat noch keine Schule." />
          </SectionCard>
        )
      ) : null}
    </TenantPage>
  );
}
