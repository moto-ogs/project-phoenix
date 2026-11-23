"use client";

import type * as enrollmentContract from "~/lib/contract/enrollment.generated";
import { useRefreshPhaseExpiryWarnings } from "~/components/enrollment/phase-expiry-warnings";
import { MAX_SUPPORTED_GRADE_LEVEL } from "~/lib/grade-level";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useApiErrorDisplay, useToast } from "~/contexts/ToastContext";
import {
  decideRolloverReview,
  listRolloverReview,
} from "~/lib/enrollment-phase-api";
import { useConfirmedSWR } from "~/lib/hooks/use-confirmed-resource";
import { LOCATION_COLORS } from "~/lib/location-helper";
import { StatusColorBadge } from "~/components/ui/status-color-badge";
import { createLogger } from "~/lib/logger";
import { useRefreshAfterWrite } from "~/lib/hooks/use-refresh-after-write";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { enrollmentKeys } from "~/lib/swr/enrollment-keys";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { SectionCard } from "~/components/ui/section-card";
import { TenantPage } from "~/components/ui/tenant-page";

const logger = createLogger({ component: "RolloverReviewQueue" });

const REVIEW_REASON_LABELS: Record<string, string> = {
  grade_above_max: "Klassenstufe über der Höchstgrenze",
  no_grade_level: "Keine Klassenstufe hinterlegt",
  no_guardian: "Keine Erziehungsberechtigten hinterlegt",
};

interface Props {
  readonly phaseID: string;
  /** Erklärung hinter dem Info-Knopf am Seitentitel; die Seite liefert sie. */
  readonly info?: string;
}

const REVIEW_QUEUE_DESCRIPTION =
  "Kinder, die nicht automatisch übernommen werden konnten, meist weil ihre Klassenstufe nach Erhöhung über der Höchstgrenze liegt. Wähle pro Eintrag, ob du das Kind behältst (ggf. mit anderer Klassenstufe), aus der nächsten Phase entfernen oder vorerst zurückstellen.";

function gradeFieldName(childId: string): string {
  return `grade-${childId}`;
}

