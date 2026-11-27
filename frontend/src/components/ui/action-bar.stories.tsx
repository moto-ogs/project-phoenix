import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ActionBar } from "~/components/ui/action-bar";
import { Button } from "~/components/ui/button";

const meta: Meta<typeof ActionBar> = {
  title: "components/ui/ActionBar",
  component: ActionBar,
  parameters: { viewport: { defaultViewport: "mobile1" } },
};

export default meta;
type Story = StoryObj<typeof ActionBar>;

export const MitStatus: Story = {
  render: () => (
    <ActionBar status="3 Kinder gewählt">
      <Button type="button" variant="primary" noTooltip="Story">
        Speichern
      </Button>
    </ActionBar>
  ),
};

export const MitNebenaktion: Story = {
  render: () => (
    <ActionBar
      secondary={
        <Button type="button" variant="outline" noTooltip="Story">
          Abbrechen
        </Button>
      }
    >
      <Button type="button" variant="primary" noTooltip="Story">
        Aufsicht starten
      </Button>
    </ActionBar>
  ),
};
