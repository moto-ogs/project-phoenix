"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { BellRing, Pencil, Send, Trash2, Undo2 } from "lucide-react";
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
  deleteAnnouncement,
  publishAnnouncement,
  unpublishAnnouncement,
} from "~/lib/parent-announcements-api";
import type { AnnouncementApiBase } from "~/lib/parent-announcements-api";
import type { Announcement } from "~/lib/parent-announcements-api";
import { isClassLetter, withApiBase } from "~/lib/parent-announcements-api";
import { summarizeTargets } from "./announcement-meta";
import { reportsConcept } from "~/lib/concepts/reports";

const logger = createLogger({ component: "AnnouncementLifecycle" });

/**
 * Die Lebenszyklus-Aktionen einer Mitteilung, geteilt zwischen der Liste
 * und der Objektseite (#3115): dieselbe Rückfrage, derselbe Wortlaut, egal
 * wo die Aktion angestoßen wird.
 */
interface LifecycleDialogProps {
  readonly announcement: Announcement;
  readonly onClose: () => void;
  /** Läuft nach dem erfolgreichen Aufruf, vor dem Schließen (Listen neu laden). */
  readonly onDone: () => Promise<void> | void;
  /** Die Routen des Portals, das die Mitteilung zeigt; sonst die der OGS. */
  readonly apiBase?: AnnouncementApiBase;
}

/**
 * Ein Lebenszyklus-Schritt mit Rückfrage (#2517): der Fehler bleibt im
 * offenen Dialog (Katalogtext, Wiederholen). Den Erfolg zeigt die Liste
 * selbst, die danach neu lädt. Mit `read` schickt der Schritt den Stand, den
 * der Dialog zeigt (ADR 0311): eine Ablehnung zeigt den neu gelesenen Stand
 * ohne „Wiederholen“, und bis er gelesen ist, geht nichts raus.
 */
function useLifecycleAction(
  run: () => Promise<unknown>,
  {
    onDone,
    onClose,
    object,
    logEvent,
    read,
  }: {
    onDone: LifecycleDialogProps["onDone"];
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
      await onDone();
    } finally {
      setPending(false);
      onClose();
    }
  };
  // „Wiederholen“ ruft die Aktion mit dem dann aktuellen Stand auf.
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

export function PublishAnnouncementDialog({
  announcement,
  onClose,
  onDone,
  apiBase,
  reload,
}: LifecycleDialogProps & {
  /**
   * Liest die Mitteilung neu, nachdem der Server einen inzwischen
   * geänderten Entwurf abgelehnt hat; lehnt bei einem Fehler ab (ADR 0311).
   */
  readonly reload: () => Promise<unknown>;
}) {
  // Veröffentlicht wird der Entwurf, den der Dialog zeigt.
  const read = useActionOn(
    { opening: announcement.id, data: announcement, reload },
    { token: (shown) => shown.version },
  );
  const { pending, error, confirm, blocked, blockedReason } =
    useLifecycleAction(
      () => publishAnnouncement(announcement.id, announcement.version, apiBase),
      {
        onDone,
        onClose,
        object: "das Veröffentlichen der Mitteilung",
        logEvent: "announcement_publish_failed",
        read,
      },
    );

  return (
    <ConfirmationModal
      isOpen
      onClose={onClose}
      onConfirm={() => void confirm()}
      title="Elternmitteilung veröffentlichen"
      confirmText="Jetzt veröffentlichen"
      cancelText="Abbrechen"
      isConfirmDisabled={blocked}
      confirmDisabledReason={blockedReason}
      isConfirmLoading={pending}
      loadingText="Wird veröffentlicht …"
    >
      <div className="space-y-2 text-sm text-gray-700">
        <FormErrorAlert message={error} />
        <p>
          „{announcement.title}“ wird für{" "}
          <span className="font-medium">
            {summarizeTargets(announcement.targets)}
          </span>{" "}
          sichtbar.
        </p>
        {announcement.send_email && (
          <p>
            Die erreichten Eltern werden zusätzlich per E-Mail benachrichtigt.
          </p>
        )}
        <p className="text-xs text-gray-500">
          Nach dem Veröffentlichen kann die Mitteilung nicht mehr bearbeitet
          werden.
        </p>
      </div>
    </ConfirmationModal>
  );
}

export function UnpublishAnnouncementDialog({
  announcement,
  onClose,
  onDone,
  apiBase,
}: LifecycleDialogProps) {
  const { pending, error, confirm } = useLifecycleAction(
    () => withApiBase(unpublishAnnouncement, announcement.id, apiBase),
    {
      onDone,
      onClose,
      object: "das Zurückziehen der Mitteilung",
      logEvent: "announcement_unpublish_failed",
    },
  );

  return (
    <ConfirmationModal
      isOpen
      onClose={onClose}
      onConfirm={() => void confirm()}
      title="Elternmitteilung zurückziehen"
      confirmText="Zurückziehen"
      cancelText="Abbrechen"
      isConfirmLoading={pending}
      loadingText="Wird zurückgezogen …"
    >
      <div className="space-y-2 text-sm text-gray-700">
        <FormErrorAlert message={error} />
        {announcement.delivery_mode === "declaration" ? (
          // Wer schon geantwortet hat, behält das Einverständnis, damit eine
          // Zustimmung widerrufbar bleibt (#6290).
          <p>
            „{announcement.title}“ kehrt in den Entwurfsstatus zurück. Eltern
            können nicht mehr neu antworten.
          </p>
        ) : (
          <p>
            „{announcement.title}“ wird für die Eltern nicht mehr sichtbar und
            kehrt in den Entwurfsstatus zurück.
          </p>
        )}
        <p className="text-xs text-gray-500">
          Noch nicht versendete E-Mail-Benachrichtigungen werden abgebrochen.
        </p>
        {announcement.delivery_mode === "declaration" && (
          <p className="text-xs text-gray-500">
            Bisherige Antworten bleiben gespeichert. Wer schon geantwortet hat,
            sieht das Einverständnis weiter und kann eine Zustimmung widerrufen.
            Änderst du danach den Text, müssen die Eltern noch einmal antworten.
          </p>
        )}
      </div>
    </ConfirmationModal>
  );
}

