import { render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import type { ExportRecipient } from "~/lib/traeger-export-handovers-api";
import {
  ExportHandoverHistoryCard,
  ExportRecipientFormCard,
} from "./export-recipient-cards";

const RECIPIENT: ExportRecipient = {
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
  const updated = { ...RECIPIENT, remoteDirectory: "/archiv" };
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

  const card = screen
    .getByRole("heading", { name: "Letzte Übergaben" })
    .closest("section");
  expect(card?.className).toMatch(/(?:^|\s)p-5(?:\s|$)/);
});
