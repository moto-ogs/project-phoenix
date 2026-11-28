"use client";

/**
 * Elternhinweise zu Schul-Schließtagen in gebuchten Ferienwochen (ADR 0196),
 * an beiden Stellen dieselben Karten: im Kalender der Schule und auf der
 * Seite „Schließtage“ des Träger-Büros (#8271). Die Aufrufer laden die
 * Hinweise und bringen den Versand mit (`useNoticeNotify`); hier steht, was
 * man sieht. Jede Zeile nennt Grund, Stand, Tage und, solange der Hinweis
 * auf einen Klick wartet, die Zahl der Familien. Ein Klick auf „Eltern
 * informieren“ beauftragt den Versand ohne zweite Frage; die Zeile zeigt
 * sofort „Wird gesendet“. Erledigte Hinweise liegen in einer zugeklappten
 * Karte darunter. Gescheiterte und unklare Sendungen bleiben oben sichtbar.
 *
 * Die Zeile kennt kein Portal: Was nur das Träger-Büro sieht (Schule,
 * Kinder, Wochen), reicht es als `subtitle`, `badges` und `details` herein.
 */

import { type ReactNode, useId, useState } from "react";

import {
  CalendarCheck,
  CalendarClock,
  CalendarX,
  ChevronDown,
  ChevronUp,
  type LucideIcon,
  Mail,
  MailCheck,
  MailMinus,
  MailQuestionMark,
  MailX,
  Send,
} from "lucide-react";
import type { NoticeNotifier } from "~/components/planning/use-holiday-closure-notices";
import { formatClosingRange } from "~/components/traeger/closing-day-format";
import { Button } from "~/components/ui/button";
import type { FormErrorInput } from "~/components/ui/form-error";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { IconTile } from "~/components/ui/icon-tile";
import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import {
  ResponsiveActionList,
  ResponsiveActionRow,
  ResponsiveRowActions,
} from "~/components/ui/responsive-action-list";
import { SectionCard } from "~/components/ui/section-card";
import {
  StatusBadge,
  type StatusBadgeTone,
} from "~/components/ui/status-badge";
import { holidayWeeksConcept } from "~/lib/concepts/holidayWeeks";
import { parentsConcept } from "~/lib/concepts/parents";
import {
  type HolidayClosureNotice,
  isNoticeDone,
} from "~/lib/holiday-closure-notices";

/** Offene Zeilen vor „N weitere anzeigen“. */
const INITIAL_OPEN_COUNT = 5;

/** Was „Eltern informieren“ an einem Hinweis tut (#6757), in beiden Portalen. */
const NOTIFY_PARENTS_TOOLTIP =
  "Sendet den Eltern der betroffenen Kinder sofort eine E-Mail.";

/** Warum „N weitere anzeigen“ ohne Erklärung auskommt (#6757). */
const SHOW_MORE_NO_TOOLTIP =
  "Zeigt nur mehr oder weniger Zeilen, an den Hinweisen ändert sich nichts.";

/**
 * Die Kachel vor jeder Zeile: 36 px (`IconTile size="sm"`). Die Aktionen
 * rücken auf dem Telefon um dieselbe Breite ein, damit sie unter dem Text
 * beginnen; beide Werte ändern sich nur gemeinsam.
 */
const STATUS_TILE = { size: "sm", inset: 36 } as const;

/** „1 Familie hat …“ oder „12 Familien haben …“. */
function familiesBookedSentence(families: number): string {
  return families === 1
    ? "1 Familie hat an diesen Tagen Ferienbetreuung gebucht."
    : `${families} Familien haben an diesen Tagen Ferienbetreuung gebucht.`;
}

interface NoticeStatusView {
  /** Kein Etikett beim Vorschlag: Der Satz sagt es schon. */
  readonly badge: {
    readonly label: string;
    readonly tone: StatusBadgeTone;
  } | null;
  readonly hint: string | null;
  /**
   * Symbol und Ton der Kachel vor der Zeile, damit der Stand in einer
   * langen Liste auf einen Blick auffällt: Orange wartet auf einen Klick,
   * Blau läuft, Grün ist angekommen, Rot ist gescheitert, Grau braucht
   * keinen Klick. Etikett und Satz sagen dasselbe in Worten.
   */
  readonly tile: {
    readonly icon: LucideIcon;
    readonly tone: "orange" | "blue" | "green" | "red" | "neutral";
  };
}

