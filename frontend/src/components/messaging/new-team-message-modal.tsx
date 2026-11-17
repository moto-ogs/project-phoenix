"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Modal } from "~/components/ui/modal";
import { formErrorMessage } from "~/components/ui/form-error";
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import { Input } from "~/components/ui/input";
import { useApiFormError } from "~/contexts/ToastContext";
import {
  type MessageableStaff,
  type StaffMessagesApi,
  staffRoleKindLabel,
} from "~/lib/staff-messages-api";
import { createLogger } from "~/lib/logger";
import { foldForSearch } from "~/lib/search-fold";
import { Loading } from "~/components/ui/loading";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { useSWRAuth } from "~/lib/swr";
import { tenantContactKeys } from "~/lib/swr/tenant-contact-keys";

const logger = createLogger({ component: "NewTeamMessageModal" });

const NO_PEOPLE: readonly MessageableStaff[] = [];

/**
 * The colleagues the reader may write to, shared by the new-message and the
 * group dialogs. Until the catalog text is there, a failed list keeps its
 * loading line, never an empty-list text.
 */
export function useTeamRecipients(api: StaffMessagesApi) {
  const { data, error, mutate } = useSWRAuth(
    tenantContactKeys.teamChatRecipients(),
    () => api.fetchRecipients(),
  );
  const load = useSwrResourceLoadError(
    [{ data, error }],
    "die Liste der Personen",
    () => mutate(),
  );
  const loadFailed = load.failure !== undefined;
  return {
    people: data ?? NO_PEOPLE,
    loadFailed,
    loadError: load.error,
    loading:
      (data === undefined && !error) ||
      (loadFailed && formErrorMessage(load.error) === null),
  };
}

/**
 * Starts an internal conversation: pick one colleague, the chat opens directly.
 *
 * One step, unlike the parent-facing NewMessageModal (child → guardian): the
 * recipient IS the whole choice here. The backend get-or-creates the
 * conversation, so picking someone you already write with lands in the existing
 * history rather than creating a second thread.
 *
 * Portal-neutral (#2208): the API client and the reader's portal come in as
 * props, so the school portal reuses it against its own proxy routes.
 */
export function NewTeamMessageModal({
  api,
  portal,
  hint,
  onClose,
  onOpened,
}: {
  readonly api: StaffMessagesApi;
  readonly portal: "tenant" | "school";
  /** The one line under the title that says who can be reached here. */
  readonly hint: string;
  readonly onClose: () => void;
  readonly onOpened: (threadId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const { people, loadFailed, loadError, loading } = useTeamRecipients(api);
  // Opening a chat fails in the alert above the list (#2517).
  const [openingId, setOpeningId] = useState<string | null>(null);
  const openError = useApiFormError();
  const latestPickRef = useRef<(person: MessageableStaff) => void>(
    () => undefined,
  );

  const filtered = useMemo(() => {
    const term = foldForSearch(query.trim());
    if (!term) return people;
    return people.filter((person) => foldForSearch(person.name).includes(term));
  }, [people, query]);

  const handlePick = async (person: MessageableStaff) => {
    if (openingId) return;
    setOpeningId(person.account_id);
    openError.clear();
    try {
      const thread = await api.openThread(person.account_id);
      onOpened(thread.thread_id);
    } catch (err) {
      logger.error("team_thread_open_failed", {
        error: err instanceof Error ? err.message : String(err),
        account_id: person.account_id,
      });
      void openError.show(err, {
        object: "die Unterhaltung",
        retry: () => latestPickRef.current(person),
      });
    } finally {
      setOpeningId(null);
    }
  };
  useLayoutEffect(() => {
    latestPickRef.current = (person) => void handlePick(person);
  });

  return (
    <Modal isOpen onClose={onClose} title="Neue Nachricht">
      <div className="space-y-3">
        <p className="text-sm text-gray-600">{hint}</p>

        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Person suchen..."
          autoFocus
        />

        <FormErrorAlert message={openError.error} />
        <LoadErrorAlert error={loadError} />

        <div className="max-h-72 space-y-1 overflow-y-auto">
          {loading && <Loading compact message="Wird geladen …" />}

          {!loading && !loadFailed && filtered.length === 0 && (
            <p className="py-3 text-center text-sm text-gray-500">
              {people.length === 0
                ? "Es gibt niemanden, dem Sie schreiben können."
                : "Niemand gefunden."}
            </p>
          )}

          {filtered.map((person) => {
            const roleLabel = staffRoleKindLabel(person.role_kind, portal);
            return (
              <button
                key={person.account_id}
                type="button"
                disabled={openingId !== null}
                onClick={() => void handlePick(person)}
                className="flex w-full items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-left hover:bg-gray-50 disabled:opacity-60"
              >
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="truncate text-sm font-medium text-gray-900">
                    {person.name}
                  </span>
                  {roleLabel && (
                    <span className="flex-shrink-0 text-xs text-gray-500">
                      {roleLabel}
                    </span>
                  )}
                </span>
                {openingId === person.account_id && (
                  <span className="ml-2 flex-shrink-0 text-xs text-gray-500">
                    Wird geöffnet...
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
