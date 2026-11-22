import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { parseISODate, toISODate } from "~/lib/date-helpers";
import type { FamilyImportMapping } from "~/lib/traeger-family-children-import-api";

vi.mock("~/components/ui/date-picker", () => ({
  DatePicker: ({
    id,
    value,
    hint,
    onChange,
  }: {
    id: string;
    value?: Date;
    hint?: string;
    onChange: (value: Date | null) => void;
  }) => (
    <>
      <input
        id={id}
        type="date"
        value={value ? toISODate(value) : ""}
        onChange={(event) => onChange(parseISODate(event.target.value))}
      />
      <p>{hint}</p>
    </>
  ),
}));

import { FamilyChildrenImportValidFromCard } from "./family-children-import-valid-from-card";

const mapping: FamilyImportMapping = {
  columns: {
    child_first_name: "Vorname",
    child_last_name: "Nachname",
    child_birth_date: "",
    school: "Schule",
    children: "Kinder",
    valid_from: "",
  },
  schoolId: "",
  validFrom: "2026-11-02",
};

function renderCard(shown: FamilyImportMapping = mapping) {
  const onChange = vi.fn();
  render(
    <FamilyChildrenImportValidFromCard
      mapping={shown}
      disabled={false}
      onChange={onChange}
    />,
  );
  return onChange;
}

describe("FamilyChildrenImportValidFromCard", () => {
  it("shows the day the answer names and hands a new day on with the mapping", () => {
    const onChange = renderCard();
    const picker = screen.getByLabelText(/Kinderzahl gilt ab/);
    expect(picker).toHaveValue("2026-11-02");
    expect(
      screen.getByText(/Der Tag gilt für alle Zeilen\./),
    ).toBeInTheDocument();
    fireEvent.change(picker, { target: { value: "2026-09-01" } });
    expect(onChange).toHaveBeenCalledWith({
      ...mapping,
      validFrom: "2026-09-01",
    });
  });

  it("says that rows with their own day keep it", () => {
    renderCard({
      ...mapping,
      columns: { ...mapping.columns, valid_from: "Stichtag" },
    });
    expect(
      screen.getByText(
        /Zeilen mit einem Tag in der Spalte „Stichtag“ behalten ihren Tag\. Dieser Tag gilt für alle anderen Zeilen\./,
      ),
    ).toBeInTheDocument();
  });
});
