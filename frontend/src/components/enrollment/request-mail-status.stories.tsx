import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { RequestMailStatus } from "~/components/enrollment/request-mail-status";

const meta = {
  title: "components/enrollment/RequestMailStatus",
  component: RequestMailStatus,
} satisfies Meta<typeof RequestMailStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The mails of an enrollment request, one delivered and one still queued. */
export const Default: Story = {
  args: {
    loadError: null,
    mails: [
      {
        kind: "enrollment_submitted",
        outcome: "delivered",
        created_at: "2026-09-01T10:00:00+02:00",
      },
      { kind: "enrollment_approved", outcome: "queued" },
    ],
  },
};

/** A mail that never reached the family's address. */
export const AddressMarked: Story = {
  args: {
    loadError: null,
    title: "Mails an die Eltern",
    mails: [
      {
        kind: "enrollment_submitted",
        outcome: "undeliverable",
        address_mark: "failed",
      },
    ],
  },
};
