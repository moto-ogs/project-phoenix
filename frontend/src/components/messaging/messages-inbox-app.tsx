"use client";

import type { ReactNode } from "react";
import {
  Collection,
  CollectionList,
  CollectionRow,
} from "~/components/ui/collection";
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

/**
 * Posteingang der Elternnachrichten in der App (#8070, Flow „Nachrichten“):
 * eine Liste in einer Karte, Zeilen zweizeilig wie in Chat-Apps (56–64 px):
 * Avatar, oben die Person mit ihrer Rolle, darunter Kind und letzte
 * Nachricht; rechts Zeit und Ungelesen-Zahl. Die Zeile führt auf die Seite
 * des Verlaufs.
 *
 * Nutzt die Inbox der Seite; lädt nichts selbst.
 */
export function MessagesInboxApp(
  props: Readonly<{
    threads: readonly InboxThread[];
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
  return (
    <div>
      <InboxList {...props} />
    </div>
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
  return <>{parts.date}</>;
}

/** Die Zeit als Text für den zugänglichen Namen der Zeile, voll. */
function chatTimeText(iso: string | null | undefined): string {
  const parts = iso ? chatTimeParts(iso) : null;
  if (parts === null) return "";
  return parts.time ? `${parts.date}, ${parts.time}` : parts.date;
}

const SHORT_PHONE_ROWS =
  "[@media(max-height:760px)]:[&_[data-collection-row]]:min-h-[52px] [@media(max-height:760px)]:[&_[data-collection-row]]:py-1.5 [@media(max-height:760px)]:[&_[data-collection-row]>.flex-1>span]:mt-0 [@media(max-height:760px)]:[&_[data-collection-row]>.flex-1>span]:leading-[18px]";

function InboxList({
  threads,
  header,
  empty,
  summary,
}: Readonly<{
  threads: readonly InboxThread[];
  header?: ReactNode;
  empty?: ReactNode;
  summary?: string;
}>) {
  const tenantPath = useTenantAwarePath();
  const { layout } = useDeviceContext();
  return (
    <Collection
      label="Unterhaltungen"
      // Runde 15: Am kleinen Telefon (SE) 52 px je Unterhaltung wie in der
      // Aufsicht; die Trefferfläche bleibt über 44 px.
      className={layout === "phone" ? SHORT_PHONE_ROWS : undefined}
    >
      {header ? (
        <div className="border-b border-gray-100 px-4 py-2">{header}</div>
      ) : null}
      {threads.length === 0 && empty ? empty : null}
      <CollectionList>
        {threads.map((thread) => {
          const href = tenantPath(`/messages/${thread.thread_id}`);
          const last = thread.last_message_body
            ? `${thread.last_sender_kind === "staff" ? "Du: " : ""}${thread.last_message_body}`
            : "Noch keine Nachricht";
          const unread = thread.unread_count > 0;
          const relation = `${relationshipLabel(thread.relationship_type)} von ${thread.student_name}`;
          // Telefon (Runde 15): „Elternteil“ ist der Normalfall und stand in
          // jeder Zeile; sichtbar bleibt nur eine andere Rolle (Großelternteil,
          // Vormund …). Der Vorlesetext nennt sie immer.
          const role = relationshipLabel(thread.relationship_type);
          const showRole = role !== "Elternteil";
          return (
            <CollectionRow
              key={thread.thread_id}
              href={href}
              // Beginnt mit dem sichtbaren Text der Zeile (Sprachsteuerung,
              // axe label-content-name-mismatch): Person · Rolle, Abzeichen,
              // Zeit; dann das Kind und die Zahl der ungelesenen.
              aria-label={[
                // Ohne sichtbare Rolle beginnt er nur mit dem Namen; die
                // Rolle folgt mit dem Kind („Elternteil von …“).
                showRole
                  ? `${thread.guardian_name} · ${role}`
                  : thread.guardian_name,
                thread.audience === "leadership"
                  ? ` ${LEADERSHIP_AUDIENCE_LABEL}`
                  : "",
                thread.last_message_at
                  ? ` ${chatTimeText(thread.last_message_at)}`
                  : "",
                `, ${relation}`,
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
              // Telefon (Runde 11): zwei Zeilen wie in Chat-Apps – oben die
              // Person mit ihrer Rolle, darunter das Kind und die letzte
              // Nachricht. So bleibt die Zeile bei 56–64 px und am SE
              // stehen acht Unterhaltungen im Bild.
              title={
                <span className="flex min-w-0 items-baseline gap-2">
                  {/* Name ganz, die Rolle ganz oder gar nicht (Runde 13):
                      passt sie nicht mehr in die Zeile, bricht sie in eine
                      zweite, unsichtbare Zeile um, statt „Eltern…“ zu
                      zeigen. Im Vorlesetext steht sie immer. */}
                  <span className="flex h-lh min-w-0 flex-1 flex-wrap items-baseline overflow-hidden">
                    {/* Runde 17: Ungelesene fett, gelesene normal: beim
                        Überfliegen erkennbar, nicht nur am Abzeichen. */}
                    <span
                      className={cn(
                        "max-w-full truncate",
                        unread ? "font-bold" : "font-normal",
                      )}
                    >
                      {thread.guardian_name}
                    </span>
                    {showRole ? (
                      <span className="font-normal whitespace-pre text-gray-500">
                        {" · "}
                        {role}
                      </span>
                    ) : null}
                  </span>
                  {/* Das Abzeichen bleibt stehen, auch wenn die Rolle
                      ausgeblendet ist. */}
                  {thread.audience === "leadership" ? (
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
                        unread && "font-medium text-gray-900",
                      )}
                    >
                      {last}
                    </span>
                  </span>
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
