"use client";

import type { ReactNode } from "react";
import { Check, X } from "lucide-react";
import {
  BuildingsIcon,
  BusIcon,
  FileTextIcon,
  NotePencilIcon,
} from "@phosphor-icons/react";
import { MotoDuotoneIcon } from "~/components/ui/moto-duotone-icon";

// =============================================================================
// InfoText - Shared component for text-only info sections
// =============================================================================

interface InfoTextProps {
  readonly children: ReactNode;
}

/**
 * Text content for info sections that don't use a data grid.
 */
export function InfoText({ children }: InfoTextProps) {
  return (
    <p className="text-sm break-words whitespace-pre-wrap text-gray-700">
      {children}
    </p>
  );
}

// =============================================================================
// Common Icons - Shared SVG icons for detail modals
// =============================================================================

export const DetailIcons = {
  // Domain-flavored glyphs: self-colored via MotoDuotoneIcon.
  notes: <MotoDuotoneIcon icon={NotePencilIcon} tone="teal" size="100%" />,
  document: <MotoDuotoneIcon icon={FileTextIcon} tone="neutral" size="100%" />,
  building: <MotoDuotoneIcon icon={BuildingsIcon} tone="petrol" size="100%" />,
  bus: <MotoDuotoneIcon icon={BusIcon} tone="cyan" size="100%" />,
  // Generic UI feedback: plain Lucide icons inheriting currentColor, so
  // callers that tint them via a wrapping text-color class keep working.
  check: <Check className="h-full w-full" strokeWidth={2} />,
  x: <X className="h-full w-full" strokeWidth={2} />,
} as const;
