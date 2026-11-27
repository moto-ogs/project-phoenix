// Zähler-Plakette der Such- und Filterzeile von TenantPage
"use client";

import type React from "react";

interface BadgeDisplayProps {
  readonly count: number | string;
  readonly label?: string;
  readonly icon?: React.ReactNode;
  readonly showLabel?: boolean;
  readonly size?: "sm" | "md";
}

/**
 * Badge display component for counts with optional label and icon
 */
export function BadgeDisplay({
  count,
  label,
  icon,
  showLabel = true,
  size = "md",
}: BadgeDisplayProps) {
  const paddingClass =
    size === "sm" ? "px-2 py-1.5 gap-1.5" : "px-3 py-1.5 gap-2";

  return (
    <div
      className={`flex items-center rounded-full border border-gray-100 bg-gray-50 ${paddingClass}`}
    >
      {icon && <span className="text-gray-500">{icon}</span>}
      <span className="text-sm font-semibold text-gray-900">{count}</span>
      {showLabel && label && (
        <span className="hidden text-xs text-gray-500 md:inline">{label}</span>
      )}
    </div>
  );
}

/**
 * Compact badge for mobile views; a label only when the page passes one.
 * With a label the word names the count, so the icon steps aside and the
 * search field keeps its width.
 */
export function BadgeDisplayCompact({
  count,
  icon,
  label,
}: Readonly<{
  count: number | string;
  icon?: React.ReactNode;
  label?: string;
}>) {
  return (
    <div
      className={`flex items-center gap-1.5 rounded-full border border-gray-100 bg-gray-50 py-1.5 ${label ? "px-3" : "px-2"}`}
    >
      {icon && !label && <span className="text-gray-500">{icon}</span>}
      <span className="text-sm font-semibold text-gray-900">
        {count}
        {label ? (
          <span className="ml-1 font-normal text-gray-600">{label}</span>
        ) : null}
      </span>
    </div>
  );
}
