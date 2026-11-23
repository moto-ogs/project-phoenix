/**
 * Client für die Tagesinformationen (#2180): interne Hinweise der Leitung an
 * das Team. Spricht die Next.js-Proxyrouten unter /api/staff-notices an, die
 * mit dem Personal-JWT ans Go-Backend weiterreichen. int64-Ids kommen bereits
 * als String an.
 *
 * Die Lesefunktionen (heute geltende Hinweise, Kenntnisnahme) gibt es auch für
 * moto schule (#2208) über `createStaffNoticesReadApi` mit dem Schul-Pfad;
 * Verwaltung und Bestätigungsliste bleiben im OGS-Portal.
 */

import { bffJson } from "./bff-fetch";
import type * as sharedContract from "./contract/shared.generated";
import type * as staffNoticesContract from "./contract/staff-notices.generated";
import { staffNoticeKeys } from "~/lib/swr/staff-keys";

export type StaffNoticePriority = "info" | "important";

/**
 * Fenster-Ereignis, mit dem eine Kenntnisnahme die Zähler in der Navigation
 * sofort nachziehen lässt — in beiden Portalen dasselbe Ereignis.
 */
export const STAFF_NOTICES_REFRESH_EVENT = "staff-notices-refresh";

/**
 * SWR-Schlüssel der heute geltenden Hinweise im OGS-Portal, je Konto;
 * useSWRAuth stellt die Schule davor. Die Quelle ist `staffNoticeKeys.today`
 * (`~/lib/swr/staff-keys`); Leser nehmen die Factory, der Server-Seed der
 * App-Hülle diesen Namen (#4989).
 */
export function staffNoticesTodayKey(accountId: string): string {
  return staffNoticeKeys.today(accountId);
}

/**
 * Hinweise, deren Kenntnisnahme verlangt ist und noch fehlt. Hinweise ohne
 * Pflicht-Kenntnisnahme zählen nicht — sonst stünde das Badge dauerhaft.
 */
export function countPendingAcknowledgements(
  notices: readonly StaffNotice[],
): number {
  return notices.filter((n) => n.requires_acknowledgement && !n.acknowledged_at)
    .length;
}

/**
 * Zielgruppe (#2208): die ganze Einrichtung, nur die Betreuung im OGS-Portal
 * oder nur die Lehrkräfte in moto schule. Drei feste Werte, kein Verteiler.
 */
export type StaffNoticeAudience = "all" | "staff" | "lehrkraft";

/** 0 = jede Woche, 1 = Woche A, 2 = Woche B (Vokabular aus dem Stundenplan). */
export type StaffNoticeWeekPattern = 0 | 1 | 2;

/**
 * Ein Hinweis, wie ihn der Vertrag liefert; Priorität, Zielgruppe und Woche
 * auf ihre festen Werte eingegrenzt, `weekdays` (Go darf `null` schicken) als
 * Liste: leer = jeder Tag im Zeitraum.
 */
export type StaffNotice = Omit<
  sharedContract.noticeResponse,
  "priority" | "audience" | "week_pattern" | "weekdays"
> & {
  priority: StaffNoticePriority;
  audience: StaffNoticeAudience;
  /** ISO-Wochentage 1..7; leer = jeder Tag im Zeitraum */
  weekdays: number[];
  week_pattern: StaffNoticeWeekPattern;
};

/** Was die Leitung anlegt oder ändert; der Vertrag lässt jedes Feld offen. */
export type StaffNoticeInput = Required<
  Pick<
    staffNoticesContract.noticeRequest,
    "title" | "body" | "valid_from" | "requires_acknowledgement"
  >
> &
  Pick<staffNoticesContract.noticeRequest, "valid_until"> & {
    priority: StaffNoticePriority;
    audience: StaffNoticeAudience;
    weekdays: number[];
    week_pattern: StaffNoticeWeekPattern;
    active: boolean;
  };

const PRIORITIES: readonly StaffNoticePriority[] = ["info", "important"];
const AUDIENCES: readonly StaffNoticeAudience[] = ["all", "staff", "lehrkraft"];

/** Grenzt die offenen Werte des Vertrags auf die bekannten ein. */
function toStaffNotice(notice: sharedContract.noticeResponse): StaffNotice {
  return {
    ...notice,
    priority: PRIORITIES.find((p) => p === notice.priority) ?? "info",
    audience: AUDIENCES.find((a) => a === notice.audience) ?? "all",
    weekdays: notice.weekdays ?? [],
    week_pattern:
      notice.week_pattern === 1 || notice.week_pattern === 2
        ? notice.week_pattern
        : 0,
  };
}

/**
 * Die Lesefläche eines Portals: heute geltende Hinweise und die eigene
 * Kenntnisnahme. Das OGS-Portal (`tenant`) und moto schule (`school`) rufen
 * dieselben Routen über ihre eigene Sitzung.
 */
export interface StaffNoticesReadApi {
  fetchTodaysNotices: () => Promise<StaffNotice[]>;
  acknowledgeStaffNotice: (id: string) => Promise<void>;
}

const TODAY_FAILED = "Tagesinformationen konnten nicht geladen werden";
const ACKNOWLEDGE_FAILED = "Kenntnisnahme konnte nicht gespeichert werden";

