"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { MessageCircle } from "lucide-react";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { ChoiceTile } from "~/components/ui/choice-tile";
import { Radio } from "~/components/ui/radio";
import { Skeleton } from "~/components/ui/skeleton";
import { SectionCard } from "~/components/ui/section-card";
import { useApiErrorDisplay } from "~/contexts/ToastContext";
import { ApiError, wireErrorCode } from "~/lib/api-error";
import { createLogger } from "~/lib/logger";
import {
  fetchMessageCountSetting,
  saveMessageCountScope,
  type MessageCountScope,
} from "~/lib/parent-messages-api";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { useSWRAuth } from "~/lib/swr";
import { tenantAdminKeys } from "~/lib/swr/tenant-admin-keys";
import { useTenantSafe } from "~/lib/tenant-context";

const logger = createLogger({ component: "MessageCountSection" });

const OPTIONS: ReadonlyArray<{
  value: MessageCountScope;
  label: string;
  description: string;
}> = [
  {
    value: "all",
    label: "Alle Nachrichten",
    description: "Jede neue Nachricht von Eltern zählt.",
  },
  {
    value: "own_groups",
    label: "Nur Kinder aus meinen Gruppen",
    description: "Nachrichten zu anderen Kindern zählen nicht.",
  },
  {
    value: "none",
    label: "Keine Zahl anzeigen",
    description: "Die Nachrichten stehen trotzdem unter „Nachrichten“.",
  },
];

const NO_GROUP_HINT =
  "Du gehörst zurzeit zu keiner Gruppe. Dann zeigt die Zahl nichts.";

/**
 * Personal count scope for parent messages (#3673): which conversations the
 * own counter at "Nachrichten" counts. It changes only this person's number;
 * the inbox, colleagues and parents see no change.
 *
 * Self-service like the birthday switch: a colleague who does not answer
 * parent messages turns the number off here instead of clearing it every day.
 * The card hides itself while the school has messaging off, and for accounts
 * the backend refuses (no read access to messages, general.permission).
 */
export function MessageCountSection() {
  const messagingEnabled = useTenantSafe()?.tenant?.messagingEnabled === true;
  const [busy, setBusy] = useState(false);
  const {
    data: setting,
    error: settingError,
    mutate,
  } = useSWRAuth(
    messagingEnabled ? tenantAdminKeys.messageCountSetting() : null,
    fetchMessageCountSetting,
  );
  // Ohne Leserecht für Nachrichten gibt es keine Zahl, die man einstellen
  // könnte: die Karte blendet sich aus.
  const unavailable =
    setting === undefined &&
    settingError instanceof ApiError &&
    wireErrorCode(settingError.code) === "general.permission";
  // Laden: Fehler vor Ort mit Wiederholen. Die Auswahl speichert sofort,
  // ohne Formular: ein Fehler kommt als Toast (#2517).
  const { error: loadError, failure } = useSwrResourceLoadError(
    [{ data: setting, error: unavailable ? undefined : settingError }],
    "die Einstellung zur Zahl bei Nachrichten",
    () => mutate(),
  );
  const { show: showSaveError } = useApiErrorDisplay();
  const latestChooseRef = useRef<(next: MessageCountScope) => void>(
    () => undefined,
  );
  const scope = setting?.scope ?? "all";
  const hasOwnGroups = setting?.hasOwnGroups ?? true;

  const choose = async (next: MessageCountScope) => {
    if (next === scope || busy) return;
    // Optimistic: the choice answers immediately and rolls back on failure.
    const previous = setting;
    setBusy(true);
    if (setting)
      void mutate({ ...setting, scope: next }, { revalidate: false });
    try {
      await saveMessageCountScope(next);
      window.dispatchEvent(new CustomEvent("messages-unread-refresh"));
    } catch (err) {
      logger.error("message_count_scope_save_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void mutate(previous, { revalidate: false });
      void showSaveError(err, {
        object: "die Einstellung zur Zahl bei Nachrichten",
        retry: () => latestChooseRef.current(next),
      });
    } finally {
      setBusy(false);
    }
  };

  useLayoutEffect(() => {
    latestChooseRef.current = (next) => void choose(next);
  });

  if (!messagingEnabled || unavailable) return null;

  return (
    <SectionCard
      icon={MessageCircle}
      headingLevel={3}
      title="Zahl bei Nachrichten"
      description="Die Zahl bei „Nachrichten“ zeigt neue Nachrichten von Eltern. Die Einstellung gilt nur für dich."
    >
      {/* Bis der Text eines Ladefehlers da ist, bleibt das Skelett stehen. */}
      {(setting === undefined && !failure) || (failure && !loadError) ? (
        <Skeleton className="h-36 w-full" />
      ) : failure ? (
        <LoadErrorAlert error={loadError} />
      ) : (
        <fieldset className="space-y-2">
          <legend className="sr-only">Was die Zahl zählt</legend>
          {OPTIONS.map((option) => {
            const id = `message-count-scope-${option.value}`;
            const selected = scope === option.value;
            return (
              <ChoiceTile
                key={option.value}
                htmlFor={id}
                selected={selected}
                disabled={busy}
                className="items-start p-3"
              >
                <Radio
                  id={id}
                  name="message-count-scope"
                  value={option.value}
                  checked={selected}
                  disabled={busy}
                  onChange={() => void choose(option.value)}
                  className="mt-0.5"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-gray-900">
                    {option.label}
                  </span>
                  <span className="mt-0.5 block text-xs font-normal text-gray-600">
                    {option.description}
                  </span>
                  {option.value === "own_groups" && !hasOwnGroups && (
                    <span className="mt-1 block text-xs font-normal text-gray-600">
                      {NO_GROUP_HINT}
                    </span>
                  )}
                </span>
              </ChoiceTile>
            );
          })}
        </fieldset>
      )}
    </SectionCard>
  );
}
