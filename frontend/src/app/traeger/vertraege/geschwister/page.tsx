"use client";

// Geschwister zusammenführen (#7161, ADR 0319): Verträge ohne Mail-Adresse,
// etwa aus dem Stammdaten-Export von OGS Connect, kennt moto nur einzeln.
// Jeder ist eine eigene Familie, und Geschwister zahlen den Preis des ersten
// Kindes. Hier wählt das Träger-Büro Geschwister aus und führt sie unter einem
// führenden Vertrag zu einer Familie zusammen. Lösen stellt den Stand von
// vorher wieder her. Die Liste steht nach Nachnamen, so stehen Geschwister
// untereinander. moto schlägt nichts vor und führt nichts selbst zusammen.

import { UsersRound } from "lucide-react";
import { useSession } from "next-auth/react";
import { useMemo, useState } from "react";
import {
  type ContractFamily,
  childName,
  childrenLabel,
  contractFamilies,
  familiesLabel,
  familyMatches,
  familyParents,
  familySchools,
  isJoined,
  proposedLead,
} from "~/components/traeger/contract-family-format";
import { ContractFamilyJoinModal } from "~/components/traeger/contract-family-join-modal";
import { ContractFamilyLogCard } from "~/components/traeger/contract-family-log-card";
import { emptySearchText } from "~/components/traeger/empty-search";
import { useTraegerListExportItems } from "~/components/traeger/traeger-list-export-menu";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { Button } from "~/components/ui/button";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { EmptyState } from "~/components/ui/empty-state";
import { FormErrorAlert } from "~/components/ui/form-error-alert";
import { IconTile } from "~/components/ui/icon-tile";
import { OverflowMenu } from "~/components/ui/page-header/OverflowMenu";
import type {
  ActiveFilter,
  FilterConfig,
} from "~/components/ui/page-header/types";
import { ConfirmationModal } from "~/components/ui/modal";
import { ListSkeleton } from "~/components/ui/page-skeletons";
import { SelectionBar } from "~/components/ui/selection-bar";
import { StatusBadge } from "~/components/ui/status-badge";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import {
  useApiErrorDisplay,
  useApiFormError,
  useToast,
} from "~/contexts/ToastContext";
import { isChangedSinceRead } from "~/lib/api-error";
import { hasPermission } from "~/lib/auth-utils";
import { bffFile } from "~/lib/bff-fetch";
import { formatDate } from "~/lib/date-helpers";
import { createLogger } from "~/lib/logger";
import { useInvalidateFamily } from "~/lib/swr";
import { traegerBillingKeys } from "~/lib/swr/traeger-billing-keys";
import { traegerContractKeys } from "~/lib/swr/traeger-contract-keys";
import {
  type ContractFamilyMember,
  fetchContractFamilies,
  joinContractFamily,
  leaveContractFamily,
} from "~/lib/traeger-contract-families-api";
import {
  downloadTraegerList,
  listExportQuery,
} from "~/lib/traeger-list-export";
import { traegerPath } from "~/lib/traeger-url";

const logger = createLogger({ component: "TraegerContractFamiliesPage" });

const INFO =
  "Verträge ohne Mail-Adresse kennt moto nur einzeln. Jeder ist eine eigene Familie. Hier legst du fest, welche Kinder Geschwister sind. Dann gilt im Monatslauf der Geschwisterpreis, und ein Mandat gilt für alle Kinder der Familie. Lösen stellt den Stand von vorher wieder her.";

type Shown = "all" | "joined" | "alone";

const SHOWN_LABELS: Record<Exclude<Shown, "all">, string> = {
  joined: "Mit Geschwistern",
  alone: "Einzeln",
};

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The children of a family, the leading one first. On a phone the birth date
 * and the contract go under the name, so a card keeps whole names.
 */
