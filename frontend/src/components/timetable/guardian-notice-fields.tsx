"use client";

import { useEffect, useRef } from "react";

import { Checkbox } from "~/components/ui/checkbox";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { formatDate } from "~/lib/date-helpers";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { useSWRAuth } from "~/lib/swr";
import { tenantDailyKeys } from "~/lib/swr/tenant-daily-keys";
import { timetableService } from "~/lib/timetable-api";
import type {
  GuardianNoticeInput,
  GuardianNoticeReach,
} from "~/lib/timetable-types";
import { InsetPanel } from "~/components/ui/inset-panel";

/** The block a notice would be about; the prefilled text is built from it. */
export interface GuardianNoticeBlock {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
}

/** Form state the parent surface owns; `send` mirrors the checkbox. */
export interface GuardianNoticeDraft {
  send: boolean;
  title: string;
  message: string;
}

// Mirrors the announcement service limits (maxTitleLen / maxBodyLen).
const GUARDIAN_NOTICE_TITLE_MAX = 200;
const GUARDIAN_NOTICE_MESSAGE_MAX = 4000;

/** Prefilled text for the families: what falls out, and when. */
export function suggestGuardianNotice(
  block: GuardianNoticeBlock,
): Pick<GuardianNoticeDraft, "title" | "message"> {
  const day = formatDate(block.date);
  return {
    title: `${block.title} am ${day} entfällt`,
    message: `Die Betreuung „${block.title}“ am ${day} von ${block.startTime} bis ${block.endTime} Uhr fällt aus.`,
  };
}

/** True when the block has booked children the families could hear about. */
function noticeApplies(
  reach: GuardianNoticeReach | null,
): reach is GuardianNoticeReach {
  return (reach?.childCount ?? 0) > 0;
}

/**
 * Turns a draft into the request payload, or nothing when the box is not
 * ticked or the block has no booked children.
 */
export function guardianNoticePayload(
  draft: GuardianNoticeDraft | null,
  reach: GuardianNoticeReach | null,
): GuardianNoticeInput | undefined {
  if (!draft?.send || !noticeApplies(reach)) return undefined;
  const title = draft.title.trim();
  const message = draft.message.trim();
  if (!title || !message) return undefined;
  return { title, message };
}

/** True while the draft says "send" but the text is not usable yet. */
export function guardianNoticeIncomplete(
  draft: GuardianNoticeDraft | null,
  reach: GuardianNoticeReach | null,
  previewApplies = false,
): boolean {
  // Before the preview resolves, the box would start ticked. Do not let a
  // cancellation silently skip the families while it is still loading.
  if (previewApplies && draft === null && reach === null) return true;
  if (!draft?.send || !noticeApplies(reach)) return false;
  return draft.title.trim() === "" || draft.message.trim() === "";
}

/**
 * Why `guardianNoticeIncomplete` blocks the cancellation: the preview is still
 * loading, or subject or text is missing (#6643).
 */
export function guardianNoticeBlockedReason(
  draft: GuardianNoticeDraft | null,
  reach: GuardianNoticeReach | null,
): string {
  return draft === null && reach === null
    ? "moto prüft noch, welche Familien die Nachricht erreicht."
    : "Geben Sie zuerst Betreff und Text an die Eltern ein.";
}

function familiesLabel(count: number): string {
  if (count === 1) return "Erreicht 1 Familie.";
  return `Erreicht ${count} Familien.`;
}

interface GuardianNoticeFieldsProps {
  readonly block: GuardianNoticeBlock;
  /** Today as YYYY-MM-DD; a block before today never offers the notice. */
  readonly today: string;
  readonly draft: GuardianNoticeDraft | null;
  readonly onDraftChange: (draft: GuardianNoticeDraft) => void;
  readonly onReachChange: (reach: GuardianNoticeReach | null) => void;
  readonly disabled?: boolean;
  /** Compact chrome for the slide-over; the modal uses the default. */
  readonly compact?: boolean;
}

/**
 * "Eltern per App und E-Mail informieren" on a cancellation (#2601, #3731).
 * Loads what the notice would reach, seeds a ticked draft from the block, and
 * renders the checkbox with the editable text below it. The parent surface
 * owns the draft so it can send it with the cancellation.
 *
 * The person cancelling decides here; there are no school settings for it any
 * more. Renders nothing for a block without booked children or in the past.
 */
