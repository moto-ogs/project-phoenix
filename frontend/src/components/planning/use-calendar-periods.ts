"use client";

/**
 * Zustand des Kalenderzeitraum-Bereichs: Laden, Modal-Steuerung und die
 * Statuszeile der Seite.
 *
 * Der Hook liegt hier und nicht im Editor, weil die Seite den Kopf trägt
 * (Titel, Statuszeile, Aktionen) und der Editor nur noch seinen Inhaltsblock.
 * Beides greift auf denselben Zustand zu, ohne ihn zweimal zu laden.
 */

import { useCallback, useMemo, useState } from "react";

import type { LinkablePhase } from "~/components/timetable/calendar-period-modal";
import type { FormErrorInput } from "~/components/ui/form-error";
import { useToast } from "~/contexts/ToastContext";
import { calendarPeriodService } from "~/lib/calendar-period-api";
import type { CalendarPeriod } from "~/lib/calendar-period-helpers";
import { berlinTodayISO } from "~/lib/date-helpers";
import {
  type Phase,
  listPhases,
  setPhaseCalendarPeriod,
} from "~/lib/enrollment-phase-api";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import { useInvalidateFamily, useSWRAuth } from "~/lib/swr";
import { enrollmentKeys } from "~/lib/swr/enrollment-keys";
import { databaseKeys } from "~/lib/swr/portal-keys";
import { tenantAdminKeys } from "~/lib/swr/tenant-admin-keys";

const logger = createLogger({ component: "CalendarPeriodsEditor" });

interface SemesterDefaults {
  name: string;
  periodType: "semester";
  startDate: string;
  endDate: string;
}

interface PeriodUsage {
  enrollmentPhaseCount: number;
  activityGroupCount: number;
  scheduleCount: number;
  studentEnrollmentCount: number;
  supervisorCount: number;
  activityInstanceCount: number;
  staffShiftSeriesCount: number;
}

export interface CalendarPeriodsState {
  readonly periods: CalendarPeriod[];
  readonly phases: Phase[];
  readonly loading: boolean;
  /** Ladefehler der Zeitraumliste mit Katalogtext, Wiederholen und
   *  Vorgangskennung (#2516). Für `LoadErrorAlert`. */
  readonly error: FormErrorInput;
  /** Der letzte Abruf ist gescheitert. Steht schon, bevor der Katalogtext in
   *  `error` angekommen ist, damit kein Leerzustand aufblitzt. */
  readonly loadFailed: boolean;
  /** Statuszeile der Kopfkarte: laufender Zeitraum, Anzahl, davon aktiv. */
  readonly statusLine: string;
  readonly modalOpen: boolean;
  readonly editing: CalendarPeriod | null;
  readonly createDefaults: Partial<SemesterDefaults> | undefined;
  readonly editingUsage: PeriodUsage | undefined;
  readonly beginCreate: () => void;
  readonly beginCreateSemester: () => void;
  readonly beginEdit: (period: CalendarPeriod) => void;
  readonly closeModal: () => void;
  readonly reload: () => Promise<void>;
  readonly handlePhaseLinkToggle: (
    phase: LinkablePhase,
    link: boolean,
  ) => Promise<void>;
}

/**
 * Schlägt das nächste Halbjahr ausgehend von heute vor. Deutsche Schulhalb-
 * jahre laufen 1.8.–31.1. (1. HJ) und 1.2.–31.7. (2. HJ); das sind reine
 * Vorbelegungen, die Daten passt die Administration im Dialog an.
 */
function nextSemesterDefaults(todayIso: string): SemesterDefaults {
  const year = Number(todayIso.slice(0, 4));
  const month = Number(todayIso.slice(5, 7));

  if (month >= 8) {
    // Im 1. Halbjahr → das 2. Halbjahr desselben Schuljahres vorschlagen.
    return {
      name: `2. Halbjahr ${year}/${String((year + 1) % 100).padStart(2, "0")}`,
      periodType: "semester",
      startDate: `${year + 1}-02-01`,
      endDate: `${year + 1}-07-31`,
    };
  }
  if (month === 1) {
    // Januar: noch 1. Halbjahr → 2. Halbjahr ab 1. Februar vorschlagen.
    return {
      name: `2. Halbjahr ${year - 1}/${String(year % 100).padStart(2, "0")}`,
      periodType: "semester",
      startDate: `${year}-02-01`,
      endDate: `${year}-07-31`,
    };
  }
  // Februar–Juli: im 2. Halbjahr → 1. Halbjahr des nächsten Schuljahres.
  return {
    name: `1. Halbjahr ${year}/${String((year + 1) % 100).padStart(2, "0")}`,
    periodType: "semester",
    startDate: `${year}-08-01`,
    endDate: `${year + 1}-01-31`,
  };
}

const NO_PHASES: Phase[] = [];

