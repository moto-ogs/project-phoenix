"use client";

import { useEffect, useState, type ReactNode } from "react";

import { Alert } from "~/components/ui/alert";
import { ActionBar } from "~/components/ui/action-bar";
import { Avatar } from "~/components/ui/avatar";
import { Button, ButtonLink } from "~/components/ui/button";
import type { ChildDayStatus } from "~/components/students/child-day-status";
import { ChildSheet, ChildSummary } from "~/components/students/child-sheet";
import {
  Collection,
  CollectionGroup,
  CollectionRow,
} from "~/components/ui/collection";
import { SectionCard } from "~/components/ui/section-card";
import { SplitView, useSplitSelection } from "~/components/ui/split-view";
import { EmptyStudentResults } from "~/components/students/empty-student-results";
import { useToast } from "~/contexts/ToastContext";
import { overbookedHintFor } from "~/lib/activity-occupancy";
import { useDeviceContext } from "~/lib/device-context";
import { useStudentData } from "~/lib/hooks/use-student-data";
import { useMinuteClock } from "~/lib/pickup-helpers";
import { schoolClassName } from "~/lib/school-class-label";
import type { Student } from "~/lib/student-helpers";
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
  /**
   * „Kind suchen und hinzufügen“ steht im „…“-Menü der Seite, nicht als
   * zweiter Hinzufügen-Knopf am Listenende: die Seite öffnet es hierüber.
   */
  readonly addStudentOpen?: boolean;
  readonly onAddStudentOpenChange?: (open: boolean) => void;
};

/**
 * Ob die App-Aufsicht ein ungeplantes Kind per Suche hinzufügen lässt: mit
 * denselben Rechten wie der Hinzufügen-Knopf am Computer.
 */
