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

import { FamilyChildrenImportMappingCard } from "./family-children-import-mapping-card";

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

function renderCard(
  props: Partial<{
    mapping: FamilyImportMapping;
    unmapped: readonly "child_first_name"[];
  }> = {},
) {
  const onChange = vi.fn();
  render(
    <FamilyChildrenImportMappingCard
      headers={["Vorname", "Nachname", "Schule", "Kinder", "Stichtag"]}
      mapping={props.mapping ?? mapping}
      unmapped={props.unmapped ?? []}
      schools={[]}
      disabled={false}
      onChange={onChange}
    />,
  );
  return onChange;
}

describe("FamilyChildrenImportMappingCard", () => {
  // The day the numbers count from decides the bill: it stays on screen
  // while the complete mapping is folded away (#7765).
  it("names the day in the folded card", () => {
    renderCard();
    expect(
      screen.getByText(/Die Zahlen gelten ab 02\.11\.2026\./),
    ).toBeInTheDocument();
  });

  it("names the day for rows without their own day", () => {
    renderCard({
      mapping: {
        ...mapping,
        columns: { ...mapping.columns, valid_from: "Stichtag" },
      },
    });
    expect(
      screen.getByText(/Zeilen ohne eigenen Tag gelten ab 02\.11\.2026\./),
    ).toBeInTheDocument();
  });

  it("hands a new day on with the rest of the mapping", () => {
    const onChange = renderCard({ unmapped: ["child_first_name"] });
    const picker = screen.getByLabelText(/Kinderzahl gilt ab/);
    expect(picker).toHaveValue("2026-11-02");
    fireEvent.change(picker, { target: { value: "2026-09-01" } });
    expect(onChange).toHaveBeenCalledWith({
      ...mapping,
      validFrom: "2026-09-01",
    });
  });

  it("keeps the day when a column changes", () => {
    const onChange = renderCard({ unmapped: ["child_first_name"] });
    expect(
      screen.getByText(/moto rechnet sie nicht von selbst ab Vertragsbeginn/),
    ).toBeInTheDocument();
    // The card is open while a required field misses its column.
    fireEvent.click(screen.getByRole("combobox", { name: /Gültig ab/ }));
    fireEvent.click(screen.getByRole("option", { name: "Stichtag" }));
    expect(onChange).toHaveBeenCalledWith({
      ...mapping,
      columns: { ...mapping.columns, valid_from: "Stichtag" },
    });
  });
});
