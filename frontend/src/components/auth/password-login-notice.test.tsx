import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import identity from "~/i18n/messages/de/errorCatalog/codes/identity.json";
import { ApiError } from "~/lib/api-error";
import { deferred } from "~/test/helpers/form-modal-pending";
import { PasswordLoginForm } from "./password-login-form";

const loadPresenter = vi.hoisted(() => vi.fn<() => Promise<void>>());
vi.mock("~/lib/error-presentation", async (importOriginal) => {
  await loadPresenter();
  return importOriginal();
});
vi.mock("~/lib/auth-api", () => ({ requestPasswordReset: vi.fn() }));

describe("login without the error presenter", () => {
  // #7209: the logout ended the session on this device only.
  it("shows the logout notice once without the presenter and keeps a refused submit pending until its message arrives", async () => {
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
    unmount();

    const onSubmit = vi.fn(async () => {
      throw new ApiError("refused", 401, {
        code: "identity.invalid_credentials",
      });
    });
    render(<PasswordLoginForm portal="tenant" onSubmit={onSubmit} />);
    // Anker: das Formular steht, der Hinweis kommt nach einem Neuladen nicht wieder.
    expect(screen.getByLabelText("E-Mail-Adresse")).toBeInTheDocument();
    expect(
      screen.queryByText(/Du bist auf diesem Gerät abgemeldet\./),
    ).not.toBeInTheDocument();

    // The refusal can arrive before the presenter's first network response.
    const chunk = deferred();
    loadPresenter.mockReturnValue(chunk.promise);
    const email = screen.getByLabelText("E-Mail-Adresse");
    fireEvent.focusIn(email);
    await vi.waitFor(() => expect(loadPresenter).toHaveBeenCalledOnce());
    fireEvent.change(email, { target: { value: "person@example.org" } });
    fireEvent.change(screen.getByLabelText("Passwort"), {
      target: { value: "wrong" },
    });
    const submit = screen.getByRole("button", { name: "Anmelden" });
    await act(async () => {
      fireEvent.click(submit);
    });
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(submit).toBeDisabled();

    chunk.resolve();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      identity.invalid_credentials,
    );
    expect(submit).toBeEnabled();
  });
});
