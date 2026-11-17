import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { storyNow } from "~storybook/clock";
import { fn } from "storybook/test";
import type { OperatorDevice } from "~/lib/operator/provisioning-helpers";
import { DevicesTable } from "./devices-table";

const meta: Meta<typeof DevicesTable> = {
  title: "components/operator/DevicesTable",
  component: DevicesTable,
};

export default meta;
type Story = StoryObj<typeof DevicesTable>;

const devices: OperatorDevice[] = [
  {
    id: "1",
    deviceId: "PI-0001",
    name: "Eingangstür",
    deviceType: "checkin_kiosk",
    status: "active",
    isOnline: true,
    lastSeen: storyNow().toISOString(),
    apiKey: "",
    maskedApiKey: "****-ab12",
    schoolId: "1",
    schoolName: "Grundschule Musterstadt",
    organizationId: "1",
    organizationName: "Musterträger e.V.",
    createdAt: storyNow().toISOString(),
    updatedAt: storyNow().toISOString(),
  },
  {
    id: "2",
    deviceId: "PI-0002",
    name: "",
    deviceType: "checkin_kiosk",
    status: "offline",
    isOnline: false,
    lastSeen: null,
    apiKey: "",
    maskedApiKey: "",
    schoolId: "1",
    schoolName: "Grundschule Musterstadt",
    organizationId: "1",
    organizationName: "Musterträger e.V.",
    createdAt: storyNow().toISOString(),
    updatedAt: storyNow().toISOString(),
  },
];

export const Empty: Story = {
  args: {
    devices: [],
  },
};

export const Default: Story = {
  args: {
    devices,
  },
};

export const WithSchoolColumnAndActions: Story = {
  args: {
    devices,
    showSchool: true,
    onSetKey: fn(),
    onDelete: fn(),
  },
};
