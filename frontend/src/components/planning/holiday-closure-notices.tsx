"use client";

/**
 * Elternhinweise der Schule (ADR 0196): Liegt ein eigener Schließtag in einer
 * gebuchten Ferienwoche, schlägt moto nach dem Speichern oder Löschen vor,
 * die Eltern zu informieren. Ein Klick hier oder im Träger-Büro beauftragt
 * die E-Mail. Die Schule sieht nur, wie viele Familien gebucht haben, nie
 * Namen oder Kontakte. `version` ändert sich nach jedem Speichern und
 * Löschen eines Schließtags; dann lädt die Liste neu.
 */

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";

import { HolidayClosureNoticeCards } from "~/components/planning/holiday-closure-notice-cards";
import { useNoticeNotify } from "~/components/planning/use-holiday-closure-notices";
import { hasPermission } from "~/lib/auth-utils";
import {
  fetchHolidayClosureNotices,
  notifyHolidayClosureNotice,
  sendingRefreshInterval,
} from "~/lib/holiday-closure-notices";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import { revalidateOrThrow, useSWRAuth } from "~/lib/swr";
import { timetableKeys } from "~/lib/swr/portal-keys";

export function HolidayClosureNotices({
  version,
}: Readonly<{ version: number }>) {
  const { data: session } = useSession();
  const canNotify = hasPermission(session, "schedules:update");
  const response = useSWRAuth(
    canNotify ? timetableKeys.holidayClosureNotices() : null,
    fetchHolidayClosureNotices,
    { refreshInterval: sendingRefreshInterval },
  );
  const { mutate } = response;
  const loadError = useSwrLoadError(
    response.error,
    "die Hinweise an Eltern",
    mutate,
  );
  const { isSending, notify } = useNoticeNotify(
    notifyHolidayClosureNotice,
    () => revalidateOrThrow(response),
  );

  const seen = useRef(version);
  useEffect(() => {
    if (seen.current === version) return;
    seen.current = version;
    void mutate();
  }, [version, mutate]);

  const rows = (response.data ?? []).map((notice) => ({
    notice,
    title: `„${notice.reason}“`,
  }));
  if (!canNotify) return null;
  return (
    <HolidayClosureNoticeCards
      title="Eltern der Ferienbetreuung informieren"
      description="Diese Schließtage liegen in gebuchten Ferienwochen. Die Eltern bekommen erst eine E-Mail, wenn du oder das Träger-Büro „Eltern informieren“ wählt."
      rows={rows}
      isSending={isSending}
      onNotify={(notice) => void notify(notice)}
      loadError={response.error && !response.data ? loadError : null}
    />
  );
}
