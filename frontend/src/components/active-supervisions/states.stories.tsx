import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";

import {
  ActiveSupervisionLoadingView,
  EmptyRoomsView,
  ReleaseSupervisionModal,
  SchulhofSuperviseButton,
} from "./states";

const meta = {
  title: "active-supervisions/states",
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Loading: Story = {
  render: () => <ActiveSupervisionLoadingView />,
};

export const EmptyRooms: Story = {
  render: () => <EmptyRoomsView />,
};

export const ReleaseModal: Story = {
  render: () => (
    <ReleaseSupervisionModal
      isOpen={true}
      isConfirmLoading={false}
      onClose={fn()}
      onConfirm={fn()}
    />
  ),
};

export const SchulhofSupervise: Story = {
  render: () => <SchulhofSuperviseButton isToggling={false} onToggle={fn()} />,
};

export const SchulhofSuperviseToggling: Story = {
  render: () => <SchulhofSuperviseButton isToggling onToggle={fn()} />,
};

export const SchulhofSuperviseBlocked: Story = {
  render: () => (
    <SchulhofSuperviseButton isToggling={false} disabled onToggle={fn()} />
  ),
};
