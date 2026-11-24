/**
 * Tests for DataTable.
 *
 * Covers keyboard activation of clickable rows (Enter / Space), correct
 * suppression of bubbled keydown from inner elements, and the loading
 * placeholder rendering path, plus expandable, sub and summary rows.
 */
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";

import {
  DESKTOP_WIDTH,
  PHONE_WIDTH,
  setViewportWidth,
  usePhoneViewport,
} from "~/test/helpers/viewport";

import { DataTable } from "./data-table";
import type { DataTableColumn } from "./data-table";

interface Row {
  id: string;
  name: string;
}

const rows: Row[] = [
  { id: "1", name: "Alpha" },
  { id: "2", name: "Beta" },
];

const columns: DataTableColumn<Row>[] = [
  { key: "name", header: "Name", render: (row) => row.name },
];

describe("DataTable keyboard navigation", () => {
  it("opens only the rows canClickRow names, on desktop and phone", () => {
    const onRowClick = vi.fn();
    const table = (
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        onRowClick={onRowClick}
        canClickRow={(row) => row.id === "1"}
        stackedOnMobile
      />
    );
    setViewportWidth(DESKTOP_WIDTH);
    const { unmount } = render(table);

    const beta = screen.getByText("Beta").closest("tr")!;
    expect(beta).not.toHaveAttribute("role");
    expect(beta).not.toHaveClass("cursor-pointer");
    fireEvent.click(beta);
    expect(onRowClick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Alpha").closest("tr")!);
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
    unmount();

    onRowClick.mockReset();
    setViewportWidth(PHONE_WIDTH);
    render(table);
    const stackedBeta = screen.getByText("Beta").closest("li")!;
    expect(stackedBeta).not.toHaveAttribute("role");
    fireEvent.click(stackedBeta);
    expect(onRowClick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Alpha").closest("li")!);
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
    setViewportWidth(DESKTOP_WIDTH);
  });

  // The keyboard reaches a row through a real button in its first cell,
  // named by that cell; the row itself is no button (#7112).
  it("invokes onRowClick when Enter is pressed on a clickable row", async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();

    render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        onRowClick={onRowClick}
      />,
    );

    const rowButton = screen.getByRole("button", { name: "Alpha" });
    expect(rowButton.closest("tr")).not.toHaveAttribute("role");
    rowButton.focus();
    await user.keyboard("{Enter}");

    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });

  it("invokes onRowClick when Space is pressed on a clickable row", async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();

    render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        onRowClick={onRowClick}
      />,
    );

    screen.getByRole("button", { name: "Beta" }).focus();
    await user.keyboard(" ");

    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenCalledWith(rows[1]);
  });

  it("does not invoke onRowClick for other keys", async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();

    render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        onRowClick={onRowClick}
      />,
    );

    screen.getByRole("button", { name: "Alpha" }).focus();
    await user.keyboard("a");

    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("renders the loading state when isLoading is true", () => {
    render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        isLoading
      />,
    );

    expect(screen.getByText("Wird geladen…")).toBeInTheDocument();
  });

  it("renders the empty state when no rows are passed", () => {
    render(
      <DataTable
        columns={columns}
        rows={[]}
        getRowKey={(row) => row.id}
        emptyState="Nichts da."
      />,
    );

    expect(screen.getByText("Nichts da.")).toBeInTheDocument();
  });

  it("does not render rows as buttons when onRowClick is not set", () => {
    render(
      <DataTable columns={columns} rows={rows} getRowKey={(row) => row.id} />,
    );

    const rowEls = screen.getAllByRole("row");
    // Header row + 2 data rows = 3
    expect(rowEls.length).toBe(3);
    // None of the data rows should have role="button"
    const dataRows = rowEls.filter((el) => el.tagName === "TR");
    for (const r of dataRows) {
      expect(r.getAttribute("role")).not.toBe("button");
    }
  });

  describe("at phone width", () => {
    usePhoneViewport();

    it("does not turn rows with controls into nested buttons", () => {
      render(
        <DataTable
          columns={[
            ...columns,
            {
              key: "actions",
              header: "Aktionen",
              render: () => <button type="button">Anzeigen</button>,
            },
          ]}
          rows={rows}
          getRowKey={(row) => row.id}
          onRowClick={vi.fn()}
          rowHasInteractiveControls
          stackedOnMobile
        />,
      );

      const stacked = screen.getByTestId("data-table-stacked");
      const row = stacked.querySelector("li");
      expect(row).not.toHaveAttribute("role", "button");
      expect(row).not.toHaveAttribute("tabindex");
      // Only the phone list is in the document (#6220): one button per row.
      expect(screen.getAllByRole("button", { name: "Anzeigen" })).toHaveLength(
        2,
      );
    });

    it("keeps rows without their own controls keyboard-accessible", async () => {
      const user = userEvent.setup();
      const onRowClick = vi.fn();

      render(
        <DataTable
          columns={[
            ...columns,
            {
              key: "actions",
              header: "Aktionen",
              render: (row) =>
                row.id === "1" ? <button type="button">Anzeigen</button> : null,
            },
          ]}
          rows={rows}
          getRowKey={(row) => row.id}
          onRowClick={onRowClick}
          rowHasInteractiveControls={(row) => row.id === "1"}
          stackedOnMobile
        />,
      );

      const [rowWithControl, rowWithoutControl] =
        screen.getAllByRole("listitem");
      expect(rowWithControl).toBeDefined();
      expect(rowWithoutControl).toBeDefined();
      expect(rowWithControl!.firstElementChild).not.toHaveAttribute(
        "role",
        "button",
      );

      const rowButton = within(rowWithoutControl!).getByRole("button", {
        name: "Beta",
      });
      rowButton.focus();
      await user.keyboard("{Enter}");

      expect(onRowClick).toHaveBeenCalledWith(rows[1]);
    });
  });
});

