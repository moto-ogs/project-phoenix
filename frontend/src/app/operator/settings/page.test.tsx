import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { catalogText } from "~/test/error-catalog-text";
import { SWRConfig } from "~/lib/swr/testing";

vi.unmock("swr");

const {
  mockUseSession,
  mockUpdateSession,
  fetchMock,
  mockToastSuccess,
  mockToastError,
  mockLogout,
} = vi.hoisted(() => ({
  mockUseSession: vi.fn(),
  mockUpdateSession: vi.fn(),
  fetchMock: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
  mockLogout: vi.fn(),
}));

vi.mock("next-auth/react", () => ({
  useSession: mockUseSession,
}));

vi.mock("~/lib/shell-auth-context", () => ({
  useShellAuth: () => ({ logout: mockLogout }),
}));

const mockApiErrorDisplay = { show: vi.fn() };
vi.mock("~/contexts/ToastContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/contexts/ToastContext")>()),
  useApiErrorDisplay: () => mockApiErrorDisplay,
  useToast: () => ({
    success: mockToastSuccess,
    error: mockToastError,
  }),
}));

const passwordModalProps = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));
vi.mock("~/components/auth/password-change-modal", () => ({
  PasswordChangeModal: (props: Record<string, unknown>) => {
    passwordModalProps.current = props;
    return null;
  },
}));

// TrustedDevicesSection pulls in useToast/useTrustedDevices and is exercised
// by its own component tests — stub it out here to keep this page-level test
// focused on profile editing and avoid wiring ToastProvider/Tanstack Query.
vi.mock("~/components/settings/trusted-devices-section", () => ({
  TrustedDevicesSection: () => null,
}));

import { PASSWORD_CHANGED_KEY } from "~/lib/session-cache";
import OperatorSettingsPage from "./page";

function renderPage() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
      <OperatorSettingsPage />
    </SWRConfig>,
  );
}

const defaultProfile = {
  id: 1,
  email: "mail@yannickwenger.de",
  display_name: "yonnock",
};

