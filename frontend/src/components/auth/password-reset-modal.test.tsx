import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiError } from "~/lib/api-error";
import { catalogText } from "~/test/error-catalog-text";
import { PasswordResetModal } from "./password-reset-modal";

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
    children,
    onClose,
  }: {
    isOpen: boolean;
    children: React.ReactNode;
    onClose: () => void;
  }) => {
    return isOpen ? (
      <div data-testid="modal">
        <button type="button" onClick={onClose}>
          Close Modal
        </button>
        {children}
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

  it("displays success state after successful submission", async () => {
    render(<ResetModal isOpen={true} onClose={mockOnClose} />);

    const emailInput = screen.getByTestId("input-reset-email");
    fireEvent.change(emailInput, { target: { value: "test@example.com" } });

    const submitButton = screen.getByRole("button", { name: /Link senden/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/E-Mail versendet!/i)).toBeInTheDocument();
    });
    expect(
      screen.getByText(/Wir haben Ihnen eine E-Mail/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Bitte überprüfen Sie Ihren Posteingang/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Schließen/i }),
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

  it("handles rate limit errors with countdown", async () => {
    mockRequestPasswordReset.mockRejectedValue(rateLimited(60));

    render(<ResetModal isOpen={true} onClose={mockOnClose} />);

    const emailInput = screen.getByTestId("input-reset-email");
    fireEvent.change(emailInput, { target: { value: "test@example.com" } });

    const submitButton = screen.getByRole("button", { name: /Link senden/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(
        screen.getByText(/Sie haben zu oft einen Link angefordert/i),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText(/Einen neuen Link können Sie in 01:00 anfordern/i),
    ).toBeInTheDocument();
    expect(submitButton).toBeDisabled();
  });

  it("persists rate limit to localStorage", async () => {
    mockRequestPasswordReset.mockRejectedValue(rateLimited(60));

    render(<ResetModal isOpen={true} onClose={mockOnClose} />);

    const emailInput = screen.getByTestId("input-reset-email");
    fireEvent.change(emailInput, { target: { value: "test@example.com" } });

    const submitButton = screen.getByRole("button", { name: /Link senden/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      const stored = localStorageMock.getItem("passwordResetRateLimitUntil");
      expect(stored).toBeTruthy();
    });
  });

  it("restores rate limit from localStorage", () => {
    const futureTimestamp = Date.now() + 60000;
    localStorageMock.setItem(
      "passwordResetRateLimitUntil",
      futureTimestamp.toString(),
    );

    render(<ResetModal isOpen={true} onClose={mockOnClose} />);

    expect(
      screen.getByText(/Einen neuen Link können Sie in/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Link senden/i })).toBeDisabled();
  });

  it("clears expired rate limit from localStorage", () => {
    const pastTimestamp = Date.now() - 1000;
    localStorageMock.setItem(
      "passwordResetRateLimitUntil",
      pastTimestamp.toString(),
    );

    render(<ResetModal isOpen={true} onClose={mockOnClose} />);

    // Anker: das Formular steht da und der Knopf ist wieder frei.
    expect(screen.getByRole("button", { name: /Link senden/i })).toBeEnabled();
    expect(
      screen.queryByText(/Einen neuen Link können Sie in/i),
    ).not.toBeInTheDocument();
    expect(localStorageMock.getItem("passwordResetRateLimitUntil")).toBeNull();
  });
});