export function GuardianNoticeFields({
  block,
  today,
  draft,
  onDraftChange,
  onReachChange,
  disabled = false,
  compact = false,
}: GuardianNoticeFieldsProps) {
  const past = block.date < today;
  const checkboxId = `guardian-notice-send-${block.id}`;
  const { data, error, mutate } = useSWRAuth(
    past ? null : tenantDailyKeys.guardianNoticeReach(block.id),
    // Wrapped in a resolved promise so a synchronous throw (a test double
    // without the method, a broken client) lands in the same failure as a
    // rejected request.
    () =>
      Promise.resolve().then(() =>
        timetableService.getGuardianNoticeReach(block.id),
      ),
    { keepPreviousData: false },
  );
  const reach = data ?? null;
  const failed = !past && !data && !!error;
  // Ladefehler vor Ort (#2516): Katalogtext mit Wiederholen.
  const { error: loadError } = useSwrResourceLoadError(
    [{ data, error }],
    "die Information der Eltern",
    () => mutate(),
  );

  // The parent surface owns reach and draft. The draft is seeded once per
  // block and outcome, never on a background refresh, so typed text stays.
  const seededRef = useRef<string | null>(null);
  useEffect(() => {
    if (past || (!data && !failed)) {
      onReachChange(null);
      return;
    }
    onReachChange(reach);
    const outcome = `${block.id}:${data ? "loaded" : "failed"}`;
    if (seededRef.current === outcome) return;
    seededRef.current = outcome;
    if (data) {
      if (noticeApplies(data))
        onDraftChange({ send: true, ...suggestGuardianNotice(block) });
    } else {
      // A failed preview must not permanently block a cancellation. Seed an
      // explicit opt-out, distinct from the initial loading state above.
      onDraftChange({ send: false, ...suggestGuardianNotice(block) });
    }
    // The block identity is what matters; the title/date inside it only change
    // together with the id. The parent's callbacks are not dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id, past, data, failed]);

  if (past) return null;
  if (failed) {
    return (
      <div className="space-y-1">
        <LoadErrorAlert error={loadError} />
        <p className="text-xs text-gray-500">
          Sie können trotzdem absagen. Die Eltern bekommen dann keine Nachricht.
        </p>
      </div>
    );
  }
  if (!noticeApplies(reach) || !draft) return null;

  const fields = (
    <>
      <label
        htmlFor={checkboxId}
        className="flex cursor-pointer items-start gap-3"
      >
        <Checkbox
          id={checkboxId}
          checked={draft.send}
          disabled={disabled}
          onChange={(e) => onDraftChange({ ...draft, send: e.target.checked })}
          aria-label="Eltern per App und E-Mail informieren"
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-gray-900">
            Eltern per App und E-Mail informieren
          </span>
          <span className="block text-xs text-gray-500">
            {reach.familyCount > 0
              ? familiesLabel(reach.familyCount)
              : "Kein Kind dieses Termins hat Eltern mit Zugang zum Elternportal."}
          </span>
        </span>
      </label>
      {draft.send && (
        <div className="space-y-2">
          <Input
            id={`guardian-notice-title-${block.id}`}
            label="Betreff"
            value={draft.title}
            maxLength={GUARDIAN_NOTICE_TITLE_MAX}
            disabled={disabled}
            onChange={(e) => onDraftChange({ ...draft, title: e.target.value })}
          />
          <Textarea
            id={`guardian-notice-message-${block.id}`}
            label="Text an die Eltern"
            rows={3}
            value={draft.message}
            maxLength={GUARDIAN_NOTICE_MESSAGE_MAX}
            disabled={disabled}
            onChange={(e) =>
              onDraftChange({ ...draft, message: e.target.value })
            }
          />
          <p className="text-xs text-gray-500">
            Der interne Grund wird nicht mitgeschickt. Die Eltern sehen nur
            diesen Text.
          </p>
        </div>
      )}
    </>
  );

  return compact ? (
    <div className="space-y-2" data-testid="guardian-notice-fields">
      {fields}
    </div>
  ) : (
    <InsetPanel
      framed
      className="space-y-3"
      data-testid="guardian-notice-fields"
    >
      {fields}
    </InsetPanel>
  );
}
