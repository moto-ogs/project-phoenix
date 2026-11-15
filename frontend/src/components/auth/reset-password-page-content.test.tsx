import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { releaseFakeTimers } from "~/test/clock";
import "@testing-library/jest-dom/vitest";

import {
  ResetPasswordPageContent,
  type ResetPasswordPageCopy,
} from "./reset-password-page-content";
import { ApiError } from "~/lib/api-error";
import { catalogText } from "~/test/error-catalog-text";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  confirmPasswordReset: vi.fn(),
  push: vi.fn(),
  token: null as string | null,
  tenant: null as unknown,
}));

// The page posts through its portal's confirmation; each test stands in a
// confirmation of its own.
vi.mock("~/lib/auth-api", () => ({
  confirmPasswordReset: mocks.confirmPasswordReset,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (key: string) => (key === "token" ? mocks.token : null),
  }),
}));

vi.mock("~/lib/tenant-router", () => ({
  useTenantRouter: () => ({ push: mocks.push }),
}));

vi.mock("~/lib/tenant-context", () => ({
  useTenantSafe: () => mocks.tenant,
}));

vi.mock("~/lib/tenant-api", () => ({
  loginImageSrc: (path: string) => `/resolved${path}`,
}));

// next/image is not globally mocked — render a plain img so the brand branch
// renders without Next's image optimization machinery.
vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { src, alt } = props as { src: string; alt: string };
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} />;
  },
}));

// ---------------------------------------------------------------------------
// Sentinel copy — distinct strings so assertions can't accidentally match
// unrelated UI text and each copy-driven branch is unambiguous.
// ---------------------------------------------------------------------------

const ERROR_OBJECT = "ERROR_OBJECT";

const COPY: ResetPasswordPageCopy = {
  missingToken: "MISSING_TOKEN",
  requestNewLink: "REQUEST_NEW_LINK",
  newLinkSubtitle: "NEW_LINK_SUBTITLE",
  backToLogin: "BACK_LABEL",
  errorObject: ERROR_OBJECT,
  passwordTooShort: "TOO_SHORT",
  passwordMissingUppercase: "NO_UPPERCASE",
  passwordMissingLowercase: "NO_LOWERCASE",
  passwordMissingNumber: "NO_NUMBER",
  passwordMissingSpecial: "NO_SPECIAL",
  passwordMismatch: "MISMATCH",
  successEyebrow: "SUCCESS_EYEBROW",
  successTitle: "SUCCESS_TITLE",
  successSubtitle: "SUCCESS_SUBTITLE",
  successBody: "SUCCESS_BODY",
  formEyebrow: "FORM_EYEBROW",
  formTitle: "FORM_TITLE",
  formSubtitle: "FORM_SUBTITLE",
  passwordLabel: "PW_LABEL",
  confirmPasswordLabel: "CONFIRM_LABEL",
  showPassword: "SHOW_PW",
  hidePassword: "HIDE_PW",
  requirementsTitle: "REQUIREMENTS_TITLE",
  requirements: ["REQ_1", "REQ_2", "REQ_3", "REQ_4"],
  submitting: "SUBMITTING",
  submit: "SUBMIT",
};

const VALID_PASSWORD = "Str0ngP@ssword";

function renderContent() {
  return render(<ResetPasswordPageContent portal="tenant" copy={COPY} />);
}

function fillPasswords(password: string, confirm = password) {
  fireEvent.change(screen.getByLabelText(COPY.passwordLabel), {
    target: { value: password },
  });
  fireEvent.change(screen.getByLabelText(COPY.confirmPasswordLabel), {
    target: { value: confirm },
  });
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: COPY.submit }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.confirmPasswordReset.mockReset().mockResolvedValue(undefined);
  mocks.token = "valid-token";
  mocks.tenant = null;
});

// ---------------------------------------------------------------------------
// Token handling
// ---------------------------------------------------------------------------

