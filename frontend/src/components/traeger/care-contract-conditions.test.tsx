import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import { catalogText } from "~/test/error-catalog-text";
import type { OfferingTemplate } from "~/lib/traeger-care-contracts-api";
import { usePhoneViewport } from "~/test/helpers/viewport";

const { api } = vi.hoisted(() => ({
  api: { saveContractTemplate: vi.fn() },
}));

vi.mock("~/lib/traeger-care-contracts-api", () => api);

import { CareContractConditions } from "./care-contract-conditions";

const OPEN: OfferingTemplate = {
  schoolId: "3",
  schoolName: "OGS Am Lindenhof",
  offeringId: "5",
  offeringName: "Offene Ganztagsschule",
  phaseName: "2027/28",
  priceCents: 9500,
  active: true,
  template: null,
  termText: "",
  noticeText: "",
  version: "absent",
};

/** The page's read of the offerings; rejects only where a case says so. */
const reload = vi.fn();

describe("CareContractConditions", () => {
  beforeEach(() => {
    api.saveContractTemplate.mockReset();
    reload.mockReset().mockResolvedValue([OPEN]);
  });

  it("shows the saved enrollment text read-only, separate from unsaved conditions", () => {
    render(
      <ToastProvider>
        <CareContractConditions
          offerings={[
            {
              ...OPEN,
              acceptanceText: "Vollständige gespeicherte Bedingungen",
              template: {
                id: "7",
                updatedAt: "2026-09-09T10:00:00Z",
                termKind: "school_year",
                termMonths: null,
                noticeMonths: 1,
                noticeTo: "month_end",
                contractPartner: "Träger",
                specialTermination: false,
                specialTerminationNote: "",
                statuteRequired: false,
                statuteTitle: "",
                statuteUrl: "",
              },
            },
          ]}
          selectedKey={null}
          onSelect={vi.fn()}
          reload={reload}
          onSaved={vi.fn()}
        />
      </ToastProvider>,
    );
    const text = screen.getByRole("textbox", {
      name: "Gespeicherter Text für das Anmeldeformular",
    });
    expect(text).toHaveAttribute("readonly");
    expect(text).toHaveValue("Vollständige gespeicherte Bedingungen");
    fireEvent.change(screen.getByLabelText("Vertragspartner"), {
      target: { value: "Anderer Träger" },
    });
    expect(text).toHaveValue("Vollständige gespeicherte Bedingungen");
  });

  it("selects a fixed term through the shared width-constrained selector", async () => {
    const onSaved = vi.fn();
    api.saveContractTemplate.mockResolvedValue(OPEN);
    render(
      <ToastProvider>
        <CareContractConditions
          offerings={[OPEN]}
          selectedKey={null}
          onSelect={vi.fn()}
          reload={reload}
          onSaved={onSaved}
        />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("combobox", { name: "Laufzeit" }));
    fireEvent.click(screen.getByRole("option", { name: "Feste Monate" }));
    fireEvent.change(screen.getByLabelText("Anzahl der Monate"), {
      target: { value: "6" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Bedingungen speichern" }),
    );
    await waitFor(() =>
      expect(api.saveContractTemplate).toHaveBeenCalledWith(
        "3",
        "5",
        expect.objectContaining({ termKind: "fixed_months", termMonths: 6 }),
        "absent",
      ),
    );
  });

  it("opens the first offering without conditions and saves them", async () => {
    const onSaved = vi.fn();
    api.saveContractTemplate.mockImplementation(
      (_school: string, _offering: string, terms: object) =>
        Promise.resolve({
          ...OPEN,
          template: { ...terms, id: "1", updatedAt: "" },
        }),
    );
    render(
      <ToastProvider>
        <CareContractConditions
          offerings={[OPEN]}
          selectedKey={null}
          onSelect={vi.fn()}
          reload={reload}
          onSaved={onSaved}
        />
      </ToastProvider>,
    );

    expect(screen.getByText("Fehlt")).toBeInTheDocument();
    fireEvent.click(
      screen.getByText(
        "Eltern dürfen in besonderen Fällen zum Halbjahr kündigen",
      ),
    );
    // The form names the only date moto offers (#6349): the free text
    // describes the cases and never moves the date.
    expect(
      screen.getByText(
        "Der Vertrag endet dann zum 31. Januar oder 31. Juli. Es gilt dieselbe Frist in Monaten. Ein anderes Datum in diesem Text ändert den Termin nicht.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/In welchen Fällen/)).toHaveAttribute(
      "placeholder",
      "Zum Beispiel bei Umzug oder Schulwechsel.",
    );
    fireEvent.change(screen.getByLabelText(/In welchen Fällen/), {
      target: { value: "Bei Umzug" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Bedingungen speichern" }),
    );

    await waitFor(() =>
      expect(api.saveContractTemplate).toHaveBeenCalledWith(
        "3",
        "5",
        expect.objectContaining({
          termKind: "school_year",
          noticeMonths: 1,
          specialTermination: true,
          specialTerminationNote: "Bei Umzug",
        }),
        "absent",
      ),
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it("opens the offering of the address and writes a new choice there", () => {
    const onSelect = vi.fn();
    const other: OfferingTemplate = {
      ...OPEN,
      offeringId: "6",
      offeringName: "Frühbetreuung",
    };
    render(
      <ToastProvider>
        <CareContractConditions
          offerings={[OPEN, other]}
          selectedKey="3-6"
          onSelect={onSelect}
          reload={reload}
          onSaved={vi.fn()}
        />
      </ToastProvider>,
    );
    // The chosen row is marked, and its conditions stand beside the list.
    expect(
      screen.getByRole("button", { name: /Frühbetreuung/ }),
    ).toHaveAttribute("aria-current", "true");
    expect(
      screen.getByRole("button", { name: "Bedingungen speichern" }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /Offene Ganztagsschule/ }),
    );
    expect(onSelect).toHaveBeenCalledWith("3-5");
  });

  it("asks before a choice drops unsaved conditions", async () => {
    const onSelect = vi.fn();
    const other: OfferingTemplate = {
      ...OPEN,
      offeringId: "6",
      offeringName: "Frühbetreuung",
    };
    render(
      <ToastProvider>
        <CareContractConditions
          offerings={[OPEN, other]}
          selectedKey="3-5"
          onSelect={onSelect}
          reload={reload}
          onSaved={vi.fn()}
        />
      </ToastProvider>,
    );
    fireEvent.change(screen.getByLabelText("Vertragspartner"), {
      target: { value: "Anderer Träger" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Frühbetreuung/ }));
    expect(onSelect).not.toHaveBeenCalled();
    // The form's own „Änderungen verwerfen“ resets; the dialog's confirms.
    const dialog = await screen.findByRole("dialog", {
      name: "Änderungen verwerfen?",
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Änderungen verwerfen" }),
    );
    expect(onSelect).toHaveBeenCalledWith("3-6");
  });

  it("writes the first offering without conditions into the address once", () => {
    const onSelect = vi.fn();
    const done: OfferingTemplate = {
      ...OPEN,
      offeringId: "4",
      offeringName: "Frühbetreuung",
      template: {
        id: "7",
        updatedAt: "2026-09-09T10:00:00Z",
        termKind: "school_year",
        termMonths: null,
        noticeMonths: 1,
        noticeTo: "month_end",
        contractPartner: "",
        specialTermination: false,
        specialTerminationNote: "",
        statuteRequired: false,
        statuteTitle: "",
        statuteUrl: "",
      },
    };
    render(
      <ToastProvider>
        <CareContractConditions
          offerings={[done, OPEN]}
          selectedKey={null}
          onSelect={onSelect}
          reload={reload}
          onSaved={vi.fn()}
        />
      </ToastProvider>,
    );
    // From then on the address holds the choice: saving it, which changes
    // which offering lacks conditions, cannot move the form elsewhere.
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("3-5");
  });

  // ADR 0311: conditions a colleague saved since are not overwritten; the
  // form shows them with the refusal and saves over their version.
  it("shows the conditions a colleague saved since instead of overwriting them", async () => {
    const terms = {
      termKind: "school_year" as const,
      termMonths: null,
      noticeMonths: 1,
      noticeTo: "month_end" as const,
      contractPartner: "Träger",
      specialTermination: false,
      specialTerminationNote: "",
      statuteRequired: false,
      statuteTitle: "",
      statuteUrl: "",
    };
    const read: OfferingTemplate = {
      ...OPEN,
      version: "v-1",
      template: { ...terms, id: "7", updatedAt: "2026-09-09T10:00:00Z" },
    };
    const stored: OfferingTemplate = {
      ...read,
      version: "v-2",
      template: { ...read.template!, contractPartner: "Kollegin" },
    };
    reload.mockResolvedValue([stored]);
    api.saveContractTemplate.mockRejectedValueOnce(
      new ApiError("changed", 409, { code: "general.changed_since_read" }),
    );
    const page = (offering: OfferingTemplate) => (
      <ToastProvider>
        <CareContractConditions
          offerings={[offering]}
          selectedKey={null}
          onSelect={vi.fn()}
          reload={reload}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );
    const view = render(page(read));
    fireEvent.change(screen.getByLabelText("Vertragspartner"), {
      target: { value: "Ich" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Bedingungen speichern" }),
    );

    expect(
      await screen.findByText(
        catalogText(
          "general.changed_since_read",
          "die Änderung der Vertragsbedingungen",
        ),
      ),
    ).toBeInTheDocument();
    expect(api.saveContractTemplate).toHaveBeenCalledWith(
      "3",
      "5",
      expect.objectContaining({ contractPartner: "Ich" }),
      "v-1",
    );
    expect(reload).toHaveBeenCalledTimes(1);
    // The page's reload brings the stored conditions as props.
    view.rerender(page(stored));
    expect(await screen.findByLabelText("Vertragspartner")).toHaveValue(
      "Kollegin",
    );

    api.saveContractTemplate.mockResolvedValueOnce(stored);
    fireEvent.change(screen.getByLabelText("Vertragspartner"), {
      target: { value: "Kollegin und Ich" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Bedingungen speichern" }),
    );
    await waitFor(() =>
      expect(api.saveContractTemplate).toHaveBeenLastCalledWith(
        "3",
        "5",
        expect.objectContaining({ contractPartner: "Kollegin und Ich" }),
        "v-2",
      ),
    );
  });

  describe("on a phone", () => {
    usePhoneViewport();

    it("chooses no offering itself, so no drawer opens unasked", () => {
      const onSelect = vi.fn();
      render(
        <ToastProvider>
          <CareContractConditions
            offerings={[OPEN]}
            selectedKey={null}
            onSelect={onSelect}
            reload={reload}
            onSaved={vi.fn()}
          />
        </ToastProvider>,
      );
      expect(onSelect).not.toHaveBeenCalled();
    });
  });
});
