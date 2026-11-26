"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import {
  Copy,
  ClipboardPaste,
  UtensilsCrossed,
  Plus,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import { StickyActionBar } from "~/components/ui/sticky-action-bar";
import { ConfirmationModal } from "~/components/ui/modal";
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import { InsetPanel } from "~/components/ui/inset-panel";
import { ConfirmDeleteModal } from "~/components/ui/confirm-delete-modal";
import { OverflowMenu } from "~/components/ui/page-header/OverflowMenu";
import { PlanningContextBar } from "~/components/ui/planning/planning-context-bar";
import { TenantPage } from "~/components/ui/tenant-page";
import { SectionCard } from "~/components/ui/section-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { Textarea } from "~/components/ui/textarea";
import { hasPermission, isAdmin } from "~/lib/auth-utils";
import {
  useApiErrorDisplay,
  useApiFormError,
  useToast,
} from "~/contexts/ToastContext";
import { isReadStateRefusal } from "~/lib/api-error";
import { formatWeekLabel, parseISODate, toISODate } from "~/lib/date-helpers";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import {
  getMealPlanWeek,
  mondayOf,
  setDay,
  workWeekDates,
  type DishInput,
  type MealOrderDay,
  type MealPlanDay,
  type MealPlanDish,
} from "~/lib/meal-plan-api";
import { createLogger } from "~/lib/logger";
import { useNavigationGuard } from "~/lib/hooks/use-navigation-guard";
import { useRefreshAfterWrite } from "~/lib/hooks/use-refresh-after-write";
import {
  useReadDraftForm,
  useSwrResourceLoadError,
} from "~/lib/hooks/use-swr-load-error";
import { useSWRAuth } from "~/lib/swr";
import { useDraftOn } from "~/lib/swr/read-draft";
import { tenantListKeys } from "~/lib/swr/tenant-list-keys";
import {
  useMealPlanEnabled,
  useMealRegistrationEnabled,
} from "~/lib/tenant-context";
import { useTenantRouter } from "~/lib/tenant-router";
import { MealParticipantList } from "~/components/meal-plan/meal-participant-list";
import { MealCaterer } from "~/components/meal-plan/meal-caterer";
import { MealBillingReleaseLink } from "~/components/meal-plan/meal-billing-release-link";
import { MealOrderWeek } from "~/components/meal-plan/meal-order-week";
import {
  MealCancellationModal,
  MealCancellationNotice,
  useMealCancellations,
  useRestoreMeal,
} from "~/components/meal-plan/meal-cancellation";
import {
  MealAllergenLegend,
  MealAllergenMarks,
  MealAllergenSelect,
} from "~/components/meal-plan/meal-allergens";
import {
  normalizeMealAllergens,
  usedMealAllergens,
  type MealAllergen,
} from "~/lib/meal-allergens";

const logger = createLogger({ component: "MealPlanPage" });

// Borderless fields that live inside a dish card (the card is the visual
// boundary, so the fields stay clean — no box-in-box). field-sizing:content
// lets them grow so long dish names wrap instead of being clipped.
const dishFieldClass =
  "block w-full resize-none border-0 bg-transparent p-0 text-base leading-snug font-medium text-gray-900 shadow-none ring-0 placeholder:font-normal placeholder:text-gray-500 read-only:bg-transparent read-only:text-gray-900 focus:ring-0 focus:outline-none focus-visible:ring-0 [field-sizing:content]";
const noteFieldClass =
  "mt-1.5 block w-full resize-none border-0 bg-transparent p-0 text-sm leading-snug text-gray-500 shadow-none ring-0 placeholder:text-gray-500 read-only:bg-transparent focus:ring-0 focus:outline-none focus-visible:ring-0 [field-sizing:content]";

interface DishDraft {
  clientId?: string;
  dish: string;
  note: string;
  allergens: MealAllergen[];
}

function createDishDraft(
  dish = "",
  note = "",
  allergens: readonly MealAllergen[] = [],
): DishDraft {
  return {
    clientId: crypto.randomUUID(),
    dish,
    note,
    allergens: [...allergens],
  };
}

function weekdayLabel(iso: string): string {
  return parseISODate(iso).toLocaleDateString("de-DE", { weekday: "long" });
}

function shortDate(iso: string): string {
  return parseISODate(iso).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
  });
}

// Normalised, comparable form of a day: blank dishes dropped, fields trimmed.
function normalizeDay(rows: DishDraft[]): DishDraft[] {
  return rows
    .map((r) => ({
      dish: r.dish.trim(),
      note: r.note.trim(),
      allergens: normalizeMealAllergens(r.allergens),
    }))
    .filter((r) => r.dish !== "");
}

// The wire form of a normalised day.
function dishInputs(rows: DishDraft[]): DishInput[] {
  return rows.map((d) => ({
    dish: d.dish,
    note: d.note === "" ? null : d.note,
    allergens: d.allergens,
  }));
}

function dayHasContent(rows: DishDraft[] | undefined): boolean {
  return normalizeDay(rows ?? []).length > 0;
}

/** Ein Gericht mit Inhalt: Entfernen fragt nach, eine leere Zeile nicht. */
function rowHasContent(row: DishDraft): boolean {
  return (
    row.dish.trim() !== "" || row.note.trim() !== "" || row.allergens.length > 0
  );
}

