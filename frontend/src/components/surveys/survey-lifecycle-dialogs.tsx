"use client";

/**
 * Die Rückfragen vor den Schritten einer Umfrage (#4781): Veröffentlichen,
 * Beenden, Erinnern, Löschen. Geteilt von Liste und Objektseite, damit
 * dieselbe Aktion überall dieselbe Rückfrage hat. Die API läuft erst im
 * `onConfirm` des Dialogs (BAUARTEN-SPEC Bauart 2 Regel 6).
 */

import { useLayoutEffect, useRef, useState } from "react";
import { BellRing, FileDown, Pencil, Send, Square, Trash2 } from "lucide-react";

import { ConfirmDeleteModal } from "~/components/ui/confirm-delete-modal";
import { FormErrorAlert } from "~/components/ui/form-error-alert";
import { ConfirmationModal } from "~/components/ui/modal";
import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import type { OverflowMenuItem } from "~/components/ui/page-header/types";
import { useApiFormError } from "~/contexts/ToastContext";
import {
  readStateWaitReason,
  useReadDraftForm,
} from "~/lib/hooks/use-swr-load-error";
import { useActionOn, type ReadAction } from "~/lib/swr/read-draft";
import { createLogger } from "~/lib/logger";
import {
  closeSurvey,
  deleteSurvey,
  publishSurvey,
  remindSurvey,
} from "~/lib/surveys-api";
import type { Survey } from "~/lib/surveys-api";
import {
  describeSurveyAudience,
  formatSurveyClosesAt,
  participantLabel,
} from "./survey-meta";
import { SURVEY_MIN_RESPONSES } from "./survey-questionnaire";
import { reportsConcept } from "~/lib/concepts/reports";

const logger = createLogger({ component: "SurveyLifecycle" });

/**
 * Wer bei Veröffentlichen und Erinnern etwas bekommt, für Knopf und Menü.
 * Mitarbeitende erinnert moto nur per App, und nur wer Benachrichtigungen
 * zu Umfragen eingeschaltet hat; Eltern per App und E-Mail (#6776).
 */
function surveyRecipients(survey: Pick<Survey, "audience">) {
  return survey.audience === "staff"
    ? {
        publish: "an die Mitarbeitenden",
        remind: "Mitarbeitende ohne Antwort, die Benachrichtigungen erhalten",
      }
    : {
        publish: "an die gewählten Eltern",
        remind: "Eltern ohne Antwort per App und E-Mail",
      };
}

interface DialogProps {
  /** Die Umfrage, wie die Seite sie gerade zeigt. */
  readonly survey: Survey;
  readonly onClose: () => void;
  /** Läuft nach dem erfolgreichen Aufruf, vor dem Schließen. */
  readonly onDone: () => Promise<void> | void;
}

interface ReadDialogProps extends DialogProps {
  /**
   * Liest die Umfrage neu, nachdem der Server einen inzwischen geänderten
   * Stand abgelehnt hat; lehnt bei einem Fehler ab (ADR 0311).
   */
  readonly reload: () => Promise<unknown>;
}

/**
 * Ein Schritt mit Rückfrage: der Fehler bleibt im offenen Dialog. Mit `read`
 * schickt der Schritt den Stand, den der Dialog zeigt (ADR 0311): eine
 * Ablehnung zeigt den neu gelesenen Stand ohne „Wiederholen“, und bis er
 * gelesen ist, geht nichts raus.
 */
function useSurveyAction<T>(
  run: () => Promise<T>,
  {
    onDone,
    onClose,
    object,
    logEvent,
    read,
  }: {
    onDone: (result: T) => Promise<void> | void;
    onClose: () => void;
    object: string;
    logEvent: string;
    read?: ReadAction;
  },
) {
  const [pending, setPending] = useState(false);
  const errors = useApiFormError();
  const form = useReadDraftForm(read ?? null, errors, object);
  const latestConfirmRef = useRef<() => void>(() => undefined);

  const confirm = async () => {
    if (!form.begin()) return;
    setPending(true);
    const result = read
      ? await read.submit(run)
      : await run().then(
          (saved) => ({ ok: true as const, saved }),
          (error: unknown) => ({ ok: false as const, error, refused: false }),
        );
    if (!result.ok) {
      setPending(false);
      if ("skipped" in result && result.skipped) return;
      logger.error(logEvent, {
        error:
          result.error instanceof Error
            ? result.error.message
            : String(result.error),
      });
      await errors.show(
        result.error,
        result.refused && "reload" in result
          ? { object, reload: result.reload }
          : { object, retry: () => latestConfirmRef.current() },
      );
      return;
    }
    try {
      await onDone(result.saved);
    } finally {
      setPending(false);
      onClose();
    }
  };
  useLayoutEffect(() => {
    latestConfirmRef.current = () => void confirm();
  });

  return {
    pending,
    error: errors.error ?? form.loadError,
    confirm,
    blocked: read !== undefined && !read.canSubmit,
    blockedReason: read ? readStateWaitReason(read.status) : undefined,
  };
}

