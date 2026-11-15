import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { PasswordResetModal } from "./password-reset-modal";

const meta: Meta<typeof PasswordResetModal> = {
  title: "components/auth/PasswordResetModal",
  component: PasswordResetModal,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    portal: "tenant",
    isOpen: true,
    onClose: () => {
      // no-op for story
    },
  },
};

export default meta;
type Story = StoryObj<typeof PasswordResetModal>;

export const Default: Story = {};

/** Opened from the login form: the typed address is already there. */
export const WithTypedAddress: Story = {
  args: { initialEmail: "test@example.com" },
};