describe("DataTable pagination", () => {
  const manyRows: Row[] = Array.from({ length: 12 }, (_, i) => ({
    id: String(i + 1),
    name: `Row ${String(i + 1).padStart(2, "0")}`,
  }));

  it("renders only the first pageSize rows initially", () => {
    render(
      <DataTable
        columns={columns}
        rows={manyRows}
        getRowKey={(row) => row.id}
        pageSize={5}
      />,
    );

    expect(screen.getByText("Row 01")).toBeInTheDocument();
    expect(screen.getByText("Row 05")).toBeInTheDocument();
    expect(screen.queryByText("Row 06")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Mehr laden \(5 von 12\)/ }),
    ).toBeInTheDocument();
  });

  it("names the rows on the load-more button when a noun is given", () => {
    render(
      <DataTable
        columns={columns}
        rows={manyRows}
        getRowKey={(row) => row.id}
        pageSize={5}
        pageNoun="Kinder"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Weitere Kinder laden (5 von 12)" }),
    );
    expect(screen.getByText("Row 06")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Weitere Kinder laden (10 von 12)" }),
    ).toBeInTheDocument();
  });

  it("reveals another pageSize chunk when 'Mehr laden' is clicked", () => {
    render(
      <DataTable
        columns={columns}
        rows={manyRows}
        getRowKey={(row) => row.id}
        pageSize={5}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Mehr laden \(5 von 12\)/ }),
    );

    expect(screen.getByText("Row 06")).toBeInTheDocument();
    expect(screen.getByText("Row 10")).toBeInTheDocument();
    expect(screen.queryByText("Row 11")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Mehr laden \(10 von 12\)/ }),
    ).toBeInTheDocument();
  });

  it("hides the load-more button once all rows are visible", () => {
    render(
      <DataTable
        columns={columns}
        rows={manyRows}
        getRowKey={(row) => row.id}
        pageSize={5}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Mehr laden/ }));
    fireEvent.click(screen.getByRole("button", { name: /Mehr laden/ }));

    expect(screen.getByText("Row 12")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Mehr laden/ }),
    ).not.toBeInTheDocument();
  });

  it("renders all rows and no button when pageSize is omitted", () => {
    render(
      <DataTable
        columns={columns}
        rows={manyRows}
        getRowKey={(row) => row.id}
      />,
    );

    expect(screen.getByText("Row 01")).toBeInTheDocument();
    expect(screen.getByText("Row 12")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Mehr laden/ }),
    ).not.toBeInTheDocument();
  });

  it("resets to the first page when the caller's filter key changes", () => {
    const { rerender } = render(
      <DataTable
        columns={columns}
        rows={manyRows}
        getRowKey={(row) => row.id}
        pageSize={5}
        paginationResetKey="all"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Mehr laden \(5 von 12\)/ }),
    );
    expect(screen.getByText("Row 10")).toBeInTheDocument();

    rerender(
      <DataTable
        columns={columns}
        rows={manyRows}
        getRowKey={(row) => row.id}
        pageSize={5}
        paginationResetKey="filtered"
      />,
    );

    expect(screen.queryByText("Row 06")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Mehr laden \(5 von 12\)/ }),
    ).toBeInTheDocument();
  });
});

