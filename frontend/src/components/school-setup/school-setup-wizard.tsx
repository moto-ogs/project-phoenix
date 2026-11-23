"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { CoachMark } from "~/components/ui/coach-mark";
import { ConfirmationModal } from "~/components/ui/modal";
import { useApiFormError } from "~/contexts/ToastContext";
import { trackOnboardingSurface } from "~/lib/analytics";
import {
  buildHelpGroupHref,
  buildHelpHref,
  type HelpTopicId,
} from "~/lib/help-topics";
import {
  isMessageComposerOnScreen,
  useMessageComposerOnScreen,
} from "~/lib/hooks/use-message-composer-presence";
import { createLogger } from "~/lib/logger";
import {
  completeSchoolSetup,
  setSchoolSetupDismissed,
  setSchoolSetupStepSkipped,
  type SchoolSetupState,
  type SchoolSetupStepKey,
} from "~/lib/school-setup-api";
import { useShellAuthSafe } from "~/lib/shell-auth-context";
import { staffWithoutTargetHref } from "~/lib/time-account-links";
import { useNFCEnabled, useTenantSlugSafe } from "~/lib/tenant-context";
import { SetupBeacon, SchoolSetupChecklist } from "./school-setup-checklist";
import {
  applicableSteps,
  firstOpenStep,
  setupProgress,
} from "./school-setup-steps";
import { useSchoolSetup } from "./use-school-setup";
import { SETUP_TOURS } from "./setup-tours";
import { useSetupTour } from "./use-setup-tour";
import { useWorkTimeCoverage } from "./use-work-time-coverage";

const logger = createLogger({ component: "SchoolSetupWizard" });

/** Nachladen nach dem Tourende, bis laufende Anfragen durch sind. */
const TOUR_FOLLOW_UP_MS = [500, 2000, 5000];
const TOUR_LEFT =
  "Die Tour ist beendet, weil du eine andere Seite geöffnet hast. Mit „Zeig es mir“ startest du sie neu.";
const CLICK_ACTION = "Klicke auf die grün umrandete Stelle.";
const TARGET_MISSING =
  "Diese Stelle ist gerade nicht zu sehen. Vielleicht fehlt dir ein Recht, oder die Seite lädt noch.";

type RunAction = (
  action: () => Promise<SchoolSetupState>,
  after?: (next: SchoolSetupState) => void,
  onFail?: () => void,
) => void | Promise<void>;

/** Knopf unten rechts oder offene Checkliste. */
type View = "beacon" | "checklist";

/** Einmal pro Anmeldung und Schule öffnet sich der Assistent von selbst. */
function claimFirstOpen(tenantSlug: string, accountID: string): boolean {
  const key = `school-setup-opened:${tenantSlug}:${accountID}`;
  try {
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, "1");
    return true;
  } catch {
    return false;
  }
}

/**
 * Der Einrichtungs-Assistent für neue Schulen (#2832, ADR 0043).
 *
 * Eine Checkliste unten rechts, über allen Seiten. Der nächste offene
 * Schritt ist aufgeklappt; „Zeig es mir“ führt per Tour durch die
 * Seitenleiste und die Seite. Er
 * zeigt sich nur Personen, die die Einstellungen der Schule ändern dürfen,
 * bis die Schule fertig ist oder die Person ihn ausblendet.
 */
export function SchoolSetupWizard() {
  const shell = useShellAuthSafe();
  // Ohne Konto oder in der Vorschau einer Mitarbeiter-Ansicht: kein Assistent.
  if (!shell?.user || shell.isPreview) return null;
  return <SchoolSetupWizardForAdmin viaTraeger={shell.isViaTraeger ?? false} />;
}

