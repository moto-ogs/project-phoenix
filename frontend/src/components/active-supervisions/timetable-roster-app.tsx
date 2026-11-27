"use client";

import { AlertTriangle, CalendarX, Plus, StickyNote } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { Alert } from "~/components/ui/alert";
import { ActionBar } from "~/components/ui/action-bar";
import { Avatar } from "~/components/ui/avatar";
import { Button, ButtonLink } from "~/components/ui/button";
import type { ChildDayStatus } from "~/components/students/child-day-status";
import { ChildSheet, ChildSummary } from "~/components/students/child-sheet";
import { RowParentAttention } from "~/components/students/student-list-app";
import {
  Collection,
  CollectionGroup,
  CollectionRow,
} from "~/components/ui/collection";
import type { OverflowMenuItem } from "~/components/ui/page-header/types";
import { SectionCard } from "~/components/ui/section-card";
import { SplitView, useSplitSelection } from "~/components/ui/split-view";
import { EmptyStudentResults } from "~/components/students/empty-student-results";
import { useToast } from "~/contexts/ToastContext";
import { overbookedHintFor } from "~/lib/activity-occupancy";
import { useDeviceContext } from "~/lib/device-context";
import { berlinTodayISO } from "~/lib/date-helpers";
import {
  buildStudentSearchFilters,
  fetchStudentSearch,
  type StudentSearchFilterInput,
} from "~/lib/student-search-resource";
import { useSWRAuth } from "~/lib/swr";
import { studentKeys } from "~/lib/swr/portal-keys";
import { getAccessibleTextColor } from "~/lib/kit-palette";
import { useMinuteClock } from "~/lib/pickup-helpers";
import { schoolClassName } from "~/lib/school-class-label";
import type { Student } from "~/lib/student-helpers";
import { getStudentTimeStatus } from "~/lib/student-time-status";
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
  /** Öffnet „Aufsicht übergeben“, wenn die Person die Aufsicht abgeben darf. */
  readonly onHandOver?: () => void;
  /** „Aktivität beenden“ mit Sperrzeit und Rückfrage (`rosterAppEndEntry`). */
  readonly endEntry?: OverflowMenuItem | null;
  /**
   * Rechts im ersten Abschnittskopf, etwa „3 unterwegs“: führt zur Karte am
   * Listenende, ohne dass sie die Kinder aus dem ersten Bild schiebt.
   */
  readonly leadGroupMeta?: ReactNode;
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

/**
 * „Beenden“ der App-Aufsicht als Eintrag im „…“-Blatt der Seite: selten
 * gebraucht und endgültig, darum nicht neben der Hauptaktion über der Pill.
 * Gleiche Rechte und Sperrzeit wie der Knopf am Computer; die Rückfrage
 * stellt `CompleteInstanceModal` der Seite.
 */
export function rosterAppEndEntry(options: {
  readonly roster: TimetableRosterAppProps["roster"];
  readonly attendanceWebEnabled: boolean;
  readonly now: Date;
  readonly isCompleting: boolean;
  readonly onComplete: () => void;
}): OverflowMenuItem | null {
  const { roster, attendanceWebEnabled, now, isCompleting, onComplete } =
    options;
  if (!attendanceWebEnabled || (roster.canEnd ?? roster.canOperate) === false)
    return null;
  const available = canCompleteInstance(
    roster.instance.canComplete,
    roster.instance.completeAvailableAt,
    now,
  );
  return {
    label: "Aktivität beenden",
    description: available
      ? "Beendet die Aktivität für alle Kinder. moto fragt vorher nach."
      : `Die Aktivität lässt sich erst ab ${completeAvailableClock(roster.instance.completeAvailableAt, roster.instance.endTime)} Uhr beenden.`,
    disabled: isCompleting || !available,
    onClick: onComplete,
  };
}

type SectionKey = "missing" | "present" | "gone";

