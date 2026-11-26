import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render as renderPlain,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { ToastProvider } from "~/contexts/ToastContext";
import { catalogText } from "~/test/error-catalog-text";

function render(ui: React.ReactElement) {
  return renderPlain(ui, { wrapper: ToastProvider });
}

// Mock dependencies
const {
  mockPush,
  mockRedirect,
  mockSignIn,
  mockSignOut,
  mockUseSession,
  mockUpdate,
} = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockPush: vi.fn(),
  mockRedirect: vi.fn(),
  mockSignIn: vi.fn(),
  mockSignOut: vi.fn(),
  mockUseSession: vi.fn(),
}));

const originalFetch = global.fetch;

function mockOperatorFetchResponse(
  status: number,
  body: unknown,
): typeof global.fetch {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function mockAuthenticatedResponse(): typeof global.fetch {
  return mockOperatorFetchResponse(200, {
    status: "success",
    data: {
      status: "authenticated",
    },
    message: "Login successful",
  });
}

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: (props: Record<string, unknown>) => <img {...props} />,
}));

vi.mock("next-auth/react", () => ({
  signIn: mockSignIn,
  signOut: mockSignOut,
  useSession: mockUseSession,
}));
// The login page ends a stale cookie through Auth.js' signout protocol,
// bound to the session mark (#8082).
vi.mock("~/lib/tenant-session-cookie", async (original) => ({
  ...(await original<typeof import("~/lib/tenant-session-cookie")>()),
  signOutSession: (...args: unknown[]) => mockSignOut(...args),
}));

// Mock operator-url to avoid NEXT_PUBLIC_OPERATOR_HOSTNAME requirement
vi.mock("~/lib/operator-url", () => ({
  operatorPath: (path: string) => path,
  isOperatorSubdomain: () => false,
}));

vi.mock("~/components/ui/alert", () => ({
  Alert: ({ message }: { message: string }) => (
    <div role="alert">{message}</div>
  ),
}));

vi.mock("~/components/ui/loading", () => ({
  Loading: () => <div>Loading...</div>,
}));

import OperatorLoginPage from "./page";

