import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import type { DataTableColumn } from "./data-table";
import { DataTable, DataTableStatusBadge } from "./data-table";
import { OverflowMenu } from "./page-header/OverflowMenu";
import { StatusBadge } from "./status-badge";

interface DemoRow {
  id: string;
  name: string;
  role: string;
  active: boolean;
}

const demoRows: DemoRow[] = [
  { id: "1", name: "Anna Schmidt", role: "Erzieherin", active: true },
  { id: "2", name: "Ben Fischer", role: "Praktikant", active: false },
  { id: "3", name: "Clara Weber", role: "Leitung", active: true },
];

const demoColumns: DataTableColumn<DemoRow>[] = [
  {
    key: "name",
    header: "Name",
    render: (row) => row.name,
    sortValue: (row) => row.name,
  },
  {
    key: "role",
    header: "Rolle",
    render: (row) => row.role,
    sortValue: (row) => row.role,
  },
  {
    key: "active",
    header: "Status",
    align: "right",
    render: (row) => <DataTableStatusBadge active={row.active} />,
  },
];

const meta = {
  title: "components/ui/DataTable",
  component: DataTable<DemoRow>,
} satisfies Meta<typeof DataTable<DemoRow>>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    columns: demoColumns,
    rows: demoRows,
    getRowKey: (row) => row.id,
  },
};

export const Loading: Story = {
  args: {
    columns: demoColumns,
    rows: [],
    getRowKey: (row) => row.id,
    isLoading: true,
  },
};

export const Empty: Story = {
  args: {
    columns: [],
    rows: [],
    getRowKey: (row: DemoRow) => row.id,
  },
};

export const WithHeaderActionsAndCaption: Story = {
  args: {
    columns: demoColumns,
    rows: demoRows,
    getRowKey: (row) => row.id,
    caption: "3 Mitarbeitende",
    headerActions: (
      <button type="button" className="text-sm text-gray-600">
        Filtern
      </button>
    ),
    defaultSortKey: "name",
  },
};

export const Paginated: Story = {
  args: {
    columns: demoColumns,
    rows: demoRows,
    getRowKey: (row) => row.id,
    pageSize: 2,
  },
};

export const ExpandableWithSubRowsAndSummary: Story = {
  args: {
    columns: demoColumns,
    rows: demoRows,
    getRowKey: (row) => row.id,
    expandable: {
      canExpand: (row) => row.active,
      rowLabel: (row, expanded) =>
        `${row.name}: Details ${expanded ? "schließen" : "öffnen"}`,
    },
    renderSubRows: (row, expanded) =>
      expanded
        ? [
            {
              key: `${row.id}-role`,
              cells: [
                { columnKey: "name", content: "Vertretung" },
                { columnKey: "role", content: "Springkraft" },
              ],
            },
            { key: `${row.id}-note`, content: "Keine weiteren Angaben." },
          ]
        : [],
    summaryRow: (row) =>
      row.id === "3"
        ? {
            key: "sum",
            cells: [{ columnKey: "name", colSpan: 2, content: "3 Personen" }],
          }
        : null,
    rowTone: (row) => (row.id === "2" ? "today" : null),
  },
};

// Phone cards (#7911): every column stands on the card or opens below it.
// Open the stories at phone width to see the stacked layout.

interface ChildRow {
  id: string;
  name: string;
  status: string;
  schoolClass: string;
  group: string;
  arrival: string;
  pickup: string;
}

const childRows: ChildRow[] = [
  {
    id: "1",
    name: "Mia Kaya",
    status: "Da",
    schoolClass: "2a",
    group: "Gruppe Rot",
    arrival: "08:05 Uhr",
    pickup: "15:30 Uhr",
  },
  {
    id: "2",
    name: "Noah Becker",
    status: "Krank",
    schoolClass: "3b",
    group: "Gruppe Blau",
    arrival: "–",
    pickup: "–",
  },
];

const childColumns: DataTableColumn<ChildRow>[] = [
  { key: "name", header: "Name", stacked: "title", render: (r) => r.name },
  {
    key: "status",
    header: "Status",
    stacked: "meta",
    render: (r) => (
      <StatusBadge
        tone={r.status === "Da" ? "green" : "warning"}
        label={r.status}
      />
    ),
  },
  { key: "class", header: "Klasse", render: (r) => r.schoolClass },
  { key: "group", header: "Gruppe", render: (r) => r.group },
  { key: "arrival", header: "Ankunft", render: (r) => r.arrival },
  { key: "pickup", header: "Gehzeit", render: (r) => r.pickup },
];

