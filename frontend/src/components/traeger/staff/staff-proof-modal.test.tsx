import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import { TEST_CLOCK_TODAY } from "~/test/clock-instant";
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

  // A kind may stay valid for up to 240 months (workforce
  // maxValidityMonths), so the year list reaches 20 years ahead.
  it("offers the expiry year of the longest validity", async () => {
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

    fireEvent.click(document.getElementById("expires_on")!);
    await screen.findByTestId("day-picker");
    fireEvent.click(screen.getByRole("combobox", { name: "Jahr" }));

    const lastYear = String(Number(TEST_CLOCK_TODAY.slice(0, 4)) + 20);
    expect(screen.getByRole("option", { name: lastYear })).toBeInTheDocument();
  });
});
