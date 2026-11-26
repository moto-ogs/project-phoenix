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
import { StatusBadge } from "~/components/ui/status-badge";
import { LEADERSHIP_AUDIENCE_LABEL } from "~/lib/messaging-status";
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
    /** Kennzahlen des Desktop-Kopfs als erste Zeile der Liste. */
    summary?: string;
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
          summary={props.summary}
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
  summary,
}: Readonly<{
  threads: readonly InboxThread[];
  renderDetail: (threadId: string) => ReactNode;
  listAction?: ReactNode;
  header?: ReactNode;
  empty?: ReactNode;
  summary?: string;
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
            summary={summary}
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
 * Monat. Auf jedem Telefon gleich (Runde 13): die Uhrzeit älterer
 * Nachrichten steht im Verlauf und im Vorlesetext der Zeile.
 */
function chatTimeParts(
  iso: string,
): { date: string; time: string | null } | null {
  const day = relativeDaysLabel(iso);
  if (day === null) return null;
  const time = formatBerlinTime(iso);
  if (day === "heute") return { date: time, time: null };
  const date =
    day === "gestern" ? "Gestern" : (formatChatTime(iso).split(",")[0] ?? "");
  return { date, time };
}

function ChatTime({ iso }: Readonly<{ iso: string }>) {
  const parts = chatTimeParts(iso);
  if (parts === null) return null;
  return (
    <>
      {/* iPad hoch: mit Uhrzeit wie bisher. */}
      {parts.date}
      {parts.time ? (
        <span className="tablet:inline hidden">, {parts.time}</span>
      ) : null}
    </>
  );
}

/** Die Zeit als Text für den zugänglichen Namen der Zeile, voll. */
function chatTimeText(iso: string | null | undefined): string {
  const parts = iso ? chatTimeParts(iso) : null;
  if (parts === null) return "";
  return parts.time ? `${parts.date}, ${parts.time}` : parts.date;
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
  summary,
}: Readonly<{
  threads: readonly InboxThread[];
  header?: ReactNode;
  empty?: ReactNode;
  summary?: string;
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
        <div className="border-b border-gray-100 px-4 py-2">{header}</div>
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
              // Beginnt mit dem sichtbaren Text der Zeile (Sprachsteuerung,
              // axe label-content-name-mismatch): Person · Rolle, Abzeichen,
              // Zeit; dann das Kind und die Zahl der ungelesenen.
              aria-label={[
                `${thread.guardian_name} · ${
                  wide ? relation : relationshipLabel(thread.relationship_type)
                }`,
                thread.audience === "leadership"
                  ? ` ${LEADERSHIP_AUDIENCE_LABEL}`
                  : "",
                thread.last_message_at
                  ? ` ${chatTimeText(thread.last_message_at)}`
                  : "",
                wide ? "" : `, ${relation}`,
                unread ? `, ${thread.unread_count} ungelesen` : "",
              ].join("")}
              leading={
                <Avatar
                  name={thread.guardian_name}
                  size={layout === "phone" ? "sm" : "md"}
                  tone="neutral"
                  decorative
                />
              }
              // Breit (iPad hoch): Person samt Beziehung zum Kind, darunter
              // die letzte Nachricht. Schmal (Telefon, Runde 11): zwei Zeilen
              // wie in Chat-Apps – oben die Person mit ihrer Rolle, darunter
              // das Kind und die letzte Nachricht. So bleibt die Zeile bei
              // 56–64 px und am SE stehen acht Unterhaltungen im Bild.
              title={
                <span className="flex min-w-0 items-baseline gap-2">
                  {/* Name ganz, die Rolle ganz oder gar nicht (Runde 13):
                      passt sie nicht mehr in die Zeile, bricht sie in eine
                      zweite, unsichtbare Zeile um, statt „Eltern…“ zu
                      zeigen. Im Vorlesetext steht sie immer. */}
                  <span
                    className={cn(
                      "min-w-0 flex-1",
                      wide
                        ? "truncate"
                        : "flex h-lh flex-wrap items-baseline overflow-hidden",
                    )}
                  >
                    <span
                      className={cn(
                        !wide && "max-w-full truncate",
                        unread && "font-semibold",
                      )}
                    >
                      {thread.guardian_name}
                    </span>
                    <span className="font-normal whitespace-pre text-gray-500">
                      {" · "}
                      {wide
                        ? relation
                        : relationshipLabel(thread.relationship_type)}
                    </span>
                    {wide && thread.audience === "leadership" ? (
                      <span className="ml-1.5 inline-flex align-[1px]">
                        <StatusBadge
                          tone="blue"
                          label={LEADERSHIP_AUDIENCE_LABEL}
                          compact
                        />
                      </span>
                    ) : null}
                  </span>
                  {/* Schmal: das Abzeichen bleibt stehen, auch wenn die
                      Rolle ausgeblendet ist. */}
                  {!wide && thread.audience === "leadership" ? (
                    <span className="inline-flex shrink-0 self-center">
                      <StatusBadge
                        tone="blue"
                        label={LEADERSHIP_AUDIENCE_LABEL}
                        compact
                      />
                    </span>
                  ) : null}
                  {/* Wie in Chat-Apps: Zeit oben rechts, die Zahl der
                      ungelesenen darunter; die Vorschau nutzt die Breite. */}
                  {/* Leerzeichen für den zugänglichen Text („Elternteil
                      24.11.“ statt „Elternteil24.11.“); im Flex unsichtbar. */}
                  {thread.last_message_at ? " " : null}
                  {thread.last_message_at ? (
                    <span className="shrink-0 text-xs font-normal text-gray-500 tabular-nums">
                      <ChatTime iso={thread.last_message_at} />
                    </span>
                  ) : null}
                </span>
              }
              subtitle={
                <span className="flex min-w-0 items-center gap-2">
                  {wide ? (
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate",
                        unread && "text-gray-900",
                      )}
                    >
                      {last}
                    </span>
                  ) : (
                    <span className="flex min-w-0 flex-1 items-baseline">
                      {/* Ein Kopf = Kind. */}
                      {/* Das Kind steht ganz; gekürzt wird die Vorschau. */}
                      <span className="flex max-w-full min-w-0 shrink-0 items-baseline font-medium text-gray-700">
                        <MotoConceptIcon
                          concept={childrenConcept}
                          size={14}
                          className="mr-0.5 inline-block shrink-0 self-center"
                        />
                        <span className="truncate">{thread.student_name}</span>
                      </span>
                      <span aria-hidden="true" className="shrink-0 px-1">
                        ·
                      </span>
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate",
                          unread && "text-gray-900",
                        )}
                      >
                        {last}
                      </span>
                    </span>
                  )}
                  {unread ? <UnreadBadge count={thread.unread_count} /> : null}
                </span>
              }
            />
          );
        })}
      </CollectionList>
      {/* Am Ende der Liste (Runde 13): oben kostete die Zeile am SE eine
          Unterhaltung im ersten Bild. */}
      {summary ? (
        <p className="border-t border-gray-100 px-4 py-2 text-xs leading-4 text-gray-500 tabular-nums">
          {summary}
        </p>
      ) : null}
    </Collection>
  );
}
