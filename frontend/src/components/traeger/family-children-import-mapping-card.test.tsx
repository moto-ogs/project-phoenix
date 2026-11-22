import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FamilyImportMapping } from "~/lib/traeger-family-children-import-api";

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
  // The day of the file lives in its own card (#7765): a column change
  // must hand it on unchanged.
  it("keeps the day of the file when a column changes", () => {
    const onChange = renderCard({ unmapped: ["child_first_name"] });
    // The card is open while a required field misses its column.
    fireEvent.click(screen.getByRole("combobox", { name: /Gültig ab/ }));
    fireEvent.click(screen.getByRole("option", { name: "Stichtag" }));
    expect(onChange).toHaveBeenCalledWith({
      ...mapping,
      columns: { ...mapping.columns, valid_from: "Stichtag" },
    });
  });
});
