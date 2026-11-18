import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import type { StaffProof } from "~/lib/traeger-staff-proofs-api";

import { StaffProofModal } from "./staff-proof-modal";

vi.mock("react-day-picker", () => ({
  DayPicker: () => <div data-testid="day-picker" />,
}));

const POLICE_CERTIFICATE: StaffProof = {
  typeId: "1",
  typeName: "Erweitertes Führungszeugnis",
  mandatory: true,
  policeCertificate: true,
  held: false,
  status: "",
  presentedOn: "",
  issuedOn: "",
  noRelevantEntry: false,
  expiresOn: "",
};

describe("StaffProofModal dates (#7380)", () => {
  // "Gültig bis" lies years ahead, "Ausgestellt am" years back: month arrows
  // alone need dozens of clicks.
  it.each(["presented_on", "issued_on", "expires_on"])(
    "offers month and year selection in %s",
    async (id) => {
      render(
        <ToastProvider>
          <StaffProofModal
            target={{
              recordId: "7",
              personName: "Mia Berg",
              proof: POLICE_CERTIFICATE,
            }}
            onClose={vi.fn()}
            onSaved={vi.fn()}
          />
        </ToastProvider>,
      );

      const trigger = document.getElementById(id);
      expect(trigger).not.toBeNull();
      fireEvent.click(trigger!);
      await screen.findByTestId("day-picker");

      expect(
        screen.getByRole("combobox", { name: "Jahr" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("combobox", { name: "Monat" }),
      ).toBeInTheDocument();
    },
  );
});