export function DeleteAnnouncementDialog({
  announcement,
  onClose,
  onDone,
  apiBase,
}: LifecycleDialogProps) {
  // Ein Einverständnis mit Antworten (#3430) bleibt als Nachweis stehen:
  // communication.declaration_has_submissions bringt dafür einen eigenen
  // Katalogtext mit.
  const { pending, error, confirm } = useLifecycleAction(
    () => withApiBase(deleteAnnouncement, announcement.id, apiBase),
    {
      onDone,
      onClose,
      object: "das Löschen der Mitteilung",
      logEvent: "announcement_delete_failed",
    },
  );

  return (
    <ConfirmDeleteModal
      isOpen
      title="Elternmitteilung löschen"
      description={
        <>
          Möchtest du die Elternmitteilung
          <span className="font-medium text-gray-900">
            {" "}
            „{announcement.title}“{" "}
          </span>
          wirklich löschen? Dies kann nicht rückgängig gemacht werden.
        </>
      }
      gate={{ mode: "twoStep" }}
      onConfirm={confirm}
      onClose={onClose}
      loading={pending}
      error={error}
    />
  );
}

interface MenuHandlers {
  readonly onPublish: () => void;
  /** Nur in der Liste: die Objektseite ist die Ansicht selbst. */
  readonly onView?: () => void;
  /** Ohne Bearbeiten-Ziel (moto schule) fehlt der Eintrag. */
  readonly onEdit?: () => void;
  readonly onUnpublish: () => void;
  readonly onDelete: () => void;
  /**
   * Die geplante Erinnerung (#3162) einer VERÖFFENTLICHTEN Mitteilung planen
   * oder ändern. Entwürfe tragen die Erinnerung im Assistenten; Umfragen
   * haben nur ihre manuelle Erinnerung an offene Antworten.
   */
  readonly onReminder?: () => void;
  /**
   * Die Lehrkraft, die den Klassenbrief geschrieben hat (#4800). Ohne sie
   * bleibt ein Klassenbrief nur zum Ansehen: die OGS ändert ihn nicht.
   */
  readonly classLetterAuthor?: boolean;
}

/**
 * Das Aktionsmenü einer Mitteilung (BAUARTEN-SPEC Bauart 1 Regel 4 und
 * Bauart 2 Regel 3): Veröffentlichen eines Entwurfs zuerst. Bearbeiten gibt
 * es nur für Entwürfe, veröffentlichte Mitteilungen sind unveränderlich
 * (erst Zurückziehen, dann den Entwurf bearbeiten). Vom System erzeugte
 * Zeilen (Ausfall-Mitteilung, #2601) lassen sich weder bearbeiten noch
 * löschen.
 */
export function buildAnnouncementMenuItems(
  announcement: Announcement,
  handlers: MenuHandlers,
): OverflowMenuItem[] {
  const items: OverflowMenuItem[] = [];
  const readOnly = isClassLetter(announcement) && !handlers.classLetterAuthor;
  if (readOnly) {
    return handlers.onView ? [viewItem(handlers.onView)] : [];
  }
  if (announcement.status === "draft") {
    items.push({
      // moto schule sagt Senden: die Lehrkraft schickt einen Brief ab.
      label: handlers.classLetterAuthor ? "Senden" : "Veröffentlichen",
      description:
        "Geht nach deiner Bestätigung sofort an die gewählten Eltern",
      icon: <Send className="size-4" aria-hidden />,
      onClick: handlers.onPublish,
    });
  }
  if (handlers.onView) {
    items.push(viewItem(handlers.onView));
  }
  if (
    handlers.onEdit &&
    !announcement.system_kind &&
    announcement.status === "draft"
  ) {
    items.push({
      label: "Bearbeiten",
      description: "Öffnet den Entwurf zum Ändern",
      icon: <Pencil className="size-4" aria-hidden />,
      onClick: handlers.onEdit,
    });
  }
  if (
    handlers.onReminder &&
    !announcement.system_kind &&
    announcement.status === "published" &&
    announcement.response_type === "none" &&
    !announcement.reminder_sent_at
  ) {
    items.push({
      label: announcement.reminder_at
        ? "Erinnerung ändern"
        : "Erinnerung planen",
      description:
        "Legt fest, wann moto den Eintrag allen Empfängern noch einmal schickt",
      icon: <BellRing className="size-4" aria-hidden />,
      onClick: handlers.onReminder,
    });
  }
  if (!announcement.system_kind && announcement.status === "published") {
    items.push({
      label: "Zurückziehen",
      description:
        "Macht den Eintrag wieder zum Entwurf, moto fragt vorher nach",
      icon: <Undo2 className="size-4" aria-hidden />,
      onClick: handlers.onUnpublish,
    });
  }
  if (!announcement.system_kind) {
    items.push({
      label: "Löschen",
      description: "Löscht den Eintrag, moto fragt vorher nach",
      icon: <Trash2 className="size-4" aria-hidden />,
      destructive: true,
      onClick: handlers.onDelete,
    });
  }
  return items;
}

function viewItem(onView: () => void): OverflowMenuItem {
  return {
    label: "Anzeigen",
    description: "Öffnet die Seite mit Text und Empfängern des Eintrags",
    icon: <MotoConceptIcon concept={reportsConcept} size={16} />,
    onClick: onView,
  };
}
