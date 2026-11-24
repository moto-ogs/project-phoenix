"use client";

import { Suspense, type ReactNode } from "react";
import {
  Collection,
  CollectionList,
  CollectionRow,
} from "~/components/ui/collection";
import { SplitView, useSplitSelection } from "~/components/ui/split-view";
import { UnreadBadge } from "~/components/messaging/unread-badge";
import {
  berlinTodayISO,
  formatBerlinTime,
  formatChatTime,
} from "~/lib/date-helpers";
import { type InboxThread, relationshipLabel } from "~/lib/parent-messages-api";
import { useTenantAwarePath } from "~/lib/tenant-path";

/**
 * Posteingang der Elternnachrichten in der App (#8070, Flow „Nachrichten“):
 * eine Liste in einer Karte, Zeilen 56–64 px mit Name, letzter Nachricht in
 * einer Zeile, Zeit und Ungelesen-Zahl. Auf dem iPad quer steht der Verlauf
 * rechts daneben (⅓ : ⅔), sonst führt die Zeile auf die Seite des Verlaufs.
 *
 * Nutzt die Inbox der Seite; lädt nichts selbst.
 */
export function MessagesInboxApp(
  props: Readonly<{
    threads: readonly InboxThread[];
    renderDetail: (threadId: string) => ReactNode;
  }>,
) {
  // `useSearchParams` in der Auswahl braucht eine Suspense-Grenze.
  return (
    <Suspense fallback={<InboxList threads={props.threads} />}>
      <InboxSplit {...props} />
    </Suspense>
  );
}

function InboxSplit({
  threads,
  renderDetail,
}: Readonly<{
  threads: readonly InboxThread[];
  renderDetail: (threadId: string) => ReactNode;
}>) {
  const { selected, rowProps } = useSplitSelection("unterhaltung");
  return (
    <SplitView
      list={<InboxList threads={threads} rowProps={rowProps} />}
      detail={selected ? renderDetail(selected) : null}
      empty="Wähle links eine Unterhaltung."
    />
  );
}

/** Kurz wie in Chat-Apps: heute die Uhrzeit, sonst Tag und Monat. */
function shortChatTime(iso: string): string {
  const sent = new Date(iso);
  if (Number.isNaN(sent.getTime())) return "";
  if (berlinTodayISO(sent) === berlinTodayISO()) return formatBerlinTime(iso);
  return formatChatTime(iso).split(",")[0] ?? "";
}

type RowProps = (
  id: string,
  href: string,
) => { href: string } | { onClick: () => void; selected: boolean };

function InboxList({
  threads,
  rowProps,
}: Readonly<{ threads: readonly InboxThread[]; rowProps?: RowProps }>) {
  const tenantPath = useTenantAwarePath();
  return (
    <Collection label="Unterhaltungen">
      <CollectionList>
        {threads.map((thread) => {
          const href = tenantPath(`/messages/${thread.thread_id}`);
          const target = rowProps ? rowProps(thread.thread_id, href) : { href };
          const last = thread.last_message_body
            ? `${thread.last_sender_kind === "staff" ? "Du: " : ""}${thread.last_message_body}`
            : null;
          return (
            <CollectionRow
              key={thread.thread_id}
              {...target}
              title={
                <>
                  <span
                    className={
                      thread.unread_count > 0 ? "font-semibold" : undefined
                    }
                  >
                    {thread.guardian_name}
                  </span>
                  <span className="font-normal text-gray-500">
                    {" · "}
                    {thread.student_name}
                  </span>
                </>
              }
              aria-label={`${thread.guardian_name}, ${relationshipLabel(thread.relationship_type)} von ${thread.student_name}`}
              subtitle={last ?? "Noch keine Nachricht"}
              meta={
                <span className="flex flex-col items-end gap-1">
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
