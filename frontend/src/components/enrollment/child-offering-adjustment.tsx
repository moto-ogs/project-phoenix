"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { EditActions } from "~/components/ui/edit-actions";
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import { ConfirmationModal } from "~/components/ui/modal";
import { InsetPanel } from "~/components/ui/inset-panel";
import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import { SectionLabel } from "~/components/ui/section-label";
import { StatusBadge } from "~/components/ui/status-badge";
import { Textarea } from "~/components/ui/textarea";
import { ToggleChip } from "~/components/ui/toggle-chip";
import {
  OfferingOccupancyLine,
  OfferingRowShell,
} from "~/components/enrollment/offering-row-shell";
import { formatDateTime } from "~/components/enrollment/enrollment-request-display";
import { CarePlanImpact } from "~/components/students/care-plan-impact";
import { useApiFormError } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import { type CareOffering, listCareOfferings } from "~/lib/care-offering-api";
import {
  availableCareOfferings,
  careOfferingAvailabilityReason,
} from "~/lib/care-offering-availability";
import { fetchCareOfferingBookingStats } from "~/lib/care-offering-booking-stats";
import type * as enrollmentContract from "~/lib/contract/enrollment.generated";
import { materializeCareSelection } from "~/lib/care-offering-selection";
import { announceChangeRequestsChanged } from "~/lib/change-requests-refresh";
import { changeHistoryConcept } from "~/lib/concepts/changeHistory";
import { formatDate } from "~/lib/date-helpers";
import {
  type AdminChildOfferingsUpdate,
  type AdminOfferingAdjustment,
  type AdminOfferingChoice,
  type AdminRequestChild,
  type AdminRequestChildOffering,
  listAdminChildOfferingAdjustments,
  updateAdminChildOfferings,
} from "~/lib/enrollment-admin-api";
import { supportedGradeLevelMax } from "~/lib/grade-level";
import {
  useReadDraftForm,
  useSwrResourceLoadError,
} from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import { useInvalidateFamily, useSWRAuth } from "~/lib/swr";
import { enrollmentKeys } from "~/lib/swr/enrollment-keys";
import { useDraftOn } from "~/lib/swr/read-draft";
import { describeOfferingAdjustmentChanges } from "~/lib/offering-adjustment-history";
import { mapRosterImpact, type RosterImpact } from "~/lib/roster-impact";
import { useCareOfferingsEnabled, useTenant } from "~/lib/tenant-context";
import { weekdayShortLabel, weekdayShortList } from "~/lib/weekdays";

const logger = createLogger({ component: "ChildOfferingAdjustment" });

const NO_OFFERINGS: CareOffering[] = [];
const NO_STATS: Record<
  string,
  enrollmentContract.CareOfferingBookingStatsResponse
> = {};
const NO_ADJUSTMENTS: AdminOfferingAdjustment[] = [];

/**
 * An offering the child's grade level rules out. Parents never see these;
 * admins must, or a configured restriction reads as a missing feature
 * (#2186). A booking the child already holds stays removable — Bestandsschutz
 * means the rule does not revoke it, not that it can never be corrected — but
 * a blocked offering can never be newly added here. The documented workaround
 * is to relax the rule in the Angebots-Katalog first.
 *
 * `automaticDays` are days derived from a trigger offering. The backend
 * re-derives them on every save regardless of the availability rule, so the
 * row must show them as HELD even though there is no manual tick behind them
 * — an empty checkbox next to a booking the backend keeps is a lie (#2186
 * review). They are also not removable here: they disappear only with their
 * trigger.
 */
