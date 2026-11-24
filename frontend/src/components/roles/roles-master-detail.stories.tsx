import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { Role } from "@/lib/auth-helpers";
import { RolesMasterDetail } from "./roles-master-detail";

const roles: Role[] = [
  {
    id: "1",
    name: "admin",
    description: "Voller Zugriff auf alle Bereiche.",
    isSystem: true,
    baseRole: "admin",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    permissionNames: ["students.read"],
  },
  {
    id: "2",
    name: "custom-role",
    description: "",
    isSystem: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    permissionNames: [],
  },
];

const meta: Meta<typeof RolesMasterDetail> = {
  title: "components/roles/RolesMasterDetail",
  component: RolesMasterDetail,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    roles,
    selectedId: null,
    selectedRole: null,
    detailLoading: false,
    onSelect: () => {},
    onSaveRole: async (_data, base) => base,
    onReloadRole: async () => roles[0]!,
    onDeleteClick: () => {},
    onPermissionsSaved: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof RolesMasterDetail>;

export const NoSelection: Story = {};

export const SystemRoleSelected: Story = {
  args: {
    selectedId: roles[0]?.id ?? null,
    selectedRole: roles[0] ?? null,
  },
};

export const CustomRoleSelected: Story = {
  args: {
    selectedId: roles[1]?.id ?? null,
    selectedRole: roles[1] ?? null,
  },
};

export const Loading: Story = {
  args: {
    selectedId: roles[0]?.id ?? null,
    selectedRole: roles[0] ?? null,
    detailLoading: true,
  },
};

export const Empty: Story = {
  args: {
    roles: [],
  },
};