function draftRows(dishes: readonly MealPlanDish[] | undefined): DishDraft[] {
  return dishes?.length
    ? dishes.map((d) => createDishDraft(d.dish, d.note ?? "", d.allergens))
    : [createDishDraft()];
}

// Build editable drafts (always at least one empty row per day) from the
// stored days.
function draftsFromDays(
  days: MealPlanDay[],
  dates: string[],
): Record<string, DishDraft[]> {
  const byDate = new Map(days.map((day) => [day.date, day.dishes]));
  const next: Record<string, DishDraft[]> = {};
  for (const date of dates) next[date] = draftRows(byDate.get(date));
  return next;
}

// The version of each stored day, which its save sends back (ADR 0311).
function versionsFromDays(days: MealPlanDay[]): Record<string, string> {
  return Object.fromEntries(days.map((day) => [day.date, day.version]));
}

type WeekDrafts = Record<string, DishDraft[]>;

// The stored dishes of each day in the dirty check's normalised form.
function storedRows(
  days: MealPlanDay[] | undefined,
  dates: string[],
): Record<string, DishDraft[]> {
  if (days === undefined) return {};
  const built = draftsFromDays(days, dates);
  const rows: Record<string, DishDraft[]> = {};
  for (const date of dates) rows[date] = normalizeDay(built[date]!);
  return rows;
}

// Whether two drafts hold the same input. Any row with content counts, a
// note without a dish too: a newer read replaces only a draft without it.
function sameWeekInput(a: WeekDrafts, b: WeekDrafts): boolean {
  const input = (drafts: WeekDrafts) =>
    Object.keys(drafts)
      .sort()
      .map((date) => [
        date,
        (drafts[date] ?? []).filter(rowHasContent).map((row) => ({
          dish: row.dish,
          note: row.note,
          allergens: normalizeMealAllergens(row.allergens),
        })),
      ]);
  return JSON.stringify(input(a)) === JSON.stringify(input(b));
}

// After a refusal, the drafts on the stored week `to`: a day keeps its
// unsaved draft only while it is stored as the page read it (`from`); every
// other day, the refused one included, shows the stored plan, so
// „Speichern“ never replaces a change the person has not seen.
function rebaseWeek(
  draft: WeekDrafts,
  from: MealPlanDay[],
  to: MealPlanDay[],
  dates: string[],
): WeekDrafts {
  const read = storedRows(from, dates);
  const readVersions = versionsFromDays(from);
  const storedVersions = versionsFromDays(to);
  const stored = draftsFromDays(to, dates);
  const next: WeekDrafts = {};
  for (const date of dates) {
    const unsaved =
      JSON.stringify(normalizeDay(draft[date] ?? [])) !==
      JSON.stringify(read[date] ?? []);
    next[date] =
      unsaved && storedVersions[date] === readVersions[date]
        ? (draft[date] ?? stored[date]!)
        : stored[date]!;
  }
  return next;
}

// The week as the save's answers store it: each saved day replaces the
// day it was read as.
function withSavedDays(
  base: MealPlanDay[],
  saved: MealPlanDay[],
): MealPlanDay[] {
  const byDate = new Map(base.map((day) => [day.date, day]));
  for (const day of saved) byDate.set(day.date, day);
  return [...byDate.values()];
}

// A save that failed after some days were stored: the page must read the
// stored week before it sends again, as after a refusal.
class PartlySaved extends Error {
  constructor(cause: unknown) {
    super("meal plan week saved in part", { cause });
  }
}

