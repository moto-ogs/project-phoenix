import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import type { TraegerPhaseDetail } from "~/lib/traeger-catalog-api";
import { catalogText } from "~/test/error-catalog-text";
import { CatalogPhaseForm } from "./catalog-phase-form";

const phase: TraegerPhaseDetail = {
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
  version: "phase-read",
  offerings: [],
};

const source = (
  data: TraegerPhaseDetail,
  reload: () => Promise<TraegerPhaseDetail | undefined> = vi.fn(),
) => ({
  opening: data.id,
  data,
  reload,
});

// #7111: the error under „Anmeldung bis“ was not linked to the field, and
// DateTimePicker had no prop to link it.
describe("CatalogPhaseForm", () => {
  it("links and focuses the error of „Anmeldung bis“", async () => {
    const onSave = vi.fn();
    render(
      <CatalogPhaseForm
        source={source(phase)}
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

// ADR 0311: an edit sends the version it read; a refusal shows the stored
// phase once it is read again and does not save the old draft once more.
describe("CatalogPhaseForm über den gelesenen Stand", () => {
  const valid: TraegerPhaseDetail = {
    ...phase,
    draft: { ...phase.draft, enrollmentOpenAt: null, enrollmentCloseAt: null },
  };

  it("sends the version it read", async () => {
    const onSave = vi.fn().mockResolvedValue({ ...valid, version: "saved" });
    const onSaved = vi.fn();
    render(
      <CatalogPhaseForm
        source={source(valid)}
        schools={[]}
        saveLabel="Speichern"
        onSave={onSave}
        onSaved={onSaved}
        onCancel={vi.fn()}
      />,
      { wrapper: ToastProvider },
    );

    fireEvent.change(screen.getByRole("textbox", { name: /^Name/ }), {
      target: { value: "Schuljahr neu" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Schuljahr neu" }),
      "phase-read",
    );
  });

  it("shows the stored phase after a refusal and saves it only once", async () => {
    const stored = { ...valid, version: "colleague" };
    stored.draft = { ...valid.draft, name: "Von der Kollegin" };
    const reload = vi.fn();
    const onSave = vi
      .fn()
      .mockRejectedValue(
        new ApiError("changed", 409, { code: "general.changed_since_read" }),
      );
    // The page's read: a reload brings the stored phase into its data.
    function Page() {
      const [data, setData] = useState(valid);
      return (
        <CatalogPhaseForm
          source={source(data, async () => {
            reload();
            setData(stored);
            return stored;
          })}
          schools={[]}
          saveLabel="Speichern"
          onSave={onSave}
          onSaved={vi.fn()}
          onCancel={vi.fn()}
        />
      );
    }
    render(<Page />, { wrapper: ToastProvider });

    fireEvent.change(screen.getByRole("textbox", { name: /^Name/ }), {
      target: { value: "Mein Name" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(
      await screen.findByText(
        catalogText("general.changed_since_read", "die Anmeldephase"),
      ),
    ).toBeInTheDocument();
    expect(reload).toHaveBeenCalled();
    expect(
      await screen.findByDisplayValue("Von der Kollegin"),
    ).toBeInTheDocument();
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
