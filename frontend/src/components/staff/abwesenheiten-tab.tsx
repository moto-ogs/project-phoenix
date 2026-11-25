"use client";

import {
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeftRight,
  CalendarClock,
  CalendarPlus,
  Check,
  Thermometer,
  Trash2,
} from "lucide-react";

import {
  DenyAbsenceModal,
  QuestionAbsenceModal,
} from "~/components/staff/absence-decision-modals";
import {
  SickReportModal,
  type SickReportStaff,
} from "~/components/staff/sick-report-modal";
import { AbsenceRequestRow } from "~/components/staff/absence-request-row";
import { AbsenceBookingModal } from "~/components/staff/absence-booking-modal";
import {
  AbsenceRebookModal,
  isRebookableAbsence,
} from "~/components/staff/absence-rebook-modal";
import { Checkbox } from "~/components/ui/checkbox";
import { CustomAllowanceEditForm } from "~/components/staff/custom-allowance-editor";
import {
  AllowanceCard,
  AllowanceExpiryNote,
} from "~/components/staff/allowance-card";
import { CatalogManageLink } from "~/components/database/catalog/catalog-manage-link";
import {
  ABSENCE_TYPE_HEX,
  ABSENCE_TYPE_LABEL,
  absenceRowActionNoun,
  absenceRowLabel,
  absenceStatusMeta,
  dayCountFor as sharedDayCountFor,
  dispatchAbsencesRefresh,
  formatAbsenceRange,
  formatDayCount,
} from "~/lib/absence-helpers";
import { LOCATION_COLORS } from "~/lib/location-helper";
import { Button } from "~/components/ui/button";
import { ConfirmDeleteModal } from "~/components/ui/confirm-delete-modal";
import { ISODatePicker } from "~/components/ui/date-picker";
import { DataField, DataGrid } from "~/components/ui/data-field";
import { EditActions } from "~/components/ui/edit-actions";
import { EmptyState } from "~/components/ui/empty-state";
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import { Input } from "~/components/ui/input";
import { Modal } from "~/components/ui/modal";
import {
  CardGridSkeleton,
  ListSkeleton,
  SkeletonRegion,
} from "~/components/ui/page-skeletons";
import { SectionCard } from "~/components/ui/section-card";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { StatusBadge } from "~/components/ui/status-badge";
import { StatusColorBadge } from "~/components/ui/status-color-badge";
import { Textarea } from "~/components/ui/textarea";
import {
  useApiErrorDisplay,
  useApiFormError,
  useToast,
} from "~/contexts/ToastContext";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import {
  useRefreshAfterWrite,
  type RefreshAfterWrite,
} from "~/lib/hooks/use-refresh-after-write";
import { createLogger } from "~/lib/logger";
import {
  formatDate,
  berlinTodayISO,
  parseISODate,
  toISODate,
} from "~/lib/date-helpers";
import { staffAbsenceService, type StaffAbsenceRow } from "~/lib/staff-api";
import {
  useReadDraftLoadError,
  useSwrResourceLoadError,
} from "~/lib/hooks/use-swr-load-error";
import { useDraftOn } from "~/lib/swr/read-draft";
import {
  revalidateOrThrow,
  useSWRAuth,
  useTenantMutate,
  useTenantMutateMatching,
} from "~/lib/swr";
import { staffAbsenceKeys } from "~/lib/swr/staff-keys";
import {
  VERTRETUNG_GAPS_KEY_PREFIX,
  VERTRETUNG_WEEK_KEY_PREFIX,
} from "~/lib/timetable-helpers";
import {
  absenceTypeService,
  type AbsenceType,
  type AbsenceTypeAllowanceSummary,
} from "~/lib/absence-type-api";
import { InsetPanel } from "~/components/ui/inset-panel";
import { SectionLabel } from "~/components/ui/section-label";
import type * as sharedContract from "~/lib/contract/shared.generated";

const logger = createLogger({ component: "AbwesenheitenTab" });

const VACATION_WORKFLOW_STATUSES = new Set([
  "requested",
  "question",
  "approved",
  "declined",
  "canceled",
]);

const ONE_DECIMAL_INPUT_PATTERN = /^[+-]?(?:\d+(?:[,.]\d)?|[,.]\d)$/;

