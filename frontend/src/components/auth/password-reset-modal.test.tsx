import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiError } from "~/lib/api-error";
import { catalogText } from "~/test/error-catalog-text";
import { PasswordResetModal } from "./password-reset-modal";
import { readResetWaits, rememberResetWait } from "./password-reset-wait";

function ResetModal(
  props: Omit<ComponentProps<typeof PasswordResetModal>, "portal">,
) {
  return <PasswordResetModal portal="tenant" {...props} />;
}

function rateLimited(retryAfterSeconds: number): ApiError {
  const error = new ApiError("too many reset requests", 429, {
    code: "identity.password_reset_rate_limited",
  });
  error.retryAfterSeconds = retryAfterSeconds;
  return error;
}

vi.mock("~/components/ui/modal", () => ({
  Modal: ({
    isOpen,
    title,
    description,
    children,
    footer,
    onClose,
  }: {
    isOpen: boolean;
    title: string;
    description?: React.ReactNode;
    children: React.ReactNode;
    footer?: React.ReactNode;
    onClose: () => void;
  }) => {
    return isOpen ? (
      <div data-testid="modal">
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
        <button type="button" onClick={onClose}>
          Close Modal
        </button>
        {children}
        {footer}
      </div>
    ) : null;
  },
}));

vi.mock("~/components/ui/input", () => ({
  Input: ({
    id,
    value,
    onChange,
    disabled,
    controlSize,
    label,
    ...props
  }: {
    id: string;
    value: string;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    disabled?: boolean;
    type?: string;
    name?: string;
    autoComplete?: string;
    required?: boolean;
    className?: string;
    label?: string;
    controlSize?: "default" | "compact";
  }) => (
    <>
      {label ? <label htmlFor={id}>{label}</label> : null}
      <input
        id={id}
        data-testid={`input-${id}`}
        data-control-size={controlSize}
        value={value}
        onChange={onChange}
        disabled={disabled}
        {...props}
      />
    </>
  ),
}));

vi.mock("~/components/ui/alert", () => ({
  Alert: ({ type, message }: { type: string; message: string }) => (
    <div data-testid={`alert-${type}`}>{message}</div>
  ),
}));

const mockRequestPasswordReset = vi.fn();
vi.mock("~/lib/auth-api", () => ({
  requestPasswordReset: (portal: string, email: string): unknown =>
    mockRequestPasswordReset(portal, email),
}));

const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
});

