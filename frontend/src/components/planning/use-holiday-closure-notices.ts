"use client";

/**
 * Der Klick auf „Eltern informieren“ zu einem Schul-Schließtag in einer
 * gebuchten Ferienwoche (ADR 0196), an beiden Stellen derselbe: im Kalender
 * der Schule und auf der Seite „Schließtage“ des Träger-Büros. Der Klick
 * beauftragt den Versand ohne zweite Frage; bis der Server antwortet, gilt
 * der Hinweis als „Wird gesendet“. Was die Zeilen zeigen, steht in
 * `holiday-closure-notice-cards.tsx`.
 */

import { useCallback, useState } from "react";

import { useApiErrorDisplay, useToast } from "~/contexts/ToastContext";
import { ApiError, isReadStateRefusal } from "~/lib/api-error";
import type { HolidayClosureNotice } from "~/lib/holiday-closure-notices";
import { createLogger } from "~/lib/logger";

const logger = createLogger({ component: "HolidayClosureNotices" });

/** Was die Karten vom Versand wissen müssen: Läuft er, und wie startet er. */
export interface NoticeNotifier {
  readonly isSending: (id: string) => boolean;
  readonly notify: (notice: HolidayClosureNotice) => Promise<void>;
}

function sendingToast(families: number): string {
  if (families === 1) return "Die E-Mail an 1 Familie wird gesendet.";
  if (families > 1)
    return `Die E-Mails an ${families} Familien werden gesendet.`;
  return "Die E-Mails werden gesendet.";
}

/**
 * Der Klick auf „Eltern informieren“: Die Zeile steht sofort auf „Wird
 * gesendet“, danach lädt die Liste den Stand vom Server. Hat sich der
 * Hinweis inzwischen geändert, wartet die Meldung auf den neuen Stand, den
 * die Liste für einen erneuten Klick zeigt; scheitert dieses Laden, sagt
 * die Meldung das (ADR 0311). `reload` lehnt ab, wenn das Laden scheitert.
 */
export function useNoticeNotify(
  notify: (
    id: string,
    revision: number,
    token: string,
  ) => Promise<HolidayClosureNotice>,
  reload: () => Promise<unknown>,
) {
  const [sending, setSending] = useState<ReadonlySet<string>>(new Set());
  const { show: showError, showMessage } = useApiErrorDisplay();
  const { success, info } = useToast();

  const run = useCallback(
    async (notice: HolidayClosureNotice) => {
      setSending((current) => new Set(current).add(notice.id));
      let refused = false;
      try {
        const result = await notify(notice.id, notice.revision, notice.token);
        switch (result.status) {
          case "sent":
            success("Die E-Mails wurden gesendet.");
            break;
          case "no_mail":
            info(
              "Keine E-Mail nötig. Es gibt keine neuen Änderungen für die Eltern.",
            );
            break;
          case "failed":
            showMessage(
              "Der Versand hat nicht geklappt. Bitte versuche es erneut.",
            );
            break;
          case "unknown":
            info(
              "Ergebnis unbekannt. Bitte lass den Versand vom moto-Team prüfen.",
            );
            break;
          case "suggested":
            info("Der Hinweis wurde geändert. Bitte prüfe ihn erneut.");
            break;
          case "sending":
            success(sendingToast(notice.families));
            break;
        }
      } catch (err) {
        logger.error("holiday_closure_notice_notify_failed", {
          notice_id: notice.id,
          status: err instanceof ApiError ? err.status : undefined,
          error: err instanceof Error ? err.message : String(err),
        });
        refused = isReadStateRefusal(err);
        // Eine Ablehnung wartet auf den neu gelesenen Stand (`reload`) und
        // nennt einen Ladefehler, statt den neuen Stand zu behaupten.
        void showError(err, {
          object: "die E-Mail an die Eltern",
          ...(refused ? { reload } : {}),
        });
      } finally {
        // Bewusst still: Scheitert nur das Nachladen, zeigt die Liste den
        // alten Stand; das nächste Laden der Seite holt den neuen. Nach
        // einer Ablehnung lädt die Meldung selbst.
        if (!refused) {
          await reload().catch((err: unknown) => {
            logger.warn("holiday_closure_notices_reload_failed", {
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }
        setSending((current) => {
          const next = new Set(current);
          next.delete(notice.id);
          return next;
        });
      }
    },
    [notify, reload, showError, showMessage, success, info],
  );

  return {
    isSending: (id: string) => sending.has(id),
    notify: run,
  } satisfies NoticeNotifier;
}
