import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  PickupTimeModal,
  SickNoteModal,
  SickStatusSummary,
} from "./child-care";
import type * as parentMeContract from "~/lib/contract/parent-me.generated";

const CARE_EXCEPTIONS: parentMeContract.CareExceptionResponse[] = [
  {
    date: "2026-07-10",
    pickup_time: "15:30",
    source: "guardian",
    pickup_source: "guardian",
    updated_at: "2026-07-01T10:00:00Z",
  },
];

const SICK_DAYS: parentMeContract.StatusDayResponse[] = [
  {
    id: "1",
    student_id: "1",
    date: "2026-07-01",
    status: "sick",
    reported_at: "2026-07-01T08:00:00Z",
    source: "guardian",
  },
  {
    id: "2",
    student_id: "1",
    date: "2026-07-02",
    status: "sick",
    reported_at: "2026-07-01T08:00:00Z",
    source: "guardian",
  },
];

const noopSubmit = async () => undefined;
const noopRemove = async () => undefined;

const meta = {
  title: "components/parent/ChildCare",
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const SickNote: Story = {
  render: () => (
    <SickNoteModal onClose={() => undefined} onSubmit={noopSubmit} />
  ),
};

export const PickupTimeEmpty: Story = {
  render: () => (
    <PickupTimeModal
      reloadRequests={() => Promise.resolve([])}
      careExceptions={[]}
      careExceptionsLoaded={true}
      pickupChangeEnabled={true}
      onClose={() => undefined}
      onSubmit={noopSubmit}
      onRemove={noopRemove}
    />
  ),
};

export const PickupTimeWithExistingOverride: Story = {
  render: () => (
    <PickupTimeModal
      reloadRequests={() => Promise.resolve([])}
      careExceptions={CARE_EXCEPTIONS}
      careExceptionsLoaded={true}
      pickupChangeEnabled={true}
      onClose={() => undefined}
      onSubmit={noopSubmit}
      onRemove={noopRemove}
    />
  ),
};

export const PickupTimeNotLoaded: Story = {
  render: () => (
    <PickupTimeModal
      reloadRequests={() => Promise.resolve([])}
      careExceptions={[]}
      careExceptionsLoaded={false}
      pickupChangeEnabled={true}
      onClose={() => undefined}
      onSubmit={noopSubmit}
      onRemove={noopRemove}
    />
  ),
};

export const StatusSummaryEmpty: Story = {
  render: () => <SickStatusSummary sickDays={[]} />,
};

export const StatusSummaryRange: Story = {
  render: () => <SickStatusSummary sickDays={SICK_DAYS} />,
};
