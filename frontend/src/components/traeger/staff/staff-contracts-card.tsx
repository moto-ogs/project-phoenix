"use client";

// Die Arbeitsverträge einer Personalakte (#4706, ADR 0089, ADR 0237): je
// Vertrag die Art, die Laufzeit, das Soll Montag bis Freitag je Schule mit
// seinem Verlauf und das Ferien-Soll einzelner Wochen. Die Schulen rechnen
// in ihrer Zeiterfassung mit diesem Soll.

import {
  CalendarPlusIcon,
  PencilSimpleIcon,
  PlusIcon,
  SunHorizonIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { ConfirmDeleteModal } from "~/components/ui/confirm-delete-modal";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { EmptyState } from "~/components/ui/empty-state";
import { FramedList } from "~/components/ui/framed-list";
import { InsetPanel } from "~/components/ui/inset-panel";
import { OverflowMenu } from "~/components/ui/page-header/OverflowMenu";
import { SectionCard } from "~/components/ui/section-card";
import { SectionLabel } from "~/components/ui/section-label";
import { StatusBadge } from "~/components/ui/status-badge";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { timeTrackingConcept } from "~/lib/concepts/timeTracking";
import { formatDate } from "~/lib/date-helpers";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { createLogger } from "~/lib/logger";
import { useInvalidateFamily } from "~/lib/swr";
import { traegerStaffKeys } from "~/lib/swr/traeger-staff-keys";
import {
  deleteStaffContract,
  deleteStaffHolidayWeek,
  type StaffContract,
  type StaffContractHolidayWeek,
  type StaffContractSite,
  type StaffRecordDetail,
} from "~/lib/traeger-staff-api";
import {
  ChangeSollDialog,
  ContractTermsDialog,
  CreateContractDialog,
  HolidayWeeksDialog,
} from "./staff-contract-dialogs";
import {
  CONTRACT_KIND_LABELS,
  CONTRACT_PHASE_TONES,
  CONTRACT_WEEKDAYS,
  changeableFrom,
  contractPhase,
  contractPhaseLabel,
  contractTerm,
  contractWeekMinutes,
  fridayOf,
  hoursLabel,
  sollOn,
  weekMinutes,
  weekPattern,
} from "./staff-contract-format";

const logger = createLogger({ component: "TraegerStaffContractsCard" });

const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

type Dialog =
  | { readonly kind: "create" }
  | { readonly kind: "soll"; readonly contract: StaffContract }
  | { readonly kind: "weeks"; readonly contract: StaffContract }
  | { readonly kind: "terms"; readonly contract: StaffContract }
  | { readonly kind: "delete"; readonly contract: StaffContract }
  | {
      readonly kind: "deleteWeek";
      readonly contract: StaffContract;
      readonly week: StaffContractHolidayWeek;
    };

/** Eine Zeile der Soll-Tabelle: eine Schule mit dem Soll von heute. */
interface SollRow {
  readonly site: StaffContractSite;
  readonly minutes: readonly number[] | null;
  readonly validFrom: string | null;
}

function sollColumns(): DataTableColumn<SollRow>[] {
  return [
    {
      key: "school",
      header: "Schule",
      stacked: "title",
      render: (row) => (
        <span className="font-medium text-gray-900">{row.site.schoolName}</span>
      ),
    },
    ...CONTRACT_WEEKDAYS.map((day, index): DataTableColumn<SollRow> => ({
      key: `day-${index}`,
      header: day.short,
      align: "right",
      stacked: "hidden",
      render: (row) => {
        const minutes = row.minutes?.[index] ?? 0;
        return (
          <span
            className={`tabular-nums ${minutes > 0 ? "text-gray-900" : "text-gray-500"}`}
          >
            {minutes > 0 ? hoursLabel(minutes).replace(" Std.", "") : "–"}
          </span>
        );
      },
    })),
    {
      key: "week",
      header: "Woche",
      align: "right",
      stacked: "meta",
      render: (row) => (
        <span className="font-semibold text-gray-900 tabular-nums">
          {row.minutes ? hoursLabel(weekMinutes(row.minutes)) : "–"}
        </span>
      ),
    },
    {
      key: "pattern",
      header: "Tage",
      stacked: "field",
      // Nur in der Telefonansicht: die Tabelle zeigt die Tage als Spalten.
      className: "hidden",
      headerClassName: "hidden",
      render: (row) => (row.minutes ? weekPattern(row.minutes) : "–"),
    },
    {
      key: "since",
      header: "Gilt seit",
      align: "right",
      stacked: "meta",
      render: (row) => (
        <span className="text-gray-500 tabular-nums">
          {row.validFrom ? formatDate(row.validFrom) : "–"}
        </span>
      ),
    },
  ];
}

/** Das Soll früherer und geplanter Zeiträume, je Schule. */
function SollHistory({
  contract,
  today,
}: Readonly<{ contract: StaffContract; today: string }>) {
  const entries = contract.sites.flatMap((site) => {
    const current = sollOn(site, today);
    return site.soll
      .filter((soll) => soll !== current)
      .map((soll) => ({ site, soll, planned: soll.validFrom > today }));
  });
  if (entries.length === 0) return null;
  return (
    <div className="space-y-2">
      <SectionLabel as="h4">Weiteres Soll</SectionLabel>
      <FramedList>
        {entries.map(({ site, soll, planned }) => (
          <li
            key={`${site.schoolId}-${soll.validFrom}`}
            className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
          >
            <span className="min-w-0 text-sm text-gray-900">
              <span className="font-medium">{site.schoolName}</span>
              <span className="text-gray-500">
                {" "}
                · {planned ? "ab" : "seit"} {formatDate(soll.validFrom)}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-3 text-sm text-gray-600 tabular-nums">
              {weekPattern(soll.weekdayMinutes)}
              <StatusBadge
                label={planned ? "Geplant" : "Vorher"}
                tone={planned ? "blue" : "gray"}
              />
            </span>
          </li>
        ))}
      </FramedList>
    </div>
  );
}

function HolidayWeeks({
  contract,
  onDelete,
}: Readonly<{
  contract: StaffContract;
  onDelete: (week: StaffContractHolidayWeek) => void;
}>) {
  return (
    <div className="space-y-2">
      <SectionLabel as="h4">Ferien-Soll</SectionLabel>
      {contract.holidayWeeks.length === 0 ? (
        <p className="text-sm text-gray-500">
          Keine Ferienwoche eingetragen. In den Ferien gilt dann das Soll oben.
        </p>
      ) : (
        <FramedList>
          {contract.holidayWeeks.map((week) => (
            <li
              key={`${week.schoolId}-${week.weekStart}`}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium text-gray-900 tabular-nums">
                  {formatDate(week.weekStart)} bis{" "}
                  {formatDate(fridayOf(week.weekStart))}
                </span>
                <span className="block text-sm text-gray-500">
                  {week.schoolName} · {weekPattern(week.weekdayMinutes)}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-sm font-semibold text-gray-900 tabular-nums">
                  {hoursLabel(weekMinutes(week.weekdayMinutes))}
                </span>
                <OverflowMenu
                  ariaLabel={`Aktionen für die Ferienwoche ab ${formatDate(week.weekStart)}`}
                  items={[
                    {
                      label: "Löschen",
                      description:
                        "Löscht die Woche, moto fragt vorher nach. Dann gilt das normale Soll.",
                      icon: <TrashIcon className="size-4" aria-hidden="true" />,
                      destructive: true,
                      onClick: () => onDelete(week),
                    },
                  ]}
                />
              </span>
            </li>
          ))}
        </FramedList>
      )}
    </div>
  );
}

function ContractPanel({
  contract,
  today,
  onOpen,
}: Readonly<{
  contract: StaffContract;
  today: string;
  onOpen: (dialog: Dialog) => void;
}>) {
  const phase = contractPhase(contract, today);
  const day = phase === "upcoming" ? contract.startsOn : today;
  const rows: SollRow[] = contract.sites.map((site) => {
    const soll = sollOn(site, day);
    return {
      site,
      minutes: soll?.weekdayMinutes ?? null,
      validFrom: soll?.validFrom ?? null,
    };
  });
  const earliest = changeableFrom(contract.sites);
  const ended = phase === "ended";
  return (
    <InsetPanel tone="white" padding="md" className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-gray-900">
              {CONTRACT_KIND_LABELS[contract.kind]}
            </h3>
            <StatusBadge
              label={contractPhaseLabel(contract, phase)}
              tone={CONTRACT_PHASE_TONES[phase]}
            />
            {contract.pool ? (
              <StatusBadge label="Vertretungspool" tone="blue" />
            ) : null}
          </div>
          <p className="text-sm text-gray-500 tabular-nums">
            {contractTerm(contract)} ·{" "}
            <span className="font-medium text-gray-700">
              {hoursLabel(contractWeekMinutes(contract, day))} pro Woche
            </span>
          </p>
        </div>
        <OverflowMenu
          ariaLabel={`Aktionen für den Vertrag ${CONTRACT_KIND_LABELS[contract.kind]} ${contractTerm(contract)}`}
          items={[
            {
              label: "Soll ändern",
              description:
                "Neue Stunden ab einem Tag, für eine oder mehrere Schulen.",
              icon: <PencilSimpleIcon className="size-4" aria-hidden="true" />,
              onClick: () => onOpen({ kind: "soll", contract }),
            },
            {
              label: "Ferien-Soll eintragen",
              description: "Andere Stunden für einzelne Ferienwochen.",
              icon: <SunHorizonIcon className="size-4" aria-hidden="true" />,
              onClick: () => onOpen({ kind: "weeks", contract }),
            },
            {
              label: "Vertrag ändern",
              description:
                "Die Art des Vertrags, der letzte Tag und der Vertretungspool.",
              icon: <CalendarPlusIcon className="size-4" aria-hidden="true" />,
              onClick: () => onOpen({ kind: "terms", contract }),
            },
            {
              label: "Vertrag löschen",
              description:
                "Nur für einen Vertrag, der noch nicht zählt. moto fragt vorher nach.",
              icon: <TrashIcon className="size-4" aria-hidden="true" />,
              destructive: true,
              onClick: () => onOpen({ kind: "delete", contract }),
            },
          ]}
        />
      </div>

      <DataTable
        columns={sollColumns()}
        rows={rows}
        getRowKey={(row) => row.site.schoolId}
        stackedOnMobile
      />
      {!ended && earliest ? (
        <p className="text-sm text-gray-500">
          Änderungen wirken an den Schulen frühestens ab dem{" "}
          {formatDate(earliest)}. Davor haben sie schon gerechnet.
        </p>
      ) : null}

      <SollHistory contract={contract} today={day} />
      <HolidayWeeks
        contract={contract}
        onDelete={(week) => onOpen({ kind: "deleteWeek", contract, week })}
      />
    </InsetPanel>
  );
}

export function StaffContractsCard({
  record,
  onChanged,
}: Readonly<{
  record: StaffRecordDetail;
  onChanged: (record: StaffRecordDetail) => void;
}>) {
  const today = useBerlinToday();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deleteErrors = useApiFormError();
  const { success } = useToast();
  const invalidateFamily = useInvalidateFamily();
  const activeSchools = record.employments.filter(
    (employment) => employment.active,
  ).length;

  const close = () => setDialog(null);
  const saved = (next: StaffRecordDetail) => {
    setDialog(null);
    onChanged(next);
    // The contracts make the Soll of the planning and the time account and
    // put a person into the Vertretungspool (#4709).
    void invalidateFamily(traegerStaffKeys.poolFamily);
    void invalidateFamily(traegerStaffKeys.planningFamily);
    void invalidateFamily(traegerStaffKeys.timeAccountFamily);
  };
  const open = (next: Dialog) => {
    deleteErrors.clear();
    setDialog(next);
  };

  const confirmDelete = async () => {
    if (dialog?.kind !== "delete" && dialog?.kind !== "deleteWeek") return;
    setDeleting(true);
    try {
      const next =
        dialog.kind === "delete"
          ? await deleteStaffContract(record.id, dialog.contract.id)
          : await deleteStaffHolidayWeek(
              record.id,
              dialog.contract.id,
              dialog.week.schoolId,
              dialog.week.weekStart,
            );
      success(
        dialog.kind === "delete"
          ? "Der Arbeitsvertrag ist gelöscht."
          : "Die Ferienwoche ist gelöscht.",
      );
      saved(next);
    } catch (err) {
      logger.error("traeger_staff_contract_delete_failed", {
        error: errorMessage(err),
      });
      await deleteErrors.show(err, {
        object:
          dialog.kind === "delete" ? "den Arbeitsvertrag" : "die Ferienwoche",
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <SectionCard
      concept={timeTrackingConcept}
      title="Arbeitsverträge"
      description="Vertrag und Soll je Schule. Die Schulen rechnen damit in ihrer Zeiterfassung, auch in den Ferien."
      action={
        <Button
          size="md"
          type="button"
          variant="primary"
          className="gap-2"
          disabled={activeSchools === 0}
          disabledReason="Die Person arbeitet an keiner Schule mehr."
          tooltip="Öffnet ein Fenster für einen neuen Vertrag mit Soll je Schule."
          onClick={() => open({ kind: "create" })}
        >
          <PlusIcon className="h-4 w-4" aria-hidden="true" />
          Vertrag anlegen
        </Button>
      }
    >
      {record.unsyncedSchools.length > 0 ? (
        <Alert
          type="warning"
          message={`Gespeichert, aber noch nicht bei ${record.unsyncedSchools.join(", ")} angekommen. Bis dahin rechnet die Schule mit dem alten Soll. Speichern Sie später eine Änderung, dann holt moto es nach.`}
        />
      ) : null}
      {record.contracts.length === 0 ? (
        <EmptyState
          variant="compact"
          title="Noch kein Arbeitsvertrag."
          description="Bis dahin pflegt jede Schule das Soll dieser Person selbst."
        />
      ) : (
        <div className="space-y-4">
          {record.contracts.map((contract) => (
            <ContractPanel
              key={contract.id}
              contract={contract}
              today={today}
              onOpen={open}
            />
          ))}
        </div>
      )}

      {dialog?.kind === "create" ? (
        <CreateContractDialog record={record} onClose={close} onSaved={saved} />
      ) : null}
      {dialog?.kind === "soll" ? (
        <ChangeSollDialog
          record={record}
          contract={dialog.contract}
          today={today}
          onClose={close}
          onSaved={saved}
        />
      ) : null}
      {dialog?.kind === "weeks" ? (
        <HolidayWeeksDialog
          record={record}
          contract={dialog.contract}
          onClose={close}
          onSaved={saved}
        />
      ) : null}
      {dialog?.kind === "terms" ? (
        <ContractTermsDialog
          record={record}
          contract={dialog.contract}
          onClose={close}
          onSaved={saved}
        />
      ) : null}
      <ConfirmDeleteModal
        isOpen={dialog?.kind === "delete" || dialog?.kind === "deleteWeek"}
        onClose={() => {
          if (!deleting) close();
        }}
        onConfirm={() => void confirmDelete()}
        title={
          dialog?.kind === "deleteWeek"
            ? "Ferienwoche löschen?"
            : "Vertrag löschen?"
        }
        description={
          dialog?.kind === "deleteWeek" ? (
            <p>
              Die Woche ab dem {formatDate(dialog.week.weekStart)} an der Schule{" "}
              {dialog.week.schoolName} wird gelöscht. Dann gilt dort das normale
              Soll.
            </p>
          ) : (
            <p>
              Der Vertrag wird mit seinem Soll gelöscht. Die Schulen behalten
              das zuletzt eingetragene Soll und pflegen es wieder selbst.
            </p>
          )
        }
        gate={{ mode: "twoStep" }}
        confirmLabel="Löschen"
        loadingLabel="Wird gelöscht …"
        loading={deleting}
        error={deleteErrors.error}
      />
    </SectionCard>
  );
}