export const PhoneOneLineList: StoryObj<typeof DataTable<ChildRow>> = {
  args: {
    columns: childColumns,
    rows: childRows,
    getRowKey: (row) => row.id,
    onRowClick: () => undefined,
    stackedLayout: "row",
    stackedDetailKey: "arrival",
  },
};

interface DayRow {
  id: string;
  day: string;
  span: string;
  pause: string;
  actual: string;
  balance: string;
}

const dayRows: DayRow[] = [
  {
    id: "mo",
    day: "Mo, 07.09.",
    span: "07:45–15:15",
    pause: "30 min",
    actual: "7:00 / 7:00",
    balance: "±0:00",
  },
  {
    id: "di",
    day: "Di, 08.09.",
    span: "07:50–16:20",
    pause: "45 min",
    actual: "7:45 / 7:00",
    balance: "+0:45",
  },
];

const dayColumns: DataTableColumn<DayRow>[] = [
  { key: "day", header: "Datum", stacked: "title", render: (r) => r.day },
  {
    key: "balance",
    header: "Saldo",
    stacked: "meta",
    stackedTone: "figure",
    render: (r) => r.balance,
  },
  { key: "span", header: "Kommen–Gehen", render: (r) => r.span },
  { key: "pause", header: "Pause", render: (r) => r.pause },
  { key: "actual", header: "Ist / Soll", render: (r) => r.actual },
  {
    key: "actions",
    header: "",
    align: "right",
    render: (r) => (
      <OverflowMenu
        ariaLabel={`Aktionen für ${r.day}`}
        items={[
          {
            label: "Korrigieren",
            description: "Öffnet die Zeiten dieses Tages zum Ändern",
            onClick: () => undefined,
          },
        ]}
      />
    ),
  },
];

export const PhoneCardsWithDetailsAndSummary: StoryObj<
  typeof DataTable<DayRow>
> = {
  args: {
    columns: dayColumns,
    rows: dayRows,
    getRowKey: (row) => row.id,
    expandable: {
      rowLabel: (row, expanded) =>
        `${row.day}: Verlauf ${expanded ? "schließen" : "öffnen"}`,
    },
    renderSubRows: (row, expanded) =>
      expanded
        ? [
            {
              key: `${row.id}-log`,
              content: "Gehen von 16:05 auf 16:20 korrigiert.",
            },
          ]
        : [],
    summaryRow: (row) =>
      row.id === "di"
        ? {
            key: "week",
            cells: [
              { columnKey: "day", content: "Woche 37" },
              { columnKey: "balance", content: "+0:45" },
            ],
          }
        : null,
  },
};

interface GroupFigures {
  id: string;
  group: string;
  children: number;
  present: number;
  sick: number;
  excused: number;
  unexplained: number;
  rate: string;
}

const groupFigures: GroupFigures[] = [
  {
    id: "1",
    group: "Bärengruppe",
    children: 24,
    present: 412,
    sick: 18,
    excused: 9,
    unexplained: 2,
    rate: "93 %",
  },
  {
    id: "2",
    group: "Fuchsgruppe",
    children: 21,
    present: 365,
    sick: 25,
    excused: 4,
    unexplained: 5,
    rate: "91 %",
  },
];

const figure = (
  key: Exclude<keyof GroupFigures, "id" | "group">,
  header: string,
): DataTableColumn<GroupFigures> => ({
  key,
  header,
  align: "right",
  className: "tabular-nums whitespace-nowrap",
  render: (r) => r[key],
});

// A comparison table stays a table on a phone (#7912): it scrolls sideways,
// the first column stays put, the fade at the edge shows more columns.
export const PhoneComparisonScroll: StoryObj<typeof DataTable<GroupFigures>> = {
  args: {
    columns: [
      {
        key: "group",
        header: "Gruppe",
        className: "whitespace-nowrap font-medium",
        render: (r) => r.group,
      },
      figure("children", "Kinder"),
      figure("present", "Anwesend"),
      figure("sick", "Krank"),
      figure("excused", "Entschuldigt"),
      figure("unexplained", "Ohne Meldung"),
      figure("rate", "Quote"),
    ],
    rows: groupFigures,
    getRowKey: (row) => row.id,
    mobileScroll: { reason: "Anwesenheitszahlen je Gruppe zum Vergleichen" },
  },
};
