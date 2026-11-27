"use client";

import type { ReactNode } from "react";
import { IconTile } from "~/components/ui/icon-tile";
import { StatusBadge } from "~/components/ui/status-badge";

interface DatabaseDetailHeaderProps {
  icon: ReactNode;
  title: string;
  subtitle: string;
  /** Optional warning chip rendered between subtitle and actions. */
  warning?: string | null;
  actions?: ReactNode;
}

export function DatabaseDetailHeader({
  icon,
  title,
  subtitle,
  warning,
  actions,
}: DatabaseDetailHeaderProps) {
  return (
    <div className="flex items-center gap-4 px-6 py-5">
      <IconTile size="page" icon={icon} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-lg font-bold text-gray-900">{title}</div>
        <div className="mt-0.5 truncate text-sm text-gray-500">{subtitle}</div>
      </div>
      {warning ? <StatusBadge tone="warning" label={warning} wrap /> : null}
      {actions ? (
        <div className="flex items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