function SchoolSetupWizardForAdmin({
  viaTraeger,
}: Readonly<{ viaTraeger: boolean }>) {
  const [view, setViewState] = useState<View>("beacon");
  // Ein offener Chat hat seinen Senden-Knopf genau dort, wo Knopf und
  // Checkliste unten am Rand stehen (#7686). Solange er offen ist, tritt
  // beides zurück; nur eine Liste, die die Person selbst geöffnet hat, bleibt.
  const chatOpen = useMessageComposerOnScreen();
  const [openedItself, setOpenedItself] = useState(false);
  const setView = useCallback((next: View) => {
    setViewState(next);
    setOpenedItself(false);
  }, []);
  const { state, accountID, refresh, replace } = useSchoolSetup(
    view === "checklist",
  );
  const [expanded, setExpanded] = useState<SchoolSetupStepKey | null>(null);
  const [expandedByPerson, setExpandedByPerson] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  // Eine gescheiterte Änderung steht oben in der Checkliste: Katalogtext,
  // Wiederholen und Vorgangskennung (#2517).
  const formErrors = useApiFormError();
  const latestRunRef = useRef<RunAction>(() => undefined);
  const [notice, setNotice] = useState<string | null>(null);
  const pathname = usePathname();
  const run: RunAction = async (action, after, onFail) => {
    setBusy(true);
    formErrors.clear();
    try {
      const next = await action();
      await replace(next);
      after?.(next);
    } catch (err) {
      logger.warn("school_setup_action_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      onFail?.();
      void formErrors.show(err, {
        object: "die Änderung der ersten Schritte",
        retry: () => latestRunRef.current(action, after, onFail),
      });
    } finally {
      setBusy(false);
    }
  };
  useLayoutEffect(() => {
    latestRunRef.current = (action, after, onFail) =>
      void run(action, after, onFail);
  });

  const nfcEnabled = useNFCEnabled();
  // Die letzte Station löst oft eine Anfrage aus (Einladung senden, Kind
  // anlegen), die beim Tourende noch läuft. Mehrmals nachladen, damit der
  // Haken ohne Umweg erscheint.
  const followUps = useRef<number[]>([]);
  useEffect(
    () => () => followUps.current.forEach((id) => window.clearTimeout(id)),
    [],
  );
  const onTourFinished = useCallback(() => {
    setView("checklist");
    void refresh();
    followUps.current = TOUR_FOLLOW_UP_MS.map((delay) =>
      window.setTimeout(() => void refresh(), delay),
    );
  }, [refresh, setView]);
  // Hat die Person die Seite der Tour verlassen, endet die Tour. Die
  // Checkliste geht beim Schritt auf und sagt, warum, statt dass nur die
  // Abdunklung stehen bleibt.
  const onTourLeft = useCallback(
    (step: SchoolSetupStepKey) => {
      setView("checklist");
      setExpanded(step);
      setExpandedByPerson(true);
      setNotice(TOUR_LEFT);
    },
    [setView],
  );
  const visible = state !== null && !state.completed && !state.dismissed;
  // Die Zahl der Personen ohne Soll (#6919) lädt erst, wenn der Schritt in
  // der offenen Checkliste aufgeklappt ist: Vorher zeigt sie niemand an.
  const workTime = useWorkTimeCoverage(
    visible && view === "checklist" && expanded === "worktime",
  );
  const tour = useSetupTour(SETUP_TOURS, onTourFinished, onTourLeft);
  // Die Tour öffnet die Zeitkonten im Monat, den die Checkliste gezählt hat:
  // Die Liste zeigt dann dieselben Personen. Die Zahl lädt mit dem
  // Aufklappen; wer schneller klickt, wartet kurz auf sie. Scheitert sie,
  // öffnet die Tour den laufenden Monat, und der Grund steht im Schritt.
  const startWorkTimeTour = async () => {
    const counted = workTime.coverage ?? (await workTime.retry());
    tour.start(
      "worktime",
      staffWithoutTargetHref(counted?.year, counted?.month),
    );
  };

  const nextOpen = state ? firstOpenStep(state) : null;

  // Beim ersten Aufruf der Sitzung geht die Checkliste von selbst auf. Das
  // zählt als angezeigte Fläche des Einstiegs (#7554); klappt die Person sie
  // danach zum ersten Mal ein oder blendet sie aus, hat sie die Fläche
  // geschlossen. Abschließen, Überspringen und Ausblenden als Kernaktion
  // zählt das Backend.
  const openedByItself = useRef<{
    readonly accountID: string;
    readonly tenantSlug: string;
  } | null>(null);
  const tenantSlug = useTenantSlugSafe();
  useEffect(() => {
    const opened = openedByItself.current;
    if (
      opened &&
      (opened.accountID !== accountID || opened.tenantSlug !== tenantSlug)
    ) {
      openedByItself.current = null;
    }
    // Von selbst geht die Liste erst auf, wenn kein Chat offen ist.
    if (
      visible &&
      !isMessageComposerOnScreen() &&
      tenantSlug &&
      accountID &&
      claimFirstOpen(tenantSlug, accountID)
    ) {
      setViewState("checklist");
      setOpenedItself(true);
      if (trackOnboardingSurface("shown", "setup_checklist")) {
        openedByItself.current = { accountID, tenantSlug };
      }
    }
  }, [visible, chatOpen, tenantSlug, accountID]);
  const closedByPerson = () => {
    const opened = openedByItself.current;
    if (
      !opened ||
      opened.accountID !== accountID ||
      opened.tenantSlug !== tenantSlug
    )
      return;
    openedByItself.current = null;
    trackOnboardingSurface("dismissed", "setup_checklist");
  };
  const collapse = () => {
    closedByPerson();
    setView("beacon");
  };

  // Aufgeklappt ist der nächste offene Schritt, solange die Person nicht
  // selbst einen anderen gewählt hat. Wird er erledigt, rückt der nächste nach.
  const previousNext = useRef(nextOpen);
  useEffect(() => {
    if (!expandedByPerson || previousNext.current !== nextOpen) {
      setExpanded(nextOpen);
      setExpandedByPerson(false);
    }
    previousNext.current = nextOpen;
  }, [nextOpen, expandedByPerson]);

  if (!visible) return null;

  const steps = applicableSteps(state);
  const { finished, total } = setupProgress(state);

  // Rolle und Einstellungen der Schule reisen mit, damit die Hilfe die
  // passenden Abläufe zeigt.
  const helpContext = {
    role: "lead",
    nfcEnabled,
    presenceMode: state.basics.presenceMode,
    groupMode: state.basics.groupMode,
    returnTo: pathname,
  } as const;
  const helpHref = (topic: HelpTopicId) => buildHelpHref(helpContext, topic);
  const helpGroupHref = (group: string) =>
    buildHelpGroupHref(helpContext, group);

  // Während der Tour tritt die Checkliste zurück.
  if (tour.active) {
    const {
      stop,
      index: stopIndex,
      total: stopTotal,
      target,
      missing,
      usesMobileTarget,
    } = tour.active;
    return (
      <CoachMark
        // Der Menü-Stopp zeigt am Telefon wieder auf den Auslöser. Das Blatt
        // des vorigen Stopps muss vorher aus dem Overlay-Stapel verschwinden,
        // sonst verdeckt es die neue Sprechblase.
        key={usesMobileTarget ? `mobile-target-${stopIndex}` : undefined}
        // Dasselbe Element über alle Stationen: Die Abdunklung bleibt beim
        // Wechsel stehen, der Bildschirm blitzt nicht auf. Solange die Stelle
        // gesucht wird, wartet nur die Sprechblase; in der Mitte steht sie
        // nur, wenn die Stelle fehlt.
        searching={!target && !missing}
        target={target}
        endBefore={
          stop.endBefore && target ? target.querySelector(stop.endBefore) : null
        }
        // Stationen in der Seitenleiste: neben die Leiste, nicht darüber.
        // Sonst verdeckt die Sprechblase die Einträge darunter -- also
        // genau den Eintrag, den die nächste Station meint.
        beside={stop.nav === true}
        title={stop.title}
        text={
          missing && !target
            ? (stop.missingText ?? TARGET_MISSING)
            : tour.active.text
        }
        progress={`Station ${stopIndex + 1} von ${stopTotal}`}
        action={stop.advance === "click" && target ? CLICK_ACTION : undefined}
        onNext={stop.advance === "next" || missing ? tour.next : undefined}
        nextLabel={stopIndex + 1 === stopTotal ? "Fertig" : "Weiter"}
        onBack={tour.active.canGoBack ? tour.back : undefined}
        onClose={() => {
          tour.stop();
          setView("checklist");
        }}
      />
    );
  }

  if (chatOpen && (view === "beacon" || openedItself)) return null;

  if (view === "beacon") {
    return (
      <SetupBeacon
        open={total - finished}
        onOpen={() => {
          setView("checklist");
          void refresh();
        }}
      />
    );
  }

  return (
    <>
      <SchoolSetupChecklist
        steps={steps}
        workTime={workTime}
        expanded={expanded}
        busy={busy}
        error={formErrors.error}
        notice={notice}
        helpHref={helpHref}
        helpGroupHref={helpGroupHref}
        onExpand={(step) => {
          formErrors.clear();
          setNotice(null);
          setExpanded(step);
          setExpandedByPerson(true);
        }}
        onStartTour={(step) => {
          setNotice(null);
          if (step === "worktime") void startWorkTimeTour();
          else tour.start(step);
        }}
        onSkip={(step, skipped) =>
          void run(() => setSchoolSetupStepSkipped(step, skipped))
        }
        onComplete={() => void run(completeSchoolSetup)}
        onCollapse={collapse}
        onDismiss={() => setConfirmDismiss(true)}
      />
      {/* Ausblenden ist endgültig: kein Weg zurück in den Einstellungen,
        die Anleitungen bleiben in der Hilfe. Deshalb eigens bestätigen. */}
      <ConfirmationModal
        isOpen={confirmDismiss}
        onClose={() => setConfirmDismiss(false)}
        onConfirm={() =>
          void run(
            () => setSchoolSetupDismissed(true),
            () => {
              closedByPerson();
              setConfirmDismiss(false);
            },
            // Der Grund steht in der Checkliste; der Dialog davor würde ihn
            // verdecken.
            () => setConfirmDismiss(false),
          )
        }
        title="Erste Schritte ausblenden?"
        confirmText="Ausblenden"
        isConfirmLoading={busy}
        loadingText="Wird ausgeblendet…"
      >
        <p className="text-sm text-gray-700">
          {viaTraeger
            ? "Die Checkliste verschwindet für dich in allen OGS deines Trägers."
            : "Die Checkliste verschwindet für dich."}{" "}
          Du kannst sie nicht wieder einblenden.
        </p>
        <p className="mt-2 text-sm text-gray-700">
          Die Anleitungen zu allen Schritten findest du weiter unter „Hilfe“.
        </p>
      </ConfirmationModal>
    </>
  );
}
