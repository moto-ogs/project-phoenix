import { schoolDateCases, setSchoolDateClock } from "~/test/school-date-cases";
import { afterEach as restoreZoneAfterEach, vi as zoneVi } from "vitest";
import { SessionProvider } from "next-auth/react";
import { SWRConfig } from "~/lib/swr/testing";

vi.unmock("swr");
restoreZoneAfterEach(() => zoneVi.unstubAllEnvs());
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SAVED_BUT_STALE_SUFFIX } from "~/lib/hooks/use-refresh-after-write";
import { ABSENCES_REFRESH_EVENT } from "~/lib/absence-helpers";
import { ApiError } from "~/lib/api-error";
import { catalogText } from "~/test/error-catalog-text";
import { berlinTodayISO } from "~/lib/date-helpers";
import type {
  OwnLeaveOverview,
  OwnTimeAbsence,
} from "~/lib/contract/time-tracking.generated";
import type { StaffAbsence } from "~/lib/time-tracking-helpers";

import { LeaveRequestsCard } from "./leave-requests-card";

const mocks = vi.hoisted(() => ({
  cancelAbsence: vi.fn(),
  getAbsences: vi.fn(),
  questions: vi.fn(),
  getLeaveOverview: vi.fn(),
  recent: vi.fn(),
  quota: vi.fn(),
  resubmitAbsence: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  useOwnAbsenceRequestMails: vi.fn(
    (
      _waitingIds: readonly string[],
    ): {
      mails: Record<string, Record<string, number>>;
      loadError: null;
    } => ({ mails: {}, loadError: null }),
  ),
}));

function wireAbsence(row: StaffAbsence): OwnTimeAbsence {
  return {
    id: row.id,
    absence_type: row.absenceType,
    absence_type_id: row.absenceTypeId ?? undefined,
    absence_type_label: row.absenceTypeLabel,
    date_start: row.dateStart,
    date_end: row.dateEnd,
    half_day: row.halfDay,
    start_half_day: row.startHalfDay,
    end_half_day: row.endHalfDay,
    note: row.note,
    status: row.status,
    decision_note: row.decisionNote,
    requested_at: row.requestedAt,
    duration_days: row.durationDays,
    working_days: row.workingDays ?? undefined,
  };
}

async function leaveOverview(): Promise<OwnLeaveOverview> {
  const today = berlinTodayISO();
  const quota = await mocks.quota();
  const recent: StaffAbsence[] = await mocks.recent();
  const questions: StaffAbsence[] = await mocks.questions();
  return {
    year: Number(today.slice(0, 4)),
    quota: { taken_before_days: 0, ...quota },
    counts: {
      question: questions.length,
      reserved: recent.filter((row) => row.status === "requested").length,
      approved: recent.filter(
        (row) =>
          (row.status === "approved" || row.status === "reported") &&
          row.dateEnd >= today,
      ).length,
      declined: recent.filter((row) => row.status === "declined").length,
    },
    recent: recent
      .filter((row) => row.status !== "question")
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
      .slice(0, 8)
      .map(wireAbsence),
    questions: [...questions]
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
      .map(wireAbsence),
    allowances: [],
    mails: { state: "ready", awaiting_feedback: false, absences: {} },
  };
}

vi.mock("~/components/ui/modal", () => ({
  ConfirmationModal: ({
    isOpen,
    onConfirm,
    children,
  }: {
    readonly isOpen: boolean;
    readonly onConfirm: () => void;
    readonly children: ReactNode;
  }) =>
    isOpen ? (
      <div>
        {children}
        <button type="button" onClick={onConfirm}>
          Stornierung bestätigen
        </button>
      </div>
    ) : null,
}));

vi.mock("~/contexts/ToastContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/contexts/ToastContext")>()),
  useToast: () => ({
    error: mocks.toastError,
    success: mocks.toastSuccess,
  }),
}));

vi.mock("~/lib/hooks/use-current-timestamp", () => ({
  useCurrentTimestamp: () => new Date("2027-06-01T10:00:00Z").getTime(),
}));

