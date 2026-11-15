import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ToastProvider } from "~/contexts/ToastContext";
import type { TraegerPhase } from "~/lib/traeger-catalog-api";
import { CatalogPhaseForm } from "./catalog-phase-form";

const phase: TraegerPhase = {
  id: "7",
  draft: {
    name: "Schuljahr 2027/28",
    kind: "school_year",
    serviceStartDate: "2027-08-01",
    serviceEndDate: "2028-07-31",
    // The registration closes before it opens.
    enrollmentOpenAt: "2027-03-01T08:00:00+01:00",
    enrollmentCloseAt: "2027-02-01T23:59:00+01:00",
    audience: "open",
    careOverflowMode: "waitlist",
    careOfferingSelectionMode: "optional",
  },
  allSchools: true,
  releasedVersion: null,
  released: null,
  withdrawnAt: null,
  schools: [],
  updatedAt: "2026-11-11T10:00:00Z",
};

// #7111: the error under „Anmeldung bis“ was not linked to the field, and
// DateTimePicker had no prop to link it.
describe("CatalogPhaseForm", () => {
  it("links and focuses the error of „Anmeldung bis“", async () => {
    const onSave = vi.fn();
    render(
      <CatalogPhaseForm
        phase={phase}
        schools={[]}
        saveLabel="Speichern"
        onSave={onSave}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />,
      { wrapper: ToastProvider },
    );

    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    const close = screen.getByRole("button", { name: /^Anmeldung bis/ });
    await waitFor(() => expect(close).toHaveFocus());
    expect(close).toHaveAccessibleDescription(
      expect.stringContaining("Das Ende liegt vor dem Beginn."),
    );
    expect(
      screen.getByRole("textbox", { name: "Anmeldung bis, Uhrzeit" }),
    ).toHaveAccessibleDescription(
      expect.stringContaining("Das Ende liegt vor dem Beginn."),
    );
    expect(onSave).not.toHaveBeenCalled();
  });
});