export function PublishSurveyDialog({
  survey,
  onClose,
  onDone,
  reload,
}: ReadDialogProps) {
  // Veröffentlicht wird der Entwurf, den der Dialog zeigt.
  const read = useActionOn(
    { opening: survey.id, data: survey, reload },
    { token: (shown) => shown.version },
  );
  const { pending, error, confirm, blocked, blockedReason } = useSurveyAction(
    () => publishSurvey(survey.id, survey.version),
    {
      onDone,
      onClose,
      object: "das Veröffentlichen der Umfrage",
      logEvent: "survey_publish_failed",
      read,
    },
  );

  return (
    <ConfirmationModal
      isOpen
      onClose={onClose}
      onConfirm={() => void confirm()}
      title="Umfrage veröffentlichen"
      confirmText="Jetzt veröffentlichen"
      confirmTooltip={`Schickt die Umfrage sofort ${surveyRecipients(survey).publish}.`}
      cancelText="Abbrechen"
      isConfirmDisabled={blocked}
      confirmDisabledReason={blockedReason}
      isConfirmLoading={pending}
      loadingText="Wird veröffentlicht …"
    >
      <div className="space-y-2 text-sm text-gray-700">
        <FormErrorAlert message={error} />
        <p>
          „{survey.title}“ geht an{" "}
          <span className="font-medium">{describeSurveyAudience(survey)}</span>.
          Teilnahme bis {formatSurveyClosesAt(survey.closes_at)}.
        </p>
        <p>
          {survey.anonymous
            ? `Anonym: Niemand sieht, wer was geantwortet hat. Die Auswertung erscheint nach dem Ende und ab ${SURVEY_MIN_RESPONSES} Antworten.`
            : "Nicht anonym: Bei jeder Antwort steht der Name."}
        </p>
        {survey.audience === "parents" && survey.send_email && (
          <p>Die Eltern bekommen zusätzlich eine E-Mail.</p>
        )}
        <p className="font-medium text-gray-900">
          Danach lässt sich nichts mehr ändern, auch nicht, ob die Umfrage
          anonym ist. Du kannst sie nur noch beenden.
        </p>
      </div>
    </ConfirmationModal>
  );
}

export function CloseSurveyDialog({ survey, onClose, onDone }: DialogProps) {
  const { pending, error, confirm } = useSurveyAction(
    () => closeSurvey(survey.id),
    {
      onDone,
      onClose,
      object: "das Beenden der Umfrage",
      logEvent: "survey_close_failed",
    },
  );

  return (
    <ConfirmationModal
      isOpen
      onClose={onClose}
      onConfirm={() => void confirm()}
      title="Umfrage beenden"
      confirmText="Jetzt beenden"
      confirmTooltip="Beendet die Umfrage sofort, danach kann niemand mehr teilnehmen."
      cancelText="Abbrechen"
      isConfirmLoading={pending}
      loadingText="Wird beendet …"
    >
      <div className="space-y-2 text-sm text-gray-700">
        <FormErrorAlert message={error} />
        <p>
          Danach kann niemand mehr an „{survey.title}“ teilnehmen. Bisher:{" "}
          {participantLabel(survey.participant_count)}.
        </p>
        <p>
          Die Auswertung bleibt erhalten. Beenden lässt sich nicht rückgängig
          machen.
        </p>
      </div>
    </ConfirmationModal>
  );
}

export function RemindSurveyDialog({
  survey,
  onClose,
  onReminded,
}: Readonly<{
  survey: Survey;
  onClose: () => void;
  onReminded: (count: number) => Promise<void> | void;
}>) {
  const { pending, error, confirm } = useSurveyAction(
    () => remindSurvey(survey.id),
    {
      onDone: onReminded,
      onClose,
      object: "die Erinnerung",
      logEvent: "survey_remind_failed",
    },
  );

  return (
    <ConfirmationModal
      isOpen
      onClose={onClose}
      onConfirm={() => void confirm()}
      title="An die Umfrage erinnern"
      confirmText="Erinnerung senden"
      confirmTooltip={`Erinnert sofort ${surveyRecipients(survey).remind}.`}
      cancelText="Abbrechen"
      isConfirmLoading={pending}
      loadingText="Wird gesendet …"
    >
      <div className="space-y-2 text-sm text-gray-700">
        <FormErrorAlert message={error} />
        <p>
          Alle, die bei „{survey.title}“ noch nicht teilgenommen haben, bekommen
          eine Erinnerung.
        </p>
        <p>Du erfährst nur die Zahl, nicht wer das ist.</p>
      </div>
    </ConfirmationModal>
  );
}

