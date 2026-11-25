import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import deMessages from "~/i18n/messages/de.generated";
import { ApiError } from "~/lib/api-error";
import { catalogText } from "~/test/error-catalog-text";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  token: "valid-token" as string | null,
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
  useTenantSafe: () => null,
}));

vi.mock("~/lib/tenant-api", () => ({
  loginImageSrc: (path: string) => `/resolved${path}`,
}));

const confirmPasswordReset = vi.fn();
vi.mock("~/lib/auth-api", () => ({
  confirmPasswordReset: (...args: unknown[]) => confirmPasswordReset(...args),
}));

vi.mock("next-intl/server", async () => {
  const { createTranslator } =
    await vi.importActual<typeof import("next-intl")>("next-intl");
  const { default: messages } = await import("~/i18n/messages/de.generated");
  return {
    getTranslations: async (namespace: keyof typeof messages) =>
      createTranslator({ locale: "de", messages, namespace }),
  };
});

import ParentResetPasswordPage from "./page";

describe("ParentResetPasswordPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.token = "valid-token";
  });

  it("renders the reset form wired with localized parent copy", async () => {
    render(await ParentResetPasswordPage());

    // The German default catalog (mocked globally) drives next-intl, so the
    // localized parent form chrome is what renders.
    expect(screen.getByText("Neues Passwort festlegen")).toBeInTheDocument();
    expect(screen.getByText("Passwort-Anforderungen:")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Passwort ändern" }),
    ).toBeEnabled();
  });

  it("offers a new link when the URL has no token", async () => {
    mocks.token = null;
    render(await ParentResetPasswordPage());

    expect(
      screen.getByRole("link", { name: "Neuen Link anfordern" }),
    ).toHaveAttribute("href", "/parents/login?passwort-vergessen=1");
  });

  it("shows a failed reset with the translated object of the shared path", async () => {
    confirmPasswordReset.mockRejectedValue(
      new ApiError("diag", 503, { code: "general.unavailable" }),
    );
    render(await ParentResetPasswordPage());

    fireEvent.change(screen.getByLabelText("Neues Passwort"), {
      target: { value: "Sicher!123" },
    });
    fireEvent.change(screen.getByLabelText("Passwort bestätigen"), {
      target: { value: "Sicher!123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Passwort ändern" }));

    expect(
      await screen.findByText(
        catalogText(
          "general.unavailable",
          deMessages.parentPasswordResetPage.errorObject,
        ),
      ),
    ).toBeInTheDocument();
  });

  // Off its own host (as here), the portal's login is the prefixed page.
  it("links back to the parents login", async () => {
    render(await ParentResetPasswordPage());

    const backLink = screen.getByRole("link", { name: /Anmeldung/i });
    expect(backLink).toHaveAttribute("href", "/parents/login");
  });
});