// The stacked phone layout: same rows, same paging, one component. Columns
// declare the role they play so a phone shows the values a narrow viewport
// would otherwise push off screen.
describe("DataTable stacked phone layout", () => {
  usePhoneViewport();

  interface PersonRow {
    id: string;
    name: string;
    schoolClass: string;
    iban: string;
  }

  const stackedColumns: DataTableColumn<PersonRow>[] = [
    {
      key: "name",
      header: "Kind",
      render: (row) => row.name,
      sortValue: (row) => row.name,
      stacked: "title",
    },
    {
      key: "class",
      header: "Klasse",
      render: (row) => row.schoolClass,
      stacked: "meta",
    },
    { key: "iban", header: "IBAN", render: (row) => row.iban },
  ];

  const people: PersonRow[] = [
    { id: "1", name: "Mia", schoolClass: "1a", iban: "•••• 3000" },
    { id: "2", name: "Lea", schoolClass: "2b", iban: "•••• 4000" },
  ];

  it("renders the field columns as labelled lines beside the table", () => {
    const table = (
      <DataTable
        columns={stackedColumns}
        rows={people}
        getRowKey={(row) => row.id}
        stackedOnMobile
      />
    );
    const { unmount } = render(table);

    const stacked = screen.getByTestId("data-table-stacked");
    expect(stacked).toHaveTextContent("Mia");
    expect(stacked).toHaveTextContent("1a");
    // The label comes from the column header, the value from its renderer.
    expect(stacked).toHaveTextContent("IBAN");
    expect(stacked).toHaveTextContent("•••• 3000");
    // The desktop table leaves the document at phone width (#6220) and is
    // the only layout above the breakpoint (fresh render: see
    // setViewportWidth).
    expect(screen.queryByTestId("data-table-table")).not.toBeInTheDocument();
    unmount();
    setViewportWidth(DESKTOP_WIDTH);
    render(table);
    expect(screen.getByTestId("data-table-table")).toHaveTextContent("Mia");
    expect(screen.queryByTestId("data-table-stacked")).not.toBeInTheDocument();
  });

  it("drops a field line whose cell has no value for that row", () => {
    render(
      <DataTable
        columns={[
          {
            key: "name",
            header: "Name",
            stacked: "title",
            render: (row) => row.name,
          },
          {
            key: "iban",
            header: "IBAN",
            render: (row) => (row.id === "1" ? row.iban : null),
          },
        ]}
        rows={people}
        getRowKey={(row) => row.id}
        stackedOnMobile
      />,
    );

    const items = within(screen.getByTestId("data-table-stacked")).getAllByRole(
      "listitem",
    );
    expect(items[0]).toHaveTextContent("IBAN");
    expect(items[1]).toHaveTextContent("Lea");
    expect(items[1]).not.toHaveTextContent("IBAN");
  });

  it("gives a field without its label the full width and keeps the name for screen readers", () => {
    render(
      <DataTable
        columns={[
          {
            key: "name",
            header: "Name",
            stacked: "title",
            render: (row) => row.name,
          },
          {
            key: "iban",
            header: "IBAN",
            stackedLabel: false,
            render: (row) => row.iban,
          },
        ]}
        rows={people}
        getRowKey={(row) => row.id}
        stackedOnMobile
      />,
    );

    const stacked = screen.getByTestId("data-table-stacked");
    const label = within(stacked).getAllByText("IBAN")[0];
    expect(label).toHaveClass("sr-only");
    expect(stacked).toHaveTextContent("•••• 3000");
  });

  it("shares paging with the table instead of counting its own rows", () => {
    render(
      <DataTable
        columns={stackedColumns}
        rows={people}
        getRowKey={(row) => row.id}
        pageSize={1}
        stackedOnMobile
      />,
    );

    const stacked = screen.getByTestId("data-table-stacked");
    expect(stacked).not.toHaveTextContent("Lea");

    fireEvent.click(
      screen
        .getAllByRole("button", { name: /Mehr laden \(1 von 2\)/ })
        .filter((el) => stacked.contains(el))[0]!,
    );

    expect(stacked).toHaveTextContent("Lea");
  });

  it("renders the table alone when the phone layout is not requested", () => {
    render(
      <DataTable
        columns={stackedColumns}
        rows={people}
        getRowKey={(row) => row.id}
      />,
    );

    // Anker: die Tabelle zeigt die Zeilen.
    expect(screen.getByRole("table")).toHaveTextContent("Mia");
    expect(screen.queryByTestId("data-table-stacked")).not.toBeInTheDocument();
  });
});

