"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ArrowUpRightIcon } from "@phosphor-icons/react";

import { Alert } from "~/components/ui/alert";
import { ActionBar } from "~/components/ui/action-bar";
import { Avatar } from "~/components/ui/avatar";
import { Button, ButtonLink } from "~/components/ui/button";
import {
  Collection,
  CollectionGroup,
  CollectionRow,
} from "~/components/ui/collection";
import { OverlaySheet } from "~/components/ui/overlay-sheet";
import { SectionCard } from "~/components/ui/section-card";
import { SplitView, useSplitSelection } from "~/components/ui/split-view";
import { EmptyStudentResults } from "~/components/students/empty-student-results";
import { useToast } from "~/contexts/ToastContext";
import { overbookedHintFor } from "~/lib/activity-occupancy";
import { useDeviceContext } from "~/lib/device-context";
import { useMinuteClock } from "~/lib/pickup-helpers";
import { schoolClassLabel, schoolClassName } from "~/lib/school-class-label";
import { useNFCEnabled } from "~/lib/tenant-context";
import {
  canCompleteInstance,
  completeAvailableClock,
} from "~/lib/timetable-lifecycle";
import { TIMETABLE_VIEW_ONLY_NOTICE } from "~/lib/timetable-operation-access";
import {
  rosterPickupTimeLabel,
  upcomingArrivalTime,
} from "~/lib/timetable-roster-helpers";
import type { TimetableRosterRow } from "~/lib/timetable-operations-types";
import { isCareDayExpected } from "~/lib/timetable-types";
import {
  ATTENDANCE_SUBSTATUS_LABELS,
  CHECK_IN_TOOLTIP,
  EXCUSE_SCOPE_REST_OF_DAY,
  ExcuseScopeModal,
  RosterStudentDetailLines,
  rosterSections,
  useHomeworkFeedbackDialog,
  type RosterAction,
  type RosterActionAccess,
  type TimetableRosterContentProps,
} from "./timetable-roster";

/**
 * Die laufende Aufsicht in der App (#8070, Flow „A. Aufsicht“): eine
 * Live-Liste in Abschnitten (Fehlt noch, Da, Gegangen oder abgemeldet), je
 * Kind genau eine Hauptaktion rechts, alles Weitere im Aufsicht-Kind-Blatt.
 * Die Hauptaktion der Aufgabe steht in der Leiste über der Pill.
 *
 * Gleiche Daten und Aktionen wie `TimetableRosterContent` am Computer; nur
 * der Zuschnitt ist anders. Am iPad quer steht das Kind rechts neben der
 * Liste (`?kind=<id>`), sonst geht es als Blatt auf.
 */
export type TimetableRosterAppProps = Omit<
  TimetableRosterContentProps,
  | "headerNote"
  | "headerActions"
  | "headerToggle"
  | "statusInPageHead"
  | "roomInPageHead"
  | "onOpenStudent"
  | "onRosterAction"
> & {
  /** `true`, wenn die Aktion gespeichert ist; Fehler zeigt die Seite. */
  readonly onRosterAction: (
    action: RosterAction,
    row: TimetableRosterRow,
  ) => Promise<boolean>;
  /** Weitere Einträge am Listenende (Kinder unterwegs, spontaner Start). */
  readonly listFooter?: ReactNode;
};

type SectionKey = "missing" | "present" | "gone";

const SECTION_TITLES: Record<SectionKey, string> = {
  missing: "Fehlt noch",
  present: "Da",
  gone: "Gegangen oder abgemeldet",
};

function childName(row: TimetableRosterRow): string {
  return row.studentName || `Kind ${row.studentId}`;
}

function firstName(row: TimetableRosterRow): string {
  return childName(row).split(" ")[0] ?? childName(row);
}

/** Was in der Zeile rechts als einzige Aktion steht. */
function primaryRowAction(
  row: TimetableRosterRow,
  access: RosterActionAccess,
): RosterAction | null {
  if (!access.attendance) return null;
  if (row.currentlyPresent) return "check-out";
  // Ein abwesendes Kind kommt über das Blatt zurück („Zurück auf erwartet“),
  // nicht mit einem Tipp in der Liste.
  if (row.status === "absent") return null;
  return "check-in";
}

const ROW_ACTION_LABELS: Record<"check-in" | "check-out", string> = {
  "check-in": "Einchecken",
  "check-out": "Raum verlassen",
};