export function rosterAppCanAddUnplanned(
  roster: TimetableRosterAppProps["roster"],
  attendanceWebEnabled: boolean,
): boolean {
  return (
    attendanceWebEnabled &&
    (roster.canEditAttendance ?? roster.canOperate ?? true) !== false
  );
}

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
  addStudentOpen: addStudentOpenProp,
  onAddStudentOpenChange,
}: TimetableRosterAppProps) {
  const now = useMinuteClock();
  const toast = useToast();
  const { isSplit, layout } = useDeviceContext();
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

  const [addStudentOpenOwn, setAddStudentOpenOwn] = useState(false);
  const addStudentOpen = addStudentOpenProp ?? addStudentOpenOwn;
  const setAddStudentOpen = (open: boolean) => {
    setAddStudentOpenOwn(open);
    onAddStudentOpenChange?.(open);
  };
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

  // Am iPad quer bleibt die Detailspalte nie leer: ohne Auswahl steht dort
  // das erste Kind der Liste.
  const firstListed =
    sections.find((section) => section.rows.length > 0)?.rows[0] ?? null;
  const splitRow =
    (split.selected
      ? roster.rows.find((row) => row.studentId === split.selected)
      : null) ?? firstListed;
  // Eine Gruppe, die alle Kinder teilen, sagt in der Zeile nichts; dann
  // bleibt Platz für Gehzeit und Klasse.
  const groupNames = new Set(roster.rows.map((row) => row.groupName));
  const sharedGroup = groupNames.size === 1;

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
    if (!sharedGroup && row.groupName && row.groupName !== row.schoolClass)
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
    <Collection
      label={`Kinder in ${roster.instance.title}`}
      // iPad hoch: die Kinder fließen in zwei Spalten, damit die Aktion nah
      // am Namen steht statt am anderen Ende einer 800 px breiten Zeile.
      className={
        layout === "tablet" && !isSplit
          ? "[&_ul]:columns-2 [&_ul]:gap-0 [&_ul>li]:break-inside-avoid"
          : undefined
      }
    >
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
                selected={isSplit && splitRow?.studentId === row.studentId}
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

  const contextFor = (row: TimetableRosterRow, inSheet: boolean) => (
    <SupervisionChildActions
      row={row}
      access={access}
      now={now}
      rosterDate={roster.instance.date}
      busy={busy}
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
  // Solange erwartete Kinder warten, steht „Anwesende Kinder hinzufügen“
  // am Listenende statt in der Leiste.
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
  // „Kind suchen und hinzufügen“ steht mit der Liste der Anwesenden im
  // „…“-Menü der Seite. Ohne sie ist es die Hauptaktion oder, solange
  // Erwartete warten, der Knopf am Listenende.
  if (
    addStudentEnabled &&
    !presentPickerEnabled &&
    confirmableExpectedRows.length > 0
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
        list={
          <>
            {list}
            {/* Die Liste scrollt am iPad quer für sich: Polster, damit die
                letzten Kinder über Aktionsleiste und Pill erreichbar sind. */}
            {isSplit ? <div aria-hidden="true" className="h-40" /> : null}
          </>
        }
        detail={
          splitRow ? (
            <SupervisionChildDetail
              row={splitRow}
              href={studentProfileHref?.(splitRow)}
              context={contextFor(splitRow, false)}
            />
          ) : null
        }
        empty="Tippe links auf ein Kind, um es hier zu sehen."
      />
      {moreAdd.length > 0 || listFooter ? (
        <div className="flex flex-col gap-3">
          {moreAdd}
          {listFooter}
        </div>
      ) : null}

      <SupervisionChildSheet
        row={sheetRow}
        href={sheetRow ? studentProfileHref?.(sheetRow) : undefined}
        context={sheetRow ? contextFor(sheetRow, true) : null}
        onClose={() => setSheetChildId(null)}
      />

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
 * Das Kind aus der Aufsicht als `Student` für das Kind-Blatt: zuerst aus der
 * Zeile, dann aus der Akte, sobald sie geladen ist (gleicher Cache wie die
 * Akte; ohne Leserecht bleibt es bei der Zeile).
 */
function useRosterStudent(
  row: TimetableRosterRow | null,
  canRead: boolean,
): { student: Student | null; loaded: boolean } {
  const detail = useStudentData(row && canRead ? row.studentId : "");
  if (!row) return { student: null, loaded: false };
  if (detail.student && detail.student.id === row.studentId) {
    // Die Gehzeit des Tages kennt die Aufsicht; die Akte liefert sie nicht
    // immer mit.
    const pickup =
      detail.student.pickup_time ??
      (row.pickupTime && row.pickupTime !== "–" ? row.pickupTime : undefined);
    return {
      student: { ...detail.student, pickup_time: pickup },
      loaded: true,
    };
  }
  const [first, ...rest] = childName(row).split(" ");
  return {
    student: {
      id: row.studentId,
      name: childName(row),
      first_name: first,
      second_name: rest.join(" "),
      school_class: row.schoolClass,
      group_name: row.groupName,
      current_location: "",
      // Zeiten erst mit der Akte: sie kennt die Rechte am Kind.
      has_full_access: false,
      teacher_hints: row.teacherHints,
    },
    loaded: false,
  };
}

/**
 * Kind-Blatt der Aufsicht: dasselbe Blatt wie in der Kindersuche, mit den
 * Aufsicht-Aktionen statt der Schnellaktionen der Akte (sonst stünden
 * „Raum verlassen“ und „Abmelden“ nebeneinander).
 */
function SupervisionChildSheet({
  row,
  href,
  context,
  onClose,
}: Readonly<{
  row: TimetableRosterRow | null;
  href?: string;
  context: ReactNode;
  onClose: () => void;
}>) {
  const { student, loaded } = useRosterStudent(row, href !== undefined);
  return (
    <ChildSheet
      student={student}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      href={href}
      quickActions={false}
      status={loaded ? undefined : NO_STATUS}
      contextActions={context}
    />
  );
}

/**
 * Ohne geladene Akte kein Tagesstatus: er kommt aus der Akte, die Zeile
 * kennt nur den Stand in diesem Block.
 */
const NO_STATUS: ChildDayStatus | null = null;

/** Dasselbe Kind rechts neben der Liste (iPad quer). */
function SupervisionChildDetail({
  row,
  href,
  context,
}: Readonly<{
  row: TimetableRosterRow;
  href?: string;
  context: ReactNode;
}>) {
  const { student, loaded } = useRosterStudent(row, href !== undefined);
  if (!student) return null;
  return (
    <SectionCard>
      <ChildSummary
        student={student}
        href={href}
        quickActions={false}
        status={loaded ? undefined : NO_STATUS}
        contextActions={context}
        header
      />
      {href ? (
        <div className="mt-5 flex">
          <ButtonLink
            href={href}
            variant="primary"
            size="md"
            tooltip="Öffnet die ganze Akte mit allen Angaben."
          >
            Ganze Akte öffnen
          </ButtonLink>
        </div>
      ) : null}
    </SectionCard>
  );
}

/**
 * Was nur die Aufsicht über das Kind weiß (Ankunft, Hinweise der Planung,
 * Grund der Abwesenheit) und alle Aktionen für das Kind in diesem Block.
 */
function SupervisionChildActions({
  row,
  access,
  now,
  rosterDate,
  busy,
  onAction,
  onHomework,
}: Readonly<{
  row: TimetableRosterRow;
  access: RosterActionAccess;
  now: Date;
  rosterDate: string;
  busy: string | null;
  onAction: (action: RosterAction) => void;
  onHomework?: () => void;
}>) {
  const actions = sheetActions(row, access);
  return (
    <>
      <div className="text-sm text-gray-700 empty:hidden">
        <RosterStudentDetailLines
          row={row}
          now={now}
          rosterDate={rosterDate}
          showPickupTime={false}
        />
      </div>
      {actions.length > 0 || onHomework ? (
        <div
          className="flex flex-wrap gap-2"
          aria-label="Aktionen in der Aufsicht"
        >
          {actions.map(({ action, label, tooltip }, index) => (
            <Button
              key={`${action}-${label}`}
              type="button"
              size="md"
              variant={
                index === 0 && action === "check-in" ? "success" : "outline"
              }
              className="flex-1"
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
              className="flex-1"
              tooltip="Öffnet ein Fenster für die Rückmeldung zu den Hausaufgaben."
              onClick={onHomework}
            >
              Hausaufgaben
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