describe("PasswordResetModal", () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    mockRequestPasswordReset.mockResolvedValue({});
  });

  it("renders password reset form", () => {
    render(<ResetModal isOpen={true} onClose={mockOnClose} />);

    expect(screen.getByText(/Passwort zurücksetzen/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/E-Mail-Adresse/i)).toBeInTheDocument();
  });

  it("answers neutrally and names the address after a request", async () => {
    render(<ResetModal isOpen={true} onClose={mockOnClose} />);

    fireEvent.change(screen.getByTestId("input-reset-email"), {
      target: { value: " Test@Example.com " },
    });
    fireEvent.click(screen.getByRole("button", { name: /Link senden/i }));

    expect(
      await screen.findByRole("heading", {
        name: "Bitte prüfen Sie Ihr Postfach",
      }),
    ).toBeInTheDocument();
    // The answer is the same for every address (#7213): no claim of a mail.
    expect(
      screen.getByText(/Wenn es zu dieser Adresse ein Konto gibt/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/E-Mail versendet/)).not.toBeInTheDocument();
    expect(screen.getByText("test@example.com")).toBeInTheDocument();
    expect(screen.getByText(/Spam-Ordner/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Schließen/i }),
    ).toBeInTheDocument();
  });

  it("goes back to the form with the address to correct it", async () => {
    render(<ResetModal isOpen={true} onClose={mockOnClose} />);

    fireEvent.change(screen.getByTestId("input-reset-email"), {
      target: { value: "tippfehler@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Link senden/i }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Adresse ändern" }),
    );

    expect(screen.getByTestId("input-reset-email")).toHaveValue(
      "tippfehler@example.com",
    );
    expect(
      screen.getByRole("heading", { name: "Passwort zurücksetzen" }),
    ).toBeInTheDocument();
  });

  it("calls onClose when cancel button is clicked", () => {
    render(<ResetModal isOpen={true} onClose={mockOnClose} />);

    const cancelButton = screen.getByRole("button", { name: /Abbrechen/i });
    fireEvent.click(cancelButton);

    expect(mockOnClose).toHaveBeenCalled();
  });

  it("disables submit button during loading", async () => {
    mockRequestPasswordReset.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 1000)),
    );

    render(<ResetModal isOpen={true} onClose={mockOnClose} />);

    const emailInput = screen.getByTestId("input-reset-email");
    fireEvent.change(emailInput, { target: { value: "test@example.com" } });

    const submitButton = screen.getByRole("button", { name: /Link senden/i });
    fireEvent.click(submitButton);

    expect(submitButton).toBeDisabled();
  });

  it("handles API errors", async () => {
    mockRequestPasswordReset.mockRejectedValue(
      new ApiError("smtp unavailable", 500),
    );

    render(<ResetModal isOpen={true} onClose={mockOnClose} />);

    const emailInput = screen.getByTestId("input-reset-email");
    fireEvent.change(emailInput, { target: { value: "test@example.com" } });

    const submitButton = screen.getByRole("button", { name: /Link senden/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByTestId("alert-error")).toHaveTextContent(
        /Das Senden des Links konnte nicht bearbeitet werden/i,
      );
    });
  });

  it("marks a malformed address at the field without sending it", async () => {
    render(<ResetModal isOpen={true} onClose={mockOnClose} />);

    fireEvent.change(screen.getByTestId("input-reset-email"), {
      target: { value: "lehrer@schule" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Link senden/i }));

    expect(await screen.findByTestId("alert-error")).toHaveTextContent(
      "Bitte geben Sie eine gültige E-Mail-Adresse ein.",
    );
    expect(screen.getByTestId("input-reset-email")).toHaveAttribute(
      "error",
      "Bitte geben Sie eine gültige E-Mail-Adresse ein.",
    );
    expect(mockRequestPasswordReset).not.toHaveBeenCalled();
  });

  it("shows the input text when the backend refuses the address", async () => {
    mockRequestPasswordReset.mockRejectedValue(
      new ApiError("a valid email is required", 400, { code: "general.input" }),
    );
    render(<ResetModal isOpen={true} onClose={mockOnClose} />);

    fireEvent.change(screen.getByTestId("input-reset-email"), {
      target: { value: "test@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Link senden/i }));

    expect(await screen.findByTestId("alert-error")).toHaveTextContent(
      catalogText("general.input", "das Senden des Links"),
    );
    expect(mockRequestPasswordReset).toHaveBeenCalledWith(
      "tenant",
      "test@example.com",
    );
  });

  it("shows the wait for the refused address as a warning", async () => {
    mockRequestPasswordReset.mockRejectedValue(rateLimited(60));

    render(<ResetModal isOpen={true} onClose={mockOnClose} />);

    fireEvent.change(screen.getByTestId("input-reset-email"), {
      target: { value: "test@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Link senden/i }));

    expect(await screen.findByTestId("alert-warning")).toHaveTextContent(
      "Für diese Adresse wurde schon mehrmals ein Link angefordert. Einen neuen Link können Sie in 01:00 Minuten anfordern.",
    );
    // A wait is no failure of the dialog: no error alert.
    expect(screen.queryByTestId("alert-error")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/01:00 Minuten/);
    expect(
      screen.getByRole("button", { name: /Link senden/i }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("blocks only the address the wait was reported for", async () => {
    mockRequestPasswordReset.mockRejectedValueOnce(rateLimited(60));

    render(<ResetModal isOpen={true} onClose={mockOnClose} />);

    const input = screen.getByTestId("input-reset-email");
    fireEvent.change(input, { target: { value: "tippfehler@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Link senden/i }));
    expect(await screen.findByTestId("alert-warning")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "richtig@example.com" } });
    expect(screen.queryByTestId("alert-warning")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Link senden/i }));
    expect(
      await screen.findByRole("heading", {
        name: "Bitte prüfen Sie Ihr Postfach",
      }),
    ).toBeInTheDocument();
    expect(mockRequestPasswordReset).toHaveBeenLastCalledWith(
      "tenant",
      "richtig@example.com",
    );

    // The same address in another spelling waits as well.
    fireEvent.click(screen.getByRole("button", { name: "Adresse ändern" }));
    fireEvent.change(screen.getByTestId("input-reset-email"), {
      target: { value: "Tippfehler@Example.com" },
    });
    expect(screen.getByTestId("alert-warning")).toBeInTheDocument();
  });

  it("stores the wait without the address", async () => {
    mockRequestPasswordReset.mockRejectedValue(rateLimited(60));

    render(<ResetModal isOpen={true} onClose={mockOnClose} />);

    fireEvent.change(screen.getByTestId("input-reset-email"), {
      target: { value: "test@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Link senden/i }));

    await waitFor(() => {
      expect(localStorageMock.getItem("passwordResetWaits")).toBeTruthy();
    });
    const stored = localStorageMock.getItem("passwordResetWaits") ?? "";
    expect(stored).not.toContain("test");
    expect(stored).not.toContain("example");
    expect(Object.values(JSON.parse(stored) as object)).toEqual([
      Date.now() + 60_000,
    ]);
  });

  it("restores the wait of the address from localStorage", () => {
    rememberResetWait({}, "test@example.com", Date.now() + 60_000, Date.now());

    render(
      <ResetModal
        isOpen={true}
        onClose={mockOnClose}
        initialEmail="test@example.com"
      />,
    );

    expect(screen.getByTestId("alert-warning")).toHaveTextContent(
      /in 01:00 Minuten/,
    );
    expect(
      screen.getByRole("button", { name: /Link senden/i }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("drops expired waits and the old address-less wait", () => {
    rememberResetWait({}, "test@example.com", Date.now() + 1000, Date.now());
    localStorageMock.setItem(
      "passwordResetRateLimitUntil",
      String(Date.now() + 60_000),
    );
    // One second later the stored wait has run out.
    expect(readResetWaits(Date.now() + 1000)).toEqual({});

    render(
      <ResetModal
        isOpen={true}
        onClose={mockOnClose}
        initialEmail="test@example.com"
      />,
    );

    // Anker: das Formular steht da und der Knopf ist frei.
    expect(screen.getByRole("button", { name: /Link senden/i })).toBeEnabled();
    expect(screen.queryByTestId("alert-warning")).not.toBeInTheDocument();
    expect(localStorageMock.getItem("passwordResetRateLimitUntil")).toBeNull();
    expect(localStorageMock.getItem("passwordResetWaits")).toBeNull();
  });
});