describe("OperatorSettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // bffJson("platform", …) sends through the global fetch.
    vi.stubGlobal("fetch", fetchMock);
    sessionStorage.clear();
    mockLogout.mockResolvedValue(undefined);
    mockUpdateSession.mockResolvedValue(undefined);
    mockUseSession.mockReturnValue({
      data: {
        user: {
          id: "1",
          scope: "platform",
          name: "John Doe",
          email: "john@example.com",
        },
      },
      status: "authenticated",
      update: mockUpdateSession,
    });
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/operator/profile" && init?.method === "GET") {
        return {
          ok: true,
          json: async () => ({ data: defaultProfile }),
        } as Response;
      }
      if (url === "/api/operator/profile" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body ?? "{}")) as {
          display_name?: string;
        };
        return {
          ok: true,
          json: async () => ({
            data: {
              ...defaultProfile,
              display_name: body.display_name ?? defaultProfile.display_name,
            },
          }),
        } as Response;
      }
      if (url === "/api/operator/profile/email-change") {
        // The catalog proxy answers a route without data as { data: null }.
        return {
          ok: true,
          json: async () => ({ status: "success", data: null }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({ data: defaultProfile }),
      } as Response;
    });
  });

  it("shows loading state when auth is loading", async () => {
    mockUseSession.mockReturnValue({
      data: null,
      status: "loading",
      update: mockUpdateSession,
    });

    renderPage();

    await waitFor(() => {
      expect(
        screen.getByLabelText("Profileinstellungen werden geladen"),
      ).toBeInTheDocument();
    });
  });

  it("renders settings form with operator data", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("yonnock")).toBeInTheDocument();
      expect(screen.getByText("mail@yannickwenger.de")).toBeInTheDocument();
    });
  });

  it("loads canonical backend email instead of a platform token subject", async () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          id: "1",
          scope: "platform",
          name: "yonnock",
          email: "operator:2",
        },
      },
      status: "authenticated",
      update: mockUpdateSession,
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("mail@yannickwenger.de")).toBeInTheDocument();
    });
    expect(screen.queryByText("operator:2")).not.toBeInTheDocument();
  });

  it("does not show a non-email session fallback when profile loading fails", async () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          id: "1",
          scope: "platform",
          name: "yonnock",
          email: "operator:2",
        },
      },
      status: "authenticated",
      update: mockUpdateSession,
    });
    fetchMock.mockRejectedValueOnce(new Error("Network error"));

    renderPage();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/operator/profile",
        expect.objectContaining({ method: "GET" }),
      );
    });
    // Anker: der Fehlerzweig des Profilladens ist gerendert.
    expect(
      await screen.findByText(catalogText("general.unavailable", "das Profil")),
    ).toBeInTheDocument();
    expect(screen.queryByText("operator:2")).not.toBeInTheDocument();
  });

  it("keeps an email session fallback when profile loading fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network error"));

    renderPage();

    expect(
      await screen.findByText(catalogText("general.unavailable", "das Profil")),
    ).toBeInTheDocument();
    expect(screen.getByText("john@example.com")).toBeInTheDocument();
  });

  it("does not show an address as the name when profile loading fails (#7305)", async () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          id: "1",
          scope: "platform",
          name: "name@example.com",
          email: "john@example.com",
        },
      },
      status: "authenticated",
      update: mockUpdateSession,
    });
    fetchMock.mockRejectedValueOnce(new Error("Network error"));

    renderPage();

    expect(
      await screen.findByText(catalogText("general.unavailable", "das Profil")),
    ).toBeInTheDocument();
    expect(screen.getByText("john@example.com")).toBeInTheDocument();
    expect(screen.queryByText("name@example.com")).not.toBeInTheDocument();
  });

  // #2519: a failed profile load is visible with retry instead of silent.
  it("shows a failed profile load with retry", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "general.unavailable" }), {
        status: 503,
      }),
    );

    renderPage();

    expect(
      await screen.findByText(catalogText("general.unavailable", "das Profil")),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    expect(
      await screen.findByText("mail@yannickwenger.de"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(catalogText("general.unavailable", "das Profil")),
    ).toBeNull();
  });

  it("updates profile on save", async () => {
    renderPage();

    fireEvent.click(await screen.findByText("Bearbeiten"));

    const displayNameInput = screen.getByLabelText("Anzeigename");
    fireEvent.change(displayNameInput, { target: { value: "Jane Doe" } });

    const saveButton = screen.getByText("Speichern");
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/operator/profile",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ display_name: "Jane Doe" }),
        }),
      );
    });

    await waitFor(() => {
      expect(mockUpdateSession).toHaveBeenCalled();
    });
    expect(mockToastSuccess).toHaveBeenCalledWith(
      "Profil erfolgreich aktualisiert",
      { duration: 3000 },
    );
  });

  it("handles save error gracefully", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/operator/profile" && init?.method === "GET") {
        return {
          ok: true,
          json: async () => ({ data: defaultProfile }),
        } as Response;
      }
      return new Response(
        JSON.stringify({
          error: "Something went wrong",
          code: "general.input",
          errors: [{ field: "display_name", reason: "too_long" }],
        }),
        { status: 400 },
      );
    });

    renderPage();

    fireEvent.click(await screen.findByText("Bearbeiten"));

    const saveButton = screen.getByText("Speichern");
    fireEvent.click(saveButton);

    expect(
      await screen.findByText(catalogText("general.input", "das Profil")),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Anzeigename")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(mockUpdateSession).not.toHaveBeenCalled();
    expect(screen.queryByText("Something went wrong")).toBeNull();
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("cancels editing and restores original values", async () => {
    renderPage();

    fireEvent.click(await screen.findByText("Bearbeiten"));

    const displayNameInput = screen.getByLabelText("Anzeigename");
    fireEvent.change(displayNameInput, { target: { value: "Changed Name" } });

    fireEvent.click(screen.getByText("Abbrechen"));

    await waitFor(() => {
      expect(screen.getByText("yonnock")).toBeInTheDocument();
    });
    expect(screen.queryByLabelText("Anzeigename")).not.toBeInTheDocument();
  });

  it("displays initials correctly", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Y")).toBeInTheDocument();
    });
  });

  it("handles single word name initials", async () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          id: "1",
          scope: "platform",
          name: "Admin",
          email: "admin@example.com",
        },
      },
      status: "authenticated",
      update: mockUpdateSession,
    });
    fetchMock.mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        data: { id: 1, email: "admin@example.com", display_name: "Admin" },
      }),
    }));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("A")).toBeInTheDocument();
    });
  });

  describe("email change dialog", () => {
    // The e-mail change is its own flow (password check, confirmation link)
    // and is reachable without entering the edit state of the master data
    // (#3117).
    it("offers the email change without entering the edit state", async () => {
      renderPage();

      expect(await screen.findByText("E-Mail ändern")).toBeInTheDocument();
      expect(screen.queryByLabelText("Anzeigename")).not.toBeInTheDocument();
    });

    it("opens email change dialog with form fields", async () => {
      renderPage();

      fireEvent.click(await screen.findByText("E-Mail ändern"));

      await waitFor(() => {
        expect(screen.getByText("E-Mail-Adresse ändern")).toBeInTheDocument();
        expect(
          screen.getByLabelText("Neue E-Mail-Adresse"),
        ).toBeInTheDocument();
        expect(screen.getByLabelText("Aktuelles Passwort")).toBeInTheDocument();
        expect(
          screen.getByText("E-Mail-Änderung anfordern"),
        ).toBeInTheDocument();
      });
    });

    it("submits email change request successfully", async () => {
      renderPage();

      fireEvent.click(await screen.findByText("E-Mail ändern"));

      await waitFor(() => {
        expect(
          screen.getByLabelText("Neue E-Mail-Adresse"),
        ).toBeInTheDocument();
      });

      fireEvent.change(screen.getByLabelText("Neue E-Mail-Adresse"), {
        target: { value: "new@example.com" },
      });
      fireEvent.change(screen.getByLabelText("Aktuelles Passwort"), {
        target: { value: "mypassword" },
      });

      fireEvent.click(screen.getByText("E-Mail-Änderung anfordern"));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/operator/profile/email-change",
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({
              new_email: "new@example.com",
              current_password: "mypassword",
            }),
          }),
        );
      });
      expect(mockToastSuccess).toHaveBeenCalledWith(
        "Eine Bestätigungs-E-Mail wird an new@example.com gesendet. Bitte überprüfe dein Postfach.",
        { duration: 3000 },
      );
    });

    it("does not submit an invalid email address", async () => {
      renderPage();

      fireEvent.click(await screen.findByText("E-Mail ändern"));

      const emailInput = await screen.findByLabelText("Neue E-Mail-Adresse");
      fireEvent.change(emailInput, { target: { value: "foo" } });
      fireEvent.change(screen.getByLabelText("Aktuelles Passwort"), {
        target: { value: "mypassword" },
      });

      fireEvent.click(screen.getByText("E-Mail-Änderung anfordern"));

      expect(emailInput).toBeInvalid();
      expect(fetchMock).not.toHaveBeenCalledWith(
        "/api/operator/profile/email-change",
        expect.anything(),
      );
    });

    it("does not submit an email address without a top-level domain", async () => {
      renderPage();

      fireEvent.click(await screen.findByText("E-Mail ändern"));

      const emailInput = await screen.findByLabelText("Neue E-Mail-Adresse");
      fireEvent.change(emailInput, { target: { value: "user@localhost" } });
      fireEvent.change(screen.getByLabelText("Aktuelles Passwort"), {
        target: { value: "mypassword" },
      });

      fireEvent.click(screen.getByText("E-Mail-Änderung anfordern"));

      expect(emailInput).toBeInvalid();
      expect(fetchMock).not.toHaveBeenCalledWith(
        "/api/operator/profile/email-change",
        expect.anything(),
      );
    });

    it("closes dialog after successful submission", async () => {
      renderPage();

      fireEvent.click(await screen.findByText("E-Mail ändern"));

      await waitFor(() => {
        expect(
          screen.getByLabelText("Neue E-Mail-Adresse"),
        ).toBeInTheDocument();
      });

      fireEvent.change(screen.getByLabelText("Neue E-Mail-Adresse"), {
        target: { value: "new@example.com" },
      });
      fireEvent.change(screen.getByLabelText("Aktuelles Passwort"), {
        target: { value: "pass" },
      });

      fireEvent.click(screen.getByText("E-Mail-Änderung anfordern"));

      await waitFor(() => {
        expect(
          screen.queryByText("E-Mail-Adresse ändern"),
        ).not.toBeInTheDocument();
      });
    });

    it("sends error response without closing dialog on wrong password", async () => {
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (url === "/api/operator/profile" && init?.method === "GET") {
          return {
            ok: true,
            json: async () => ({ data: defaultProfile }),
          } as Response;
        }
        return new Response(
          JSON.stringify({
            error: "Das aktuelle Passwort ist falsch",
            code: "identity.current_password_wrong",
            errors: [{ field: "current_password", reason: "wrong" }],
          }),
          { status: 400 },
        );
      });

      renderPage();

      fireEvent.click(await screen.findByText("E-Mail ändern"));

      await waitFor(() => {
        expect(
          screen.getByLabelText("Neue E-Mail-Adresse"),
        ).toBeInTheDocument();
      });

      fireEvent.change(screen.getByLabelText("Neue E-Mail-Adresse"), {
        target: { value: "new@example.com" },
      });
      fireEvent.change(screen.getByLabelText("Aktuelles Passwort"), {
        target: { value: "wrong" },
      });

      fireEvent.click(screen.getByText("E-Mail-Änderung anfordern"));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/operator/profile/email-change",
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({
              new_email: "new@example.com",
              current_password: "wrong",
            }),
          }),
        );
      });

      // Dialog stays open — error path does not close it
      expect(screen.getByText("E-Mail-Adresse ändern")).toBeInTheDocument();
      // #2519: by code, no text matching on the backend sentence.
      expect(
        await screen.findByText(
          catalogText(
            "identity.current_password_wrong",
            "die Änderung der E-Mail-Adresse",
          ),
        ),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Aktuelles Passwort")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      expect(screen.queryByText("Das aktuelle Passwort ist falsch")).toBeNull();
    });

    it("keeps dialog open on other API errors", async () => {
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (url === "/api/operator/profile" && init?.method === "GET") {
          return {
            ok: true,
            json: async () => ({ data: defaultProfile }),
          } as Response;
        }
        return {
          ok: false,
          json: async () => ({ error: "E-Mail bereits verwendet" }),
        } as Response;
      });

      renderPage();

      fireEvent.click(await screen.findByText("E-Mail ändern"));

      await waitFor(() => {
        expect(
          screen.getByLabelText("Neue E-Mail-Adresse"),
        ).toBeInTheDocument();
      });

      fireEvent.change(screen.getByLabelText("Neue E-Mail-Adresse"), {
        target: { value: "taken@example.com" },
      });
      fireEvent.change(screen.getByLabelText("Aktuelles Passwort"), {
        target: { value: "pass" },
      });

      fireEvent.click(screen.getByText("E-Mail-Änderung anfordern"));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/operator/profile/email-change",
          expect.objectContaining({ method: "POST" }),
        );
      });

      // Dialog stays open on error
      expect(screen.getByText("E-Mail-Adresse ändern")).toBeInTheDocument();
    });

    it("keeps dialog open on network error", async () => {
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (url === "/api/operator/profile" && init?.method === "GET") {
          return {
            ok: true,
            json: async () => ({ data: defaultProfile }),
          } as Response;
        }
        throw new Error("Network error");
      });

      renderPage();

      fireEvent.click(await screen.findByText("E-Mail ändern"));

      await waitFor(() => {
        expect(
          screen.getByLabelText("Neue E-Mail-Adresse"),
        ).toBeInTheDocument();
      });

      fireEvent.change(screen.getByLabelText("Neue E-Mail-Adresse"), {
        target: { value: "new@example.com" },
      });
      fireEvent.change(screen.getByLabelText("Aktuelles Passwort"), {
        target: { value: "pass" },
      });

      fireEvent.click(screen.getByText("E-Mail-Änderung anfordern"));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/operator/profile/email-change",
          expect.objectContaining({ method: "POST" }),
        );
      });

      // Dialog stays open on network error
      expect(screen.getByText("E-Mail-Adresse ändern")).toBeInTheDocument();
      expect(
        await screen.findByText(
          catalogText("general.unavailable", "die Änderung der E-Mail-Adresse"),
        ),
      ).toBeInTheDocument();
    });

    it("closes dialog and resets fields on cancel", async () => {
      renderPage();

      fireEvent.click(await screen.findByText("E-Mail ändern"));

      await waitFor(() => {
        expect(
          screen.getByLabelText("Neue E-Mail-Adresse"),
        ).toBeInTheDocument();
      });

      fireEvent.change(screen.getByLabelText("Neue E-Mail-Adresse"), {
        target: { value: "typed@example.com" },
      });

      // The dialog's Abbrechen is the only one on the page while the master
      // data are not being edited.
      const cancelButtons = screen.getAllByText("Abbrechen");
      const dialogCancel = cancelButtons.find(
        (btn) => btn.closest('[role="dialog"]') !== null,
      );
      fireEvent.click(dialogCancel ?? cancelButtons[0]!);

      await waitFor(() => {
        expect(
          screen.queryByText("E-Mail-Adresse ändern"),
        ).not.toBeInTheDocument();
      });
    });
  });

  // #2519: the password dialog runs on the shared form error path, so a
  // refused current password marks its field with the catalog text.
  it("hands the password dialog the shared form error path", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("Passwort ändern"));

    const props = passwordModalProps.current;
    expect(props?.apiEndpoint).toBe("/api/operator/profile/password");
    expect(props?.formRef).toBeDefined();
    expect(props?.errorPath).toMatchObject({
      show: expect.any(Function),
      invalid: expect.any(Function),
      fieldError: expect.any(Function),
    });
  });
  // The backend ends every operator session with the password change, this
  // one too: the page signs out and the login asks for the new password.
  it("signs out after a password change", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("Passwort ändern"));

    const onSuccess = passwordModalProps.current?.onSuccess as () => void;
    await act(async () => onSuccess());

    await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem(PASSWORD_CHANGED_KEY)).toBe("1");
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });
});
