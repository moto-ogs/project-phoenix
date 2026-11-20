import {
  render as rtlRender,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import { SWRConfig } from "~/lib/swr/testing";
import { catalogText } from "~/test/error-catalog-text";

vi.unmock("swr");

// Fehler einer Aktion ohne Formular kommen als Toast (#2517).
function render(ui: ReactElement) {
  return rtlRender(
    <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
      {ui}
    </SWRConfig>,
    { wrapper: ToastProvider },
  );
}
import StaffImportPage from "./page";

// Mock next-auth/react. The default session may change existing records
// (#2906); the mode switcher only renders for that permission pair.
const personnelSession = {
  data: {
    user: {
      id: "1",
      permissions: ["users:create", "staff:manage", "staff:stammdaten"],
    },
  },
  status: "authenticated",
};
vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => personnelSession),
}));

// Mock next/navigation
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  // useTenantRouter braucht useRouter.
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

// Mock ToastContext
const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
};
vi.mock("~/contexts/ToastContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/contexts/ToastContext")>()),
  useToast: () => mockToast,
}));

// Mock the roles service used to populate the available-roles hint. getList
// resolves with two roles; getRoleDisplayName is mocked as identity.
vi.mock("~/lib/database/service-factory", () => ({
  createCrudService: () => ({
    getList: vi.fn(() =>
      Promise.resolve({
        data: [
          { id: "1", name: "user" },
          { id: "2", name: "admin" },
        ],
      }),
    ),
  }),
}));
vi.mock("~/components/database/configs/roles.config", () => ({
  rolesConfig: {},
}));
vi.mock("~/lib/auth-helpers", () => ({
  getRoleDisplayName: (name: string) => name,
}));

