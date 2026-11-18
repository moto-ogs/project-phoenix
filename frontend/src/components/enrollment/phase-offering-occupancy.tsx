"use client";

// Freie Plätze je Angebot auf der Seite einer Anmeldephase (#4782). Dieselben
// Zahlen wie in der Angebotsliste. Die Zahlen sind nur zur Information: ein
// Ladefehler blendet den Abschnitt aus und blockiert nichts auf der Seite.

import { useMemo } from "react";
import { SectionCard } from "~/components/ui/section-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import {
  offeringCapacityColumn,
  offeringOccupancyColumn,
  offeringStatusColumn,
} from "~/components/enrollment/offering-occupancy";
import { type CareOffering, listCareOfferings } from "~/lib/care-offering-api";
import {
  type CareOfferingBookingStats,
  fetchCareOfferingBookingStats,
  totalFreePlaces,
} from "~/lib/care-offering-booking-stats";
import { useSWRAuth } from "~/lib/swr";
import { enrollmentKeys } from "~/lib/swr/enrollment-keys";

interface OccupancyData {
  offerings: CareOffering[];
  stats: Record<string, CareOfferingBookingStats>;
}

export function PhaseOfferingOccupancy({
  phaseId,
}: Readonly<{ phaseId: string }>) {
  // A load failure stays silent: SWR logs it, the page works without the
  // numbers, and the section shows nothing without them.
  const { data: offerings } = useSWRAuth(
    enrollmentKeys.careOfferings(phaseId),
    () => listCareOfferings(phaseId),
    { keepPreviousData: false },
  );
  const { data: stats } = useSWRAuth(
    enrollmentKeys.bookingStats(phaseId),
    () => fetchCareOfferingBookingStats(phaseId),
    { keepPreviousData: false },
  );
  const data: OccupancyData | null =
    offerings && stats ? { offerings, stats } : null;

  const columns = useMemo<DataTableColumn<CareOffering>[]>(() => {
    const shown = stats ?? {};
    return [
      {
        key: "name",
        header: "Betreuungsangebot",
        stacked: "title",
        sortValue: (offering) => offering.name,
        render: (offering) => (
          <span className="font-medium text-gray-900">{offering.name}</span>
        ),
      },
      offeringCapacityColumn(),
      offeringOccupancyColumn(shown),
      { ...offeringStatusColumn(shown), stacked: "meta" },
    ];
  }, [stats]);

  if (!data || data.offerings.length === 0) return null;

  const freePlaces = totalFreePlaces(data.offerings, data.stats);
  return (
    <SectionCard
      bare
      title="Freie Plätze je Angebot"
      titleBadge={
        freePlaces == null ? undefined : (
          <StatusBadge label={`${freePlaces} frei`} tone="gray" />
        )
      }
      description={
        "Hier siehst du Kapazität, Belegung, freie Plätze und Status je Angebot. „Belegt“ zählt die Kinder am vollsten Tag bis zum Ende der Phase. Anmeldungen prüfst du in der Liste darunter."
      }
    >
      <DataTable
        columns={columns}
        rows={data.offerings}
        getRowKey={(offering) => offering.id}
        stackedOnMobile
        defaultSortKey="name"
        defaultSortDirection="asc"
      />
    </SectionCard>
  );
}
