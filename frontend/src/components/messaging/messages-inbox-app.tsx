"use client";

import { Suspense, useEffect, useRef, type ReactNode } from "react";
import {
  Collection,
  CollectionList,
  CollectionRow,
} from "~/components/ui/collection";
import { SplitView, useSplitSelection } from "~/components/ui/split-view";
import { UnreadBadge } from "~/components/messaging/unread-badge";
import {
  formatBerlinTime,
  formatChatTime,
  relativeDaysLabel,
} from "~/lib/date-helpers";
import { type InboxThread, relationshipLabel } from "~/lib/parent-messages-api";
import { useTenantAwarePath } from "~/lib/tenant-path";

/** Parameter der Auswahl in der Adresse (`/messages?unterhaltung=<id>`). */
export const INBOX_SELECTION_PARAM = "unterhaltung";

/**
 * Posteingang der Elternnachrichten in der App (#8070, Flow „Nachrichten“):
 * eine Liste in einer Karte. Jede Zeile nennt die Person, ihre Beziehung zum
 * Kind („Elternteil von Johanna Mores“, wie auf dem Desktop) und die letzte
 * Nachricht, rechts Zeit und Ungelesen-Zahl. Auf dem iPad quer steht der
 * Verlauf rechts daneben (⅓ : ⅔), sonst führt die Zeile auf die Seite des
 * Verlaufs.
 *
 * Nutzt die Inbox der Seite; lädt nichts selbst.
 */
export function MessagesInboxApp(
  props: Readonly<{
    threads: readonly InboxThread[];
    renderDetail: (threadId: string) => ReactNode;
    /** Nur im Split: über der Liste, in der Listenspalte. */
    listHeader?: ReactNode;
  }>,
) {
  // `useSearchParams` in der Auswahl braucht eine Suspense-Grenze.
  return (
    <Suspense fallback={<InboxList threads={props.threads} />}>
      <InboxSplit {...props} />
    </Suspense>
  );
}

/**
 * Die Unterhaltung, die rechts steht, solange links nichts gewählt ist: die
 * neueste ohne Ungelesenes. Eine ungelesene öffnet die App nicht von selbst,
 * denn Öffnen markiert sie als gelesen; dann fiele sie aus dem Zähler, ohne
 * dass jemand sie gelesen hat. Sind alle ungelesen, bleibt die Spalte bei
 * ihrem Hinweis.
 */
function defaultThreadId(threads: readonly InboxThread[]): string | null {
  return threads.find((thread) => thread.unread_count === 0)?.thread_id ?? null;
}

function InboxSplit({
  threads,
  renderDetail,
  listHeader,
}: Readonly<{
  threads: readonly InboxThread[];
  renderDetail: (threadId: string) => ReactNode;
  listHeader?: ReactNode;
}>) {
  // `selected` gibt es nur im Split; die Vorwahl wirkt auch nur dort, denn
  // ohne Split zeigt `SplitView` allein die Liste.
  const { selected, rowProps } = useSplitSelection(INBOX_SELECTION_PARAM);
  const active = selected ?? defaultThreadId(threads);
  // Öffnet die Seite mit einer Auswahl (direkter Aufruf, Mitteilung), steht
  // deren Zeile in der Listenspalte in Sicht, auch weit unten.
  const listRef = useRef<HTMLDivElement>(null);
  const hasThreads = threads.length > 0;
  useEffect(() => {
    if (!selected || !hasThreads) return;
    listRef.current
      ?.querySelector('[data-selected="true"]')
      ?.scrollIntoView({ block: "center" });
    // Nur beim Öffnen und bei neuer Auswahl, nicht bei jedem Neuladen.
  }, [selected, hasThreads]);
  return (
    <SplitView
      list={
        <div ref={listRef}>
          {listHeader}
          <InboxList threads={threads} rowProps={rowProps} active={active} />
        </div>
      }
      detail={active ? renderDetail(active) : null}
      empty="Wähle links eine Unterhaltung."
    />
  );
}

/**
 * Kurz wie in Chat-Apps: heute die Uhrzeit, gestern „Gestern“, sonst Tag und
 * Monat.
 */
function shortChatTime(iso: string): string {
  const day = relativeDaysLabel(iso);
  if (day === null) return "";
  if (day === "heute") return formatBerlinTime(iso);
  if (day === "gestern") return "Gestern";
  return formatChatTime(iso).split(",")[0] ?? "";
}

type RowProps = (
  id: string,
  href: string,
) => { href: string } | { onClick: () => void; selected: boolean };

function InboxList({
  threads,
  rowProps,
  active = null,
}: Readonly<{
  threads: readonly InboxThread[];
  rowProps?: RowProps;
  /** Im Split: die Unterhaltung, die rechts steht (auch vorgewählt). */
  active?: string | null;
}>) {
  const tenantPath = useTenantAwarePath();
  return (
    <Collection label="Unterhaltungen">
      <CollectionList>
        {threads.map((thread) => {
          const href = tenantPath(`/messages/${thread.thread_id}`);
          const target = rowProps ? rowProps(thread.thread_id, href) : { href };
          const shownTarget =
            "onClick" in target
              ? { ...target, selected: thread.thread_id === active }
              : target;
          const last = thread.last_message_body
            ? `${thread.last_sender_kind === "staff" ? "Du: " : ""}${thread.last_message_body}`
            : "Noch keine Nachricht";
          const unread = thread.unread_count > 0;
          return (
            <CollectionRow
              key={thread.thread_id}
              {...shownTarget}
              title={
                <span className={unread ? "font-semibold" : undefined}>
                  {thread.guardian_name}
                </span>
              }
              subtitle={
                <>
                  <span className="block truncate text-gray-700">
                    {relationshipLabel(thread.relationship_type)} von{" "}
                    {thread.student_name}
                  </span>
                  <span
                    className={
                      unread ? "block truncate text-gray-900" : "block truncate"
                    }
                  >
                    {last}
                  </span>
                </>
              }
              meta={
                <span className="flex flex-col items-end gap-1 self-start">
                  {thread.last_message_at ? (
                    <span className="text-xs text-gray-500">
                      {shortChatTime(thread.last_message_at)}
                    </span>
                  ) : null}
                  <UnreadBadge count={thread.unread_count} />
                </span>
              }
            />
          );
        })}
      </CollectionList>
    </Collection>
  );
}
