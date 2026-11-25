"use client";

import { messageKeys } from "~/lib/swr/portal-keys";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSWRAuth } from "~/lib/swr";
import {
  CheckIcon,
  FunnelSimpleIcon,
  NotePencilIcon,
} from "@phosphor-icons/react";
import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { StatusBadge } from "~/components/ui/status-badge";
import { LEADERSHIP_AUDIENCE_LABEL } from "~/lib/messaging-status";
import { TileCard } from "~/components/ui/tile-card";
import { Button } from "~/components/ui/button";
import { formErrorMessage } from "~/components/ui/form-error";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { UnreadBadge } from "~/components/messaging/unread-badge";
import { useTenant } from "~/lib/tenant-context";
import { useTenantRouter } from "~/lib/tenant-router";
import {
  type InboxThread,
  fetchInboxWithFilters,
  markAllMessagesRead,
  relationshipLabel,
} from "~/lib/parent-messages-api";
import { NewMessageModal } from "~/components/messaging/new-message-modal";
import { messagesTabs } from "~/components/messaging/messages-tabs";
import { useMessagesActivity } from "~/lib/hooks/use-messages-activity";
import { useMessagesUnread } from "~/lib/hooks/use-messages-unread";
import { useApiErrorDisplay, useToast } from "~/contexts/ToastContext";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import { formatChatDateTime } from "~/lib/date-helpers";
import { childrenConcept } from "~/lib/concepts/children";
import { parentConversationsConcept } from "~/lib/concepts/parentConversations";
import { parentsConcept } from "~/lib/concepts/parents";
import { foldForSearch } from "~/lib/search-fold";
import { useDeviceContext } from "~/lib/device-context";
import { MessagesInboxApp } from "~/components/messaging/messages-inbox-app";
import { ActionBar } from "~/components/ui/action-bar";
import { SearchBar } from "~/components/ui/page-header/SearchBar";
import { ToggleChip } from "~/components/ui/toggle-chip";
import { EmptyState } from "~/components/ui/empty-state";
import { MessageThreadContent } from "./[threadId]/page";

// Info-Knopf am Seitentitel (#7578): wofür die Seite da ist.
const MESSAGES_INFO =
  "Hier schreibst du mit den Eltern der Kinder. Jede Unterhaltung gehört zu einer Person und ihrem Kind. Tippe auf eine Unterhaltung, um sie zu öffnen.";

const logger = createLogger({ component: "MessagesInboxPage" });

const MARK_ALL_READ_LABEL = "Alle als gelesen markieren";
const COUNT_SETTING_LABEL = "Zahl bei Nachrichten einstellen";
const MARK_ALL_READ_SUCCESS =
  "Alle Nachrichten sind für dich als gelesen markiert.";
// Shown when team-marked conversations (#3654) keep the badge above zero, so
// the remaining number does not read as a failed click.
const MARK_ALL_READ_TEAM_MARKED =
  "Gelesen. Vom Team als ungelesen markierte Unterhaltungen bleiben ungelesen.";

