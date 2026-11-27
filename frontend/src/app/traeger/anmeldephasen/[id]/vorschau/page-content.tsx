"use client";

// Vorschau einer Anmeldephase des Trägers und „Freigeben und übertragen“
// (#4704, ADR 0195): erst hier ändert sich etwas in den Schulen.

import { useParams } from "next/navigation";
import { useState } from "react";
import {
  RolloutResultCard,
  SchoolPlanCard,
} from "~/components/traeger/catalog-preview";
import { useTraegerCatalogPhase } from "~/components/traeger/use-traeger-catalog";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { useTraegerSchools } from "~/components/traeger/use-traeger-schools";
import { Button, ButtonLink } from "~/components/ui/button";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { useApiErrorDisplay, useToast } from "~/contexts/ToastContext";
import { createLogger } from "~/lib/logger";
import { useInvalidateFamily } from "~/lib/swr";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import {
  type TraegerRollout,
  previewTraegerPhase,
  rolloutTraegerPhase,
} from "~/lib/traeger-catalog-api";
import { traegerPath } from "~/lib/traeger-url";

const logger = createLogger({ component: "TraegerCatalogPreviewPage" });

export default function TraegerCatalogPreviewPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { data: phase } = useTraegerCatalogPhase(id);
  const { schools, error: schoolsError } = useTraegerSchools();
  const {
    data: preview,
    loading: previewLoading,
    error: previewError,
    mutate,
    reloadOrThrow,
  } = useTraegerResource(
    id ? traegerKeys.catalogPhasePreview(id) : null,
    () => previewTraegerPhase(id),
    "die Vorschau",
  );
  const [rollout, setRollout] = useState<TraegerRollout | null>(null);
  const [recomputing, setRecomputing] = useState(false);
  const loading = previewLoading || recomputing;
  const [rollingOut, setRollingOut] = useState(false);
  const { show } = useApiErrorDisplay();
  const { success } = useToast();
  const invalidate = useInvalidateFamily();
  const phaseHref = traegerPath(`/traeger/anmeldephasen/${id}`);

  // A failure shows as the load error of the preview.
  const loadPreview = async () => {
    setRecomputing(true);
    try {
      await mutate();
    } finally {
      setRecomputing(false);
    }
  };
  // After a refusal: reads the preview again and rejects when that fails,
  // so the message says so (ADR 0311).
  const reloadPreview = async () => {
    setRecomputing(true);
    try {
      return await reloadOrThrow();
    } finally {
      setRecomputing(false);
    }
  };

  const release = async () => {
    if (!preview) return;
    setRollingOut(true);
    try {
      const result = await rolloutTraegerPhase(id, preview.fingerprint);
      setRollout(result);
      void invalidate(traegerKeys.catalogFamily);
      success("Freigegeben und übertragen.");
    } catch (err) {
      logger.error("traeger_catalog_rollout_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      // Etwas hat sich seit der Vorschau geändert: die neue Vorschau zeigt
      // es, bevor das Büro noch einmal freigibt.
      void show(err, { object: "die Anmeldephase", reload: reloadPreview });
    } finally {
      setRollingOut(false);
    }
  };

  const ready = preview?.schools.filter(
    (school) => school.outcome === "ready",
  ).length;

  return (
    <TenantPage
      title={phase ? `Vorschau: ${phase.draft.name}` : "Vorschau"}
      back
      backHref={phaseHref}
      backLabel="Zurück zur Anmeldephase"
      info="Die Vorschau zeigt pro Schule, was das Übertragen ändert. Erst mit „Freigeben und übertragen“ ändert sich etwas in den Schulen. Neue Preise gelten ab Monatsbeginn; ausgestellte Verträge und Rechnungen bleiben, wie sie sind."
      stats={
        preview && !rollout ? (
          <TenantPageStats
            items={[
              {
                value: preview.schools.length,
                label: preview.schools.length === 1 ? "Schule" : "Schulen",
              },
              {
                value: ready,
                label: ready === 1 ? "übernimmt" : "übernehmen",
              },
            ]}
          />
        ) : null
      }
      statsLoading={loading && !rollout}
      overflowMenu={
        rollout
          ? undefined
          : [
              {
                label: "Vorschau neu laden",
                description:
                  "Berechnet die Vorschau mit dem aktuellen Stand neu, ohne etwas zu ändern.",
                disabled: loading || rollingOut,
                onClick: () => void loadPreview(),
              },
            ]
      }
      actions={
        rollout ? (
          <ButtonLink
            href={phaseHref}
            variant="primary"
            size="md"
            tooltip="Öffnet die Anmeldephase mit dem neuen Stand."
          >
            Zur Anmeldephase
          </ButtonLink>
        ) : (
          <Button
            type="button"
            variant="success"
            size="md"
            onClick={() => void release()}
            disabled={!preview || loading || preview.schools.length === 0}
            disabledReason={
              preview && !loading && preview.schools.length === 0
                ? "Wähle zuerst in der Anmeldephase die Schulen aus."
                : undefined
            }
            tooltip="Überträgt die Anmeldephase sofort an die Schulen der Vorschau."
            isLoading={rollingOut}
            loadingText="Wird übertragen…"
          >
            Freigeben und übertragen
          </Button>
        )
      }
      error={previewError ?? schoolsError}
      loading={(loading && !preview && !rollout) || !schools}
      empty={
        schools && preview && !rollout && preview.schools.length === 0
          ? {
              title: "Keine Schule bekommt etwas.",
              description:
                "Wähle in der Anmeldephase bei „Schulen“ aus, wer sie bekommt.",
            }
          : null
      }
    >
      {schools && rollout ? (
        <RolloutResultCard rollout={rollout} schools={schools} />
      ) : null}
      {schools && preview && !rollout ? (
        // Equal school cards in a grid: grids do not grow (TenantPage body
        // rule), so the last school keeps its height like its siblings.
        <div className="compact:gap-4 grid gap-6 max-sm:gap-3">
          {preview.schools.map((plan) => (
            <SchoolPlanCard key={plan.schoolId} plan={plan} schools={schools} />
          ))}
        </div>
      ) : null}
    </TenantPage>
  );
}
