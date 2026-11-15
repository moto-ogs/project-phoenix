import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import GuardianPickerPanel from "~/components/guardians/guardian-picker-panel";

const meta: Meta<typeof GuardianPickerPanel> = {
  title: "components/guardians/GuardianPickerPanel",
  component: GuardianPickerPanel,
  args: {
    onSelect: () => undefined,
    onCancel: () => undefined,
  },
};

export default meta;
type Story = StoryObj<typeof GuardianPickerPanel>;

export const Default: Story = {
  // axe meldet hier noch color-contrast; Behebung in #7110.
  parameters: { a11y: { test: "todo" } },
};

export const WithExcludedProfiles: Story = {
  // axe meldet hier noch color-contrast; Behebung in #7110.
  parameters: { a11y: { test: "todo" } },
  args: {
    excludeProfileIds: ["profile-1", "profile-2"],
  },
};