export function useCalendarPeriods(): CalendarPeriodsState {
  // Derselbe Eintrag wie im Dienst- und Betreuungsplan: Schreiben hier frischt
  // deren Zeiträume mit auf.
  const {
    data: periodData,
    error: periodsError,
    mutate: mutatePeriods,
  } = useSWRAuth(databaseKeys.calendarPeriods(), () =>
    calendarPeriodService.list(),
  );
  // Die Phasen füllen nur den Verknüpfungsbereich des Dialogs.
  // Bewusst still: ihr Fehler darf die Zeitraumliste nicht mitreißen,
  // und der Dialog hat keinen Platz für einen eigenen Ladefehler. Sein
  // Verknüpfungsbereich zeigt dann keine Phasen.
  const { data: phaseData, mutate: mutatePhases } = useSWRAuth(
    enrollmentKeys.phases(),
    listPhases,
    {
      onError: (err: unknown) =>
        logger.warn("calendar_periods_phases_load_failed", {
          error: err instanceof Error ? err.message : String(err),
        }),
    },
  );
  const load = useSwrResourceLoadError(
    [{ data: periodData, error: periodsError }],
    "die Liste der Zeiträume",
    () => mutatePeriods(),
  );
  const loadFailed = load.failure !== undefined;
  const loading = periodData === undefined && !loadFailed;
  const periods = useMemo(
    () =>
      [...(periodData ?? [])].sort((a, b) =>
        a.startDate.localeCompare(b.startDate),
      ),
    [periodData],
  );
  const phases = phaseData ?? NO_PHASES;
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CalendarPeriod | null>(null);
  const [createDefaults, setCreateDefaults] =
    useState<Partial<SemesterDefaults>>();
  const { success: toastSuccess } = useToast();

  const invalidateFamily = useInvalidateFamily();
  // Lädt nach einem Schreiben neu; die Seite bleibt dabei stehen, damit ein
  // offener Dialog nicht verschwindet.
  const reload = useCallback(async () => {
    await Promise.all([
      mutatePeriods(),
      mutatePhases(),
      invalidateFamily(tenantAdminKeys.enrollmentPhaseFamily),
    ]);
  }, [mutatePeriods, mutatePhases, invalidateFamily]);

  const beginCreate = useCallback(() => {
    setEditing(null);
    setCreateDefaults(undefined);
    setModalOpen(true);
  }, []);

  const beginCreateSemester = useCallback(() => {
    setEditing(null);
    setCreateDefaults(nextSemesterDefaults(berlinTodayISO()));
    setModalOpen(true);
  }, []);

  const beginEdit = useCallback((period: CalendarPeriod) => {
    setEditing(period);
    setCreateDefaults(undefined);
    setModalOpen(true);
  }, []);

  const closeModal = useCallback(() => setModalOpen(false), []);

  const handlePhaseLinkToggle = useCallback(
    async (phase: LinkablePhase, link: boolean) => {
      const target = editing;
      const full = phases.find((p) => p.id === phase.id);
      if (!target || !full) return;
      try {
        await setPhaseCalendarPeriod(full, link ? target.id : null);
        toastSuccess(
          link
            ? `Die Anmeldephase „${full.name}“ ist mit „${target.name}“ verknüpft.`
            : `Die Anmeldephase „${full.name}“ ist nicht mehr verknüpft.`,
        );
      } catch (err) {
        logger.error("phase_link_toggle_failed", {
          phase_id: phase.id,
          error: err instanceof Error ? err.message : String(err),
        });
        // Der Fehler gehört in den offenen Zeitraum-Dialog, der die
        // Verknüpfungen schreibt und dort erneut versuchen lässt.
        throw err;
      } finally {
        await reload();
      }
    },
    [editing, phases, reload, toastSuccess],
  );

  const editingUsage = useMemo(() => {
    if (!editing) return undefined;
    const usageSource =
      periods.find((period) => period.id === editing.id) ?? editing;
    return {
      enrollmentPhaseCount: usageSource.enrollmentPhaseCount ?? 0,
      activityGroupCount: usageSource.activityGroupCount ?? 0,
      scheduleCount: usageSource.scheduleCount ?? 0,
      studentEnrollmentCount: usageSource.studentEnrollmentCount ?? 0,
      supervisorCount: usageSource.supervisorCount ?? 0,
      activityInstanceCount: usageSource.activityInstanceCount ?? 0,
      staffShiftSeriesCount: usageSource.staffShiftSeriesCount ?? 0,
    };
  }, [editing, periods]);

  // Statuszeile: der heute laufende Zeitraum plus die Zahl der angelegten
  // Zeiträume, beides aus der bereits geladenen Liste.
  const today = berlinTodayISO();
  const currentPeriod = periods.find(
    (period) => period.startDate <= today && period.endDate >= today,
  );
  // Ohne geladene Liste wäre „0 Zeiträume“ falsch: dann steht nur der Fehler.
  const statusLine =
    loadFailed && periods.length === 0
      ? ""
      : `${currentPeriod ? `${currentPeriod.name} · ` : ""}${
          periods.length
        } ${periods.length === 1 ? "Zeitraum" : "Zeiträume"} · ${
          periods.filter((period) => period.isActive).length
        } aktiv`;

  return {
    periods,
    phases,
    loading,
    error: load.error,
    loadFailed,
    statusLine,
    modalOpen,
    editing,
    createDefaults,
    editingUsage,
    beginCreate,
    beginCreateSemester,
    beginEdit,
    closeModal,
    reload,
    handlePhaseLinkToggle,
  };
}
