// Ein Lauf, der nichts abzurechnen hat oder verworfen ist (#6628), gleich für
// Ferienlauf, Monatslauf und Jahreslauf (#7406): was mit ihm ist, und darunter
// seine Eckdaten. Den Trennstrich zieht der Fuß der Karte.

import { ArchiveX, Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { DataField, DataGrid } from "~/components/ui/data-field";
import { EmptyState } from "~/components/ui/empty-state";
import { SectionCard } from "~/components/ui/section-card";
import { formatDate } from "~/lib/date-helpers";

export function EmptyRunCard({
  title,
  discarded,
  description,
  createdAt,
  discardedAt,
  children,
}: Readonly<{
  /** The kind of run: „Monatslauf“. */
  title: string;
  discarded: boolean;
  /** What the person can do now, for the discarded or the empty run. */
  description: string;
  createdAt: string;
  discardedAt?: string | null;
  /** The run's own facts (period, schools), before its dates. */
  children: ReactNode;
}>) {
  return (
    <SectionCard
      title={title}
      footer={
        <DataGrid columns={2}>
          {children}
          <DataField label="Gestartet am">{formatDate(createdAt)}</DataField>
          {discarded ? (
            <DataField label="Verworfen am">
              {discardedAt ? formatDate(discardedAt) : "–"}
            </DataField>
          ) : null}
        </DataGrid>
      }
    >
      <EmptyState
        tone="neutral"
        icon={
          discarded ? (
            <ArchiveX className="h-7 w-7" aria-hidden="true" />
          ) : (
            <Inbox className="h-7 w-7" aria-hidden="true" />
          )
        }
        title={
          discarded
            ? "Dieser Lauf ist verworfen"
            : "Dieser Lauf hat nichts abzurechnen"
        }
        description={description}
        className="py-6"
      />
    </SectionCard>
  );
}
