import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { ApiError } from "~/lib/api-error";
import { PasswordLoginForm } from "./password-login-form";

vi.mock("~/lib/auth-api", () => ({ requestPasswordReset: vi.fn() }));

const refused = (status: number, code?: ApiError["code"]) =>
  new ApiError("diagnostic text", status, code ? { code } : undefined);

async function signIn(onSubmit: () => Promise<void>, portal = "school") {
  render(
    <PasswordLoginForm
      portal={portal as "school" | "operator"}
      onSubmit={onSubmit}
    />,
  );
  fireEvent.change(screen.getByLabelText("E-Mail-Adresse"), {
    target: { value: "person@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Passwort"), {
    target: { value: "secret" },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Anmelden" }));
  });
}

describe("PasswordLoginForm", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/login");
  });

  // #7209: the logout ended the session on this device only.
  it("says once that the last logout could not end the sign-in everywhere", async () => {
    sessionStorage.setItem("logoutNotRevoked", "1");
    const { unmount } = render(
      <PasswordLoginForm portal="tenant" onSubmit={() => Promise.resolve()} />,
    );

    expect(
      await screen.findByText(/Sie sind auf diesem Gerät abgemeldet\./),
    ).toHaveTextContent("Dann ändern Sie bitte Ihr Passwort.");
    expect(sessionStorage.getItem("logoutNotRevoked")).toBeNull();
    unmount();

    render(
      <PasswordLoginForm portal="tenant" onSubmit={() => Promise.resolve()} />,
    );
    // Anker: das Formular steht, der Hinweis kommt nach einem Neuladen nicht wieder.
    expect(screen.getByLabelText("E-Mail-Adresse")).toBeInTheDocument();
    expect(
      screen.queryByText(/Sie sind auf diesem Gerät abgemeldet\./),
    ).not.toBeInTheDocument();
  });

  it("opens the reset with the typed address, also from a wrong password", async () => {
    await signIn(() =>
      Promise.reject(refused(401, "identity.invalid_credentials")),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Die E-Mail-Adresse oder das Passwort stimmt nicht.",
    );
    fireEvent.click(
      within(alert).getByRole("button", { name: "Passwort zurücksetzen" }),
    );

    expect(
      within(screen.getByRole("dialog")).getByLabelText("E-Mail-Adresse"),
    ).toHaveValue("person@example.com");
  });

  it("offers no reset for a switched-off account", async () => {
    await signIn(() =>
      Promise.reject(refused(401, "identity.session_account_inactive")),
    );

    // Anker: die Ablehnung steht im Fehlerkasten.
    const alert = await screen.findByRole("alert");
    expect(
      within(alert).queryByRole("button", { name: "Passwort zurücksetzen" }),
    ).not.toBeInTheDocument();
  });

  it("names the limiter's 429 as too many attempts", async () => {
    await signIn(() => Promise.reject(refused(429, "general.unavailable")));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Zu viele Anmeldeversuche. Bitte versuchen Sie es später erneut.",
    );
  });

  it("names the empty fields without sending", async () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    render(<PasswordLoginForm portal="tenant" onSubmit={onSubmit} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Anmelden" }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Bitte geben Sie E-Mail-Adresse und Passwort ein.",
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("offers the operator portal, which has no reset, no forgotten password", () => {
    render(
      <PasswordLoginForm
        portal="operator"
        onSubmit={() => Promise.resolve()}
      />,
    );

    // Anker: das Formular steht.
    expect(
      screen.getByRole("button", { name: "Anmelden" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Passwort vergessen?" }),
    ).not.toBeInTheDocument();
  });

  it("lets a newer empty-field message replace the page's refusal", async () => {
    render(
      <PasswordLoginForm
        portal="school"
        onSubmit={() => Promise.resolve()}
        refusal={<p>REFUSAL_OF_THE_LAST_ATTEMPT</p>}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Anmelden" }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Bitte geben Sie E-Mail-Adresse und Passwort ein.",
    );
    expect(
      screen.queryByText("REFUSAL_OF_THE_LAST_ATTEMPT"),
    ).not.toBeInTheDocument();
  });
});
