"use client";

import { bffFile } from "~/lib/bff-fetch";

// Vergabe nach Kriterien (#4700): moto sortiert die offenen Anmeldungen jeder
// Woche nach den Kriterien des Trägers vor, dann nach Eingang. Das ist nur
// ein Vorschlag. Das Büro entscheidet jede Anmeldung einzeln oder übernimmt
// den Vorschlag einer Woche oder aller Wochen; eine Abweichung braucht eine
// Begründung. Eltern bekommen nach der Entscheidung eine E-Mail. Danach
// gelten Warteliste und Nachrücken wie bisher.

import { CheckCircle2, ListChecks } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type AllocationDecisionTarget,
  HolidayAllocationDecisionModal,
  isStaleAllocationError,
} from "~/components/traeger/holiday-allocation-decision-modal";
import { HolidayAllocationHistory } from "~/components/traeger/holiday-allocation-history";
import {
  criterionLabel,
  openWeeks,
  proposalDecisions,
  proposalSummary,
  proposalSummaryText,
  rankingExplanation,
} from "~/components/traeger/holiday-allocation-model";
import { HolidayAllocationWeekCard } from "~/components/traeger/holiday-allocation-week";
import {
  HOLIDAY_CRITERIA_HINT,
  holidayPeriodTabs,
} from "~/components/traeger/holiday-period-head";
import { schoolNames } from "~/components/traeger/holiday-registration-format";
import {
  traegerExportScope,
  useTraegerListExportItems,
} from "~/components/traeger/traeger-list-export-menu";
import { useTraegerHolidayPeriod } from "~/components/traeger/use-traeger-resources";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { useTraegerSchools } from "~/components/traeger/use-traeger-schools";
import { Button, ButtonLink } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import { ConfirmationModal } from "~/components/ui/modal";
import { SectionCard } from "~/components/ui/section-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { holidayListBack } from "~/components/traeger/holiday-period-format";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { focusStepHeading } from "~/components/ui/use-step-focus";
import { useApiErrorDisplay, useToast } from "~/contexts/ToastContext";
import { createLogger } from "~/lib/logger";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import {
  decideHolidayAllocation,
  fetchHolidayAllocation,
  type HolidayAllocationBoard,
  type HolidayAllocationWeek,
  MAX_ALLOCATION_DECISIONS,
} from "~/lib/traeger-holiday-allocation-api";
import {
  downloadTraegerList,
  listExportQuery,
} from "~/lib/traeger-list-export";
import { traegerPath } from "~/lib/traeger-url";

const logger = createLogger({ component: "TraegerHolidayAllocationPage" });

/** Which weeks „Vorschlag übernehmen“ covers: one week or all open ones. */
type ProposalScope = { readonly weekId: string } | "all";

export default function TraegerHolidayAllocationPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const {
    data: period,
    preview,
    loadError: periodError,
  } = useTraegerHolidayPeriod(id);
  const { schools } = useTraegerSchools();
  const names = useMemo(() => schoolNames(schools), [schools]);
  const byCriteria = period?.allocationMode === "criteria";
  // A period by arrival has no allocation list; the page says so instead.
  const {
    data: board,
    error: boardError,
    mutate,
    reload,
  } = useTraegerResource(
    byCriteria && id ? traegerKeys.holidayAllocation(id) : null,
    () => fetchHolidayAllocation(id),
    "die Vergabe",
  );
  const setBoard = (next: HolidayAllocationBoard) =>
    mutate(next, { revalidate: false });
  const [target, setTarget] = useState<AllocationDecisionTarget | null>(null);
  const [proposalScope, setProposalScope] = useState<ProposalScope | null>(
    null,
  );
  const [taking, setTaking] = useState(false);
  // A decision removes the row whose button had the focus (#7111). The week
  // the person decided in takes it, or the next open one, or "Alles
  // entschieden"; `null` decides nothing, `"all"` any week.
  const focusAfterDecision = useRef<string | null>(null);
  useEffect(() => {
    const weekId = focusAfterDecision.current;
    if (weekId === null) return;
    focusAfterDecision.current = null;
    // The weeks stand directly in the page body (no wrapper with its own
    // gap, #7411); their markers are unique on the page.
    focusStepHeading(
      document.querySelector<HTMLElement>(
        `[data-allocation-week="${CSS.escape(weekId)}"]`,
      ) ??
        document.querySelector<HTMLElement>(
          "[data-allocation-week], [data-allocation-done]",
        ),
    );
  }, [board]);
  const actionErrors = useApiErrorDisplay();
  const toast = useToast();

  const weeks = useMemo(() => (board ? openWeeks(board) : []), [board]);
  const pendingTotal = weeks.reduce(
    (sum, week) => sum + week.pending.length,
    0,
  );
  const proposalWeeks: readonly HolidayAllocationWeek[] =
    proposalScope === null
      ? []
      : proposalScope === "all"
        ? weeks
        : weeks.filter((week) => week.weekId === proposalScope.weekId);
  const summary = proposalSummary(proposalWeeks);

  // The list changed meanwhile: read it again and say why through the path.
  const reloadAfterStale = useCallback(
    (err: unknown) => {
      setTarget(null);
      setProposalScope(null);
      void actionErrors.show(err, { object: "die Vergabe" });
      reload();
    },
    [actionErrors, reload],
  );

  const decideOne = async (reason: string) => {
    if (!target) return;
    const next = await decideHolidayAllocation(id, [
      {
        bookingId: target.entry.bookingId,
        placement: target.placement,
        proposal: target.entry.proposal,
        reason,
      },
    ]);
    focusAfterDecision.current = target.week.weekId;
    void setBoard(next);
    setTarget(null);
    toast.success(
      target.placement === "placed"
        ? `${target.entry.childFirstName} hat einen Platz. Die Eltern bekommen eine E-Mail.`
        : `${target.entry.childFirstName} steht auf der Warteliste. Die Eltern bekommen eine E-Mail.`,
    );
  };

  const takeProposal = async () => {
    setTaking(true);
    try {
      if (!board) return;
      // Keep the confirmed placements and expected proposals across all batches.
      // The backend rejects stale proposals; new bookings need a new decision.
      const confirmed = proposalDecisions(proposalWeeks);
      for (
        let offset = 0;
        offset < confirmed.length;
        offset += MAX_ALLOCATION_DECISIONS
      ) {
        const choices = confirmed.slice(
          offset,
          offset + MAX_ALLOCATION_DECISIONS,
        );
        const next = await decideHolidayAllocation(id, choices);
        // Preserve completed batches even when a later batch needs review.
        void setBoard(next);
      }
      focusAfterDecision.current =
        proposalScope === "all" || proposalScope === null
          ? "all"
          : proposalScope.weekId;
      setProposalScope(null);
      toast.success(
        `Der Vorschlag ist übernommen. ${summary.registrations === 1 ? "Die Eltern bekommen" : `Die Eltern von ${summary.registrations} Anmeldungen bekommen`} eine E-Mail.`,
      );
    } catch (err) {
      logger.error("traeger_holiday_allocation_proposal_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      if (isStaleAllocationError(err)) {
        reloadAfterStale(err);
      } else {
        setProposalScope(null);
        void actionErrors.show(err, { object: "der Vorschlag" });
        reload();
      }
    } finally {
      setTaking(false);
    }
  };

  // The export stands in the page menu; „Vorschlag für alle Wochen
  // übernehmen“ stays the one visible action (#7411).
  const exportItems = useTraegerListExportItems({
    download: (format) =>
      downloadTraegerList(
        bffFile("org", "GET /traeger/holiday-periods/{id}/allocation/export", {
          params: { id },
          query: listExportQuery(format),
        }),
      ),
    scope: traegerExportScope(),
    fallbackName: "vergabe",
    errorObject: "die Vergabe",
    unavailable: !board || (weeks.length === 0 && board.decisions.length === 0),
  });

  const loadError = boardError ?? periodError;
  const loading = !loadError && (!period || (byCriteria && !board));
  const busy = taking || target !== null;

  return (
    <TenantPage
      title={period?.name ?? preview?.name ?? "Ferienzeitraum"}
      back
      backHref={traegerPath(holidayListBack(period?.kind).path)}
      backLabel={holidayListBack(period?.kind).label}
      info={
        <p>
          moto sortiert die offenen Anmeldungen jeder Woche nach deinen
          Kriterien. Bei gleichen Kriterien zählt der Eingang. Das ist nur ein
          Vorschlag. Dein Büro entscheidet über jeden Platz. Weiche vom
          Vorschlag ab, schreibe kurz, warum. Die Eltern bekommen nach der
          Entscheidung eine E-Mail. Danach rücken Kinder von der Warteliste
          automatisch nach, wenn ein Platz frei wird.
        </p>
      }
      stats={
        board ? (
          <TenantPageStats
            items={[
              {
                value: pendingTotal,
                label:
                  pendingTotal === 1 ? "Anmeldung offen" : "Anmeldungen offen",
              },
              {
                value: board.decisions.length,
                label:
                  board.decisions.length === 1
                    ? "Entscheidung"
                    : "Entscheidungen",
              },
            ]}
          />
        ) : null
      }
      statsLoading={byCriteria && !board && !loadError}
      tabs={holidayPeriodTabs(
        id,
        "vergabe",
        period?.registrationCount,
        period?.allocationMode,
        period?.kind,
      )}
      overflowMenu={byCriteria ? exportItems : undefined}
      actions={
        byCriteria && weeks.length > 1 ? (
          <Button
            type="button"
            variant="primary"
            size="md"
            disabled={busy}
            tooltip="moto fragt vorher nach, dann vergibt es die Plätze und schreibt den Eltern."
            onClick={() => setProposalScope("all")}
          >
            Vorschlag für alle Wochen übernehmen
          </Button>
        ) : null
      }
      overlays={
        <>
          <HolidayAllocationDecisionModal
            target={target}
            onClose={() => setTarget(null)}
            onConfirm={decideOne}
            onStale={reloadAfterStale}
          />
          <ConfirmationModal
            isOpen={proposalScope !== null}
            title="Vorschlag übernehmen?"
            confirmText="Vorschlag übernehmen"
            confirmVariant="success"
            isConfirmLoading={taking}
            isDismissDisabled={taking}
            loadingText="Übernimmt …"
            onClose={() => setProposalScope(null)}
            onConfirm={() => void takeProposal()}
          >
            <div className="space-y-2 text-sm text-gray-700">
              <p>{proposalSummaryText(summary)}</p>
              <p>
                {summary.registrations === 1
                  ? "Die Eltern bekommen eine E-Mail."
                  : `Die Eltern von ${summary.registrations} Anmeldungen bekommen eine E-Mail.`}
              </p>
            </div>
          </ConfirmationModal>
        </>
      }
      error={loadError}
      loading={loading}
      empty={
        period && !byCriteria
          ? {
              title: "Dieser Ferienzeitraum vergibt Plätze nach Eingang",
              description:
                "Hier gibt es nichts zu entscheiden. Wer sich zuerst anmeldet, bekommt zuerst einen Platz. Das Verfahren steht im Reiter „Planung“.",
            }
          : undefined
      }
    >
      {byCriteria && board ? (
        <>
          <SectionCard
            title="So sortiert moto vor"
            description={rankingExplanation(board.ranking, board.criteria)}
            action={
              <ButtonLink
                href={traegerPath("/traeger/ferien/kriterien")}
                variant="outline"
                size="md"
                className="gap-2"
                tooltip={HOLIDAY_CRITERIA_HINT}
              >
                <ListChecks className="h-4 w-4" aria-hidden="true" />
                Kriterien bearbeiten
              </ButtonLink>
            }
          >
            {board.criteria.length === 0 ? (
              <p className="text-sm text-gray-700">
                Es ist kein Kriterium eingeschaltet. moto sortiert darum nur
                nach Eingang.
              </p>
            ) : (
              <ol
                className="flex flex-wrap gap-2"
                aria-label={
                  board.ranking === "priority"
                    ? "Kriterien nach Priorität"
                    : "Kriterien"
                }
              >
                {board.criteria.map((criterion) => (
                  <li key={criterion.id} className="max-w-full min-w-0">
                    <StatusBadge
                      wrap
                      className="wrap-anywhere"
                      tone="gray"
                      label={criterionLabel(criterion, board.ranking)}
                    />
                  </li>
                ))}
              </ol>
            )}
          </SectionCard>

          {weeks.length === 0 ? (
            <div data-allocation-done>
              <SectionCard>
                <EmptyState
                  tone="success"
                  icon={<CheckCircle2 aria-hidden="true" />}
                  titleAs="h2"
                  title="Alles entschieden"
                  description="Es gibt keine offene Anmeldung. Neue Anmeldungen erscheinen hier, vorsortiert nach deinen Kriterien."
                  variant="compact"
                />
              </SectionCard>
            </div>
          ) : (
            weeks.map((week) => (
              <div key={week.weekId} data-allocation-week={week.weekId}>
                <HolidayAllocationWeekCard
                  periodId={id}
                  week={week}
                  hostSchoolName={names.get(week.hostSchoolId) ?? "Schule"}
                  criteria={board.criteria}
                  ranking={board.ranking}
                  maxScore={board.maxScore}
                  busy={busy}
                  onDecide={(entry, placement) =>
                    setTarget({ week, entry, placement })
                  }
                  onTakeProposal={() =>
                    setProposalScope({ weekId: week.weekId })
                  }
                />
              </div>
            ))
          )}

          <HolidayAllocationHistory
            periodId={id}
            decisions={board.decisions}
            defaultCollapsed={weeks.length > 0}
          />
        </>
      ) : null}
    </TenantPage>
  );
}
