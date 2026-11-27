import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";

import { DatabaseSelect } from "./database-select";

const sampleOptions = [
  { value: "room-1", label: "Raum 1" },
  { value: "room-2", label: "Raum 2" },
];

function DatabaseSelectDemo(
  props: Pick<React.ComponentProps<typeof DatabaseSelect>, "disabled">,
) {
  const [value, setValue] = useState("");
  return (
    <DatabaseSelect
      {...props}
      name="room"
      label="Zielraum"
      placeholder="Zielraum wählen"
      options={sampleOptions}
      value={value}
      onChange={setValue}
    />
  );
}

const meta: Meta<typeof DatabaseSelect> = {
  title: "components/database/DatabaseSelect",
  component: DatabaseSelect,
  parameters: {
    layout: "padded",
  },
};

export default meta;

type Story = StoryObj<typeof DatabaseSelect>;

export const Default: Story = {
  render: () => <DatabaseSelectDemo />,
};

export const Disabled: Story = {
  render: () => <DatabaseSelectDemo disabled />,
};
