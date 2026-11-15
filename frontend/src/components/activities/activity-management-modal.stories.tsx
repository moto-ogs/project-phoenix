import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { Activity } from "~/lib/activity-api";
import { ProfileProvider } from "~/lib/profile-context";
import { TeacherShellProvider } from "~/lib/shell-auth-context";

import { ActivityManagementModal } from "./activity-management-modal";

const activity: Activity = {
  id: "1",
  name: "Hausaufgabenbetreuung",
  max_participant: 15,
  is_open_ags: false,
  supervisor_id: "1",
  supervisor_name: "Anna Schmidt",
  supervisors: [
    {
      id: "1",
      staff_id: "1",
      is_primary: true,
      full_name: "Anna Schmidt",
    },
  ],
  ag_category_id: "1",
  category_name: "Lernförderung",
  created_at: new Date("2026-01-01T08:00:00Z"),
  updated_at: new Date("2026-01-01T08:00:00Z"),
};

const meta = {
  title: "components/activities/ActivityManagementModal",
  component: ActivityManagementModal,
  parameters: {
    layout: "fullscreen",
  },
  // Die Warteliste prüft Änderungsrechte über useShellAuth (#7108: ohne
  // Shell-Provider brach die Story beim Rendern ab).
  decorators: [
    (Story) => (
      <ProfileProvider>
        <TeacherShellProvider>
          <Story />
        </TeacherShellProvider>
      </ProfileProvider>
    ),
  ],
} satisfies Meta<typeof ActivityManagementModal>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Open: Story = {
  args: {
    isOpen: true,
    onClose: () => {},
    activity,
  },
};

export const Closed: Story = {
  args: {
    isOpen: false,
    onClose: () => {},
    activity,
  },
};

export const ReadOnly: Story = {
  args: {
    isOpen: true,
    onClose: () => {},
    activity,
    readOnly: true,
  },
};