/** Die Texte des Stands aus ADR 0196, Abschnitt 5. */
function noticeStatusView(
  notice: Pick<HolidayClosureNotice, "status" | "changed">,
): NoticeStatusView {
  switch (notice.status) {
    case "suggested":
      return notice.changed
        ? {
            badge: { label: "Geändert", tone: "warning" },
            hint: "Der Schließtag wurde geändert. Bitte prüfe den Hinweis.",
            tile: { icon: CalendarClock, tone: "orange" },
          }
        : {
            badge: null,
            hint: "Die Eltern wurden noch nicht informiert.",
            tile: { icon: Mail, tone: "orange" },
          };
    case "sending":
      return {
        badge: { label: "Wird gesendet", tone: "blue" },
        hint: "Bitte warte.",
        tile: { icon: Send, tone: "blue" },
      };
    case "no_mail":
      return {
        badge: { label: "Keine E-Mail nötig", tone: "gray" },
        hint: null,
        tile: { icon: MailMinus, tone: "neutral" },
      };
    case "sent":
      return {
        badge: { label: "Gesendet", tone: "green" },
        hint: null,
        tile: { icon: MailCheck, tone: "green" },
      };
    case "failed":
      return {
        badge: { label: "Nicht angekommen", tone: "red" },
        hint: "Bitte versuche es erneut.",
        tile: { icon: MailX, tone: "red" },
      };
    case "unknown":
      // Kein Klick hilft hier, das moto-Team prüft: grau, nicht orange.
      return {
        badge: { label: "Ergebnis unbekannt", tone: "warning" },
        hint: "Bitte lass den Versand vom moto-Team prüfen.",
        tile: { icon: MailQuestionMark, tone: "neutral" },
      };
  }
}

/** Ein Hinweis, wie die Liste ihn zeigt: während des Klicks „Wird gesendet“. */
function shownNotice<T extends HolidayClosureNotice>(
  notice: T,
  sending: boolean,
): T {
  return sending
    ? { ...notice, status: "sending", canNotify: false, changed: false }
    : notice;
}

export interface HolidayClosureNoticeRowContent<T> {
  readonly notice: T;
  /** Wo der Schließtag gilt, etwa die Schule im Träger-Büro. */
  readonly subtitle?: string;
  /** Weitere Angaben unter dem Stand, etwa die Wochen im Träger-Büro. */
  readonly details?: ReactNode;
  /** Kurze Zahlen neben dem Stand, etwa „5 Kinder“. */
  readonly badges?: ReactNode;
}

/**
 * Ein Hinweis als Zeile. Vorn die Kachel des Stands; daneben Grund und
 * Etikett, darunter der Ort (`subtitle`), die Tage (die geltenden kräftig,
 * die alten blass), solange er wartet die Familien, dann die Angaben des
 * Aufrufers und der Satz zum Stand. „Eltern informieren“ steht nur, wo ein
 * Klick etwas versendet.
 */
function HolidayClosureNoticeRow<T extends HolidayClosureNotice>({
  row,
  sending,
  onNotify,
}: Readonly<{
  row: HolidayClosureNoticeRowContent<T>;
  sending: boolean;
  onNotify: (notice: T) => void;
}>) {
  const notice = shownNotice(row.notice, sending);
  const status = noticeStatusView(notice);
  const StatusIcon = status.tile.icon;
  const { current, previous } = notice;
  const showFamilies = notice.status === "suggested" && notice.families > 0;
  const title = `„${notice.reason}“`;
  return (
    <ResponsiveActionRow align="start">
      <div className="flex min-w-0 items-start gap-3">
        <IconTile
          size={STATUS_TILE.size}
          tone={status.tile.tone}
          icon={<StatusIcon aria-hidden="true" />}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-h-9 flex-col justify-center">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="text-sm font-semibold wrap-anywhere text-gray-900">
                {title}
              </p>
              {status.badge ? (
                <StatusBadge
                  label={status.badge.label}
                  tone={status.badge.tone}
                  size="xs"
                />
              ) : null}
              {row.badges}
            </div>
            {row.subtitle ? (
              <p className="text-sm wrap-anywhere text-gray-600">
                {row.subtitle}
              </p>
            ) : null}
          </div>
          <ul className="mt-0.5 space-y-1 text-sm">
            {current ? (
              <li className="flex items-start gap-2 text-gray-900">
                <CalendarX
                  className="mt-0.5 size-4 shrink-0 text-gray-500"
                  aria-hidden="true"
                />
                <span className="min-w-0 tabular-nums">
                  {previous ? "Neu" : "Geschlossen"}:{" "}
                  {formatClosingRange(current)}
                </span>
              </li>
            ) : null}
            {previous ? (
              <li
                className={
                  current
                    ? "flex items-start gap-2 text-gray-500"
                    : "flex items-start gap-2 text-gray-900"
                }
              >
                <CalendarCheck
                  className="mt-0.5 size-4 shrink-0 text-gray-500"
                  aria-hidden="true"
                />
                <span className="min-w-0 tabular-nums">
                  {current
                    ? `Vorher: ${formatClosingRange(previous)}`
                    : `Schließtag gelöscht: ${formatClosingRange(previous)}.`}
                </span>
              </li>
            ) : null}
            {showFamilies ? (
              <li className="flex items-start gap-2 text-gray-900">
                <MotoConceptIcon
                  concept={parentsConcept}
                  colorMode="inherit"
                  size={16}
                  className="mt-0.5 text-gray-500"
                />
                <span className="min-w-0">
                  {familiesBookedSentence(notice.families)}
                </span>
              </li>
            ) : null}
          </ul>
          {row.details}
          {status.hint ? (
            <p className="mt-2 text-sm text-gray-600">{status.hint}</p>
          ) : null}
        </div>
      </div>
      {notice.canNotify ? (
        <ResponsiveRowActions leading={STATUS_TILE.inset}>
          <Button
            type="button"
            variant="surface"
            size="compact"
            aria-label={`Eltern informieren: ${row.subtitle ? `${row.subtitle}: ${title}` : title}`}
            tooltip={NOTIFY_PARENTS_TOOLTIP}
            onClick={() => onNotify(row.notice)}
          >
            <Mail className="h-4 w-4" aria-hidden="true" />
            Eltern informieren
          </Button>
        </ResponsiveRowActions>
      ) : null}
    </ResponsiveActionRow>
  );
}

