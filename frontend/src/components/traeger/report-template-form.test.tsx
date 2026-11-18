import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import type { ReportTemplate } from "~/lib/traeger-reports-api";
import { blankTemplateInput, ReportTemplateForm } from "./report-template-form";

const SCHOOLS = [
  {
    id: "2",
    name: "OGS Am Bach",
    slug: "bach",
    subdomain: "bach",
    city: "Bissendorf",
  },
  {
    id: "3",
    name: "OGS Lindenweg",
    slug: "linde",
    subdomain: "linde",
    city: "",
  },
];

const SAVED: ReportTemplate = {
  id: "12",
  name: "Jugendamt",
  sections: ["children", "staff", "absences", "demand"],
  keyDateMonth: 10,
  keyDateDay: 15,
  districts: [],
  updatedAt: null,
};

function renderForm(onSave = vi.fn().mockResolvedValue(SAVED)) {
  const onSaved = vi.fn();
  render(
    <ToastProvider>
      <ReportTemplateForm
        initial={blankTemplateInput()}
        schools={SCHOOLS}
        takenNames={["Kommune"]}
        saveLabel="Vorlage anlegen"
        onSave={onSave}
        onSaved={onSaved}
        onCancel={vi.fn()}
      />
    </ToastProvider>,
  );
  return { onSave, onSaved };
}

describe("ReportTemplateForm", () => {
  it("refuses a taken name and a template without a section", async () => {
    const { onSave } = renderForm();
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "kommune" },
    });
    for (const label of [
      "Kinder je Standort und Betreuungsform",
      "Personal",
      "Fehlzeiten",
      "Belegung und Nachfrage",
    ]) {
      fireEvent.click(
        screen.getByRole("checkbox", { name: new RegExp(label) }),
      );
    }
    fireEvent.click(screen.getByRole("button", { name: "Vorlage anlegen" }));

    expect(
      await screen.findByText("Eine Vorlage mit diesem Namen gibt es schon."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Bitte wähle mindestens einen Abschnitt."),
    ).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves name, sections, the 15 October and the district of a school", async () => {
    const { onSave, onSaved } = renderForm();
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "Jugendamt" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /Fehlzeiten/ }));
    fireEvent.change(screen.getByLabelText("Sozialraum von OGS Am Bach"), {
      target: { value: "Nord" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Vorlage anlegen" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(SAVED));
    expect(onSave).toHaveBeenCalledWith({
      name: "Jugendamt",
      sections: ["children", "staff", "demand"],
      keyDateMonth: 10,
      keyDateDay: 15,
      districts: [{ schoolId: "2", district: "Nord" }],
    });
    expect(
      screen.getByText(/1 von 2 Schulen haben einen Sozialraum/),
    ).toBeInTheDocument();
  });
});
