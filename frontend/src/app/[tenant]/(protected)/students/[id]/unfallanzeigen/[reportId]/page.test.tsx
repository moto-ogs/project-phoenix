import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ADR 0311 on the real SWR cache: a refusal reads the stored report again.
vi.unmock("swr");

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "user-1" }, expires: "2099-01-01" },
    status: "authenticated",
  }),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "7", reportId: "9" }),
  usePathname: () => "/students/7/unfallanzeigen/9",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("~/lib/tenant-context", () => ({
  useTenantSlugSafe: () => "school-a",
}));

vi.mock("~/lib/auth-utils", () => ({
  hasPermission: () => true,
}));

vi.mock("~/lib/breadcrumb-context", () => ({
  useStudentHistoryBreadcrumb: () => undefined,
}));

vi.mock("~/lib/student-api", () => ({
  fetchStudent: () => Promise.resolve({ name: "Mia Muster" }),
}));

vi.mock("~/components/ui/tenant-page", () => ({
  TenantPage: ({
    title,
    error,
    loading,
    children,
  }: {
    title: string;
    error?: React.ReactNode;
    loading?: boolean;
    children: React.ReactNode;
  }) => (
    <main>
      <h1>{title}</h1>
      {loading ? <p>Lädt</p> : error ? <p>{error}</p> : children}
    </main>
  ),
  TenantPageStats: () => null,
}));

vi.mock("~/components/ui/signature-pad", () => ({
  SignaturePad: () => <div aria-label="Unterschriftsfeld" />,
}));

vi.mock("~/components/students/accident-report-create-modal", () => ({
  AccidentReportCreateModal: () => null,
}));

const list = vi.fn();
vi.mock("~/lib/student-documents-api", () => ({
  studentDocumentsService: {
    list: (...args: unknown[]) => list(...args) as unknown,
    downloadUrl: () => "/download",
  },
}));

const update = vi.fn();
vi.mock("~/lib/student-accident-reports-api", () => ({
  accidentReportPath: (studentId: string, reportId: string) =>
    `/students/${studentId}/unfallanzeigen/${reportId}`,
  studentAccidentReportsService: {
    update: (...args: unknown[]) => update(...args) as unknown,
    sign: vi.fn(),
    uploadPaperCopy: vi.fn(),
    pdfUrl: () => "/pdf",
  },
}));

import { ApiError } from "~/lib/api-error";
import { resetSWRScope } from "~/lib/swr/scope";
import type { AccidentReportDetails } from "~/lib/student-accident-reports-api";
import type { StudentDocumentList } from "~/lib/student-documents-api";
import AccidentReportPage from "./page";

function reportList(
  status: AccidentReportDetails["status"],
  version: string,
): StudentDocumentList {
  return {
    visibleCategories: [],
    documents: [
      {
        id: "9",
        studentId: "7",
        category: "unfallanzeige",
        categoryLabel: "Unfallanzeige",
        filename: "",
        sizeBytes: 0,
        contentType: "",
        uploadedAt: "2026-09-08T08:00:00Z",
        sensitive: true,
        hasFile: false,
        version,
        accidentReport: {
          status,
          version: 1,
          supersedesId: null,
          supersededById: null,
          signedAt: status === "signed" ? "2026-09-08T10:00:00Z" : null,
          signedDigitally: status === "signed",
          occurredAt: "2026-09-08T07:30:00Z",
          location: "Schulhof",
          description: "Beim Spielen gestolpert.",
          injuredBodyParts: "Knie",
          injuryKind: "Schürfwunde",
          witnesses: "",
          firstAid: "Pflaster",
          doctorVisited: false,
          doctor: "",
          parentsNotified: "",
          parentsNotifiedAt: null,
          supervisor: "Frau Beispiel",
        },
      },
    ],
  };
}

describe("AccidentReportPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSWRScope({ revalidate: false });
  });

  it("leaves the edit state with the message when someone signed the report meanwhile", async () => {
    list
      .mockResolvedValueOnce(reportList("open", "read"))
      .mockResolvedValue(reportList("signed", "signed"));
    update.mockRejectedValue(
      new ApiError("changed since it was read", 409, {
        code: "general.changed_since_read",
      }),
    );
    render(<AccidentReportPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Ändern" }));
    fireEvent.click(await screen.findByRole("button", { name: "Speichern" }));

    expect(await screen.findByText(/inzwischen geändert/)).toBeInTheDocument();
    expect(update).toHaveBeenCalledWith("7", "9", expect.any(Object), "read");
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Korrektur anlegen" }),
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Speichern" })).toBeNull();
    expect(screen.getByText("Unterschrieben")).toBeInTheDocument();
  });
});
