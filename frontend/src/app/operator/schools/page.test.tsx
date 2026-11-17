/**
 * Tests for Operator Schulen Page (Schools management).
 *
 * Ported from provisioning/page.test.tsx — now focused on the directory
 * behaviour of the schools overview plus create/trash flows.
 */
import {
  render as renderPlain,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import { catalogText } from "~/test/error-catalog-text";

function render(ui: React.ReactElement) {
  return renderPlain(ui, { wrapper: ToastProvider });
}

const {
  mockUseSession,
  mockUseSWR,
  mockMutateOrgs,
  mockMutateSchools,
  mockMutateRequiredDetails,
  mockListOrganizations,
  mockListSchools,
  mockCreateSchool,
  mockUpdateSchool,
  mockInviteSchoolAdmin,
  mockSoftDeleteSchool,
  mockRestoreSchool,
  mockPush,
  mockReplace,
} = vi.hoisted(() => ({
  mockUseSession: vi.fn(),
  mockUseSWR: vi.fn(),
  mockMutateOrgs: vi.fn(),
  mockMutateSchools: vi.fn(),
  mockMutateRequiredDetails: vi.fn(),
  mockListOrganizations: vi.fn(),
  mockListSchools: vi.fn(),
  mockCreateSchool: vi.fn(),
  mockUpdateSchool: vi.fn(),
  mockInviteSchoolAdmin: vi.fn(),
  mockSoftDeleteSchool: vi.fn(),
  mockRestoreSchool: vi.fn(),
  mockPush: vi.fn(),
  mockReplace: vi.fn(),
}));

vi.mock("next-auth/react", () => ({
  useSession: mockUseSession,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

vi.mock("~/lib/operator-url", () => ({
  isOperatorSubdomain: () => false,
  operatorPath: (path: string) =>
    path.startsWith("/operator") ? path : `/operator${path}`,
}));

vi.mock("~/lib/breadcrumb-context", () => ({
  useSetBreadcrumb: vi.fn(),
}));

vi.mock("~/lib/swr", () => ({
  useSWRAuth: mockUseSWR,
  useSWRConfig: () => ({ mutate: vi.fn() }),
  useTenantMutateMatching: () => vi.fn(async () => []),
}));

vi.mock("~/lib/operator/provisioning-api", async () => {
  const actual = await vi.importActual<
    typeof import("~/lib/operator/provisioning-api")
  >("~/lib/operator/provisioning-api");
  return {
    ...actual,
    operatorProvisioningService: {
      listOrganizations: mockListOrganizations,
      listSchools: mockListSchools,
      createSchool: mockCreateSchool,
      updateSchool: mockUpdateSchool,
      inviteSchoolAdmin: mockInviteSchoolAdmin,
      softDeleteSchool: mockSoftDeleteSchool,
      restoreSchool: mockRestoreSchool,
    },
  };
});

vi.mock("~/lib/format-utils", () => ({
  getRelativeTime: (dateStr: string) => `relative(${dateStr})`,
  formatCount: (value: number) => new Intl.NumberFormat("de-DE").format(value),
}));

vi.mock("~/components/ui/modal", () => ({
  Modal: ({ isOpen, children, title, footer }: any) =>
    isOpen ? (
      <div data-testid="modal">
        <h2>{title}</h2>
        {children}
        <div data-testid="modal-footer">{footer}</div>
      </div>
    ) : null,
  ConfirmationModal: ({ isOpen, children, title, onConfirm }: any) =>
    isOpen ? (
      <div data-testid="confirmation-modal">
        <h2>{title}</h2>
        {children}
        <button type="button" data-testid="confirm-btn" onClick={onConfirm}>
          Bestätigen
        </button>
      </div>
    ) : null,
}));

// The filter row as plain selects, like the announcements test.
vi.mock("~/components/ui/tenant-page-search-row", () => ({
  TenantPageSearchRow: ({ filters }: any) =>
    filters?.map((f: any) => (
      <select
        key={f.id}
        data-testid={`filter-${f.id}`}
        value={f.value}
        onChange={(e) => f.onChange(e.target.value)}
      >
        {f.options.map((opt: any) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    )),
}));

vi.mock("~/components/ui/skeleton", () => ({
  Skeleton: ({ className }: any) => (
    <div data-testid="skeleton" className={className} />
  ),
}));

vi.mock("../provisioning/create-account-modal", () => ({
  CreateAccountModal: ({ isOpen, schoolId, schoolName }: any) =>
    isOpen ? (
      <div data-testid="create-account-modal">
        <span>{schoolName}</span>
        <span>{schoolId}</span>
      </div>
    ) : null,
}));

import OperatorSchoolsPage from "./page";
import {
  mockOrg,
  mockSchool,
  setupSWR,
} from "~/test/helpers/operator-provisioning/provisioning-test-helpers";

type SWROverrides = Partial<Omit<Parameters<typeof setupSWR>[0], "useSWRMock">>;
function withDefaultSWR(overrides: SWROverrides = {}) {
  setupSWR({
    useSWRMock: mockUseSWR,
    mutateOrgs: mockMutateOrgs,
    mutateSchools: mockMutateSchools,
    mutateRequiredDetails: mockMutateRequiredDetails,
    ...overrides,
  });
}

// The Bundesland has no default (#7174): every new school names it.
function chooseFederalState() {
  fireEvent.click(screen.getByLabelText(/^Bundesland/));
  fireEvent.click(screen.getByRole("option", { name: "Nordrhein-Westfalen" }));
}

describe("OperatorSchoolsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSession.mockReturnValue({
      data: { user: { id: "1", email: "operator@example.com" } },
      status: "authenticated",
    });
    mockMutateOrgs.mockResolvedValue(undefined);
    mockMutateSchools.mockResolvedValue([mockSchool]);
    mockMutateRequiredDetails.mockResolvedValue(undefined);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" })),
    );
  });

  it("renders loading state", () => {
    withDefaultSWR({ schoolsLoading: true });

    render(<OperatorSchoolsPage />);

    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
  });

  it("renders school list", () => {
    withDefaultSWR();

    render(<OperatorSchoolsPage />);

    expect(screen.getByText("Test School")).toBeInTheDocument();
    expect(screen.getByText("test-school")).toBeInTheDocument();
  });

  it("renders empty state for schools", () => {
    withDefaultSWR({ schools: [] });

    render(<OperatorSchoolsPage />);

    expect(screen.getByText("Keine Schulen")).toBeInTheDocument();
  });

  it("shows school organization name and address", () => {
    withDefaultSWR();

    render(<OperatorSchoolsPage />);

    expect(screen.getByText("Test Org")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("shows Verborgen badge for hidden schools", () => {
    withDefaultSWR({ schools: [{ ...mockSchool, hidden: true }] });

    render(<OperatorSchoolsPage />);

    expect(screen.getByText("Verborgen")).toBeInTheDocument();
  });

  it("does not show Verborgen badge for visible schools", () => {
    withDefaultSWR();

    render(<OperatorSchoolsPage />);

    // Anker: die Schulzeile, an der das Abzeichen hängt, ist gerendert.
    expect(screen.getByText("Test School")).toBeInTheDocument();
    expect(screen.queryByText("Verborgen")).not.toBeInTheDocument();
  });

  // --- Pflichtangaben (#7174) ---

  it("marks schools without a reply address and filters them", async () => {
    const complete = {
      ...mockSchool,
      id: "2",
      name: "Complete School",
      slug: "complete-school",
      subdomain: "complete-school",
    };
    withDefaultSWR({
      schools: [mockSchool, complete],
      requiredDetails: [
        { schoolId: "10", replyAddressMissing: true },
        { schoolId: "2", replyAddressMissing: false },
      ],
    });

    render(<OperatorSchoolsPage />);

    expect(screen.getByText("Antwortadresse fehlt")).toBeInTheDocument();
    expect(screen.getByText("Vollständig")).toBeInTheDocument();
    expect(screen.getByText("mit fehlenden Angaben")).toBeInTheDocument();
    expect(screen.getByText("Complete School")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("filter-pflichtangaben"), {
      target: { value: "missing" },
    });

    await waitFor(() =>
      expect(screen.queryByText("Complete School")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Test School")).toBeInTheDocument();
  });

  it("shows a failed load of the required details above the list", async () => {
    withDefaultSWR({ requiredDetailsError: new ApiError("down", 503) });

    render(<OperatorSchoolsPage />);

    expect(
      await screen.findByText(
        catalogText("general.unavailable", "die fehlenden Pflichtangaben"),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Test School")).toBeInTheDocument();
    expect(screen.queryByTestId("filter-pflichtangaben")).toBeNull();
  });

  // --- Create ---

  it("opens create school modal", async () => {
    withDefaultSWR();

    render(<OperatorSchoolsPage />);

    fireEvent.click(screen.getAllByText("Neue Schule")[0]!);

    await waitFor(() => {
      expect(screen.getByTestId("modal")).toBeInTheDocument();
      expect(screen.getByLabelText(/Träger/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Subdomain/)).toBeInTheDocument();
    });
  });

  it("creates school successfully with all fields", async () => {
    withDefaultSWR();
    mockCreateSchool.mockResolvedValue(mockSchool);

    render(<OperatorSchoolsPage />);

    fireEvent.click(screen.getAllByText("Neue Schule")[0]!);

    await waitFor(() => {
      expect(screen.getByTestId("modal")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/Träger/), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "New School" },
    });
    fireEvent.change(screen.getByLabelText(/Adresse/), {
      target: { value: "Hauptstr. 1" },
    });
    fireEvent.change(screen.getByLabelText(/Stadt/), {
      target: { value: "Berlin" },
    });
    fireEvent.change(screen.getByLabelText(/PLZ/), {
      target: { value: "10115" },
    });
    fireEvent.change(screen.getByLabelText(/Telefon/), {
      target: { value: "030123" },
    });
    fireEvent.change(screen.getByLabelText(/E-Mail/), {
      target: { value: "info@school.de" },
    });
    chooseFederalState();

    fireEvent.click(screen.getByText("Erstellen"));

    await waitFor(() => {
      expect(mockCreateSchool).toHaveBeenCalledWith(
        expect.objectContaining({
          organization_id: 1,
          name: "New School",
          slug: "new-school",
          subdomain: "new-school",
          address: "Hauptstr. 1",
          city: "Berlin",
          zip: "10115",
          phone: "030123",
          email: "info@school.de",
          federal_state: "DE-NW",
        }),
      );
      expect(mockMutateSchools).toHaveBeenCalled();
    });
  });

  it("validates invalid slug when creating school", async () => {
    withDefaultSWR();

    render(<OperatorSchoolsPage />);

    fireEvent.click(screen.getAllByText("Neue Schule")[0]!);

    await waitFor(() => {
      expect(screen.getByTestId("modal")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/Träger/), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "Test" },
    });

    fireEvent.change(screen.getByLabelText(/Slug/), {
      target: { value: "INVALID!" },
    });

    fireEvent.change(screen.getByLabelText(/E-Mail/), {
      target: { value: "info@new-school.example" },
    });

    chooseFederalState();
    fireEvent.click(screen.getByText("Erstellen"));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Slug darf nur Kleinbuchstaben, Zahlen und Bindestriche enthalten.",
        ),
      ).toBeInTheDocument();
    });

    expect(mockCreateSchool).not.toHaveBeenCalled();
  });

  it("validates invalid subdomain when creating school", async () => {
    withDefaultSWR();

    render(<OperatorSchoolsPage />);

    fireEvent.click(screen.getAllByText("Neue Schule")[0]!);

    await waitFor(() => {
      expect(screen.getByTestId("modal")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/Träger/), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "Test" },
    });

    fireEvent.change(screen.getByLabelText(/Subdomain/), {
      target: { value: "BAD DOMAIN!" },
    });

    fireEvent.change(screen.getByLabelText(/E-Mail/), {
      target: { value: "info@new-school.example" },
    });

    chooseFederalState();
    fireEvent.click(screen.getByText("Erstellen"));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Subdomain darf nur Kleinbuchstaben, Zahlen und Bindestriche enthalten.",
        ),
      ).toBeInTheDocument();
    });

    expect(mockCreateSchool).not.toHaveBeenCalled();
  });

  it("shows subdomain conflict error when creating school", async () => {
    withDefaultSWR();
    mockCreateSchool.mockRejectedValue(
      new ApiError("subdomain already exists", 409, {
        code: "general.business_rejection",
        errors: [{ field: "subdomain", reason: "taken" }],
      }),
    );

    render(<OperatorSchoolsPage />);

    fireEvent.click(screen.getAllByText("Neue Schule")[0]!);

    await waitFor(() => {
      expect(screen.getByTestId("modal")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/Träger/), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "Dup School" },
    });

    fireEvent.change(screen.getByLabelText(/E-Mail/), {
      target: { value: "info@new-school.example" },
    });

    chooseFederalState();
    fireEvent.click(screen.getByText("Erstellen"));

    expect(
      await screen.findByText(
        catalogText("general.business_rejection", "das Anlegen der Schule"),
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Subdomain/)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("shows slug conflict error when creating school", async () => {
    withDefaultSWR();
    mockCreateSchool.mockRejectedValue(
      new ApiError("slug conflict", 409, {
        code: "general.business_rejection",
        errors: [{ field: "slug", reason: "taken" }],
      }),
    );

    render(<OperatorSchoolsPage />);

    fireEvent.click(screen.getAllByText("Neue Schule")[0]!);

    await waitFor(() => {
      expect(screen.getByTestId("modal")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/Träger/), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "Dup School" },
    });

    fireEvent.change(screen.getByLabelText(/E-Mail/), {
      target: { value: "info@new-school.example" },
    });

    chooseFederalState();
    fireEvent.click(screen.getByText("Erstellen"));

    expect(
      await screen.findByText(
        catalogText("general.business_rejection", "das Anlegen der Schule"),
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^Slug/)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("handles generic error when creating school", async () => {
    withDefaultSWR();
    mockCreateSchool.mockRejectedValue(new ApiError("Network failure", 503));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {
      // noop
    });

    render(<OperatorSchoolsPage />);

    fireEvent.click(screen.getAllByText("Neue Schule")[0]!);

    await waitFor(() => {
      expect(screen.getByTestId("modal")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/Träger/), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "Fail School" },
    });

    fireEvent.change(screen.getByLabelText(/E-Mail/), {
      target: { value: "info@new-school.example" },
    });

    chooseFederalState();
    fireEvent.click(screen.getByText("Erstellen"));

    await waitFor(() => {
      expect(
        screen.getByText(
          catalogText("general.unavailable", "das Anlegen der Schule"),
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText("Network failure")).toBeNull();
      expect(consoleError).toHaveBeenCalledWith(
        "school_create_failed",
        expect.objectContaining({ error: "Network failure" }),
      );
    });

    consoleError.mockRestore();
  });

  it("auto-generates slug and subdomain from school name", async () => {
    withDefaultSWR();

    render(<OperatorSchoolsPage />);

    fireEvent.click(screen.getAllByText("Neue Schule")[0]!);

    await waitFor(() => {
      expect(screen.getByTestId("modal")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "Meine Schule" },
    });

    const slugInput = screen.getByLabelText(/Slug/);
    const subdomainInput = screen.getByLabelText(/Subdomain/);
    expect((slugInput as HTMLInputElement).value).toBe("meine-schule");
    expect((subdomainInput as HTMLInputElement).value).toBe("meine-schule");
  });

  it("pre-selects org when only one exists", async () => {
    withDefaultSWR({ orgs: [mockOrg] });

    render(<OperatorSchoolsPage />);

    fireEvent.click(screen.getAllByText("Neue Schule")[0]!);

    await waitFor(() => {
      expect(screen.getByTestId("modal")).toBeInTheDocument();
    });

    const orgSelect = screen.getByLabelText(/Träger/);
    expect(orgSelect).toHaveTextContent("Test Org");
  });

  it("navigates to the school detail page when a row is clicked", () => {
    withDefaultSWR();

    render(<OperatorSchoolsPage />);

    fireEvent.click(screen.getByText("Test School"));

    expect(mockPush).toHaveBeenCalledWith(
      "/operator/organizations/test-org/schools/test-school",
    );
  });

  it("keeps row-level management buttons out of the directory table", () => {
    withDefaultSWR();

    render(<OperatorSchoolsPage />);

    const table = screen.getByRole("table");
    expect(
      within(table).queryByRole("button", { name: "Konten" }),
    ).not.toBeInTheDocument();
    expect(
      within(table).queryByRole("button", { name: "Bearbeiten" }),
    ).not.toBeInTheDocument();
    expect(
      within(table).queryByRole("button", { name: "Konto erstellen" }),
    ).not.toBeInTheDocument();
    expect(
      within(table).queryByRole("button", { name: "Admin einladen" }),
    ).not.toBeInTheDocument();
    expect(
      within(table).queryByRole("link", { name: "Einstellungen" }),
    ).not.toBeInTheDocument();
    expect(
      within(table).queryByRole("button", { name: "Löschen" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Deaktivieren")).not.toBeInTheDocument();
  });

  // --- Soft-delete flow ---

  it("shows Papierkorb toggle when deleted schools exist", () => {
    withDefaultSWR({
      schools: [
        mockSchool,
        { ...mockSchool, id: "11", deletedAt: "2025-06-01T00:00:00Z" },
      ],
    });

    render(<OperatorSchoolsPage />);

    expect(screen.getByText(/Papierkorb \(1\)/)).toBeInTheDocument();
  });

  it("shows trash view with deleted schools when Papierkorb clicked", async () => {
    const deletedSchool = {
      ...mockSchool,
      id: "20",
      name: "Deleted School",
      subdomain: "deleted-school",
      deletedAt: "2025-06-01T00:00:00Z",
    };
    withDefaultSWR({ schools: [mockSchool, deletedSchool] });

    render(<OperatorSchoolsPage />);

    fireEvent.click(screen.getByText("Papierkorb (1)"));

    await waitFor(() => {
      expect(screen.getByText("Deleted School")).toBeInTheDocument();
      expect(screen.getByText("Wiederherstellen")).toBeInTheDocument();
      expect(screen.getByText("Gelöscht")).toBeInTheDocument();
    });
  });

  it("calls restoreSchool and mutates on confirm", async () => {
    mockRestoreSchool.mockResolvedValue(undefined);
    const deletedSchool = {
      ...mockSchool,
      id: "20",
      name: "Deleted School",
      subdomain: "deleted-school",
      deletedAt: "2025-06-01T00:00:00Z",
    };
    withDefaultSWR({ schools: [mockSchool, deletedSchool] });

    render(<OperatorSchoolsPage />);

    await waitFor(() => {
      expect(screen.getByText("Papierkorb (1)")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Papierkorb (1)"));

    await waitFor(() => {
      expect(screen.getByText("Wiederherstellen")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Wiederherstellen"));

    await waitFor(() => {
      expect(screen.getByTestId("confirmation-modal")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("confirm-btn"));

    await waitFor(() => {
      expect(mockRestoreSchool).toHaveBeenCalledWith("20");
      expect(mockMutateSchools).toHaveBeenCalled();
      expect(mockMutateRequiredDetails).toHaveBeenCalled();
    });
  });

  // --- Column sorting (covers each column's sortValue callback) ---

  describe("column sorting", () => {
    it("sorts by Schule / Träger / Konten / Geräte / Personen / Status when headers are clicked", () => {
      withDefaultSWR({
        schools: [
          {
            ...mockSchool,
            id: "1",
            slug: "z-school",
            name: "Z School",
            subdomain: "z-school",
            organizationName: "Org B",
            kontenCount: 10,
            geraeteCount: 2,
            personenCount: 7,
            active: false,
          },
          {
            ...mockSchool,
            id: "2",
            slug: "a-school",
            name: "A School",
            subdomain: "a-school",
            organizationName: "Org A",
            kontenCount: 30,
            geraeteCount: 8,
            personenCount: 3,
            active: true,
          },
        ],
      });

      render(<OperatorSchoolsPage />);

      for (const header of [
        "Schule",
        "Träger",
        "Konten",
        "Geräte",
        "Personen",
        "Status",
      ]) {
        fireEvent.click(
          screen.getByRole("button", { name: new RegExp(`^${header} – `) }),
        );
      }

      expect(screen.getByText("A School")).toBeInTheDocument();
      expect(screen.getByText("Z School")).toBeInTheDocument();
    });
  });

  // #2519: a failed load is not an empty list.
  it("shows a failed list load without claiming the list is empty", async () => {
    withDefaultSWR({
      schools: [],
      schoolsError: new ApiError("down", 503),
      staleData: true,
    });

    render(<OperatorSchoolsPage />);

    expect(
      await screen.findByText(
        catalogText("general.unavailable", "die Liste der Schulen"),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Keine Schulen")).toBeNull();
  });
});