/**
 * Offene Hinweise in einer Karte, die ersten fünf sichtbar, erledigte
 * zugeklappt darunter. Ohne Zeile, Einleitung und Sammelaktion zeigt sie
 * nichts; ein Ladefehler steht klein in der Karte, nie eine leere Liste.
 */
export function HolidayClosureNoticeCards<T extends HolidayClosureNotice>({
  title,
  description,
  rows,
  notifier,
  loadError = null,
  intro = null,
  action = null,
}: Readonly<{
  title: string;
  description: string;
  rows: readonly HolidayClosureNoticeRowContent<T>[];
  notifier: NoticeNotifier;
  /** Gesetzt, wenn die Hinweise nicht geladen werden konnten. */
  loadError?: FormErrorInput;
  /** Text über der Liste, der für alle Zeilen gilt. */
  intro?: ReactNode;
  /** Sammelaktion im Kopf der Karte. */
  action?: ReactNode;
}>) {
  const [expanded, setExpanded] = useState(false);
  const openListId = useId();
  const { isSending } = notifier;
  const open = rows.filter(
    (row) => !isNoticeDone(shownNotice(row.notice, isSending(row.notice.id))),
  );
  const done = rows.filter((row) => !open.includes(row));
  const visible = expanded ? open : open.slice(0, INITIAL_OPEN_COUNT);
  const hiddenCount = Math.max(0, open.length - INITIAL_OPEN_COUNT);
  const waiting = open.filter((row) => row.notice.canNotify).length;
  const renderRow = (row: HolidayClosureNoticeRowContent<T>) => (
    <HolidayClosureNoticeRow
      key={row.notice.id}
      row={row}
      sending={isSending(row.notice.id)}
      onNotify={(notice) => void notifier.notify(notice)}
    />
  );

  if (loadError)
    return (
      <SectionCard title={title} concept={holidayWeeksConcept}>
        <LoadErrorAlert error={loadError} actionLayout="responsive" />
      </SectionCard>
    );
  if (rows.length === 0 && !intro && !action) return null;
  return (
    <div className="flex flex-col gap-3">
      {open.length > 0 || intro || action ? (
        <SectionCard
          title={title}
          concept={holidayWeeksConcept}
          titleBadge={
            waiting > 0 ? (
              <StatusBadge tone="warning" label={`${waiting} offen`} />
            ) : null
          }
          description={description}
          action={action}
        >
          {intro ? <div className="mb-3">{intro}</div> : null}
          {visible.length > 0 ? (
            <ResponsiveActionList id={openListId}>
              {visible.map(renderRow)}
            </ResponsiveActionList>
          ) : null}
          {hiddenCount > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="md"
              className="mt-2 w-full"
              aria-expanded={expanded}
              aria-controls={openListId}
              onClick={() => setExpanded((current) => !current)}
              noTooltip={SHOW_MORE_NO_TOOLTIP}
            >
              {expanded ? (
                <>
                  Weniger anzeigen
                  <ChevronUp className="size-4" aria-hidden="true" />
                </>
              ) : (
                <>
                  {hiddenCount} weitere anzeigen
                  <ChevronDown className="size-4" aria-hidden="true" />
                </>
              )}
            </Button>
          ) : null}
        </SectionCard>
      ) : null}
      {done.length > 0 ? (
        <SectionCard
          title={`Erledigte Hinweise (${done.length})`}
          description="Für diese Schließtage ist nichts mehr zu tun."
          collapsible
          defaultCollapsed
          headingLevel={3}
        >
          <ResponsiveActionList>{done.map(renderRow)}</ResponsiveActionList>
        </SectionCard>
      ) : null}
    </div>
  );
}
