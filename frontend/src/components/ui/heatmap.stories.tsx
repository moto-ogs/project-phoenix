import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Heatmap, type HeatmapRow } from "./heatmap";

const meta = {
  title: "components/ui/Heatmap",
} satisfies Meta;

export default meta;
type Story = StoryObj;

const columns = Array.from({ length: 21 }, (_, i) => {
  const minute = 420 + i * 30;
  const clock = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  return {
    key: String(minute),
    label: `${clock} Uhr`,
    tick: minute % 60 === 0 ? `${minute / 60}:00` : "",
  };
});

const shape = [
  3, 9, 4, 1, 0, 0, 0, 0, 0, 2, 14, 26, 11, 4, 1, 0, 0, 0, 0, 0, 0,
];
const rows: HeatmapRow[] = [
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
].map((label, day) => ({
  key: label,
  label,
  shortLabel: label.slice(0, 2),
  meta: "aus 4 Tagen",
  values: shape.map((value) => Math.max(0, value + (day % 3) - 1)),
}));

function Example({ tone }: Readonly<{ tone: "green" | "blue" }>) {
  return (
    <div className="max-w-4xl">
      <Heatmap
        caption="Ankunft je Wochentag und halbe Stunde"
        columns={columns}
        rows={rows}
        tone={tone}
        formatValue={(value) => (value >= 1 ? String(Math.round(value)) : "")}
        describeCell={(row, column, value) =>
          `${row.label}, ${column.label}: ${value} Kinder.`
        }
        summary="Am meisten: Mittwoch, 12:30 Uhr."
        highlight={{ row: 2, column: 11 }}
        legend={{ low: "0", high: "27 Kinder" }}
      />
    </div>
  );
}

export const Green: Story = { render: () => <Example tone="green" /> };
export const Blue: Story = { render: () => <Example tone="blue" /> };