/** Alle Aktionen, die das Kind-Blatt anbietet, in der Reihenfolge der Liste. */
function sheetActions(
  row: TimetableRosterRow,
  access: RosterActionAccess,
): { action: RosterAction; label: string; tooltip: string }[] {
  const list: { action: RosterAction; label: string; tooltip: string }[] = [];
  if (access.attendance && !row.currentlyPresent && row.status !== "absent") {
    list.push({
      action: "check-in",
      label: row.status === "expected" ? "Einchecken" : "Wieder einchecken",
      tooltip: CHECK_IN_TOOLTIP,
    });
  }
  if (access.attendance && !row.currentlyPresent && row.status === "absent") {
    list.push({
      action: "check-in",
      label: "Doch da: einchecken",
      tooltip: CHECK_IN_TOOLTIP,
    });
  }
  if (access.attendance && row.currentlyPresent) {
    list.push({
      action: "check-out",
      label: "Raum verlassen",
      tooltip: "Trägt das Kind sofort aus diesem Raum aus.",
    });
  }
  if (
    row.planned &&
    row.status === "expected" &&
    isCareDayExpected(row.careDayStatus)
  ) {
    if (access.absence) {
      list.push({
        action: "excused",
        label: "Entschuldigt",
        tooltip: access.excuseAsksScope
          ? "Fragt, ob das Kind nur hier oder den restlichen Tag entschuldigt ist."
          : "Trägt das Kind sofort für diese Aktivität als entschuldigt ein.",
      });
    }
    if (access.statuses) {
      list.push({
        action: "absent",
        label: "Abwesend",
        tooltip: "Trägt das Kind sofort ohne Entschuldigung als abwesend ein.",
      });
    }
  }
  if (
    (row.substatus === "sick" || row.substatus === "excused"
      ? access.absence
      : access.statuses) &&
    row.planned &&
    !row.currentlyPresent &&
    row.status === "absent"
  ) {
    list.push({
      action: "expected",
      label: "Zurück auf erwartet",
      tooltip:
        "Nimmt die Abwesenheit sofort zurück, das Kind wird wieder erwartet.",
    });
  }
  return list;
}

/** Kurze Rückmeldung nach einer Aktion, mit dem Weg zurück, wo es einen gibt. */
function feedbackFor(
  action: RosterAction,
  row: TimetableRosterRow,
): { message: string; undo: RosterAction | null } {
  const name = firstName(row);
  const wasGone = !row.currentlyPresent && row.status === "present";
  switch (action) {
    case "check-in":
      return {
        message: `${name} ist eingecheckt.`,
        undo: wasGone ? "check-out" : null,
      };
    case "check-out":
      return { message: `${name} hat den Raum verlassen.`, undo: "check-in" };
    case "excused":
      return { message: `${name} ist entschuldigt.`, undo: "expected" };
    case "absent":
      return {
        message: `${name} ist als abwesend eingetragen.`,
        undo: "expected",
      };
    case "expected":
      return { message: `${name} wird wieder erwartet.`, undo: null };
  }
}