function MessagesInboxContent() {
  const router = useTenantRouter();
  const { tenant } = useTenant();
  // Tenant-prefix the SWR key so a tenant switch (multi-tab / switch-tenant) can
  // never render the previous school's cached threads from this key (frontend
  // convention: useTenantSlugSafe is for SWR cache-key prefixing).
  // Hide the compose entry points when the school has parent-OGS messaging
  // turned off — composing would otherwise hit a backend 403 dead-end. Existing
  // threads stay readable.
  const messagingEnabled = tenant?.messagingEnabled === true;
  // App (#8070): Liste in einer Karte, „Neu“ als Symbol, iPad quer mit
  // Verlauf daneben. Der Desktop-Zweig bleibt unverändert.
  const { isApp, isSplit } = useDeviceContext();

  const [searchTerm, setSearchTerm] = useState("");
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);

  // SWR caches the inbox per filter across navigation, so returning from a
  // chat shows the list instantly and revalidates in the background — no
  // skeleton flash. keepPreviousData avoids a flash when toggling the filter.
  const {
    data: threads,
    error,
    isLoading,
    mutate,
  } = useSWRAuth(
    messageKeys.messagesInbox(onlyUnread),
    () => fetchInboxWithFilters({ onlyUnread }),
    {
      revalidateOnFocus: false,
      keepPreviousData: true,
      onError: (err: unknown) =>
        logger.error("inbox_load_failed", {
          error: err instanceof Error ? err.message : String(err),
        }),
    },
  );

  // Parent sent a message or staff replied → revalidate the inbox. The backend
  // wakes EVERY tenant staffer per message and this inbox query is heavy (joins
  // + correlated unread subqueries), so debounce: a burst collapses into a
  // single revalidation instead of one refetch per event.
  // Refetch-only (revalidates the list, never advances a read cursor), so fire
  // even in a background tab — marksRead: false skips the hidden-tab deferral.
  const refreshInbox = useCallback(() => void mutate(), [mutate]);
  useMessagesActivity({
    onMatch: refreshInbox,
    debounceMs: 500,
    marksRead: false,
  });

  // "Alle als gelesen markieren" only clears this account's own numbers;
  // colleagues keep theirs, and parents get no read receipt from it (#3673).
  const toast = useToast();
  const { unreadCount } = useMessagesUnread();
  const [markingAllRead, setMarkingAllRead] = useState(false);
  // Eine Aktion ohne Formular: der Fehler kommt als Meldung mit Wiederholen.
  const { show: showActionError } = useApiErrorDisplay();
  const latestMarkAllReadRef = useRef<() => void>(() => undefined);
  const handleMarkAllRead = async () => {
    if (markingAllRead) return;
    setMarkingAllRead(true);
    try {
      const remaining = await markAllMessagesRead();
      window.dispatchEvent(new CustomEvent("messages-unread-refresh"));
      // The own counter may skip conversations (#3673), so a team-marked
      // conversation can stay unread in the inbox while the count is zero.
      // The reloaded inbox decides which confirmation is true.
      const refreshed = await mutate();
      const stillUnread =
        remaining > 0 ||
        (refreshed ?? []).some((thread) => thread.unread_count > 0);
      toast.success(
        stillUnread ? MARK_ALL_READ_TEAM_MARKED : MARK_ALL_READ_SUCCESS,
      );
    } catch (err) {
      logger.error("inbox_mark_all_read_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void showActionError(err, {
        object: "das Markieren als gelesen",
        retry: () => latestMarkAllReadRef.current(),
      });
    } finally {
      setMarkingAllRead(false);
    }
  };
  useLayoutEffect(() => {
    latestMarkAllReadRef.current = () => void handleMarkAllRead();
  });

  // Ladefehler mit Katalogtext, Wiederholen und Vorgangskennung (#2517).
  const loadError = useSwrLoadError(error, "die Liste der Nachrichten", mutate);

  const filteredThreads = useMemo(() => {
    const list: InboxThread[] = threads ?? [];
    if (!searchTerm) return list;
    const term = foldForSearch(searchTerm);
    return list.filter(
      (thread) =>
        foldForSearch(thread.guardian_name).includes(term) ||
        foldForSearch(thread.student_name).includes(term),
    );
  }, [threads, searchTerm]);

  // Skeleton only on the very first load (no cached data yet). The header,
  // filter bar, and compose entry point are real chrome and render
  // immediately regardless — only the thread list skeletonizes.
  // Bis der Katalogtext eines Ladefehlers da ist, bleibt das Skelett stehen,
  // nie „Noch keine Nachrichten“.
  const showSkeleton =
    (isLoading && !threads) ||
    (Boolean(error) && formErrorMessage(loadError) === null);

  // Statuszeile unter dem Seitentitel, allein aus der geladenen Inbox.
  const threadList: InboxThread[] = threads ?? [];
  const unreadThreads = threadList.filter(
    (thread) => thread.unread_count > 0,
  ).length;
  // Ohne geladene Inbox steht keine "0 Unterhaltungen" neben dem Ladefehler
  // (#2517).
  const inboxSummary =
    threads === undefined ? null : (
      <TenantPageStats
        items={[
          {
            value: threadList.length,
            label: threadList.length === 1 ? "Unterhaltung" : "Unterhaltungen",
          },
          { value: unreadThreads, label: "ungelesen" },
        ]}
      />
    );

  const inboxCount =
    threads === undefined ? null : (
      <TenantPageStats
        items={[
          {
            value: threadList.length,
            label: threadList.length === 1 ? "Unterhaltung" : "Unterhaltungen",
          },
        ]}
      />
    );

  // App: „Neue Nachricht“ beschriftet in Daumennähe statt als Symbol oben.
  // Auf dem Telefon und dem iPad hoch schwebt sie als ActionBar über der
  // Pill. Im Split (iPad quer) klebt sie unten in der Listenspalte, über
  // der Pill: unten mittig läge die Leiste über dem Schreibfeld des
  // Verlaufs rechts.
  const appComposeButton = messagingEnabled ? (
    <Button
      type="button"
      variant="primary"
      size="md"
      className="w-full gap-2"
      onClick={() => setComposeOpen(true)}
      tooltip="Öffnet ein Fenster, in dem du Kind und Eltern wählst."
    >
      <NotePencilIcon size={18} aria-hidden="true" />
      Neue Nachricht
    </Button>
  ) : null;

  // App: eine Bauart auf jedem Gerät. Suche und „Ungelesen“ stehen
  // nebeneinander; die Dropdown-Zeile des Desktops schaltete sonst ab
  // 1024 px Breite auch am iPad quer um, darunter war es ein Filtersymbol.
  const appToolbar = (
    <div className="flex items-center gap-2">
      <SearchBar
        value={searchTerm}
        onChange={setSearchTerm}
        // Kurz, damit er neben „Ungelesen“ auch auf 320–375 px ganz steht;
        // gesucht wird im Namen der Person und des Kindes.
        placeholder="Name suchen…"
        inputProps={{ "aria-label": "Person oder Kind suchen" }}
        className="min-w-0 flex-1"
      />
      {/* Die Zahl wie heute im Kopf („5 ungelesen“), zugleich der Filter. */}
      <ToggleChip
        pressed={onlyUnread}
        onPressedChange={setOnlyUnread}
        className="shrink-0 whitespace-nowrap tabular-nums"
      >
        {/* Ein Filter, keine Kennzahl (Runde 9): das Symbol zeigt, dass er
            die Liste einschränkt, der Haken, dass er gerade wirkt. */}
        {onlyUnread ? (
          <CheckIcon size={16} weight="bold" className="mr-1.5" aria-hidden />
        ) : (
          <FunnelSimpleIcon size={16} className="mr-1.5" aria-hidden />
        )}
        {unreadThreads > 0 ? `${unreadThreads} ungelesen` : "Ungelesen"}
      </ToggleChip>
    </div>
  );

  const composeButton =
    !messagingEnabled || isApp ? undefined : (
      <Button
        type="button"
        variant="primary"
        size="md"
        onClick={() => setComposeOpen(true)}
        tooltip="Öffnet ein Fenster, in dem du Kind und Eltern wählst."
      >
        Neue Nachricht
      </Button>
    );

  // Der Fehler ersetzt den Inhalt nur, wenn nichts anzuzeigen ist. Liegt noch
  // eine (möglicherweise veraltete) Liste vor, bleibt sie stehen und der
  // Hinweis steht darüber.
  const hasThreads = filteredThreads.length > 0;
  const loadFailed = Boolean(error);
  const filtersActive = searchTerm.trim().length > 0 || onlyUnread;
  // Fehler- und Leerzustand ersetzen den Inhalt des Gerüsts. Solange das
  // Verfassen-Fenster offen ist, muss der Inhalt gerendert werden, denn dort
  // hängt das Fenster.
  // App: findet die Suche nichts, bleibt die Karte mit der Suche stehen,
  // sonst verschwände das Suchfeld mit dem Ergebnis.
  const appFilterEmpty = isApp && !hasThreads && filtersActive && !loadFailed;
  const bodyReplaced =
    !showSkeleton && !hasThreads && !composeOpen && !appFilterEmpty;

  return (
    <TenantPage
      info={MESSAGES_INFO}
      title="Nachrichten"
      tabs={messagesTabs("conversations")}
      // App: „ungelesen“ steht als Filter über der Liste; die Zahl der
      // Unterhaltungen bleibt wie auf dem Desktop im Kopf (#8070, Runde 7).
      stats={isApp ? inboxCount : inboxSummary}
      statsLoading={showSkeleton}
      actions={composeButton}
      overflowMenu={[
        // Only offered while something is unread: an entry that can do
        // nothing is not in the menu. Own counter or inbox rows, because a
        // person who does not count every conversation (#3673) may still see
        // unread rows here.
        ...(messagingEnabled && (unreadCount > 0 || unreadThreads > 0)
          ? [
              {
                label: MARK_ALL_READ_LABEL,
                description: "Gilt nur für dich, nicht für dein Team",
                onClick: () => void handleMarkAllRead(),
                disabled: markingAllRead,
              },
            ]
          : []),
        ...(messagingEnabled
          ? [
              {
                label: COUNT_SETTING_LABEL,
                description: "Öffnet dein Profil, dort legst du die Zahl fest",
                onClick: () => router.push("/profile"),
              },
            ]
          : []),
      ]}
      // App: Suche und Filter in der Leiste der Kopfkarte wie in der
      // Kindersuche; sie klebt beim Scrollen (Runde 9).
      searchSlot={isApp ? appToolbar : undefined}
      search={
        isApp
          ? undefined
          : {
              value: searchTerm,
              onChange: setSearchTerm,
              placeholder: "Person oder Kind suchen…",
            }
      }
      filters={
        isApp
          ? undefined
          : [
              {
                id: "unread",
                type: "dropdown",
                label: "Nachrichten filtern",
                value: onlyUnread ? "unread" : "all",
                onChange: (next) => setOnlyUnread(next === "unread"),
                options: [
                  { value: "all", label: "Alle Nachrichten" },
                  { value: "unread", label: "Nur ungelesen" },
                ],
              },
            ]
      }
      error={bodyReplaced && loadFailed ? loadError : null}
      empty={
        bodyReplaced && !loadFailed
          ? {
              icon: (
                <MotoConceptIcon
                  concept={parentConversationsConcept}
                  size={48}
                />
              ),
              title: filtersActive
                ? "Keine passenden Nachrichten"
                : "Noch keine Nachrichten",
              description: filtersActive
                ? "Ändere die Suche oder den Filter."
                : messagingEnabled
                  ? "Hier erscheinen Unterhaltungen mit den Eltern. Über „Neue Nachricht“ kannst du selbst eine beginnen."
                  : "Der Nachrichtenaustausch mit den Eltern ist für diese Schule ausgeschaltet.",
            }
          : null
      }
      // Der Ladezustand kommt aus dem Gerüst, nicht aus einem eigenen Skelett
      // im Inhalt.
      loading={showSkeleton}
      overlays={
        <>
          {composeOpen ? (
            <NewMessageModal
              onClose={() => setComposeOpen(false)}
              onOpened={(thread) =>
                router.push(`/messages/${thread.thread_id}`)
              }
            />
          ) : null}
          {/* Im Split steht der Knopf über der Liste; ohne Liste (leer,
              Fehler) braucht er auch dort die Leiste. */}
          {isApp && appComposeButton && (!isSplit || bodyReplaced) ? (
            <ActionBar>{appComposeButton}</ActionBar>
          ) : null}
        </>
      }
    >
      <>
        {loadFailed && <LoadErrorAlert error={loadError} />}

        {isApp ? (
          <MessagesInboxApp
            threads={filteredThreads}
            listAction={isSplit ? appComposeButton : null}
            empty={
              <EmptyState
                variant="compact"
                title="Keine passenden Nachrichten"
                description="Ändere die Suche oder den Filter."
              />
            }
            renderDetail={(threadId) => (
              <MessageThreadContent
                key={threadId}
                threadId={threadId}
                embedded
              />
            )}
          />
        ) : (
          <ul className="space-y-3">
            {filteredThreads.map((thread) => {
              const navigate = () =>
                router.push(`/messages/${thread.thread_id}`);

              return (
                <li key={thread.thread_id}>
                  <TileCard onClick={navigate}>
                    {/* Absender und Kind tragen die Symbole aus dem
                      Konzeptregister, wie in den Anfragen (#4361). */}
                    <div className="flex min-w-0 items-center gap-2">
                      <MotoConceptIcon concept={parentsConcept} size={20} />
                      <h3 className="truncate text-base font-semibold text-gray-900">
                        {thread.guardian_name}
                      </h3>
                      {thread.audience === "leadership" && (
                        <StatusBadge
                          tone="blue"
                          label={LEADERSHIP_AUDIENCE_LABEL}
                          compact
                        />
                      )}
                      <UnreadBadge count={thread.unread_count} />
                      {thread.last_message_at && (
                        <span className="ml-auto flex-shrink-0 pl-1 text-xs whitespace-nowrap text-gray-500">
                          {formatChatDateTime(thread.last_message_at)}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 flex min-w-0 items-center gap-1.5 text-sm text-gray-500">
                      <span className="flex-shrink-0">
                        {relationshipLabel(thread.relationship_type)} von
                      </span>
                      <MotoConceptIcon concept={childrenConcept} size={16} />
                      <span className="truncate font-medium text-gray-700">
                        {thread.student_name}
                      </span>
                    </p>
                    {thread.last_message_body && (
                      <p className="mt-1 truncate text-sm text-gray-600">
                        {thread.last_sender_kind === "staff" && (
                          <span className="text-gray-500">Du: </span>
                        )}
                        {thread.last_message_body}
                      </p>
                    )}
                  </TileCard>
                </li>
              );
            })}
          </ul>
        )}
      </>
    </TenantPage>
  );
}

export default function MessagesPage() {
  return <MessagesInboxContent />;
}