const SECTION_TITLES: Record<SectionKey, string> = {
  missing: "Fehlt noch",
  present: "Da",
  // Ein Wort für alle Kinder außerhalb des Raums, wie am Computer
  // („Nicht mehr im Raum“): gegangen, krank oder heute nicht eingeplant.
  gone: "Nicht im Raum",
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

/**
 * VORSCHLAG (Prototyp #8070, Runde 3), noch kein Produktentscheid: Die Jury
 * fand „Einchecken“ in beiden Runden schwer verständlich. Die App-Fassung
 * der Aufsicht sagt deshalb, was die Person sieht: Das Kind „ist da“. Die
 * Aktion und ihre Wirkung bleiben gleich; Desktop, Kiosk und Hilfe
 * sagen weiter „Einchecken“, bis über das Wort entschieden ist.
 */
const CHECK_IN_WORDING = {
  row: "Ist da",
  expected: "Ist da",
  returned: "Wieder da",
  absent: "Doch da",
  bulk: (count: number) =>
    count === 1 ? "1 Kind ist da" : `Alle ${count} sind da`,
  done: (name: string) => `${name} ist da.`,
  doneAgain: (name: string) => `${name} ist wieder da.`,
} as const;

/** Alle Aktionen, die das Kind-Blatt anbietet, in der Reihenfolge der Liste. */
function sheetActions(
  row: TimetableRosterRow,
  access: RosterActionAccess,
): { action: RosterAction; label: string; tooltip: string }[] {
  const list: { action: RosterAction; label: string; tooltip: string }[] = [];
  if (access.attendance && !row.currentlyPresent && row.status !== "absent") {
    list.push({
      action: "check-in",
      label:
        row.status === "expected"
          ? CHECK_IN_WORDING.expected
          : CHECK_IN_WORDING.returned,
      tooltip: CHECK_IN_TOOLTIP,
    });
  }
  if (access.attendance && !row.currentlyPresent && row.status === "absent") {
    list.push({
      action: "check-in",
      label: CHECK_IN_WORDING.absent,
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
        message: wasGone
          ? CHECK_IN_WORDING.doneAgain(name)
          : CHECK_IN_WORDING.done(name),
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

/**
 * Was am Computer unter dem Kind farbig steht (Hinweis der Planung, zugleich
 * in einem anderen Block, Hinweis der Lehrkraft), kurz vorn in der zweiten
 * Zeile. Den ganzen Satz zeigt das Kind-Blatt.
 */
function rowPlanningWarning(row: TimetableRosterRow) {
  return (row.warnings ?? []).find(
    (warning) =>
      (warning.kind !== "arrival_after_slot_start" ||
        !warning.expectedArrival) &&
      warning.kind !== "class_arrival_exception",
  );
}

function rowNotice(row: TimetableRosterRow): ReactNode {
  const planning = rowPlanningWarning(row);
  let label: string | null = null;
  if (planning) {
    // Am Computer „Für diesen Tag ist keine erwartete Ankunft hinterlegt.“
    // „Keine Ankunftszeit“ las sich wie „nicht erfasst“; gemeint ist der Plan.
    // Kurz genug, dass Hinweis und Gehzeit am SE in eine Zeile passen.
    label =
      planning.kind === "missing_arrival_schedule"
        ? "Keine Ankunft geplant"
        : planning.message;
  } else if (row.parallelPresentIn) {
    label = `Auch in „${row.parallelPresentIn.title}“`;
  }
  // Eine fehlende Ankunftszeit ist eine Lücke im Plan, kein Zustand des
  // Kindes: grau statt Warnfarbe, die bleibt für das, was jetzt Handeln
  // verlangt. Den ganzen Satz zeigt weiter das Kind-Blatt.
  if (label && planning?.kind === "missing_arrival_schedule") {
    return (
      <span className="flex min-w-0 items-center gap-0.5 text-gray-600">
        <CalendarX className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </span>
    );
  }
  if (label) {
    return (
      <span className="text-moto-amber-strong flex min-w-0 items-center gap-0.5 font-medium">
        <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </span>
    );
  }
  if ((row.teacherHints ?? []).length > 0) {
    return (
      <span className="flex shrink-0 items-center gap-1 font-medium text-gray-700">
        <StickyNote className="size-3.5 shrink-0" aria-hidden="true" />
        Hinweis
      </span>
    );
  }
  return null;
}

/**
 * Farbe einer heute überschrittenen Gehzeit eines Kindes, das noch im Raum
 * ist, wie in der Kindersuche (orange kurz danach, dann rot); sonst `null`.
 */
function overduePickupColor(
  row: TimetableRosterRow,
  now: Date,
  rosterDate: string,
): string | null {
  if (!row.currentlyPresent || !row.pickupTime) return null;
  if (rosterDate !== berlinTodayISO(now)) return null;
  const status = getStudentTimeStatus({
    plannedTime: row.pickupTime,
    now,
    kind: "pickup",
  });
  const late =
    status.state === "very-overdue" || status.state === "slightly-overdue";
  return late && status.textColor
    ? getAccessibleTextColor(status.textColor)
    : null;
}

/**
 * Niedrige Telefone (iPhone SE, 667 px): Zeilen 45 statt 59 px (44 plus Trennlinie), die zweite
 * Zeile ohne Abstand zur ersten. So stehen acht Kinder ganz über der
 * Aktionsleiste (erste Zeile bei 158 px, Leiste bei 522 px: 8 × 45 = 360).
 * Höhere Telefone behalten die Kit-Zeile; die Trefferfläche bleibt über 44 px.
 */
const SHORT_PHONE_ROWS =
  "[@media(max-height:760px)]:[&_[data-collection-row]]:min-h-[44px] [@media(max-height:760px)]:[&_[data-collection-row]]:py-[3px] [@media(max-height:760px)]:[&_[data-collection-row]>.flex-1>span]:mt-0 [@media(max-height:760px)]:[&_[data-collection-row]>.flex-1>span]:leading-[18px]";

/**
 * Eine Angabe der zweiten Zeile. Der Punkt davor steht links außerhalb und
 * wird am Zeilenanfang abgeschnitten: Bricht die Zeile um, beginnt die neue
 * Zeile ohne „·“.
 */
function SubtitlePart({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <span className="flex max-w-full min-w-0 shrink-0 items-center before:w-2 before:shrink-0 before:text-center before:text-gray-500 before:content-['·']">
      {children}
    </span>
  );
}

export function TimetableRosterApp({
  addStudentSearch,
  attendanceWebEnabled,
  isAddingStudent,
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
  onHandOver,
  endEntry,
  leadGroupMeta,
  addStudentOpen: addStudentOpenProp,
  onAddStudentOpenChange,
}: TimetableRosterAppProps) {
  const now = useMinuteClock();
  const toast = useToast();
  const { isSplit, layout } = useDeviceContext();
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
  const split = useSplitSelection("kind", {
    defaultId: firstListed?.studentId ?? null,
  });
  const splitRow =
    roster.rows.find((row) => row.studentId === split.selected) ?? null;
  // Eine Gruppe, die alle Kinder teilen, sagt in der Zeile nichts; dann
  // bleibt Platz für Gehzeit und Klasse.
  const groupNames = new Set(roster.rows.map((row) => row.groupName));
  const sharedGroup = groupNames.size === 1;

  const subtitleFor = (row: TimetableRosterRow, key: SectionKey): ReactNode => {
    // Zuerst, was die Aufsicht jetzt braucht (Hinweis, Ankunft, Gehzeit,
    // Grund), dann die Gruppe; die Klasse steht neben dem Namen. Die
    // Gehzeit steht wie am Computer bei jedem Kind, das heute noch geht.
    const parts: { key: string; node: ReactNode }[] = [];
    const text = (value: string) => parts.push({ key: value, node: value });
    const notice = rowNotice(row);
    const pickup = rosterPickupTimeLabel(
      row.pickupTime,
      roster.pickupTimesLoaded,
      roster.pickupTimesRedacted,
    );
    const pickupPart = () => {
      if (!pickup) return;
      // Ohne Gehzeit sagt die Zeile das ausdrücklich, statt einzeilig und
      // niedriger als die anderen zu bleiben (Runde 21).
      if (pickup === "–") {
        parts.push({ key: "pickup", node: "keine Gehzeit" });
        return;
      }
      const overdue = overduePickupColor(row, now, roster.instance.date);
      parts.push({
        key: "pickup",
        // Überfällig wie in der Kindersuche: Warnzeichen und Farbe nur mit
        // dem Wort, sonst liest sich jede rote Zeile gleich dringend.
        node: overdue ? (
          <span
            className="flex items-center gap-0.5 font-medium"
            style={{ color: overdue }}
          >
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
            geht {pickup}, überfällig
          </span>
        ) : (
          `geht ${pickup}`
        ),
      });
    };
    // Ein Kind, das da ist, braucht keinen Ankunftsplan mehr: „Keine
    // Ankunft geplant“ las sich neben ihm wie ein Widerspruch. Das Kind-Blatt
    // nennt den Hinweis weiter.
    const arrivalPlanGap =
      rowPlanningWarning(row)?.kind === "missing_arrival_schedule";
    if (notice && (key === "missing" || (key === "present" && !arrivalPlanGap)))
      parts.push({ key: "notice", node: notice });
    if (key === "missing") {
      const arrival = upcomingArrivalTime(
        row.warnings,
        now,
        roster.instance.date,
      );
      if (arrival) text(`kommt ${arrival}`);
      pickupPart();
    } else if (key === "present") {
      pickupPart();
    } else {
      // Unter „Nicht im Raum“ steht zuerst ein Grund (krank, heute nicht
      // eingeplant), dann die Gehzeit, zuletzt ein Hinweis.
      if (row.status === "absent") {
        text(
          row.substatus
            ? ATTENDANCE_SUBSTATUS_LABELS[row.substatus]
            : "Abwesend",
        );
      } else if (!row.currentlyPresent && row.status === "present") {
        // Das Kind hat den Raum verlassen: Das sagt schon der Abschnitt
        // „Nicht im Raum“; die Zeile nennt nur die Gehzeit.
      } else {
        text("heute nicht eingeplant");
      }
      if (!row.currentlyPresent && row.status === "present") pickupPart();
      // Wann ein gegangenes Kind kommen sollte, braucht die Aufsicht nicht
      // mehr; die Zeile bleibt zweizeilig wie die anderen. Das Kind-Blatt
      // nennt den Hinweis weiter.
      if (
        notice &&
        rowPlanningWarning(row)?.kind !== "missing_arrival_schedule"
      )
        parts.push({ key: "notice", node: notice });
    }
    if (!sharedGroup && row.groupName && row.groupName !== row.schoolClass)
      text(row.groupName);
    if (parts.length === 0) return null;
    // Jede Angabe ganz oder gar nicht und auf jedem Telefon dieselben: Was
    // nicht mehr in die Zeile passt, bricht als Ganzes in eine weitere Zeile
    // um, statt abgeschnitten („geht 16:…“) oder weggelassen zu werden. Der
    // linke Rand schneidet den Punkt vor der ersten Angabe jeder Zeile ab.
    return (
      <span className="-ml-2 flex min-w-0 flex-wrap items-center">
        {parts.map((part) => (
          <SubtitlePart key={part.key}>{part.node}</SubtitlePart>
        ))}
      </span>
    );
  };

  // Die Klasse neben dem Namen: Sie ist kurz, und die zweite Zeile behält
  // Platz für Gehzeit und Hinweise. Ein langer Name kürzt sich, die Klasse
  // bleibt.
  // Neue Nachrichten und Anfragen der Eltern als blaue Zahl am Namen, wie in
  // der Kindersuche: gleiches Kind, gleicher Marker (Runde 21).
  const titleFor = (row: TimetableRosterRow): ReactNode => {
    const klass = schoolClassName(row.schoolClass ?? "");
    return (
      <span className="flex min-w-0 items-center gap-1">
        <span className="flex min-w-0 items-baseline gap-1">
          <span className="truncate">{childName(row)}</span>
          {klass ? (
            <>
              {" "}
              <span className="shrink-0 text-xs font-normal text-gray-500">
                {klass}
              </span>
            </>
          ) : null}
        </span>
        <span className="flex shrink-0 pl-1 empty:hidden">
          <RowParentAttention studentId={row.studentId} />
        </span>
      </span>
    );
  };

  const rowAction = (row: TimetableRosterRow) => {
    // Am iPad quer steht das Kind rechts mit allen Aktionen; in der Zeile
    // stünde dieselbe Aktion doppelt.
    if (isSplit) return undefined;
    const action = primaryRowAction(row, access);
    // „Raum verlassen“ steht nicht in jeder Zeile: zwölfmal derselbe Knopf
    // machte die Liste zum Formular und schob Hinweise in eine dritte
    // Zeile. Ein Tipp auf das Kind öffnet das Blatt, dort ist es die erste
    // Aktion. „Ist da“ bleibt in der Zeile: Es betrifft die Kinder, die
    // noch fehlen. „Wieder da“ ist selten und steht wie „Raum verlassen“ als
    // erste Aktion im Blatt, statt als kleine zweite Trefferfläche in der
    // Zeile (Runde 19).
    if (action !== "check-in" || row.status !== "expected") return undefined;
    const isBusy = busy === `${row.studentId}:${action}`;
    // Ausgeschrieben statt als Symbol: Ein Pfeil allein las sich als
    // „Abmelden“, ein Haken gar nicht.
    const label = CHECK_IN_WORDING.expected;
    return (
      <Button
        type="button"
        size="compact"
        // Leise: Die Hauptaktion der Seite steht in der Leiste.
        variant="outline"
        isLoading={isBusy}
        disabled={busy !== null && !isBusy}
        aria-label={`${label}: ${childName(row)}`}
        tooltip={`${label}: ${CHECK_IN_TOOLTIP}`}
        onClick={() => void runAction(action, row)}
      >
        {label}
      </Button>
    );
  };

  const leadSectionKey =
    sections.find((section) => section.rows.length > 0)?.key ?? null;
  const list = hasNoMatch ? (
    <SectionCard>
      <EmptyStudentResults totalCount={roster.rows.length} filteredCount={0} />
    </SectionCard>
  ) : (
    <Collection
      label={`Kinder in ${roster.instance.title}`}
      // iPad hoch: die Kinder stehen zeilenweise in zwei Spalten (links,
      // rechts, nächste Zeile), damit die Aktion nah am Namen steht und keine
      // Zelle neben einem Kind leer bleibt.
      className={
        layout === "phone"
          ? SHORT_PHONE_ROWS
          : layout === "tablet" && !isSplit
            ? "[&_ul]:grid [&_ul]:grid-cols-2 [&_ul]:divide-y-0 [&_ul>li]:border-b [&_ul>li]:border-gray-100 [&_ul>li:last-child]:border-b-0 [&_ul>li:nth-child(odd)]:border-r [&_ul>li:nth-last-child(2):nth-child(odd)]:border-b-0"
            : undefined
      }
    >
      {sections.map(({ key, rows }) =>
        rows.length === 0 ? null : (
          <CollectionGroup
            key={key}
            title={SECTION_TITLES[key]}
            count={rows.length}
            meta={key === leadSectionKey ? leadGroupMeta : undefined}
          >
            {rows.map((row) => (
              <CollectionRow
                key={`${row.studentId}-${row.status}-${row.visitId ?? "planned"}`}
                onClick={() => openChild(row)}
                selected={isSplit && splitRow?.studentId === row.studentId}
                // Beginnt mit dem sichtbaren Text (Name, Klasse), damit
                // Sprachsteuerung die Zeile beim gelesenen Namen findet.
                aria-label={`${[childName(row), schoolClassName(row.schoolClass ?? "")].filter(Boolean).join(" ")} öffnen`}
                leading={<Avatar name={childName(row)} size="sm" decorative />}
                title={titleFor(row)}
                subtitle={subtitleFor(row, key)}
                action={rowAction(row)}
              />
            ))}
          </CollectionGroup>
        ),
      )}
    </Collection>
  );

  const linesFor = (row: TimetableRosterRow) => (
    <SupervisionChildLines
      row={row}
      now={now}
      rosterDate={roster.instance.date}
    />
  );
  const contextFor = (row: TimetableRosterRow, inSheet: boolean) => (
    <SupervisionChildActions
      row={row}
      access={access}
      inSheet={inSheet}
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
  // Kinder hinzufügen. Beenden ist selten und steht im „…“-Blatt der Seite
  // (`rosterAppEndEntry`), nicht neben der Hauptaktion im Daumenbereich.
  let primary: ReactNode = null;
  if (actionsEnabled && confirmableExpectedRows.length > 0) {
    primary = (
      <Button
        type="button"
        variant="primary"
        size="md"
        isLoading={isConfirmingExpected}
        loadingText="Bestätigt…"
        tooltip="Trägt alle erwarteten Kinder sofort als anwesend ein."
        onClick={() => void onConfirmExpected(confirmableExpectedRows)}
      >
        {CHECK_IN_WORDING.bulk(confirmableExpectedRows.length)}
      </Button>
    );
  } else if (presentPickerEnabled) {
    primary = (
      <Button
        type="button"
        variant="primary"
        size="md"
        tooltip="Öffnet eine Liste der anwesenden Kinder zum Hinzufügen."
        onClick={() => setPresentPickerOpen(true)}
        aria-label="Kinder hinzufügen"
        className="gap-1.5"
      >
        {/* Neben Übergeben und Beenden reicht die Breite am Telefon nicht
            für „Kinder hinzufügen“; „+ Kinder“ sagt, was dazukommt (allein
            „Hinzufügen“ ließ offen, ob Kinder oder Betreuer). Der volle Name
            steht im Vorleseprogramm. */}
        <Plus aria-hidden="true" className="size-4" />
        Kinder
      </Button>
    );
  } else if (addStudentEnabled) {
    primary = (
      <Button
        type="button"
        variant="primary"
        size="md"
        tooltip="Öffnet ein Fenster, um ein ungeplantes Kind einzutragen."
        onClick={() => setAddStudentOpen(true)}
        aria-label="Kind hinzufügen"
        className="gap-1.5"
      >
        <Plus aria-hidden="true" className="size-4" />
        Kind
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

  const footer =
    moreAdd.length > 0 || listFooter ? (
      <div className="flex flex-col gap-4">
        {moreAdd}
        {listFooter}
      </div>
    ) : null;

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
        detail={
          splitRow ? (
            // Am iPad quer stehen die Karten vom Listenende (Kinder
            // unterwegs, beendete Blöcke) unter dem Kind in der rechten
            // Spalte statt unter der ganzen Fläche.
            <div className="flex flex-col gap-4">
              <SupervisionChildDetail
                row={splitRow}
                href={studentProfileHref?.(splitRow)}
                lines={linesFor(splitRow)}
                actions={contextFor(splitRow, false)}
              />
              {footer}
            </div>
          ) : null
        }
        empty="Tippe links auf ein Kind, um es hier zu sehen."
      />
      {isSplit && splitRow ? null : footer}

      <SupervisionChildSheet
        row={sheetRow}
        pickupOverdue={
          sheetRow
            ? overduePickupColor(sheetRow, now, roster.instance.date) !== null
            : false
        }
        href={sheetRow ? studentProfileHref?.(sheetRow) : undefined}
        canRead={studentProfileHref !== undefined}
        roomId={roster.instance.roomId}
        lines={sheetRow ? linesFor(sheetRow) : null}
        actions={sheetRow ? contextFor(sheetRow, true) : null}
        onClose={() => setSheetChildId(null)}
      />

      {primary ? (
        <ActionBar
          secondary={
            onHandOver || endEntry ? (
              // Übergeben und Beenden sichtbar neben der Hauptaktion; Beenden
              // fragt vorher nach, ein versehentlicher Tipp beendet nichts.
              <div className="flex gap-2">
                {onHandOver ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="md"
                    tooltip="Öffnet die Übergabe an eine andere Betreuungsperson."
                    onClick={onHandOver}
                  >
                    Übergeben
                  </Button>
                ) : null}
                {endEntry ? (
                  <Button
                    type="button"
                    variant="outline_danger"
                    size="md"
                    disabled={endEntry.disabled}
                    disabledReason={
                      endEntry.disabled ? endEntry.description : undefined
                    }
                    tooltip="Beendet die Aktivität für alle Kinder. moto fragt vorher nach."
                    onClick={endEntry.onClick}
                  >
                    Beenden
                  </Button>
                ) : null}
              </div>
            ) : undefined
          }
        >
          {primary}
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
 * Das Kind aus der Aufsicht als `Student` für das Kind-Blatt: dieselbe
 * schlanke Zeile, die die Kindersuche lädt (Ankunft, Gehzeit, Heimweg des
 * Tages), damit beide Blätter dasselbe zeigen. Bis sie da ist (und ohne
 * Leserecht) steht, was die Aufsicht selbst weiß.
 */
function useRosterStudent(
  row: TimetableRosterRow | null,
  canRead: boolean,
  roomId?: string,
): { student: Student | null; loaded: boolean } {
  const today = berlinTodayISO();
  const base: StudentSearchFilterInput = {
    search: "",
    groupIds: [],
    schoolClasses: [],
    years: [],
    roomId: "",
    dayStatus: "all",
    date: today,
    isToday: true,
    bus: "all",
    photoConsent: "all",
    pickupStatus: "all",
    companions: false,
  };
  // Die Kinder im Raum lädt das Blatt vorab, mit einer Abfrage, sobald die
  // Aufsicht steht: Das Blatt zeigt beim Öffnen gleich Ankunft, Gehzeit und
  // Heimweg (#8070), statt kurz nur Klasse und Gruppe.
  const inRoom: StudentSearchFilterInput = { ...base, roomId: roomId ?? "" };
  const room = useSWRAuth(
    canRead && roomId && roomId !== "0"
      ? studentKeys.search({ ...inRoom, photoState: "aufsicht" })
      : null,
    () => fetchStudentSearch(buildStudentSearchFilters(inRoom), today, true),
    { revalidateOnFocus: false },
  );
  const roomMatch = row
    ? room.data?.students.find((student) => student.id === row.studentId)
    : undefined;
  // Wer nicht (mehr) im Raum ist, kommt einzeln über den Namen.
  const search: StudentSearchFilterInput = {
    ...base,
    search: row ? childName(row) : "",
  };
  const slim = useSWRAuth(
    row && canRead && !roomMatch && !room.isLoading
      ? studentKeys.search({ ...search, photoState: "aufsicht" })
      : null,
    () => fetchStudentSearch(buildStudentSearchFilters(search), today, true),
    { revalidateOnFocus: false },
  );
  if (!row) return { student: null, loaded: false };
  const match =
    roomMatch ??
    slim.data?.students.find((student) => student.id === row.studentId);
  if (match) return { student: match, loaded: true };
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
      // Zeiten erst mit der Zeile der Kindersuche: sie kennt die Rechte.
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
  pickupOverdue,
  href,
  canRead,
  roomId,
  lines,
  actions,
  onClose,
}: Readonly<{
  row: TimetableRosterRow | null;
  pickupOverdue: boolean;
  href?: string;
  /** Darf die Akten lesen: dann lädt das Blatt die Kinder im Raum vorab. */
  canRead: boolean;
  roomId: string;
  lines: ReactNode;
  actions: ReactNode;
  onClose: () => void;
}>) {
  const { student, loaded } = useRosterStudent(row, canRead, roomId);
  return (
    <ChildSheet
      student={student}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      href={href}
      quickActions={false}
      status={
        // „Da bis 15:30“ grün neben „Geht 15:30, überfällig“ rot widersprach
        // sich. Ist die Gehzeit vorbei, sagt es die rote Zeile „Gehen heute“
        // allein: ein zweites Abzeichen („Gehzeit überfällig“) nannte
        // denselben Hinweis mit anderen Worten (Runde 19).
        loaded ? (pickupOverdue ? NO_STATUS : undefined) : NO_STATUS
      }
      contextActions={lines}
      // Die Aktionen stehen gebündelt in der Fußleiste über der Akte.
      footerActions={actions}
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
  lines,
  actions,
}: Readonly<{
  row: TimetableRosterRow;
  href?: string;
  lines: ReactNode;
  actions: ReactNode;
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
        contextActions={lines}
        header
      />
      {/* Alle Aktionen in einer Reihe am Ende, gleich gebaut wie im Blatt:
          die Aufsicht-Aktionen zuerst, die Akte als Nebenweg. */}
      <div className="mt-5 flex flex-col gap-2">
        {actions}
        {href ? (
          <ButtonLink
            href={href}
            variant="outline"
            size="md"
            className="w-full"
            tooltip="Öffnet die ganze Akte mit allen Angaben."
          >
            Ganze Akte öffnen
          </ButtonLink>
        ) : null}
      </div>
    </SectionCard>
  );
}

/**
 * Was nur die Aufsicht über das Kind weiß (Ankunft, Hinweise der Planung,
 * Grund der Abwesenheit).
 */
function SupervisionChildLines({
  row,
  now,
  rosterDate,
}: Readonly<{ row: TimetableRosterRow; now: Date; rosterDate: string }>) {
  return (
    <div className="text-sm text-gray-700 empty:hidden">
      <RosterStudentDetailLines
        row={row}
        now={now}
        rosterDate={rosterDate}
        showPickupTime={false}
      />
    </div>
  );
}

/** Alle Aktionen für das Kind in diesem Block, als eine Knopfreihe. */
function SupervisionChildActions({
  row,
  access,
  inSheet,
  busy,
  onAction,
  onHomework,
}: Readonly<{
  row: TimetableRosterRow;
  access: RosterActionAccess;
  inSheet: boolean;
  busy: string | null;
  onAction: (action: RosterAction) => void;
  onHomework?: () => void;
}>) {
  const actions = sheetActions(row, access);
  if (actions.length === 0 && !onHomework) return null;
  return (
    <div
      role="group"
      className={inSheet ? "flex gap-2" : "flex flex-wrap gap-2"}
      aria-label="Aktionen in der Aufsicht"
    >
      {actions.map(({ action, label, tooltip }, index) => (
        <Button
          key={`${action}-${label}`}
          type="button"
          size="md"
          // Im Blatt ist die erste Aufsicht-Aktion die Hauptaktion; neben ihr
          // steht „Ganze Akte öffnen“ als Nebenweg.
          variant={
            index === 0 && action === "check-in"
              ? "success"
              : index === 0 && inSheet
                ? "primary"
                : "outline"
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
  );
}
