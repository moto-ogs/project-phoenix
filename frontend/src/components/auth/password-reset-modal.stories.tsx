import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { storyNow } from "~storybook/clock";
import { PasswordResetModal } from "./password-reset-modal";
import { rememberResetWait } from "./password-reset-wait";

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

/**
 * The address waits after too many requests (#7213): the warning counts
 * down for this address only, another address can be sent at once.
 */
export const AddressWaits: Story = {
  args: { initialEmail: "test@example.com" },
  beforeEach: () => {
    const now = storyNow().getTime();
    rememberResetWait({}, "test@example.com", now + 42 * 60_000, now);
    return () => globalThis.localStorage.removeItem("passwordResetWaits");
  },
};
