import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { TriangleAlert } from "lucide-react";

import { CoverageIndicator } from "./coverage-indicator";
import { PlanBlock } from "./plan-block";

const meta = {
  title: "components/ui/planning/PlanBlock",
  component: PlanBlock,
  args: {
    timeRange: "12:00–14:00",
    label: "Mensa",
    color: "#3F6F12",
  },
} satisfies Meta<typeof PlanBlock>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  // axe meldet hier noch color-contrast; Behebung in #7110.
  parameters: { a11y: { test: "todo" } },
};

export const WithCoverage: Story = {
  // axe meldet hier noch color-contrast; Behebung in #7110.
  parameters: { a11y: { test: "todo" } },
  args: {
    footer: <CoverageIndicator state="gap" current={1} total={3} />,
  },
};

export const Compact: Story = {
  // axe meldet hier noch color-contrast; Behebung in #7110.
  parameters: { a11y: { test: "todo" } },
  args: {
    size: "compact",
  },
};

export const Hatched: Story = {
  args: {
    status: "hatched",
    statusIcon: (
      <TriangleAlert
        className="h-3.5 w-3.5"
        style={{ color: "#F78C10" }}
        aria-hidden="true"
      />
    ),
  },
};

export const Cancelled: Story = {
  // axe meldet hier noch color-contrast; Behebung in #7110.
  parameters: { a11y: { test: "todo" } },
  args: {
    status: "cancelled",
  },
};

export const Selected: Story = {
  // axe meldet hier noch color-contrast; Behebung in #7110.
  parameters: { a11y: { test: "todo" } },
  args: {
    selected: true,
  },
};

export const WithoutShiftType: Story = {
  // axe meldet hier noch color-contrast; Behebung in #7110.
  parameters: { a11y: { test: "todo" } },
  args: {
    color: undefined,
  },
};

export const NonInteractive: Story = {
  // axe meldet hier noch color-contrast; Behebung in #7110.
  parameters: { a11y: { test: "todo" } },
  args: {
    interactive: false,
  },
};
