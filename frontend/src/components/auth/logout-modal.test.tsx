/**
 * LogoutModal: the kit confirmation dialog in front of a portal's logout.
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { LogoutModal } from "./logout-modal";

const mockLogout = vi.fn();

vi.mock("~/lib/shell-auth-context", () => ({
  useShellAuth: () => ({ logout: mockLogout }),
}));

function openModal(onClose = vi.fn()) {
  render(<LogoutModal isOpen={true} onClose={onClose} />);
  return { dialog: screen.getByRole("dialog"), onClose };
}

describe("LogoutModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLogout.mockResolvedValue(undefined);
  });

  it("shows the dialog only while open", () => {
    const { rerender } = render(
      <LogoutModal isOpen={false} onClose={vi.fn()} />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // Gegenprobe: dieselbe Instanz zeigt den Dialog, sobald sie offen ist.
    rerender(<LogoutModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Abmelden");
  });

  // #7112: the dialog was nameless and carried its own <h1>.
  it("is a dialog named by its title, with the question as content", () => {
    const { dialog } = openModal();

    expect(dialog).toHaveAccessibleName("Abmelden");
    expect(
      within(dialog).getByRole("heading", { name: "Abmelden" }),
    ).not.toHaveProperty("tagName", "H1");
    expect(
      within(dialog).getByText(
        "Möchten Sie sich wirklich von Ihrem Konto abmelden?",
      ),
    ).toBeVisible();
  });

  it("closes without logging out on Abbrechen", () => {
    const { dialog, onClose } = openModal();

    fireEvent.click(within(dialog).getByRole("button", { name: "Abbrechen" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it("logs out on Abmelden", async () => {
    const { dialog } = openModal();

    fireEvent.click(within(dialog).getByRole("button", { name: "Abmelden" }));

    await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
  });

  it("shows the running logout and cannot be closed meanwhile", async () => {
    mockLogout.mockReturnValue(new Promise(() => undefined));
    const { dialog, onClose } = openModal();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Abmelden" }));
    });

    expect(
      within(dialog).getByRole("button", { name: /Abmeldung läuft/ }),
    ).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes and forgets the deliberate logout when the logout fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    sessionStorage.setItem("deliberateLogout", "1");
    mockLogout.mockRejectedValue(new Error("Sign out failed"));
    const { dialog, onClose } = openModal();

    fireEvent.click(within(dialog).getByRole("button", { name: "Abmelden" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem("deliberateLogout")).toBeNull();
    expect(console.error).toHaveBeenCalledWith(
      "failed to sign out",
      expect.objectContaining({ error: "Sign out failed" }),
    );
  });
});
