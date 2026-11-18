import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { DeviceHistoryEntry } from "~/lib/device-history";
import { DeviceHistoryList } from "./device-history-list";

// Fixed instants: stories read no clock, so the days show their dates.
const entries: DeviceHistoryEntry[] = [
  {
    id: "5",
    action: "blocked",
    actorKind: "school_staff",
    actorName: "Maria Muster",
    changes: { status: { before: "active", after: "inactive" } },
    occurredAt: "2026-11-18T13:05:00Z",
    schoolName: "OGS Burbach",
  },
  {
    id: "4",
    action: "updated",
    actorKind: "school_staff",
    actorName: "Maria Muster",
    changes: { name: { before: "Tablet Flur", after: "Altes Tablet Flur" } },
    occurredAt: "2026-11-18T12:40:00Z",
    schoolName: "OGS Burbach",
  },
  {
    id: "3",
    action: "key_rotated",
    actorKind: "operator",
    actorName: null,
    changes: {},
    occurredAt: "2026-11-12T07:15:00Z",
    schoolName: "OGS Burbach",
  },
  {
    id: "2",
    action: "transferred_in",
    actorKind: "operator",
    actorName: null,
    changes: {},
    occurredAt: "2026-11-03T09:00:00Z",
    schoolName: "OGS Burbach",
  },
  {
    id: "1",
    action: "created",
    actorKind: "school_staff",
    actorName: "Jonas Beispiel",
    changes: {
      device_id: { before: null, after: "demo-device-blocked" },
      device_type: { before: null, after: "terminal" },
      name: { before: null, after: "Tablet Flur" },
      status: { before: null, after: "active" },
    },
    occurredAt: "2026-09-01T06:30:00Z",
    schoolName: "OGS Walbach",
  },
];

const meta: Meta<typeof DeviceHistoryList> = {
  title: "Devices/DeviceHistoryList",
  component: DeviceHistoryList,
  parameters: { layout: "padded" },
  args: { entries, portal: "school" },
};

export default meta;
type Story = StoryObj<typeof DeviceHistoryList>;

/** The school reads its own staff by name; the moto team stays „moto-Support“. */
export const School: Story = {};

/** The operator reads every school the device went through, without staff names. */
export const Operator: Story = { args: { portal: "operator" } };

export const Empty: Story = { args: { entries: [] } };

export const Loading: Story = { args: { entries: [], loading: true } };
