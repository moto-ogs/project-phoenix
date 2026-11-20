"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";

import { Button } from "~/components/ui/button";
import { ListRow } from "~/components/ui/list-row";
import { StatusBadge } from "~/components/ui/status-badge";
import { useApiErrorDisplay } from "~/contexts/ToastContext";
import { trackEvent } from "~/lib/analytics";
import type { DayChange, DayChangeNotice } from "~/lib/day-changes";
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
  const latestConfirmRef = useRef<() => void>(() => undefined);
  const open = notice.requiresAcknowledgement && !notice.acknowledged;

  const confirm = async () => {
    setPending(true);
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
      return;
    }
    // Die Seite Tagesinformationen, der Zähler in der Navigation und die
    // Bestätigungsliste der Leitung lesen dieselbe Kenntnisnahme.
    const today = staffNoticeKeys.today(accountId);
    const acknowledgements = staffNoticeKeys.acknowledgements(notice.id);
    void invalidate((key) => key === today || key === acknowledgements);
    window.dispatchEvent(new Event(STAFF_NOTICES_REFRESH_EVENT));
    try {
      await onChanged();
    } catch (err) {
      // Die Kenntnisnahme ist gespeichert; ein Fehler beim Nachladen zeigt
      // der Baustein selbst als Ladefehler.
      logger.warn("day_notice_refresh_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
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

  const body = (
    <span className="min-w-0 flex-1">
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-gray-900">
          {notice.title}
        </span>
        {notice.important ? (
          <StatusBadge label="Wichtig" tone="warning" size="xs" />
        ) : null}
        {notice.requiresAcknowledgement && notice.acknowledged ? (
          <StatusBadge label="Zur Kenntnis genommen" tone="green" size="xs" />
        ) : null}
      </span>
      {notice.body ? (
        <span className="line-clamp-2 block text-xs whitespace-pre-line text-gray-600">
          {notice.body}
        </span>
      ) : null}
    </span>
  );

  return (
    <li
      data-day-notice={notice.id}
      // Der Klick auf den Link, nicht auf „Zur Kenntnis nehmen“. Nur die Art
      // des Eintrags, nie Titel oder ID.
      onClickCapture={(event) => {
        if (event.target instanceof Element && event.target.closest("a")) {
          trackEvent("day_changes_entry_clicked", {
            day_change_kind: entry.kind,
          });
        }
      }}
    >
      <ListRow href={tenantPath("/tagesinformationen")} density="compact">
        {body}
      </ListRow>
      {open ? (
        <div className="mt-1">
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
        </div>
      ) : null}
    </li>
  );
}