function parseOneDecimalInput(value: string): number | null {
  const normalized = value.trim();
  if (!ONE_DECIMAL_INPUT_PATTERN.test(normalized)) return null;
  const parsed = Number(normalized.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatRange(start: string, end: string): string {
  return formatAbsenceRange(start, end);
}

function dayCountFor(row: StaffAbsenceRow): number {
  return sharedDayCountFor({
    workingDays: row.working_days,
    dateStart: row.date_start,
    dateEnd: row.date_end,
    halfDay: row.half_day,
    startHalfDay: row.start_half_day,
    endHalfDay: row.end_half_day,
    hasBoundaryFields:
      row.start_half_day !== undefined || row.end_half_day !== undefined,
  });
}

function statusMeta(status: string) {
  return absenceStatusMeta(status);
}

function pendingAbsences(
  absences: readonly StaffAbsenceRow[],
): StaffAbsenceRow[] {
  return absences.filter(
    (absence) =>
      absence.status === "requested" || absence.status === "question",
  );
}

function upcomingAbsences(
  absences: readonly StaffAbsenceRow[],
  today: string,
): StaffAbsenceRow[] {
  return absences.filter(
    (absence) =>
      (absence.status === "approved" || absence.status === "reported") &&
      absence.date_end >= today,
  );
}

function historicalAbsences(
  absences: readonly StaffAbsenceRow[],
  today: string,
): StaffAbsenceRow[] {
  return absences
    .filter(
      (absence) =>
        absence.status === "declined" ||
        absence.status === "canceled" ||
        ((absence.status === "approved" || absence.status === "reported") &&
          absence.date_end < today),
    )
    .sort((left, right) => (left.date_start < right.date_start ? 1 : -1));
}

export function isVacationWorkflowAbsence(row: StaffAbsenceRow): boolean {
  return (
    row.absence_type === "vacation" &&
    VACATION_WORKFLOW_STATUSES.has(row.status)
  );
}

function TabLoadingBoundary({
  loading,
  children,
}: {
  readonly loading: boolean;
  readonly children: ReactNode;
}) {
  if (loading) {
    return (
      <SkeletonRegion
        label="Abwesenheiten werden geladen"
        className="space-y-5"
      >
        <CardGridSkeleton
          cards={4}
          rowsPerCard={1}
          className="grid grid-cols-2 gap-4 sm:grid-cols-4"
        />
        <ListSkeleton rows={5} avatar={false} />
      </SkeletonRegion>
    );
  }
  return children;
}

interface ShownYear {
  readonly staffId: string;
  readonly year: number;
  readonly quota: sharedContract.VacationQuotaSummary;
  readonly absences: readonly StaffAbsenceRow[];
  readonly types: readonly AbsenceType[];
  readonly allowances: readonly CustomAllowance[];
}

interface CustomAllowance {
  readonly type: AbsenceType;
  readonly summary: AbsenceTypeAllowanceSummary;
}

const NO_TYPES: readonly AbsenceType[] = [];
const NO_ABSENCES: readonly StaffAbsenceRow[] = [];
const NO_ALLOWANCES: readonly CustomAllowance[] = [];

async function loadAllowances(
  staffId: string,
  year: number,
  types: readonly AbsenceType[],
): Promise<readonly CustomAllowance[]> {
  const summaries = await Promise.all(
    types.map((type) =>
      absenceTypeService.getAllowance(type.id, staffId, year),
    ),
  );
  return types.map((type, index) => ({ type, summary: summaries[index]! }));
}

export function AbwesenheitenTab({
  staffId,
  canEdit,
  canEditQuota,
  canManageSickReports,
  staff,
}: {
  readonly staffId: string;
  readonly canEdit: boolean;
  // Der Anspruch hängt an einer eigenen Berechtigung: PUT
  // /api/staff/{id}/vacation/quota verlangt time_tracking:manage, nicht die
  // Antragsentscheidung (vacation:approve darf nur lesen, #2906).
  readonly canEditQuota: boolean;
  readonly canManageSickReports: boolean;
  // Passed in from the staff detail page so the booking and sick-report
  // dialogs have the person's name. Optional so the tab still renders
  // (without those actions) where the staff object is not available (#1843).
  readonly staff?: SickReportStaff;
}) {
  const toast = useToast();
  const today = useBerlinToday();
  const currentYear = Number.parseInt(today.slice(0, 4), 10);
  // Ein Jahr für alle Kontingente und die Listen darunter (#3256): im
  // Dezember lässt sich so der Anspruch fürs nächste Jahr eintragen.
  const [year, setYear] = useState(currentYear);
  // Welche Kontingent-Karte gerade bearbeitet wird: "vacation" oder die ID
  // der eigenen Art (BAUARTEN-SPEC Bauart 2 Regel 3, #3119).
  const [editing, setEditing] = useState<string | null>(null);
  const [bookingOpen, setBookingOpen] = useState(false);
  // Art ändern (#3258): erst Einträge in der Historie ankreuzen, dann den
  // Dialog öffnen. `null` heißt: kein Auswahlmodus.
  const [rebookSelection, setRebookSelection] =
    useState<ReadonlySet<string> | null>(null);
  const [rebookOpen, setRebookOpen] = useState(false);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [denyModal, setDenyModal] = useState<StaffAbsenceRow | null>(null);
  const [questionModal, setQuestionModal] = useState<StaffAbsenceRow | null>(
    null,
  );
  const [openingModal, setOpeningModal] = useState(false);
  // Vacation takeover deletion (#2132) runs through the shared
  // ConfirmDeleteModal at tab level instead of nesting a dialog inside the
  // takeover modal.
  const [openingDeleteTarget, setOpeningDeleteTarget] =
    useState<sharedContract.StaffVacationOpening | null>(null);
  // Snapshot of the staff identity taken when the modal opens: the live
  // `staff` prop can flip to undefined while onCreated's cache invalidation
  // refetches the page data, and a conditional `{staff && <Modal/>}` render
  // would then unmount the modal mid-success-state (#1843).
  const [sickStaff, setSickStaff] = useState<SickReportStaff | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StaffAbsenceRow | null>(
    null,
  );
  const [deleteLoading, setDeleteLoading] = useState(false);
  const deleteErrors = useApiFormError();
  const { show: showActionError } = useApiErrorDisplay();
  // Page-level tab badge SWR (staff-pending-absences-${staffId}) lives
  // outside this component and otherwise stays stale after approvals,
  // denials and stornos.
  const refreshPendingBadges = useTenantMutateMatching([
    "staff-pending-absences-",
  ]);

  // A sick report / its deletion cascades into the Dienst- and
  // Vertretungsplan, so revalidate those caches alongside the local reload.
  const refreshPlanCaches = useTenantMutateMatching([
    "dienstplan-overview-",
    "dienstplan-shifts-",
    VERTRETUNG_WEEK_KEY_PREFIX,
    VERTRETUNG_GAPS_KEY_PREFIX,
  ]);

  const tenantMutate = useTenantMutate();
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const refreshBadges = useCallback(() => {
    void refreshPendingBadges();
    // Sidebar pending counter (#1419) listens for this event.
    dispatchAbsencesRefresh();
  }, [refreshPendingBadges]);
  const quotaResource = useSWRAuth(
    staffAbsenceKeys.vacationQuota(staffId, year),
    () => staffAbsenceService.getVacationQuota(staffId, year),
    { keepPreviousData: false },
  );
  const absencesResource = useSWRAuth(
    staffAbsenceKeys.list(staffId, yearStart, yearEnd),
    () => staffAbsenceService.getAbsences(staffId, yearStart, yearEnd),
    { keepPreviousData: false },
  );
  // Die Arten braucht nur, wer Abwesenheiten eintragen kann (#1843).
  const typesResource = useSWRAuth(
    staff ? staffAbsenceKeys.types() : null,
    () => absenceTypeService.getAbsenceTypes(),
  );
  const loadedTypes = staff ? typesResource.data : NO_TYPES;
  const allowanceTypes = useMemo(
    () => loadedTypes?.filter((type) => type.allowanceEnabled),
    [loadedTypes],
  );
  const allowancesResource = useSWRAuth(
    allowanceTypes
      ? staffAbsenceKeys.allowances(
          staffId,
          year,
          allowanceTypes.map((type) => type.id),
        )
      : null,
    () => loadAllowances(staffId, year, allowanceTypes ?? []),
    { keepPreviousData: false },
  );
  const resources = [
    quotaResource,
    absencesResource,
    staff ? typesResource : { data: NO_TYPES },
    allowanceTypes ? allowancesResource : { data: undefined },
  ];
  const load = useSwrResourceLoadError(
    resources,
    "die Übersicht der Abwesenheiten",
    () =>
      Promise.all([
        quotaResource.mutate(),
        absencesResource.mutate(),
        staff ? typesResource.mutate() : undefined,
        allowancesResource.mutate(),
      ]),
  );
  const loadFailed = Boolean(load.failure);

  // Die Zahlen eines Jahres bleiben stehen, bis das gewählte Jahr ganz
  // geladen ist: ein Jahreswechsel lädt still nach, der Reiter bleibt stehen.
  // Scheitert das Laden für ein anderes Jahr, wären die angezeigten Zahlen
  // falsch; dann steht nur der Fehler da.
  const [shown, setShown] = useState<ShownYear | null>(null);
  if (
    quotaResource.data &&
    absencesResource.data &&
    loadedTypes &&
    allowancesResource.data &&
    (shown?.staffId !== staffId ||
      shown.year !== year ||
      shown.quota !== quotaResource.data ||
      shown.absences !== absencesResource.data ||
      shown.types !== loadedTypes ||
      shown.allowances !== allowancesResource.data)
  ) {
    setShown({
      staffId,
      year,
      quota: quotaResource.data,
      absences: absencesResource.data,
      types: loadedTypes,
      allowances: allowancesResource.data,
    });
  }
  const current = shown?.staffId === staffId ? shown : null;
  const loadedYear = current?.year ?? null;
  const quota = current?.quota ?? null;
  const absences = current?.absences ?? NO_ABSENCES;
  const absenceTypes = current?.types ?? NO_TYPES;
  const customAllowances = current?.allowances ?? NO_ALLOWANCES;
  const loading = current === null && !loadFailed;

  // The quota form's read (ADR 0311): reads again and rejects on failure,
  // and takes the stored claim a save answered.
  const quotaRead = useMemo(
    () => ({
      reload: () => revalidateOrThrow(quotaResource),
      write: (stored: sharedContract.VacationQuotaSummary) =>
        quotaResource.mutate(stored, { revalidate: false }),
    }),
    [quotaResource],
  );

  // The read of one own claim (ADR 0311): reads the claims again and rejects
  // on failure, and takes the stored claim a save answered.
  const allowanceRead = useCallback(
    (typeId: string) => ({
      reload: async () =>
        (await revalidateOrThrow(allowancesResource)).find(
          (entry) => entry.type.id === typeId,
        )?.summary,
      write: (stored: AbsenceTypeAllowanceSummary) =>
        allowancesResource.mutate(
          (entries) =>
            entries?.map((entry) =>
              entry.type.id === typeId ? { ...entry, summary: stored } : entry,
            ),
          { revalidate: false },
        ),
    }),
    [allowancesResource],
  );

  // The reload after a write fetches anew and rejects on failure, so
  // useRefreshAfterWrite can say that the change is saved (#6652).
  const reload = useCallback(async () => {
    const reloadTypes = async () => {
      if (!staff) return NO_TYPES;
      const fresh = (await tenantMutate(
        staffAbsenceKeys.types(),
        absenceTypeService.getAbsenceTypes(),
        { revalidate: false },
      )) as AbsenceType[] | undefined;
      const types = fresh ?? [];
      const withAllowance = types.filter((type) => type.allowanceEnabled);
      await tenantMutate(
        staffAbsenceKeys.allowances(
          staffId,
          year,
          withAllowance.map((type) => type.id),
        ),
        loadAllowances(staffId, year, withAllowance),
        { revalidate: false },
      );
      return types;
    };
    await Promise.all([
      tenantMutate(
        staffAbsenceKeys.vacationQuota(staffId, year),
        staffAbsenceService.getVacationQuota(staffId, year),
        { revalidate: false },
      ),
      tenantMutate(
        staffAbsenceKeys.list(staffId, yearStart, yearEnd),
        staffAbsenceService.getAbsences(staffId, yearStart, yearEnd),
        { revalidate: false },
      ),
      staff
        ? reloadTypes()
        : tenantMutate(
            staffAbsenceKeys.allowances(staffId, year, []),
            loadAllowances(staffId, year, []),
            { revalidate: false },
          ),
    ]);
    refreshBadges();
  }, [refreshBadges, staff, staffId, tenantMutate, year, yearEnd, yearStart]);
  // A write's reload runs after the write; its failure stands above the tab
  // as a load error, never as an error of the write or its closed dialog
  // (#6652).
  const afterWrite = useRefreshAfterWrite(
    "die Anzeige der Abwesenheiten",
    async (options: { silent?: boolean; planCaches?: boolean } = {}) => {
      await Promise.all([
        reload(),
        options.planCaches ? refreshPlanCaches() : undefined,
      ]);
    },
  );

  const pending = useMemo(() => pendingAbsences(absences), [absences]);
  const upcoming = useMemo(
    () => upcomingAbsences(absences, today),
    [absences, today],
  );
  const history = useMemo(
    () => historicalAbsences(absences, today),
    [absences, today],
  );
  const canRebook =
    canManageSickReports &&
    staff !== undefined &&
    history.some(isRebookableAbsence);
  const selectedForRebook = useMemo(
    () =>
      rebookSelection
        ? history.filter((row) => rebookSelection.has(row.id))
        : [],
    [history, rebookSelection],
  );
  const toggleRebook = (id: string) =>
    setRebookSelection((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleApprove = async (row: StaffAbsenceRow) => {
    setPendingActionId(row.id);
    try {
      await staffAbsenceService.approve(row.id);
    } catch (err) {
      logger.error("absence_approve_failed", {
        absence_id: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
      void showActionError(err, {
        object: "die Anfrage",
        retry: () => void handleApprove(row),
      });
      setPendingActionId(null);
      return;
    }
    setPendingActionId(null);
    toast.success("Der Antrag ist genehmigt.");
    await afterWrite.refresh();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    deleteErrors.clear();
    try {
      await staffAbsenceService.deleteAbsence(staffId, deleteTarget.id);
    } catch (err) {
      logger.error("absence_delete_failed", {
        absence_id: deleteTarget.id,
        error: err instanceof Error ? err.message : String(err),
      });
      await deleteErrors.show(err, {
        object: "die Abwesenheit",
        retry: () => void handleDelete(),
      });
      setDeleteLoading(false);
      return;
    }
    setDeleteLoading(false);
    toast.success(`${absenceRowActionNoun(deleteTarget)} ist gelöscht.`);
    setDeleteTarget(null);
    await afterWrite.refresh({ planCaches: true });
  };

  const afterBooking = () =>
    afterWrite.refresh({ silent: true, planCaches: true });

  const content = (
    <div className="space-y-5">
      <SectionCard
        title="Kontingente"
        headingLevel={3}
        description="Wie viele Tage diese Person je Art hat und noch übrig sind."
        actions={
          canManageSickReports && staff ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={() => setBookingOpen(true)}
                tooltip="Öffnet ein Formular, um eine Abwesenheit ohne Antrag einzutragen."
              >
                <CalendarPlus className="mr-1.5 h-4 w-4" aria-hidden />
                Abwesenheit eintragen
              </Button>
              <Button
                type="button"
                variant="outline"
                size="md"
                onClick={() => setSickStaff(staff)}
                tooltip="Öffnet die Krankmeldung, sie passt Dienst- und Betreuungsplan an."
              >
                <Thermometer className="mr-1.5 h-4 w-4" aria-hidden />
                Krank melden
              </Button>
            </div>
          ) : undefined
        }
        bodyClassName="mt-4 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SegmentedControl
            ariaLabel="Kalenderjahr"
            items={[currentYear - 1, currentYear, currentYear + 1].map(
              (value) => ({ value: String(value), label: String(value) }),
            )}
            value={String(year)}
            onChange={(value) => {
              setEditing(null);
              setRebookSelection(null);
              setYear(Number(value));
            }}
          />
          {canEditQuota ? (
            <CatalogManageLink
              href="/database/absence-types"
              label="Abwesenheitsarten verwalten"
            />
          ) : null}
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <AllowanceCard
            title="Urlaub"
            year={year}
            entitled={
              (quota?.entitled_days ?? 0) + (quota?.carryover_days ?? 0)
            }
            entitledHint={
              (quota?.carryover_days ?? 0) > 0
                ? `${formatNumber(quota?.entitled_days ?? 0)} + ${formatNumber(quota?.carryover_days ?? 0)} aus dem Vorjahr`
                : undefined
            }
            taken={(quota?.taken_days ?? 0) + (quota?.taken_before_days ?? 0)}
            takenHint={
              (quota?.taken_before_days ?? 0) > 0
                ? `davon ${formatDayCount(quota?.taken_before_days ?? 0)} vor moto`
                : undefined
            }
            reserved={quota?.reserved_days ?? 0}
            remaining={quota?.remaining_days ?? 0}
            onEdit={
              canEditQuota && quota ? () => setEditing("vacation") : undefined
            }
            extraAction={
              canManageSickReports && quota ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="compact"
                  onClick={() => setOpeningModal(true)}
                  tooltip="Öffnet den Resturlaub, der beim Start mit moto übrig war."
                >
                  <CalendarClock className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  Urlaubs-Übernahme
                </Button>
              ) : null
            }
            editForm={
              editing === "vacation" && quota ? (
                <QuotaEditForm
                  staffId={staffId}
                  quota={quota}
                  year={year}
                  read={quotaRead}
                  onCancel={() => setEditing(null)}
                  onSaved={() => {
                    setEditing(null);
                    return afterWrite.refresh({ silent: true });
                  }}
                />
              ) : null
            }
            footer={
              quota?.opening ? (
                <VacationOpeningSummary opening={quota.opening} />
              ) : null
            }
          />
          {customAllowances.map((entry) => (
            <AllowanceCard
              key={entry.type.id}
              title={entry.type.name}
              year={year}
              retired={!entry.type.isActive}
              entitled={entry.summary.entitledDays}
              // Den Anspruch einer Person mit Personalakte legt der Träger
              // fest, über alle ihre Schulen (#4710).
              entitledHint={
                entry.summary.keptByTraeger
                  ? "vom Träger, alle Schulen"
                  : undefined
              }
              taken={entry.summary.takenDays}
              reserved={entry.summary.reservedDays}
              remaining={entry.summary.remainingDays}
              footer={<AllowanceExpiryNote summary={entry.summary} />}
              onEdit={
                canEditQuota && !entry.summary.keptByTraeger
                  ? () => setEditing(entry.type.id)
                  : undefined
              }
              editForm={
                editing === entry.type.id ? (
                  <CustomAllowanceEditForm
                    staffId={staffId}
                    year={year}
                    type={entry.type}
                    summary={entry.summary}
                    read={allowanceRead(entry.type.id)}
                    onCancel={() => setEditing(null)}
                    onSaved={() => {
                      setEditing(null);
                      return afterWrite.refresh({ silent: true });
                    }}
                  />
                ) : null
              }
            />
          ))}
        </div>
        {staff && canEditQuota && customAllowances.length === 0 ? (
          <p className="text-sm text-gray-500">
            Regenerationstage oder Krank-Urlaubstage zählen? Lege dafür unter
            „Abwesenheitsarten verwalten“ eine Art mit Kontingent an.
          </p>
        ) : null}
      </SectionCard>

      <PendingAbsences
        rows={pending}
        canEdit={canEdit}
        pendingActionId={pendingActionId}
        onApprove={handleApprove}
        onDeny={setDenyModal}
        onQuestion={setQuestionModal}
      />

      {/* Upcoming approved absences */}
      <SectionCard
        title="Kommende Abwesenheiten"
        headingLevel={3}
        description="Andere Stunden in den Ferien? Trage dafür eine Sonderarbeitszeit im Reiter Arbeitszeitmodell ein."
      >
        {upcoming.length === 0 ? (
          <EmptyState title="Keine geplanten Abwesenheiten." />
        ) : (
          <ul className="space-y-2">
            {upcoming.map((row) => (
              <AbsenceRow
                key={row.id}
                row={row}
                onDelete={
                  canManageSickReports && !isVacationWorkflowAbsence(row)
                    ? () => setDeleteTarget(row)
                    : undefined
                }
              />
            ))}
          </ul>
        )}
      </SectionCard>

      {/* Past history */}
      <SectionCard
        title={`Historie ${year}`}
        headingLevel={3}
        description={
          rebookSelection
            ? "Kreuze die Einträge an, deren Art sich ändern soll. Krankmeldungen und Anträge lassen sich hier nicht ändern."
            : undefined
        }
        actions={
          canRebook && !rebookSelection ? (
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={() => setRebookSelection(new Set())}
              tooltip="Lässt dich Einträge ankreuzen, um ihre Art zu ändern."
            >
              <ArrowLeftRight className="mr-1.5 h-4 w-4" aria-hidden />
              Art ändern
            </Button>
          ) : undefined
        }
        bodyClassName="mt-4 space-y-3"
      >
        {rebookSelection ? (
          <InsetPanel
            padding="compact"
            className="flex flex-wrap items-center justify-between gap-2"
          >
            <span className="text-sm text-gray-700">
              {rebookSelection.size === 1
                ? "1 Eintrag gewählt"
                : `${rebookSelection.size} Einträge gewählt`}
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="md"
                onClick={() => setRebookSelection(null)}
                noTooltip="Abbrechen beendet die Auswahl, ohne etwas zu ändern."
              >
                Abbrechen
              </Button>
              <Button
                type="button"
                variant="primary"
                size="md"
                disabled={selectedForRebook.length === 0}
                disabledReason="Kreuze zuerst mindestens einen Eintrag an."
                onClick={() => setRebookOpen(true)}
                tooltip="Öffnet die Wahl der neuen Art und zeigt die Folgen vorher."
              >
                Weiter
              </Button>
            </div>
          </InsetPanel>
        ) : null}
        {history.length === 0 ? (
          <EmptyState title="Keine vergangenen oder abgelehnten Abwesenheiten." />
        ) : (
          <ul className="space-y-2">
            {(rebookSelection ? history : history.slice(0, 20)).map((row) => (
              <AbsenceRow
                key={row.id}
                row={row}
                selection={
                  rebookSelection && isRebookableAbsence(row)
                    ? {
                        checked: rebookSelection.has(row.id),
                        onToggle: () => toggleRebook(row.id),
                      }
                    : undefined
                }
                onDelete={
                  canManageSickReports &&
                  !rebookSelection &&
                  !isVacationWorkflowAbsence(row)
                    ? () => setDeleteTarget(row)
                    : undefined
                }
              />
            ))}
          </ul>
        )}
      </SectionCard>

      {/* Modals */}
      {sickStaff && (
        <SickReportModal
          isOpen
          staff={sickStaff}
          targetHint={
            canManageSickReports ? { canSetTarget: canEdit } : undefined
          }
          onClose={() => setSickStaff(null)}
          onCreated={() =>
            void afterWrite.refresh({ silent: true, planCaches: true })
          }
        />
      )}
      <ConfirmDeleteModal
        isOpen={deleteTarget !== null}
        title={`${deleteTarget ? absenceRowActionNoun(deleteTarget) : "Abwesenheit"} löschen`}
        description={
          <>
            Die Abwesenheit{" "}
            <strong>
              {deleteTarget
                ? formatRange(deleteTarget.date_start, deleteTarget.date_end)
                : ""}
            </strong>{" "}
            wird gelöscht.
            {deleteTarget?.absence_type === "sick" && (
              <>
                {" "}
                Stornierte Schichten und als abwesend markierte Betreuungsblöcke
                werden wiederhergestellt, sofern noch kein Ersatz eingetragen
                wurde.
              </>
            )}
          </>
        }
        gate={{ mode: "twoStep" }}
        loading={deleteLoading}
        error={deleteErrors.error}
        confirmLabel="Löschen"
        loadingLabel="Wird gelöscht…"
        onConfirm={handleDelete}
        onClose={() => {
          deleteErrors.clear();
          setDeleteTarget(null);
        }}
      />
      {denyModal && (
        <DenyAbsenceModal
          absence={denyModal}
          onClose={() => setDenyModal(null)}
          onDenied={() => {
            setDenyModal(null);
            return afterWrite.refresh();
          }}
        />
      )}
      {questionModal && (
        <QuestionAbsenceModal
          absence={questionModal}
          onClose={() => setQuestionModal(null)}
          onQuestioned={() => {
            setQuestionModal(null);
            return afterWrite.refresh();
          }}
        />
      )}
      {openingDeleteTarget && (
        <VacationOpeningDeleteModal
          staffId={staffId}
          opening={openingDeleteTarget}
          onClose={() => setOpeningDeleteTarget(null)}
          onDeleted={() => {
            setOpeningDeleteTarget(null);
            return afterWrite.refresh();
          }}
        />
      )}
      {openingModal && quota && (
        <VacationOpeningModal
          staffId={staffId}
          year={year}
          quota={quota}
          onClose={() => setOpeningModal(false)}
          onDelete={(opening) => {
            setOpeningModal(false);
            setOpeningDeleteTarget(opening);
          }}
          onSaved={() => {
            setOpeningModal(false);
            return afterWrite.refresh();
          }}
        />
      )}
      {rebookOpen && staff && selectedForRebook.length > 0 ? (
        <AbsenceRebookModal
          staff={staff}
          types={absenceTypes}
          absences={selectedForRebook}
          onClose={() => setRebookOpen(false)}
          onSaved={() => {
            setRebookOpen(false);
            setRebookSelection(null);
            return afterBooking();
          }}
        />
      ) : null}
      {bookingOpen && staff ? (
        <AbsenceBookingModal
          staff={staff}
          types={absenceTypes}
          targetHint={
            canManageSickReports ? { canSetTarget: canEdit } : undefined
          }
          onClose={() => setBookingOpen(false)}
          onSaved={() => {
            setBookingOpen(false);
            return afterBooking();
          }}
        />
      ) : null}
    </div>
  );

  const loadAlert = (
    <>
      <LoadErrorAlert error={load.error} />
      <LoadErrorAlert error={afterWrite.error} />
    </>
  );
  // Gehören die angezeigten Zahlen zu einem anderen Jahr (oder gab es noch
  // keine), steht nur der Fehler da, nie ein falscher oder leerer Stand.
  const body =
    loadFailed && loadedYear !== year ? (
      <div className="space-y-5">
        {loadedYear !== null ? (
          <SegmentedControl
            ariaLabel="Kalenderjahr"
            items={[currentYear - 1, currentYear, currentYear + 1].map(
              (value) => ({ value: String(value), label: String(value) }),
            )}
            value={String(year)}
            onChange={(value) => setYear(Number(value))}
          />
        ) : null}
        {loadAlert}
      </div>
    ) : (
      <div className="space-y-5">
        {loadAlert}
        {content}
      </div>
    );

  return <TabLoadingBoundary loading={loading}>{body}</TabLoadingBoundary>;
}

function formatNumber(days: number): string {
  return String(Math.round(days * 10) / 10).replace(".", ",");
}

// Deletion of a vacation takeover (#2132). Own component so the tab renders
// it as a plain `{target && <Modal/>}` branch: target, loading and error state
// belong to the dialog, not to the tab.
function VacationOpeningDeleteModal({
  staffId,
  opening,
  onClose,
  onDeleted,
}: {
  readonly staffId: string;
  readonly opening: sharedContract.StaffVacationOpening;
  readonly onClose: () => void;
  /** Closes the dialog and reloads; never rejects (#6652). */
  readonly onDeleted: RefreshAfterWrite;
}) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const formErrors = useApiFormError();

  const handleConfirm = async () => {
    setLoading(true);
    formErrors.clear();
    try {
      await staffAbsenceService.deleteVacationOpening(staffId, opening.year);
      toast.success("Die Urlaubs-Übernahme ist gelöscht.");
    } catch (err) {
      logger.error("vacation_opening_delete_failed", {
        staff_id: staffId,
        error: err instanceof Error ? err.message : String(err),
      });
      await formErrors.show(err, {
        object: "die Urlaubs-Übernahme",
        retry: () => void handleConfirm(),
      });
      setLoading(false);
      return;
    }
    setLoading(false);
    await onDeleted();
  };

  return (
    <ConfirmDeleteModal
      isOpen
      title="Urlaubs-Übernahme löschen"
      description={
        <>
          Die Übernahme zum Stichtag{" "}
          <strong>{formatDate(opening.effective_date)}</strong> wird gelöscht.
          Der Resturlaub steigt dadurch wieder um{" "}
          {formatDayCount(opening.taken_before_days)}.
        </>
      }
      gate={{ mode: "twoStep" }}
      loading={loading}
      error={formErrors.error}
      confirmLabel="Löschen"
      loadingLabel="Wird gelöscht…"
      onConfirm={handleConfirm}
      onClose={onClose}
    />
  );
}

function PendingAbsences({
  rows,
  canEdit,
  pendingActionId,
  onApprove,
  onDeny,
  onQuestion,
}: {
  readonly rows: StaffAbsenceRow[];
  readonly canEdit: boolean;
  readonly pendingActionId: string | null;
  readonly onApprove: (row: StaffAbsenceRow) => Promise<void>;
  readonly onDeny: (row: StaffAbsenceRow) => void;
  readonly onQuestion: (row: StaffAbsenceRow) => void;
}) {
  if (rows.length === 0) {
    return (
      <SectionCard>
        <EmptyState
          variant="compact"
          tone="success"
          icon={<Check aria-hidden />}
          title="Keine offenen Anfragen"
          description="Alles bearbeitet."
          className="py-0"
        />
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Eingehende Anfragen"
      headingLevel={3}
      // Neutral, nicht rot: StatusBadge tone="red" loest auf dasselbe Tripel
      // auf wie StatusColorBadge(LOCATION_COLORS.SICK), und direkt darunter
      // stehen die "Krank"-Typpillen der Zeilen. Ein Zaehler offener Anfragen
      // ist ausserdem keine Fehlermeldung.
      titleBadge={<StatusBadge tone="gray" label={String(rows.length)} />}
    >
      <ul className="divide-y divide-gray-100">
        {rows.map((row) => (
          <AbsenceRequestRow
            key={row.id}
            row={row}
            isBusy={pendingActionId === row.id}
            showActions={canEdit}
            onApprove={(r) => {
              onApprove(r);
            }}
            onDeny={onDeny}
            onQuestion={onQuestion}
          />
        ))}
      </ul>
    </SectionCard>
  );
}

// Generic notes that duplicate the type badge get suppressed, admins seeded
// "Urlaub" or "Krankmeldung" as boilerplate, and rendering them next to the
// already-visible type badge is just noise.
const REDUNDANT_NOTES: Record<string, ReadonlyArray<string>> = {
  sick: ["krank", "krankheit", "krankmeldung", "au", "au-bescheinigung"],
  vacation: ["urlaub", "erholungsurlaub"],
  training: ["fortbildung", "schulung"],
  other: ["abwesend", "sonstige", "sonstiges"],
};

function isRedundantNote(absenceType: string, note: string): boolean {
  const normalized = note.trim().toLowerCase();
  if (!normalized) return true;
  const typeLabel = (ABSENCE_TYPE_LABEL[absenceType] ?? "").toLowerCase();
  if (normalized === typeLabel) return true;
  return (REDUNDANT_NOTES[absenceType] ?? []).includes(normalized);
}

function AbsenceRow({
  row,
  onDelete,
  selection,
}: {
  readonly row: StaffAbsenceRow;
  // Delete action for admin-entered absences (status "reported"), e.g. a sick
  // report whose plan cascade can be undone. Omitted for read-only rows.
  readonly onDelete?: () => void;
  // Häkchen im Auswahlmodus „Art ändern" (#3258).
  readonly selection?: { checked: boolean; onToggle: () => void };
}) {
  const meta = statusMeta(row.status);
  const showNote = row.note && !isRedundantNote(row.absence_type, row.note);
  const canDelete = onDelete && row.status === "reported";
  return (
    <li className="moto-content-surface flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3">
      {selection ? (
        <label className="flex cursor-pointer items-center">
          <Checkbox checked={selection.checked} onChange={selection.onToggle} />
          <span className="sr-only">
            {`${absenceRowLabel(row)} ${formatRange(row.date_start, row.date_end)} auswählen`}
          </span>
        </label>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <StatusColorBadge
            label={absenceRowLabel(row)}
            color={
              ABSENCE_TYPE_HEX[row.absence_type] ?? LOCATION_COLORS.UNKNOWN
            }
          />
          <p className="text-sm font-medium text-gray-800">
            {formatRange(row.date_start, row.date_end)}
            <span className="ml-2 text-xs text-gray-500">
              · {formatDayCount(dayCountFor(row))}
            </span>
          </p>
        </div>
        {showNote && (
          <p className="mt-0.5 truncate text-xs text-gray-500">{row.note}</p>
        )}
        {row.decision_note && (
          <p className="mt-0.5 text-xs text-gray-500">
            <span className="font-medium">Anmerkung Leitung:</span>{" "}
            {row.decision_note}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <StatusColorBadge label={meta.label} color={meta.color} />
        {canDelete && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onDelete}
            aria-label={`${absenceRowActionNoun(row)} ${formatRange(row.date_start, row.date_end)} löschen`}
            tooltip="Löscht diesen Eintrag. moto fragt vorher nach."
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </div>
    </li>
  );
}

// Dezente Zeile unter den Quota-Kacheln: macht sichtbar, dass ein Teil des
// Jahresanspruchs bereits vor der moto-Einführung verbraucht war (#2132).
function VacationOpeningSummary({
  opening,
}: {
  readonly opening: sharedContract.StaffVacationOpening;
}) {
  return (
    <InsetPanel
      framed
      padding="compact"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-600"
    >
      <SectionLabel as="p">Übernahme</SectionLabel>
      <span className="tabular-nums">
        {formatDayCount(opening.taken_before_days)} vor Einführung genommen
      </span>
      <span className="text-gray-500">·</span>
      <span>Stichtag {formatDate(opening.effective_date)}</span>
    </InsetPanel>
  );
}

function previousDayISO(dateKey: string): string {
  const date = parseISODate(dateKey);
  date.setDate(date.getDate() - 1);
  return toISODate(date);
}

// Urlaubs-Übernahme zum Go-live-Stichtag (#2132). Der Admin trägt den
// Resturlaub zum Stichtag ein, der Server leitet daraus die vorher genommenen
// Tage ab (Anspruch + Übertrag − Rest). Existiert die Übernahme bereits, zeigt
// das Modal nur noch den gebuchten Stand: Korrekturen laufen über Löschen und
// neu anlegen, damit die Historie erhalten bleibt.
function VacationOpeningModal({
  staffId,
  year,
  quota,
  onClose,
  onDelete,
  onSaved,
}: {
  readonly staffId: string;
  readonly year: number;
  readonly quota: sharedContract.VacationQuotaSummary;
  readonly onClose: () => void;
  readonly onDelete: (opening: sharedContract.StaffVacationOpening) => void;
  /** Closes the form and reloads; never rejects (#6652). */
  readonly onSaved: RefreshAfterWrite;
}) {
  const existing = quota.opening ?? null;
  const [effectiveDate, setEffectiveDate] = useState("");
  const [remainingDays, setRemainingDays] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const formErrors = useApiFormError();
  const toast = useToast();
  // „Wiederholen“ sendet den aktuellen Entwurf, nicht den vom Fehlerzeitpunkt.
  const latestSubmitRef = useRef<() => Promise<void>>(async () => undefined);

  const yearEndKey = `${year}-12-31`;
  const yesterdayKey = previousDayISO(berlinTodayISO());
  const maxEffectiveDateKey =
    yesterdayKey < yearEndKey ? yesterdayKey : yearEndKey;

  const remaining = parseOneDecimalInput(remainingDays);
  const remainingValid =
    remaining !== null && remaining >= -999 && remaining <= 999;
  const entitledTotal = quota.entitled_days + quota.carryover_days;
  const computedTakenBefore =
    remaining === null ? null : entitledTotal - remaining;

  const handleSubmit = async () => {
    formErrors.clear();
    const fields: Record<string, string> = {};
    if (!effectiveDate) {
      fields.effective_date = "Bitte wähle einen Stichtag.";
    }
    if (remaining === null || remaining < -999 || remaining > 999) {
      fields.remaining_days = REMAINING_RANGE_HINT;
    }
    if (note.trim() === "") {
      fields.note = "Bitte gib eine Begründung ein.";
    }
    if (Object.keys(fields).length > 0 || remaining === null) {
      formErrors.invalid("Bitte prüfe die markierten Felder.", fields);
      return;
    }
    setSubmitting(true);
    try {
      await staffAbsenceService.setVacationOpening(staffId, {
        effectiveDate,
        remainingDays: remaining,
        note: note.trim(),
      });
      toast.success("Die Urlaubs-Übernahme ist gespeichert.");
    } catch (err) {
      logger.error("vacation_opening_save_failed", {
        staff_id: staffId,
        error: err instanceof Error ? err.message : String(err),
      });
      await formErrors.show(err, {
        object: "die Urlaubs-Übernahme",
        retry: () => void latestSubmitRef.current(),
      });
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    await onSaved();
  };

  useLayoutEffect(() => {
    latestSubmitRef.current = handleSubmit;
  });

  if (existing) {
    return (
      <Modal
        isOpen
        onClose={onClose}
        title={`Urlaubs-Übernahme ${year}`}
        footer={
          <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={onClose}
              noTooltip="Schließen schließt nur den Dialog."
            >
              Schließen
            </Button>
            <Button
              type="button"
              variant="outline_danger"
              size="md"
              onClick={() => onDelete(existing)}
              tooltip="Löscht die Übernahme für dieses Jahr. moto fragt vorher nach."
            >
              <Trash2 className="mr-1.5 h-4 w-4" aria-hidden />
              Übernahme löschen
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Für dieses Jahr ist bereits eine Übernahme gebucht. Eine Korrektur
            läuft über Löschen und neues Anlegen, damit die Historie
            nachvollziehbar bleibt.
          </p>
          <DataGrid>
            <DataField label="Stichtag">
              {formatDate(existing.effective_date)}
            </DataField>
            <DataField label="Resturlaub zum Stichtag">
              <span className="tabular-nums">
                {formatDayCount(existing.entered_remaining_days)}
              </span>
            </DataField>
            <DataField label="Vor Einführung genommen">
              <span className="tabular-nums">
                {formatDayCount(existing.taken_before_days)}
              </span>
            </DataField>
            {existing.note && (
              <DataField label="Begründung" fullWidth>
                {existing.note}
              </DataField>
            )}
          </DataGrid>
        </div>
      </Modal>
    );
  }

  const canSubmit =
    !submitting && effectiveDate !== "" && remainingValid && note.trim() !== "";
  // Der Grund am gesperrten Knopf; beim Speichern bleibt er nativ gesperrt.
  const submitBlockedReason = submitting
    ? undefined
    : effectiveDate === ""
      ? "Wähle zuerst einen Stichtag."
      : !remainingValid
        ? "Gib zuerst den Resturlaub zum Stichtag ein."
        : note.trim() === ""
          ? "Gib zuerst eine Begründung ein."
          : undefined;

  return (
    <Modal
      isOpen
      onClose={() => !submitting && onClose()}
      title={`Urlaubs-Übernahme ${year}`}
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={onClose}
            disabled={submitting}
            noTooltip="Abbrechen schließt den Dialog, ohne etwas zu ändern."
          >
            Abbrechen
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={handleSubmit}
            disabled={!canSubmit}
            disabledReason={submitBlockedReason}
            tooltip="Speichert den Resturlaub, moto rechnet die vorher genommenen Tage aus."
          >
            {submitting ? "…" : "Übernahme buchen"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <FormErrorAlert message={formErrors.error} />
        <p className="text-sm text-gray-500">
          moto errechnet daraus die vor der Einführung bereits genommenen Tage.
          Der Jahresanspruch bleibt unverändert.
        </p>
        <ISODatePicker
          label="Stichtag"
          id="vacation-opening-date"
          min={`${year}-01-01`}
          max={maxEffectiveDateKey}
          value={effectiveDate}
          onChange={setEffectiveDate}
          calendarLayout="popover"
          hideClearButton
          hint={`Der Stichtag muss im Jahr ${year} und vor dem heutigen Tag liegen.`}
          error={formErrors.fieldError("effective_date")}
        />
        <Input
          label="Resturlaub zum Stichtag (Tage)"
          id="vacation-opening-remaining"
          name="remaining_days"
          type="text"
          inputMode="decimal"
          controlSize="compact"
          value={remainingDays}
          onChange={(e) => setRemainingDays(e.target.value)}
          placeholder="z. B. 12,5"
          error={
            remainingDays.trim() !== "" && !remainingValid
              ? REMAINING_RANGE_HINT
              : formErrors.fieldError("remaining_days")
          }
        />
        <InsetPanel
          padding="compact"
          className="space-y-1 text-sm text-gray-700"
        >
          <p>
            Jahresanspruch inklusive Übertrag:{" "}
            <span className="font-medium tabular-nums">
              {formatDayCount(entitledTotal)}
            </span>
          </p>
          {remainingValid && computedTakenBefore !== null && (
            <p>
              Errechnet vor Einführung genommen:{" "}
              <span className="font-medium tabular-nums">
                {formatDayCount(computedTakenBefore)}
              </span>
            </p>
          )}
          {/* Brand-Orange als lesbare Textstufe (moto-orange-strong) statt
              einer generischen Tailwind-Warnfarbe. */}
          {computedTakenBefore !== null && computedTakenBefore < 0 && (
            <p className="text-moto-orange-strong text-xs">
              Der eingegebene Resturlaub liegt über dem Jahresanspruch. moto
              schreibt die Differenz zusätzlich gut.
            </p>
          )}
        </InsetPanel>
        <Textarea
          label="Begründung (Pflicht)"
          id="vacation-opening-note"
          name="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="z. B. Übernahme aus Urlaubsliste, Stand 31.07."
          error={formErrors.fieldError("note")}
        />
      </div>
    </Modal>
  );
}

const REMAINING_RANGE_HINT =
  "Bitte eine Zahl zwischen -999 und 999 mit höchstens einer Nachkommastelle eingeben.";

const QUOTA_RANGE_ERROR = "Bitte eine Zahl zwischen 0 und 366 eingeben.";

function quotaFieldError(raw: string): string | undefined {
  const value = Number.parseFloat(raw);
  return Number.isNaN(value) || value < 0 || value > 366
    ? QUOTA_RANGE_ERROR
    : undefined;
}

/** The values a stored claim fills the quota form with. */
function quotaDraft(quota: sharedContract.VacationQuotaSummary): QuotaDraft {
  return {
    entitled: String(quota.entitled_days),
    carryover: String(quota.carryover_days),
    reason: "",
  };
}

interface QuotaDraft {
  readonly entitled: string;
  readonly carryover: string;
  readonly reason: string;
}

/**
 * Der Bearbeiten-Zustand des Urlaubsanspruchs (BAUARTEN-SPEC Bauart 2 Regeln
 * 3 bis 5, #3119): an Ort und Stelle der Kennzahl-Kacheln, zwei Felder, ein
 * `EditActions` unten. Fehler stehen im Alert oben und am Feld; der
 * Erfolgs-Toast bleibt. Nur eingehängt, solange bearbeitet wird, deshalb
 * liest der Entwurf seinen Ausgangsstand beim Einhängen aus `quota`.
 */
function QuotaEditForm({
  staffId,
  quota,
  year,
  read,
  onCancel,
  onSaved,
}: {
  readonly staffId: string;
  readonly quota: sharedContract.VacationQuotaSummary;
  readonly year: number;
  /** The tab's read of the claim: reads it again (rejects on failure),
   * takes a stored claim a save answered. */
  readonly read: {
    readonly reload: () => Promise<sharedContract.VacationQuotaSummary>;
    readonly write: (
      stored: sharedContract.VacationQuotaSummary,
    ) => Promise<unknown>;
  };
  readonly onCancel: () => void;
  /** Closes the form and reloads; never rejects (#6652). */
  readonly onSaved: RefreshAfterWrite;
}) {
  // The claim the form opened from (ADR 0311): its version goes out with the
  // save. A newer read refills the form only while nothing is typed; after a
  // refusal the stored claim shows, and nothing is sent until it is read.
  const edit = useDraftOn<
    sharedContract.VacationQuotaSummary,
    QuotaDraft,
    string,
    sharedContract.VacationQuotaSummary
  >(
    {
      opening: `${staffId}:${year}`,
      data: quota,
      reload: read.reload,
      write: read.write,
    },
    {
      token: (claim) => claim.version,
      toDraft: quotaDraft,
      // The reason annotates the change, it is no stored value: it stays
      // over the stored claim a refusal shows.
      rebase: (draft, _from, stored) => ({
        ...quotaDraft(stored),
        reason: draft.reason,
      }),
      answer: (saved) => saved,
    },
  );
  const { entitled, carryover, reason } = edit.draft ?? quotaDraft(quota);
  const set = (patch: Partial<QuotaDraft>) =>
    edit.setDraft((current) => ({ ...current, ...patch }));
  const [saving, setSaving] = useState(false);
  const formErrors = useApiFormError();
  const toast = useToast();
  const loadError = useReadDraftLoadError(edit, "den Urlaubsanspruch");
  // „Wiederholen“ sendet den aktuellen Entwurf, nicht den vom Fehlerzeitpunkt.
  const latestSaveRef = useRef<() => Promise<void>>(async () => undefined);

  const handleSave = async () => {
    // Enter submits too: nothing goes out before the stored claim is read.
    if (!edit.canSubmit) return;
    formErrors.clear();
    const fields: Record<string, string> = {};
    const entitledError = quotaFieldError(entitled);
    const carryoverError = quotaFieldError(carryover);
    if (entitledError) fields.entitled_days = entitledError;
    if (carryoverError) fields.carryover_days = carryoverError;
    if (reason.trim() === "") {
      fields.reason = "Bitte kurz sagen, warum sich der Anspruch ändert.";
    }
    if (Object.keys(fields).length > 0) {
      formErrors.invalid("Bitte prüfe die markierten Felder.", fields);
      return;
    }
    setSaving(true);
    const result = await edit.submit((version, sent) =>
      staffAbsenceService.setVacationQuota(staffId, {
        year,
        entitled_days: Number.parseFloat(sent.entitled),
        carryover_days: Number.parseFloat(sent.carryover),
        reason: sent.reason.trim(),
        expected_version: version,
      }),
    );
    setSaving(false);
    if (!result.ok) {
      logger.error("quota_save_failed", {
        staff_id: staffId,
        error:
          result.error instanceof Error
            ? result.error.message
            : String(result.error),
      });
      // Seit dem Lesen geändert: `reload` zeigt den gespeicherten Stand,
      // ohne „Wiederholen“ mit derselben Version.
      await formErrors.show(result.error, {
        object: "die Änderung am Urlaubsanspruch",
        retry: () => void latestSaveRef.current(),
        reload: result.reload,
      });
      return;
    }
    toast.success("Der Urlaubsanspruch ist gespeichert.");
    await onSaved();
  };

  useLayoutEffect(() => {
    latestSaveRef.current = handleSave;
  });

  return (
    <form
      className="space-y-4"
      noValidate
      aria-label={`Urlaubsanspruch ${year}`}
      onSubmit={(event) => {
        event.preventDefault();
        void handleSave();
      }}
    >
      <FormErrorAlert message={formErrors.error} />
      {/* After a refusal the form's alert already names the failed read. */}
      {edit.status === "loadFailed" && !formErrors.error ? (
        <LoadErrorAlert error={loadError} />
      ) : null}
      <h4 className="text-sm font-semibold text-gray-900">
        Urlaubsanspruch {year}
      </h4>
      <div className="grid gap-3 md:grid-cols-2">
        <Input
          id="quota-entitled"
          name="entitled_days"
          label="Jahresanspruch (Tage)"
          type="number"
          min="0"
          max="366"
          step="0.5"
          controlSize="compact"
          value={entitled}
          onChange={(e) => set({ entitled: e.target.value })}
          error={formErrors.fieldError("entitled_days")}
          disabled={saving}
        />
        <Input
          id="quota-carryover"
          name="carryover_days"
          label="Übertrag aus Vorjahr (Tage)"
          type="number"
          min="0"
          max="366"
          step="0.5"
          controlSize="compact"
          value={carryover}
          onChange={(e) => set({ carryover: e.target.value })}
          error={formErrors.fieldError("carryover_days")}
          disabled={saving}
        />
      </div>
      <Input
        id="quota-reason"
        name="reason"
        label="Begründung"
        controlSize="compact"
        value={reason}
        onChange={(e) => set({ reason: e.target.value })}
        placeholder="z. B. Stellenumfang geändert"
        error={formErrors.fieldError("reason")}
        disabled={saving}
      />
      <EditActions
        onCancel={onCancel}
        saving={saving}
        disabled={!edit.canSubmit}
        disabledReason={
          edit.status === "loadFailed"
            ? "Lade zuerst den gespeicherten Stand neu."
            : "Der gespeicherte Stand wird geladen."
        }
      />
    </form>
  );
}
