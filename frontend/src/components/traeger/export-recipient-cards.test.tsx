import { fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import type { ExportRecipient } from "~/lib/traeger-export-handovers-api";
import {
  ExportHandoverHistoryCard,
  ExportRecipientFormCard,
} from "./export-recipient-cards";

const RECIPIENT: ExportRecipient = {
  version: "v-1",
  id: "7",
  name: "Kämmerei",
  enabled: true,
  ready: true,
  host: "dateien.kaemmerei-beispiel.de",
  port: 22,
  username: "moto",
  remoteDirectory: "/eingang",
  hostKeyFingerprint: "SHA256:AbCdEfGhIjKlMnOpQrStUvWxYz0123456789+/AbCdE",
  passwordSet: true,
  missingFields: [],
  formats: [],
  lastHandover: null,
  updatedAt: "2026-11-12T08:00:00Z",
};

function form(recipient: ExportRecipient) {
  return (
    <StrictMode>
      <ToastProvider>
        <ExportRecipientFormCard recipient={recipient} onSave={vi.fn()} />
      </ToastProvider>
    </StrictMode>
  );
}

it("updates an untouched recipient draft in Strict Mode", () => {
  // A stored change moves the version (ADR 0311).
  const updated = { ...RECIPIENT, remoteDirectory: "/archiv", version: "v-2" };
  const view = render(form(RECIPIENT));

  expect(screen.getByLabelText("Zielordner")).toHaveValue("/eingang");
  view.rerender(form(updated));

  expect(screen.getByLabelText("Zielordner")).toHaveValue("/archiv");
});

// The table brings its own frame; a flush card put it straight onto the card
// frame (#7303). The card keeps its inset around the table.
it("keeps the card inset around the handover table", () => {
  render(
    <ToastProvider>
      <ExportHandoverHistoryCard handovers={[]} />
    </ToastProvider>,
  );

  expect(
    screen
      .getByRole("heading", { name: "Letzte Übergaben" })
      .closest("section"),
  ).toHaveClass("p-5");
});

// ADR 0311, rules 4 and 6: after a refusal whose read failed, saving waits
// for a read and says why, without claiming the read still runs.
it("names the failed read as the reason saving waits", async () => {
  const onSave = vi
    .fn()
    .mockRejectedValue(
      new ApiError("changed", 409, { code: "general.changed_since_read" }),
    );
  const reload = vi.fn().mockRejectedValue(new ApiError("unavailable", 503));
  render(
    <ToastProvider>
      <ExportRecipientFormCard
        recipient={RECIPIENT}
        reload={reload}
        onSave={onSave}
      />
    </ToastProvider>,
  );

  fireEvent.change(screen.getByLabelText("Zielordner"), {
    target: { value: "/archiv" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

  expect(
    await screen.findByText(/Der neue Stand konnte nicht geladen werden\./),
  ).toBeInTheDocument();
  const save = screen.getByRole("button", { name: "Speichern" });
  expect(save).toHaveAttribute("aria-disabled", "true");
  fireEvent.focus(save);
  expect(
    await screen.findByText(
      "Die gespeicherten Angaben konnten nicht geladen werden. Tippe in der Fehlermeldung auf „Wiederholen“.",
    ),
  ).toBeInTheDocument();
  expect(onSave).toHaveBeenCalledTimes(1);
});