/** Fills both fields: the form names an empty field before sending. */
function submitFilled() {
  fireEvent.change(screen.getByLabelText("E-Mail-Adresse"), {
    target: { value: "op@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Passwort"), {
    target: { value: "password123" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Anmelden/i }));
}

describe("OperatorLoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSession.mockReturnValue({
      status: "unauthenticated",
      data: null,
      update: mockUpdate,
    });
    mockUpdate.mockResolvedValue(undefined);
    // The login opens a new document (#8082).
    mockPush.mockReset();
    vi.spyOn(window.location, "assign").mockImplementation(mockPush);
    global.fetch = mockAuthenticatedResponse();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("renders login form", () => {
    render(<OperatorLoginPage />);

    expect(screen.getByText("Operator Console")).toBeInTheDocument();
    expect(screen.getByText("Interner Plattformzugang")).toBeInTheDocument();
    expect(screen.getByText("Operator Dashboard")).toBeInTheDocument();
    expect(screen.getByLabelText("E-Mail-Adresse")).toBeInTheDocument();
    expect(screen.getByLabelText("Passwort")).toBeInTheDocument();
  });

  it("submits form with email and password (2-step MFA flow)", async () => {
    mockSignIn.mockResolvedValue({ error: null });

    render(<OperatorLoginPage />);

    const emailInput = screen.getByLabelText("E-Mail-Adresse");
    const passwordInput = screen.getByLabelText("Passwort");
    const submitButton = screen.getByRole("button", { name: /Anmelden/i });

    fireEvent.change(emailInput, { target: { value: "test@example.com" } });
    fireEvent.change(passwordInput, { target: { value: "password123" } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/operator/auth/login",
        expect.objectContaining({
          method: "POST",
          credentials: "include",
          body: JSON.stringify({
            email: "test@example.com",
            password: "password123",
          }),
        }),
      );
    });
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/operator/organizations");
      expect(mockSignIn).not.toHaveBeenCalled();
    });
  });

  it("shows error message on login failure (401)", async () => {
    const assign = vi
      .spyOn(window.location, "assign")
      .mockImplementation(() => undefined);
    global.fetch = mockOperatorFetchResponse(401, {
      status: 401,
      detail: "Invalid credentials",
      code: "identity.invalid_credentials",
    });

    render(<OperatorLoginPage />);

    const emailInput = screen.getByLabelText("E-Mail-Adresse");
    const passwordInput = screen.getByLabelText("Passwort");
    const submitButton = screen.getByRole("button", { name: /Anmelden/i });

    fireEvent.change(emailInput, { target: { value: "test@example.com" } });
    fireEvent.change(passwordInput, { target: { value: "wrong" } });
    fireEvent.click(submitButton);

    // #2519: the catalog text by code, never the backend sentence. The
    // refusal stays in the form instead of leaving for the login screen.
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        catalogText("identity.invalid_credentials", "die Anmeldung"),
      );
    });
    expect(screen.queryByText("Invalid credentials")).toBeNull();
    expect(assign).not.toHaveBeenCalled();
    assign.mockRestore();
  });

  it("shows loading state during authentication", async () => {
    let resolveUpdate: (value: { error: null }) => void = () => undefined;
    mockUpdate.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve;
        }),
    );

    render(<OperatorLoginPage />);

    const emailInput = screen.getByLabelText("E-Mail-Adresse");
    fireEvent.change(emailInput, { target: { value: "op@example.com" } });
    const passwordInput = screen.getByLabelText("Passwort");
    fireEvent.change(passwordInput, { target: { value: "password123" } });

    const submitButton = screen.getByRole("button", { name: /Anmelden/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText("Anmeldung läuft …")).toBeInTheDocument();
    });

    await act(async () => {
      resolveUpdate({ error: null });
    });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/operator/organizations");
    });
  });

  // The layout's server snapshot carries no token (#4991).
  it("redirects an operator whose session came from the server snapshot", () => {
    mockUseSession.mockReturnValue({
      status: "authenticated",
      data: { user: { id: "1", scope: "platform" } },
    });

    render(<OperatorLoginPage />);

    expect(mockRedirect).toHaveBeenCalledWith("/operator/organizations");
  });

  // The browser session carries no token (#5005): a session without a
  // usable access token is marked with an error and never enters the portal.
  it("does not redirect a session without a usable access token", async () => {
    mockSignOut.mockResolvedValue(undefined);
    mockUseSession.mockReturnValue({
      status: "authenticated",
      data: {
        error: "RefreshTokenError",
        user: { id: "1", scope: "platform" },
      },
    });

    render(<OperatorLoginPage />);

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalledWith("operator", "");
    });
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("shows loading screen while checking auth", () => {
    mockUseSession.mockReturnValue({
      status: "loading",
      data: null,
      update: mockUpdate,
    });

    render(<OperatorLoginPage />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("submits form when submit event is triggered", async () => {
    mockSignIn.mockResolvedValue({ error: null });

    render(<OperatorLoginPage />);

    const emailInput = screen.getByLabelText("E-Mail-Adresse");
    fireEvent.change(emailInput, { target: { value: "test@example.com" } });

    const passwordInput = screen.getByLabelText("Passwort");
    fireEvent.change(passwordInput, {
      target: { value: "password123" },
    });

    const form = screen
      .getByRole("button", { name: /Anmelden/i })
      .closest("form")!;
    await act(async () => {
      fireEvent.submit(form);
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/operator/auth/login",
        expect.objectContaining({ method: "POST" }),
      );
    });
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/operator/organizations");
      expect(mockSignIn).not.toHaveBeenCalled();
    });
  });

  it("shows the inactive-account text by code (HTTP 403)", async () => {
    global.fetch = mockOperatorFetchResponse(403, {
      status: "error",
      error: "Account inactive",
      code: "identity.account_inactive",
    });

    render(<OperatorLoginPage />);

    const emailInput = screen.getByLabelText("E-Mail-Adresse");
    const passwordInput = screen.getByLabelText("Passwort");
    const submitButton = screen.getByRole("button", { name: /Anmelden/i });

    fireEvent.change(emailInput, { target: { value: "test@example.com" } });
    fireEvent.change(passwordInput, { target: { value: "password" } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        catalogText("identity.account_inactive", "die Anmeldung"),
      );
    });
  });

  // The limiter's 429 carries only the class code, whose text would ask to
  // try again at once.
  it("shows the limiter's 429 as too many attempts", async () => {
    global.fetch = mockOperatorFetchResponse(429, {
      status: "error",
      error: "Too many requests",
    });

    render(<OperatorLoginPage />);

    submitFilled();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Zu viele Anmeldeversuche. Bitte versuche es später erneut.",
      );
    });
  });

  it("shows a network failure as unavailable", async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    render(<OperatorLoginPage />);

    submitFilled();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        catalogText("general.unavailable", "die Anmeldung"),
      );
    });
  });

  it("shows fallback error when fetch throws a non-Error", async () => {
    global.fetch = vi.fn().mockRejectedValue("unknown failure");

    render(<OperatorLoginPage />);

    submitFilled();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        catalogText("general.unavailable", "die Anmeldung"),
      );
    });
  });

  it("shows a failed BFF session creation on the shared path", async () => {
    global.fetch = mockOperatorFetchResponse(500, { code: "general.server" });

    render(<OperatorLoginPage />);
    submitFilled();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        catalogText("general.server", "die Anmeldung"),
      );
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("keeps the MFA form visible if the safe session refresh fails after confirmation", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "success",
            data: {
              status: "mfa_required",
              challenge_token: "challenge",
              masked_email: "a***@example.test",
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "success",
            data: { status: "authenticated" },
          }),
          { status: 200 },
        ),
      );
    mockUpdate.mockRejectedValueOnce(new Error("safe session read failed"));
    render(<OperatorLoginPage />);
    submitFilled();
    expect(
      await screen.findByRole("heading", { name: "Code-Eingabe" }),
    ).toBeInTheDocument();
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0]!, { target: { value: "123456" } });
    fireEvent.click(
      screen.getByRole("button", { name: /^Nein, nur anmelden/ }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      catalogText("general.server", "die Prüfung des Codes"),
    );
    expect(
      screen.getByRole("heading", { name: "Code-Eingabe" }),
    ).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it("explains an expired session from the URL", () => {
    window.history.replaceState({}, "", "/operator/login?error=SessionExpired");

    render(<OperatorLoginPage />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.",
    );
    expect(window.location.search).toBe("");
  });

  it("does not redirect when authenticated but not operator scope", () => {
    mockUseSession.mockReturnValue({
      status: "authenticated",
      data: { user: { scope: "tenant" } },
    });

    render(<OperatorLoginPage />);

    expect(mockRedirect).not.toHaveBeenCalled();
    expect(screen.getByText("Operator Console")).toBeInTheDocument();
  });
});
