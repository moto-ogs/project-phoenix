import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { PlanAddButton } from "./plan-add-affordance";
import { PlanBlock } from "./plan-block";
import { PlanLegend } from "./plan-legend";
import { ResourceDayList } from "./resource-day-list";
import type { ResourceGridColumn } from "./resource-grid";
import { LOCATION_COLORS } from "~/lib/location-helper";

interface DemoRow {
  readonly id: string;
  readonly name: string;
}

const ROWS: readonly DemoRow[] = [
  { id: "r1", name: "Krause, Anna" },
  { id: "r2", name: "Yilmaz, Berk" },
];

const DAYS: readonly ResourceGridColumn[] = [
  { key: "mo", label: "Mo", sublabel: "13.07." },
  { key: "di", label: "Di", sublabel: "14.07.", isCurrent: true },
  { key: "mi", label: "Mi", sublabel: "15.07." },
  { key: "do", label: "Do", sublabel: "16.07." },
  { key: "fr", label: "Fr", sublabel: "17.07." },
];

const meta = {
  title: "components/ui/planning/ResourceDayList",
  parameters: { viewport: { defaultViewport: "mobile1" } },
} satisfies Meta;

export default meta;

type Story = StoryObj;

export const OneDayOfAWeek: Story = {
  render: () => (
    <div className="max-w-sm">
      <ResourceDayList<DemoRow>
        columns={DAYS}
        rows={ROWS}
        getRowKey={(row) => row.id}
        renderRowHeader={(row) => (
          <span className="block text-sm font-medium text-gray-900">
            {row.name}
          </span>
        )}
        renderCell={(row, column) =>
          row.id === "r1" ? (
            <PlanBlock
              size="compact"
              timeRange="08:00–12:00"
              label={`Frühdienst ${column.label}`}
              color={LOCATION_COLORS.GROUP_ROOM}
            />
          ) : (
            <PlanAddButton
              label={`Schicht planen, ${row.name}, ${column.label}`}
              onClick={() => undefined}
            />
          )
        }
        legend={
          <PlanLegend
            aria-label="Legende"
            entries={[
              {
                key: "nord",
                label: "OGS Nord",
                color: LOCATION_COLORS.GROUP_ROOM,
              },
            ]}
          />
        }
      />
    </div>
  ),
};
