"use client";

import { useLayoutEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import {
  CollectionGrid,
  CollectionGridTile,
} from "~/components/ui/collection-grid";
import { StatusBadge } from "~/components/ui/status-badge";
import { useApiErrorDisplay } from "~/contexts/ToastContext";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { useRefreshAfterWrite } from "~/lib/hooks/use-refresh-after-write";
import { createLogger } from "~/lib/logger";
import { useInvalidateMatching } from "~/lib/swr";
import { staffNoticeKeys } from "~/lib/swr/staff-keys";
import {
  acknowledgeStaffNotice,
  describeRecurrence,
  STAFF_NOTICES_REFRESH_EVENT,
} from "~/lib/staff-notices-api";
import type { StaffNotice } from "~/lib/staff-notices-api";

const logger = createLogger({ component: "TodayNoticeList" });

/**
 * Die Hinweise der Leitung, die HEUTE gelten — als Texte, nicht als Zeilen:
 * der Hinweis IST der Inhalt. Wichtige stehen zuerst (Sortierung kommt aus dem
 * Backend) und tragen ein Kennzeichen. Bestätigt wird der Hinweis, nicht der
 * Tag: ein wiederkehrender Hinweis fragt nicht jeden Dienstag erneut.
 *
 * Dieselbe Liste steht in moto schule (#2208); dort reicht die Seite die
 * Kenntnisnahme über ihre eigene Sitzung herein (`acknowledge`).
 *
 * Die Hinweise stehen nebeneinander, einer pro Feld (#4365). Ein einzelner
 * Hinweis füllt die Zeile; auf dem Telefon stehen sie untereinander.
 */
export function TodayNoticeList({
  notices,
  onChanged,
  acknowledge = acknowledgeStaffNotice,
}: {
  readonly notices: readonly StaffNotice[];
  readonly onChanged: () => Promise<unknown>;
  readonly acknowledge?: (id: string) => Promise<void>;
}) {
  const [pending, setPending] = useState<string | null>(null);
  // Eine Kenntnisnahme ist eine Aktion ohne Formular: der Fehler kommt als
  // Meldung mit Wiederholen (#2517).
  const { show: showError } = useApiErrorDisplay();
  // Nachladen nach der Kenntnisnahme: ein Fehler dabei ist ein Ladefehler
  // über der Liste, keine gescheiterte Kenntnisnahme (#6652).
  const afterAcknowledge = useRefreshAfterWrite(
    "die Anzeige der Hinweise der Leitung",
    onChanged,
  );
  const latestConfirmRef = useRef<(notice: StaffNotice) => void>(
    () => undefined,
  );
  const invalidate = useInvalidateMatching();

  const confirm = async (notice: StaffNotice) => {
    setPending(notice.id);
    try {
      await acknowledge(notice.id);
    } catch (err) {
      logger.error("staff_notice_acknowledge_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void showError(err, {
        object: "die Kenntnisnahme",
        retry: () => latestConfirmRef.current(notice),
      });
      setPending(null);
      return;
    }
    setPending(null);
    // The leadership's list and its acknowledgement counts must refresh too.
    const acknowledgements = staffNoticeKeys.acknowledgements(notice.id);
    void invalidate(
      (key) =>
        key === acknowledgements || key.startsWith(staffNoticeKeys.all("")),
    );
    await afterAcknowledge.refresh();
    window.dispatchEvent(new Event(STAFF_NOTICES_REFRESH_EVENT));
  };
  useLayoutEffect(() => {
    latestConfirmRef.current = (notice) => void confirm(notice);
  });

  const items = notices.map((notice) => (
    <CollectionGridTile key={notice.id}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[15px] font-semibold text-gray-900">
          {notice.title}
        </h3>
        {notice.priority === "important" && (
          <StatusBadge label="Wichtig" tone="warning" />
        )}
        <span className="text-xs text-gray-500">
          {describeRecurrence(notice)}
        </span>
      </div>

      {notice.body && (
        <p className="mt-1 max-w-3xl text-sm leading-6 whitespace-pre-line text-gray-600">
          {notice.body}
        </p>
      )}

      {notice.requires_acknowledgement && (
        <div className="mt-2">
          {notice.acknowledged_at ? (
            <StatusBadge label="Zur Kenntnis genommen" tone="green" />
          ) : (
            <Button
              type="button"
              variant="outline"
              size="md"
              disabled={pending === notice.id}
              tooltip="Bestätigt sofort, dass du die Information gelesen hast."
              onClick={() => void confirm(notice)}
            >
              {pending === notice.id
                ? "Wird gespeichert …"
                : "Zur Kenntnis nehmen"}
            </Button>
          )}
        </div>
      )}
    </CollectionGridTile>
  ));
  return (
    <>
      <LoadErrorAlert error={afterAcknowledge.error} className="mb-4" />
      <CollectionGrid as="ul">{items}</CollectionGrid>
    </>
  );
}