describe("DataTable selection and hidden columns (#3834)", () => {
  const twoColumns: DataTableColumn<Row>[] = [
    { key: "name", header: "Name", render: (row) => row.name },
    { key: "id", header: "Nummer", render: (row) => `#${row.id}` },
  ];

  function renderSelectable(selectedKeys: ReadonlySet<string>) {
    const onChange = vi.fn();
    const onRowClick = vi.fn();
    render(
      <DataTable
        columns={twoColumns}
        rows={rows}
        getRowKey={(row) => row.id}
        onRowClick={onRowClick}
        selection={{
          selectedKeys,
          onChange,
          rowLabel: (row) => row.name,
        }}
      />,
    );
    return { onChange, onRowClick };
  }

  it("marks one row through its checkbox without opening the row", () => {
    const { onChange, onRowClick } = renderSelectable(new Set());

    fireEvent.click(screen.getByRole("checkbox", { name: "Beta auswählen" }));

    expect(onChange).toHaveBeenCalledWith(["2"], true);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("unmarks a marked row", () => {
    const { onChange } = renderSelectable(new Set(["1"]));

    const alpha = screen.getByRole("checkbox", { name: "Alpha auswählen" });
    expect(alpha).toBeChecked();
    fireEvent.click(alpha);

    expect(onChange).toHaveBeenCalledWith(["1"], false);
  });

  it("selects every row from the header box while some are unmarked", () => {
    const { onChange } = renderSelectable(new Set(["1"]));

    const all = screen.getByRole("checkbox", { name: "Alle auswählen" });
    expect(all).not.toBeChecked();
    expect((all as HTMLInputElement).indeterminate).toBe(true);
    fireEvent.click(all);

    expect(onChange).toHaveBeenCalledWith(["1", "2"], true);
  });

  it("clears every row from the header box when all are marked", () => {
    const { onChange } = renderSelectable(new Set(["1", "2"]));

    const all = screen.getByRole("checkbox", { name: "Alle auswählen" });
    expect(all).toBeChecked();
    fireEvent.click(all);

    expect(onChange).toHaveBeenCalledWith(["1", "2"], false);
  });

  it("keeps a selectable row out of the button role so the checkbox stays reachable", () => {
    renderSelectable(new Set());

    expect(
      screen
        .queryAllByRole("button")
        .filter((element) => element.tagName === "TR"),
    ).toHaveLength(0);
  });

  it("leaves hidden columns out of header and cells", () => {
    render(
      <DataTable
        columns={twoColumns}
        rows={rows}
        getRowKey={(row) => row.id}
        hiddenColumns={new Set(["id"])}
      />,
    );

    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.queryByText("Nummer")).not.toBeInTheDocument();
    expect(screen.queryByText("#1")).not.toBeInTheDocument();
  });
});

describe("DataTable one-line phone list (#3834)", () => {
  usePhoneViewport();

  const phoneColumns: DataTableColumn<Row>[] = [
    {
      key: "name",
      header: "Name",
      render: (row) => row.name,
      stacked: "title",
    },
    { key: "id", header: "Nummer", render: (row) => `#${row.id}` },
    {
      key: "end",
      header: "Ende",
      render: (row) => `bis ${row.id}`,
    },
  ];

  function renderPhoneList() {
    const onChange = vi.fn();
    const onRowClick = vi.fn();
    render(
      <DataTable
        columns={phoneColumns}
        rows={rows}
        getRowKey={(row) => row.id}
        onRowClick={onRowClick}
        stackedOnMobile
        stackedLayout="row"
        stackedDetailKey="end"
        selection={{
          selectedKeys: new Set(["1"]),
          onChange,
          rowLabel: (row) => row.name,
        }}
      />,
    );
    return {
      onChange,
      onRowClick,
      list: within(screen.getByTestId("data-table-stacked")),
    };
  }

  it("marks a row from its checkbox without opening it", () => {
    const { onChange, onRowClick, list } = renderPhoneList();

    expect(
      list.getByRole("checkbox", { name: "Alpha auswählen" }),
    ).toBeChecked();
    fireEvent.click(list.getByRole("checkbox", { name: "Beta auswählen" }));

    expect(onChange).toHaveBeenCalledWith(["2"], true);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("keeps the phone status when its desktop column is hidden", () => {
    const table = (
      <DataTable
        columns={[
          phoneColumns[0]!,
          {
            key: "status",
            header: "Status",
            render: (row) => `Status ${row.id}`,
            stacked: "meta",
          },
        ]}
        rows={rows}
        getRowKey={(row) => row.id}
        hiddenColumns={new Set(["status"])}
        stackedOnMobile
        stackedLayout="row"
      />
    );
    const { unmount } = render(table);

    const stacked = within(screen.getByTestId("data-table-stacked"));
    expect(stacked.getByText("Status 1")).toBeInTheDocument();
    unmount();
    setViewportWidth(DESKTOP_WIDTH);
    render(table);
    expect(screen.getByTestId("data-table-table")).not.toHaveTextContent(
      "Status 1",
    );
  });

  it("opens the row from anywhere else", () => {
    const { onRowClick, list } = renderPhoneList();

    fireEvent.click(list.getByText("Beta"));

    expect(onRowClick).toHaveBeenCalledWith(rows[1]);
  });

  it("shows only title and the chosen detail column", () => {
    const { list } = renderPhoneList();

    expect(list.getByText("bis 2")).toBeInTheDocument();
    expect(list.getAllByText("Ende")).toHaveLength(2);
    expect(list.queryByText("#2")).not.toBeInTheDocument();
    expect(list.queryByText("Nummer")).not.toBeInTheDocument();
  });
});

describe("DataTable heading (#3834)", () => {
  it("puts title and count inside the table surface", () => {
    render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        heading={{ title: "Kreativraum", count: 2 }}
      />,
    );

    const heading = screen.getByRole("heading", { name: "Kreativraum" });
    expect(heading.closest(".moto-content-surface")).not.toBeNull();
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});

describe("DataTable row-action column (#4975)", () => {
  const withActions: DataTableColumn<Row>[] = [
    ...columns,
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <button type="button">{`Aktionen für ${row.name}`}</button>
      ),
    },
  ];

  it("pins the actions column to the right edge while the table scrolls sideways", () => {
    render(
      <DataTable columns={withActions} rows={rows} getRowKey={(r) => r.id} />,
    );

    const cell = screen
      .getByRole("button", { name: "Aktionen für Alpha" })
      .closest("td");
    expect(cell).toHaveClass("sticky", "right-0");
    expect(screen.getAllByRole("columnheader").at(-1)).toHaveClass(
      "sticky",
      "right-0",
    );
  });

  it("keeps other columns in the scrolling flow", () => {
    render(
      <DataTable columns={withActions} rows={rows} getRowKey={(r) => r.id} />,
    );

    expect(screen.getByText("Alpha").closest("td")).not.toHaveClass("sticky");
  });
});

describe("DataTable load-more button (#4975)", () => {
  it("sits below the scrolling table, not in a table row", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: String(i),
      name: `Zeile ${i}`,
    }));
    render(
      <DataTable
        columns={columns}
        rows={many}
        getRowKey={(r) => r.id}
        pageSize={5}
      />,
    );

    const button = screen.getByRole("button", { name: /Mehr laden/ });
    expect(button.closest("table")).toBeNull();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });
});

