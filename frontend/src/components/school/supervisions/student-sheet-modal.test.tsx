import {
  act,
  fireEvent,
  render as renderPlain,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SWRConfig } from "~/lib/swr/testing";

// The sheet reads through the shared cache of the school portal.
vi.unmock("swr");
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "teacher", tenantId: 7, scope: "school" } },
    status: "authenticated",
  }),
}));

function Providers({ children }: { readonly children: ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
      {children}
    </SWRConfig>
  );
}

function render(ui: ReactElement) {
  return renderPlain(ui, { wrapper: Providers });
}

import { ApiError } from "~/lib/api-error";
import { catalogText } from "~/test/error-catalog-text";
import { schoolSupervisionsApi } from "~/lib/school-supervisions-api";
import type { SupervisionStudentSheet } from "~/lib/school-supervisions-api";
import { StudentSheetModal } from "./student-sheet-modal";

const sheet: SupervisionStudentSheet = {
  studentId: "7",
  firstName: "Emma",
  lastName: "Meyer",
  schoolClass: "1a",
  date: "2026-08-24",
  pickup: "15:30",
  departure: "Abholung",
  pickupContacts: [
    {
      name: "Petra Meyer",
      relationship: "parent",
      phones: ["0251 100021", "0251 999888"],
      note: "Nur mit Vollmacht",
    },
  ],
  emergencyContacts: [
    { name: "Jonas Meyer", relationship: "parent", phones: [] },
  ],
};

vi.mock("~/lib/school-supervisions-api", () => ({
  schoolSupervisionsApi: { studentSheet: vi.fn(() => Promise.resolve(sheet)) },
}));

describe("StudentSheetModal", () => {
  beforeEach(() => {
    vi.mocked(schoolSupervisionsApi.studentSheet)
      .mockReset()
      .mockResolvedValue(sheet);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reauthorizes each opening before showing contacts, including a refused reopening", async () => {
    const props = {
      instanceId: "1",
      studentId: "7",
      studentName: "Emma Meyer",
      onClose: vi.fn(),
    };
    const { rerender } = render(<StudentSheetModal {...props} />);
    await screen.findByRole("link", { name: "0251 100021" });

    rerender(<StudentSheetModal {...props} studentId={null} />);
    let reject!: (error: unknown) => void;
    vi.mocked(schoolSupervisionsApi.studentSheet).mockReturnValueOnce(
      new Promise((_resolve, no) => {
        reject = no;
      }),
    );
    rerender(<StudentSheetModal {...props} />);

    expect(
      screen.getByRole("dialog", { name: "Emma Meyer" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "0251 100021" }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(schoolSupervisionsApi.studentSheet).toHaveBeenCalledTimes(2),
    );
    await act(async () =>
      reject(new ApiError("forbidden", 403, { code: "general.permission" })),
    );
    expect(
      await screen.findByText(
        catalogText("general.permission", "das Infoblatt des Kindes"),
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "0251 100021" }),
    ).not.toBeInTheDocument();

    rerender(<StudentSheetModal {...props} studentId={null} />);
    rerender(<StudentSheetModal {...props} />);
    expect(
      await screen.findByRole("link", { name: "0251 100021" }),
    ).toBeInTheDocument();
    expect(schoolSupervisionsApi.studentSheet).toHaveBeenCalledTimes(3);
  });

  it("does not reload an audited sheet on reconnect", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(
      <StudentSheetModal
        instanceId="1"
        studentId="7"
        studentName="Emma Meyer"
        onClose={vi.fn()}
      />,
    );
    await screen.findByRole("link", { name: "0251 100021" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
      window.dispatchEvent(new Event("offline"));
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(schoolSupervisionsApi.studentSheet).toHaveBeenCalledTimes(1);
  });

  it("leaves a failed audited read to explicit retry", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(schoolSupervisionsApi.studentSheet).mockRejectedValueOnce(
      new ApiError("unavailable", 503, { code: "general.unavailable" }),
    );
    render(
      <StudentSheetModal
        instanceId="1"
        studentId="7"
        studentName="Emma Meyer"
        onClose={vi.fn()}
      />,
    );
    expect(
      await screen.findByText(
        catalogText("general.unavailable", "das Infoblatt des Kindes"),
      ),
    ).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(schoolSupervisionsApi.studentSheet).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    expect(
      await screen.findByRole("link", { name: "0251 100021" }),
    ).toBeInTheDocument();
    expect(schoolSupervisionsApi.studentSheet).toHaveBeenCalledTimes(2);
  });

  it("macht jede hinterlegte Nummer einzeln anrufbar", async () => {
    render(
      <StudentSheetModal
        instanceId="1"
        studentId="7"
        studentName="Emma Meyer"
        onClose={() => undefined}
      />,
    );

    // Eine Nummer, ein Link: ein tel:-Link mit zwei Nummern wählt keine davon.
    const first = await screen.findByRole("link", { name: "0251 100021" });
    const second = screen.getByRole("link", { name: "0251 999888" });

    expect(first).toHaveAttribute("href", "tel:0251100021");
    expect(second).toHaveAttribute("href", "tel:0251999888");
  });

  it("sagt es, wenn zu einem Kontakt keine Nummer hinterlegt ist", async () => {
    render(
      <StudentSheetModal
        instanceId="1"
        studentId="7"
        studentName="Emma Meyer"
        onClose={() => undefined}
      />,
    );

    expect(
      await screen.findByText("Keine Telefonnummer hinterlegt"),
    ).toBeInTheDocument();
  });
});
