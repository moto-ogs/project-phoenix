"use client";

import { Button } from "~/components/ui/button";
import { formErrorMessage } from "~/components/ui/form-error";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { Loading } from "~/components/ui/loading";
import { Modal } from "~/components/ui/modal";
import { formatChatDateTime } from "~/lib/date-helpers";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { useSWRAuth } from "~/lib/swr";
import { staffNoticeKeys } from "~/lib/swr/staff-keys";
import { fetchNoticeAcknowledgements } from "~/lib/staff-notices-api";
import type { StaffNotice } from "~/lib/staff-notices-api";

/**
 * Die Bestätigungsliste einer Tagesinformation (#2208): wer wann zur Kenntnis
 * genommen hat. Für die Leitung — die Zahl in der Liste sagt, dass jemand
 * bestätigt hat, diese Liste sagt, wer. Geladen beim Öffnen, nicht mit der
 * Seite: die Namen braucht man selten, die Zahl immer.
 */
export function StaffNoticeAcknowledgementsModal({
  notice,
  onClose,
}: {
  readonly notice: StaffNotice | null;
  readonly onClose: () => void;
}) {
  const {
    data: rows,
    error,
    mutate,
  } = useSWRAuth(
    notice ? staffNoticeKeys.acknowledgements(notice.id) : null,
    () => fetchNoticeAcknowledgements(notice!.id),
    { keepPreviousData: false },
  );
  // Der Ladefehler steht im Dialog, mit Wiederholen (#2517).
  const { error: loadError, failure } = useSwrResourceLoadError(
    [{ data: rows, error }],
    "die Liste der Bestätigungen",
    () => mutate(),
  );
  const loadFailed = failure !== undefined;

  return (
    <Modal
      isOpen={notice !== null}
      onClose={onClose}
      title="Bestätigungen"
      footer={
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="md"
            noTooltip="Schließen schließt nur das Fenster und ändert nichts."
            onClick={onClose}
          >
            Schließen
          </Button>
        </div>
      }
    >
      {notice && (
        <div className="space-y-4">
          <p className="text-sm leading-6 text-gray-600">
            Diese Personen haben „{notice.title}“ zur Kenntnis genommen.
          </p>

          {loadFailed && formErrorMessage(loadError) !== null ? (
            <LoadErrorAlert error={loadError} />
          ) : rows === undefined || loadFailed ? (
            <Loading />
          ) : rows.length === 0 ? (
            <p className="text-sm leading-6 text-gray-600">
              Noch niemand hat bestätigt.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {rows.map((row) => (
                <li
                  key={row.account_id}
                  className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                >
                  <span className="text-sm font-medium text-gray-900">
                    {row.name}
                  </span>
                  <span className="text-sm text-gray-500">
                    {formatChatDateTime(row.acknowledged_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
