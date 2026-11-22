"use client";

import { useCallback, useState, type ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { Modal } from "~/components/ui/modal";
import type { Student } from "~/lib/student-helpers";
import {
  checkoutConfirmationRoom,
  type CheckinBulkAction,
  type useSchoolCheckinMode,
} from "~/lib/hooks/use-school-checkin-mode";
import { pullCandidates } from "~/components/students/school-checkin-bulk-target";
import type {
  SchoolCheckinAction,
  SchoolCheckoutReason,
} from "~/lib/student-api";

/** „angemeldet“, „abgemeldet“, „geholt“: the word a dialog uses for a run. */
const DONE_WORD: Record<CheckinBulkAction, string> = {
  in: "angemeldet",
  out: "abgemeldet",
  pull: "geholt",
};

/**
 * Snapshot of one student a bulk action operates on (#2359): the id for the
 * API call plus the display name for the failure dialog. Taken from the
 * Student row at snapshot time because the row itself can leave the result
 * set (live update, changed filter) while a dialog still has to name — and
 * retry — the child (review #2372).
 */
interface BulkStudentRef {
  id: string;
  name: string;
}

function toBulkStudentRef(student: Student): BulkStudentRef {
  return {
    id: student.id.toString(),
    name:
      `${student.first_name ?? ""} ${student.second_name ?? ""}`.trim() ||
      student.name,
  };
}

type SchoolCheckin = ReturnType<typeof useSchoolCheckinMode>;

interface BulkCheckinActions {
  /**
   * Runs Anmelden/Abmelden/Holen for the visible selection, asking first
   * where needed. „Holen“ takes only the marked children who are present
   * outside the target.
   */
  readonly handleBulkAction: (action: CheckinBulkAction) => void;
  /** The action currently running, so only its button shows a spinner. */
  readonly runningBulkAction: CheckinBulkAction | null;
  /** Confirmation and failure dialogs; render them in the page's overlays. */
  readonly dialogs: ReactNode;
}

/**
 * Bulk Anmelden/Abmelden of the marked children (#2359), shared by every
 * page that lists children (#3834). `selectedStudents` must be the VISIBLE
 * marked rows (client-side filters applied), never the raw selection: the
 * executed batch covers exactly what is on screen, so a mark hidden by a
 * filter is never acted on sight-unseen (review #2372).
 */
export function useBulkCheckinActions(
  schoolCheckin: SchoolCheckin,
  selectedStudents: readonly Student[],
  /**
   * Called after a run the backend processed, also a partly failed one: the
   * page then points at the children who are still missing (#4762).
   */
  onRunProcessed?: (action: SchoolCheckinAction) => void,
  /** The room chosen under „Anmelden in“; „Holen“ needs it. */
  targetRoomName?: string | null,
): BulkCheckinActions {
  // Checking a child out of a room ends the running visit, so a batch with
  // children in rooms asks once (#2359). The dialog holds a SNAPSHOT of the
  // selection taken when it opened, and confirming executes exactly that
  // snapshot: the live selection can shift underneath an open dialog, and the
  // operation must stay the one the user confirmed (review #2372).
  const [pendingBulkCheckout, setPendingBulkCheckout] = useState<{
    students: BulkStudentRef[];
    roomCount: number;
  } | null>(null);
  // Per-child failures, named for the user. Carries id+name snapshots: the
  // dialog's own retry executes exactly this list, which keeps the one-tap
  // retry reachable even when a scope change hid the retained marks
  // (review #2372).
  const [bulkFailures, setBulkFailures] = useState<{
    action: CheckinBulkAction;
    reason?: SchoolCheckoutReason;
    succeeded: number;
    students: BulkStudentRef[];
  } | null>(null);
  const [runningBulkAction, setRunningBulkAction] =
    useState<CheckinBulkAction | null>(null);

  // Runs the bulk action for an explicit snapshot list. runBulk executes the
  // snapshot exactly as given — deliberately NOT intersected with the live
  // selection, so a dialog always executes what it displayed (review #2372).
  const executeBulk = useCallback(
    async (
      action: CheckinBulkAction,
      targets: readonly BulkStudentRef[],
      reason?: SchoolCheckoutReason,
    ) => {
      // The snapshot names travel with the ids: after the run the hook
      // shrinks the selection to the failed students, and the failure
      // dialog must still name (and be able to retry) them.
      const nameById = new Map(
        targets.map((target) => [target.id, target.name]),
      );

      setRunningBulkAction(action);
      try {
        const ids = targets.map((target) => target.id);
        const outcome = await (reason
          ? schoolCheckin.runBulk(action, ids, reason)
          : schoolCheckin.runBulk(action, ids));
        // null: nothing selected or whole request failed (hook toasted the
        // error). failed === 0: the hook toasted the success summary.
        if (!outcome) return;
        // Keep the callback from the render in which this run began. A page
        // can change its filters while the request is pending; a completion
        // must then not report the result against that newer list.
        if (action !== "pull") onRunProcessed?.(action);
        if (outcome.failed === 0) return;

        setBulkFailures({
          action,
          reason,
          succeeded: outcome.succeeded,
          students: outcome.results
            .filter((result) => !result.ok)
            .map((result) => ({
              id: result.studentId,
              name:
                nameById.get(result.studentId) ?? `Kind #${result.studentId}`,
            })),
        });
      } finally {
        setRunningBulkAction(null);
      }
    },
    [schoolCheckin, onRunProcessed],
  );

  const handleBulkAction = useCallback(
    (action: CheckinBulkAction) => {
      if (selectedStudents.length === 0) return;
      if (action === "pull") {
        if (!targetRoomName) return;
        const present = pullCandidates(selectedStudents, targetRoomName);
        if (present.length === 0) return;
        void executeBulk(action, present.map(toBulkStudentRef));
        return;
      }
      if (action === "out") {
        // Same rule as the single tap (#2220): checking a child out of a room
        // ends the running visit, so that asks first — once per batch.
        const roomCount = selectedStudents.filter(
          (student) =>
            checkoutConfirmationRoom(student.current_location) !== null,
        ).length;
        if (roomCount > 0) {
          setPendingBulkCheckout({
            students: selectedStudents.map(toBulkStudentRef),
            roomCount,
          });
          return;
        }
      }
      void executeBulk(action, selectedStudents.map(toBulkStudentRef));
    },
    [selectedStudents, executeBulk, targetRoomName],
  );

  const confirmBulkCheckout = (reason?: SchoolCheckoutReason) => {
    if (!pendingBulkCheckout) return;
    const snapshot = pendingBulkCheckout.students;
    setPendingBulkCheckout(null);
    void executeBulk("out", snapshot, reason);
  };

  const dialogs = (
    <>
      <Modal
        isOpen={pendingBulkCheckout !== null}
        onClose={() => setPendingBulkCheckout(null)}
        title="Ausgewählte Kinder abmelden?"
        mobileSheet
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={() => setPendingBulkCheckout(null)}
              noTooltip="Schließt die Frage, kein Kind wird abgemeldet."
            >
              Abbrechen
            </Button>
            <Button
              type="button"
              variant="surface"
              size="md"
              onClick={() => confirmBulkCheckout("class")}
              tooltip="Meldet die Kinder sofort ab, weil sie zum Unterricht gehen."
            >
              {pendingBulkCheckout?.students.length === 1
                ? "Geht zum Unterricht"
                : "Alle zum Unterricht"}
            </Button>
            <Button
              type="button"
              variant="danger"
              size="md"
              onClick={() => confirmBulkCheckout()}
              tooltip="Meldet die Kinder sofort ab, weil sie nach Hause gehen."
            >
              {pendingBulkCheckout?.students.length === 1
                ? "Geht nach Hause"
                : "Alle nach Hause"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-600">
          <span className="font-medium text-gray-900">
            {pendingBulkCheckout?.students.length}
          </span>{" "}
          {pendingBulkCheckout?.students.length === 1
            ? "Kind ist"
            : "Kinder sind"}{" "}
          ausgewählt,{" "}
          <span className="font-medium text-gray-900">
            {pendingBulkCheckout?.roomCount}
          </span>{" "}
          davon {pendingBulkCheckout?.roomCount === 1 ? "ist" : "sind"} gerade
          in einem Raum. Beim Abmelden werden laufende Raumbesuche beendet.
          {(pendingBulkCheckout?.students.length ?? 0) > 1
            ? " Deine Wahl gilt für alle ausgewählten Kinder, auch ohne Raum."
            : null}
        </p>
      </Modal>

      {/* Per-child failures of a bulk action, named (#2359). The retry button
          executes the dialog's OWN snapshot — the named children on screen
          right here — so the promised one-tap retry stays reachable even
          when a scope change hid their rows (review #2372). */}
      <Modal
        isOpen={bulkFailures !== null}
        onClose={() => setBulkFailures(null)}
        title={
          bulkFailures
            ? `Nicht alle Kinder ${DONE_WORD[bulkFailures.action]}`
            : ""
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            {bulkFailures?.succeeded === 1
              ? "1 Kind wurde"
              : `${bulkFailures?.succeeded} Kinder wurden`}{" "}
            {bulkFailures ? DONE_WORD[bulkFailures.action] : ""}. Bei
            {bulkFailures?.students.length === 1
              ? " diesem Kind"
              : ` diesen ${bulkFailures?.students.length} Kindern`}{" "}
            hat es nicht geklappt:
          </p>
          <ul className="list-inside list-disc text-sm font-medium text-gray-900">
            {bulkFailures?.students.map((student) => (
              <li key={student.id}>{student.name}</li>
            ))}
          </ul>
          <p className="text-sm text-gray-600">
            Diese Kinder bleiben ausgewählt. Mit „Erneut versuchen“ führst du
            die Aktion für diese Kinder noch einmal aus. Geänderte Filter
            blenden sie dabei nicht aus.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={() => setBulkFailures(null)}
              noTooltip="Schließt die Meldung, die Kinder bleiben ausgewählt."
            >
              Schließen
            </Button>
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={() => {
                if (!bulkFailures) return;
                const {
                  action,
                  reason,
                  students: failedStudents,
                } = bulkFailures;
                setBulkFailures(null);
                void executeBulk(action, failedStudents, reason);
              }}
              tooltip={
                bulkFailures?.action === "pull"
                  ? "Holt die übrigen Kinder sofort noch einmal in den Raum."
                  : bulkFailures?.action === "in"
                    ? "Meldet die übrigen Kinder sofort noch einmal an."
                    : "Meldet die übrigen Kinder sofort noch einmal ab."
              }
            >
              Erneut versuchen
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );

  return { handleBulkAction, runningBulkAction, dialogs };
}