export default function MealPlanPage() {
  const cancellationT = useTranslations("mealCancellation");
  const toast = useToast();
  const router = useTenantRouter();
  // Gate initial fetch on session readiness. The client token lags one tick
  // after hard reload/direct navigation, so a request otherwise races auth,
  // visibly fails, and never retries.
  // `required` redirects an absent/expired session instead of hanging on the
  // loading skeleton. Use the tenant router; redirect() cannot navigate from
  // this client hook callback.
  const { data: session, status } = useSession({
    required: true,
    onUnauthenticated() {
      router.push("/");
    },
  });

  // The page is reachable with meals:read, but writing a day requires
  // meals:manage (the backend PUT/DELETE routes 403 otherwise). Readers get a
  // view-only plan: no edit, copy, paste, clear, add/remove, "Vorwoche
  // übernehmen", or save controls — so they never hit a guaranteed 403. The
  // exports need meals:orders, a child's registration changed by
  // the school meals:register (#3873). Mirror the nav's admin-OR-permission
  // gate.
  const canReadPlan = isAdmin(session) || hasPermission(session, "meals:read");
  const canEdit = isAdmin(session) || hasPermission(session, "meals:manage");
  const mealPlanEnabled = useMealPlanEnabled();
  const mealRegistrationEnabled = useMealRegistrationEnabled();
  // Die Bestellung der Woche braucht nur die Zahlen (#3873).
  const canReadOrders =
    status === "authenticated" &&
    mealRegistrationEnabled &&
    (isAdmin(session) || hasPermission(session, "meals:read"));
  const canReadParticipants =
    status === "authenticated" &&
    mealRegistrationEnabled &&
    (isAdmin(session) || hasPermission(session, "meals:orders"));
  const canRegister =
    status === "authenticated" &&
    mealRegistrationEnabled &&
    (isAdmin(session) || hasPermission(session, "meals:register"));

  // weekOffset: number of weeks from the current week (0 = this week, can go
  // negative for past weeks or beyond +1 for planning ahead).
  const [weekOffset, setWeekOffset] = useState(0);
  // An explicit read of the shown week (after a save, „Verwerfen & neu laden“).
  const [reloading, setReloading] = useState(false);
  // True once the first week has loaded. Subsequent week switches keep the
  // current grid on screen (dimmed) instead of flashing the skeleton.
  const [hasLoaded, setHasLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveErrors = useApiFormError();
  const { clear: clearSaveError } = saveErrors;
  const { show: showActionError } = useApiErrorDisplay();
  // „Wiederholen“ läuft mit dem aktuellen Stand der Seite (Woche, Entwürfe).
  const retrySaveRef = useRef<() => void>(() => undefined);
  const retryCopyPrevRef = useRef<() => void>(() => undefined);
  const [copyingPrev, setCopyingPrev] = useState(false);
  const [clipboard, setClipboard] = useState<DishDraft[] | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    date: string;
    idx: number;
  } | null>(null);
  // Holds the week the user wants to switch to while unsaved changes block it.
  const [pendingOffset, setPendingOffset] = useState<number | null>(null);
  const [confirmReload, setConfirmReload] = useState(false);
  const [confirmCopyPrev, setConfirmCopyPrev] = useState(false);

  // Meal-plan rows use Berlin calendar dates; derive the displayed week there and follow Berlin midnight, matching the parent meal-plan page.
  const today = useBerlinToday();

  const mondayISO = useMemo(() => {
    const base = parseISODate(today);
    base.setDate(base.getDate() + weekOffset * 7);
    return mondayOf(base);
  }, [today, weekOffset]);

  const weekDates = useMemo(() => workWeekDates(mondayISO), [mondayISO]);
  const [orderDays, setOrderDays] = useState<MealOrderDay[] | null>(null);
  useLayoutEffect(() => setOrderDays(null), [mondayISO]);
  // Die Tage ohne Mittagessen (#7656); nur wer verwaltet, trägt sie ein.
  const cancellationResource = useMealCancellations(
    mondayISO,
    weekDates[weekDates.length - 1] ?? mondayISO,
    status === "authenticated" && canReadPlan && mealPlanEnabled === true,
  );
  const cancellations = cancellationResource.reasons;
  const [cancelDate, setCancelDate] = useState<string | null>(null);
  const restoreMeal = useRestoreMeal();
  const weekKey =
    status === "authenticated" && canReadPlan && mealPlanEnabled
      ? tenantListKeys.mealPlanWeek(mondayISO)
      : null;
  // A revisit shows the cached week at once and reads it again in the
  // background (no deduplication). Each save sends the version of the day
  // this page read; the backend refuses a day someone stored differently
  // since (general.changed_since_read), so an older cached answer never
  // overwrites a colleague's change.
  const week = useSWRAuth(weekKey, () => getMealPlanWeek(mondayISO), {
    keepPreviousData: false,
    dedupingInterval: 0,
  });
  const weekData = week.data;
  // True when the week never loaded. The grid is then NOT shown: there is
  // no read state to edit against, so we surface an error + retry instead.
  // A failed background read keeps the shown week.
  const { error: loadError } = useSwrResourceLoadError(
    [week],
    "die Woche im Speiseplan",
    () => week.mutate(),
  );
  const hasLoadError = Boolean(loadError);
  const loading =
    weekKey === null ||
    reloading ||
    (weekData === undefined && (!week.error || week.isValidating));

  // The loaded week is an edit form (ADR 0311): one draft per opening of a
  // week, its token the version of each stored day. An untouched draft
  // follows a newer read; a touched one keeps the days it was edited on.
  const { mutate: mutateWeek } = week;
  const readWeek = useCallback(
    () =>
      mutateWeek(getMealPlanWeek(mondayISO), {
        revalidate: false,
      }),
    [mutateWeek, mondayISO],
  );
  const weekDraft = useDraftOn<
    MealPlanDay[],
    WeekDrafts,
    Record<string, string>,
    MealPlanDay[]
  >(
    {
      opening: weekKey,
      data: weekData,
      reload: readWeek,
      write: (stored) => mutateWeek(stored, { revalidate: false }),
    },
    {
      token: versionsFromDays,
      toDraft: (days) => draftsFromDays(days, weekDates),
      same: sameWeekInput,
      rebase: (draft, from, to) => rebaseWeek(draft, from, to, weekDates),
      answer: (saved, base) => withSavedDays(base, saved),
      isRefusal: (error) =>
        isReadStateRefusal(error) || error instanceof PartlySaved,
    },
  );
  const draftForm = useReadDraftForm(
    weekDraft,
    saveErrors,
    "die Woche im Speiseplan",
  );
  const { setDraft: setDrafts } = weekDraft;
  const drafts = useMemo(() => weekDraft.draft ?? {}, [weekDraft.draft]);
  // The stored days the draft rests on, as the dirty check compares them.
  const originals = useMemo(
    () => storedRows(weekDraft.base, weekDates),
    [weekDraft.base, weekDates],
  );
  const weekLoaded = weekDraft.base !== undefined;
  if (weekLoaded && !hasLoaded) setHasLoaded(true);
  // Legende unter dem Plan: nur die Buchstaben, die diese Woche vorkommen.
  const weekAllergens = usedMealAllergens(
    weekDates.flatMap((date) => drafts[date] ?? []),
  );

  // „Verwerfen & neu laden“: the read of the stored week replaces the
  // drafts once it arrived, also over input typed since.
  const discardOnRead = useRef<MealPlanDay[] | undefined>(undefined);
  const { discard: discardDraft } = weekDraft;
  useLayoutEffect(() => {
    if (discardOnRead.current === undefined) return;
    if (weekData === undefined || weekData === discardOnRead.current) return;
    discardOnRead.current = undefined;
    discardDraft();
  }, [weekData, discardDraft]);

  // Rejects on failure, so after a save the caller keeps the week on screen
  // (#6652).
  const afterSave = useRefreshAfterWrite(
    "die Anzeige des Speiseplans",
    async () => {
      if (!weekKey) return;
      setReloading(true);
      try {
        await readWeek();
      } finally {
        setReloading(false);
      }
    },
  );

  const changedDays = useMemo(
    () =>
      weekDates.filter(
        (date) =>
          JSON.stringify(normalizeDay(drafts[date] ?? [])) !==
          JSON.stringify(originals[date] ?? []),
      ),
    [weekDates, drafts, originals],
  );
  const isDirty = changedDays.length > 0;

  // Freeze all edit controls while a save, an explicit read of the week, a
  // read after a refusal, or "Vorwoche übernehmen" is in flight. The read
  // after it replaces the drafts from the backend; an edit made after the
  // request started would otherwise be silently overwritten when it
  // resolves. canEdit gates *who* may edit; editingLocked gates *when*.
  const readingAfterRefusal =
    weekDraft.status === "refused" || weekDraft.status === "reloading";
  const editingLocked = saving || copyingPrev || loading || readingAfterRefusal;
  const canEditNow = canEdit && !editingLocked;

  // Warn before discarding unsaved changes — both on hard unloads (tab close /
  // reload) and on in-app navigation (clicking a sidebar/header link), which
  // does a client-side route change that beforeunload never sees.
  const { pendingHref, confirmNavigation, cancelNavigation } =
    useNavigationGuard(isDirty);

  const updateDish = (
    date: string,
    idx: number,
    field: "dish" | "note",
    value: string,
  ) => {
    setDrafts((prev) => {
      const rows = [...(prev[date] ?? [])];
      rows[idx] = { ...rows[idx]!, [field]: value };
      return { ...prev, [date]: rows };
    });
  };

  const updateAllergens = (date: string, idx: number, codes: string[]) => {
    setDrafts((prev) => {
      const rows = [...(prev[date] ?? [])];
      rows[idx] = { ...rows[idx]!, allergens: normalizeMealAllergens(codes) };
      return { ...prev, [date]: rows };
    });
  };

  const addRow = (date: string) => {
    setDrafts((prev) => ({
      ...prev,
      [date]: [...(prev[date] ?? []), createDishDraft()],
    }));
  };

  const removeRow = (date: string, idx: number) => {
    setDrafts((prev) => {
      const rows = (prev[date] ?? []).filter((_, i) => i !== idx);
      return { ...prev, [date]: rows.length ? rows : [createDishDraft()] };
    });
  };

  // A dish with content goes through a confirmation; an empty row is removed
  // straight away (nothing to lose).
  const requestRemove = (date: string, idx: number) => {
    const row = drafts[date]?.[idx];
    if (row && rowHasContent(row)) {
      setDeleteTarget({ date, idx });
    } else {
      removeRow(date, idx);
    }
  };

  const confirmRemove = () => {
    if (deleteTarget) removeRow(deleteTarget.date, deleteTarget.idx);
    setDeleteTarget(null);
  };

  // --- Per-day copy / paste / clear -------------------------------------
  const copyDay = (date: string) => {
    setClipboard(normalizeDay(drafts[date] ?? []).map((r) => ({ ...r })));
    toast.success(`Die Gerichte vom ${weekdayLabel(date)} sind kopiert.`);
  };

  const pasteDay = (date: string) => {
    if (!clipboard) return;
    const rows = clipboard.length
      ? clipboard.map((row) =>
          createDishDraft(row.dish, row.note, row.allergens),
        )
      : [createDishDraft()];
    setDrafts((prev) => ({ ...prev, [date]: rows }));
  };

  const clearDay = (date: string) => {
    setDrafts((prev) => ({ ...prev, [date]: [createDishDraft()] }));
  };

  // --- Week navigation (guarded against unsaved changes) ----------------
  const attemptWeekChange = (next: number) => {
    if (next === weekOffset) return;
    // Block week switches while a save (or prev-week copy) is in flight. The
    // post-save reload is bound to the week that was on screen when Save was
    // clicked; switching mid-save would let that stale reload win the
    // latest-wins token race and write the old week's data over the new week,
    // leaving an unloaded/blank grid that the next edit could overwrite.
    if (saving || copyingPrev || loading) return;
    if (isDirty) {
      setPendingOffset(next);
    } else {
      setWeekOffset(next);
    }
  };

  // The draft belongs to the week's opening: another week opens its own,
  // and the discarded edits do not come back when the person returns.
  const confirmWeekChange = () => {
    if (pendingOffset !== null) setWeekOffset(pendingOffset);
    setPendingOffset(null);
  };

  const reloadDiscardingDrafts = () => {
    discardOnRead.current = weekData;
    void afterSave.refresh().then((read) => {
      // A failed read shows as afterSave.error; the drafts stay.
      if (!read) discardOnRead.current = undefined;
    });
  };

  const retryAfterSave = () => {
    if (editingLocked) return;
    if (isDirty) setConfirmReload(true);
    else void afterSave.refresh();
  };

  // --- Copy the previous week's plan into the current week ---------------
  const doCopyPreviousWeek = useCallback(async () => {
    setCopyingPrev(true);
    try {
      const prevMonday = (() => {
        const base = parseISODate(mondayISO);
        base.setDate(base.getDate() - 7);
        return toISODate(base);
      })();
      const prevDates = workWeekDates(prevMonday);
      // Only the dishes are copied: each day of this week keeps the version
      // it was read with, so its save still checks this week's stored day.
      const previous = draftsFromDays(
        await getMealPlanWeek(prevMonday),
        prevDates,
      );
      setDrafts((prev) => {
        const next = { ...prev };
        prevDates.forEach((pd, i) => {
          next[weekDates[i]!] = previous[pd]!;
        });
        return next;
      });
      toast.success(
        "Die Gerichte der Vorwoche sind übernommen. Bitte speichere den Plan.",
      );
    } catch (err) {
      logger.error("meal_plan_copy_prev_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void showActionError(err, {
        object: "die Vorwoche im Speiseplan",
        retry: () => retryCopyPrevRef.current(),
      });
    } finally {
      setCopyingPrev(false);
    }
  }, [mondayISO, weekDates, toast, showActionError, setDrafts]);
  useLayoutEffect(() => {
    retryCopyPrevRef.current = () => void doCopyPreviousWeek();
  });

  // Die Rückfrage und der Satz am Knopf hängen an derselben Bedingung.
  const weekHasContent = weekDates.some((d) => dayHasContent(drafts[d]));
  const requestCopyPreviousWeek = () => {
    if (weekHasContent) {
      setConfirmCopyPrev(true);
    } else {
      void doCopyPreviousWeek();
    }
  };

  // --- Save / discard ---------------------------------------------------
  const discard = () => {
    clearSaveError();
    weekDraft.discard();
  };

  const handleSave = async () => {
    // After a refusal nothing is sent until the stored week is read.
    if (!draftForm.begin()) return;
    const stored = originals;
    setSaving(true);
    // Each setDay is its own backend transaction, so a mid-loop failure
    // leaves the already-sent days committed: the draft then counts as
    // refused and rests on the stored week read again (`PartlySaved`).
    const result = await weekDraft.submit(async (versions, draft) => {
      const saved: MealPlanDay[] = [];
      for (const date of weekDates) {
        const next = normalizeDay(draft[date] ?? []);
        if (JSON.stringify(next) === JSON.stringify(stored[date] ?? [])) {
          continue;
        }
        try {
          saved.push(
            await setDay(date, dishInputs(next), versions[date] ?? ""),
          );
        } catch (err) {
          if (saved.length > 0 && !isReadStateRefusal(err)) {
            throw new PartlySaved(err);
          }
          throw err;
        }
      }
      return saved;
    });
    if (!result.ok) {
      if (!result.skipped) {
        const err =
          result.error instanceof PartlySaved
            ? result.error.cause
            : result.error;
        logger.error("meal_plan_save_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        // Der Fehler steht über dem Wochenplan (Bauart 2 Regel 5), nicht als
        // Toast: die noch ungespeicherten Tage bleiben sichtbar markiert.
        // A changed day needs the person's decision, not the same request
        // again: `reload` reads the stored week; a day keeps its draft only
        // while it is stored as this page read it. A failed read is shown
        // with a retry of the read alone, and saving waits for it
        // (ADR 0311).
        void saveErrors.show(err, {
          object: "die Woche im Speiseplan",
          retry: () => retrySaveRef.current(),
          reload: result.reload,
        });
      }
      setSaving(false);
      return;
    }
    toast.success("Der Speiseplan ist gespeichert.");
    // Saving stays on during the reload: no edit or week switch can slip in
    // before the stored week replaces the drafts. The saved days are stored
    // even when it fails; their answers are the draft's base.
    await afterSave.refresh();
    setSaving(false);
  };
  useLayoutEffect(() => {
    retrySaveRef.current = () => void handleSave();
  });

  // Dasselbe Wochenetikett wie Dienstplan, Zeiterfassung und Betreuungsplan
  // ("KW 41 · 05.10.–09.10.2026"), hier für die fünf Essenstage.
  const weekLabel = formatWeekLabel(
    parseISODate(weekDates[0]!),
    parseISODate(weekDates[4]!),
  );
  const isCurrentWeek = weekOffset === 0;
  // Kein Wochenwechsel, solange eine Woche lädt, gespeichert oder aus der
  // Vorwoche übernommen wird (siehe attemptWeekChange).
  const weekSwitchLocked = loading || saving || copyingPrev;

  // Statuszeile unter dem Titel: wie viele der fünf Wochentage schon ein
  // Gericht haben. Kalenderwoche und Zeitraum stehen im Bedienband direkt
  // darunter und werden nicht wiederholt (TENANT-PAGE-SPEC Regel 3). Die
  // Zahl kommt aus den bereits gespeicherten Tagen der geladenen Woche.
  const plannedDays = weekDates.filter(
    (date) => (originals[date]?.length ?? 0) > 0,
  ).length;
  const initialLoading = canReadPlan && loading && !hasLoaded;
  // Die Zahl der geplanten Tage gibt es nur für eine geladene Woche: nach
  // einem Ladefehler stünde sonst "0 von 5 Tagen geplant" da (#2517).
  const statusLine = weekLoaded
    ? `${plannedDays} von ${weekDates.length} Tagen geplant`
    : null;

  return (
    <TenantPage
      title="Speiseplan"
      info="Hier steht, was es in der gewählten Woche zu essen gibt. Oben wechselst du die Woche. Was du hier speicherst, sehen Eltern sofort."
      actions={<MealBillingReleaseLink />}
      stats={statusLine}
      statsLoading={initialLoading}
      loading={initialLoading}
      error={loadError}
      // Bauart 3 Regel 1: der Wochenwechsel steuert Wochenplan und
      // Bestellung und sitzt darum im Bedienband der Kopfkarte.
      searchSlot={
        canReadPlan ? (
          <PlanningContextBar
            withoutContextRow
            dateLabel={weekLabel}
            onPrevious={
              weekSwitchLocked
                ? undefined
                : () => attemptWeekChange(weekOffset - 1)
            }
            onNext={
              weekSwitchLocked
                ? undefined
                : () => attemptWeekChange(weekOffset + 1)
            }
            previousLabel="Vorherige Woche"
            nextLabel="Nächste Woche"
            onToday={
              isCurrentWeek || weekSwitchLocked
                ? undefined
                : () => attemptWeekChange(0)
            }
            todayLabel="Diese Woche"
          />
        ) : undefined
      }
      overlays={
        <>
          {/* Löschen läuft portalweit über dasselbe Bauteil. */}
          <ConfirmDeleteModal
            isOpen={deleteTarget !== null}
            title="Gericht entfernen"
            description={
              deleteTarget
                ? `„${drafts[deleteTarget.date]?.[deleteTarget.idx]?.dish.trim() || "Dieses Gericht"}“ wird aus dem Plan entfernt. Die Änderung wird mit „Speichern“ übernommen.`
                : ""
            }
            gate={{ mode: "twoStep", firstStepLabel: "Entfernen" }}
            confirmLabel="Entfernen"
            confirmTooltip="Entfernt das Gericht, gespeichert wird erst mit „Speichern“."
            onConfirm={confirmRemove}
            onClose={() => setDeleteTarget(null)}
            loading={false}
            error=""
          />

          <ConfirmationModal
            isOpen={pendingOffset !== null || confirmReload}
            onClose={() => {
              setPendingOffset(null);
              setConfirmReload(false);
            }}
            onConfirm={() => {
              if (confirmReload) {
                setConfirmReload(false);
                reloadDiscardingDrafts();
              } else confirmWeekChange();
            }}
            title="Ungespeicherte Änderungen"
            confirmText={
              confirmReload ? "Verwerfen & neu laden" : "Verwerfen & wechseln"
            }
            cancelText="Hierbleiben"
            confirmVariant="danger"
            confirmTooltip={
              confirmReload
                ? "Verwirft deine Änderungen sofort und holt die gespeicherte Woche."
                : "Verwirft deine Änderungen sofort und wechselt die Woche."
            }
          >
            <p className="text-sm text-gray-600">
              {confirmReload
                ? "Du hast Änderungen, die noch nicht gespeichert sind. Beim Neuladen gehen sie verloren."
                : "Du hast Änderungen in dieser Woche, die noch nicht gespeichert sind. Beim Wochenwechsel gehen sie verloren."}
            </p>
          </ConfirmationModal>

          <ConfirmationModal
            isOpen={pendingHref !== null}
            onClose={cancelNavigation}
            onConfirm={confirmNavigation}
            title="Ungespeicherte Änderungen"
            confirmText="Verwerfen & verlassen"
            confirmTooltip="Verwirft deine Änderungen sofort und verlässt die Seite."
            cancelText="Hierbleiben"
            confirmVariant="danger"
          >
            <p className="text-sm text-gray-600">
              Du hast Änderungen, die noch nicht gespeichert sind. Beim
              Verlassen der Seite gehen sie verloren.
            </p>
          </ConfirmationModal>

          <ConfirmationModal
            isOpen={confirmCopyPrev}
            onClose={() => setConfirmCopyPrev(false)}
            onConfirm={() => {
              setConfirmCopyPrev(false);
              void doCopyPreviousWeek();
            }}
            title="Vorwoche übernehmen?"
            confirmText="Übernehmen"
            confirmTooltip="Ersetzt diese Woche, gespeichert wird erst mit „Speichern“."
            cancelText="Abbrechen"
          >
            <p className="text-sm text-gray-600">
              Die aktuelle Woche wird mit dem Plan der Vorwoche überschrieben.
              Die Änderung wird erst mit „Speichern“ übernommen.
            </p>
          </ConfirmationModal>
        </>
      }
    >
      <FormErrorAlert message={saveErrors.error} />
      <LoadErrorAlert error={draftForm.loadError} className="mb-4" />
      <LoadErrorAlert error={cancellationResource.loadError} className="mb-4" />
      <LoadErrorAlert
        error={
          afterSave.error && {
            ...afterSave.error,
            retry: afterSave.error.retry && {
              ...afterSave.error.retry,
              onClick: retryAfterSave,
            },
          }
        }
        className="mb-4"
      />
      {/* Eine Karte für den Wochenplan: Titel, Erklärung und „Vorwoche
          übernehmen“ im Kopf, die fünf Tage randlos unter einer Trennlinie.
          overflow visible: die Allergen-Auswahl eines Gerichts darf über die
          Unterkante der Karte hinausragen. */}
      <SectionCard
        className={canReadPlan ? undefined : "hidden"}
        overflow="visible"
        title="Wochenplan"
        description="Pro Tag ein oder mehrere Gerichte mit Allergenen und optionalem Hinweis. Eltern sehen den Plan im Elternportal."
        actions={
          canEdit ? (
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={requestCopyPreviousWeek}
              disabled={loading || saving || copyingPrev || hasLoadError}
              tooltip={
                weekHasContent
                  ? "Ersetzt diese Woche durch die Vorwoche, moto fragt vorher nach."
                  : "Übernimmt die Vorwoche, gespeichert wird erst mit „Speichern“."
              }
              disabledReason={
                hasLoadError && !loading
                  ? "Die Woche ist nicht geladen, versuche es zuerst erneut."
                  : undefined
              }
              isLoading={copyingPrev}
              loadingText="Übernehmen…"
            >
              <Copy className="mr-2 h-4 w-4" />
              Vorwoche übernehmen
            </Button>
          ) : undefined
        }
      >
        <div
          className={`compact:-mx-4 compact:-mb-4 -mx-5 -mb-5 border-t border-gray-200 transition-opacity duration-200 max-sm:-mx-4 max-sm:-mb-4 ${
            loading ? "opacity-50" : "opacity-100"
          }`}
        >
          <div className="grid grid-cols-1 divide-y divide-gray-200 md:grid-cols-5 md:divide-y-0">
            {weekDates.map((date, dayIndex) => {
              const rows = drafts[date] ?? [];
              const isToday = date === today;
              const hasContent = dayHasContent(rows);
              const cancelledReason = cancellations.get(date);
              return (
                <div
                  key={date}
                  data-meal-day-column
                  className={`flex flex-col border-gray-200 md:border-r md:last:border-r-transparent ${isToday ? "bg-moto-green/[0.04]" : ""}`}
                >
                  <div
                    className={`flex items-center justify-between gap-2 border-b px-4 py-3 ${
                      isToday ? "border-moto-green/30" : "border-gray-200"
                    }`}
                  >
                    <div>
                      <div className="text-sm font-semibold text-gray-900">
                        {weekdayLabel(date)}
                      </div>
                      <div className="text-xs text-gray-500">
                        {shortDate(date)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {isToday && (
                        <StatusBadge label="Heute" tone="green" compact />
                      )}
                      {canEdit && (
                        <OverflowMenu
                          ariaLabel={`Aktionen für ${weekdayLabel(date)}`}
                          triggerSize="sm"
                          matchContainerSelector="[data-meal-day-column]"
                          items={[
                            {
                              label: "Tag kopieren",
                              icon: <Copy className="h-4 w-4" />,
                              description:
                                "Merkt sich die Gerichte, um sie an einem anderen Tag einzufügen.",
                              onClick: () => copyDay(date),
                              disabled: !hasContent || editingLocked,
                            },
                            {
                              label: "Einfügen",
                              icon: <ClipboardPaste className="h-4 w-4" />,
                              description:
                                "Ersetzt die Gerichte dieses Tags durch die kopierten.",
                              onClick: () => pasteDay(date),
                              disabled: clipboard === null || editingLocked,
                            },
                            {
                              label: "Tag leeren",
                              icon: <Trash2 className="h-4 w-4" />,
                              description:
                                "Leert den Tag sofort, gespeichert wird erst mit „Speichern“.",
                              onClick: () => clearDay(date),
                              destructive: true,
                              disabled: !hasContent || editingLocked,
                            },
                            // Ein vergangener Tag bleibt, wie er war (#7656).
                            ...(date < today ||
                            !cancellationResource.loaded ||
                            !canCancelMeal(date, orderDays)
                              ? []
                              : cancelledReason === undefined
                                ? [
                                    {
                                      label: cancellationT("cancelAction"),
                                      icon: (
                                        <UtensilsCrossed className="h-4 w-4" />
                                      ),
                                      description:
                                        cancellationT("cancelDescription"),
                                      onClick: () => setCancelDate(date),
                                    },
                                  ]
                                : [
                                    {
                                      label:
                                        cancellationT("changeReasonAction"),
                                      icon: (
                                        <UtensilsCrossed className="h-4 w-4" />
                                      ),
                                      description: cancellationT(
                                        "changeReasonDescription",
                                      ),
                                      onClick: () => setCancelDate(date),
                                    },
                                    {
                                      label: cancellationT("restoreAction"),
                                      icon: (
                                        <UtensilsCrossed className="h-4 w-4" />
                                      ),
                                      description:
                                        cancellationT("restoreDescription"),
                                      onClick: () => void restoreMeal(date),
                                    },
                                  ]),
                          ]}
                        />
                      )}
                    </div>
                  </div>

                  <div className="flex flex-1 flex-col gap-3 p-3">
                    {cancelledReason !== undefined ? (
                      <MealCancellationNotice reason={cancelledReason} />
                    ) : null}
                    {rows.map((row, idx) => (
                      <InsetPanel
                        key={row.clientId}
                        tone="white"
                        padding="md"
                        className="group relative min-h-20 pr-10 focus-within:outline-2 focus-within:outline-gray-600 max-sm:pr-10 pointer-coarse:pr-12 max-sm:pointer-coarse:pr-12"
                      >
                        <Textarea
                          rows={1}
                          className={dishFieldClass}
                          value={row.dish}
                          placeholder="Gericht eintragen…"
                          readOnly={!canEditNow}
                          onChange={(e) =>
                            updateDish(date, idx, "dish", e.target.value)
                          }
                        />
                        <Textarea
                          rows={1}
                          className={noteFieldClass}
                          value={row.note}
                          placeholder="Hinweis (optional)"
                          readOnly={!canEditNow}
                          onChange={(e) =>
                            updateDish(date, idx, "note", e.target.value)
                          }
                        />
                        {canEditNow ? (
                          <MealAllergenSelect
                            value={row.allergens}
                            // Donnerstag und Freitag öffnen nach links, damit
                            // das Menü im Fenster bleibt.
                            menuAlign={dayIndex >= 3 ? "end" : "start"}
                            onChange={(codes) =>
                              updateAllergens(date, idx, codes)
                            }
                            className="mt-2"
                          />
                        ) : (
                          <MealAllergenMarks
                            allergens={row.allergens}
                            className="mt-2"
                          />
                        )}
                        {canEdit && (rows.length > 1 || rowHasContent(row)) && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="Gericht entfernen"
                            onClick={() => requestRemove(date, idx)}
                            tooltip={
                              rowHasContent(row)
                                ? "Entfernt das Gericht, moto fragt vorher nach."
                                : "Entfernt die leere Zeile sofort."
                            }
                            disabled={editingLocked}
                            className="absolute top-1 right-1"
                          >
                            <X className="h-4 w-4" aria-hidden />
                          </Button>
                        )}
                      </InsetPanel>
                    ))}

                    {canEdit && (
                      <Button
                        type="button"
                        variant="dashed"
                        size="md"
                        onClick={() => addRow(date)}
                        tooltip="Fügt diesem Tag ein leeres Feld für ein Gericht hinzu."
                        disabled={editingLocked}
                        className="w-full gap-1"
                      >
                        <Plus className="h-4 w-4" aria-hidden />
                        Gericht
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {weekAllergens.length > 0 ? (
            <MealAllergenLegend
              allergens={weekAllergens}
              showSource={false}
              className="border-t border-gray-200 px-4 py-3"
            />
          ) : null}
        </div>
      </SectionCard>

      {canEdit ? (
        <MealCancellationModal
          date={cancelDate}
          initialReason={
            cancelDate ? (cancellations.get(cancelDate) ?? "") : ""
          }
          onClose={() => setCancelDate(null)}
        />
      ) : null}

      {canReadOrders ? (
        <MealOrderWeek
          mondayISO={mondayISO}
          canExportMonth={canReadParticipants}
          onDaysLoaded={setOrderDays}
        />
      ) : null}

      {/* Der Caterer der Schule (ADR 0077): nur wer den Speiseplan
          verwaltet, lädt ihn ein oder beendet die Belieferung. Er steht
          neben der Bestellung, die er beliefert. */}
      {canEdit && mealRegistrationEnabled === true ? (
        <MealCaterer canManageSupply={isAdmin(session)} />
      ) : null}

      {/* Die Tagesliste ist die längste Fläche und steht darum zuletzt:
          sie wächst bis zur Unterkante des Bildschirms. */}
      {canReadParticipants || canRegister ? (
        <MealParticipantList
          canRegister={canRegister}
          canExport={canReadParticipants}
        />
      ) : null}

      {/* Save bar — only while there are unsaved changes. */}
      {canEdit && isDirty && !loading && !hasLoadError && (
        <StickyActionBar
          summary={`${changedDays.length} ${changedDays.length === 1 ? "Tag geändert" : "Tage geändert"}`}
        >
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={discard}
            disabled={saving}
            tooltip="Nimmt alle ungespeicherten Änderungen dieser Woche sofort zurück."
          >
            Verwerfen
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={handleSave}
            disabled={saving || !weekDraft.canSubmit}
            disabledReason={saving ? undefined : draftForm.waitReason}
            tooltip="Speichert die Woche, Eltern sehen den Plan im Elternportal."
            isLoading={saving}
            loadingText="Speichern…"
          >
            Speichern
          </Button>
        </StickyActionBar>
      )}
    </TenantPage>
  );
}

function canCancelMeal(
  date: string,
  orderDays: MealOrderDay[] | null,
): boolean {
  return !orderDays?.some(
    (day) => day.date === date && day.closed && !day.mealCancelled,
  );
}
