"use client";

import { bffFile } from "~/lib/bff-fetch";

// Betreuungsverträge des Trägers (#4678, ADR 0153): alle Verträge mit Status,
// gefiltert nach Status, Schule und Name. „Verträge erstellen“ legt Entwürfe
// aus angenommenen Anmeldungen an; ausgewählte Entwürfe gehen per Mail und in
// die Eltern-App. Schulen mit „Bei der Annahme“ (#4680) brauchen das
// nicht: ihr Vertrag entsteht von selbst und ist sofort aktiv. Nur die Rolle
// mit dem Recht „Verträge verwalten“ sieht die Seite. Seit #8138 liest sich
// die Liste wie eine Tabelle: das Angebot hat seine eigene Spalte, und eine
// Spalte sortiert alle Verträge des Filters in der Datenbank, nicht nur die
// geladenen Zeilen.

import {
  ClipboardCheck,
  FilePenLine,
  Link2,
  Plus,
  Repeat,
  Send,
  Upload,
  UsersRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type MouseEvent, useMemo, useRef, useState } from "react";
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
import { isRefusal } from "~/components/traeger/use-traeger-confirmed-resource";
import {
  useFreshTraegerResource,
  useTraegerListRequest,
  useTraegerResource,
} from "~/components/traeger/use-traeger-resource";
import { useTraegerSchools } from "~/components/traeger/use-traeger-schools";
import {
  traegerExportScope,
  useTraegerListExportItems,
} from "~/components/traeger/traeger-list-export-menu";
import { Button, ButtonLink } from "~/components/ui/button";
import { CustomSelect } from "~/components/ui/custom-select";
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
import {
  AT_LEAST_MD,
  useResolvedMediaQuery,
} from "~/lib/hooks/use-media-query";
import { useInvalidateFamily, useInvalidateMatching } from "~/lib/swr";
import { isDiscardedAnswer } from "~/lib/swr/hooks";
import { traegerContractKeys } from "~/lib/swr/traeger-contract-keys";
import {
  type CareContractList,
  type CareContractSort,
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
import {
  downloadTraegerList,
  listExportQuery,
} from "~/lib/traeger-list-export";
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

/** The columns the database orders by, under their column key. */
const SORT_OF_COLUMN: Readonly<Record<string, CareContractSort>> = {
  child: "child",
  school: "school",
  start: "start",
  status: "status",
};

/** Without a chosen column the newest contract comes first. */
const NO_SORT = { key: "", direction: "asc" } as const;

const MOBILE_SORT_OPTIONS = [
  { value: ":asc", label: "Neueste zuerst", sort: NO_SORT },
  ...(
    [
      ["child", "Kind: A bis Z", "Kind: Z bis A"],
      ["school", "Betreuungsort: A bis Z", "Betreuungsort: Z bis A"],
      ["start", "Beginn: frühester zuerst", "Beginn: spätester zuerst"],
      ["status", "Status: Entwurf zuerst", "Status: Beendet zuerst"],
    ] as const
  ).flatMap(([key, ascending, descending]) => [
    {
      value: `${key}:asc`,
      label: ascending,
      sort: { key, direction: "asc" as const },
    },
    {
      value: `${key}:desc`,
      label: descending,
      sort: { key, direction: "desc" as const },
    },
  ]),
];

/** The child's name as the link to its contract, with the note of an import. */
function ChildName({ contract }: Readonly<{ contract: CareContractSummary }>) {
  return (
    <>
      <NavigationLink
        href={contractHref(contract)}
        className="font-medium text-gray-900 hover:underline"
        onClick={(event: MouseEvent<HTMLAnchorElement>) =>
          event.stopPropagation()
        }
      >
        {childName(contract)}
      </NavigationLink>
      {contract.imported && !contract.studentId ? (
        // An imported contract knows its child only by name until the
        // office links it to the child record (#7760).
        <StatusBadge
          tone="gray"
          size="xs"
          label="Ohne Kinderakte"
          className="ml-1.5 align-middle"
        />
      ) : null}
    </>
  );
}

const COLUMNS: DataTableColumn<CareContractSummary>[] = [
  {
    key: "child",
    header: "Kind",
    render: (contract) => (
      <span className="block min-w-0">
        <ChildName contract={contract} />
      </span>
    ),
    // A phone row stays two lines: the child, then offer and start.
    stackedRender: (contract) => (
      <span className="block min-w-0">
        <ChildName contract={contract} />
        <span className="block text-sm text-gray-500">
          {contract.modulesText || "–"} · ab{" "}
          {formatDate(contract.effectiveFrom)}
        </span>
      </span>
    ),
    serverSortable: true,
    stacked: "title",
  },
  {
    // The offer in a column of its own (#8138), as in the table the office
    // knows; on a phone it stands under the child.
    key: "offer",
    header: "Angebot",
    render: (contract) => (
      <span className="block max-w-64 wrap-break-word">
        {contract.modulesText || "–"}
      </span>
    ),
    stacked: "hidden",
  },
  {
    key: "school",
    header: "Betreuungsort",
    render: (contract) => contract.schoolName,
    serverSortable: true,
    stackedLabel: false,
    // On a phone only an open end, a task, adds its orange note.
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
    render: (contract) => (
      <span className="whitespace-nowrap tabular-nums">
        {formatDate(contract.effectiveFrom)}
      </span>
    ),
    serverSortable: true,
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
        ) : contract.changeAwaitsSignature ? (
          // A changed version waits for the parents (#4816): a task of the
          // contract, shown where the office scans the list.
          <StatusBadge
            label="Änderung wartet auf Unterschrift"
            tone="warning"
            size="xs"
          />
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
    serverSortable: true,
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

const COLUMNS_SORTED_BY_SCHOOL = COLUMNS.map((column) =>
  column.key === "school"
    ? {
        ...column,
        stackedRender: (contract: CareContractSummary) => (
          <>
            <span className="block break-words text-gray-600">
              {contract.schoolName}
            </span>
            {column.stackedRender?.(contract)}
          </>
        ),
      }
    : column,
);

export default function TraegerVertraegePage() {
  const desktop = useResolvedMediaQuery(AT_LEAST_MD);
  const router = useRouter();
  const { data: session } = useSession();
  const [status, setStatus] = useState<StatusChoice>("all");
  const [schoolId, setSchoolId] = useState("");
  const [search, setSearch] = useState("");
  const [searchReset, setSearchReset] = useState(0);
  // Null until the person opens or closes the card: then the device decides.
  const [rulesOpen, setRulesOpen] = useState<boolean | null>(null);
  // The search field keeps the typed text as its own draft and reports it
  // after a pause: a typed letter redraws the field, not the list.
  const [sort, setSort] = useState<{
    key: string;
    direction: "asc" | "desc";
  }>(NO_SORT);
  const term = search.trim();
  const filter = {
    status: status === "all" ? undefined : status,
    schoolId,
    search: term,
    // Only a chosen column orders the list; without one the request is
    // the plain list, newest first.
    ...(SORT_OF_COLUMN[sort.key]
      ? { sort: SORT_OF_COLUMN[sort.key], order: sort.direction }
      : {}),
  };
  const listKey = traegerContractKeys.list(filter);
  // What the filter holds, whatever its order: an order shows the same
  // contracts again, so it keeps what is ticked.
  const selectionKey = traegerContractKeys.list({
    status: filter.status,
    schoolId,
    search: term,
  });
  const listAccess = useTraegerListRequest(
    traegerContractKeys.listFamily,
    () => shownRows.current,
  );
  const fetchFirstPage = () => fetchCareContracts({ ...filter, offset: 0 });
  const firstPage = useFreshTraegerResource(
    listKey,
    () => listAccess.read(listKey, fetchFirstPage),
    "die Liste der Verträge",
    { refusalKey: traegerContractKeys.listFamily },
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
  const [loadingMoreFor, setLoadingMoreFor] = useState<CareContractList | null>(
    null,
  );
  const loadingMore =
    firstPage.data !== null && loadingMoreFor === firstPage.data;
  const moreLoad = useApiLoadError();
  const [moreErrorFor, setMoreErrorFor] = useState<CareContractList | null>(
    null,
  );
  const shownPage = useLatest(firstPage.data);
  const pendingPage = useRef<symbol | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);
  const actionError = useApiErrorDisplay();
  const { success, warning } = useToast();

  // Another filter is another list: its rows start unselected.
  const [selectionFor, setSelectionFor] = useState(selectionKey);
  if (selectionFor !== selectionKey) {
    setSelectionFor(selectionKey);
    setSelected(new Set());
  }
  // A refusal takes the list away, and the choices made on it.
  if (firstPage.refused && (selected.size > 0 || creating)) {
    setSelected(new Set());
    setCreating(false);
  }
  if (firstPage.refused && more) setMore(null);

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
      modes: modeRead.data,
    };
  }, [
    firstPage.data,
    candidateRead.data,
    modeRead.data,
    schoolList.schools,
    more,
  ]);
  const metadataError =
    candidateRead.error ?? modeRead.error ?? schoolList.error;
  const loadError = firstPage.error ?? metadataError;

  const loadMore = async () => {
    const after = firstPage.data;
    if (!after || !data || after !== shownPage.current || loadingMore) return;
    const attempt = Symbol();
    pendingPage.current = attempt;
    const isCurrent = () =>
      pendingPage.current === attempt && shownPage.current === after;
    setLoadingMoreFor(after);
    setMoreErrorFor(null);
    moreLoad.clear();
    try {
      const { revision, contracts: loaded } = data.list;
      const answer = await listAccess.request(
        () =>
          fetchCareContracts({
            ...filter,
            offset: loaded.length,
            revision,
          }),
        listKey,
      );
      if (!answer?.isCurrent() || !isCurrent()) return;
      const page = answer.result;
      // A cursor names the offset served, with 0 meaning the loaded prefix
      // changed. Older servers instead return the same revision until reset.
      const offset = /^v1:(\d+):/.exec(page.revision)?.[1];
      const restarted =
        offset === undefined
          ? page.revision !== revision
          : offset !== String(loaded.length);
      if (restarted) {
        await firstPage.mutate(page, { revalidate: false });
        setMore(null);
        return;
      }
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
      if (!isRefusal(err) && isCurrent()) {
        setMoreErrorFor(after);
        await moreLoad.show(err, {
          object: "die Liste der Verträge",
          retry: () => void loadMore(),
        });
      }
    } finally {
      if (pendingPage.current === attempt) {
        pendingPage.current = null;
        setLoadingMoreFor(null);
      }
    }
  };

  const cancelPagination = () => {
    pendingPage.current = null;
    setLoadingMoreFor(null);
  };

  // Reload after a send: a failure there is a load error above the
  // confirmed rows, not a failed send (#6652). The reload replaces the
  // older pages loaded below the first.
  const refreshScope = useMemo(() => ({ listKey }), [listKey]);
  const [failedRefresh, setFailedRefresh] = useState<{
    scope: typeof refreshScope;
    page: CareContractList | null;
  } | null>(null);
  const afterWrite = useRefreshAfterWrite(
    "die Anzeige der Verträge",
    async () => {
      cancelPagination();
      let refusal: unknown;
      try {
        await firstPage.reloadOrThrow({
          fetcher: () =>
            listAccess.read(listKey, fetchFirstPage, (error) => {
              refusal = error;
            }),
        });
      } catch (error) {
        // The refusal cleared the cache and ended this read's generation.
        // Report this request's refusal, not a change to the tab-wide counter.
        if (refusal !== undefined) throw refusal;
        // A newer sort or refresh taking over is not a load failure.
        if (isDiscardedAnswer(error)) return;
        setFailedRefresh({ scope: refreshScope, page: shownPage.current });
        throw error;
      }
    },
  );

  const refreshError =
    failedRefresh?.scope === refreshScope &&
    failedRefresh.page === firstPage.data
      ? afterWrite.error
      : null;
  const hasMetadata =
    candidateRead.data !== null &&
    modeRead.data !== null &&
    schoolList.schools !== null;
  const loading =
    !firstPage.error &&
    !refreshError &&
    !data &&
    (!metadataError || hasMetadata);
  const listError = !data ? (firstPage.error ?? refreshError) : null;
  const showList = !firstPage.refused && (data || loading || listError);

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
  const hasShownRows = contracts.length > 0;
  const shownRows = useLatest(
    useMemo(
      () => (hasShownRows ? { key: listKey, page: firstPage.data } : null),
      [hasShownRows, listKey, firstPage.data],
    ),
  );
  const schools = (schoolList.schools ?? []).map((school) => ({
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
  // A new order may leave a ticked contract on a page not loaded yet: only
  // the ticked rows the list shows count and are sent.
  const shownSelected = useMemo(
    () =>
      new Set(
        contracts
          .filter((contract) => selected.has(contract.id))
          .map((contract) => contract.id),
      ),
    [contracts, selected],
  );
  const selectedDrafts = contracts.filter(
    (contract) =>
      shownSelected.has(contract.id) && contract.status === "entwurf",
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
      cancelPagination();
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
      cancelPagination();
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
        ...CONTRACT_STATUS_ORDER.map((key) => {
          const count = data?.list.counts[key];
          const label = CONTRACT_STATUS_LABELS[key];
          return {
            value: key,
            label: count === undefined ? label : `${label} (${count})`,
          };
        }),
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
    download: async (format) => {
      const answer = await listAccess.request(() =>
        downloadTraegerList(
          bffFile("org", "GET /traeger/contracts/export", {
            query: listExportQuery(format, {
              status: status === "all" ? undefined : status,
              school_id: schoolId,
              search: term,
              // The file follows the order of the list.
              sort: filter.sort,
              order: filter.order,
            }),
          }),
        ),
      );
      return answer && { ...answer.result, isCurrent: answer.isCurrent };
    },
    scope: traegerExportScope(
      schools.find((school) => school.value === schoolId)?.label,
    ),
    fallbackName: "betreuungsvertraege",
    errorObject: "die Verträge",
    unavailable: !data,
  });

  // The count names the children waiting for a contract; the dialog lists
  // each of them, with the reason where a draft cannot be made yet.
  // A child an imported contract covers has its contract: the dialog shows
  // it with the reason, but it waits for nothing (#7760).
  const waiting = candidates.filter(
    (candidate) => candidate.templateIssue !== "imported_contract",
  ).length;
  const createLabel =
    waiting > 0 ? `Verträge erstellen (${waiting})` : "Verträge erstellen";

  return (
    <TenantPage
      title="Verträge"
      info="Hier siehst du die Betreuungsverträge aus den angenommenen Anmeldungen deiner Schulen und die Verträge, die du aus einem anderen Programm importiert hast. moto übernimmt Kind, Eltern, Beginn und die gebuchten Module pro Wochentag. Gilt der Vertrag bei der Annahme, entsteht er von selbst, wenn die Eltern im Anmeldeformular den Vertragsbedingungen zugestimmt haben. Sonst prüfst du den Entwurf und sendest ihn per Mail und in die Eltern-App."
      tabs={careContractTabs("vertraege")}
      stats={
        total > 0 || waiting > 0 ? (
          <TenantPageStats
            items={statusFigures(
              total,
              drafts,
              sentCount,
              activeCount,
              waiting,
            )}
          />
        ) : null
      }
      statsLoading={!data && !loadError}
      search={{
        value: search,
        onChange: setSearch,
        placeholder: "Kind, Eltern oder Angebot suchen",
        debounceMs: 250,
        resetKey: searchReset,
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
          label: "Mit Kinderakten verknüpfen",
          description:
            "Öffnet das Verknüpfen importierter Verträge mit der Kinderakte, per CSV-Datei.",
          icon: <Link2 className="h-4 w-4" aria-hidden />,
          href: traegerPath("/traeger/vertraege/verknuepfen"),
          onClick: () => undefined,
        },
        {
          label: "Anmeldungen nachtragen",
          description:
            "Öffnet die Vorschau: Verknüpfte Verträge bekommen die Anmeldung an ihrer Schule.",
          icon: <ClipboardCheck className="h-4 w-4" aria-hidden />,
          href: traegerPath("/traeger/vertraege/anmeldungen"),
          onClick: () => undefined,
        },
        {
          label: "Geschwister zusammenführen",
          description:
            "Öffnet die Verträge ohne Mail-Adresse, um Geschwister zu einer Familie zusammenzuführen.",
          icon: <UsersRound className="h-4 w-4" aria-hidden />,
          href: traegerPath("/traeger/vertraege/geschwister"),
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
      error={firstPage.refused ? firstPage.error : metadataError}
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
      <LoadErrorAlert
        error={
          (data ? (refreshError ?? firstPage.error) : null) ??
          (moreErrorFor === firstPage.data ? moreLoad.error : null)
        }
      />
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
            aria-label="Abschluss pro Schule"
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
      {showList ? (
        <DataTable
          columns={sort.key === "school" ? COLUMNS_SORTED_BY_SCHOOL : COLUMNS}
          rows={contracts}
          isLoading={loading}
          loadingRowCount={6}
          getRowKey={(contract) => contract.id}
          // Six columns: narrower gaps keep child and offer on one line
          // each on a laptop.
          dense
          stackedLayout="row"
          stackedDetailKey="school"
          headerActions={
            desktop === false ? (
              <CustomSelect
                label="Sortieren nach"
                value={`${sort.key}:${sort.direction}`}
                options={MOBILE_SORT_OPTIONS}
                onChange={(value) => {
                  const option = MOBILE_SORT_OPTIONS.find(
                    (entry) => entry.value === value,
                  );
                  if (option) setSort(option.sort);
                }}
              />
            ) : undefined
          }
          // A column orders every contract of the filter, not the loaded
          // rows: the database sorts and the list starts again (#8138).
          serverSort={{ ...sort, onChange: setSort }}
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
            selectedKeys: shownSelected,
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
            listError ? (
              <LoadErrorAlert error={listError} className="text-left" />
            ) : (
              <EmptyState
                icon={
                  <MotoConceptIcon
                    concept={careContractsConcept}
                    className="h-12 w-12"
                  />
                }
                {...emptyText(
                  total,
                  waiting,
                  data !== null &&
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
                        setSearchReset((current) => current + 1);
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
            )
          }
        />
      ) : null}
      {data && shownSelected.size > 0 ? (
        // What the ticked rows are for, and the action, stick at the bottom
        // of the screen while the list scrolls.
        <SelectionBar
          aria-label="Ausgewählte Verträge"
          placement="bottom"
          count={shownSelected.size}
          label={
            shownSelected.size === 1
              ? "1 Vertrag ausgewählt"
              : `${shownSelected.size} Verträge ausgewählt`
          }
          description={
            selectedDrafts.length < shownSelected.size ? (
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
