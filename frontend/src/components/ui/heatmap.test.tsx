import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Heatmap } from "./heatmap";

const columns = [
  { key: "a", label: "07:00 Uhr", tick: "7:00" },
  { key: "b", label: "07:30 Uhr" },
];

function renderHeatmap() {
  return render(
    <Heatmap
      caption="Ankunft je Wochentag"
      columns={columns}
      rows={[
        {
          key: "1",
          label: "Montag",
          shortLabel: "Mo",
          meta: "aus 4 Tagen",
          values: [0, 12.4],
        },
        { key: "2", label: "Dienstag", values: [0.4, 1] },
      ]}
      tone="green"
      formatValue={(value) => (value >= 1 ? String(Math.round(value)) : "")}
      describeCell={(row, column, value) =>
        `${row.label}, ${column.label}: ${value} Kinder.`
      }
      summary="Am meisten: Montag, 07:30 Uhr."
      legend={{ low: "0", high: "12,4 Kinder" }}
    />,
  );
}

describe("Heatmap", () => {
  it("is a table whose every cell names its row, column and value", () => {
    renderHeatmap();
    const table = screen.getByRole("table", { name: "Ankunft je Wochentag" });
    const monday = within(table).getByRole("row", { name: /Montag/ });
    expect(
      within(monday).getByText("Montag, 07:30 Uhr: 12.4 Kinder."),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("columnheader", { name: "07:00 Uhr" }),
    ).toBeInTheDocument();
  });

  it("writes a number only from 1 on and colours only what is above 0", () => {
    renderHeatmap();
    const cells = screen.getAllByRole("cell");
    expect(
      cells.map((cell) => cell.querySelector("[aria-hidden]")?.textContent),
    ).toEqual(["", "12", "", "1"]);
    expect(cells[0]).toHaveClass("bg-gray-100");
    expect(cells[2]?.getAttribute("style")).toContain("background-color");
  });

  it("puts dark ink on light cells and white ink on the darkest", () => {
    renderHeatmap();
    const [, strongest, light] = screen.getAllByRole("cell");
    expect(strongest).toHaveStyle({ color: "#FFFFFF" });
    expect(light).toHaveStyle({ color: "#111827" });
  });

  it("shows the hovered cell under the grid and the summary otherwise", () => {
    renderHeatmap();
    expect(
      screen.getByText("Am meisten: Montag, 07:30 Uhr."),
    ).toBeInTheDocument();
    fireEvent.pointerEnter(screen.getAllByRole("cell")[3]!);
    expect(screen.getAllByText("Dienstag, 07:30 Uhr: 1 Kinder.")).toHaveLength(
      2,
    );
    fireEvent.pointerLeave(screen.getByRole("table"));
    expect(
      screen.getByText("Am meisten: Montag, 07:30 Uhr."),
    ).toBeInTheDocument();
  });
});
