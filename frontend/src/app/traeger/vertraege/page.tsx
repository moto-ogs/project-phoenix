"use client";

// Betreuungsverträge des Trägers (#4678, ADR 0153): alle Verträge mit Status,
// gefiltert nach Status, Schule und Name. „Verträge erstellen“ legt Entwürfe
// aus angenommenen Anmeldungen an; ausgewählte Entwürfe gehen per Mail und in
// die Eltern-App. Schulen mit „Bei der Annahme“ (#4680) brauchen das
// nicht: ihr Vertrag entsteht von selbst und ist sofort aktiv. Nur die Rolle
// mit dem Recht „Verträge verwalten“ sieht die Seite.

import { FilePenLine, Plus, Repeat, Send, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { type MouseEvent, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { CareContractCreateModal } from "~/components/traeger/care-contract-create-modal";
import {
  CONCLUSION_MODE_LABELS,
  CONCLUSION_MODE_TONES,
  CONTRACT_STATUS_LABELS,
  CONTRACT_STATUS_ORDER,
  contractStatusTone,
  SEND_SKIP_LABELS,
  childName,
  knownConclusionAt,
} from "~/components/traeger/care-contract-format";
import { careContractTabs } from "~/components/traeger/care-contract-tabs";
import { emptySearchText } from "~/components/traeger/empty-search";
import { useSWRRequestGuard } from "~/lib/swr/hooks";
import {
  isRefusal,
  useRefusalGuard,
} from "~/components/traeger/use-traeger-confirmed-resource";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { useTraegerSchools } from "~/components/traeger/use-traeger-schools";
import {
  traegerExportScope,
  useTraegerListExportItems,
} from "~/components/traeger/traeger-list-export-menu";
import { Button, ButtonLink } from "~/components/ui/button";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { EmptyState } from "~/components/ui/empty-state";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import NavigationLink from "~/components/ui/navigation-link";
import type {
  ActiveFilter,
  FilterConfig,
} from "~/components/ui/page-header/types";
import { SectionCard } from "~/components/ui/section-card";
import { hasPermission } from "~/lib/auth-utils";
import { StatusBadge } from "~/components/ui/status-badge";
import { SelectionBar } from "~/components/ui/selection-bar";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { ListSkeleton } from "~/components/ui/page-skeletons";
import {
  useApiErrorDisplay,
  useApiLoadError,
  useToast,
} from "~/contexts/ToastContext";
import { careContractsConcept } from "~/lib/concepts/careContracts";
import { formatBerlinDate, formatDate } from "~/lib/date-helpers";
import { useRefreshAfterWrite } from "~/lib/hooks/use-refresh-after-write";
import { createLogger } from "~/lib/logger";
import { useLatest } from "~/lib/hooks/use-latest";
import { useInvalidateFamily, useInvalidateMatching } from "~/lib/swr";
import { traegerContractKeys } from "~/lib/swr/traeger-contract-keys";
import {
  type CareContractList,
  type CareContractStatus,
  type CareContractSummary,
  type ContractCandidate,
  type CreateResult,
  type SchoolConclusionMode,
  fetchCareContracts,
  fetchConclusionModes,
  fetchContractCandidates,
  sendCareContracts,
} from "~/lib/traeger-care-contracts-api";
import type { TraegerSchool } from "~/lib/traeger-api";
import { downloadTraegerList } from "~/lib/traeger-list-export";
import { useDebounce } from "~/lib/use-debounce";
import { traegerPath } from "~/lib/traeger-url";
import { labelOf } from "~/lib/label-of";

const logger = createLogger({ component: "TraegerVertraegePage" });

type StatusChoice = CareContractStatus | "all";

/** Older contracts loaded below the first page, for the page they follow. */
interface MorePages {
  readonly after: CareContractList;
  readonly list: CareContractList;
}

/**
 * At a school that concludes at acceptance a child gets no draft here: the
 * reason why it still has no contract stands in its place.
 */
function withConclusionIssue(
  candidates: readonly ContractCandidate[],
  modes: readonly SchoolConclusionMode[],
): ContractCandidate[] {
  return candidates.map((candidate) =>
    modes.some(
      (school) =>
        school.schoolId === candidate.schoolId && school.mode === "bei_annahme",
    )
      ? {
          ...candidate,
          templateIssue:
            candidate.templateIssue ??
            (!candidate.guardianEmail.trim()
              ? ("recipient_missing" as const)
              : null) ??
            (candidate.acceptanceIssue === "acceptance_missing" &&
            candidate.renewal
              ? ("acceptance_missing_renewal" as const)
              : candidate.acceptanceIssue) ??
            (candidate.mailBlock === "stopped"
              ? ("mail_stopped" as const)
              : null) ??
            (candidate.mailBlock === "address"
              ? ("mail_blocked" as const)
              : null) ??
            ("conclusion_automatic" as const),
        }
      : candidate,
  );
}

interface PageData {
  readonly list: CareContractList;
  readonly candidates: readonly ContractCandidate[];
  readonly schools: readonly TraegerSchool[];
  readonly modes: readonly SchoolConclusionMode[];
}

function conclusionDescription(modes: readonly SchoolConclusionMode[]): string {
  const onAcceptance = modes.filter((school) => school.mode === "bei_annahme");
  if (onAcceptance.length === 0) {
    return "Du erstellst jeden Vertrag hier und schickst ihn den Eltern.";
  }
  if (onAcceptance.length === modes.length) {
    return "Nimmt die Schule eine Anmeldung an, gilt der Vertrag. Die Eltern bekommen ihn per E-Mail und in der Eltern-App. Voraussetzung: Die Eltern haben im Anmeldeformular den Vertragsbedingungen zugestimmt, und du hast die Bedingungen seitdem nicht geändert.";
  }
  return "Steht eine Schule auf „Bei der Annahme“, entsteht der Vertrag von selbst, sobald die Schule die Anmeldung annimmt. Voraussetzung: Die Eltern haben im Anmeldeformular den Vertragsbedingungen zugestimmt. Die anderen Verträge erstellst und verschickst du hier.";
}

function contractHref(contract: CareContractSummary): string {
  return traegerPath(`/traeger/vertraege/${contract.id}`);
}

const COLUMNS: DataTableColumn<CareContractSummary>[] = [
  {
    key: "child",
    header: "Kind",
    render: (contract) => (
      <span className="block min-w-0">
        <NavigationLink
          href={contractHref(contract)}
          className="font-medium text-gray-900 hover:underline"
          onClick={(event: MouseEvent<HTMLAnchorElement>) =>
            event.stopPropagation()
          }
        >
          {childName(contract)}
        </NavigationLink>
        <span className="block text-sm text-gray-500">
          {contract.modulesText || "–"}
          <span className="sm:hidden">
            {" "}
            · ab {formatDate(contract.effectiveFrom)}
          </span>
        </span>
      </span>
    ),
    sortValue: (contract) =>
      `${contract.childLastName} ${contract.childFirstName}`,
    stacked: "title",
  },
  {
    key: "school",
    header: "Betreuungsort",
    render: (contract) => contract.schoolName,
    sortValue: (contract) => contract.schoolName,
    stackedLabel: false,
    // A phone row stays two lines (child, offer and start); only an open
    // end, a task, adds its orange note.
    stackedRender: (contract) =>
      contract.status === "gekuendigt" && !contract.endsOn ? (
        <span className="text-moto-orange-strong font-medium">
          Ende festlegen
        </span>
      ) : null,
  },
  {
    key: "party",
    header: "Eltern",
    render: (contract) => (
      <span className="block min-w-0">
        <span className="block text-gray-900">{contract.partyName || "–"}</span>
        <span className="block text-sm wrap-anywhere text-gray-500">
          {contract.partyEmail || "Keine E-Mail-Adresse"}
        </span>
      </span>
    ),
    stacked: "hidden",
  },
  {
    key: "start",
    header: "Beginn",
    render: (contract) => formatDate(contract.effectiveFrom),
    sortValue: (contract) => contract.effectiveFrom,
    stacked: "hidden",
  },
  {
    key: "status",
    header: "Status",
    render: (contract) => (
      <span className="inline-flex flex-col items-start gap-1">
        <StatusBadge
          label={labelOf(CONTRACT_STATUS_LABELS, contract.status, "–")}
          tone={contractStatusTone(contract)}
        />
        {contract.status === "gekuendigt" && contract.endsOn ? (
          <span className="text-sm text-gray-500">
            zum {formatDate(contract.endsOn)}
          </span>
        ) : contract.status === "gekuendigt" ? (
          // An extraordinary notice waits for the office: the end is a task,
          // not a quiet date.
          <span className="text-moto-orange-strong text-sm font-medium">
            Ende festlegen
          </span>
        ) : contract.status === "widerrufen" ? null : contract.concluded ? (
          // An unknown day of a taken-over contract (#7767) is no date.
          knownConclusionAt(contract.concluded) ? (
            <span className="text-sm text-gray-500">
              seit {formatBerlinDate(contract.concluded.at)}
            </span>
          ) : null
        ) : contract.sentAt ? (
          <span className="text-sm text-gray-500">
            am {formatBerlinDate(contract.sentAt)}
          </span>
        ) : null}
      </span>
    ),
    sortValue: (contract) =>
      contract.status ? CONTRACT_STATUS_ORDER.indexOf(contract.status) : -1,
    stacked: "meta",
    // On a phone the status alone, without the date under it.
    stackedRender: (contract) => (
      <StatusBadge
        label={labelOf(CONTRACT_STATUS_LABELS, contract.status, "–")}
        tone={contractStatusTone(contract)}
      />
    ),
  },
];

export default function TraegerVertraegePage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [status, setStatus] = useState<StatusChoice>("all");
  const [schoolId, setSchoolId] = useState("");
  const [search, setSearch] = useState("");
  // Null until the person opens or closes the card: then the device decides.
  const [rulesOpen, setRulesOpen] = useState<boolean | null>(null);
  const debouncedSearch = useDebounce(search.trim(), 250);
  const filter = {
    status: status === "all" ? undefined : status,
    schoolId,
    search: debouncedSearch,
  };
  const listKey = traegerContractKeys.list(filter);
  const listGuard = useRefusalGuard(listKey);
  const beginPageRead = useSWRRequestGuard();
  const firstPage = useTraegerResource(
    listKey,
    () => fetchCareContracts({ ...filter, offset: 0 }),
    "die Liste der Verträge",
  );
  const candidateRead = useTraegerResource(
    traegerContractKeys.candidates(),
    fetchContractCandidates,
    "die Liste der Verträge",
  );
  const modeRead = useTraegerResource(
    traegerContractKeys.conclusionModes(),
    fetchConclusionModes,
    "die Liste der Verträge",
  );
  const schoolList = useTraegerSchools();
  const invalidateFamily = useInvalidateFamily();
  const invalidateMatching = useInvalidateMatching();
  const [more, setMore] = useState<MorePages | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const moreLoad = useApiLoadError();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);
  const actionError = useApiErrorDisplay();
  const { success, warning } = useToast();

  // Another filter is another list: its rows start unselected.
  const [selectionFor, setSelectionFor] = useState(listKey);
  if (selectionFor !== listKey) {
    setSelectionFor(listKey);
    setSelected(new Set());
  }
  // A refusal takes the list away, and the choices made on it.
  if (firstPage.refused && (selected.size > 0 || creating)) {
    setSelected(new Set());
    setCreating(false);
  }

  const data = useMemo<PageData | null>(() => {
    if (!firstPage.data || !candidateRead.data || !modeRead.data) return null;
    if (!schoolList.schools) return null;
    // Older pages count only below the first page they were read after.
    const list =
      more?.after === firstPage.data
        ? {
            ...more.list,
            contracts: [...firstPage.data.contracts, ...more.list.contracts],
          }
        : firstPage.data;
    return {
      list,
      candidates: withConclusionIssue(candidateRead.data, modeRead.data),
      schools: schoolList.schools,
      modes: modeRead.data,
    };
  }, [
    firstPage.data,
    candidateRead.data,
    modeRead.data,
    schoolList.schools,
    more,
  ]);
  const loadError =
    firstPage.error ??
    candidateRead.error ??
    modeRead.error ??
    schoolList.error;

  const loadMore = async () => {
    const after = firstPage.data;
    if (!after || !data) return;
    const complete = beginPageRead(listKey);
    setLoadingMore(true);
    moreLoad.clear();
    try {
      const page = await fetchCareContracts({
        ...filter,
        offset: data.list.contracts.length,
      });
      setMore((previous) => ({
        after,
        list:
          previous?.after === after
            ? {
                ...page,
                contracts: [...previous.list.contracts, ...page.contracts],
              }
            : page,
      }));
    } catch (err) {
      // Pagination has the same access boundary as the first page. Record
      // its refusal before any later request can replace it with a 5xx.
      if (isRefusal(err))
        complete(() => {
          listGuard.callbacks.onError(err);
          void firstPage.mutate(undefined, { revalidate: false });
          setMore(null);
        });
      else
        await moreLoad.show(err, {
          object: "die Liste der Verträge",
          retry: () => void loadMore(),
        });
    } finally {
      setLoadingMore(false);
    }
  };

  // Reload after a send: a failure there is a load error above the
  // confirmed rows, not a failed send (#6652). The reload replaces the
  // older pages loaded below the first.
  const afterWrite = useRefreshAfterWrite(
    "die Anzeige der Verträge",
    // A mutation drops an answer to a request that started before it.
    () =>
      firstPage.mutate(fetchCareContracts({ ...filter, offset: 0 }), {
        revalidate: false,
      }),
  );

  // The lists of the other filters count the written contracts too; the
  // list shown when the write ends reloads through afterWrite.
  const shownList = useLatest(listKey);
  const invalidateOtherLists = () =>
    void invalidateMatching(
      (key) =>
        key.startsWith(traegerContractKeys.listFamily) &&
        key !== shownList.current,
    );

  const contracts = useMemo(() => [...(data?.list.contracts ?? [])], [data]);
  const schools = (data?.schools ?? []).map((school) => ({
    value: school.id,
    label: school.name,
  }));
  const total = Object.values(data?.list.counts ?? {}).reduce(
    (sum, count) => sum + count,
    0,
  );
  const drafts = data?.list.counts.entwurf ?? 0;
  const sentCount = data?.list.counts.versendet ?? 0;
  const activeCount = data?.list.counts.aktiv ?? 0;
  const candidates = data?.candidates ?? [];
  const selectedDrafts = contracts.filter(
    (contract) => selected.has(contract.id) && contract.status === "entwurf",
  );

  const sendSelected = async () => {
    if (selectedDrafts.length === 0) return;
    setSending(true);
    let result: Awaited<ReturnType<typeof sendCareContracts>>;
    try {
      result = await sendCareContracts(selectedDrafts.map((c) => c.id));
    } catch (err) {
      logger.error("traeger_care_contracts_send_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void actionError.show(err, { object: "das Senden der Entwürfe" });
      setSelected(new Set());
      invalidateOtherLists();
      await firstPage.mutate();
      setSending(false);
      return;
    }
    if (result.sent.length > 0) {
      success(
        result.sent.length === 1
          ? "1 Vertrag ist unterwegs: per Mail und in die Eltern-App."
          : `${result.sent.length} Verträge sind unterwegs: per Mail und in die Eltern-App.`,
      );
    }
    for (const skip of result.skipped) {
      const contract = contracts.find((c) => c.id === skip.id);
      warning(
        `${contract ? childName(contract) : "Ein Vertrag"}: nicht gesendet, ${SEND_SKIP_LABELS[skip.reason]}.`,
      );
    }
    setSelected(new Set());
    invalidateOtherLists();
    await afterWrite.refresh();
    setSending(false);
  };

  const onCreated = async (result: CreateResult) => {
    setCreating(false);
    if (result.created.length > 0) {
      success(
        result.created.length === 1
          ? "1 Entwurf ist erstellt. Prüfe ihn und sende ihn dann."
          : `${result.created.length} Entwürfe sind erstellt. Prüfe sie und sende sie dann.`,
      );
    }
    if (result.skipped.length > 0) {
      warning(
        result.skipped.length === 1
          ? "1 Kind hatte inzwischen einen Vertrag oder keine Bedingungen."
          : `${result.skipped.length} Kinder hatten inzwischen einen Vertrag oder keine Bedingungen.`,
      );
    }
    candidateRead.reload();
    modeRead.reload();
    // Die Entwürfe sind angelegt; ein Fehler beim Nachladen lässt die
    // bestätigte Liste stehen (#6652). Ein anderer Filter lädt neu.
    if (status === "entwurf") {
      invalidateOtherLists();
      await afterWrite.refresh();
    } else {
      void invalidateFamily(traegerContractKeys.listFamily);
      setStatus("entwurf");
    }
  };

  const filters: FilterConfig[] = [
    {
      id: "status",
      label: "Status",
      type: "dropdown",
      value: status,
      onChange: (value) => setStatus(value as StatusChoice),
      options: [
        { value: "all", label: "Alle Status" },
        ...CONTRACT_STATUS_ORDER.filter(
          (key) => (data?.list.counts[key] ?? 0) > 0 || key === status,
        ).map((key) => ({
          value: key,
          label: `${CONTRACT_STATUS_LABELS[key]} (${data?.list.counts[key] ?? 0})`,
        })),
      ],
    },
    ...(schools.length > 1
      ? [
          {
            id: "school",
            label: "Betreuungsort",
            type: "dropdown" as const,
            value: schoolId,
            onChange: (value: string | string[]) =>
              setSchoolId(value as string),
            options: [{ value: "", label: "Alle Schulen" }, ...schools],
          },
        ]
      : []),
  ];
  const activeFilters: ActiveFilter[] = [
    ...(status === "all"
      ? []
      : [
          {
            id: "status",
            label: CONTRACT_STATUS_LABELS[status],
            onRemove: () => setStatus("all"),
          },
        ]),
    ...(schoolId
      ? [
          {
            id: "school",
            label:
              schools.find((school) => school.value === schoolId)?.label ??
              "Ausgewählte Schule",
            onRemove: () => setSchoolId(""),
          },
        ]
      : []),
  ];

  // #7409: „Verträge erstellen“ is the one visible head action; the import
  // and the export („Herunterladen“) sit in the page menu.
  const exportItems = useTraegerListExportItems({
    download: (format) =>
      downloadTraegerList("/api/traeger/contracts/export", format, {
        status: status === "all" ? undefined : status,
        school_id: schoolId,
        search: debouncedSearch,
      }),
    scope: traegerExportScope(
      schools.find((school) => school.value === schoolId)?.label,
    ),
    fallbackName: "betreuungsvertraege",
    errorObject: "die Verträge",
    unavailable: !data,
  });

  // The count names the children waiting for a contract; the dialog lists
  // each of them, with the reason where a draft cannot be made yet.
  const createLabel =
    candidates.length > 0
      ? `Verträge erstellen (${candidates.length})`
      : "Verträge erstellen";

  return (
    <TenantPage
      title="Verträge"
      info="Hier siehst du die Betreuungsverträge aus den angenommenen Anmeldungen deiner Schulen und die Verträge, die du aus einem anderen Programm importiert hast. moto übernimmt Kind, Eltern, Beginn und die gebuchten Module je Wochentag. Gilt der Vertrag bei der Annahme, entsteht er von selbst, wenn die Eltern im Anmeldeformular den Vertragsbedingungen zugestimmt haben. Sonst prüfst du den Entwurf und sendest ihn per Mail und in die Eltern-App."
      tabs={careContractTabs("vertraege")}
      stats={
        total > 0 || candidates.length > 0 ? (
          <TenantPageStats
            items={statusFigures(
              total,
              drafts,
              sentCount,
              activeCount,
              candidates.length,
            )}
          />
        ) : null
      }
      statsLoading={!data && !loadError}
      search={{
        value: search,
        onChange: setSearch,
        placeholder: "Kind, Eltern oder Angebot suchen",
      }}
      filters={filters}
      activeFilters={activeFilters}
      onClearAllFilters={() => {
        setStatus("all");
        setSchoolId("");
      }}
      overflowMenu={[
        ...exportItems,
        { kind: "separator" },
        {
          label: "Verträge importieren",
          description:
            "Öffnet den Import von Kindern und bestehenden Verträgen aus einer CSV-Datei.",
          icon: <Upload className="h-4 w-4" aria-hidden />,
          href: traegerPath("/traeger/vertraege/import"),
          onClick: () => undefined,
        },
        {
          label: "Module neu zuordnen",
          description:
            "Öffnet die neue Zuordnung der Module importierter Verträge aus einer CSV-Datei.",
          icon: <Repeat className="h-4 w-4" aria-hidden />,
          href: traegerPath("/traeger/vertraege/module-zuordnen"),
          onClick: () => undefined,
        },
        {
          label: "Vertragsangaben nachpflegen",
          description:
            "Öffnet die Seite, um Vertragsparteien, Abschlussart und Abschlussdatum importierter Verträge zu ergänzen.",
          icon: <FilePenLine className="h-4 w-4" aria-hidden />,
          href: traegerPath("/traeger/vertraege/nachpflege"),
          onClick: () => undefined,
        },
      ]}
      actions={
        <Button
          type="button"
          variant="primary"
          size="md"
          disabled={!data}
          tooltip="Öffnet die Auswahl angenommener Kinder, Entwürfe gehen noch nicht an Eltern."
          onClick={() => setCreating(true)}
        >
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          {createLabel}
        </Button>
      }
      error={loadError ?? (!data ? afterWrite.error : null)}
      // A list loads in the shape of its rows.
      loading={
        !loadError && !afterWrite.error && !data ? (
          <ListSkeleton rows={6} avatar={false} />
        ) : (
          false
        )
      }
      overlays={
        data ? (
          <CareContractCreateModal
            isOpen={creating}
            candidates={data.candidates}
            onClose={() => setCreating(false)}
            onCreated={(result) => void onCreated(result)}
          />
        ) : null
      }
    >
      <LoadErrorAlert error={afterWrite.error ?? moreLoad.error} />
      {data && data.modes.length > 0 ? (
        <SectionCard
          title="Wann gilt der Vertrag?"
          // Closed, the card shows only its title: the explanation would
          // push the contracts down again. On a phone the rule per school and
          // its warning stay, the explanation is in the page's info (i).
          description={
            (rulesOpen ?? true) ? (
              <span className="max-sm:hidden">
                {conclusionDescription(data.modes)}
              </span>
            ) : undefined
          }
          // Open on every device: the rule per school decides what to do
          // next; it folds away on request.
          collapsible
          collapsed={!(rulesOpen ?? true)}
          onCollapsedChange={(collapsed) => setRulesOpen(!collapsed)}
          action={
            hasPermission(session, "traeger_overview:read") ? (
              // Straight to the tab that holds „Wann gilt der
              // Betreuungsvertrag?“, not the first tab of the settings.
              <ButtonLink
                href={traegerPath("/traeger/einstellungen?bereich=enrollment")}
                variant="outline"
                size="md"
                tooltip="Öffnet die Einstellungen, ab wann Verträge an jeder Schule gelten."
              >
                In den Einstellungen ändern
              </ButtonLink>
            ) : null
          }
        >
          <ul
            aria-label="Abschluss je Schule"
            className="divide-y divide-gray-100"
          >
            {data.modes.map((school) => {
              // Accepted children the acceptance did not conclude: without
              // the parents' consent the green mode alone would read as
              // „every child has a contract“.
              const withoutContract =
                school.mode === "bei_annahme"
                  ? data.candidates.filter(
                      (candidate) =>
                        candidate.schoolId === school.schoolId &&
                        candidate.acceptanceIssue !== null,
                    ).length
                  : 0;
              return (
                <li
                  key={school.schoolId}
                  className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  <span className="min-w-0 text-sm font-medium wrap-anywhere text-gray-900">
                    {school.schoolName}
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    {withoutContract > 0 ? (
                      <StatusBadge
                        label={`${withoutContract === 1 ? "1 Kind" : `${withoutContract} Kinder`} ohne Zustimmung, kein Vertrag`}
                        tone="orange"
                      />
                    ) : null}
                    <StatusBadge
                      label={labelOf(CONCLUSION_MODE_LABELS, school.mode, "–")}
                      tone={labelOf(CONCLUSION_MODE_TONES, school.mode, "gray")}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        </SectionCard>
      ) : null}
      {data ? (
        <DataTable
          columns={COLUMNS}
          rows={contracts}
          getRowKey={(contract) => contract.id}
          stackedOnMobile
          stackedLayout="row"
          stackedDetailKey="school"
          onRowClick={(contract) => router.push(contractHref(contract))}
          // Older contracts load inside the list's surface, like every list.
          moreAction={
            data?.list.hasMore
              ? {
                  // Without a filter the counts name the whole list.
                  label:
                    status === "all" && !schoolId && !search.trim()
                      ? `Weitere Verträge laden (${contracts.length} von ${total})`
                      : "Weitere Verträge laden",
                  onClick: () => void loadMore(),
                  loading: loadingMore,
                  loadingText: "Wird geladen …",
                  disabled: loadingMore || sending,
                  tooltip: "Zeigt weitere Verträge unten in der Liste an.",
                }
              : undefined
          }
          selection={{
            selectedKeys: selected,
            disabled: sending,
            rowLabel: (contract) => `Vertrag von ${childName(contract)}`,
            onChange: (keys, on) =>
              setSelected((current) => {
                const next = new Set(current);
                for (const key of keys) {
                  if (on) next.add(key);
                  else next.delete(key);
                }
                return next;
              }),
          }}
          emptyState={
            <EmptyState
              icon={
                <MotoConceptIcon
                  concept={careContractsConcept}
                  className="h-12 w-12"
                />
              }
              {...emptyText(
                total,
                candidates.length,
                data.modes.length > 0 &&
                  data.modes.every((school) => school.mode === "bei_annahme"),
                emptySearchText(
                  search,
                  activeFilters.map((filter) => filter.label),
                ).description,
              )}
              action={
                total > 0 &&
                (search.trim() !== "" || activeFilters.length > 0) ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="md"
                    tooltip="Leert Suche und Filter und zeigt wieder alle Verträge."
                    onClick={() => {
                      setSearch("");
                      setStatus("all");
                      setSchoolId("");
                    }}
                  >
                    {
                      emptySearchText(
                        search,
                        activeFilters.map((filter) => filter.label),
                      ).actionLabel
                    }
                  </Button>
                ) : undefined
              }
            />
          }
        />
      ) : null}
      {data && selected.size > 0 ? (
        // What the ticked rows are for, and the action, stick at the bottom
        // of the screen while the list scrolls.
        <SelectionBar
          aria-label="Ausgewählte Verträge"
          placement="bottom"
          count={selected.size}
          label={
            selected.size === 1
              ? "1 Vertrag ausgewählt"
              : `${selected.size} Verträge ausgewählt`
          }
          description={
            selectedDrafts.length < selected.size ? (
              // On a phone the bar keeps to the rule, so it covers less of
              // the list; the way to resend follows from the tablet on.
              <>
                Senden gilt nur für Entwürfe.
                <span className="max-sm:hidden">
                  {" "}
                  Einen versendeten Vertrag sendest du auf seiner Seite erneut.
                </span>
              </>
            ) : (
              "Die Eltern bekommen den Vertrag per Mail und in der Eltern-App."
            )
          }
          onClear={() => setSelected(new Set())}
          busy={sending}
          actions={
            selectedDrafts.length > 0 ? (
              <Button
                type="button"
                variant="success"
                size="compact"
                isLoading={sending}
                loadingText="Wird gesendet …"
                tooltip="Schickt die Entwürfe sofort per E-Mail und in die Eltern-App."
                onClick={() => void sendSelected()}
              >
                <Send className="mr-2 h-4 w-4" aria-hidden="true" />
                {selectedDrafts.length === 1
                  ? "1 Entwurf senden"
                  : `${selectedDrafts.length} Entwürfe senden`}
              </Button>
            ) : null
          }
        />
      ) : null}
    </TenantPage>
  );
}

function emptyText(
  contracts: number,
  candidates: number,
  allOnAcceptance: boolean,
  searchText: string,
): { title: string; description?: string } {
  if (contracts > 0) {
    return {
      title: "Kein Vertrag passt zu deiner Suche.",
      description: searchText || undefined,
    };
  }
  if (allOnAcceptance) {
    return {
      title: "Noch kein Vertrag.",
      description:
        "Sobald eine Schule eine Anmeldung annimmt, erscheint hier der Vertrag. Er gilt dann schon.",
    };
  }
  if (candidates > 0) {
    return {
      title: "Noch kein Vertrag.",
      description: `${candidates === 1 ? "1 angenommene Anmeldung wartet" : `${candidates} angenommene Anmeldungen warten`} auf einen Vertrag. Erstelle die Entwürfe oben mit „Verträge erstellen“.`,
    };
  }
  return {
    title: "Noch kein Vertrag.",
    description:
      "Sobald eine Schule eine Anmeldung annimmt, kannst du hier den Vertrag erstellen.",
  };
}

/**
 * The figures of the status line: at most three fit (TenantPageStats). The
 * states that hold contracts come first, active before sent before drafts;
 * without any of them the total, then the children still without one.
 */
function statusFigures(
  total: number,
  drafts: number,
  sent: number,
  active: number,
  candidates: number,
): { value: number; label: string }[] {
  // The contracts by state; children without a contract complete the line
  // when there is room (the create button carries their number).
  const figures = [
    { value: active, label: "aktiv" },
    { value: sent, label: "versendet" },
    { value: drafts, label: drafts === 1 ? "Entwurf" : "Entwürfe" },
  ].filter((figure) => figure.value > 0);
  if (figures.length < 2) {
    figures.unshift({
      value: total,
      label: total === 1 ? "Vertrag" : "Verträge",
    });
  }
  if (candidates > 0)
    figures.push({ value: candidates, label: "ohne Vertrag" });
  return figures.slice(0, 3);
}
