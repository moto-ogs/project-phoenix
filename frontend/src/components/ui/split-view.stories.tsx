import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { SectionCard } from "~/components/ui/section-card";
import { SplitView } from "~/components/ui/split-view";

const meta: Meta<typeof SplitView> = {
  title: "components/ui/SplitView",
  component: SplitView,
};

export default meta;
type Story = StoryObj<typeof SplitView>;

const list = (
  <SectionCard>
    <p className="text-sm">Liste</p>
  </SectionCard>
);

export const OhneAuswahl: Story = {
  render: () => (
    <SplitView
      list={list}
      detail={null}
      empty="Wähle links ein Kind, um seine Angaben zu sehen."
    />
  ),
};

export const MitAuswahl: Story = {
  render: () => (
    <SplitView
      list={list}
      detail={
        <SectionCard title="Mia Kaya">
          <p className="text-sm">Ankunft 08:00 · Gehzeit 16:00</p>
        </SectionCard>
      }
      empty="Wähle links ein Kind, um seine Angaben zu sehen."
    />
  ),
};