export function DeleteSurveyDialog({
  survey,
  onClose,
  onDone,
  reload,
}: ReadDialogProps) {
  // Gelöscht wird mit den Antworten, die der Dialog nennt: kam seitdem eine
  // dazu, lehnt der Server ab und der Dialog zeigt die neue Zahl.
  const read = useActionOn(
    { opening: survey.id, data: survey, reload },
    { token: (shown) => shown.fingerprint },
  );
  const { pending, error, confirm, blocked } = useSurveyAction(
    () => deleteSurvey(survey.id, survey.fingerprint),
    {
      onDone,
      onClose,
      object: "das Löschen der Umfrage",
      logEvent: "survey_delete_failed",
      read,
    },
  );
  const withAnswers = survey.status !== "draft";

  return (
    <ConfirmDeleteModal
      isOpen
      title="Umfrage löschen"
      confirmTooltip={
        withAnswers
          ? "Löscht die Umfrage mit allen Antworten sofort."
          : "Löscht den Entwurf sofort."
      }
      description={
        <>
          Möchtest du die Umfrage
          <span className="font-medium text-gray-900"> „{survey.title}“ </span>
          wirklich löschen?{" "}
          {withAnswers
            ? `Alle Antworten und die Auswertung gehen verloren (${participantLabel(survey.participant_count)}). Das lässt sich nicht rückgängig machen.`
            : "Das lässt sich nicht rückgängig machen."}
        </>
      }
      gate={
        withAnswers
          ? {
              mode: "textConfirm",
              expected: "LÖSCHEN",
              inputId: "confirm-delete-survey",
              label: "Tippe zur Bestätigung LÖSCHEN ein:",
              placeholder: "LÖSCHEN",
            }
          : { mode: "twoStep" }
      }
      onConfirm={confirm}
      onClose={onClose}
      loading={pending}
      confirmDisabled={blocked}
      error={error}
    />
  );
}

interface MenuHandlers {
  readonly onPublish: () => void;
  /** Nur in der Liste: die Objektseite ist die Ansicht selbst. */
  readonly onView?: () => void;
  readonly onEdit: () => void;
  readonly onRemind: () => void;
  readonly onCloseSurvey: () => void;
  /** Nur auf der Objektseite, wenn die Auswertung da ist. */
  readonly onExport?: () => void;
  readonly onDelete: () => void;
}

/**
 * Das Aktionsmenü einer Umfrage. Veröffentlichen eines Entwurfs steht oben;
 * Bearbeiten gibt es nur für Entwürfe. Eine veröffentlichte Umfrage lässt
 * sich nur noch erinnern, beenden und löschen.
 */
export function buildSurveyMenuItems(
  survey: Survey,
  handlers: MenuHandlers,
): OverflowMenuItem[] {
  const items: OverflowMenuItem[] = [];
  if (survey.status === "draft") {
    items.push({
      label: "Veröffentlichen",
      icon: <Send className="size-4" aria-hidden />,
      description: `Schickt die Umfrage ${surveyRecipients(survey).publish}. moto fragt vorher nach`,
      onClick: handlers.onPublish,
    });
  }
  if (handlers.onView) {
    items.push({
      label: survey.status === "draft" ? "Anzeigen" : "Auswertung anzeigen",
      icon: <MotoConceptIcon concept={reportsConcept} size={16} />,
      description:
        survey.status === "draft"
          ? "Öffnet den Entwurf mit allen Fragen"
          : "Öffnet die Umfrage mit Teilnahmen und Auswertung",
      onClick: handlers.onView,
    });
  }
  if (survey.status === "draft") {
    items.push({
      label: "Bearbeiten",
      icon: <Pencil className="size-4" aria-hidden />,
      description: "Öffnet den Entwurf zum Ändern",
      onClick: handlers.onEdit,
    });
  }
  if (survey.status === "open") {
    items.push(
      {
        label: "Erinnern",
        icon: <BellRing className="size-4" aria-hidden />,
        description: `Erinnert ${surveyRecipients(survey).remind}. moto fragt vorher nach`,
        onClick: handlers.onRemind,
      },
      {
        label: "Beenden",
        icon: <Square className="size-4" aria-hidden />,
        description: "Beendet die Teilnahme für alle. moto fragt vorher nach",
        onClick: handlers.onCloseSurvey,
      },
    );
  }
  if (handlers.onExport) {
    items.push({
      label: "Auswertung als PDF",
      icon: <FileDown className="size-4" aria-hidden />,
      description: "Lädt die Auswertung als PDF-Datei herunter",
      onClick: handlers.onExport,
    });
  }
  items.push({
    label: "Löschen",
    icon: <Trash2 className="size-4" aria-hidden />,
    destructive: true,
    description:
      survey.status === "draft"
        ? "Löscht den Entwurf. moto fragt vorher nach"
        : "Löscht die Umfrage mit allen Antworten. moto fragt vorher nach",
    onClick: handlers.onDelete,
  });
  return items;
}
