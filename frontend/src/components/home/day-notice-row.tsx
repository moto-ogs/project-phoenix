"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";

import { Button } from "~/components/ui/button";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { ListRow } from "~/components/ui/list-row";
import Link from "~/components/ui/navigation-link";
import { StatusBadge } from "~/components/ui/status-badge";
import { useApiErrorDisplay } from "~/contexts/ToastContext";
import { trackEntryClick } from "~/components/home/day-change-link";
import type { DayChange, DayChangeNotice } from "~/lib/day-changes";
import { useRefreshAfterWrite } from "~/lib/hooks/use-refresh-after-write";
import { createLogger } from "~/lib/logger";
import {
  acknowledgeStaffNotice,
  STAFF_NOTICES_REFRESH_EVENT,
} from "~/lib/staff-notices-api";
import { useInvalidateMatching } from "~/lib/swr";
import { staffNoticeKeys } from "~/lib/swr/staff-keys";
import { useTenantAwarePath } from "~/lib/tenant-path";

const logger = createLogger({ component: "DayNoticeRow" });

/**
 * Ein Hinweis der Leitung in „Heute anders“ (#7667): Titel, Text und, solange
 * die Leitung eine Kenntnisnahme verlangt und sie fehlt, der Knopf dafür. Er
 * nutzt denselben Schreibweg wie die Seite Tagesinformationen. Danach lädt die
 * Übersicht neu, der Hinweis rückt nach „Schule“, und der Fokus folgt ihm.
 */
export function DayNoticeRow({
  entry,
  notice,
  onChanged,
}: {
  readonly entry: DayChange;
  readonly notice: DayChangeNotice;
  readonly onChanged: () => Promise<unknown>;
}) {
  const tenantPath = useTenantAwarePath();
  const { data: session } = useSession();
  const accountId = session?.user?.id ?? "";
  const invalidate = useInvalidateMatching();
  const { show: showError } = useApiErrorDisplay();
  const [pending, setPending] = useState(false);
  // Nachladen nach der Kenntnisnahme: ein Fehler dabei ist ein Ladefehler an
  // der Zeile, keine gescheiterte Kenntnisnahme (#6652).
  const afterAcknowledge = useRefreshAfterWrite(
    "die Übersicht „Heute anders“",
    onChanged,
  );
  const latestConfirmRef = useRef<() => void>(() => undefined);
  const open = notice.requiresAcknowledgement && !notice.acknowledged;

  const confirm = async () => {
    setPending(true);
    let failed = false;
    try {
      await acknowledgeStaffNotice(notice.id);
    } catch (err) {
      logger.error("day_notice_acknowledge_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void showError(err, {
        object: "die Kenntnisnahme",
        retry: () => latestConfirmRef.current(),
      });
      setPending(false);
      failed = true;
    }
    if (failed) {
      // Eine veraltete Ansicht (der Hinweis gilt nicht mehr oder verlangt
      // keine Kenntnisnahme mehr) zeigt danach den aktuellen Stand.
      void afterAcknowledge.refresh();
      return;
    }
    // Die Seite Tagesinformationen, der Zähler in der Navigation, die
    // Leitungsübersicht mit ihren Zählern und die Bestätigungsliste lesen
    // dieselbe Kenntnisnahme.
    const today = staffNoticeKeys.today(accountId);
    const all = staffNoticeKeys.all(accountId);
    const acknowledgements = staffNoticeKeys.acknowledgements(notice.id);
    void invalidate(
      (key) => key === today || key === all || key === acknowledgements,
    );
    window.dispatchEvent(new Event(STAFF_NOTICES_REFRESH_EVENT));
    await afterAcknowledge.refresh();
    setPending(false);
    // Der Knopf ist weg; der Fokus geht auf den Hinweis an seinem neuen Platz.
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(`[data-day-notice="${notice.id}"] a`)
        ?.focus();
    });
  };
  useLayoutEffect(() => {
    latestConfirmRef.current = () => void confirm();
  });

  const href = tenantPath("/tagesinformationen");
  const badges = (
    <>
      {notice.important ? (
        <StatusBadge label="Wichtig" tone="warning" size="xs" />
      ) : null}
      {notice.requiresAcknowledgement && notice.acknowledged ? (
        <StatusBadge label="Zur Kenntnis genommen" tone="green" size="xs" />
      ) : null}
    </>
  );
  const text = notice.body ? (
    // Der ganze Text: „gelesen“ heißt den ganzen Hinweis, nicht einen Teil.
    <span className="block text-xs whitespace-pre-line text-gray-600">
      {notice.body}
    </span>
  ) : null;

  return (
    <li
      data-day-notice={notice.id}
      // Der Klick auf den Link, nicht auf „Zur Kenntnis nehmen“. Nur die Art
      // des Eintrags, nie Titel oder ID.
      onClickCapture={(event) => {
        if (event.target instanceof Element && event.target.closest("a")) {
          trackEntryClick(entry.kind);
        }
      }}
    >
      {open ? (
        // Solange die Kenntnisnahme fehlt, gehört der Knopf in den Hinweis:
        // die Zeile ist dann Anzeige, und der Titel führt zur Seite (Kit:
        // eigener Knopf neben einem Link).
        <ListRow density="compact">
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <Link
                href={href}
                className="text-sm font-medium text-gray-900 hover:underline"
              >
                {notice.title}
              </Link>
              {badges}
            </span>
            {text}
            <span className="mt-2 block">
              <Button
                type="button"
                variant="outline"
                size="compact"
                disabled={pending}
                aria-label={`${notice.title}: zur Kenntnis nehmen`}
                tooltip="Bestätigt sofort, dass du den Hinweis gelesen hast."
                onClick={() => void confirm()}
              >
                {pending ? "Wird gespeichert …" : "Zur Kenntnis nehmen"}
              </Button>
            </span>
          </span>
        </ListRow>
      ) : (
        <ListRow href={href} density="compact">
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-gray-900">
                {notice.title}
              </span>
              {badges}
            </span>
            {text}
          </span>
        </ListRow>
      )}
      <LoadErrorAlert error={afterAcknowledge.error} className="mt-1" />
    </li>
  );
}
