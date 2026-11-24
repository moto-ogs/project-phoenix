import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TraegerModulesCard } from "./traeger-modules-card";

describe("TraegerModulesCard (#6052)", () => {
  it("lists the four modules of the Träger portal with their state", () => {
    render(<TraegerModulesCard bookedModules={["vertraege", "eltern_app"]} />);
    const rows = screen.getAllByRole("listitem");
    expect(
      rows.map(
        (row) =>
          within(row).getByText(/./, { selector: "p.font-semibold" })
            .textContent,
      ),
    ).toEqual([
      "Träger-Übersicht",
      "Ferienbetreuung",
      "Verträge und Dokumente",
      "Elternbeiträge und Abrechnung",
    ]);
    expect(within(rows[2]!).getByText("Gebucht")).toBeInTheDocument();
    for (const index of [0, 1, 3]) {
      expect(
        within(rows[index]!).getByText("Nicht gebucht"),
      ).toBeInTheDocument();
    }
  });

  it("says who changes a booking", () => {
    render(<TraegerModulesCard bookedModules={[]} />);
    expect(
      screen.getByText(/Für eine Änderung wende dich an das moto-Team\./),
    ).toBeInTheDocument();
  });
});
