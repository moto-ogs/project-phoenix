"use client";

import { useEffect, useId } from "react";
import { Alert } from "~/components/ui/alert";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { SectionLabel } from "~/components/ui/section-label";
import { StatusBadge } from "~/components/ui/status-badge";
import { useCareTermTranslations } from "~/lib/care-facility-term";
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
): string | null {
  const time = entry.starts_at ? formatTime(entry.starts_at) : "";
  const title = entry.activity_title ?? "";
  const className = schoolClassName(entry.class_name ?? "");
  switch (entry.kind) {
    case "child_absent":
      return entry.child_status === "sick"
        ? t("changes.sick", { name: firstName })
        : t("changes.excused", { name: firstName });
    case "child_pickup_changed":
      if (!entry.pickup_time)
        return t("changes.notComing", { name: firstName });
      // Eine Abholzeit nach der geänderten Schließzeit bleibt, wie sie ist;
      // der Satz sagt, dass sie danach liegt (#8170).
      return entry.pickup_after_closing
        ? `${t("changes.pickupAt", { name: firstName, time: entry.pickup_time })} ${t("changes.pickupAfterClosing")}`
        : t("changes.pickupAt", { name: firstName, time: entry.pickup_time });
    case "child_goes_alone":
      return t("changes.goesAlone", { name: firstName });
    case "child_pickup_person": {
      // Wer das Kind heute abholt (#8162); eine andere Person zeigt den
      // Ausweis, weil die OGS sie nicht kennt.
      const person = entry.pickup_person_name ?? "";
      if (person === "") return null;
      return entry.pickup_person_one_time
        ? t("changes.pickupPersonOneTime", { person, name: firstName })
        : t("changes.pickupPerson", { person, name: firstName });
    }
    case "class_trip":
      return entry.class_time
        ? t("changes.classTripBack", {
            class: className,
            time: entry.class_time,
          })
        : t("changes.classTrip", { class: className });
    case "class_dismissal_changed":
      return t("changes.classDismissal", {
        class: className,
        time: entry.class_time ?? "",
      });
    case "closing_day":
      return entry.until
        ? t("changes.closingDayUntil", {
            name: entry.closing_name ?? "",
            date: formatDate(entry.until),
          })
        : t("changes.closingDay", { name: entry.closing_name ?? "" });
    case "opening_changed": {
      const hours = {
        name: entry.opening_name ?? "",
        opens: entry.opens_at ?? "",
        closes: entry.closes_at ?? "",
      };
      return entry.until
        ? t("changes.openingChangedUntil", {
            ...hours,
            date: formatDate(entry.until),
          })
        : t("changes.openingChanged", hours);
    }
    case "activity_cancelled":
      return t("changes.activityCancelled", { title, time });
    case "activity_reinstated":
      return t("changes.activityReinstated", { title, time });
    case "activity_room_changed":
      return t("changes.activityRoomChanged", {
        title,
        time,
        room: entry.room_name ?? "",
      });
    case "activity_lead_changed":
      return t("changes.activityLeadChanged", { title, time });
    default:
      return null;
  }
}

/**
 * „Heute anders“ eines Kindes in seiner Tageskarte (#7671). Ohne Änderungen
 * und ohne fehlgeschlagene Quelle steht „Heute läuft alles wie geplant.“
 * Fehlt eine Quelle, steht ein Hinweis, und die Entwarnung erscheint nie.
 * Eine Änderung, die die Person selbst eingetragen hat, trägt „Von dir
 * eingetragen“ als Bestätigung.
 */
export function ChildDayChangesList({
  changes,
  firstName,
}: Readonly<{
  changes: parentMeContract.ChildDayChangesResponse;
  firstName: string;
}>) {
  const t = useCareTermTranslations("parentToday");
  const headingId = useId();
  const failed = (changes.sources ?? []).some(
    (source) => source.status === "failed",
  );
  const lines = (changes.entries ?? []).flatMap((entry, index) => {
    const text = childDayChangeText(entry, firstName, t);
    return text === null
      ? []
      : [{ key: `${entry.kind}-${index}`, text, byYou: entry.entered_by_you }];
  });
  return (
    <section aria-labelledby={headingId} data-testid="child-day-changes">
      <SectionLabel id={headingId} as="h3">
        {t("changes.title")}
      </SectionLabel>
      {lines.length > 0 && (
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
      {failed && (
        <Alert
          type="warning"
          size="compact"
          className="mt-2"
          message={t("changes.partial")}
        />
      )}
      {lines.length === 0 && !failed && (
        <p className="mt-1 text-sm leading-6 text-gray-600">
          {t("changes.allAsPlanned")}
        </p>
      )}
    </section>
  );
}

/**
 * Lädt „Heute anders“ eines Kindes und zeigt es. Neu geladen wird beim
 * Fokus der Seite, nach einer neuen Verbindung (`parent-child-status-refresh`
 * erreicht den Schlüssel über `isChildStatusResource`) und wenn sich der
 * Hinweis-Feed des Kontos ändert (`notification_feed_changed`).
 */
export function ChildDayChanges({
  studentId,
  firstName,
}: Readonly<{ studentId: string; firstName: string }>) {
  const t = useCareTermTranslations("parentToday");
  const day = useBerlinToday();
  const resource = useSWRAuth(
    parentKeys.dayChanges(studentId, day),
    () => getChildDayChanges(studentId),
    PARENT_RESOURCE_OPTIONS,
  );
  const { mutate } = resource;
  const { error, failure } = useSwrResourceLoadError(
    [resource],
    t("changes.loadObject"),
    () => mutate(),
  );
  useEffect(() => {
    const reload = () => void mutate();
    window.addEventListener(NOTIFICATION_FEED_REFRESH_EVENT, reload);
    return () =>
      window.removeEventListener(NOTIFICATION_FEED_REFRESH_EVENT, reload);
  }, [mutate]);
  if (failure) return <LoadErrorAlert error={error} />;
  if (!resource.data) return null;
  return <ChildDayChangesList changes={resource.data} firstName={firstName} />;
}
