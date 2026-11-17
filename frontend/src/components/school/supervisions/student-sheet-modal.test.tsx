import { render as renderPlain, screen } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

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
