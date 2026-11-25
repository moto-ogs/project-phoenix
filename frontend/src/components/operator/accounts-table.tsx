"use client";

import { Button } from "~/components/ui/button";
import { useMemo } from "react";
import type {
  OrgAccount,
  School,
  SchoolAccount,
} from "~/lib/operator/provisioning-helpers";
import { DataTable } from "~/components/ui/data-table";
import type {
  DataTableColumn,
  DataTableMoreAction,
} from "~/components/ui/data-table";
import {
  StatusBadge,
  type StatusBadgeTone,
} from "~/components/ui/status-badge";
import { StatusColorBadge } from "~/components/ui/status-color-badge";
import type { AccountSort } from "~/lib/operator/account-pages";
import { LOCATION_COLORS } from "~/lib/location-helper";

type AccountRow = SchoolAccount | OrgAccount;

type AccountBadge =
  { label: string; tone: StatusBadgeTone } | { label: string; color: string };

function AccountBadgePill({ badge }: Readonly<{ badge: AccountBadge }>) {
  if ("color" in badge) {
    return <StatusColorBadge label={badge.label} color={badge.color} compact />;
  }
  return <StatusBadge tone={badge.tone} compact label={badge.label} />;
}

function getAccountCapabilityMeta(account: SchoolAccount): AccountBadge {
  if (account.isActiveCaregiver && account.hasAdminRole) {
    return {
      label: "Verwaltung + Betreuung",
      tone: "green",
    };
  }
  if (account.isActiveCaregiver) {
    return {
      label: "Betreuung aktiv",
      tone: "orange",
    };
  }
  if (account.hasUserRole && !account.hasCaregiverProfile) {
    return {
      label: "Betreuung unvollständig",
      color: LOCATION_COLORS.WARNING,
    };
  }
  if (account.hasCaregiverProfile && !account.hasUserRole) {
    return {
      label: "Betreuungsprofil inaktiv",
      tone: "gray",
    };
  }
  if (account.hasAdminRole) {
    return {
      label: "Nur Verwaltung",
      tone: "blue",
    };
  }
  return {
    label: "Keine Betreuung",
    tone: "gray",
  };
}

function AccountStatusBadge({ status }: Readonly<{ status: string }>) {
  const badges: Record<string, AccountBadge> = {
    active: { label: "Aktiv", tone: "green" },
    pending: { label: "Ausstehend", color: LOCATION_COLORS.WARNING },
    invited: { label: "Eingeladen", tone: "purple" },
    inactive: { label: "Inaktiv", tone: "gray" },
  };
  return (
    <AccountBadgePill
      badge={
        Object.hasOwn(badges, status)
          ? badges[status]!
          : { label: status, tone: "gray" }
      }
    />
  );
}

function getDisplayName(account: AccountRow): string {
  return account.firstName || account.lastName
    ? `${account.firstName} ${account.lastName}`.trim()
    : "–";
}

interface AccountsTableProps {
  accounts: AccountRow[];
  serverSort?: AccountSort & { onChange: (sort: AccountSort) => void };
  moreAction?: DataTableMoreAction;
  showSchool?: boolean;
  isLoading?: boolean;
  selectedSchool?: School | null;
  onManageCaregiver?: (
    account: AccountRow,
    schoolContext: { id: string; name: string } | null,
  ) => void;
  onManageMFA?: (
    account: AccountRow,
    schoolContext: { id: string; name: string } | null,
  ) => void;
  // Schulzugänge are account-scoped, not school-scoped — no school context.
  onManageTenantAccess?: (account: AccountRow) => void;
}

