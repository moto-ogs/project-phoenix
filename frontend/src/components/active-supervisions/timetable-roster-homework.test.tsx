import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ApiError } from "~/lib/api-error";
import { TEST_CLOCK_TODAY } from "~/test/clock";
import { catalogText } from "~/test/error-catalog-text";

import { TimetableRosterContent } from "./timetable-roster";
import type {
  HomeworkFeedbackBody,
  TimetableRoster,
  TimetableRosterRow,
} from "~/lib/timetable-operations-types";

// Hausaufgaben in der Lernzeit (#4796): die Zeile zeigt, was die Klasse zu
// tun hat, und der Knopf „Hausaufgaben“ sammelt die Rückmeldung.

vi.mock("~/lib/timetable-operations-api", () => ({
  timetableOperationsApi: { patchAttendance: vi.fn() },
}));

const row: TimetableRosterRow = {
  studentId: "42",
  studentName: "Mia Beispiel",
  schoolClass: "2a",
  groupName: "Sonnengruppe",
  planned: true,
  isUnplanned: false,
  currentlyPresent: true,
  visitId: "7",
  status: "present",
  substatus: null,
  note: null,
  checkedInAt: null,
  checkedOutAt: null,
  visitEntryTime: null,
  pickupTime: null,
  warnings: [],
  careDayStatus: "scheduled",
  parallelPresentIn: null,
  homework: [{ subject: "Mathe", description: "Seite 12" }],
  homeworkFeedbackVersion: "absent",
};

const withoutHomework: TimetableRosterRow = {
  ...row,
  studentId: "43",
  studentName: "Ben Ohne",
  homework: undefined,
};

const roster: TimetableRoster = {
  instance: {
    id: "instance-1",
    title: "Lernzeit",
    status: "active",
    isSpontaneous: false,
    activeGroupId: "group-1",
    roomId: "room-1",
    roomName: "Raum 1",
    date: TEST_CLOCK_TODAY,
    startTime: "11:30",
    endTime: "12:30",
    canComplete: false,
    completeAvailableAt: `${TEST_CLOCK_TODAY}T10:30:00Z`,
  },
  rows: [row, withoutHomework],
  pickupTimesLoaded: true,
  canEditAttendance: true,
  canRecordHomeworkFeedback: true,
};

function renderRoster(
  value: TimetableRoster,
  onSaveHomeworkFeedback?: (
    row: TimetableRosterRow,
    body: HomeworkFeedbackBody,
  ) => Promise<void>,
  reloadAfterRefusal?: () => Promise<TimetableRoster | null>,
) {
  render(
    <TimetableRosterContent
      addStudentSearch=""
      attendanceWebEnabled
      isAddingStudent={false}
      isCompletingInstance={false}
      isConfirmingExpected={false}
      roster={value}
      showTimetableCounts={false}
      canAddUnplanned={false}
      onAddStudent={vi.fn()}
      onComplete={vi.fn()}
      onConfirmExpected={vi.fn()}
      onRosterAction={vi.fn()}
      onSaveHomeworkFeedback={onSaveHomeworkFeedback}
      reloadAfterRefusal={reloadAfterRefusal}
      onSearchChange={vi.fn()}
    />,
  );
}

describe("Hausaufgaben in der Lernzeit (#4796)", () => {
  beforeAll(async () => {
    // The retry checks the dialog, not chunk loading. Load the real error
    // presenter before interactions so its import cannot exhaust the DOM timeout.
    await import("~/lib/error-presentation");
  });

  it("shows the class homework and saves the feedback with a trimmed note", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    renderRoster(roster, save);

    expect(
      screen.getByText("Hausaufgaben: Mathe: Seite 12"),
    ).toBeInTheDocument();
    // One button, for the child with homework only.
    expect(
      screen.getAllByRole("button", { name: "Hausaufgaben" }),
    ).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Hausaufgaben" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Mathe: Seite 12")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "War schwer" }));
    fireEvent.change(
      within(dialog).getByLabelText("Kurze Notiz (freiwillig)"),
      {
        target: { value: "  Aufgabe 3 " },
      },
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Rückmeldung speichern" }),
    );

    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(row, {
        status: "difficult",
        note: "Aufgabe 3",
        expected_version: "absent",
      }),
    );
  });

  it("shows the stored feedback after a refusal and saves with its token", async () => {
    const stored: TimetableRosterRow = {
      ...row,
      homeworkFeedback: { status: "not_done", note: "von Kollegin" },
      homeworkFeedbackVersion: "v2",
    };
    const save = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError("changed", 409, { code: "general.changed_since_read" }),
      )
      .mockResolvedValue(undefined);
    const reload = vi.fn().mockResolvedValue({ ...roster, rows: [stored] });
    renderRoster(roster, save, reload);
    fireEvent.click(screen.getByRole("button", { name: "Hausaufgaben" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "War schwer" }));
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Rückmeldung speichern" }),
    );

    // ADR 0311: the dialog shows the feedback a colleague gave meanwhile,
    // says so, and offers no retry of the refused answer.
    expect(
      await within(dialog).findByText(
        catalogText("general.changed_since_read", "die Rückmeldung"),
      ),
    ).toBeInTheDocument();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(
      within(dialog).getByLabelText("Kurze Notiz (freiwillig)"),
    ).toHaveValue("von Kollegin");
    expect(
      within(dialog).queryByRole("button", { name: "Wiederholen" }),
    ).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Fertig" }));
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Rückmeldung speichern" }),
    );
    await waitFor(() =>
      expect(save).toHaveBeenLastCalledWith(stored, {
        status: "done",
        note: "von Kollegin",
        expected_version: "v2",
      }),
    );
  });

  it("retries homework feedback using the edited answer and note", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new ApiError("failed", 503))
      .mockResolvedValue(undefined);
    renderRoster(roster, save);
    fireEvent.click(screen.getByRole("button", { name: "Hausaufgaben" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "War schwer" }));
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Rückmeldung speichern" }),
    );
    const retry = await within(dialog).findByRole("button", {
      name: "Wiederholen",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Fertig" }));
    fireEvent.change(
      within(dialog).getByLabelText("Kurze Notiz (freiwillig)"),
      { target: { value: "edited" } },
    );
    fireEvent.click(retry);
    await waitFor(() =>
      expect(save).toHaveBeenLastCalledWith(row, {
        status: "done",
        note: "edited",
        expected_version: "absent",
      }),
    );
  });

  it("asks for an answer before saving", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    renderRoster(roster, save);

    fireEvent.click(screen.getByRole("button", { name: "Hausaufgaben" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Rückmeldung speichern" }),
    );

    expect(
      await within(dialog).findByText("Bitte wähle eine Antwort."),
    ).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it("shows the given feedback and keeps it read-only outside a Lernzeit", () => {
    renderRoster(
      {
        ...roster,
        canRecordHomeworkFeedback: false,
        rows: [
          { ...row, homeworkFeedback: { status: "done", note: "alles gut" } },
        ],
      },
      vi.fn(),
    );

    expect(screen.getByText("Rückmeldung: Fertig")).toBeInTheDocument();
    expect(screen.getByText("alles gut")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Hausaufgaben" }),
    ).not.toBeInTheDocument();
  });
});
