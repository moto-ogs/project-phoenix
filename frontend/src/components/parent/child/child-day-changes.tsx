"use client";

import { type ReactNode, useEffect, useId, useState } from "react";
import type { DayChangesDay } from "~/components/home/day-changes-text";
import { DaySwitch, nextDayISO } from "~/components/home/day-switch";
import { Alert } from "~/components/ui/alert";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { SectionLabel } from "~/components/ui/section-label";
import { Skeleton } from "~/components/ui/skeleton";
import { StatusBadge } from "~/components/ui/status-badge";
import { useCareTermTranslations } from "~/lib/care-facility-term";
import { trackEvent } from "~/lib/analytics";
import { formatDate, formatTime } from "~/lib/date-helpers";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { PARENT_RESOURCE_OPTIONS } from "~/lib/hooks/use-parent-resources";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { NOTIFICATION_FEED_REFRESH_EVENT } from "~/lib/notification-events";
import { getChildDayChanges } from "~/lib/parent-api";
import { schoolClassName } from "~/lib/school-class-label";
import { useSWRAuth } from "~/lib/swr";
import { parentKeys } from "~/lib/swr/parent-keys";
import type * as parentMeContract from "~/lib/contract/parent-me.generated";

type DayChangesTranslator = ReturnType<
  typeof useCareTermTranslations<"parentToday">
>;

/** Die Sätze, die für morgen „morgen“ statt „heute“ sagen (#8236). */
type DayKey =
  | "allAsPlanned"
  | "loadObject"
  | "sick"
  | "excused"
  | "pickupAt"
  | "notComing"
  | "goesAlone"
  | "pickupPerson"
  | "pickupPersonOneTime"
  | "classTrip"
  | "classTripBack"
  | "classDismissal"
  | "closingDay"
  | "openingChanged"
  | "mealCancelled"
  | "activityCancelled"
  | "activityReinstated"
  | "activityRoomChanged"
  | "activityLeadChanged";

type DayText = (
  key: DayKey,
  values?: Record<string, string | number>,
) => string;

/** Der Satz des gewählten Tags: heute aus `changes`, morgen aus `changesTomorrow`. */
function dayText(t: DayChangesTranslator, day: DayChangesDay): DayText {
  return (key, values) =>
    day === "tomorrow"
      ? t(`changesTomorrow.${key}`, values)
      : t(`changes.${key}`, values);
}

/**
 * Der Satz zu einer Änderung, in einfacher Sprache. Die Antwort trägt keine
 * Namen von Beschäftigten und keine Freitexte der Schule außer dem Namen des
 * Schließtags oder der geänderten Öffnungszeit; der Text nennt nur das Kind, Angebot, Raum, Klasse und Zeit.
 * Eine Art, die diese Version noch nicht kennt, ergibt null und bleibt weg.
 */
