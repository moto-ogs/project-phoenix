"use client";

// Planungsspuren als eigene Route der Datenverwaltung (#3114). Anlegen,
// Umbenennen, Umsortieren und Archivieren lagen vorher in einem Popover, das
// aus dem Auswahlfeld „Planungsspur" im Termin-Formular aufging — eine
// Verwaltungsoberfläche in einem Auswahlfeld. Das Feld ist jetzt reine
// Auswahl und verlinkt hierher.

import { isAccessRefusal } from "~/lib/access-refusal";
import { Suspense, useCallback, useLayoutEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";

import {
  CatalogPage,
  CATALOG_SELECTION_PARAM,
  type CatalogConfig,
} from "~/components/database/catalog/catalog-page";
import { PlanningDisabledState } from "~/components/planning/planning-disabled-state";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import { STALE_DATA_SUFFIX } from "~/lib/hooks/use-refresh-after-write";
import { CatalogColorField } from "~/components/database/catalog-color-field";
import type { SectionConfig } from "~/lib/database/types";
import { formatCount } from "~/lib/format-utils";
import { LOCATION_COLORS } from "~/lib/location-helper";
import {
  planningTrackService,
  type PlanningTrack,
} from "~/lib/planning-track-api";
import { ApiError } from "~/lib/api-error";
import { useDiscardRefusedEntity } from "~/lib/swr/hooks";
import { useSWRAuth, useTenantMutate } from "~/lib/swr";
import { tenantAdminKeys } from "~/lib/swr/tenant-admin-keys";
import { useTimetableEnabled } from "~/lib/tenant-context";
import { carePlanConcept } from "~/lib/concepts/carePlan";
import { TenantPageStats } from "~/components/ui/tenant-page";

/** Info-Knopf am Titel: wofür die Seite da ist und was man zuerst tut. */
const PLANNING_TRACKS_INFO =
  "Hier legst du Planungsspuren an, zum Beispiel eine je Jahrgang. Jede Planungsspur hat eine Farbe. Im Betreuungsplan erkennst du daran, zu welcher Planungsspur ein Regeltermin gehört.";

const CACHE_KEY = tenantAdminKeys.planningTracks();
const DEFAULT_COLOR: string = LOCATION_COLORS.OTHER_ROOM;

function sections(): SectionConfig[] {
  return [
    {
      title: "Planungsspur",
      fields: [
        {
          name: "name",
          label: "Name",
          type: "text",
          required: true,
          placeholder: "z. B. Jahrgang 1",
          maxLength: 100,
        },
        {
          name: "color",
          label: "Farbe",
          type: "custom",
          component: CatalogColorField,
          componentProps: {
            defaultHex: DEFAULT_COLOR,
            hint: "Die Farbe kennzeichnet die Spur im Betreuungsplan.",
          },
        },
      ],
    },
  ];
}

/** Statuszeile der Kopfkarte aus den bereits geladenen Planungsspuren. */
function planningTrackStats(tracks: readonly PlanningTrack[]) {
  const archived = tracks.filter((track) => track.archivedAt).length;
  const active = tracks.length - archived;
  return archived > 0 ? (
    <TenantPageStats
      items={[
        { value: formatCount(active), label: "in der Auswahl" },
        { value: formatCount(archived), label: "archiviert" },
      ]}
    />
  ) : (
    `${formatCount(active)} ${active === 1 ? "Planungsspur" : "Planungsspuren"}`
  );
}

function PlanningTracksPageContent() {
  const searchParams = useSearchParams();
  const tenantMutate = useTenantMutate();
  const timetableEnabled = useTimetableEnabled();

  const discardRefused = useDiscardRefusedEntity();
  const {
    data: cachedData,
    isLoading,
    error: swrError,
    mutate,
  } = useSWRAuth<PlanningTrack[]>(timetableEnabled ? CACHE_KEY : null, () =>
    planningTrackService.list(),
  );
  const accessRefused =
    swrError instanceof ApiError && isAccessRefusal(swrError);
  const data = accessRefused ? undefined : cachedData;
  useLayoutEffect(() => {
    if (!accessRefused) return;
    discardRefused(swrError, {
      codes: [swrError.code ?? "general.permission"],
      matches: (key) => key === CACHE_KEY,
      refusedKey: CACHE_KEY,
    });
  }, [accessRefused, swrError, discardRefused]);
  // Ladefehler mit Katalogtext statt eines eigenen Satzes (#2516).
  const loadError = useSwrLoadError(
    swrError,
    "die Liste der Planungsspuren",
    () => mutate(),
    data === undefined ? undefined : STALE_DATA_SUFFIX,
  );

  const onChanged = useCallback(() => tenantMutate(CACHE_KEY), [tenantMutate]);

  // Die Liste kommt bereits in Sortierreihenfolge; die Pfeile in der Sammlung
  // schreiben genau diese Folge zurück.
  const items = useMemo(
    () =>
      data ? [...data].sort((a, b) => a.sortOrder - b.sortOrder) : undefined,
    [data],
  );

  // Der Sortierwert eines neuen Eintrags hängt am aktuellen Bestand, deshalb
  // wird die Konfiguration hier gebaut und nicht im Modul.
  const config = useMemo<CatalogConfig<PlanningTrack>>(() => {
    const nextSortOrder =
      (items ?? [])
        .filter((track) => !track.archivedAt)
        .reduce((highest, track) => Math.max(highest, track.sortOrder), -1) + 1;

    return {
      concept: carePlanConcept,
      title: "Planungsspuren",
      singular: "Planungsspur",
      purpose:
        "Planungsspuren bündeln Regeltermine farblich, zum Beispiel nach Jahrgang.",
      searchPlaceholder: "Planungsspur suchen…",
      emptyDescription:
        "Lege eine Planungsspur an, um Regeltermine im Betreuungsplan farblich zu bündeln.",
      stats: planningTrackStats,
      toRow: (track) => ({
        name: track.name,
        color: track.color,
        retired: Boolean(track.archivedAt),
      }),
      sections,
      toFormValues: (track) => ({ name: track.name, color: track.color }),
      createDefaults: { name: "", color: DEFAULT_COLOR },
      // Neue Spuren folgen der bekannten aktiven Reihenfolge. Vor dem Laden
      // wäre ihre Position geraten und könnte mit einem Bestandseintrag
      // kollidieren.
      createDisabled: items === undefined,
      create: (values) =>
        planningTrackService.create({
          name: String(values.name ?? "").trim(),
          color:
            typeof values.color === "string" ? values.color : DEFAULT_COLOR,
          sort_order: nextSortOrder,
        }),
      update: (track, values) =>
        planningTrackService.update(track.id, {
          name: String(values.name ?? "").trim(),
          color:
            typeof values.color === "string" ? values.color : DEFAULT_COLOR,
          sort_order: track.sortOrder,
        }),
      reorder: (orderedIds) => planningTrackService.reorder(orderedIds),
      retire: {
        menuLabel: "Archivieren",
        confirmTitle: "Planungsspur archivieren?",
        confirmLabel: "Archivieren",
        loadingLabel: "Wird archiviert …",
        describe: (track) =>
          `Die Planungsspur „${track.name}“ wird für neue Termine nicht mehr angeboten. Bestehende Termine behalten sie. Du kannst die Spur jederzeit wiederherstellen.`,
        run: (track) => planningTrackService.archive(track.id),
        toast: (track) => `Die Planungsspur „${track.name}“ ist archiviert.`,
      },
      restore: {
        menuLabel: "Wieder anbieten",
        run: (track) => planningTrackService.restore(track.id),
        toast: (track) =>
          `Die Planungsspur „${track.name}“ wird wieder angeboten.`,
      },
    };
  }, [items]);

  if (!timetableEnabled) {
    return (
      <PlanningDisabledState
        pageTitle="Planungsspuren"
        info={PLANNING_TRACKS_INFO}
        heading="Planungsspuren sind nicht verfügbar"
        description="Der Betreuungsplan ist für diese Schule ausgeschaltet."
        testId="planning-tracks-disabled-state"
      />
    );
  }

  return (
    <CatalogPage
      info={PLANNING_TRACKS_INFO}
      config={config}
      items={items}
      // Bis der Katalogtext des Ladefehlers da ist, bleibt das Skelett
      // stehen: sonst blitzt „Noch keine Planungsspuren“ auf.
      isLoading={
        (isLoading && data === undefined) ||
        (swrError !== undefined && loadError === null)
      }
      error={loadError}
      onChanged={onChanged}
      // Die Route liegt hinter schedules:manage (database/layout).
      canManage
      selectedId={searchParams.get(CATALOG_SELECTION_PARAM)}
    />
  );
}

export default function PlanningTracksPage() {
  return (
    <Suspense fallback={null}>
      <PlanningTracksPageContent />
    </Suspense>
  );
}
