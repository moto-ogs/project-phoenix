import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import type { TraegerBankAccount } from "~/lib/traeger-api";
import { catalogText } from "~/test/error-catalog-text";

const { mockUpdate } = vi.hoisted(() => ({ mockUpdate: vi.fn() }));
vi.mock("~/lib/traeger-api", () => ({
  updateTraegerBankAccount: mockUpdate,
  deleteTraegerBankAccount: vi.fn(),
  createTraegerBankAccount: vi.fn(),
}));

import { TraegerBankAccountsCard } from "./traeger-bank-accounts-card";

function account(
  id: string,
  label: string,
  version: string,
  isDefault = false,
): TraegerBankAccount {
  return {
    id,
    label,
    version,
    isDefault,
    accountHolder: "Träger e. V.",
    iban: "DE02120300000000202051",
    bic: "BYLADEM1001",
    bankName: "Testbank",
  };
}

const ROWS = [
  account("1", "Hauptkonto", "a-1", true),
  account("2", "Spendenkonto", "b-1"),
  account("3", "Mensakonto", "c-1"),
];

function card(
  accounts: readonly TraegerBankAccount[],
  reload: () => Promise<readonly TraegerBankAccount[]>,
) {
  return (
    <ToastProvider>
      <TraegerBankAccountsCard
        accounts={accounts}
        canEdit
        onChanged={() => Promise.resolve()}
        reload={reload}
      />
    </ToastProvider>
  );
}

function makeDefaultItem(label: string) {
  fireEvent.click(
    screen.getByRole("button", {
      name: `Aktionen für die Bankverbindung ${label}`,
    }),
  );
  return screen.getByRole("menuitem", { name: /Als Standard festlegen/ });
}

// ADR 0311, rule 4 on a row action: a refusal locks „Als Standard
// festlegen“ on every row until the stored accounts are there.
describe("TraegerBankAccountsCard", () => {
  it("keeps a failed read after a refusal on the card and lifts the lock with a later read", async () => {
    mockUpdate.mockRejectedValueOnce(
      new ApiError("changed", 409, { code: "general.changed_since_read" }),
    );
    const reload = vi.fn(() =>
      Promise.reject(
        new ApiError("down", 503, { code: "general.unavailable" }),
      ),
    );
    const { rerender } = render(card(ROWS, reload));

    fireEvent.click(makeDefaultItem("Spendenkonto"));
    expect(
      await screen.findByText(/Der neue Stand konnte nicht geladen werden\./),
    ).toBeInTheDocument();
    expect(mockUpdate).toHaveBeenCalledWith(
      "2",
      expect.objectContaining({ isDefault: true }),
      "b-1",
    );

    // The toast goes; the failed read stays on the card, and no row sends.
    const loadError = catalogText(
      "general.unavailable",
      "die Anzeige der Bankverbindungen",
    );
    expect(await screen.findByText(loadError)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Schließen" }));
    await waitFor(() =>
      expect(
        screen.queryByText(/Der neue Stand konnte nicht geladen werden\./),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText(loadError)).toBeInTheDocument();
    const locked = makeDefaultItem("Mensakonto");
    expect(locked).toBeDisabled();
    expect(locked).toHaveTextContent(
      "Die gespeicherten Angaben konnten nicht geladen werden.",
    );
    fireEvent.click(locked);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });

    // A later read of the accounts (another view's refresh) brings other
    // versions: the rows send again, each with its own version.
    mockUpdate.mockResolvedValueOnce(undefined);
    rerender(
      card([ROWS[0]!, account("2", "Spendenkonto", "b-2"), ROWS[2]!], reload),
    );
    expect(screen.queryByText(loadError)).not.toBeInTheDocument();
    const open = makeDefaultItem("Mensakonto");
    expect(open).toBeEnabled();
    await act(async () => {
      fireEvent.click(open);
    });
    expect(mockUpdate).toHaveBeenLastCalledWith(
      "3",
      expect.objectContaining({ isDefault: true }),
      "c-1",
    );
    expect(
      within(document.body).getByText("„Mensakonto“ ist jetzt der Standard."),
    ).toBeInTheDocument();
  });
});