function BlockedOfferingRow({
  offering,
  gradeLevel,
  gradeLevelMax,
  booked,
  automaticDays,
  stats,
  onRemove,
  extension,
}: Readonly<{
  offering: CareOffering;
  gradeLevel: number | null | undefined;
  gradeLevelMax: number | null;
  booked: boolean;
  automaticDays: readonly string[];
  stats: enrollmentContract.CareOfferingBookingStatsResponse | undefined;
  onRemove: () => void;
  /** The end the office can extend (#7929); shown while the row stays booked. */
  extension?: Readonly<{
    end: { validUntil: string; extendsUntil: string };
    extended: boolean;
    onToggle: () => void;
  }>;
}>) {
  const reason = careOfferingAvailabilityReason(
    offering,
    gradeLevel,
    gradeLevelMax ?? undefined,
  );
  const inputId = `blocked-offering-${offering.id}`;
  const heldAutomatically = automaticDays.length > 0;
  return (
    <OfferingRowShell state="blocked">
      {/* A real <label> is load-bearing, not decoration: the kit Checkbox
          renders an sr-only input behind a pointer-events-none visual, so
          without the label wrapping it a mouse click on the box does nothing
          (#2186 review). */}
      <label
        htmlFor={inputId}
        className={`flex items-start gap-3 ${booked ? "cursor-pointer" : "cursor-not-allowed"}`}
      >
        <Checkbox
          id={inputId}
          className="mt-0.5"
          checked={booked || heldAutomatically}
          disabled={!booked}
          onChange={onRemove}
          aria-label={`${offering.name} bleibt gebucht`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-gray-500">
              {offering.name}
            </span>
            {booked ? (
              <StatusBadge
                tone="warning"
                label="bereits gebucht"
                title="Diese Buchung bleibt bestehen. Sie kann hier entfernt, aber nicht erneut hinzugefügt werden."
              />
            ) : null}
            {heldAutomatically ? (
              <StatusBadge
                tone="blue"
                label={`automatisch mitgebucht: ${weekdayShortList(automaticDays)}`}
                title="Diese Tage werden aus dem auslösenden Angebot abgeleitet und bleiben bestehen, solange dieses gebucht ist. Sie können hier nicht einzeln entfernt werden."
              />
            ) : null}
          </div>
          {reason ? (
            <span className="mt-1 block text-xs text-gray-500">{reason}</span>
          ) : null}
          <OfferingOccupancyLine stats={stats} />
        </div>
      </label>
      {booked && extension ? (
        <BookingEnd inputId={`${inputId}-extend`} {...extension} />
      ) : null}
    </OfferingRowShell>
  );
}

/**
 * The child as a correction's answer stores it: its bookings and their
 * offerings_version (ADR 0311), the rest of the child as read. A field the
 * answer leaves out is gone, not kept from the older read.
 */
export function withSavedOfferings(
  child: AdminRequestChild,
  saved: AdminChildOfferingsUpdate,
): AdminRequestChild {
  const {
    offerings: _offerings,
    upcoming_offerings: _upcoming,
    offerings_unavailable: _unavailable,
    offerings_version: _version,
    ...rest
  } = child;
  return {
    ...rest,
    ...(saved.offerings && { offerings: saved.offerings }),
    ...(saved.upcoming_offerings && {
      upcoming_offerings: saved.upcoming_offerings,
    }),
    ...(saved.offerings_unavailable && { offerings_unavailable: true }),
    ...(saved.offerings_version && {
      offerings_version: saved.offerings_version,
    }),
  };
}

/**
 * The correction the office edits: the offerings it ticks, their days, the
 * limited bookings it extends and the required offerings it removes with
 * „Alle Betreuungstage entfernen“. Lists, so a draft compares as JSON.
 */
interface AdjustmentDraft {
  readonly selected: readonly string[];
  readonly days: Readonly<Record<string, string[]>>;
  readonly extended: readonly string[];
  readonly droppedRequired: readonly string[];
}

function adjustmentDraftOf(child: AdminRequestChild): AdjustmentDraft {
  return {
    selected: [...initialManualOfferingIDs(child.offerings)].sort(),
    days: initialManualOfferingDays(child.offerings),
    extended: [],
    droppedRequired: [],
  };
}

export function ChildOfferingAdjustment({
  child,
  onSaved,
  phaseId,
  reload,
  requestId,
}: Readonly<{
  child: AdminRequestChild;
  requestId: string;
  phaseId: string;
  /** Takes the save's answer, which carries the new offerings_version. */
  onSaved: (saved: AdminChildOfferingsUpdate) => void;
  /**
   * Reads the child again as stored; rejects on failure, undefined when
   * the child is gone (ADR 0311).
   */
  reload: () => Promise<AdminRequestChild | undefined>;
}>) {
  const careOfferingsEnabled = useCareOfferingsEnabled();
  // The tenant's configured ceiling, so a blocked-offering reason names only
  // grades this school actually has (#2186 review).
  const { tenant } = useTenant();
  const gradeLevelMax = supportedGradeLevelMax(tenant?.gradeLevelMax);
  // Der Bearbeiten-Zustand der Fläche (Bauart 2 Regel 3, #3119): die
  // Auswahl erscheint an Ort und Stelle, kein Modal.
  const [editing, setEditing] = useState(false);
  // The phase's offerings load while the editor is open.
  const catalogRead = useSWRAuth(
    editing ? enrollmentKeys.careOfferings(phaseId) : null,
    () => listCareOfferings(phaseId),
    { keepPreviousData: false },
  );
  const rawCatalog = catalogRead.data ?? NO_OFFERINGS;
  const catalogLoaded = catalogRead.data !== undefined;
  // Offerings the child's grade level rules out. Kept separate from `catalog`
  // so payload building and the auto-add preview keep operating on exactly
  // the selectable set, while the UI can still SHOW the blocked ones with a
  // reason instead of leaving a silent gap in the list (#2186).
  const { catalog, blockedCatalog } = useMemo(() => {
    const available = availableCareOfferings(
      rawCatalog,
      child.target_grade_level,
    );
    const availableIDs = new Set(available.map((offering) => offering.id));
    return {
      catalog: available,
      blockedCatalog: rawCatalog.filter(
        (offering) => !availableIDs.has(offering.id),
      ),
    };
  }, [rawCatalog, child.target_grade_level]);
  // Occupancy is advisory: without it a full offering only announces itself
  // as an error after the whole correction is submitted (#2186). Loaded
  // beside the catalog rather than with it — a slow or failing stats call
  // must never keep the editor in its loading state; SWR logs a failure.
  const statsRead = useSWRAuth(
    editing ? enrollmentKeys.bookingStats(phaseId) : null,
    () => fetchCareOfferingBookingStats(phaseId),
    { keepPreviousData: false },
  );
  const bookingStats: Record<
    string,
    enrollmentContract.CareOfferingBookingStatsResponse
  > = statsRead.data ?? NO_STATS;
  const historyRead = useSWRAuth(
    enrollmentKeys.offeringAdjustments(requestId, child.id),
    () => listAdminChildOfferingAdjustments(requestId, child.id),
    { keepPreviousData: false },
  );
  const { mutate: mutateHistory } = historyRead;
  const history = historyRead.data ?? NO_ADJUSTMENTS;
  const invalidateFamily = useInvalidateFamily();
  // The correction rests on the bookings as read when editing starts (ADR
  // 0311): a newer read refills it only while untouched, the save sends
  // their offerings_version, and after a refusal nothing is sent until the
  // stored bookings were read. One draft per opening of this child.
  const editor = useDraftOn<
    AdminRequestChild,
    AdjustmentDraft,
    string,
    AdminChildOfferingsUpdate
  >(
    { opening: editing ? child.id : null, data: child, reload },
    {
      token: (read) => read.offerings_version ?? "",
      toDraft: adjustmentDraftOf,
      answer: (saved) => saved,
    },
  );
  // The bookings the draft rests on: what a save replaces.
  const base = editor.base ?? child;
  const draft = editor.draft ?? adjustmentDraftOf(base);
  const { setDraft } = editor;
  // Befristete Angebote, die das Büro bis zum Ende der Phase verlängert
  // (#7929).
  const extended = useMemo(() => new Set(draft.extended), [draft.extended]);
  const days = draft.days;
  const bookingEnds = useMemo(
    () => currentBookingEnds(base.offerings),
    [base.offerings],
  );
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  // Fehler stehen oben im Bearbeiten-Bereich (Bauart 2 Regel 5).
  const errors = useApiFormError();
  const form = useReadDraftForm(
    editing ? editor : null,
    errors,
    "die gebuchten Angebote",
  );
  const draftBlocked =
    editing && !editor.canSubmit && editor.status !== "saving"
      ? editor.status === "loadFailed"
        ? "Lade zuerst die gebuchten Angebote neu."
        : "Die gebuchten Angebote werden geladen."
      : undefined;
  const catalogError = useSwrResourceLoadError(
    [{ data: catalogRead.data, error: catalogRead.error }],
    "die Angebotsliste",
    () => catalogRead.mutate(),
  );
  // A failed load stays loading until its error text is there, so no empty
  // list shows in its place.
  const loading =
    editing &&
    !catalogLoaded &&
    (!catalogError.failure || catalogError.error === null);
  // Ohne Hinweis läse sich die fehlende Liste als "nie geändert".
  const historyError = useSwrResourceLoadError(
    [{ data: historyRead.data, error: historyRead.error }],
    "die Änderungshistorie",
    () => mutateHistory(),
  );
  // „Wiederholen“ ruft die aktuelle Fassung auf, nicht die vom Fehler.
  const latestSaveRef = useRef<() => Promise<void>>(async () => undefined);
  const [withdrawalConfirmationOpen, setWithdrawalConfirmationOpen] =
    useState(false);
  const [pendingWithdrawalInput, setPendingWithdrawalInput] = useState<{
    reason: string;
    offerings: AdminOfferingChoice[];
  } | null>(null);
  const [withdrawalCreated, setWithdrawalCreated] = useState(false);
  // Was die letzte Korrektur im Betreuungsplan bewirkt hat (#5102).
  const [rosterImpact, setRosterImpact] = useState<RosterImpact | null>(null);
  useEffect(() => {
    if (!careOfferingsEnabled) setEditing(false);
  }, [careOfferingsEnabled]);

  // The selection: the draft's ticks plus every active required offering
  // of the catalog the person did not remove. Bestandsschutz: a booking the
  // child already holds survives a rule that was tightened after the fact
  // (#2186); adjustmentPayloadOfferings carries such ids through via the
  // child's existing offerings.
  const selected = useMemo(() => {
    const ids = new Set(draft.selected);
    const dropped = new Set(draft.droppedRequired);
    for (const offering of catalog) {
      if (
        offering.is_active &&
        offering.is_required &&
        !dropped.has(offering.id)
      ) {
        ids.add(offering.id);
      }
    }
    return ids;
  }, [catalog, draft.selected, draft.droppedRequired]);
  const setSelected = (next: Set<string>) =>
    setDraft((current) => ({
      ...current,
      selected: [...next].sort(),
      droppedRequired: catalog
        .filter(
          (offering) =>
            offering.is_active &&
            offering.is_required &&
            !next.has(offering.id),
        )
        .map((offering) => offering.id)
        .sort(),
    }));
  const setDays = (
    update: (current: Record<string, string[]>) => Record<string, string[]>,
  ) =>
    setDraft((current) => ({ ...current, days: update({ ...current.days }) }));

  const openEditor = () => {
    if (!careOfferingsEnabled) return;
    setEditing(true);
    setRosterImpact(null);
    errors.clear();
  };

  const toggleExtended = (offeringID: string) => {
    setDraft((current) => ({
      ...current,
      extended: current.extended.includes(offeringID)
        ? current.extended.filter((id) => id !== offeringID)
        : [...current.extended, offeringID].sort(),
    }));
  };

  const preview = useMemo(() => {
    const { automaticDays } = materializeCareSelection(
      catalog,
      { offeringIds: selected, offeringDays: days },
      child.target_grade_level || undefined,
    );
    return {
      automaticDays: Object.fromEntries(
        catalog.map((offering) => [
          offering.id,
          offering.available_days.filter((day) =>
            automaticDays[offering.id]?.has(day),
          ),
        ]),
      ),
    };
  }, [catalog, child.target_grade_level, days, selected]);

  // Blocked offerings are excluded from `catalog`, so the client-side preview
  // above never covers them. Their derived days therefore have to come from
  // what is on file — otherwise a booking the backend keeps re-deriving reads
  // as unbooked in the editor (#2186 review).
  const automaticDaysOnFile = useMemo(
    () => automaticOfferingDays(base.offerings),
    [base.offerings],
  );

  const handleToggle = (offering: CareOffering) => {
    if (offering.is_required) return;
    const next = new Set(selected);
    if (next.has(offering.id)) {
      next.delete(offering.id);
    } else {
      next.add(offering.id);
      if (
        offering.days_of_week_mode === "parent_choice" &&
        (days[offering.id]?.length ?? 0) === 0
      ) {
        setDays((current) => ({
          ...current,
          [offering.id]: [...offering.available_days],
        }));
      }
    }
    setSelected(next);
  };

  const handleDayToggle = (offering: CareOffering, day: string) => {
    setDays((prev) => {
      const current = new Set(prev[offering.id] ?? []);
      if (current.has(day)) current.delete(day);
      else current.add(day);
      const ordered = offering.available_days.filter((d) => current.has(d));
      return { ...prev, [offering.id]: ordered };
    });
  };

  const removeAllCareDays = () => {
    const careOfferingIDs = new Set(
      rawCatalog
        .filter((offering) => offering.counts_as_care)
        .map((offering) => offering.id),
    );
    setSelected(
      new Set([...selected].filter((id) => !careOfferingIDs.has(id))),
    );
  };

  const hasSelectedCareDays = rawCatalog.some(
    (offering) => offering.counts_as_care && selected.has(offering.id),
  );

  const finishSave = async (saved: AdminChildOfferingsUpdate) => {
    setWithdrawalConfirmationOpen(false);
    setPendingWithdrawalInput(null);
    setEditing(false);
    setReason("");
    // The adjustment changed the phase's occupancy.
    void invalidateFamily(enrollmentKeys.bookingStatsFamily);
    await mutateHistory();
    onSaved(saved);
  };

  // Sends the correction over the version it read; a refusal over changed
  // bookings throws after the stored ones are read again (`refusal`).
  const saveAdjustment = async (
    input: {
      reason: string;
      offerings: AdminOfferingChoice[];
    },
    completeWithdrawalConfirmed: boolean,
  ) => {
    const result = await editor.submit((version) =>
      updateAdminChildOfferings(
        requestId,
        child.id,
        { ...input, completeWithdrawalConfirmed },
        version,
      ),
    );
    if (!result.ok) {
      throw new RefusedCorrection(result.error, result.refused, result.reload);
    }
    const updated = result.saved;
    setRosterImpact(mapRosterImpact(updated?.roster_impact));
    setWithdrawalCreated(completeWithdrawalConfirmed);
    // Eine Verlängerung kann eine offene Abmeldung erledigen (#7929).
    if (
      completeWithdrawalConfirmed ||
      input.offerings.some((offering) => offering.extend_to_phase_end)
    ) {
      announceChangeRequestsChanged();
    }
    await finishSave(updated);
  };

  // A failed correction: over changed bookings the editor shows the stored
  // ones once read, without offering the same save again; a child gone
  // meanwhile closes it. Any other failure offers the save again.
  const showSaveError = async (err: unknown) => {
    const failure = err instanceof RefusedCorrection ? err : null;
    const error = failure ? failure.error : err;
    const reread = failure?.reload;
    if (failure?.refused && reread) {
      await errors.show(error, {
        object: "die Angebotsänderung",
        reload: async () => {
          const stored = await reread();
          if (stored === undefined) setEditing(false);
          return stored;
        },
      });
      return;
    }
    await errors.show(error, {
      object: "die Angebotsänderung",
      retry: () => void latestSaveRef.current(),
    });
  };

  const handleSave = async () => {
    const trimmedReason = reason.trim();
    if (trimmedReason === "") {
      errors.invalid("Bitte trage eine Begründung ein.", {
        reason: "Die Begründung fehlt.",
      });
      return;
    }
    // Nothing goes out before the stored bookings are read; the shown
    // error stays.
    if (!catalogLoaded || !form.begin()) return;
    setSaving(true);
    const input = {
      reason: trimmedReason,
      offerings: adjustmentPayloadOfferings(
        catalog,
        selected,
        days,
        base.offerings,
        extended,
      ),
    };
    try {
      await saveAdjustment(input, false);
    } catch (err) {
      const error = err instanceof RefusedCorrection ? err.error : err;
      if (
        error instanceof ApiError &&
        error.code === "enrollment.complete_withdrawal_confirmation_required"
      ) {
        setPendingWithdrawalInput(input);
        setWithdrawalConfirmationOpen(true);
      } else {
        logger.warn("offering_adjustment_save_failed", {
          error: error instanceof Error ? error.message : String(error),
          child_id: child.id,
        });
        await showSaveError(err);
      }
    } finally {
      setSaving(false);
    }
  };
  useLayoutEffect(() => {
    latestSaveRef.current = handleSave;
  });

  const confirmCompleteWithdrawal = async () => {
    if (!pendingWithdrawalInput || !form.begin()) return;
    setSaving(true);
    try {
      await saveAdjustment(pendingWithdrawalInput, true);
    } catch (err) {
      setWithdrawalConfirmationOpen(false);
      logger.warn("offering_adjustment_withdrawal_failed", {
        error: err instanceof Error ? err.message : String(err),
        child_id: child.id,
      });
      // Der Dialog ist zu, der Entwurf steht noch im Bearbeiten-Bereich:
      // „Wiederholen“ dort fragt wieder nach.
      await showSaveError(err);
    } finally {
      setSaving(false);
    }
  };

  const cancelEditing = () => {
    setEditing(false);
    errors.clear();
  };

  if (!careOfferingsEnabled && history.length === 0 && !historyError.error)
    return null;

  return (
    <InsetPanel framed>
      {withdrawalCreated ? (
        <Alert
          type="warning"
          message="Abmeldung noch abschließen. Die Betreuungstage sind entfernt. Eine berechtigte Person muss noch das Ende der Betreuung eintragen."
        />
      ) : null}
      {careOfferingsEnabled ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <SectionLabel as="h4">Nachbearbeitung</SectionLabel>
            <p className="mt-1 text-sm text-gray-600">
              {child.offerings_unavailable
                ? "Die gebuchten Angebote konnten nicht geladen werden. Bitte die Seite neu laden, eine Korrektur würde sonst auf einem unbekannten Stand aufsetzen."
                : editing
                  ? "Auswahl ändern und mit Begründung speichern. Automatisch verknüpfte Angebote werden beim Speichern neu berechnet."
                  : "Angebote können für dieses bestätigte Kind korrigiert werden."}
            </p>
          </div>
          {/* Correcting on top of an unknown selection would replace the
              family's real bookings with whatever the empty editor holds
              (#2185), so the entry point disappears until the data is back. */}
          {child.offerings_unavailable || editing ? null : (
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={openEditor}
              tooltip="Öffnet die gebuchten Angebote des Kindes zum Ändern."
              className="inline-flex items-center justify-center gap-2"
            >
              <Pencil className="h-4 w-4" aria-hidden />
              Bearbeiten
            </Button>
          )}
        </div>
      ) : null}

      {/* Der Bearbeiten-Zustand an Ort und Stelle (Bauart 2 Regel 3 und 4,
          #3119): Auswahl, Begründung und ein `EditActions` unten. Die
          Abmelde-Rückfrage ist der einzige Dialog und liegt über dieser
          Fläche; Auswahl und Begründung bleiben darunter erhalten. */}
      {careOfferingsEnabled && editing ? (
        <div className="mt-3 space-y-4 border-t border-gray-100 pt-3">
          <FormErrorAlert message={errors.error} />
          <LoadErrorAlert error={form.loadError} />
          <LoadErrorAlert error={catalogError.error} />
          {loading ? (
            <p className="text-sm text-gray-500">Angebote werden geladen…</p>
          ) : (
            <div className="space-y-2">
              {catalog.map((offering) => {
                const checked = selected.has(offering.id);
                const autoDays = preview.automaticDays[offering.id] ?? [];
                const inputId = `offering-adjustment-${child.id}-${offering.id}`;
                const bookingEnd = bookingEnds[offering.id];
                return (
                  <OfferingRowShell
                    key={offering.id}
                    state={checked ? "selected" : "available"}
                  >
                    {/* Wie in BlockedOfferingRow: das Kit-Checkbox-Feld ist
                        sr-only, erst das <label> mit htmlFor macht den Klick
                        auf den Kasten wirksam. */}
                    <label
                      htmlFor={inputId}
                      className={`flex items-start gap-3 ${
                        offering.is_required
                          ? "cursor-default"
                          : "cursor-pointer"
                      }`}
                    >
                      <Checkbox
                        id={inputId}
                        className="mt-0.5"
                        checked={checked}
                        disabled={offering.is_required}
                        onChange={() => handleToggle(offering)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-gray-900">
                            {offering.name}
                          </span>
                          {!offering.is_active ? (
                            <StatusBadge tone="gray" label="Inaktiv" />
                          ) : null}
                          {offering.is_required ? (
                            <StatusBadge tone="blue" label="Pflichtangebot" />
                          ) : null}
                          {autoDays.length > 0 ? (
                            <StatusBadge
                              tone="blue"
                              label={`automatisch mitgebucht: ${weekdayShortList(autoDays)}`}
                            />
                          ) : null}
                        </span>
                        {offering.description ? (
                          <span className="mt-1 block text-xs text-gray-500">
                            {offering.description}
                          </span>
                        ) : null}
                        <OfferingOccupancyLine
                          stats={bookingStats[offering.id]}
                        />
                      </span>
                    </label>

                    {checked &&
                    offering.days_of_week_mode === "parent_choice" ? (
                      <div className="mt-3 flex flex-wrap gap-2 pl-8">
                        {offering.available_days.map((day) => (
                          <ToggleChip
                            key={day}
                            pressed={(days[offering.id] ?? []).includes(day)}
                            onPressedChange={() =>
                              handleDayToggle(offering, day)
                            }
                          >
                            {weekdayShortLabel(day)}
                          </ToggleChip>
                        ))}
                      </div>
                    ) : null}
                    {checked && bookingEnd ? (
                      <BookingEnd
                        inputId={`${inputId}-extend`}
                        end={bookingEnd}
                        extended={extended.has(offering.id)}
                        onToggle={() => toggleExtended(offering.id)}
                      />
                    ) : null}
                  </OfferingRowShell>
                );
              })}
              {blockedCatalog.length > 0 ? (
                <div className="space-y-2 pt-1">
                  <SectionLabel as="p">
                    Für dieses Kind nicht wählbar
                  </SectionLabel>
                  {blockedCatalog.map((offering) => {
                    const end = bookingEnds[offering.id];
                    return (
                      <BlockedOfferingRow
                        key={offering.id}
                        offering={offering}
                        gradeLevel={child.target_grade_level}
                        gradeLevelMax={gradeLevelMax}
                        booked={selected.has(offering.id)}
                        automaticDays={automaticDaysOnFile[offering.id] ?? []}
                        stats={bookingStats[offering.id]}
                        {...(end && {
                          extension: {
                            end,
                            extended: extended.has(offering.id),
                            onToggle: () => toggleExtended(offering.id),
                          },
                        })}
                        onRemove={() => {
                          const next = new Set(selected);
                          next.delete(offering.id);
                          setSelected(next);
                        }}
                      />
                    );
                  })}
                </div>
              ) : null}
              {hasSelectedCareDays ? (
                <Button
                  type="button"
                  variant="outline_danger"
                  onClick={removeAllCareDays}
                  tooltip="Wählt alle Betreuungstage ab, wirksam erst nach dem Speichern."
                >
                  Alle Betreuungstage entfernen
                </Button>
              ) : null}
            </div>
          )}

          <Textarea
            name="reason"
            error={errors.fieldError("reason")}
            label="Begründung"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            autoComplete="off"
            placeholder="z. B. Randstunde nach Rücksprache mit der Schule ergänzt"
          />
          <EditActions
            onCancel={cancelEditing}
            onSave={() => void handleSave()}
            saving={saving}
            disabled={loading || !catalogLoaded || draftBlocked !== undefined}
            {...(draftBlocked && { disabledReason: draftBlocked })}
          />
        </div>
      ) : null}

      {rosterImpact && !editing ? (
        <div className="mt-3">
          <CarePlanImpact
            impact={rosterImpact}
            studentId={child.created_student_id}
          />
        </div>
      ) : null}

      {historyError.error ? (
        <LoadErrorAlert
          error={historyError.error}
          className={careOfferingsEnabled ? "mt-3" : undefined}
        />
      ) : null}
      {history.length > 0 ? (
        <div
          className={
            careOfferingsEnabled ? "mt-3 border-t border-gray-100 pt-3" : ""
          }
        >
          <SectionLabel as="p" className="flex items-center gap-2">
            <MotoConceptIcon concept={changeHistoryConcept} size={14} />
            Änderungshistorie
          </SectionLabel>
          <ul className="mt-2 space-y-2">
            {history.slice(0, 5).map((entry) => (
              <li key={entry.id} className="text-xs leading-5 text-gray-600">
                <span className="font-medium text-gray-900">
                  {formatDateTime(entry.changed_at)}
                </span>{" "}
                von{" "}
                <span className="font-medium text-gray-900">
                  {entry.actor_name_snapshot ??
                    entry.actor_email_snapshot ??
                    `Account ${entry.actor_account_id}`}
                </span>
                : {entry.reason}
                <ul className="mt-1 space-y-1">
                  {describeOfferingAdjustmentChanges(
                    entry.before,
                    entry.after,
                  ).map((line) => (
                    <li
                      key={`${line.days ?? ""}|${line.text}`}
                      className="flex items-baseline gap-1.5 text-gray-500"
                    >
                      {line.days ? (
                        <span className="shrink-0">
                          <StatusBadge compact tone="gray" label={line.days} />
                        </span>
                      ) : null}
                      <span className="min-w-0">{line.text}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ConfirmationModal
        isOpen={withdrawalConfirmationOpen}
        onClose={() => setWithdrawalConfirmationOpen(false)}
        onConfirm={() => void confirmCompleteWithdrawal()}
        title="Alle Betreuungstage entfernen?"
        confirmText="Änderung speichern"
        cancelText="Zurück"
        isConfirmLoading={saving}
        loadingText="Wird gespeichert …"
        isDismissDisabled={saving}
      >
        <p>
          Danach ist für {child.first_name} kein Betreuungstag mehr gebucht. Die
          Abmeldung muss anschließend abgeschlossen werden.
        </p>
      </ConfirmationModal>
    </InsetPanel>
  );
}

/**
 * A limited booking the office can extend (#7929): its last booked day and
 * the choice to book the offering to `extends_until`, the end of the phase
 * or the earlier care end. An end the backend offers no extension for stays
 * in the booking display above; here it would read as a choice that is not
 * there.
 */
function BookingEnd({
  inputId,
  end,
  extended,
  onToggle,
}: Readonly<{
  inputId: string;
  end: { validUntil: string; extendsUntil: string };
  extended: boolean;
  onToggle: () => void;
}>) {
  return (
    <div className="mt-3 space-y-2 pl-8">
      <p className="text-xs text-gray-600">
        Gebucht bis {formatDate(end.validUntil)}
      </p>
      <label
        htmlFor={inputId}
        className="flex cursor-pointer items-start gap-2 text-sm text-gray-900"
      >
        <Checkbox
          id={inputId}
          className="mt-0.5"
          checked={extended}
          onChange={onToggle}
        />
        Bis {formatDate(end.extendsUntil)} verlängern
      </label>
    </div>
  );
}

/**
 * The current bookings the office can extend, keyed by offering: the last
 * booked day and the day an extension books to (`extends_until`).
 */
function currentBookingEnds(
  offerings?: AdminRequestChildOffering[],
): Record<string, { validUntil: string; extendsUntil: string }> {
  const out: Record<string, { validUntil: string; extendsUntil: string }> = {};
  for (const offering of offerings ?? []) {
    if (!offering.valid_until || !offering.extends_until) continue;
    out[offering.offering_id] = {
      validUntil: offering.valid_until,
      extendsUntil: offering.extends_until,
    };
  }
  return out;
}

function initialManualOfferingIDs(
  offerings?: AdminRequestChildOffering[],
): Set<string> {
  const ids = new Set<string>();
  for (const offering of offerings ?? []) {
    const automaticOnly =
      (offering.automatic_selected_days?.length ?? 0) > 0 &&
      (offering.manual_selected_days?.length ?? 0) === 0;
    if (!automaticOnly) ids.add(offering.offering_id);
  }
  return ids;
}

/**
 * The days each booking on file holds automatically, i.e. derived from a
 * trigger offering rather than ticked by anyone. Keyed by offering id, absent
 * when a booking has none.
 */
function automaticOfferingDays(
  offerings?: AdminRequestChildOffering[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const offering of offerings ?? []) {
    const automatic = offering.automatic_selected_days ?? [];
    if (automatic.length > 0) out[offering.offering_id] = [...automatic];
  }
  return out;
}

function initialManualOfferingDays(
  offerings?: AdminRequestChildOffering[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const offering of offerings ?? []) {
    const manual =
      (offering.manual_selected_days?.length ?? 0) > 0
        ? offering.manual_selected_days
        : offering.automatic_selected_days?.length
          ? []
          : offering.selected_days;
    if (manual && manual.length > 0) out[offering.offering_id] = [...manual];
  }
  return out;
}

function adjustmentPayloadOfferings(
  catalog: CareOffering[],
  selected: Set<string>,
  days: Record<string, string[]>,
  existingOfferings?: AdminRequestChildOffering[],
  extended: ReadonlySet<string> = new Set(),
): AdminOfferingChoice[] {
  const payload = catalog
    .filter((offering) => selected.has(offering.id))
    .map((offering) => ({
      offering_id: offering.id,
      selected_days:
        offering.days_of_week_mode === "parent_choice"
          ? (days[offering.id] ?? [])
          : undefined,
      ...(extended.has(offering.id) && { extend_to_phase_end: true }),
    }));
  const catalogIDs = new Set(catalog.map((offering) => offering.id));
  for (const offering of existingOfferings ?? []) {
    if (
      catalogIDs.has(offering.offering_id) ||
      !selected.has(offering.offering_id)
    ) {
      continue;
    }
    payload.push({
      offering_id: offering.offering_id,
      selected_days:
        offering.days_of_week_mode === "parent_choice"
          ? (days[offering.offering_id] ?? offering.selected_days ?? [])
          : undefined,
      ...(extended.has(offering.offering_id) && { extend_to_phase_end: true }),
    });
  }
  return payload;
}

/**
 * A correction the server did not take, with the read of the stored
 * bookings a refusal over changed ones started (ADR 0311).
 */
class RefusedCorrection extends Error {
  constructor(
    readonly error: unknown,
    readonly refused: boolean,
    readonly reload?: () => Promise<unknown>,
  ) {
    super(error instanceof Error ? error.message : String(error));
  }
}
