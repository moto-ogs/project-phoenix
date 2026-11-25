"use client";

import { Suspense, useEffect, useRef, type ReactNode } from "react";
import {
  Collection,
  CollectionList,
  CollectionRow,
} from "~/components/ui/collection";
import { Z_LAYER } from "~/components/ui/overlay-styles";
import { SectionCard } from "~/components/ui/section-card";
import { SplitView, useSplitSelection } from "~/components/ui/split-view";
import { UnreadBadge } from "~/components/messaging/unread-badge";
import { Avatar } from "~/components/ui/avatar";
import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import { childrenConcept } from "~/lib/concepts/children";
import { useDeviceContext } from "~/lib/device-context";
import {
  formatBerlinTime,
  formatChatTime,
  relativeDaysLabel,
} from "~/lib/date-helpers";
import { type InboxThread, relationshipLabel } from "~/lib/parent-messages-api";
import { useTenantAwarePath } from "~/lib/tenant-path";
import { cn } from "~/lib/utils";

/** Parameter der Auswahl in der Adresse (`/messages?unterhaltung=<id>`). */
export const INBOX_SELECTION_PARAM = "unterhaltung";

/**
 * Posteingang der Elternnachrichten in der App (#8070, Flow „Nachrichten“):
 * eine Liste in einer Karte, Zeilen zweizeilig wie in Chat-Apps (56–64 px):
 * Avatar, Person und Kind (am iPad hoch mit Beziehung, „Elternteil von
 * Johanna Mores“), darunter die letzte Nachricht; rechts Zeit und
 * Ungelesen-Zahl. Auf dem iPad quer steht der Verlauf rechts daneben
 * (⅓ : ⅔), „Neue Nachricht“ klebt unten in der Listenspalte; sonst führt die
 * Zeile auf die Seite des Verlaufs.
 *
 * Nutzt die Inbox der Seite; lädt nichts selbst.
 */
export function MessagesInboxApp(
  props: Readonly<{
    threads: readonly InboxThread[];
    renderDetail: (threadId: string) => ReactNode;
    /**
     * Nur im Split: die Hauptaktion unten in der Listenspalte, in
     * Daumennähe wie die ActionBar am Telefon.
     */
    listAction?: ReactNode;
    /**
     * Telefon: Suche und „Ungelesen“ als Kopf der Liste (in der Karte); so
     * bleibt die Kopfkarte der Seite am kleinen Telefon flach.
     */
    header?: ReactNode;
    /** Steht in der Karte, wenn Suche oder Filter nichts finden. */
    empty?: ReactNode;
  }>,
) {
  // `useSearchParams` in der Auswahl braucht eine Suspense-Grenze.
  return (
    <Suspense
      fallback={
        <InboxList
          threads={props.threads}
          header={props.header}
          empty={props.empty}
        />
      }
    >
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
  listAction,
  header,
  empty,
}: Readonly<{
  threads: readonly InboxThread[];
  renderDetail: (threadId: string) => ReactNode;
  listAction?: ReactNode;
  header?: ReactNode;
  empty?: ReactNode;
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
          <InboxList
            threads={threads}
            rowProps={rowProps}
            active={active}
            header={header}
            empty={empty}
          />
          {listAction ? (
            // Klebt unten in der eigenen Scroll-Spalte der Liste: über der
            // Pill, nie über dem Schreibfeld des Verlaufs rechts.
            <div
              data-split-list-action=""
              className={`sticky bottom-0 ${Z_LAYER.sticky} pt-2`}
            >
              <SectionCard padding="none" className="p-2">
                {listAction}
              </SectionCard>
            </div>
          ) : null}
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
  header,
  empty,
}: Readonly<{
  threads: readonly InboxThread[];
  header?: ReactNode;
  empty?: ReactNode;
  rowProps?: RowProps;
  /** Im Split: die Unterhaltung, die rechts steht (auch vorgewählt). */
  active?: string | null;
}>) {
  const tenantPath = useTenantAwarePath();
  const { layout, isSplit } = useDeviceContext();
  // Am iPad hoch passt „Elternteil von Johanna Mores“ ganz in die Zeile.
  const wide = layout === "tablet" && !isSplit;
  return (
    <Collection label="Unterhaltungen">
      {header ? (
        <div className="border-b border-gray-100 px-4 py-3">{header}</div>
      ) : null}
      {threads.length === 0 && empty ? empty : null}
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
          const relation = `${relationshipLabel(thread.relationship_type)} von ${thread.student_name}`;
          return (
            <CollectionRow
              key={thread.thread_id}
              {...shownTarget}
              // Beginnt mit dem sichtbaren Text der Zeile (Sprachsteuerung),
              // schmal folgt die Beziehung, die dort nicht sichtbar ist.
              aria-label={`${thread.guardian_name} · ${
                wide
                  ? relation
                  : `${thread.student_name}, ${relationshipLabel(thread.relationship_type)}`
              }${unread ? `, ${thread.unread_count} ungelesen` : ""}`}
              leading={
                <Avatar
                  name={thread.guardian_name}
                  size={layout === "phone" ? "sm" : "md"}
                  tone="neutral"
                  decorative
                />
              }
              // Zwei Zeilen wie in Chat-Apps. Breit (iPad hoch): Person samt
              // Beziehung zum Kind, darunter die letzte Nachricht. Schmal
              // (Telefon): die Person allein, darunter das Kind ganz und
              // danach die gekürzte Nachricht – so bleibt die Zuordnung
              // Eltern → Kind auch am kleinen Telefon lesbar.
              title={
                <>
                  <span className={unread ? "font-semibold" : undefined}>
                    {thread.guardian_name}
                  </span>
                  {wide ? (
                    <span className="font-normal text-gray-500">
                      {" · "}
                      {relation}
                    </span>
                  ) : null}
                </>
              }
              subtitle={
                wide ? (
                  <span className={unread ? "text-gray-900" : undefined}>
                    {last}
                  </span>
                ) : (
                  <span className="flex min-w-0 items-baseline gap-1">
                    {/* Ein Kopf = Kind; die Beziehung steht im Kopf des
                        Verlaufs. */}
                    <span className="flex shrink-0 items-baseline font-medium text-gray-700">
                      <MotoConceptIcon
                        concept={childrenConcept}
                        size={14}
                        className="mr-0.5 inline-block self-center"
                      />
                      {thread.student_name}
                    </span>
                    <span
                      className={cn(
                        "min-w-0 truncate",
                        unread && "text-gray-900",
                      )}
                    >
                      · {last}
                    </span>
                  </span>
                )
              }
              meta={
                <span className="flex flex-col items-end gap-1">
                  {thread.last_message_at ? (
                    <span className="text-xs leading-5 text-gray-500">
                      {shortChatTime(thread.last_message_at)}
                    </span>
                  ) : null}
                  {unread ? (
                    <UnreadBadge count={thread.unread_count} />
                  ) : (
                    // Gleiche Höhe mit und ohne Zahl, damit die Zeit in
                    // jeder Zeile auf derselben Linie steht.
                    <span aria-hidden="true" className="h-5" />
                  )}
                </span>
              }
            />
          );
        })}
      </CollectionList>
    </Collection>
  );
}