export function AccountsTable({
  accounts,
  serverSort,
  moreAction,
  showSchool = false,
  isLoading = false,
  selectedSchool,
  onManageCaregiver,
  onManageMFA,
  onManageTenantAccess,
}: Readonly<AccountsTableProps>) {
  const columns = useMemo<DataTableColumn<AccountRow>[]>(() => {
    const cols: DataTableColumn<AccountRow>[] = [];

    if (showSchool) {
      cols.push({
        key: "schoolName",
        header: "Schule",
        render: (row) => (row as OrgAccount).schoolName,
        serverSortable: true,
        className: "text-gray-600",
      });
    }

    cols.push(
      {
        key: "name",
        header: "Name",
        render: getDisplayName,
        serverSortable: true,
        className: "font-medium text-gray-900",
      },
      {
        key: "email",
        header: "E-Mail",
        render: (row) => row.email,
        serverSortable: true,
        className: "text-gray-600",
      },
      {
        key: "roleName",
        header: "Rolle",
        render: (row) =>
          row.roleName ? (
            <span className="inline-flex flex-wrap gap-1">
              {row.roleName.split(", ").map((role) => (
                <StatusBadge key={role} tone="blue" compact label={role} />
              ))}
            </span>
          ) : (
            <span className="text-gray-500">–</span>
          ),
        serverSortable: true,
      },
      {
        key: "pedagogicRole",
        header: "Päd. Rolle",
        render: (row) => row.pedagogicRole || "–",
        serverSortable: true,
        className: "text-gray-600",
      },
      {
        key: "capability",
        header: "Einsatz",
        render: (row) => (
          <AccountBadgePill badge={getAccountCapabilityMeta(row)} />
        ),
      },
      {
        key: "status",
        header: "Status",
        render: (row) => <AccountStatusBadge status={row.status} />,
        serverSortable: true,
      },
      {
        key: "actions",
        header: "Aktion",
        align: "right",
        render: (row) => {
          const orgAccount = showSchool ? (row as OrgAccount) : undefined;
          const schoolContext = showSchool
            ? orgAccount
              ? { id: orgAccount.schoolId, name: orgAccount.schoolName }
              : null
            : selectedSchool
              ? { id: selectedSchool.id, name: selectedSchool.name }
              : null;
          const isActionable =
            row.accountId !== "0" &&
            row.status !== "invited" &&
            schoolContext != null;
          const canManageCaregiver = isActionable && onManageCaregiver != null;
          const canManageMFA = isActionable && onManageMFA != null;
          // Managing school access needs no school context, so it stays
          // available even when the row has none.
          const canManageTenantAccess =
            row.accountId !== "0" &&
            row.status !== "invited" &&
            onManageTenantAccess != null;
          if (!canManageCaregiver && !canManageMFA && !canManageTenantAccess) {
            return <span className="text-xs text-gray-500">–</span>;
          }
          return (
            <div className="flex flex-wrap justify-end gap-2">
              {canManageCaregiver && (
                <Button
                  type="button"
                  variant="surface"
                  size="compact"
                  onClick={() => onManageCaregiver?.(row, schoolContext)}
                >
                  Betreuung verwalten
                </Button>
              )}
              {canManageMFA && (
                <Button
                  type="button"
                  variant="surface"
                  size="compact"
                  onClick={() => onManageMFA?.(row, schoolContext)}
                >
                  2FA verwalten
                </Button>
              )}
              {canManageTenantAccess && (
                <Button
                  type="button"
                  variant="surface"
                  size="compact"
                  onClick={() => onManageTenantAccess?.(row)}
                >
                  Schulzugänge
                </Button>
              )}
            </div>
          );
        },
      },
    );

    return cols;
  }, [
    showSchool,
    selectedSchool,
    onManageCaregiver,
    onManageMFA,
    onManageTenantAccess,
  ]);

  return (
    <DataTable
      columns={columns}
      rows={accounts}
      getRowKey={(row) => {
        const orgAccount = showSchool ? (row as OrgAccount) : undefined;
        return row.accountId !== "0"
          ? `${orgAccount?.schoolId ?? ""}-${row.accountId}`
          : `${orgAccount?.schoolId ?? ""}-invited-${row.invitationId ?? row.email}`;
      }}
      serverSort={serverSort}
      moreAction={moreAction}
      isLoading={isLoading}
    />
  );
}