export function TimetableRosterApp({
  addStudentSearch,
  attendanceWebEnabled,
  isAddingStudent,
  isCompletingInstance,
  isConfirmingExpected,
  roster,
  occupancy,
  canAddUnplanned = true,
  onAddStudent,
  onAddPresentStudents,
  presentChildrenPicker: PresentChildrenPicker,
  addUnplannedStudentModal: AddUnplannedStudentModal,
  presentPickerAutoOpen = false,
  onPresentPickerAutoOpened,
  onComplete,
  onConfirmExpected,
  onRosterAction,
  onExcuseRestOfDay,
  onSaveHomeworkFeedback,
  reloadAfterRefusal,
  studentProfileHref,
  onSearchChange,
  rowFilter = null,
  addStudentError,
  listFooter,
}: TimetableRosterAppProps) {
  const now = useMinuteClock();
  const toast = useToast();
  const { isSplit } = useDeviceContext();
  const split = useSplitSelection("kind");
  const nfcEnabled = useNFCEnabled();

  // Rechte wie in der Liste am Computer (#3167, #3622).
  const lifecycleEnabled = attendanceWebEnabled && roster.canOperate !== false;
  const endEnabled =
    attendanceWebEnabled && (roster.canEnd ?? roster.canOperate) !== false;
  const actionsEnabled =
    attendanceWebEnabled &&
    (roster.canEditAttendance ?? roster.canOperate ?? true);
  const access: RosterActionAccess = {
    attendance: actionsEnabled,
    statuses: lifecycleEnabled,
    absence:
      attendanceWebEnabled && (roster.canReportAbsence ?? lifecycleEnabled),
    excuseAsksScope: onExcuseRestOfDay !== undefined,
  };
  const viewOnly =
    attendanceWebEnabled &&
    !actionsEnabled &&
    !lifecycleEnabled &&
    !endEnabled &&
    !access.absence;
  const overbookedNote = occupancy
    ? overbookedHintFor(occupancy, nfcEnabled)
    : null;

  const [addStudentOpen, setAddStudentOpen] = useState(false);
  const [presentPickerOpen, setPresentPickerOpen] = useState(false);
  const addStudentEnabled =
    actionsEnabled && canAddUnplanned && AddUnplannedStudentModal !== undefined;
  const presentPickerEnabled =
    actionsEnabled &&
    canAddUnplanned &&
    onAddPresentStudents !== undefined &&
    PresentChildrenPicker !== undefined;
  useEffect(() => {
    if (!presentPickerAutoOpen) return;
    if (presentPickerEnabled) setPresentPickerOpen(true);
    onPresentPickerAutoOpened?.();
  }, [presentPickerAutoOpen, presentPickerEnabled, onPresentPickerAutoOpened]);

  const [excuseRow, setExcuseRow] = useState<TimetableRosterRow | null>(null);
  const [isExcusing, setIsExcusing] = useState(false);
  const homeworkEnabled =
    roster.canRecordHomeworkFeedback === true &&
    onSaveHomeworkFeedback !== undefined;
  const homework = useHomeworkFeedbackDialog({
    enabled: homeworkEnabled,
    onSaveHomeworkFeedback,
    reloadAfterRefusal,
  });

  // Das Kind im Blatt: die Zeile kommt bei jedem Render frisch aus der
  // Liste, damit das Blatt nach einer Aktion den neuen Stand zeigt.
  const [sheetChildId, setSheetChildId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const sheetRow =
    roster.rows.find((row) => row.studentId === sheetChildId) ?? null;
  const splitRow =
    roster.rows.find((row) => row.studentId === split.selected) ?? null;

  const runAction = async (action: RosterAction, row: TimetableRosterRow) => {
    if (action === "excused" && onExcuseRestOfDay) {
      setExcuseRow(row);
      return;
    }
    setBusy(`${row.studentId}:${action}`);
    let saved = false;
    try {
      saved = await onRosterAction(action, row);
    } finally {
      setBusy(null);
    }
    if (!saved) return;
    const { message, undo } = feedbackFor(action, row);
    toast.success(message, {
      action: undo
        ? {
            label: "Rückgängig",
            tooltip: "Nimmt den letzten Schritt für dieses Kind sofort zurück.",
            onClick: () => void onRosterAction(undo, row),
          }
        : undefined,
    });
  };

  const handleExcuseScope = async (scope: string) => {
    if (!excuseRow) return;
    setIsExcusing(true);
    try {
      if (scope === EXCUSE_SCOPE_REST_OF_DAY && onExcuseRestOfDay) {
        await onExcuseRestOfDay(excuseRow);
      } else {
        await onRosterAction("excused", excuseRow);
      }
    } finally {
      setIsExcusing(false);
      setExcuseRow(null);
    }
  };

  const openChild = (row: TimetableRosterRow) => {
    if (isSplit) split.select(row.studentId);
    else setSheetChildId(row.studentId);
  };

  const inBlockStudentIds = new Set(
    roster.rows
      .filter((row) => row.currentlyPresent)
      .map((row) => row.studentId),
  );
  const all = rosterSections(roster.rows, now, roster.instance.date);
  const visible = rowFilter
    ? rosterSections(roster.rows.filter(rowFilter), now, roster.instance.date)
    : all;
  const hasNoMatch = rowFilter ? !roster.rows.some(rowFilter) : false;
  const confirmableExpectedRows = all.expected.filter(
    (row) => row.planned && !row.currentlyPresent,
  );
  const sections: { key: SectionKey; rows: TimetableRosterRow[] }[] = [
    { key: "missing", rows: [...visible.expected, ...visible.arrivingLater] },
    { key: "present", rows: [...visible.present, ...visible.unplanned] },
    {
      key: "gone",
      rows: [...visible.absent, ...visible.notScheduled, ...visible.departed],
    },
  ];

  const subtitleFor = (row: TimetableRosterRow, key: SectionKey): string => {
    // Zuerst, was die Aufsicht jetzt braucht (Ankunft, Gehzeit, Grund),
    // dann Klasse und Gruppe.
    const parts: string[] = [];
    if (key === "missing") {
      const arrival = upcomingArrivalTime(
        row.warnings,
        now,
        roster.instance.date,
      );
      if (arrival) parts.push(`kommt ${arrival}`);
    } else if (key === "present") {
      const pickup = rosterPickupTimeLabel(
        row.pickupTime,
        roster.pickupTimesLoaded,
        roster.pickupTimesRedacted,
      );
      if (pickup && pickup !== "–") parts.push(`geht ${pickup}`);
    } else if (row.status === "absent") {
      parts.push(
        row.substatus ? ATTENDANCE_SUBSTATUS_LABELS[row.substatus] : "Abwesend",
      );
    } else if (!row.currentlyPresent && row.status === "present") {
      parts.push("gegangen");
    } else {
      parts.push("heute nicht eingeplant");
    }
    const klass = schoolClassName(row.schoolClass ?? "");
    if (klass) parts.push(klass);
    if (row.groupName && row.groupName !== row.schoolClass)
      parts.push(row.groupName);
    return parts.join(" · ");
  };

  const rowAction = (row: TimetableRosterRow) => {
    const action = primaryRowAction(row, access);
    if (action !== "check-in" && action !== "check-out") return undefined;
    const isBusy = busy === `${row.studentId}:${action}`;
    return (
      <Button
        type="button"
        size="compact"
        variant={action === "check-in" ? "success" : "outline"}
        isLoading={isBusy}
        disabled={busy !== null && !isBusy}
        aria-label={`${ROW_ACTION_LABELS[action]}: ${childName(row)}`}
        tooltip={
          action === "check-in"
            ? CHECK_IN_TOOLTIP
            : "Trägt das Kind sofort aus diesem Raum aus."
        }
        onClick={() => void runAction(action, row)}
      >
        {ROW_ACTION_LABELS[action]}
      </Button>
    );
  };

  const list = hasNoMatch ? (
    <SectionCard>
      <EmptyStudentResults totalCount={roster.rows.length} filteredCount={0} />
    </SectionCard>
  ) : (
    <Collection label={`Kinder in ${roster.instance.title}`}>
      {sections.map(({ key, rows }) =>
        rows.length === 0 ? null : (
          <CollectionGroup
            key={key}
            title={SECTION_TITLES[key]}
            count={rows.length}
          >
            {rows.map((row) => (
              <CollectionRow
                key={`${row.studentId}-${row.status}-${row.visitId ?? "planned"}`}
                onClick={() => openChild(row)}
                selected={isSplit && split.selected === row.studentId}
                aria-label={`${childName(row)} öffnen`}
                leading={<Avatar name={childName(row)} size="sm" decorative />}
                title={childName(row)}
                subtitle={subtitleFor(row, key)}
                action={rowAction(row)}
              />
            ))}
          </CollectionGroup>
        ),
      )}
    </Collection>
  );

  const detailFor = (row: TimetableRosterRow, inSheet: boolean) => (
    <SupervisionChildDetail
      row={row}
      access={access}
      now={now}
      rosterDate={roster.instance.date}
      pickupTimesLoaded={roster.pickupTimesLoaded}
      pickupTimesRedacted={roster.pickupTimesRedacted}
      busy={busy}
      framed={!inSheet}
      profileHref={studentProfileHref?.(row)}
      onAction={(action) => {
        if (inSheet) setSheetChildId(null);
        void runAction(action, row);
      }}
      onHomework={
        homeworkEnabled && (row.homework?.length ?? 0) > 0
          ? () => {
              if (inSheet) setSheetChildId(null);
              homework.open(row);
            }
          : undefined
      }
    />
  );

  // Hauptaktion der Aufgabe: zuerst die erwarteten Kinder bestätigen, sonst
  // Kinder hinzufügen. Beenden ist die Nebenaktion und fragt vorher nach.
  const completeEnabled = canCompleteInstance(
    roster.instance.canComplete,
    roster.instance.completeAvailableAt,
    now,
  );
  const endButton = endEnabled ? (
    <Button
      type="button"
      variant="outline"
      size="md"
      disabled={isCompletingInstance || !completeEnabled}
      disabledReason={
        isCompletingInstance
          ? undefined
          : `Die Aktivität lässt sich erst ab ${completeAvailableClock(roster.instance.completeAvailableAt, roster.instance.endTime)} Uhr beenden.`
      }
      tooltip="Beendet die Aktivität für alle Kinder. moto fragt vorher nach."
      onClick={() => void onComplete()}
    >
      Beenden
    </Button>
  ) : null;
  let primary: ReactNode = null;
  if (actionsEnabled && confirmableExpectedRows.length > 0) {
    primary = (
      <Button
        type="button"
        variant="success"
        size="md"
        isLoading={isConfirmingExpected}
        loadingText="Bestätigt…"
        tooltip="Trägt alle erwarteten Kinder sofort als anwesend ein."
        onClick={() => void onConfirmExpected(confirmableExpectedRows)}
      >
        {`${confirmableExpectedRows.length} Erwartete einchecken`}
      </Button>
    );
  } else if (presentPickerEnabled) {
    primary = (
      <Button
        type="button"
        variant="success"
        size="md"
        tooltip="Öffnet eine Liste der anwesenden Kinder zum Hinzufügen."
        onClick={() => setPresentPickerOpen(true)}
      >
        Kinder hinzufügen
      </Button>
    );
  } else if (addStudentEnabled) {
    primary = (
      <Button
        type="button"
        variant="success"
        size="md"
        tooltip="Öffnet ein Fenster, um ein ungeplantes Kind einzutragen."
        onClick={() => setAddStudentOpen(true)}
      >
        Kind hinzufügen
      </Button>
    );
  }
  // Die übrigen Wege, ein Kind dazuzuholen, stehen am Listenende.
  const moreAdd: ReactNode[] = [];
  if (presentPickerEnabled && confirmableExpectedRows.length > 0) {
    moreAdd.push(
      <Button
        key="present"
        type="button"
        variant="outline"
        size="md"
        tooltip="Öffnet eine Liste der anwesenden Kinder zum Hinzufügen."
        onClick={() => setPresentPickerOpen(true)}
      >
        Anwesende Kinder hinzufügen
      </Button>,
    );
  }
  if (
    addStudentEnabled &&
    (presentPickerEnabled || confirmableExpectedRows.length > 0)
  ) {
    moreAdd.push(
      <Button
        key="unplanned"
        type="button"
        variant="outline"
        size="md"
        tooltip="Öffnet ein Fenster, um ein ungeplantes Kind einzutragen."
        onClick={() => setAddStudentOpen(true)}
      >
        Kind suchen und hinzufügen
      </Button>,
    );
  }

  const notes = [
    viewOnly ? TIMETABLE_VIEW_ONLY_NOTICE : null,
    overbookedNote,
  ].filter((note): note is string => Boolean(note));

  return (
    <div className="space-y-4">
      {notes.map((note) => (
        <Alert key={note} type="info" message={note} />
      ))}
      {roster.pickupTimesLoaded === false && !roster.pickupTimesRedacted ? (
        <Alert
          type="warning"
          announce="polite"
          message="Die Gehzeiten konnten nicht geladen werden. Die Liste bleibt verfügbar."
        />
      ) : null}
      <SplitView
        list={list}
        detail={splitRow ? detailFor(splitRow, false) : null}
        empty="Tippe links auf ein Kind, um es hier zu sehen."
      />
      {moreAdd.length > 0 || listFooter ? (
        <div className="tablet:max-w-[35rem] flex flex-col gap-3">
          {moreAdd}
          {listFooter}
        </div>
      ) : null}

      <OverlaySheet
        open={sheetRow !== null}
        onOpenChange={(open) => {
          if (!open) setSheetChildId(null);
        }}
        title={sheetRow ? childName(sheetRow) : "Kind"}
      >
        {sheetRow ? detailFor(sheetRow, true) : null}
      </OverlaySheet>

      {primary || endButton ? (
        <ActionBar secondary={primary ? endButton : undefined}>
          {primary ?? endButton}
        </ActionBar>
      ) : null}

      {addStudentEnabled && AddUnplannedStudentModal ? (
        <AddUnplannedStudentModal
          isOpen={addStudentOpen}
          instanceId={roster.instance.id}
          inBlockStudentIds={inBlockStudentIds}
          isAddingStudent={isAddingStudent}
          search={addStudentSearch}
          error={addStudentError}
          onAdd={onAddStudent}
          onClose={() => {
            setAddStudentOpen(false);
            onSearchChange("");
          }}
          onSearchChange={onSearchChange}
        />
      ) : null}
      {presentPickerEnabled && PresentChildrenPicker && onAddPresentStudents ? (
        <PresentChildrenPicker
          isOpen={presentPickerOpen}
          instanceId={roster.instance.id}
          inBlockStudentIds={inBlockStudentIds}
          isAdding={isAddingStudent}
          error={addStudentError}
          onAdd={onAddPresentStudents}
          onClose={() => {
            setPresentPickerOpen(false);
            onSearchChange("");
          }}
        />
      ) : null}
      {access.absence && onExcuseRestOfDay ? (
        <ExcuseScopeModal
          instance={roster.instance}
          row={excuseRow}
          isBusy={isExcusing}
          onClose={() => setExcuseRow(null)}
          onSelect={(scope) => void handleExcuseScope(scope)}
        />
      ) : null}
      {homework.dialog}
    </div>
  );
}

/**
 * Inhalt des Aufsicht-Kind-Blatts: was die Aufsicht über das Kind wissen
 * muss und alle Aktionen für dieses Kind im Block. Am iPad quer dieselbe
 * Fläche rechts neben der Liste.
 */
function SupervisionChildDetail({
  row,
  access,
  now,
  rosterDate,
  pickupTimesLoaded,
  pickupTimesRedacted,
  busy,
  framed,
  profileHref,
  onAction,
  onHomework,
}: Readonly<{
  row: TimetableRosterRow;
  access: RosterActionAccess;
  now: Date;
  rosterDate: string;
  pickupTimesLoaded?: boolean;
  pickupTimesRedacted?: boolean;
  busy: string | null;
  /** Als eigene Karte (iPad quer), sonst im Blatt. */
  framed: boolean;
  profileHref?: string;
  onAction: (action: RosterAction) => void;
  onHomework?: () => void;
}>) {
  const actions = sheetActions(row, access);
  const meta = [
    row.schoolClass ? schoolClassLabel(row.schoolClass) : null,
    row.groupName && row.groupName !== row.schoolClass ? row.groupName : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const body = (
    <div className="space-y-4">
      {framed ? (
        <div className="flex items-center gap-3">
          <Avatar name={childName(row)} size="md" decorative />
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-gray-900">
              {childName(row)}
            </h2>
            {meta ? <p className="text-sm text-gray-600">{meta}</p> : null}
          </div>
        </div>
      ) : meta ? (
        <p className="text-sm text-gray-600">{meta}</p>
      ) : null}
      <div className="text-sm text-gray-700 empty:hidden">
        <RosterStudentDetailLines
          row={row}
          now={now}
          rosterDate={rosterDate}
          pickupTimesLoaded={pickupTimesLoaded}
          pickupTimesRedacted={pickupTimesRedacted}
        />
      </div>
      {actions.length > 0 || onHomework ? (
        <div className="flex flex-col gap-2">
          {actions.map(({ action, label, tooltip }, index) => (
            <Button
              key={`${action}-${label}`}
              type="button"
              size="md"
              variant={
                index === 0 && (action === "check-in" || action === "check-out")
                  ? action === "check-in"
                    ? "success"
                    : "primary"
                  : "outline"
              }
              isLoading={busy === `${row.studentId}:${action}`}
              disabled={busy !== null}
              tooltip={tooltip}
              onClick={() => onAction(action)}
            >
              {label}
            </Button>
          ))}
          {onHomework ? (
            <Button
              type="button"
              size="md"
              variant="outline"
              tooltip="Öffnet ein Fenster für die Rückmeldung zu den Hausaufgaben."
              onClick={onHomework}
            >
              Hausaufgaben
            </Button>
          ) : null}
        </div>
      ) : null}
      {profileHref ? (
        <ButtonLink
          href={profileHref}
          variant="ghost"
          size="md"
          tooltip="Öffnet die Seite des Kindes mit allen Angaben."
          className="w-full"
        >
          Ganze Akte öffnen
          <ArrowUpRightIcon
            className="size-4"
            weight="bold"
            aria-hidden="true"
          />
        </ButtonLink>
      ) : null}
    </div>
  );
  if (!framed) return body;
  return <SectionCard>{body}</SectionCard>;
}