describe("ResetPasswordPageContent — token handling", () => {
  it("renders the form with an enabled submit when a token is present", () => {
    renderContent();

    expect(screen.getByText(COPY.formTitle)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: COPY.submit })).toBeEnabled();
    expect(screen.getByLabelText(COPY.passwordLabel)).toBeEnabled();
  });

  it("offers a new link instead of a form when no token is in the URL", () => {
    mocks.token = null;
    renderContent();

    // Anker: der Hinweis auf den unvollständigen Link steht da.
    expect(screen.getByText(COPY.missingToken)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: COPY.requestNewLink }),
    ).toHaveAttribute("href", "/?passwort-vergessen=1");
    expect(screen.queryByLabelText(COPY.passwordLabel)).not.toBeInTheDocument();
  });

  it("renders the password requirements list", () => {
    renderContent();

    expect(screen.getByText(COPY.requirementsTitle)).toBeInTheDocument();
    for (const requirement of COPY.requirements) {
      expect(screen.getByText(requirement)).toBeInTheDocument();
    }
  });
});

// ---------------------------------------------------------------------------
// Client-side password validation — one assertion per branch in
// validatePassword(), in the order the function checks them.
// ---------------------------------------------------------------------------

describe("ResetPasswordPageContent — password validation", () => {
  it.each([
    ["too short", "Aa1!", COPY.passwordTooShort],
    ["missing uppercase", "abcdefg1!", COPY.passwordMissingUppercase],
    ["missing lowercase", "ABCDEFG1!", COPY.passwordMissingLowercase],
    ["missing number", "Abcdefgh!", COPY.passwordMissingNumber],
    ["missing special char", "Abcdefg12", COPY.passwordMissingSpecial],
  ])(
    "blocks submit and shows the %s error",
    async (_label, password, expectedError) => {
      const confirmReset = mocks.confirmPasswordReset;
      renderContent();

      fillPasswords(password);
      submit();

      expect(await screen.findByText(expectedError)).toBeInTheDocument();
      expect(confirmReset).not.toHaveBeenCalled();
    },
  );

  it("blocks submit when the two passwords differ", async () => {
    const confirmReset = mocks.confirmPasswordReset;
    renderContent();

    fillPasswords(VALID_PASSWORD, `${VALID_PASSWORD}X`);
    submit();

    expect(await screen.findByText(COPY.passwordMismatch)).toBeInTheDocument();
    expect(confirmReset).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Submission success
// ---------------------------------------------------------------------------

describe("ResetPasswordPageContent — successful reset", () => {
  it("confirms with the portal, the token and both passwords, then shows the success screen", async () => {
    renderContent();

    fillPasswords(VALID_PASSWORD);
    submit();

    expect(await screen.findByText(COPY.successTitle)).toBeInTheDocument();
    expect(mocks.confirmPasswordReset).toHaveBeenCalledWith(
      "tenant",
      "valid-token",
      VALID_PASSWORD,
      VALID_PASSWORD,
    );
    expect(screen.getByText(COPY.successBody)).toBeInTheDocument();
  });

  it("opens the login after the post-success delay", async () => {
    vi.useFakeTimers();
    try {
      renderContent();

      fillPasswords(VALID_PASSWORD);
      submit();

      // Flush the awaited confirmation + the success state update.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByText(COPY.successTitle)).toBeInTheDocument();
      expect(mocks.push).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(mocks.push).toHaveBeenCalledWith("/");
    } finally {
      releaseFakeTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// Submission failure — catalog text per code (#2517)
// ---------------------------------------------------------------------------

describe("ResetPasswordPageContent — error display", () => {
  it.each<[string, ApiError, string]>([
    [
      "an expired or used link",
      new ApiError("invalid or expired reset token", 400, {
        code: "identity.password_reset_link_invalid",
      }),
      catalogText("identity.password_reset_link_invalid", ERROR_OBJECT),
    ],
    [
      "a weak password",
      new ApiError("password too weak", 400, {
        code: "identity.password_too_weak",
        errors: [{ field: "new_password", reason: "too weak" }],
      }),
      catalogText("identity.password_too_weak", ERROR_OBJECT),
    ],
    [
      "a server error",
      new ApiError("boom", 500),
      catalogText("general.server", ERROR_OBJECT),
    ],
  ])("shows the catalog text for %s", async (_label, error, expected) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    mocks.confirmPasswordReset.mockRejectedValue(error);
    renderContent();

    fillPasswords(VALID_PASSWORD);
    submit();

    expect(await screen.findByText(expected)).toBeInTheDocument();
    // The form is shown again (not the success screen) so the user can retry.
    expect(
      screen.getByRole("button", { name: COPY.submit }),
    ).toBeInTheDocument();
  });

  // Every portal answers an expired or used link with 410. The page is
  // unauthenticated: the link problem shows in the form, no redirect.
  it("keeps a 410 expired link in the form and does not redirect", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const assign = vi
      .spyOn(window.location, "assign")
      .mockImplementation(() => undefined);
    mocks.confirmPasswordReset.mockRejectedValue(
      new ApiError("invalid or expired reset token", 410, {
        code: "identity.password_reset_link_invalid",
      }),
    );
    renderContent();

    fillPasswords(VALID_PASSWORD);
    submit();

    expect(
      await screen.findByText(
        catalogText("identity.password_reset_link_invalid", ERROR_OBJECT),
      ),
    ).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
    assign.mockRestore();
  });

  it("marks the password field the backend refused", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    mocks.confirmPasswordReset.mockRejectedValue(
      new ApiError("password too weak", 400, {
        code: "identity.password_too_weak",
        errors: [{ field: "new_password", reason: "too weak" }],
      }),
    );
    renderContent();

    fillPasswords(VALID_PASSWORD);
    submit();

    await screen.findByText(
      catalogText("identity.password_too_weak", ERROR_OBJECT),
    );
    expect(screen.getByLabelText(COPY.passwordLabel)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("shows the general text when the rejection is no API error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    mocks.confirmPasswordReset.mockRejectedValue(new Error("network down"));
    renderContent();

    fillPasswords(VALID_PASSWORD);
    submit();

    expect(
      await screen.findByText(catalogText("general.server", ERROR_OBJECT)),
    ).toBeInTheDocument();
  });

  it("re-enables the submit button after a failed attempt", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    mocks.confirmPasswordReset.mockRejectedValue(
      new ApiError("invalid or expired reset token", 400, {
        code: "identity.password_reset_link_invalid",
      }),
    );
    renderContent();

    fillPasswords(VALID_PASSWORD);
    submit();

    await screen.findByText(
      catalogText("identity.password_reset_link_invalid", ERROR_OBJECT),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: COPY.submit })).toBeEnabled(),
    );
  });
});

// ---------------------------------------------------------------------------
// Password visibility toggle + tenant branding
// ---------------------------------------------------------------------------

describe("ResetPasswordPageContent — UI affordances", () => {
  it("toggles the password field between hidden and visible", () => {
    renderContent();

    const passwordInput = screen.getByLabelText(COPY.passwordLabel);
    expect(passwordInput).toHaveAttribute("type", "password");

    fireEvent.click(
      screen.getAllByRole("button", { name: COPY.showPassword })[0]!,
    );
    expect(passwordInput).toHaveAttribute("type", "text");

    // The confirm field has its own independent toggle (after the first field
    // flipped to visible, only the confirm toggle still reads "show").
    const confirmInput = screen.getByLabelText(COPY.confirmPasswordLabel);
    expect(confirmInput).toHaveAttribute("type", "password");
    fireEvent.click(
      screen.getAllByRole("button", { name: COPY.showPassword })[0]!,
    );
    expect(confirmInput).toHaveAttribute("type", "text");
  });

  it("renders the tenant login image when the tenant has one configured", () => {
    mocks.tenant = {
      tenant: {
        name: "Musterschule",
        settings: { loginImageUrl: "/uploads/logo.png" },
      },
    };
    renderContent();

    const logo = screen.getByAltText("Musterschule Logo");
    expect(logo).toBeInTheDocument();
    expect(logo).toHaveAttribute("src", "/resolved/uploads/logo.png");
  });
});

// ---------------------------------------------------------------------------
// Default copy — exercises DEFAULT_RESET_PASSWORD_PAGE_COPY + default props so
// those literals are covered when a caller omits the copy prop.
// ---------------------------------------------------------------------------

describe("ResetPasswordPageContent — default copy", () => {
  it("renders the German default chrome when no copy prop is supplied", () => {
    render(<ResetPasswordPageContent portal="tenant" />);

    expect(screen.getByText("Neues Passwort festlegen")).toBeInTheDocument();
    expect(screen.getByText("Passwort-Anforderungen:")).toBeInTheDocument();
  });
});