function childDayChangeText(
  entry: parentMeContract.ChildDayChangeEntry,
  firstName: string,
  t: DayChangesTranslator,
  d: DayText,
): string | null {
  const time = entry.starts_at ? formatTime(entry.starts_at) : "";
  const title = entry.activity_title ?? "";
  const className = schoolClassName(entry.class_name ?? "");
  switch (entry.kind) {
    case "child_absent":
      return entry.child_status === "sick"
        ? d("sick", { name: firstName })
        : d("excused", { name: firstName });
    case "child_pickup_changed":
      if (!entry.pickup_time) return d("notComing", { name: firstName });
      // Eine Abholzeit nach der geänderten Schließzeit bleibt, wie sie ist;
      // der Satz sagt, dass sie danach liegt (#8170).
      return entry.pickup_after_closing
        ? `${d("pickupAt", { name: firstName, time: entry.pickup_time })} ${t("changes.pickupAfterClosing")}`
        : d("pickupAt", { name: firstName, time: entry.pickup_time });
    case "child_goes_alone":
      return d("goesAlone", { name: firstName });
    case "child_pickup_person": {
      // Wer das Kind heute abholt (#8162); eine andere Person zeigt den
      // Ausweis, weil die OGS sie nicht kennt.
      const person = entry.pickup_person_name ?? "";
      if (person === "") return null;
      return entry.pickup_person_one_time
        ? d("pickupPersonOneTime", { person, name: firstName })
        : d("pickupPerson", { person, name: firstName });
    }
    case "class_trip":
      return entry.class_time
        ? d("classTripBack", {
            class: className,
            time: entry.class_time,
          })
        : d("classTrip", { class: className });
    case "class_dismissal_changed":
      return d("classDismissal", {
        class: className,
        time: entry.class_time ?? "",
      });
    case "closing_day":
      return entry.until
        ? t("changes.closingDayUntil", {
            name: entry.closing_name ?? "",
            date: formatDate(entry.until),
          })
        : d("closingDay", { name: entry.closing_name ?? "" });
    case "opening_changed": {
      const hours = {
        name: entry.opening_name ?? "",
        opens: entry.opens_at ?? "",
        closes: entry.closes_at ?? "",
      };
      const opening = entry.until
        ? t("changes.openingChangedUntil", {
            ...hours,
            date: formatDate(entry.until),
          })
        : d("openingChanged", hours);
      // Die Abholzeit aus dem Wochenplan nach der Schließzeit bleibt, wie sie
      // ist; der Satz sagt, dass sie danach liegt (#8173).
      if (!entry.pickup_after_closing || !entry.pickup_time) return opening;
      return `${opening} ${t("changes.regularPickupAfterClosing", { name: firstName, time: entry.pickup_time })} ${t("changes.pickupAfterClosing")}`;
    }
    case "meal_cancelled":
      // Nur bei einer Buchung des Kindes an dem Tag (#8160). Der Grund der
      // Schule bleibt beim Team.
      return d("mealCancelled", { name: firstName });
    case "activity_cancelled":
      return d("activityCancelled", { title, time });
    case "activity_reinstated":
      return d("activityReinstated", { title, time });
    case "activity_room_changed":
      return d("activityRoomChanged", {
        title,
        time,
        room: entry.room_name ?? "",
      });
    case "activity_lead_changed":
      return d("activityLeadChanged", { title, time });
    default:
      return null;
  }
}

/**
 * „Heute anders“ eines Kindes in seiner Tageskarte (#7671). Ohne Änderungen
 * und ohne fehlgeschlagene Quelle steht „Heute läuft alles wie geplant.“
 * Fehlt eine Quelle, steht ein Hinweis, und die Entwarnung erscheint nie.
 * Eine Änderung, die die Person selbst eingetragen hat, trägt „Von dir
 * eingetragen“ als Bestätigung. Mit `day="tomorrow"` sagen die Sätze
 * „morgen“ (#8236); `toolbar` steht rechts neben der Überschrift.
 */
export function ChildDayChangesList({
  changes,
  firstName,
  day = "today",
  toolbar,
  failure,
}: Readonly<{
  changes: parentMeContract.ChildDayChangesResponse | undefined;
  firstName: string;
  day?: DayChangesDay;
  toolbar?: ReactNode;
  /** Steht statt der Einträge, wenn der Tag nicht geladen werden konnte. */
  failure?: ReactNode;
}>) {
  const t = useCareTermTranslations("parentToday");
  const d = dayText(t, day);
  const headingId = useId();
  const failed = (changes?.sources ?? []).some(
    (source) => source.status === "failed",
  );
  const lines = (changes?.entries ?? []).flatMap((entry, index) => {
    const text = childDayChangeText(entry, firstName, t, d);
    return text === null
      ? []
      : [{ key: `${entry.kind}-${index}`, text, byYou: entry.entered_by_you }];
  });
  return (
    <section aria-labelledby={headingId} data-testid="child-day-changes">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionLabel id={headingId} as="h3">
          {t("changes.title")}
        </SectionLabel>
        {toolbar}
      </div>
      {changes && lines.length > 0 && (
        <ul className="mt-2 space-y-2">
          {lines.map((line) => (
            <li
              key={line.key}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm leading-6 text-gray-900"
            >
              <span className="min-w-0">{line.text}</span>
              {line.byYou && (
                <StatusBadge tone="gray" label={t("changes.enteredByYou")} />
              )}
            </li>
          ))}
        </ul>
      )}
      {changes && failed && (
        <Alert
          type="warning"
          size="compact"
          className="mt-2"
          message={t("changes.partial")}
        />
      )}
      {changes && lines.length === 0 && !failed && (
        <p className="mt-1 text-sm leading-6 text-gray-600">
          {d("allAsPlanned")}
        </p>
      )}
      {failure && <div className="mt-2">{failure}</div>}
      {!changes && !failure && (
        <div
          className="mt-2"
          data-testid="child-day-changes-loading"
          aria-hidden="true"
        >
          <Skeleton className="h-4 w-2/3" />
        </div>
      )}
    </section>
  );
}

