"use client";

/**
 * „Eltern noch nicht informiert“ im Träger-Büro (ADR 0196): je Schul-
 * Schließtag in einer gebuchten Ferienwoche eine Zeile mit Schule, Grund,
 * Tagen, Stand, Kindern und Familien und den betroffenen Wochen mit den
 * geschlossenen und wieder geöffneten Tagen. „Eltern informieren“ beauftragt
 * den Hinweis einer Zeile, „Alle Eltern informieren“ alle Vorschläge der
 * Liste, beides mit einem Klick. Denselben Auftrag kann die Schule auslösen;
 * ein zweiter Klick sendet nichts doppelt.
 */

import { useCallback, useState } from "react";

import { Mail } from "lucide-react";
import { HolidayClosureNoticeCards } from "~/components/planning/holiday-closure-notice-cards";
import { Button } from "~/components/ui/button";
import { StatusBadge } from "~/components/ui/status-badge";
import {
  useNoticeNotify,
  type HolidayClosureNoticeRowContent,
} from "~/components/planning/use-holiday-closure-notices";
import {
  childrenLabel,
  familiesLabel,
  HolidayClosureConsequences,
  HolidayClosureWeekList,
} from "~/components/traeger/closing-day-holiday-impact";
import type { FormErrorInput } from "~/components/ui/form-error";
import { useApiErrorDisplay, useToast } from "~/contexts/ToastContext";
import { isReadStateRefusal } from "~/lib/api-error";
import { createLogger } from "~/lib/logger";
import {
  notifyPendingHolidayClosures,
  notifyTraegerHolidayClosureNotice,
  type PendingHolidayClosures,
  type TraegerHolidayClosureNotice,
} from "~/lib/traeger-closing-days";

const logger = createLogger({ component: "TraegerHolidayClosureNotices" });

export function TraegerHolidayClosureNotices({
  pending,
  loadError,
  schoolName,
  reload,
}: Readonly<{
  pending: PendingHolidayClosures | undefined;
  loadError: FormErrorInput;
  schoolName: (id: string) => string;
  reload: () => Promise<unknown>;
}>) {
  const { isSending, notify } = useNoticeNotify(
    notifyTraegerHolidayClosureNotice,
    reload,
  );
  const [notifyingAll, setNotifyingAll] = useState(false);
  const { show: showError } = useApiErrorDisplay();
  const { success } = useToast();

  const retryableMails = pending?.retryableMails ?? 0;
  const unknownMails = pending?.unknownMails ?? 0;
  const notices = pending?.notices ?? [];
  const suggested = notices.filter(
    (notice) => notice.status === "suggested" && !isSending(notice.id),
  );

  const notifyAll = useCallback(async () => {
    if (!pending) return;
    setNotifyingAll(true);
    let refused = false;
    try {
      const families = await notifyPendingHolidayClosures(pending.token);
      success(
        retryableMails > 0 && suggested.length === 0
          ? "Erneuter Versand ist beauftragt."
          : `${familiesLabel(families)} ${families === 1 ? "bekommt" : "bekommen"} eine E-Mail.`,
      );
    } catch (err) {
      logger.error("traeger_holiday_closure_notify_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      refused = isReadStateRefusal(err);
      // Eine Ablehnung wartet auf den neu gelesenen Stand (`reload`) und
      // nennt einen Ladefehler, statt den neuen Stand zu behaupten (ADR 0311).
      void showError(err, {
        object: "die E-Mail an die Eltern",
        ...(refused ? { reload } : {}),
      });
    } finally {
      setNotifyingAll(false);
      // Bewusst still: Scheitert nur das Nachladen, bleibt der alte Stand
      // stehen, bis die Seite wieder lädt. Nach einer Ablehnung lädt die
      // Meldung selbst.
      if (!refused) {
        await reload().catch((err: unknown) => {
          logger.warn("traeger_holiday_closures_reload_failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
    }
  }, [pending, reload, retryableMails, showError, success, suggested.length]);

  const rows: HolidayClosureNoticeRowContent<TraegerHolidayClosureNotice>[] =
    notices.map((notice) => {
      const waiting = notice.status === "suggested" && !isSending(notice.id);
      return {
        notice,
        title: `„${notice.reason}“`,
        context: schoolName(notice.schoolId),
        badges:
          waiting && notice.children > 0 ? (
            <StatusBadge
              label={childrenLabel(notice.children)}
              tone="blue"
              size="xs"
            />
          ) : null,
        details:
          waiting && notice.weeks.length > 0 ? (
            <div className="mt-2">
              <HolidayClosureWeekList
                weeks={notice.weeks}
                schoolName={schoolName}
              />
            </div>
          ) : null,
      };
    });

  const intro =
    suggested.length > 0 || retryableMails > 0 || unknownMails > 0 ? (
      <div className="space-y-2 text-sm">
        {retryableMails > 0 ? (
          <p>
            {retryableMails === 1
              ? "1 E-Mail ist nicht angekommen."
              : `${retryableMails} E-Mails sind nicht angekommen.`}{" "}
            Ein Klick versucht den Versand erneut.
          </p>
        ) : null}
        {unknownMails > 0 ? (
          <p>
            Bei {unknownMails} E-Mail{unknownMails === 1 ? "" : "s"} ist das
            Ergebnis unbekannt. Bitte lass den Versand vom moto-Team prüfen.
          </p>
        ) : null}
        {suggested.length > 0 ? (
          <HolidayClosureConsequences
            keepsContribution={pending?.keepsContribution ?? true}
          />
        ) : null}
      </div>
    ) : null;
  const action =
    suggested.length > 1 || retryableMails > 0 ? (
      <Button
        type="button"
        variant="primary"
        size="md"
        onClick={() => void notifyAll()}
        isLoading={notifyingAll}
        tooltip={
          suggested.length > 0
            ? "Sendet allen betroffenen Eltern sofort eine E-Mail."
            : "Sendet die nicht zugestellten E-Mails sofort noch einmal."
        }
        loadingText="Wird gesendet..."
      >
        <Mail className="h-4 w-4" aria-hidden="true" />
        {suggested.length > 0 ? "Alle Eltern informieren" : "Erneut senden"}
      </Button>
    ) : null;
  return (
    <HolidayClosureNoticeCards
      title="Eltern noch nicht informiert"
      description="Schulhinweise brauchen einen Klick von dir oder der Schule. Fehlgeschlagene E-Mails kannst du erneut senden."
      rows={rows}
      isSending={isSending}
      onNotify={(notice) => void notify(notice)}
      loadError={loadError}
      intro={intro}
      action={action}
    />
  );
}
