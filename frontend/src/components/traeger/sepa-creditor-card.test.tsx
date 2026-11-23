import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import { type SepaCreditor, saveSepaCreditor } from "~/lib/traeger-sepa-api";
import { SepaCreditorCard } from "./sepa-creditor-card";

// The Träger host is configuration; the path is what the card decides.
vi.mock("~/lib/traeger-url", () => ({ traegerPath: (path: string) => path }));
vi.mock("~/lib/traeger-sepa-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  saveSepaCreditor: vi.fn(),
}));

const creditor: SepaCreditor = {
  version: "v1",
  creditorId: "DE98ZZZ09999999999",
  prenotificationDays: 14,
  missingMandate: "transfer",
  updatedAt: null,
};

function renderCard(onlineMandate: boolean | null) {
  return render(
    <SepaCreditorCard
      creditor={creditor}
      reload={async () => creditor}
      write={async () => undefined}
      onlineMandate={onlineMandate}
      onChanged={vi.fn()}
    />,
    { wrapper: ToastProvider },
  );
}

// The switch of the mandate in the parents portal (#4696) shows its state
// and leads to the setting; unknown, it shows nothing.
describe("SepaCreditorCard online mandate", () => {
  it("shows the switch on and where to change it", () => {
    renderCard(true);
    expect(screen.getByText("Eingeschaltet")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "In den Einstellungen ändern" }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining("einstellungen?bereich=monatsbeitrag"),
    );
  });

  it("names the paper way while the switch is off", () => {
    renderCard(false);
    expect(screen.getByText("Ausgeschaltet")).toBeInTheDocument();
    expect(
      screen.getByText(/Eltern geben das Mandat auf Papier ab/),
    ).toBeInTheDocument();
  });

  it("shows nothing about it while the state is unknown", () => {
    renderCard(null);
    expect(screen.getByText("DE98ZZZ09999999999")).toBeInTheDocument();
    expect(screen.queryByText("Mandat in der Eltern-App")).toBeNull();
  });
});

// ADR 0311, rule 6: after a refusal whose read of the stored creditor
// failed, Speichern sends nothing and leaves the failed read with its retry
// on screen; the retry reads again and the save works after it.
describe("SepaCreditorCard after a refusal", () => {
  it("keeps the failed read and its retry when Speichern is clicked again", async () => {
    const reload = vi
      .fn<() => Promise<SepaCreditor>>()
      .mockRejectedValueOnce(new ApiError("down", 503))
      .mockResolvedValue({ ...creditor, version: "v2" });
    const save = vi.mocked(saveSepaCreditor);
    save.mockRejectedValueOnce(
      new ApiError("changed", 409, { code: "general.changed_since_read" }),
    );
    save.mockResolvedValue({ ...creditor, version: "v3" });
    // The page's read: a successful reload is the creditor it shows.
    function Page() {
      const [shown, setShown] = useState(creditor);
      return (
        <SepaCreditorCard
          creditor={shown}
          reload={async () => {
            const read = await reload();
            setShown(read);
            return read;
          }}
          write={async () => undefined}
          onChanged={vi.fn()}
        />
      );
    }
    render(<Page />, { wrapper: ToastProvider });
    fireEvent.click(screen.getByRole("button", { name: "Ändern" }));
    fireEvent.click(await screen.findByRole("button", { name: "Speichern" }));
    expect(
      await screen.findByText(/Der neue Stand konnte nicht geladen werden/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wiederholen" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    // The click runs its handler at once; a cleared alert would be gone now.
    await act(async () => undefined);
    expect(
      screen.getByText(/Der neue Stand konnte nicht geladen werden/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wiederholen" })).toBeVisible();
    expect(save).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    await waitFor(() =>
      expect(
        screen.queryByText(/Der neue Stand konnte nicht geladen werden/),
      ).toBeNull(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenLastCalledWith(expect.anything(), "v2");
  });
});