describe("DataTable form phone layout (#4807)", () => {
  usePhoneViewport();

  interface WageRow {
    id: string;
    name: string;
    number: string;
  }
  const wageRows: WageRow[] = [
    { id: "1", name: "Nachtzuschlag", number: "311" },
  ];
  const formColumns: DataTableColumn<WageRow>[] = [
    {
      key: "name",
      header: "Bezeichnung",
      stacked: "title",
      render: (row) => (
        <input aria-label={`Bezeichnung ${row.name}`} defaultValue={row.name} />
      ),
    },
    {
      key: "number",
      header: "Lohnartnummer",
      render: (row) => (
        <input aria-label={`Nummer ${row.name}`} defaultValue={row.number} />
      ),
    },
    {
      key: "actions",
      header: "",
      stacked: "meta",
      render: (row) => (
        <button type="button">{`Aktionen für ${row.name}`}</button>
      ),
    },
  ];

  it("puts the headline and the row menu on top and every control under its label", () => {
    render(
      <DataTable
        columns={formColumns}
        rows={wageRows}
        getRowKey={(row) => row.id}
        stackedOnMobile
        stackedLayout="form"
        stackedTitle={(row) => row.name}
        rowHasInteractiveControls
      />,
    );

    const stacked = within(screen.getByTestId("data-table-stacked"));
    const row = stacked.getByRole("listitem");
    expect(
      within(row).getByText("Nachtzuschlag", { selector: "span" }),
    ).toBeInTheDocument();
    expect(
      within(row).getByRole("button", { name: "Aktionen für Nachtzuschlag" }),
    ).toBeInTheDocument();
    // The title column is a control, so it becomes a labelled field too.
    const nameLabel = within(row).getByText("Bezeichnung");
    expect(nameLabel.tagName).toBe("DT");
    expect(nameLabel.nextElementSibling).toContainElement(
      within(row).getByRole("textbox", { name: "Bezeichnung Nachtzuschlag" }),
    );
    const numberLabel = within(row).getByText("Lohnartnummer");
    expect(numberLabel.nextElementSibling).toContainElement(
      within(row).getByRole("textbox", { name: "Nummer Nachtzuschlag" }),
    );
  });

  it("stands in the card that holds it instead of a second frame", () => {
    render(
      <DataTable
        columns={formColumns}
        rows={wageRows}
        getRowKey={(row) => row.id}
        stackedOnMobile
        stackedLayout="form"
        stackedTitle={(row) => row.name}
        rowHasInteractiveControls
      />,
    );

    const list = within(screen.getByTestId("data-table-stacked")).getByRole(
      "list",
    );
    expect(list.parentElement).not.toHaveClass("moto-content-surface");
  });
});

