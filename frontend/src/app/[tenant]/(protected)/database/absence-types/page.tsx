"use client";

// Abwesenheitsarten der Schule (#2403) als eigene Route der Datenverwaltung
// (#3114). Anlegen, Umbenennen und Abschalten lagen vorher in den Zeilen des
// Auswahlfelds „Art der Abwesenheit", das aus zwei Dialogen der Zeiterfassung
// aufging. Das Feld ist jetzt reine Auswahl und verlinkt hierher.

import { isAccessRefusal } from "~/lib/access-refusal";
import { Suspense, useCallback, useLayoutEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";

import {
  CatalogPage,
  CATALOG_SELECTION_PARAM,
  type CatalogConfig,
} from "~/components/database/catalog/catalog-page";
import { ModuleRouteGuard } from "~/components/tenant/module-route-guard";
import { absenceTypeService, type AbsenceType } from "~/lib/absence-type-api";
import {
  CARRYOVER_OPTIONS,
  carryoverRuleLabel,
  formatDayCount,
} from "~/lib/absence-helpers";
import { DataField, DataGrid } from "~/components/ui/data-field";
import { InsetPanel } from "~/components/ui/inset-panel";
import type { SectionConfig } from "~/lib/database/types";
import { formatCount } from "~/lib/format-utils";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import { STALE_DATA_SUFFIX } from "~/lib/hooks/use-refresh-after-write";
import { ApiError } from "~/lib/api-error";
import { useDiscardRefusedEntity } from "~/lib/swr/hooks";
import { useSWRAuth, useTenantMutate } from "~/lib/swr";
import { tenantAdminKeys } from "~/lib/swr/tenant-admin-keys";
import { timeTrackingConcept } from "~/lib/concepts/timeTracking";
import { TenantPageStats } from "~/components/ui/tenant-page";

const CACHE_KEY = tenantAdminKeys.absenceTypes();

// Ein per API gesetzter Tag, der kein Monatsende ist, bleibt wählbar.
function carryoverOptions(type: AbsenceType | null) {
  const current = type?.carryoverUntil;
  if (
    !current ||
    CARRYOVER_OPTIONS.some((option) => option.value === current)
  ) {
    return [...CARRYOVER_OPTIONS];
  }
  const [month, day] = current.split("-");
  return [
    ...CARRYOVER_OPTIONS,
    { value: current, label: `Bis ${day}.${month}. des Folgejahres` },
  ];
}

// Was der Träger an seiner Art festlegt (#4710), als Anzeige im Formular.
// `componentProps` bringt die Art; das Formular kennt nur Feldwerte.
function TraegerKeptSummary({
  absenceType: type,
}: {
  readonly absenceType?: AbsenceType;
  readonly value: unknown;
}) {
  if (!type) return null;
  return (
    <InsetPanel tone="muted" padding="md" className="space-y-2">
      <DataGrid columns={2}>
        <DataField label="Kontingent">
          {type.allowanceEnabled
            ? "Je Person über alle Schulen"
            : "Ohne Kontingent"}
        </DataField>
        <DataField label="Verfall">
          {type.allowanceEnabled
            ? carryoverRuleLabel(type.carryoverUntil)
            : "–"}
        </DataField>
        <DataField label="Beantragen">
          {type.requestable
            ? "Mitarbeitende beantragen"
            : "Nur die Leitung trägt ein"}
        </DataField>
      </DataGrid>
      <p className="text-xs text-gray-600">
        Name, Kontingent und Verfall legt dein Träger fest. Die Tage je Person
        stehen in der Personalakte beim Träger.
      </p>
    </InsetPanel>
  );
}

function traegerSections(type: AbsenceType): SectionConfig[] {
  return [
    {
      title: "Vom Träger",
      fields: [
        {
          name: "kept",
          label: "Vom Träger",
          type: "custom",
          colSpan: 2,
          component: TraegerKeptSummary,
          componentProps: { absenceType: type },
        },
      ],
    },
    ...(type.allowanceEnabled
      ? [
          {
            title: "An dieser Schule",
            fields: [
              {
                name: "schoolLimitDays",
                label: "Höchstens Tage je Person und Jahr an dieser Schule",
                type: "number" as const,
                colSpan: 2 as const,
                min: 0,
                max: 366,
                placeholder: "Kein eigener Wert",
                helperText:
                  "Gilt nur für Einsätze an dieser Schule. Leer: Es gilt nur das Kontingent des Trägers. Mehr als dort erlaubt keine Schule.",
              },
            ],
          },
        ]
      : []),
  ];
}

function sections(type: AbsenceType | null): SectionConfig[] {
  if (type?.keptByTraeger) return traegerSections(type);
  return [
    {
      title: "Abwesenheitsart",
      fields: [
        {
          name: "name",
          label: "Name",
          type: "text",
          required: true,
          placeholder: "z. B. Regenerationstag",
          maxLength: 100,
        },
        {
          name: "allowanceEnabled",
          label: "Tage je Person zählen (Kontingent)",
          type: "checkbox",
          colSpan: 2,
          helperText:
            "Die Tage je Person trägst du unter Mitarbeitende im Reiter Abwesenheiten ein. Mehr als dort steht, lässt sich nicht eintragen.",
        },
        {
          name: "carryoverUntil",
          label: "Rest verfällt",
          type: "select",
          colSpan: 2,
          options: carryoverOptions(type),
          helperText:
            "Gilt nur mit Kontingent. Bis zu diesem Tag gehen Tage im neuen Jahr zuerst vom Rest des Vorjahres ab. Danach ist der Rest verfallen.",
        },
        {
          name: "requestable",
          label: "Mitarbeitende dürfen beantragen",
          type: "checkbox",
          colSpan: 2,
          helperText:
            "Der Antrag geht an die Leitung. Sie gibt frei oder lehnt ab.",
        },
      ],
    },
  ];
}

function schoolLimitOf(raw: unknown): number | null {
  const text = String(raw ?? "")
    .trim()
    .replace(",", ".");
  return text === "" ? null : Number(text);
}

function rowSubtitle(type: AbsenceType): string {
  if (type.keptByTraeger) {
    if (!type.isActive) return "Vom Träger · beim Träger ausgeschaltet";
    if (!type.offered) return "Vom Träger · an dieser Schule nicht angeboten";
    return type.schoolLimitDays !== null
      ? `Vom Träger · hier höchstens ${formatDayCount(type.schoolLimitDays)}`
      : "Vom Träger · Kontingent über alle Schulen";
  }
  const base = type.allowanceEnabled
    ? `Mit Kontingent · ${carryoverRuleLabel(type.carryoverUntil)}`
    : "Ohne Kontingent";
  return type.requestable ? `${base} · beantragbar` : base;
}

const config: CatalogConfig<AbsenceType> = {
  concept: timeTrackingConcept,
  title: "Abwesenheitsarten",
  singular: "Abwesenheitsart",
  purpose:
    "Eigene Arten wie Regenerationstag, zusätzlich zu Urlaub, Krank, Fortbildung, Sonstige und Freizeitausgleich. Arten mit „Vom Träger“ legt dein Träger fest; deine Schule darf nur für ihre Einsätze abweichen.",
  searchPlaceholder: "Abwesenheitsart suchen…",
  emptyDescription:
    "Lege eine eigene Art an, zum Beispiel Regenerationstag oder Krank-Urlaubstag. Urlaub, Krank, Fortbildung, Sonstige und Freizeitausgleich gibt es immer.",
  stats: (types) => {
    const inactive = types.filter(
      (type) => !type.isActive || !type.offered,
    ).length;
    const active = types.length - inactive;
    const fromTraeger = types.filter((type) => type.keptByTraeger).length;
    const items: { value: string; label: string }[] =
      inactive > 0
        ? [
            { value: formatCount(active), label: "in der Auswahl" },
            { value: formatCount(inactive), label: "ausgeschaltet" },
          ]
        : [
            {
              value: formatCount(active),
              label: active === 1 ? "Art" : "Arten",
            },
          ];
    // Arten des Trägers (#4710) zählen mit, aber erkennbar.
    if (fromTraeger > 0) {
      items.push({ value: formatCount(fromTraeger), label: "vom Träger" });
    }
    const [only] = items;
    if (items.length === 1 && only) return `${only.value} ${only.label}`;
    return <TenantPageStats items={items} />;
  },
  toRow: (type) => ({
    name: type.name,
    subtitle: rowSubtitle(type),
    retired: !type.isActive || !type.offered,
  }),
  sections,
  toFormValues: (type) =>
    type.keptByTraeger
      ? { schoolLimitDays: type.schoolLimitDays ?? "" }
      : {
          name: type.name,
          allowanceEnabled: type.allowanceEnabled,
          carryoverUntil: type.carryoverUntil ?? "",
          requestable: type.requestable,
        },
  createDefaults: {
    name: "",
    allowanceEnabled: false,
    carryoverUntil: "",
    requestable: false,
  },
  // Der POST nimmt die vollständige Konfiguration an und speichert sie in
  // einem Vorgang. Ein fehlgeschlagener Nachtrag kann so keinen Eintrag mit
  // unvollständigem Kontingent zurücklassen.
  create: async (values) => {
    return absenceTypeService.createAbsenceType(
      String(values.name ?? "").trim(),
      {
        allowanceEnabled: Boolean(values.allowanceEnabled),
        carryoverUntil: String(values.carryoverUntil ?? "") || null,
        requestable: Boolean(values.requestable),
      },
    );
  },
  // Eine Art des Trägers ändert die Schule nur in ihrer Abweichung (#4710).
  update: (type, values) =>
    type.keptByTraeger
      ? absenceTypeService.updateAbsenceType(type.id, {
          schoolLimitDays: schoolLimitOf(values.schoolLimitDays),
        })
      : absenceTypeService.updateAbsenceType(type.id, {
          name: String(values.name ?? type.name).trim(),
          allowanceEnabled: Boolean(values.allowanceEnabled),
          carryoverUntil: String(values.carryoverUntil ?? "") || null,
          requestable: Boolean(values.requestable),
        }),
  retire: {
    menuLabel: "Nicht mehr anbieten",
    confirmTitle: "Abwesenheitsart nicht mehr anbieten?",
    confirmLabel: "Nicht mehr anbieten",
    loadingLabel: "Wird aus der Auswahl genommen …",
    describe: (type) =>
      type.keptByTraeger
        ? `„${type.name}“ ist eine Art deines Trägers. Deine Schule bietet sie dann nicht mehr an, andere Schulen schon. Eingetragene Abwesenheiten behalten den Namen.`
        : `„${type.name}“ steht bei neuen Abwesenheiten nicht mehr zur Auswahl. Bereits eingetragene Abwesenheiten behalten den Namen.`,
    run: (type) =>
      absenceTypeService.updateAbsenceType(
        type.id,
        type.keptByTraeger ? { offered: false } : { isActive: false },
      ),
    toast: (type) =>
      `Die Abwesenheitsart „${type.name}“ wird nicht mehr angeboten.`,
  },
  restore: {
    menuLabel: "Wieder anbieten",
    run: (type) =>
      absenceTypeService.updateAbsenceType(
        type.id,
        type.keptByTraeger ? { offered: true } : { isActive: true },
      ),
    toast: (type) =>
      `Die Abwesenheitsart „${type.name}“ wird wieder angeboten.`,
  },
};

function AbsenceTypesPageContent() {
  const searchParams = useSearchParams();
  const tenantMutate = useTenantMutate();

  const discardRefused = useDiscardRefusedEntity();
  const {
    data: cachedData,
    isLoading,
    error: swrError,
    mutate,
  } = useSWRAuth<AbsenceType[]>(CACHE_KEY, () =>
    absenceTypeService.getAbsenceTypes(),
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
  // Ladefehler mit Katalogtext und Wiederholen statt eines eigenen Satzes
  // (#2517).
  const loadError = useSwrLoadError(
    swrError,
    "die Liste der Abwesenheitsarten",
    () => mutate(),
    data === undefined ? undefined : STALE_DATA_SUFFIX,
  );

  const onChanged = useCallback(() => tenantMutate(CACHE_KEY), [tenantMutate]);

  const items = useMemo(
    () =>
      data
        ? [...data].sort((a, b) => a.name.localeCompare(b.name, "de"))
        : undefined,
    [data],
  );

  return (
    <CatalogPage
      config={config}
      items={items}
      // Bis der Katalogtext des Ladefehlers da ist, bleibt das Skelett
      // stehen: sonst blitzt der Leerzustand auf.
      isLoading={
        (isLoading && data === undefined) ||
        (swrError !== undefined && loadError === null)
      }
      error={loadError}
      onChanged={onChanged}
      // Die Route liegt hinter time_tracking:manage (database/layout).
      canManage
      selectedId={searchParams.get(CATALOG_SELECTION_PARAM)}
    />
  );
}

export default function AbsenceTypesPage() {
  return (
    <ModuleRouteGuard module="zeiterfassung" title="Abwesenheitsarten">
      <Suspense fallback={null}>
        <AbsenceTypesPageContent />
      </Suspense>
    </ModuleRouteGuard>
  );
}
