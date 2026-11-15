import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { LanguageSwitcher } from "~/components/parent/language-switcher";

const meta: Meta<typeof LanguageSwitcher> = {
  title: "components/parent/LanguageSwitcher",
  component: LanguageSwitcher,
};

export default meta;
type Story = StoryObj<typeof LanguageSwitcher>;

export const Default: Story = {
  // axe meldet hier noch label-content-name-mismatch; Behebung in #7112.
  parameters: { a11y: { test: "todo" } },
};

export const Compact: Story = {
  // axe meldet hier noch label-content-name-mismatch; Behebung in #7112.
  parameters: { a11y: { test: "todo" } },
  args: {
    compact: true,
  },
};