describe("DataTable expandable rows, sub rows and summary rows (#5600)", () => {
  interface HourRow {
    id: string;
    day: string;
    hours: string;
    open: boolean;
  }
  const hourRows: HourRow[] = [
    { id: "mo", day: "Montag", hours: "8h", open: true },
    { id: "di", day: "Dienstag", hours: "7h", open: false },
  ];
  const hourColumns: DataTableColumn<HourRow>[] = [
    { key: "day", header: "Tag", render: (row) => row.day },
    { key: "note", header: "Notiz", render: () => null },
    { key: "hours", header: "Stunden", render: (row) => row.hours },
    {
      key: "actions",
      header: "Aktionen",
      headerSrOnly: true,
      render: () => null,
    },
  ];
  const renderHours = (
    props: Partial<Parameters<typeof DataTable<HourRow>>[0]> = {},
  ) =>
    render(
      <DataTable
        columns={hourColumns}
        rows={hourRows}
        getRowKey={(row) => row.id}
        expandable={{
          canExpand: (row) => row.open,
          rowLabel: (row, expanded) =>
            `${row.day}: Details ${expanded ? "schließen" : "öffnen"}`,
        }}
        {...props}
      />,
    );
  const details = (row: HourRow, expanded: boolean) =>
    expanded ? [{ key: `${row.id}-detail`, content: "Details des Tages" }] : [];

  // The row stays a table row; its chevron is the button that carries
  // aria-expanded and the row label (#7112). A click anywhere on the row
  // still toggles it.
  it("opens a row with a click and closes it with a second click", () => {
    renderHours({ renderSubRows: details });

    const toggle = screen.getByRole("button", {
      name: "Montag: Details öffnen",
    });
    const row = toggle.closest("tr")!;
    expect(row).not.toHaveAttribute("aria-expanded");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Details des Tages")).not.toBeInTheDocument();

    fireEvent.click(row);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAccessibleName("Montag: Details schließen");
    expect(screen.getByText("Details des Tages")).toBeInTheDocument();

    fireEvent.click(row);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Details des Tages")).not.toBeInTheDocument();
  });

  it.each(["{Enter}", " "])("toggles a row with the key %j", async (key) => {
    const user = userEvent.setup();
    renderHours({ renderSubRows: details });

    const toggle = screen.getByRole("button", {
      name: "Montag: Details öffnen",
    });
    toggle.focus();
    await user.keyboard(key);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Details des Tages")).toBeInTheDocument();
  });

  it("ignores a key pressed on a control inside the row", () => {
    renderHours({
      columns: [
        {
          key: "day",
          header: "Tag",
          render: (row) => <button type="button">{row.day} wählen</button>,
        },
      ],
      renderSubRows: details,
    });

    fireEvent.keyDown(screen.getByRole("button", { name: "Montag wählen" }), {
      key: "Enter",
    });

    expect(
      screen.getByRole("button", { name: "Montag: Details öffnen" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("leaves a row without anything to reveal plain", () => {
    renderHours({ renderSubRows: details });

    const row = screen.getByText("Dienstag").closest("tr")!;
    expect(row).not.toHaveAttribute("aria-expanded");
    expect(row).not.toHaveAttribute("tabindex");

    fireEvent.click(row);
    expect(screen.queryByText("Details des Tages")).not.toBeInTheDocument();
  });

  it("keeps only one row open", () => {
    renderHours({
      expandable: { rowLabel: (row) => row.day },
      renderSubRows: details,
    });

    fireEvent.click(screen.getByRole("button", { name: "Montag" }));
    fireEvent.click(screen.getByRole("button", { name: "Dienstag" }));

    expect(screen.getByRole("button", { name: "Montag" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByRole("button", { name: "Dienstag" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getAllByText("Details des Tages")).toHaveLength(1);
  });

  it("lines sub row cells up under their columns and keeps the cell count", () => {
    renderHours({
      renderSubRows: (row) => [
        {
          key: `${row.id}-block`,
          cells: [
            { columnKey: "day", content: `Block ${row.day}` },
            { columnKey: "hours", content: "3h" },
          ],
        },
      ],
    });

    const headCount = screen.getAllByRole("columnheader").length;
    const cells = within(
      screen.getByText("Block Montag").closest("tr")!,
    ).getAllByRole("cell");
    expect(cells).toHaveLength(headCount);
    expect(cells[2]).toHaveTextContent("3h");
    expect(cells[1]).toBeEmptyDOMElement();
  });

  it("spans a content row over all columns", () => {
    renderHours({ renderSubRows: (row) => details(row, true) });

    expect(screen.getAllByText("Details des Tages")[0]).toHaveAttribute(
      "colspan",
      "4",
    );
  });

  it("closes a row with a summary after its sub rows, honouring colSpan", () => {
    renderHours({
      renderSubRows: (row) => details(row, true),
      summaryRow: (row) =>
        row.id === "di"
          ? {
              key: `${row.id}-sum`,
              cells: [
                { columnKey: "day", colSpan: 2, content: "Summe Woche" },
                { columnKey: "hours", content: "15h" },
              ],
            }
          : null,
    });

    expect(screen.getAllByText("Summe Woche")).toHaveLength(1);
    const summary = screen.getByText("Summe Woche").closest("tr")!;
    expect(summary.previousElementSibling).toHaveTextContent(
      "Details des Tages",
    );
    const cells = within(summary).getAllByRole("cell");
    expect(cells).toHaveLength(3);
    expect(cells[0]).toHaveAttribute("colspan", "2");
    expect(cells[1]).toHaveTextContent("15h");
  });

  it("names a column for assistive tech only and pins it in sub rows", () => {
    renderHours({
      renderSubRows: (row) => [
        {
          key: `${row.id}-block`,
          cells: [{ columnKey: "actions", content: <span>Menü</span> }],
        },
      ],
    });

    expect(screen.getByText("Aktionen")).toHaveClass("sr-only");
    expect(screen.getAllByText("Menü")[0]!.closest("td")).toHaveClass(
      "sticky",
      "right-0",
      "bg-gray-50",
    );
  });

  it("carries the row tone into the pinned column, but not on an open row", () => {
    renderHours({
      columns: [
        ...hourColumns.slice(0, 3),
        {
          key: "actions",
          header: "Aktionen",
          headerSrOnly: true,
          render: () => <span>Menü</span>,
        },
      ],
      rowTone: () => "today",
    });

    const menuCell = screen.getAllByText("Menü")[0]!.closest("td")!;
    expect(menuCell).toHaveClass("from-moto-blue-soft/60");
    expect(menuCell.closest("tr")).toHaveClass("bg-moto-blue-soft/60");

    fireEvent.click(menuCell.closest("tr")!);

    expect(menuCell).not.toHaveClass("from-moto-blue-soft/60");
    expect(menuCell.closest("tr")).not.toHaveClass("bg-moto-blue-soft/60");
    expect(menuCell).toHaveClass("bg-gray-50");
  });

  it("shows the tooltip of a column head", () => {
    render(
      <DataTable
        columns={[
          {
            key: "day",
            header: "Tag",
            headerTitle: "Kalendertag",
            render: (row: HourRow) => row.day,
          },
        ]}
        rows={hourRows}
        getRowKey={(row) => row.id}
      />,
    );

    expect(screen.getByRole("columnheader", { name: "Tag" })).toHaveAttribute(
      "title",
      "Kalendertag",
    );
  });
});

// The phone cards keep every column (#7911): what a card does not show
// directly opens below it through its own button; the row menu stands top
// right in every layout.
describe("DataTable phone cards without lost columns (#7911)", () => {
  usePhoneViewport();

  interface CardRow {
    id: string;
    name: string;
    status: string;
    group: string;
    room: string;
    pickup: string;
  }
  const cardRows: CardRow[] = [
    {
      id: "1",
      name: "Alpha",
      status: "Da",
      group: "Gruppe Rot",
      room: "Raum 3",
      pickup: "15:30",
    },
  ];
  const cardColumns: DataTableColumn<CardRow>[] = [
    { key: "name", header: "Name", stacked: "title", render: (r) => r.name },
    {
      key: "status",
      header: "Status",
      stacked: "meta",
      render: (r) => r.status,
    },
    { key: "group", header: "Gruppe", render: (r) => r.group },
    { key: "room", header: "Raum", render: (r) => r.room },
    { key: "pickup", header: "Abholung", render: (r) => r.pickup },
    {
      key: "actions",
      header: "",
      render: (r) => <button type="button">{`Aktionen für ${r.name}`}</button>,
    },
  ];
  const values = ["Alpha", "Da", "Gruppe Rot", "Raum 3", "15:30"];

  function renderCards(
    layout: "lines" | "row" | "form",
    props: Partial<Parameters<typeof DataTable<CardRow>>[0]> = {},
  ) {
    const onRowClick = vi.fn();
    render(
      <DataTable
        columns={cardColumns}
        rows={cardRows}
        getRowKey={(r) => r.id}
        onRowClick={onRowClick}
        stackedOnMobile
        stackedLayout={layout}
        stackedDetailKey={layout === "row" ? "pickup" : undefined}
        {...props}
      />,
    );
    const card = within(screen.getByTestId("data-table-stacked")).getByRole(
      "listitem",
    );
    return { onRowClick, card: within(card), cardElement: card };
  }

  it.each(["lines", "form"] as const)(
    "shows every column of a %s card directly, without a toggle",
    (layout) => {
      const { card } = renderCards(layout);

      // Anker: die Karte ist gerendert und zeigt jeden Spaltenwert.
      for (const value of values) {
        expect(card.getByText(value)).toBeInTheDocument();
      }
      expect(
        card.queryByRole("button", { name: /^Details zu/ }),
      ).not.toBeInTheDocument();
    },
  );

  it("opens the columns a row card leaves out below the card", () => {
    const { card } = renderCards("row");

    // Anker: Titel, Meta und das gewählte Detail stehen auf der Karte.
    expect(card.getByText("Alpha")).toBeInTheDocument();
    expect(card.getByText("Da")).toBeInTheDocument();
    expect(card.getByText("15:30")).toBeInTheDocument();
    expect(card.queryByText("Gruppe Rot")).not.toBeInTheDocument();

    const toggle = card.getByRole("button", { name: "Details zu Alpha" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    for (const value of values) {
      expect(card.getByText(value)).toBeInTheDocument();
    }
    expect(card.getByText("Gruppe")).toBeInTheDocument();

    fireEvent.click(toggle);
    // Anker: die Karte steht noch, nur das Detail ist zu.
    expect(card.getByText("15:30")).toBeInTheDocument();
    expect(card.queryByText("Gruppe Rot")).not.toBeInTheDocument();
  });

  it("opens the full cell of a detail the row line shows in short form", () => {
    const { card } = renderCards("row", {
      columns: cardColumns.map((c) =>
        c.key === "pickup"
          ? {
              ...c,
              render: (r: CardRow) => `${r.pickup} (mit Notiz)`,
              stackedRender: (r: CardRow) => r.pickup,
            }
          : c,
      ),
    });

    // Anker: die Kurzform steht auf der Zeile.
    expect(card.getByText("15:30")).toBeInTheDocument();
    expect(card.queryByText("15:30 (mit Notiz)")).not.toBeInTheDocument();

    fireEvent.click(card.getByRole("button", { name: "Details zu Alpha" }));

    expect(card.getByText("15:30 (mit Notiz)")).toBeInTheDocument();
  });

  it("opens the details without opening the entry, and the card still opens it", () => {
    const { card, onRowClick } = renderCards("row", {
      columns: cardColumns.filter((c) => c.key !== "actions"),
    });

    const toggle = card.getByRole("button", { name: "Details zu Alpha" });
    fireEvent.click(toggle);
    // Anker: der Knopf hat das Detail geöffnet.
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(onRowClick).not.toHaveBeenCalled();

    fireEvent.click(card.getByText("Alpha"));
    expect(onRowClick).toHaveBeenCalledWith(cardRows[0]);
  });

  it("keeps a keyboard path to the entry when the card carries buttons", async () => {
    const user = userEvent.setup();
    const { card, onRowClick } = renderCards("row", {
      columns: cardColumns.filter((c) => c.key !== "actions"),
    });

    card.getByRole("button", { name: "Alpha" }).focus();
    await user.keyboard("{Enter}");

    expect(onRowClick).toHaveBeenCalledWith(cardRows[0]);
  });

  it.each(["lines", "row", "form"] as const)(
    "puts the row menu at the top of a %s card, outside the details",
    (layout) => {
      const { card, onRowClick } = renderCards(layout);

      const menu = card.getByRole("button", { name: "Aktionen für Alpha" });
      // The menu shares the card's first line with the title.
      expect(menu.closest("[data-stacked-head]")).toHaveTextContent("Alpha");
      fireEvent.click(menu);
      // Anker: das Menü steht in der Karte.
      expect(card.getByText("Alpha")).toBeInTheDocument();
      expect(onRowClick).not.toHaveBeenCalled();
    },
  );

  it("shows sub rows in the opened details and the summary as its own card", () => {
    const { card, cardElement } = renderCards("lines", {
      expandable: { rowLabel: (row) => `Details zu ${row.name}` },
      renderSubRows: (row, expanded) => [
        {
          key: `${row.id}-always`,
          cells: [{ columnKey: "room", content: "Block 8–12" }],
        },
        ...(expanded
          ? [{ key: `${row.id}-history`, content: "Verlauf des Tages" }]
          : []),
      ],
      summaryRow: (row) => ({
        key: `${row.id}-sum`,
        cells: [{ columnKey: "pickup", content: "Summe 40h" }],
      }),
    });

    // Anker: Karte und Summenkarte sind gerendert.
    expect(card.getByText("Alpha")).toBeInTheDocument();
    const summary = screen.getByText("Summe 40h");
    expect(card.queryByText("Verlauf des Tages")).not.toBeInTheDocument();
    expect(cardElement).not.toContainElement(summary);

    fireEvent.click(card.getByRole("button", { name: "Details zu Alpha" }));

    expect(card.getByText("Verlauf des Tages")).toBeInTheDocument();
    expect(card.getByText("Block 8–12")).toBeInTheDocument();
  });

  it("names the toggle of an expandable row with its own label", () => {
    const { card } = renderCards("lines", {
      expandable: {
        rowLabel: (row, expanded) =>
          `${row.name}: Verlauf ${expanded ? "schließen" : "öffnen"}`,
      },
      renderSubRows: (row, expanded) =>
        expanded ? [{ key: row.id, content: "Verlauf des Tages" }] : [],
    });

    const toggle = card.getByRole("button", { name: "Alpha: Verlauf öffnen" });
    fireEvent.click(toggle);

    expect(toggle).toHaveAccessibleName("Alpha: Verlauf schließen");
    expect(card.getByText("Verlauf des Tages")).toBeInTheDocument();
  });

  it("shows the phone form of title and meta in the head of a lines card", () => {
    const { card } = renderCards("lines", {
      columns: [
        {
          ...cardColumns[0]!,
          stackedRender: (r) => `${r.name} (kurz)`,
        },
        {
          ...cardColumns[1]!,
          stackedRender: (r) => `Status ${r.status}`,
        },
        ...cardColumns.slice(2),
      ],
    });

    const head = card
      .getByText("Alpha (kurz)")
      .closest("[data-stacked-head]") as HTMLElement;
    expect(within(head).getByText("Status Da")).toBeInTheDocument();
    expect(card.queryByText("Alpha")).not.toBeInTheDocument();
  });

  it("tints a phone card like its table row", () => {
    const { card } = renderCards("lines", {
      rowTone: () => "today",
    });

    // Anker: die Karte ist gerendert.
    expect(card.getByText("Alpha")).toBeInTheDocument();
    expect(
      card.getByText("Alpha").closest("[data-stacked-head]")!.parentElement,
    ).toHaveClass("bg-moto-blue-soft/60");
  });

  it("still opens the entry from the card of a row that expands", () => {
    const { card, onRowClick } = renderCards("lines", {
      expandable: { rowLabel: (row) => `Verlauf ${row.name}` },
      renderSubRows: (row, expanded) =>
        expanded ? [{ key: row.id, content: "Verlauf des Tages" }] : [],
    });

    fireEvent.click(card.getByText("Alpha"));

    expect(onRowClick).toHaveBeenCalledWith(cardRows[0]);
  });
});
