import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Users, UserRound } from "lucide-react";
import { Button } from "~/components/ui/button";
import { DatabaseDetailHeader } from "./database-detail-header";

const meta: Meta<typeof DatabaseDetailHeader> = {
  title: "database/DatabaseDetailHeader",
  component: DatabaseDetailHeader,
};

export default meta;
type Story = StoryObj<typeof DatabaseDetailHeader>;

export const Default: Story = {
  args: {
    icon: <UserRound />,
    title: "Max Mustermann",
    subtitle: "Lehrkraft",
  },
};

export const WithWarning: Story = {
  args: {
    icon: <Users />,
    title: "Gruppe A",
    subtitle: "12 Kinder",
    warning: "Kein aktiver Betreuer",
  },
};

export const WithActions: Story = {
  args: {
    icon: <UserRound />,
    title: "Erika Musterfrau",
    subtitle: "Erziehungsberechtigte",
    actions: (
      <Button type="button" size="sm">
        Bearbeiten
      </Button>
    ),
  },
};