vi.mock("~/lib/time-tracking-api", () => ({
  timeTrackingService: {
    cancelAbsence: mocks.cancelAbsence,
    getAbsences: mocks.getAbsences,
    getLeaveOverview: mocks.getLeaveOverview,
    resubmitAbsence: mocks.resubmitAbsence,
  },
}));

vi.mock("./vacation-request-modal", () => ({
  VacationRequestModal: () => null,
}));

// The mail status of the waiting requests (#7058) comes from its own hook;
// the card decides which requests ask for it and where it shows.
vi.mock("~/components/staff/absence-mail-status", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/components/staff/absence-mail-status")
  >()),
  useOwnAbsenceRequestMails: mocks.useOwnAbsenceRequestMails,
}));

function resubmittedVacation(): StaffAbsence {
  return {
    id: "17",
    staffId: "42",
    absenceType: "vacation",
    dateStart: "2027-07-10",
    dateEnd: "2027-07-11",
    halfDay: false,
    startHalfDay: false,
    endHalfDay: false,
    note: "Vertretung ist geklärt",
    status: "requested",
    approvedBy: null,
    approvedAt: null,
    createdBy: "42",
    createdAt: "2027-06-01T08:00:00Z",
    updatedAt: "2027-06-02T08:00:00Z",
    durationDays: 2,
    workingDays: 2,
    decisionNote: "Wer übernimmt die Frühschicht?",
    requestedAt: "2027-06-02T08:00:00Z",
    substituteStaffId: null,
  };
}