export function createStaffNoticesReadApi(
  portal: "tenant" | "school",
): StaffNoticesReadApi {
  if (portal === "school") {
    return {
      async fetchTodaysNotices() {
        const rows = await bffJson(
          "school",
          "GET /school/staff-notices/today",
          {
            errorMessage: TODAY_FAILED,
          },
        );
        return rows.map(toStaffNotice);
      },
      async acknowledgeStaffNotice(id: string) {
        await bffJson(
          "school",
          "POST /school/staff-notices/{noticeId}/acknowledge",
          { params: { noticeId: id }, errorMessage: ACKNOWLEDGE_FAILED },
        );
      },
    };
  }
  return {
    async fetchTodaysNotices() {
      const rows = await bffJson("tenant", "GET /api/staff-notices/today", {
        errorMessage: TODAY_FAILED,
      });
      return rows.map(toStaffNotice);
    },
    async acknowledgeStaffNotice(id: string) {
      await bffJson(
        "tenant",
        "POST /api/staff-notices/{noticeId}/acknowledge",
        {
          params: { noticeId: id },
          errorMessage: ACKNOWLEDGE_FAILED,
        },
      );
    },
  };
}

const tenantReadApi = createStaffNoticesReadApi("tenant");

/** Die heute geltenden Hinweise — die Sicht des Teams im OGS-Portal. */
export const fetchTodaysNotices = tenantReadApi.fetchTodaysNotices;

/** Kenntnisnahme im OGS-Portal. */
export const acknowledgeStaffNotice = tenantReadApi.acknowledgeStaffNotice;

/**
 * Ein einzelner Hinweis, auf den ein Eintrag in der Glocke zeigt (#7143),
 * auch wenn er heute nicht gilt. Ein gelöschter oder ausgeschalteter Hinweis
 * antwortet mit 404.
 */
export async function fetchStaffNotice(id: string): Promise<StaffNotice> {
  return toStaffNotice(
    await bffJson("tenant", "GET /api/staff-notices/{noticeId}", {
      params: { noticeId: id },
      errorMessage: "Der Hinweis konnte nicht geladen werden",
    }),
  );
}

/** Alle Hinweise des Mandanten — Leitungssicht, auch abgeschaltete. */
export async function fetchStaffNotices(): Promise<StaffNotice[]> {
  const rows = await bffJson("tenant", "GET /api/staff-notices/", {
    errorMessage: TODAY_FAILED,
  });
  return rows.map(toStaffNotice);
}

export async function createStaffNotice(
  input: StaffNoticeInput,
): Promise<StaffNotice> {
  return toStaffNotice(
    await bffJson("tenant", "POST /api/staff-notices/", {
      body: input,
      errorMessage: "Tagesinformation konnte nicht erstellt werden",
    }),
  );
}

/** Saves a change of the notice read with `expectedVersion` (ADR 0311). */
export async function updateStaffNotice(
  id: string,
  input: StaffNoticeInput,
  expectedVersion: string,
): Promise<StaffNotice> {
  return toStaffNotice(
    await bffJson("tenant", "PUT /api/staff-notices/{noticeId}", {
      params: { noticeId: id },
      body: { ...input, expected_version: expectedVersion },
      errorMessage: "Tagesinformation konnte nicht gespeichert werden",
    }),
  );
}

export async function deleteStaffNotice(id: string): Promise<void> {
  await bffJson("tenant", "DELETE /api/staff-notices/{noticeId}", {
    params: { noticeId: id },
    errorMessage: "Tagesinformation konnte nicht gelöscht werden",
  });
}

/**
 * Die Bestätigungsliste eines Hinweises (#2208): wer wann zur Kenntnis
 * genommen hat, neueste zuerst. Nur für die Leitung erreichbar.
 */
export async function fetchNoticeAcknowledgements(
  id: string,
): Promise<staffNoticesContract.acknowledgerResponse[]> {
  return bffJson(
    "tenant",
    "GET /api/staff-notices/{noticeId}/acknowledgements",
    {
      params: { noticeId: id },
      errorMessage: "Die Bestätigungen konnten nicht geladen werden",
    },
  );
}

const WEEKDAY_LABELS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] as const;

/**
 * Beschreibt die Wiederholung in einem Satzteil, wie ihn jemand lesen würde:
 * "dienstags", "Mo, Mi, Fr", "täglich" — plus die Woche, falls es eine gibt.
 */
export function describeRecurrence(notice: StaffNotice): string {
  const days =
    notice.weekdays.length === 0 || notice.weekdays.length === 7
      ? "täglich"
      : notice.weekdays
          .map((day) => WEEKDAY_LABELS[day - 1] ?? "")
          .filter(Boolean)
          .join(", ");

  if (notice.week_pattern === 1) return `${days} · Woche A`;
  if (notice.week_pattern === 2) return `${days} · Woche B`;
  return days;
}

/** Die Zielgruppe so, wie sie in der Verwaltung steht. */
export const AUDIENCE_LABELS: Readonly<Record<StaffNoticeAudience, string>> = {
  all: "Alle",
  staff: "Nur Betreuung",
  lehrkraft: "Nur Lehrkräfte",
};

/** Beschreibt die Zielgruppe für die Liste der Leitung: "Für alle". */
export function describeAudience(audience: StaffNoticeAudience): string {
  switch (audience) {
    case "staff":
      return "Nur für die Betreuung";
    case "lehrkraft":
      return "Nur für Lehrkräfte";
    default:
      return "Für alle";
  }
}
