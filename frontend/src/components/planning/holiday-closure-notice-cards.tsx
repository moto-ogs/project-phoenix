"use client";

/**
 * Die Karten „Eltern informieren“ zu Schul-Schließtagen in gebuchten
 * Ferienwochen (ADR 0196), an beiden Stellen dieselben: im Kalender der
 * Schule und auf der Seite „Schließtage“ des Träger-Büros (#8271). Die
 * Aufrufer laden die Hinweise und lösen den Versand aus; hier stehen Stand,
 * Tage, Familien und der Knopf einer Zeile, die gefaltete Liste und die
 * zugeklappte Karte der erledigten Hinweise. Die Zeile kennt kein Portal:
 * Was nur das Träger-Büro sieht (Schule, Kinder, Wochen), reichen die
 * Aufrufer als `context`, `badges` und `details` herein.
 */

import type { ReactNode } from "react";

import {
  CalendarCheck,
  CalendarX,
  ChevronDown,
  ChevronUp,
  Mail,
  Users,
} from "lucide-react";
import { formatClosingRange } from "~/components/traeger/closing-day-format";
import { Button } from "~/components/ui/button";
import type { FormErrorInput } from "~/components/ui/form-error";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { IconTile } from "~/components/ui/icon-tile";
import {
  ResponsiveActionList,
  ResponsiveActionRow,
  ResponsiveRowActions,
} from "~/components/ui/responsive-action-list";
import { SectionCard } from "~/components/ui/section-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { holidayWeeksConcept } from "~/lib/concepts/holidayWeeks";
import type { HolidayClosureNotice } from "~/lib/holiday-closure-notices";
import {
  familiesBookedSentence,
  NOTIFY_PARENTS_TOOLTIP,
  noticeStatusView,
  SHOW_MORE_NO_TOOLTIP,
  shownNotice,
  useNoticeList,
  type HolidayClosureNoticeRowContent,
} from "~/components/planning/use-holiday-closure-notices";

/**
 * Ein Hinweis als Zeile. Vorn eine Kachel, deren Farbe und Symbol den Stand
 * zeigen; daneben Grund und Etikett, wo nötig der Ort (`context`), die Tage
 * (die geltenden kräftig, die alten blass), solange er wartet die Familien,
 * dann die Angaben des Aufrufers und der Satz zum Stand. „Eltern
 * informieren“ steht nur, wo ein Klick etwas versendet; während des Klicks
 * zeigt die Zeile „Wird gesendet“.
 */
export function HolidayClosureNoticeRow<T extends HolidayClosureNotice>({
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
  const name = row.context ? `${row.title}, ${row.context}` : row.title;
  return (
    <ResponsiveActionRow align="start">
      <div className="flex min-w-0 items-start gap-3">
        <IconTile
          size="sm"
          tone={status.tile.tone}
          icon={<StatusIcon aria-hidden="true" />}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-h-9 flex-col justify-center">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="text-sm font-semibold wrap-anywhere text-gray-900">
                {row.title}
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
            {row.context ? (
              <p className="text-sm wrap-anywhere text-gray-600">
                {row.context}
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
                <Users
                  className="mt-0.5 size-4 shrink-0 text-gray-500"
                  aria-hidden="true"
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
        <ResponsiveRowActions leading={36}>
          <Button
            type="button"
            variant="surface"
            size="compact"
            aria-label={`Eltern informieren: ${name}`}
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
  isSending,
  onNotify,
  loadError = null,
  intro = null,
  action = null,
}: Readonly<{
  title: string;
  description: string;
  rows: readonly HolidayClosureNoticeRowContent<T>[];
  isSending: (id: string) => boolean;
  onNotify: (notice: T) => void;
  /** Gesetzt, wenn die Hinweise nicht geladen werden konnten. */
  loadError?: FormErrorInput;
  /** Text über der Liste, der für alle Zeilen gilt. */
  intro?: ReactNode;
  /** Sammelaktion im Kopf der Karte. */
  action?: ReactNode;
}>) {
  const {
    open,
    done,
    visible,
    hiddenCount,
    waiting,
    expanded,
    openListId,
    toggleExpanded,
  } = useNoticeList(rows, isSending);
  const renderRow = (row: HolidayClosureNoticeRowContent<T>) => (
    <HolidayClosureNoticeRow
      key={row.notice.id}
      row={row}
      sending={isSending(row.notice.id)}
      onNotify={onNotify}
    />
  );

  if (loadError)
    return (
      <SectionCard title={title} concept={holidayWeeksConcept}>
        <LoadErrorAlert error={loadError} actionLayout="responsive" />
      </SectionCard>
    );
  if (open.length === 0 && done.length === 0 && !intro && !action) return null;
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
              onClick={toggleExpanded}
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