// Mock Button component
vi.mock("~/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    ...props
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

// Mock Alert component
vi.mock("~/components/ui/alert", () => ({
  Alert: ({
    message,
    type,
    action,
  }: {
    message: string;
    type: string;
    action?: import("react").ReactNode;
  }) => (
    <div data-testid={`alert-${type}`}>
      {message}
      {action}
    </div>
  ),
}));

// Mock import components (staff page uses UploadSection + StatsCards)
vi.mock("~/components/import/upload-section", () => ({
  UploadSection: ({
    onFileSelect,
    isLoading,
  }: {
    onFileSelect: (file: File) => void;
    isLoading: boolean;
  }) => (
    <div
      data-testid="upload-section"
      onDrop={(e) => {
        const file = e.dataTransfer.files[0];
        if (file) onFileSelect(file);
      }}
    >
      <span data-testid="is-loading">{isLoading.toString()}</span>
      <button
        type="button"
        data-testid="file-select-trigger"
        onClick={() =>
          onFileSelect(new File(["test"], "test.csv", { type: "text/csv" }))
        }
      >
        Select File
      </button>
    </div>
  ),
}));

vi.mock("~/components/import/stats-cards", () => ({
  StatsCards: ({
    total,
    newCount,
    existing,
    errors,
  }: {
    total: number;
    newCount: number;
    existing: number;
    errors: number;
  }) => (
    <div data-testid="stats-cards">
      <span data-testid="stat-total">{total}</span>
      <span data-testid="stat-new">{newCount}</span>
      <span data-testid="stat-existing">{existing}</span>
      <span data-testid="stat-errors">{errors}</span>
    </div>
  ),
}));

interface StaffRowData {
  first_name: string;
  last_name: string;
  email: string;
  role_name: string;
  position?: string;
}

function previewRow(
  data: StaffRowData,
  errors: { code: string; severity: string; message: string; field: string }[],
) {
  return {
    row_number: 1,
    data: data,
    errors: errors,
    timestamp: new Date().toISOString(),
  };
}

describe("StaffImportPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  it("führt zurück zum Personal", () => {
    render(<StaffImportPage />);

    expect(
      screen.getByRole("link", { name: "Zurück zum Personal" }),
    ).toHaveAttribute("href", expect.stringMatching(/\/database\/personal$/));
  });

  it("renders the instruction section", () => {
    render(<StaffImportPage />);

    expect(screen.getByText("Import-Anleitung")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Fülle die Datei mit den Daten deiner Mitarbeitenden aus/,
      ),
    ).toBeInTheDocument();
  });

  it("renders the template download section with a single format label", () => {
    render(<StaffImportPage />);

    expect(
      screen.getByRole("heading", { name: "Vorlage herunterladen" }),
    ).toBeInTheDocument();
    // Regression: the alignment spacer must not duplicate this label.
    expect(screen.getByText("Format wählen")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Vorlage herunterladen/ }),
    ).toBeInTheDocument();
  });

  it("renders the upload section", () => {
    render(<StaffImportPage />);
    expect(screen.getByTestId("upload-section")).toBeInTheDocument();
  });

  it("loads and displays the available roles", async () => {
    render(<StaffImportPage />);

    await waitFor(() => {
      expect(screen.getByText("user")).toBeInTheDocument();
      expect(screen.getByText("admin")).toBeInTheDocument();
    });
  });

  it("allows selecting template format", () => {
    render(<StaffImportPage />);

    const select = screen.getByRole("combobox");
    expect(select).toHaveTextContent("Excel (.xlsx)");
    fireEvent.click(select);
    fireEvent.click(
      screen.getByRole("option", { name: "CSV (Komma-getrennt)" }),
    );
    expect(select).toHaveTextContent("CSV (Komma-getrennt)");
  });

  it("calls the teacher template endpoint on download", async () => {
    const mockBlob = new Blob(["test"], { type: "text/csv" });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      blob: () => Promise.resolve(mockBlob),
    });
    global.URL.createObjectURL = vi.fn(() => "blob:test-url");
    global.URL.revokeObjectURL = vi.fn();

    render(<StaffImportPage />);

    fireEvent.click(
      screen.getByRole("button", { name: /Vorlage herunterladen/ }),
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/import/teachers/template?format=xlsx",
        // The route reads the session cookie (#5005).
        { credentials: "include" },
      );
    });
  });

  it("handles download error gracefully", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 503,
    });

    render(<StaffImportPage />);
    fireEvent.click(
      screen.getByRole("button", { name: /Vorlage herunterladen/ }),
    );

    expect(
      await screen.findByText(
        catalogText("general.unavailable", "die Vorlage"),
      ),
    ).toBeInTheDocument();
  });

  it("posts to the teacher preview endpoint on file upload", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            total_rows: 2,
            created_count: 2,
            updated_count: 0,
            error_count: 0,
            errors: [],
          },
        }),
    });

    render(<StaffImportPage />);
    fireEvent.click(screen.getByTestId("file-select-trigger"));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/import/teachers/preview",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("displays error when preview fails", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () =>
        Promise.resolve({
          error: "Datei-Fehler: keine Zeilen",
          code: "import.file_no_rows",
        }),
    });

    render(<StaffImportPage />);
    fireEvent.click(screen.getByTestId("file-select-trigger"));

    expect(
      await screen.findByText(catalogText("import.file_no_rows", "die Datei")),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Datei-Fehler/)).not.toBeInTheDocument();
  });

  it("retries the preview with the same file", async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ code: "general.unavailable" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              total_rows: 1,
              created_count: 1,
              updated_count: 0,
              error_count: 0,
              errors: [],
            },
          }),
      });

    render(<StaffImportPage />);
    fireEvent.click(screen.getByTestId("file-select-trigger"));

    expect(
      await screen.findByText(catalogText("general.unavailable", "die Datei")),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(
        screen.queryByText(catalogText("general.unavailable", "die Datei")),
      ).not.toBeInTheDocument();
    });
  });

  it("shows a summary row when the preview has no issues", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            total_rows: 5,
            created_count: 5,
            updated_count: 0,
            error_count: 0,
            errors: [],
          },
        }),
    });

    render(<StaffImportPage />);
    fireEvent.click(screen.getByTestId("file-select-trigger"));

    await waitFor(() => {
      expect(
        screen.getByText("5 Mitarbeitende bereit zum Import"),
      ).toBeInTheDocument();
    });
  });

  it("shows the import button label with the new count", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            total_rows: 4,
            created_count: 4,
            updated_count: 0,
            error_count: 0,
            errors: [],
          },
        }),
    });

    render(<StaffImportPage />);
    fireEvent.click(screen.getByTestId("file-select-trigger"));

    await waitFor(() => {
      expect(screen.getByText("4 Mitarbeitende anlegen")).toBeInTheDocument();
    });
  });

  it("renders a preview row with name, email and role", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            total_rows: 1,
            created_count: 1,
            updated_count: 0,
            error_count: 0,
            warning_count: 0,
            errors: [
              previewRow(
                {
                  first_name: "Anna",
                  last_name: "Lehmann",
                  email: "anna@example.com",
                  role_name: "user",
                  position: "Klassenlehrerin",
                },
                [
                  {
                    code: "x",
                    severity: "warning",
                    message: "Hinweis",
                    field: "role",
                  },
                ],
              ),
            ],
          },
        }),
    });

    render(<StaffImportPage />);
    fireEvent.click(screen.getByTestId("file-select-trigger"));

    await waitFor(() => {
      expect(screen.getByText("Anna Lehmann")).toBeInTheDocument();
      expect(screen.getByText("anna@example.com")).toBeInTheDocument();
    });
  });

  it("disables the import button when there are errors", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            total_rows: 1,
            created_count: 0,
            updated_count: 0,
            error_count: 1,
            errors: [
              previewRow(
                {
                  first_name: "Bernd",
                  last_name: "Falsch",
                  email: "bernd@example.com",
                  role_name: "GibtsNicht",
                },
                [
                  {
                    code: "role_not_found",
                    severity: "error",
                    message: "Rolle nicht gefunden",
                    field: "role",
                  },
                ],
              ),
            ],
          },
        }),
    });

    render(<StaffImportPage />);
    fireEvent.click(screen.getByTestId("file-select-trigger"));

    await waitFor(() => {
      const inviteButton = screen.getByText("0 Mitarbeitende anlegen");
      expect(inviteButton).toBeDisabled();
    });
  });

  it("resets the form on cancel", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            total_rows: 3,
            created_count: 3,
            updated_count: 0,
            error_count: 0,
            errors: [],
          },
        }),
    });

    render(<StaffImportPage />);
    fireEvent.click(screen.getByTestId("file-select-trigger"));

    await waitFor(() => {
      expect(screen.getByTestId("stats-cards")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Abbrechen"));

    await waitFor(() => {
      expect(screen.queryByTestId("stats-cards")).not.toBeInTheDocument();
    });
  });

  it("imports staff and shows a success toast", async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              total_rows: 3,
              created_count: 3,
              updated_count: 0,
              error_count: 0,
              errors: [],
            },
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              total_rows: 3,
              created_count: 3,
              updated_count: 0,
              error_count: 0,
              errors: [],
            },
          }),
      });

    render(<StaffImportPage />);
    fireEvent.click(screen.getByTestId("file-select-trigger"));

    await waitFor(() => {
      expect(screen.getByText("3 Mitarbeitende anlegen")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("3 Mitarbeitende anlegen"));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/import/teachers/import",
        expect.objectContaining({ method: "POST" }),
      );
      expect(mockToast.success).toHaveBeenCalledWith(
        "Der Import ist fertig: 3 angelegt, 0 aktualisiert.",
      );
    });
  });

  it("shows a warning toast on partial import", async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              total_rows: 3,
              created_count: 3,
              updated_count: 0,
              error_count: 0,
              errors: [],
            },
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              total_rows: 3,
              created_count: 2,
              updated_count: 0,
              error_count: 1,
              errors: [
                previewRow(
                  {
                    first_name: "Max",
                    last_name: "Müller",
                    email: "max@example.com",
                    role_name: "user",
                  },
                  [
                    {
                      code: "already_exists",
                      severity: "error",
                      message: "Existiert",
                      field: "email",
                    },
                  ],
                ),
              ],
            },
          }),
      });

    render(<StaffImportPage />);
    fireEvent.click(screen.getByTestId("file-select-trigger"));

    await waitFor(() => {
      expect(screen.getByText("3 Mitarbeitende anlegen")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("3 Mitarbeitende anlegen"));

    await waitFor(() => {
      expect(mockToast.warning).toHaveBeenCalledWith(
        "Der Import ist fertig: 2 angelegt, 0 aktualisiert, 1 übersprungen.",
      );
      expect(mockToast.success).not.toHaveBeenCalled();
    });
  });

  it("shows an error when the import call fails", async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              total_rows: 2,
              created_count: 2,
              updated_count: 0,
              error_count: 0,
              errors: [],
            },
          }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: "Import fehlgeschlagen" }),
      });

    render(<StaffImportPage />);
    fireEvent.click(screen.getByTestId("file-select-trigger"));

    await waitFor(() => {
      expect(screen.getByText("2 Mitarbeitende anlegen")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("2 Mitarbeitende anlegen"));

    expect(
      await screen.findByText(
        catalogText("general.server", "das Importieren der Datei"),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Import fehlgeschlagen")).not.toBeInTheDocument();
  });

  it("shows saved rows and the blocking row on import_batch_failed", async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              total_rows: 205,
              created_count: 205,
              updated_count: 0,
              error_count: 0,
              errors: [],
            },
          }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: () =>
          Promise.resolve({
            status: 409,
            detail: "import batch failed",
            code: "import.import_batch_failed",
            details: {
              result: {
                total_rows: 205,
                created_count: 100,
                updated_count: 0,
                error_count: 1,
                errors: [
                  {
                    row_number: 152,
                    data: {
                      first_name: "Refused",
                      last_name: "Batch",
                      email: "",
                      role_name: "Betreuung",
                    },
                    errors: [
                      {
                        field: "create",
                        message: "Anlegen fehlgeschlagen",
                        code: "creation_failed",
                        severity: "error",
                      },
                    ],
                  },
                ],
              },
            },
          }),
      });

    render(<StaffImportPage />);
    fireEvent.click(screen.getByTestId("file-select-trigger"));

    await waitFor(() => {
      expect(screen.getByText("205 Mitarbeitende anlegen")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("205 Mitarbeitende anlegen"));

    // A batch that stopped after saved rows is a failure of the import:
    // it stands in the form's error alert, not in a warning (#2520).
    await waitFor(() => {
      expect(screen.getByTestId("alert-error")).toHaveTextContent(
        /100 Zeilen sind gespeichert/,
      );
    });
    expect(screen.getByTestId("alert-error")).toHaveTextContent(
      /Zeile 152 hat den Rest angehalten/,
    );
    expect(screen.queryByTestId("alert-warning")).not.toBeInTheDocument();
    expect(screen.getByTestId("stat-new")).toHaveTextContent("100");
    expect(screen.getByTestId("stat-errors")).toHaveTextContent("1");
    expect(screen.getByText("Refused Batch")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Erneut versuchen" }),
    ).toBeEnabled();
    expect(screen.queryByText("Fehler beim Import")).not.toBeInTheDocument();
  });

  it("keeps import enabled after re-uploading a file whose first rows already exist", async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              total_rows: 205,
              created_count: 205,
              updated_count: 0,
              error_count: 0,
              errors: [],
            },
          }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: () =>
          Promise.resolve({
            status: 409,
            detail: "import batch failed",
            code: "import.import_batch_failed",
            details: {
              result: {
                total_rows: 205,
                created_count: 100,
                updated_count: 0,
                error_count: 1,
                errors: [
                  {
                    row_number: 152,
                    data: {
                      first_name: "Refused",
                      last_name: "Batch",
                      email: "",
                      role_name: "Betreuung",
                    },
                    errors: [
                      {
                        field: "create",
                        message: "Anlegen fehlgeschlagen",
                        code: "creation_failed",
                        severity: "error",
                      },
                    ],
                  },
                ],
              },
            },
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              total_rows: 205,
              created_count: 105,
              updated_count: 0,
              error_count: 100,
              errors: Array.from({ length: 100 }, (_, index) => ({
                row_number: index + 2,
                data: {
                  first_name: `Person${index}`,
                  last_name: "Batch",
                  email: "",
                  role_name: "Betreuung",
                },
                errors: [
                  {
                    code: "already_exists",
                    severity: "error",
                    message: "Mitarbeiter existiert bereits",
                    field: "duplicate",
                  },
                ],
              })),
            },
          }),
      });

    render(<StaffImportPage />);
    fireEvent.click(screen.getByTestId("file-select-trigger"));
    await waitFor(() => {
      expect(screen.getByText("205 Mitarbeitende anlegen")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("205 Mitarbeitende anlegen"));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Erneut versuchen" }),
      ).toBeEnabled();
    });

    fireEvent.click(screen.getByTestId("file-select-trigger"));
    await waitFor(() => {
      expect(screen.getByText("105 Mitarbeitende anlegen")).toBeInTheDocument();
    });
    expect(screen.getByText("105 Mitarbeitende anlegen")).toBeEnabled();
    expect(screen.getByTestId("stat-new")).toHaveTextContent("105");
    expect(screen.getByTestId("stat-existing")).toHaveTextContent("100");
    expect(screen.getByTestId("stat-errors")).toHaveTextContent("0");
  });

  it("handles a valid file drop", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            total_rows: 1,
            created_count: 1,
            updated_count: 0,
            error_count: 0,
            errors: [],
          },
        }),
    });

    render(<StaffImportPage />);

    const uploadSection = screen.getByTestId("upload-section");
    const csvFile = new File(["test"], "staff.csv", { type: "text/csv" });
    const dropEvent = new Event("drop", { bubbles: true });
    Object.defineProperty(dropEvent, "preventDefault", { value: vi.fn() });
    Object.defineProperty(dropEvent, "stopPropagation", { value: vi.fn() });
    Object.defineProperty(dropEvent, "dataTransfer", {
      value: { files: [csvFile] },
    });
    uploadSection.dispatchEvent(dropEvent);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/import/teachers/preview",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("rejects an invalid file drop", async () => {
    render(<StaffImportPage />);

    const uploadSection = screen.getByTestId("upload-section");
    const invalidFile = new File(["test"], "image.png", { type: "image/png" });
    const dropEvent = new Event("drop", { bubbles: true });
    Object.defineProperty(dropEvent, "preventDefault", { value: vi.fn() });
    Object.defineProperty(dropEvent, "stopPropagation", { value: vi.fn() });
    Object.defineProperty(dropEvent, "dataTransfer", {
      value: { files: [invalidFile] },
    });
    uploadSection.dispatchEvent(dropEvent);

    await waitFor(() => {
      expect(
        screen.getByText(
          "Diese Datei passt nicht. Bitte lade eine CSV- oder Excel-Datei hoch.",
        ),
      ).toBeInTheDocument();
    });
  });

  it("shows loading state while the session loads", async () => {
    const useSession = await import("next-auth/react");
    vi.mocked(useSession.useSession).mockReturnValueOnce({
      data: null,
      status: "loading",
      update: vi.fn(),
    });

    render(<StaffImportPage />);
    expect(screen.getByLabelText("Import wird geladen…")).toBeInTheDocument();
  });

  it("handles a stripped session gracefully", async () => {
    // Ohne gültige Sitzung ist die Anmeldung abgelaufen: der gemeinsame Fehlerweg
    // schickt zur Anmeldung (#2517).
    const assign = vi
      .spyOn(window.location, "assign")
      .mockImplementation(() => undefined);
    const useSession = await import("next-auth/react");
    vi.mocked(useSession.useSession).mockReturnValueOnce({
      data: { user: { id: "1" }, error: "RefreshTokenError" },
      status: "authenticated",
      update: vi.fn(),
    } as unknown as ReturnType<typeof useSession.useSession>);

    render(<StaffImportPage />);
    fireEvent.click(screen.getByTestId("file-select-trigger"));

    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith("/?error=SessionExpired");
    });
    expect(global.fetch).not.toHaveBeenCalled();
    assign.mockRestore();
  });

  it("keeps a create-only user in create mode and says so (#2906)", async () => {
    const useSession = await import("next-auth/react");
    vi.mocked(useSession.useSession).mockReturnValue({
      data: { user: { id: "1", permissions: ["users:create"] } },
      status: "authenticated",
      update: vi.fn(),
    } as unknown as ReturnType<typeof useSession.useSession>);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            total_rows: 1,
            created_count: 1,
            updated_count: 0,
            error_count: 0,
            errors: [],
          },
        }),
    });

    try {
      render(<StaffImportPage />);
      expect(
        screen.queryByRole("button", { name: "Beides" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Nur bestehende aktualisieren" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByText(/legt der Import nur neue Mitarbeitende an/),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("file-select-trigger"));
      await waitFor(() => {
        expect(screen.getByText("1 Mitarbeitende anlegen")).toBeInTheDocument();
      });
      const previewCall = (
        global.fetch as ReturnType<typeof vi.fn>
      ).mock.calls.find((call) => call[0] === "/api/import/teachers/preview");
      expect(previewCall).toBeDefined();
      expect((previewCall![1] as { body: FormData }).body.get("mode")).toBe(
        "create",
      );
    } finally {
      vi.mocked(useSession.useSession).mockReturnValue(
        personnelSession as unknown as ReturnType<typeof useSession.useSession>,
      );
    }
  });

  it("sends the chosen import mode with the preview and relabels the button", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            total_rows: 3,
            created_count: 1,
            updated_count: 2,
            error_count: 0,
            errors: [],
          },
        }),
    });

    render(<StaffImportPage />);
    fireEvent.click(screen.getByRole("button", { name: "Beides" }));
    fireEvent.click(screen.getByTestId("file-select-trigger"));

    await waitFor(() => {
      expect(
        screen.getByText("3 Mitarbeitende übernehmen"),
      ).toBeInTheDocument();
    });
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    const previewCall = fetchMock.mock.calls.find(
      (call) => call[0] === "/api/import/teachers/preview",
    );
    expect(previewCall).toBeDefined();
    const body = (previewCall![1] as { body: FormData }).body;
    expect(body.get("mode")).toBe("upsert");

    // Switching the mode re-runs the preview with the new value.
    fireEvent.click(
      screen.getByRole("button", { name: "Nur bestehende aktualisieren" }),
    );
    expect(
      screen.queryByText("3 Mitarbeitende übernehmen"),
    ).not.toBeInTheDocument();
    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(
        (call) => call[0] === "/api/import/teachers/preview",
      );
      expect(calls).toHaveLength(2);
      const secondInit = calls[1]![1] as { body: FormData };
      expect(secondInit.body.get("mode")).toBe("update");
    });
    expect(
      screen.getByText("2 Mitarbeitende aktualisieren"),
    ).toBeInTheDocument();
  });
});