function FamilyChildren({ family }: Readonly<{ family: ContractFamily }>) {
  const joined = isJoined(family);
  return (
    <ul className="space-y-1.5">
      {family.members.map((contract, index) => {
        const details = [
          contract.childBirthDate
            ? `geb. ${formatDate(contract.childBirthDate)}`
            : null,
          `Vertrag Nr. ${contract.contractId}`,
          joined && index === 0 ? "führt die Familie" : null,
        ].filter(Boolean);
        return (
          <li key={contract.contractId} className="min-w-0">
            <span className="font-medium text-gray-900">
              {childName(contract)}
            </span>
            <span className="text-sm text-gray-500 max-sm:block">
              <span className="max-sm:hidden"> · </span>
              {details.join(" · ")}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export default function TraegerContractFamiliesPage() {
  const { data: session } = useSession();
  // The Abrechnung joins siblings too, but has no list of the contracts:
  // it goes back to its families.
  const back = hasPermission(session ?? null, "traeger_contracts:manage")
    ? { href: "/traeger/vertraege", label: "Zurück zu den Verträgen" }
    : { href: "/traeger/abrechnung/familien", label: "Zurück zu den Familien" };
  const { data, error, mutate, reloadOrThrow } = useTraegerResource(
    traegerContractKeys.families(),
    fetchContractFamilies,
    "die Verträge ohne Mail-Adresse",
  );
  const invalidateFamily = useInvalidateFamily();
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState<Shown>("all");
  const [schoolId, setSchoolId] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [joining, setJoining] = useState(false);
  const [lead, setLead] = useState("");
  const [leaving, setLeaving] = useState<ContractFamilyMember | null>(null);
  const [busy, setBusy] = useState(false);
  const joinErrors = useApiFormError();
  const leaveErrors = useApiFormError();
  const staleErrors = useApiErrorDisplay();
  const { success } = useToast();

  const families = useMemo(
    () => contractFamilies(data?.contracts ?? []),
    [data],
  );
  const names = useMemo(
    () =>
      new Map(
        (data?.contracts ?? []).map(
          (contract) => [contract.contractId, childName(contract)] as const,
        ),
      ),
    [data],
  );
  const schools = useMemo(() => {
    const bySchool = new Map<string, string>();
    for (const contract of data?.contracts ?? []) {
      bySchool.set(contract.schoolId, contract.schoolName);
    }
    return [...bySchool]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "de"));
  }, [data]);
  const visible = families.filter(
    (family) =>
      familyMatches(family, search) &&
      (shown === "all" || (shown === "joined") === isJoined(family)) &&
      (!schoolId ||
        family.members.some((contract) => contract.schoolId === schoolId)),
  );
  const chosen = families.filter((family) => selected.has(family.leadId));
  const chosenChildren = chosen.reduce(
    (count, family) => count + family.members.length,
    0,
  );
  const joined = families.filter(isJoined);

  // After a change the billing reads the families anew: the sibling price,
  // the list of the families and their numbers of children follow them.
  const refreshBilling = () => {
    void invalidateFamily(traegerBillingKeys.familiesFamily);
    void invalidateFamily(traegerBillingKeys.childCounts());
  };

  // A refused change: someone changed the families since this page read
  // them, so the same choice would be refused again; the dialog closes and
  // the page shows the stored state (ADR 0311). Any other refusal stays in
  // the dialog.
  const refused = (
    err: unknown,
    event: string,
    dialog: ReturnType<typeof useApiFormError>,
    close: () => void,
  ) => {
    logger.error(event, { error: errorText(err) });
    if (isChangedSinceRead(err)) {
      close();
      void staleErrors.show(err, {
        object: "die Familie",
        reload: reloadOrThrow,
      });
      return;
    }
    void dialog.show(err, { object: "die Familie" });
  };

  const openJoin = () => {
    joinErrors.clear();
    setLead(proposedLead(chosen));
    setJoining(true);
  };

  const join = async () => {
    if (!data || chosen.length < 2 || !lead) return;
    setBusy(true);
    joinErrors.clear();
    try {
      const next = await joinContractFamily({
        contractIds: chosen.flatMap((family) =>
          family.members.map((contract) => contract.contractId),
        ),
        familyContractId: lead,
        expectedVersion: data.version,
      });
      await mutate(next, { revalidate: false });
      refreshBilling();
      success(
        `${childrenLabel(chosenChildren)} sind jetzt eine Familie. Der nächste Monatslauf zählt sie als Geschwister.`,
      );
      setJoining(false);
      setSelected(new Set());
    } catch (err) {
      refused(err, "contract_family_join_failed", joinErrors, () => {
        setJoining(false);
        setSelected(new Set());
      });
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    if (!data || !leaving) return;
    setBusy(true);
    leaveErrors.clear();
    try {
      const next = await leaveContractFamily(leaving.contractId, data.version);
      await mutate(next, { revalidate: false });
      refreshBilling();
      success(`${childName(leaving)} ist wieder eine eigene Familie.`);
      setLeaving(null);
    } catch (err) {
      refused(err, "contract_family_leave_failed", leaveErrors, () =>
        setLeaving(null),
      );
    } finally {
      setBusy(false);
    }
  };

  const columns: DataTableColumn<ContractFamily>[] = [
    {
      key: "children",
      header: "Kinder",
      render: (family) => <FamilyChildren family={family} />,
      sortValue: (family) =>
        `${family.lead.childLastName} ${family.lead.childFirstName}`,
      stacked: "title",
    },
    {
      key: "parents",
      header: "Eltern",
      render: (family) => (
        <span className="text-gray-700">{familyParents(family)}</span>
      ),
      sortValue: (family) => familyParents(family),
    },
    {
      key: "school",
      header: "Schule",
      render: (family) => (
        <span className="text-gray-700">{familySchools(family)}</span>
      ),
      sortValue: (family) => familySchools(family),
    },
    {
      key: "state",
      header: "Familie",
      render: (family) =>
        isJoined(family) ? (
          <StatusBadge
            tone="green"
            label={`${childrenLabel(family.members.length)} zusammen`}
          />
        ) : (
          <StatusBadge tone="outline" label="Einzeln" />
        ),
      sortValue: (family) => family.members.length,
      stacked: "field",
    },
    {
      key: "actions",
      header: "",
      align: "right",
      className: "w-12 align-top",
      render: (family) =>
        isJoined(family) ? (
          <OverflowMenu
            ariaLabel={`Aktionen für die Familie von ${childName(family.lead)}`}
            items={family.members.slice(1).map((contract) => ({
              label: `${childName(contract)} lösen`,
              description:
                "moto fragt vorher nach. Danach ist das Kind wieder eine eigene Familie.",
              onClick: () => {
                leaveErrors.clear();
                setLeaving(contract);
              },
            }))}
          />
        ) : null,
    },
  ];

  const filters: FilterConfig[] = [
    {
      id: "shown",
      label: "Familie",
      type: "dropdown",
      value: shown,
      onChange: (value) => setShown(value as Shown),
      options: [
        { value: "all", label: "Alle Familien" },
        { value: "joined", label: SHOWN_LABELS.joined },
        { value: "alone", label: SHOWN_LABELS.alone },
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
    ...(shown === "all"
      ? []
      : [
          {
            id: "shown",
            label: SHOWN_LABELS[shown],
            onRemove: () => setShown("all"),
          },
        ]),
    ...(schoolId
      ? [
          {
            id: "school",
            label:
              schools.find((school) => school.value === schoolId)?.label ??
              "Schule",
            onRemove: () => setSchoolId(""),
          },
        ]
      : []),
  ];
  const exportItems = useTraegerListExportItems({
    download: (format) =>
      downloadTraegerList(
        bffFile("org", "GET /traeger/contract-families/export", {
          query: listExportQuery(format),
        }),
      ),
    scope:
      "Alle Verträge ohne Mail-Adresse, ohne Suche und Filter. Jeder Download steht im Verlauf.",
    fallbackName: "geschwister-ohne-mail-adresse",
    errorObject: "die Liste der Familien",
    unavailable: !data || data.contracts.length === 0,
  });
  const empty = emptySearchText(
    search,
    activeFilters.map((filter) => filter.label),
  );

  return (
    <TenantPage
      title="Geschwister zusammenführen"
      info={INFO}
      back
      backHref={traegerPath(back.href)}
      backLabel={back.label}
      stats={
        data && data.contracts.length > 0 ? (
          <TenantPageStats
            items={[
              {
                value: data.contracts.length,
                label:
                  data.contracts.length === 1
                    ? "Vertrag ohne Mail-Adresse"
                    : "Verträge ohne Mail-Adresse",
              },
              {
                value: joined.length,
                label:
                  joined.length === 1
                    ? "Familie mit Geschwistern"
                    : "Familien mit Geschwistern",
              },
            ]}
          />
        ) : null
      }
      statsLoading={!data && !error}
      search={
        data && data.contracts.length > 0
          ? {
              value: search,
              onChange: setSearch,
              placeholder: "Kind, Eltern oder Vertragsnummer suchen",
            }
          : undefined
      }
      filters={data && data.contracts.length > 0 ? filters : undefined}
      overflowMenu={exportItems}
      activeFilters={activeFilters}
      onClearAllFilters={() => {
        setShown("all");
        setSchoolId("");
      }}
      error={error}
      loading={
        !error && !data ? <ListSkeleton rows={6} avatar={false} /> : false
      }
      overlays={
        <>
          <ContractFamilyJoinModal
            families={joining ? chosen : []}
            lead={lead}
            onLeadChange={setLead}
            onClose={() => {
              if (!busy) setJoining(false);
            }}
            onConfirm={() => void join()}
            busy={busy}
            error={joinErrors.error}
          />
          <ConfirmationModal
            isOpen={leaving !== null}
            onClose={() => {
              setLeaving(null);
              leaveErrors.clear();
            }}
            onConfirm={() => void leave()}
            title="Aus der Familie lösen?"
            confirmText="Lösen"
            confirmVariant="warning"
            confirmTooltip="Löst das Kind sofort aus der Familie. Eltern bekommen keine Nachricht."
            loadingText="Wird gelöst …"
            isConfirmLoading={busy}
            mobileSheet
          >
            <div className="space-y-3 text-sm text-gray-700">
              <FormErrorAlert message={leaveErrors.error} />
              {leaving ? (
                <>
                  <p>
                    {childName(leaving)} ist danach wieder eine eigene Familie.
                    Es gilt wieder, was bei diesem Vertrag gespeichert war:
                    Debitorennummer, Zahlungsweg und Mandat.
                  </p>
                  <p>
                    Im nächsten Monatslauf zählt das Kind nicht mehr als
                    Geschwister. Ausgestellte Rechnungen ändern sich nicht.
                  </p>
                </>
              ) : null}
            </div>
          </ConfirmationModal>
        </>
      }
    >
      {data ? (
        <>
          <DataTable
            columns={columns}
            rows={visible}
            getRowKey={(family) => family.leadId}
            heading={{ title: "Familien", count: visible.length, level: 2 }}
            stackedOnMobile
            rowHasInteractiveControls={isJoined}
            selection={{
              selectedKeys: selected,
              disabled: busy,
              rowLabel: (family) =>
                `Familie von ${family.members.map(childName).join(", ")}`,
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
              data.contracts.length === 0 ? (
                <EmptyState
                  icon={
                    <IconTile
                      tone="green"
                      size="page"
                      icon={<UsersRound aria-hidden />}
                    />
                  }
                  title="Alle Familien haben eine Mail-Adresse"
                  description="moto bildet die Familien über die Mail-Adresse der Eltern von selbst. Hier gibt es nichts zu tun."
                />
              ) : (
                <EmptyState
                  title="Keine Familie passt zur Suche."
                  description={empty.description}
                  action={
                    <Button
                      type="button"
                      variant="outline"
                      size="md"
                      tooltip="Leert Suche und Filter und zeigt wieder alle Familien."
                      onClick={() => {
                        setSearch("");
                        setShown("all");
                        setSchoolId("");
                      }}
                    >
                      {empty.actionLabel}
                    </Button>
                  }
                />
              )
            }
          />
          {selected.size > 0 ? (
            <SelectionBar
              aria-label="Ausgewählte Familien"
              placement="bottom"
              count={selected.size}
              label={`${familiesLabel(chosen.length)} ausgewählt, ${childrenLabel(chosenChildren)}`}
              description={
                chosen.length < 2
                  ? "Wähle mindestens zwei Familien, die zusammengehören."
                  : "moto fragt vorher, welcher Vertrag die Familie führt."
              }
              onClear={() => setSelected(new Set())}
              busy={busy}
              actions={
                <Button
                  type="button"
                  variant="success"
                  size="compact"
                  disabled={chosen.length < 2}
                  disabledReason="Wähle zuerst mindestens zwei Familien aus."
                  tooltip="Öffnet die Bestätigung. moto fragt vorher, welcher Vertrag die Familie führt."
                  onClick={openJoin}
                >
                  <UsersRound className="mr-2 h-4 w-4" aria-hidden="true" />
                  Zusammenführen
                </Button>
              }
            />
          ) : null}
          <ContractFamilyLogCard events={data.events} names={names} />
        </>
      ) : null}
    </TenantPage>
  );
}
