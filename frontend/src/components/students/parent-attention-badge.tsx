"use client";

import { createContext, useContext, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { NotificationBadge } from "~/components/ui/notification-badge";
import { COUNTER_TONE } from "~/lib/counter-tones";
import { useParentAttentionOverlay } from "~/lib/parent-attention-overlay";
import { useTenantRouter } from "~/lib/tenant-router";
import type { ParentAttention } from "~/lib/parent-attention";
import {
  useParentAttentionEnabled,
  useParentAttentionMap,
} from "~/lib/hooks/use-parent-attention";

const ParentAttentionCounts = createContext<ReadonlyMap<
  string,
  ParentAttention
> | null>(null);

/** One authorized reader per rendered card list, not one SWR tree per child. */
export function ParentAttentionList({
  children,
}: {
  readonly children: ReactNode;
}) {
  const enabled = useParentAttentionEnabled();
  return enabled ? (
    <ParentAttentionReader>{children}</ParentAttentionReader>
  ) : (
    children
  );
}

function ParentAttentionReader({ children }: { readonly children: ReactNode }) {
  const attention = useParentAttentionMap();
  return (
    <ParentAttentionCounts value={attention}>{children}</ParentAttentionCounts>
  );
}

/**
 * Die Zahlen eines Kindes aus dem Abruf der umgebenden `ParentAttentionList`,
 * oder null ohne neue Nachrichten und Anfragen (App-Listen, #8070).
 */
export function useListedParentAttention(
  studentId: string,
): ParentAttention | null {
  const attention = useContext(ParentAttentionCounts)?.get(studentId);
  return attention && attention.total > 0 ? attention : null;
}

/** Vorlesetext der Zahl: was neu ist, für welches Kind. */
export function parentAttentionLabel(
  attention: ParentAttention,
  studentName: string,
): string {
  const parts: string[] = [];
  if (attention.messages > 0) {
    parts.push(
      attention.messages === 1
        ? "1 neue Nachricht"
        : `${attention.messages} neue Nachrichten`,
    );
  }
  if (attention.requests > 0) {
    parts.push(
      attention.requests === 1
        ? "1 offene Anfrage"
        : `${attention.requests} offene Anfragen`,
    );
  }
  return `${parts.join(" und ")} der Eltern von ${studentName} öffnen`;
}

/**
 * Blaue Zahl oben rechts an der Kinderkachel (#6486): neue Nachrichten und
 * offene Anfragen der Eltern. Ein Tipp öffnet sie, ohne die Kachel zu
 * verlassen. Ohne Neues zeigt sie nichts.
 */
type ParentAttentionBadgeProps = Readonly<{
  studentId: string;
  studentName: string;
  className?: string;
}>;

export function ParentAttentionBadge(props: ParentAttentionBadgeProps) {
  const attention = useContext(ParentAttentionCounts)?.get(props.studentId);
  return attention && attention.total > 0 ? (
    <ParentAttentionButton {...props} attention={attention} />
  ) : null;
}

function ParentAttentionButton({
  studentId,
  studentName,
  className,
  attention,
}: ParentAttentionBadgeProps & { readonly attention: ParentAttention }) {
  const { select } = useParentAttentionOverlay();
  const router = useTenantRouter();

  return (
    <Button
      type="button"
      variant="count_badge"
      size="icon"
      className={className}
      tooltip="Öffnet neue Nachrichten und offene Anfragen der Eltern."
      data-parent-attention={attention.total}
      onClick={() => {
        select({ studentId, studentName, attention });
        router.push(
          `/parent-attention/${encodeURIComponent(studentId)}${window.location.search}`,
          { scroll: false },
        );
      }}
    >
      <NotificationBadge
        count={attention.total}
        tone={COUNTER_TONE.parents}
        // The visible number leads the name, the sentence follows hidden
        // (WCAG 2.5.3, #7112).
        ariaLabel={`${attention.total}: ${parentAttentionLabel(attention, studentName)}`}
      />
    </Button>
  );
}

/** Sichtbarer Text der Zahl: „1 neue Nachricht und 1 offene Anfrage“. */
function parentAttentionText(attention: ParentAttention): string {
  const parts: string[] = [];
  if (attention.messages > 0) {
    parts.push(
      attention.messages === 1
        ? "1 neue Nachricht"
        : `${attention.messages} neue Nachrichten`,
    );
  }
  if (attention.requests > 0) {
    parts.push(
      attention.requests === 1
        ? "1 offene Anfrage"
        : `${attention.requests} offene Anfragen`,
    );
  }
  return parts.join(" und ");
}

/**
 * Dieselbe Zahl als beschrifteter Knopf im Kind-Blatt (#8070): Die
 * Kinderliste am Handy hat keine Kachel, an deren Ecke die Zahl tippbar
 * stünde; die Zeile zeigt sie nur an, das Blatt öffnet sie.
 */
export function ParentAttentionSheetButton({
  studentId,
  studentName,
}: Readonly<{ studentId: string; studentName: string }>) {
  const attention = useListedParentAttention(studentId);
  const { select } = useParentAttentionOverlay();
  const router = useTenantRouter();
  if (!attention) return null;
  return (
    <Button
      type="button"
      variant="outline"
      size="md"
      className="w-full justify-between gap-2"
      tooltip="Öffnet neue Nachrichten und offene Anfragen der Eltern."
      onClick={() => {
        select({ studentId, studentName, attention });
        router.push(
          `/parent-attention/${encodeURIComponent(studentId)}${window.location.search}`,
          { scroll: false },
        );
      }}
    >
      <span className="truncate">
        {parentAttentionText(attention)} der Eltern
      </span>
      <NotificationBadge
        count={attention.total}
        tone={COUNTER_TONE.parents}
        ariaLabel=""
      />
    </Button>
  );
}