describe("LeaveRequestsCard resubmitted requests", () => {
  beforeEach(() => {
    mocks.cancelAbsence.mockReset();
    mocks.getAbsences.mockReset();
    mocks.recent.mockReset();
    mocks.getLeaveOverview.mockImplementation(leaveOverview);
    mocks.questions.mockReset();
    mocks.quota.mockReset();
    mocks.resubmitAbsence.mockReset();
    mocks.toastError.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.cancelAbsence.mockResolvedValue(undefined);
    mocks.recent.mockResolvedValue([resubmittedVacation()]);
    mocks.questions.mockResolvedValue([]);
    mocks.quota.mockResolvedValue({
      staff_id: 42,
      year: 2027,
      entitled_days: 20,
      carryover_days: 0,
      taken_days: 0,
      reserved_days: 2,
      remaining_days: 18,
    });
  });

  it("labels the retained question and refreshes the badge after cancellation", async () => {
    const listener = vi.fn();
    window.addEventListener(ABSENCES_REFRESH_EVENT, listener);

    renderWithCache(<LeaveRequestsCard />);

    expect(
      await screen.findByText("Vorherige Rückfrage der Leitung:"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stornieren" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Stornierung bestätigen" }),
    );

    await waitFor(() => {
      expect(mocks.cancelAbsence).toHaveBeenCalledWith("17");
      expect(listener).toHaveBeenCalledTimes(1);
    });
    window.removeEventListener(ABSENCES_REFRESH_EVENT, listener);
  });

  it("keeps confirmed requests and offers a reload-only retry after a saved cancellation", async () => {
    renderWithCache(<LeaveRequestsCard />);
    expect(
      await screen.findByText("Vorherige Rückfrage der Leitung:"),
    ).toBeVisible();
    mocks.quota.mockRejectedValueOnce(
      new ApiError("offline", 503, { code: "general.unavailable" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Stornieren" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Stornierung bestätigen" }),
    );
    expect(
      await screen.findByText(
        `${catalogText("general.unavailable", "die Urlaubsübersicht")} ${SAVED_BUT_STALE_SUFFIX}`,
      ),
    ).toBeVisible();
    expect(screen.getByText("Vorherige Rückfrage der Leitung:")).toBeVisible();
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Der Antrag ist storniert.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    await waitFor(() => expect(mocks.quota).toHaveBeenCalledTimes(3));
    expect(mocks.cancelAbsence).toHaveBeenCalledTimes(1);
  });

  it("keeps old and cross-year questions outside the eight-request limit", async () => {
    const currentYear = new Date().getFullYear();
    const oldQuestion: StaffAbsence = {
      ...resubmittedVacation(),
      id: "question-old",
      dateStart: `${currentYear}-02-10`,
      dateEnd: `${currentYear}-02-11`,
      note: "Alte Rückfrage",
      status: "question",
      requestedAt: `${currentYear}-01-01T08:00:00Z`,
    };
    const crossYearQuestion: StaffAbsence = {
      ...oldQuestion,
      id: "question-next-year",
      dateStart: `${currentYear + 1}-02-10`,
      dateEnd: `${currentYear + 1}-02-11`,
      note: "Rückfrage im Folgejahr",
      requestedAt: `${currentYear}-01-02T08:00:00Z`,
    };
    const recentRequests = Array.from({ length: 9 }, (_, index) => ({
      ...resubmittedVacation(),
      id: `recent-${index}`,
      dateStart: `${currentYear}-07-${String(index + 1).padStart(2, "0")}`,
      dateEnd: `${currentYear}-07-${String(index + 1).padStart(2, "0")}`,
      note: `Neuer Antrag ${index + 1}`,
      decisionNote: "",
      requestedAt: `${currentYear}-06-${String(index + 1).padStart(2, "0")}T08:00:00Z`,
    }));
    mocks.recent.mockResolvedValue([...recentRequests, oldQuestion]);
    mocks.questions.mockResolvedValue([oldQuestion, crossYearQuestion]);

    renderWithCache(<LeaveRequestsCard />);

    expect(await screen.findByText("Rückfragen")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Alte Rückfrage")).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("Rückfrage im Folgejahr"),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", {
        name: "Antwort senden & erneut einreichen",
      }),
    ).toHaveLength(2);
    expect(screen.getAllByRole("listitem")).toHaveLength(10);
    expect(screen.queryByText("Neuer Antrag 1")).not.toBeInTheDocument();
    expect(screen.getByText("Neuer Antrag 9")).toBeInTheDocument();
  });

  it("reports a too short answer at the field and a failed resubmit above it, never as a toast", async () => {
    const question: StaffAbsence = {
      ...resubmittedVacation(),
      id: "question-1",
      note: "",
      status: "question",
    };
    mocks.recent.mockResolvedValue([]);
    mocks.questions.mockResolvedValue([question]);
    mocks.resubmitAbsence.mockRejectedValue(
      new ApiError("Server weg", 500, {
        code: "general.server",
        instance: "req-resubmit",
      }),
    );

    renderWithCache(<LeaveRequestsCard />);

    const submit = await screen.findByRole("button", {
      name: "Antwort senden & erneut einreichen",
    });
    fireEvent.click(submit);
    expect(
      await screen.findByText("Bitte gib eine kurze Antwort ein."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Deine Antwort")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(mocks.resubmitAbsence).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Deine Antwort"), {
      target: { value: "Vertretung ist geklärt." },
    });
    fireEvent.click(submit);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      catalogText("general.server", "die Antwort"),
    );
    expect(screen.queryByText(/Server weg/)).not.toBeInTheDocument();
    // „Wiederholen“ sendet die aktuelle Antwort erneut.
    mocks.resubmitAbsence.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    await waitFor(() => {
      expect(mocks.resubmitAbsence).toHaveBeenLastCalledWith(
        "question-1",
        "Vertretung ist geklärt.",
      );
    });
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("shows a failed load in the card instead of empty tiles", async () => {
    mocks.quota.mockRejectedValue(
      new ApiError("down", 503, {
        code: "general.unavailable",
        instance: "req-leave",
      }),
    );

    renderWithCache(<LeaveRequestsCard />);

    expect(
      await screen.findByText(
        catalogText("general.unavailable", "die Urlaubsübersicht"),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Resturlaub")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Urlaub beantragen" }),
    ).toBeDisabled();
    mocks.quota.mockResolvedValue({
      staff_id: 42,
      year: 2027,
      entitled_days: 20,
      carryover_days: 0,
      taken_days: 0,
      reserved_days: 2,
      remaining_days: 18,
    });
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    expect(await screen.findByText("Resturlaub")).toBeInTheDocument();
  });

  it("keeps a refused cancellation in the dialog", async () => {
    mocks.cancelAbsence.mockRejectedValue(
      new ApiError("forbidden", 403, { code: "general.permission" }),
    );

    renderWithCache(<LeaveRequestsCard />);

    fireEvent.click(await screen.findByRole("button", { name: "Stornieren" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Stornierung bestätigen" }),
    );

    expect(
      await screen.findByText(
        catalogText("general.permission", "die Stornierung"),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Stornierung bestätigen" }),
    ).toBeInTheDocument();
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it.each(schoolDateCases("2027-06-01"))(
    "counts an absence through the Berlin end date in %s",
    async (zone, instant) => {
      setSchoolDateClock(zone, instant, "2027-06-01");
      mocks.recent.mockResolvedValue([
        { ...resubmittedVacation(), dateEnd: "2027-06-01", status: "approved" },
      ]);
      renderWithCache(<LeaveRequestsCard />);
      await screen.findByText("20 Tage Anspruch für 2027");
      const tile = screen.getAllByText("Genehmigt")[0]!.parentElement!;
      expect(tile).toHaveTextContent("1");
      expect(mocks.getAbsences).not.toHaveBeenCalled();
    },
  );
});

describe("LeaveRequestsCard mail to the Leitung (#7058)", () => {
  beforeEach(() => {
    mocks.getAbsences.mockReset();
    mocks.recent.mockReset();
    mocks.getLeaveOverview.mockImplementation(leaveOverview);
    mocks.questions.mockReset();
    mocks.quota.mockReset();
    mocks.recent.mockResolvedValue([
      resubmittedVacation(),
      { ...resubmittedVacation(), id: "18", status: "approved" },
    ]);
    mocks.questions.mockResolvedValue([]);
    mocks.quota.mockResolvedValue({
      staff_id: 42,
      year: 2027,
      entitled_days: 20,
      carryover_days: 0,
      taken_days: 0,
      reserved_days: 2,
      remaining_days: 18,
    });
    // The status the server sends once the waiting request 17 is known; the
    // decided request 18 never shows one, even when the answer names it.
    mocks.useOwnAbsenceRequestMails.mockImplementation(
      (waitingIds: readonly string[]) => {
        const mails: Record<string, Record<string, number>> = waitingIds.some(
          (id) => id.startsWith("17-"),
        )
          ? {
              "17": { undeliverable: 1, delivered: 1 },
              "18": { delivered: 1 },
            }
          : {};
        return { mails, loadError: null };
      },
    );
  });
  afterEach(() => {
    mocks.useOwnAbsenceRequestMails.mockReset();
    mocks.useOwnAbsenceRequestMails.mockReturnValue({
      mails: {},
      loadError: null,
    });
  });

  it("shows under the waiting request whether the Leitung got the mail", async () => {
    renderWithCache(<LeaveRequestsCard />);

    expect(await screen.findByText("Mail an die Leitung")).toBeInTheDocument();
    expect(mocks.useOwnAbsenceRequestMails).toHaveBeenLastCalledWith(
      [expect.stringMatching(/^17-/)],
      expect.objectContaining({ state: "ready" }),
    );
    expect(screen.getByText("1 nicht zustellbar")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Eine Mail kam nicht an. Sage der Leitung direkt Bescheid.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("absence-mail-status")).toHaveLength(1);
  });
});

// Echter SWR-Cache je Render und eine Sitzung mit Konto, sonst liest
// useSWRAuth nichts.
function TenantSWR({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider
      session={{
        user: { id: "staff-test", tenantId: "1" },
        expires: "2099-01-01",
      }}
      refetchOnWindowFocus={false}
    >
      <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
        {children}
      </SWRConfig>
    </SessionProvider>
  );
}
const renderWithCache = (ui: React.ReactElement) =>
  render(ui, { wrapper: TenantSWR });
