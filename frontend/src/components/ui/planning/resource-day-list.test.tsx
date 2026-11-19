import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { ResourceDayList } from "./resource-day-list";
import type { ResourceGridColumn } from "./resource-grid";

interface Row {
  readonly id: string;
  readonly name: string;
}

const ROWS: readonly Row[] = [
  { id: "r1", name: "A. Krause" },
  { id: "r2", name: "B. Yilmaz" },
];

const DAYS: readonly ResourceGridColumn[] = [
  { key: "2026-09-07", label: "Mo", sublabel: "07.09." },
  { key: "2026-09-08", label: "Di", sublabel: "08.09.", isCurrent: true },
  { key: "2026-09-09", label: "Mi", sublabel: "09.09." },
];

function renderList(columns: readonly ResourceGridColumn[] = DAYS) {
  return render(
    <ResourceDayList<Row>
      columns={columns}
      rows={ROWS}
      getRowKey={(row) => row.id}
      renderRowHeader={(row) => <span>{row.name}</span>}
      renderCell={(row, column) => (
        <span>{`${row.name} am ${column.label}`}</span>
      )}
      legend={<span>Legende</span>}
    />,
  );
}

describe("ResourceDayList", () => {
  it("starts on today and shows every row for the chosen day", () => {
    renderList();
    expect(screen.getByText("A. Krause am Di")).toBeInTheDocument();
    expect(screen.getByText("B. Yilmaz am Di")).toBeInTheDocument();
    expect(screen.getByText("Legende")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Mi/ }));
    expect(screen.getByText("A. Krause am Mi")).toBeInTheDocument();
    expect(screen.queryByText("A. Krause am Di")).toBeNull();
  });

  it("starts on the first day when today is not in the week", () => {
    renderList(DAYS.map((day) => ({ ...day, isCurrent: false })));
    const list = screen.getByRole("list");
    expect(within(list).getByText("A. Krause am Mo")).toBeInTheDocument();
  });
});
