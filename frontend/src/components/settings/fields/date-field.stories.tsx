import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";

import { DateField } from "./date-field";

const meta = {
  title: "components/settings/fields/DateField",
  component: DateField,
} satisfies Meta<typeof DateField>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  // axe meldet hier noch label-content-name-mismatch; Behebung in #7112.
  parameters: { a11y: { test: "todo" } },
  args: {
    value: "2026-06-10",
    onChange: () => undefined,
  },
};

export const Empty: Story = {
  // axe meldet hier noch label-content-name-mismatch; Behebung in #7112.
  parameters: { a11y: { test: "todo" } },
  args: {
    value: "",
    onChange: () => undefined,
  },
};

export const EmptyWithLabel: Story = {
  // axe meldet hier noch label-content-name-mismatch; Behebung in #7112.
  parameters: { a11y: { test: "todo" } },
  args: {
    value: "",
    onChange: () => undefined,
    emptyLabel: "Kein Datum",
  },
};

export const Disabled: Story = {
  // axe meldet hier noch label-content-name-mismatch; Behebung in #7112.
  parameters: { a11y: { test: "todo" } },
  args: {
    value: "2026-06-10",
    onChange: () => undefined,
    disabled: true,
  },
};

export const Interactive: Story = {
  // axe meldet hier noch label-content-name-mismatch; Behebung in #7112.
  parameters: { a11y: { test: "todo" } },
  args: {
    value: "2026-06-10",
    onChange: () => undefined,
  },
  render: () => {
    function InteractiveDateField() {
      const [value, setValue] = useState("2026-06-10");
      return <DateField value={value} onChange={setValue} />;
    }
    return <InteractiveDateField />;
  },
};