export function RolloverReviewQueue({ phaseID, info }: Props) {
  const refreshPhaseExpiryWarnings = useRefreshPhaseExpiryWarnings();
  const toast = useToast();
  const activePhase = useRef(phaseID);
  // Entries decided in this view; a reload that still lists one does not
  // bring it back.
  const completed = useRef(new Set<string>());
  const decision = useApiErrorDisplay();
  const [busyChild, setBusyChild] = useState<string | null>(null);
  const [classOverrides, setClassOverrides] = useState<Record<string, string>>(
    {},
  );

  const queue = useConfirmedSWR(enrollmentKeys.rolloverReview(phaseID), () =>
    listRolloverReview(phaseID),
  );
  const { mutate: mutateQueue, refused: accessRefused } = queue;
  useEffect(() => {
    if (!accessRefused) return;
    setClassOverrides({});
    setBusyChild(null);
  }, [accessRefused]);
  const listLoad = useSwrResourceLoadError(
    [{ data: queue.data ?? undefined, error: queue.failure }],
    "die Prüfliste",
    () => mutateQueue(),
  );
  const items = accessRefused
    ? []
    : (queue.data ?? []).filter(
        (item) => !completed.current.has(item.child_id),
      );
  // A failed first load stays loading until its error text is there, so the
  // empty list never shows in its place.
  const loading =
    (!queue.data && !listLoad.failure) ||
    (listLoad.failure !== undefined && listLoad.error === null);
  // Rejects on failure: after a decision the hook shows it as a reload of a
  // saved change and keeps the shown list (#6652).
  const afterDecide = useRefreshAfterWrite(
    "die Anzeige der Prüfliste",
    async () => {
      await mutateQueue(
        listRolloverReview(phaseID).then(
          (data) => {
            queue.readCallbacks.onSuccess();
            return data;
          },
          (error: unknown) => {
            queue.readCallbacks.onError(error);
            throw error;
          },
        ),
        { revalidate: false },
      );
    },
  );

  const { clear: clearAfterDecideError } = afterDecide;
  useLayoutEffect(() => {
    activePhase.current = phaseID;
    completed.current.clear();
    setClassOverrides({});
    setBusyChild(null);
    clearAfterDecideError();
  }, [phaseID, clearAfterDecideError]);

  const decide = async (
    item: enrollmentContract.ReviewItemResponse,
    choice: "keep" | "drop" | "defer",
  ) => {
    if (accessRefused || completed.current.has(item.child_id)) return;
    decision.clearFieldErrors();
    const overrideRaw = classOverrides[item.child_id]?.trim() ?? "";
    const overrideNumber =
      choice === "keep" && overrideRaw ? Number(overrideRaw) : undefined;
    if (
      choice === "keep" &&
      overrideRaw &&
      (!Number.isFinite(overrideNumber) || !Number.isInteger(overrideNumber))
    ) {
      // Lokale Prüfung: der Hinweis steht am Feld, der Fokus springt hin.
      decision.setFieldErrors({
        [gradeFieldName(item.child_id)]:
          "Bitte gib die Klassenstufe als ganze Zahl ein.",
      });
      return;
    }
    setBusyChild(item.child_id);
    try {
      await decideRolloverReview(item.child_id, {
        decision: choice,
        new_grade_level: overrideNumber ?? null,
      });
    } catch (err) {
      logger.error("review_queue_decide_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      await decision.show(err, {
        object: "die Entscheidung",
        retry: () => void latestDecide.current(item, choice),
      });
      if (activePhase.current === phaseID) setBusyChild(null);
      return;
    }
    if (activePhase.current === phaseID) {
      if (choice !== "defer") completed.current.add(item.child_id);
      void mutateQueue(
        (current) =>
          current?.filter((entry) => entry.child_id !== item.child_id),
        { revalidate: false },
      );
      setBusyChild(null);
    }
    toast.success(
      choice === "keep"
        ? "Das Kind wird in die nächste Phase übernommen."
        : choice === "drop"
          ? "Der Eintrag ist abgeschlossen."
          : "Der Eintrag ist zurückgestellt.",
    );
    refreshPhaseExpiryWarnings();
    await afterDecide.refresh();
  };
  // „Wiederholen“ sendet die Entscheidung mit der aktuellen Eingabe.
  const latestDecide = useRef(decide);
  useLayoutEffect(() => {
    latestDecide.current = decide;
  });

  if (loading) {
    // Der Titel ist statisch und steht deshalb schon während des Ladens.
    return (
      <TenantPage
        title="Prüfliste"
        info={info}
        back
        backHref="/enrollment-phases"
        backLabel="Zurück zu den Anmeldephasen"
        statsLoading
        loading
      />
    );
  }

  return (
    <TenantPage
      title="Prüfliste"
      info={info}
      back
      backHref="/enrollment-phases"
      backLabel="Zurück zu den Anmeldephasen"
      stats={
        listLoad.error || accessRefused
          ? undefined
          : `${items.length} ${items.length === 1 ? "offener Eintrag" : "offene Einträge"}`
      }
      // Ein Ladefehler steht an Stelle der Liste, nie ein Leerzustand.
      error={listLoad.error ?? (accessRefused ? afterDecide.error : null)}
      empty={
        items.length === 0 && !accessRefused && !afterDecide.error
          ? {
              title: "Keine offenen Einträge",
              description:
                "Alle Anmeldungen wurden entweder übernommen oder bereits entschieden.",
            }
          : null
      }
    >
      <LoadErrorAlert error={afterDecide.error} className="mb-4" />
      {/* Der Erklärsatz steht auf einer Fläche, nicht frei auf dem Grund. */}
      <SectionCard className="px-5 py-3">
        <p className="text-sm leading-6 text-gray-600">
          {REVIEW_QUEUE_DESCRIPTION}
        </p>
      </SectionCard>

      {items.length === 0 ? null : (
        <ul className="space-y-3">
          {items.map((item) => {
            const reasonLabel =
              item.review_reason && REVIEW_REASON_LABELS[item.review_reason]
                ? REVIEW_REASON_LABELS[item.review_reason]
                : item.review_reason;
            const busy = busyChild === item.child_id;
            const overrideValue = classOverrides[item.child_id] ?? "";
            return (
              <li key={item.child_id}>
                <SectionCard>
                  {/* Titel links, Entscheidungen rechts: die drei Aktionen
                    hatten vorher eine eigene Zeile am Fuß des Eintrags. */}
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold text-gray-900">
                        {item.first_name} {item.last_name}
                      </h3>
                      <p className="text-xs text-gray-600">
                        {item.guardian_first_name} {item.guardian_last_name} ·{" "}
                        {item.guardian_email}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">
                        Vorgemerkt: Klasse {item.target_grade_level ?? "–"}
                        {item.source_grade_level && (
                          <> (vorher: Klasse {item.source_grade_level})</>
                        )}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="md"
                        variant="success"
                        onClick={() => void decide(item, "keep")}
                        disabled={busy}
                        tooltip="Merkt das Kind für die neue Phase vor, ohne E-Mail an die Eltern."
                      >
                        Behalten
                      </Button>
                      <Button
                        type="button"
                        size="md"
                        variant="outline_danger"
                        onClick={() => void decide(item, "drop")}
                        disabled={busy}
                        tooltip="Nimmt das Kind sofort aus der neuen Phase, ohne E-Mail an die Eltern."
                      >
                        Abschließen
                      </Button>
                      <Button
                        type="button"
                        size="md"
                        variant="outline"
                        onClick={() => void decide(item, "defer")}
                        disabled={busy}
                        tooltip="Schiebt die Entscheidung auf, das Kind bleibt in der Prüfliste."
                      >
                        Zurückstellen
                      </Button>
                    </div>
                  </div>

                  {reasonLabel && (
                    <div className="mt-3">
                      <StatusColorBadge
                        color={LOCATION_COLORS.WARNING}
                        wrap
                        label={reasonLabel}
                      />
                    </div>
                  )}

                  <div className="mt-4 max-w-xs">
                    <Input
                      id={`grade-${item.child_id}`}
                      label="Klassenstufe für nächste Phase (optional)"
                      name={gradeFieldName(item.child_id)}
                      error={decision.fieldError(gradeFieldName(item.child_id))}
                      type="number"
                      controlSize="compact"
                      min={1}
                      max={MAX_SUPPORTED_GRADE_LEVEL}
                      value={overrideValue}
                      onChange={(e) =>
                        setClassOverrides((prev) => ({
                          ...prev,
                          [item.child_id]: e.target.value,
                        }))
                      }
                      placeholder={
                        item.target_grade_level
                          ? String(item.target_grade_level)
                          : ""
                      }
                      className="max-w-24"
                      disabled={busy}
                    />
                  </div>
                </SectionCard>
              </li>
            );
          })}
        </ul>
      )}
    </TenantPage>
  );
}
