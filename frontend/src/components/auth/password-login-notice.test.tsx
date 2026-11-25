import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import identity from "~/i18n/messages/de/errorCatalog/codes/identity.json";
import { PasswordLoginForm } from "./password-login-form";

const loadPresenter = vi.hoisted(() => vi.fn());
vi.mock("~/lib/error-presentation", async (importOriginal) => {
  loadPresenter();
  return importOriginal();
});
vi.mock("~/lib/auth-api", () => ({ requestPasswordReset: vi.fn() }));

describe("login without the error presenter", () => {
  // #7209: the logout ended the session on this device only.
  it("says once that the last logout could not end the sign-in everywhere", async () => {
    sessionStorage.setItem("logoutNotRevoked", "1");
    const { unmount } = render(
      <PasswordLoginForm portal="tenant" onSubmit={() => Promise.resolve()} />,
    );

    expect(screen.getByText(identity.logout_not_revoked)).toHaveTextContent(
      "Dann ändere bitte dein Passwort.",
    );
    await vi.dynamicImportSettled();
    expect(loadPresenter).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("logoutNotRevoked")).toBeNull();
    fireEvent.focusIn(screen.getByLabelText("E-Mail-Adresse"));
    await vi.dynamicImportSettled();
    expect(loadPresenter).toHaveBeenCalledOnce();
    unmount();

    render(
      <PasswordLoginForm portal="tenant" onSubmit={() => Promise.resolve()} />,
    );
    // Anker: das Formular steht, der Hinweis kommt nach einem Neuladen nicht wieder.
    expect(screen.getByLabelText("E-Mail-Adresse")).toBeInTheDocument();
    expect(
      screen.queryByText(/Du bist auf diesem Gerät abgemeldet\./),
    ).not.toBeInTheDocument();
  });
});
