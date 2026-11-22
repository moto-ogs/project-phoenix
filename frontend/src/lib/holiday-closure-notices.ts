/**
 * Elternhinweise zu Schul-Schließtagen in gebuchten Ferienwochen (ADR 0196).
 *
 * Ändert eine Schule einen Schließtag, schlägt moto einen Hinweis an die
 * Eltern vor. Erst ein Klick der Schule oder des Träger-Büros beauftragt den
 * Versand; beide Klicks treffen denselben Auftrag. Die Schule sieht nur die
 * Zahl der Familien, nie Namen oder Kontakte. IDs kommen als Strings heraus.
 */

import { apiErrorFromBody, transportFetch } from "~/lib/api-error";
import { knownEnum } from "./contract/known-enum";
import { requiredDay } from "./contract/required-day";
import type { NoticeResponse } from "./contract/holiday-closure-notices.generated";
import type * as sharedContract from "./contract/shared.generated";

// Go meldet die Menge nicht an; der Vertrag führt sie als string.
const NOTICE_STATUS_VALUES = [
  "suggested",
  "sending",
  "no_mail",
  "sent",
  "failed",
  "unknown",
] as const;

/**
 * Der Stand eines Hinweises, an beiden Stellen derselbe. "unknown" steht
 * auch für einen Stand, den diese Version nicht kennt: das Backend nennt
 * einen unlesbaren Stand selbst so.
 */
type HolidayClosureNoticeStatus = (typeof NOTICE_STATUS_VALUES)[number];

/** Ein Zeitraum des Schließtags, Kalendertage als „YYYY-MM-DD“. */
interface HolidayClosureRange {
  readonly startDate: string;
  readonly endDate: string;
}

export interface HolidayClosureNotice {
  readonly id: string;
  readonly schoolId: string;
  /** Leer in der Liste des Träger-Büros; dort steht der Name im Kalender. */
  readonly schoolName: string;
  readonly closingDayId: string;
  readonly reason: string;
  /** Die Tage vor der Änderung; `null` bei einem neuen Schließtag. */
  readonly previous: HolidayClosureRange | null;
  /** Die Tage jetzt; `null`, wenn die Schule den Schließtag gelöscht hat. */
  readonly current: HolidayClosureRange | null;
  /** Der Stand, den ein Klick beauftragt. */
  readonly revision: number;
  readonly token: string;
  readonly status: HolidayClosureNoticeStatus;
  /** Der Schließtag hat sich nach einem Klick noch einmal geändert. */
  readonly changed: boolean;
  /** Ein Klick versendet jetzt etwas: Vorschlag oder bekannter Fehler. */
  readonly canNotify: boolean;
  /** Familien, die ein Klick jetzt informiert; nur bei einem Vorschlag. */
  readonly families: number;
  readonly confirmedAt: string | null;
  readonly updatedAt: string;
}

/**
 * Ein Hinweis, wie die Schule und das Träger-Büro ihn bekommen; beide Routen
 * senden dieselbe Form.
 */
export type HolidayClosureNoticeWire = NoticeResponse;

function mapRange(
  range: sharedContract.Range | null,
): HolidayClosureRange | null {
  return range
    ? {
        startDate: requiredDay(range.start_date, "closure_range.start_date"),
        endDate: requiredDay(range.end_date, "closure_range.end_date"),
      }
    : null;
}

export function mapHolidayClosureNotice(
  notice: HolidayClosureNoticeWire,
): HolidayClosureNotice {
  return {
    id: notice.id,
    schoolId: notice.school_id,
    schoolName: notice.school_name ?? "",
    closingDayId: notice.closing_day_id,
    reason: notice.reason,
    previous: mapRange(notice.previous),
    current: mapRange(notice.current),
    revision: notice.revision,
    token: notice.token,
    status: knownEnum(NOTICE_STATUS_VALUES, notice.status) ?? "unknown",
    changed: notice.changed,
    canNotify: notice.can_notify,
    families: notice.families,
    confirmedAt: notice.confirmed_at,
    updatedAt: notice.updated_at,
  };
}

/** Wartet ein Hinweis auf den Versand, fragt die Ansicht öfter nach. */
const NOTICE_SENDING_REFRESH_MS = 5000;

/** Solange ein Hinweis gesendet wird, lädt die Liste regelmäßig neu. */
export function sendingRefreshInterval(
  notices: readonly Pick<HolidayClosureNotice, "status">[] | undefined,
): number {
  return notices?.some((notice) => notice.status === "sending")
    ? NOTICE_SENDING_REFRESH_MS
    : 0;
}

/** Erledigt: nichts mehr zu tun, weder Klick noch Prüfung. */
export function isNoticeDone(
  notice: Pick<HolidayClosureNotice, "status">,
): boolean {
  return notice.status === "sent" || notice.status === "no_mail";
}

async function noticeRequest<T>(
  path: string,
  init: { method: string; body?: unknown } = { method: "GET" },
): Promise<T> {
  const response = await transportFetch(path, {
    method: init.method,
    credentials: "include",
    cache: "no-store",
    headers:
      init.body === undefined
        ? { Accept: "application/json" }
        : { Accept: "application/json", "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw apiErrorFromBody(
      `Anfrage fehlgeschlagen (HTTP ${response.status})`,
      response.status,
      data,
    );
  }
  return (data as { data?: T } | undefined)?.data as T;
}

const schoolPath = "/api/holiday-closure-notices";

/** Die Hinweise der eigenen Schule. */
export async function fetchHolidayClosureNotices(): Promise<
  HolidayClosureNotice[]
> {
  const data = await noticeRequest<HolidayClosureNoticeWire[]>(schoolPath);
  return data.map(mapHolidayClosureNotice);
}

/**
 * Beauftragt den Hinweis mit dem Stand, den die Schule gesehen hat. Hat er
 * sich inzwischen geändert, antwortet der Server mit
 * `timetable.closing_day_notice_changed`.
 */
export async function notifyHolidayClosureNotice(
  id: string,
  revision: number,
  token: string,
): Promise<HolidayClosureNotice> {
  return mapHolidayClosureNotice(
    await noticeRequest<HolidayClosureNoticeWire>(
      `${schoolPath}/${encodeURIComponent(id)}/notify`,
      { method: "POST", body: { revision, token } },
    ),
  );
}