/**
 * Lädt „Heute anders“ eines Kindes und zeigt es. Neu geladen wird beim
 * Fokus der Seite, nach einer neuen Verbindung (`parent-child-status-refresh`
 * erreicht den Schlüssel über `isChildStatusResource`) und wenn sich der
 * Hinweis-Feed des Kontos ändert (`notification_feed_changed`).
 *
 * Der Umschalter „Heute / Morgen“ (#8236) liest morgen den nächsten
 * Kalendertag mit denselben Sichtregeln. Beim Wechsel stehen nie die Daten
 * des anderen Tags mit den Sätzen des neuen Tags da.
 */
export function ChildDayChanges({
  studentId,
  firstName,
}: Readonly<{ studentId: string; firstName: string }>) {
  const t = useCareTermTranslations("parentToday");
  const [day, setDay] = useState<DayChangesDay>("today");
  const today = useBerlinToday();
  const shown = day === "tomorrow" ? nextDayISO(today) : today;
  const resource = useSWRAuth(
    parentKeys.dayChanges(studentId, shown),
    // Heute ohne `date`, wie bisher; morgen mit dem Kalendertag.
    () =>
      day === "tomorrow"
        ? getChildDayChanges(studentId, shown)
        : getChildDayChanges(studentId),
    PARENT_RESOURCE_OPTIONS,
  );
  const { mutate } = resource;
  const { error, failure } = useSwrResourceLoadError(
    [resource],
    dayText(t, day)("loadObject"),
    () => mutate(),
  );
  useEffect(() => {
    const reload = () => void mutate();
    window.addEventListener(NOTIFICATION_FEED_REFRESH_EVENT, reload);
    return () =>
      window.removeEventListener(NOTIFICATION_FEED_REFRESH_EVENT, reload);
  }, [mutate]);
  // Heute ohne Antwort und ohne Fehler: nichts, wie vor #8236. Unter
  // „Morgen“ bleibt der Umschalter auch bei einem Fehler, damit die
  // Person zu „Heute“ zurück kann.
  if (failure && day === "today") return <LoadErrorAlert error={error} />;
  if (!resource.data && !failure && day === "today") return null;
  // Eine Antwort eines anderen Tags steht nie mit den Sätzen dieses Tags da.
  const data = resource.data?.date === shown ? resource.data : undefined;
  return (
    <ChildDayChangesList
      changes={data}
      firstName={firstName}
      day={day}
      failure={failure ? <LoadErrorAlert error={error} /> : undefined}
      toolbar={
        <DaySwitch
          value={day}
          labels={{
            label: t("changesDay.label"),
            today: t("changesDay.today"),
            tomorrow: t("changesDay.tomorrow"),
          }}
          onChange={(next) => {
            if (next === "tomorrow") trackEvent("day_changes_tomorrow_shown");
            setDay(next);
          }}
        />
      }
    />
  );
}
