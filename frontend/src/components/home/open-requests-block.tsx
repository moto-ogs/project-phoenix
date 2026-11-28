"use client";

import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { ListRow } from "~/components/ui/list-row";
import { SkeletonRegion } from "~/components/ui/page-skeletons";
import { SkeletonRows } from "~/components/ui/skeleton";
import {
  HomeCard,
  HomeCardEmpty,
  HomeCardIcon,
} from "~/components/home/home-card";
import { HomeCardLink } from "~/components/home/home-card-rows";
import { StatusBadge } from "~/components/ui/status-badge";
import { useCareWithdrawalsPending } from "~/lib/hooks/use-care-withdrawals-pending";
import { useChangeRequestsPending } from "~/lib/hooks/use-change-requests-pending";
import { useEnrollmentRequestsPending } from "~/lib/hooks/use-enrollment-requests-pending";
import { useEnrollmentsUnread } from "~/lib/hooks/use-enrollments-unread";
import { useStaffAbsencesPending } from "~/lib/hooks/use-staff-absences-pending";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import type { UseUnreadCountResult } from "~/lib/hooks/use-unread-count";
import { useTenantAwarePath } from "~/lib/tenant-path";
import { requestsConcept } from "~/lib/concepts/requests";

interface RequestSource {
  readonly key: string;
  readonly label: string;
  readonly hint: string;
  readonly href: string;
  /** Wort hinter der Zahl; ohne Angabe „offen“. */
  readonly badge?: string;
  readonly reader: UseUnreadCountResult;
}

/**
 * Baustein „Offene Anfragen" (#2180): was auf eine Entscheidung wartet und
 * sonst liegen bleibt, weil niemand die Seite aufruft.
 *
 * Die Zähler kommen aus denselben Hooks wie die Zähler in der Seitenleiste —
 * eine zweite Quelle würde zwei verschiedene Zahlen für dieselbe Sache zeigen.
 * Jede Zeile führt genau dorthin, wo entschieden wird.
 *
 * Jede Quelle hat einen Zustand (#8268): gilt nicht für die Person
 * (`inactive`, auch nach einer Ablehnung des Servers), lädt, fehlgeschlagen
 * oder bestätigt. Entwarnung gibt es nur, wenn jede geltende Quelle
 * bestätigt leer ist. Bekannte Aufgaben bleiben auch bei einem Teilausfall
 * stehen; der Ausfall nennt keine Quelle, damit eine Fehlermeldung nichts
 * über einen Bereich verrät, den die Person nicht öffnen darf.
 *
 * Die Karte wächst mit ihrem Inhalt (`data-home-card-fit`): es gibt höchstens
 * fünf Arten, und jede ist eine Aufgabe. In der festen Zellenhöhe stand die
 * vierte nur halb da, die fünfte gar nicht.
 */
export function OpenRequestsBlock() {
  const tenantPath = useTenantAwarePath();
  const changeRequests = useChangeRequestsPending();
  const unreadEnrollments = useEnrollmentsUnread();
  const enrollmentRequests = useEnrollmentRequestsPending();
  const careWithdrawals = useCareWithdrawalsPending();
  const staffAbsences = useStaffAbsencesPending();
  const sources: readonly RequestSource[] = [
    {
      key: "parent",
      label: "Wünsche von Eltern",
      hint: "Stammdaten, Betreuungszeiten, Krankmeldungen",
      href: tenantPath("/anfragen"),
      reader: changeRequests,
    },
    {
      // Eine Anmeldung ist keine Anfrage (#3778), wartet aber genauso auf
      // die Leitung; die Zeile führt deshalb zu den Anmeldungen.
      key: "unread-enrollment",
      label: "Neue Anmeldungen",
      hint: "Noch nicht gelesene Anmeldungen von Eltern",
      badge: "ungelesen",
      href: tenantPath("/admin/enrollments"),
      reader: unreadEnrollments,
    },
    {
      key: "enrollment",
      label: "Änderungen an Anmeldungen",
      hint: "Eingereichte Änderungen zu laufenden Anmeldungen",
      href: tenantPath("/anfragen"),
      reader: enrollmentRequests,
    },
    {
      key: "withdrawal",
      label: "Abmeldungen aus der Betreuung",
      hint: "Angekündigte Komplett-Abmeldungen",
      href: tenantPath("/anfragen"),
      reader: careWithdrawals,
    },
    {
      key: "staff",
      label: "Anträge des Teams",
      hint: "Urlaub und Abwesenheiten von Mitarbeitenden",
      // Direkt in den Reiter der Anträge; ohne ihn zeigte die Seite einer
      // Leitung mit beiden Reitern zuerst die Wünsche von Eltern.
      href: tenantPath("/anfragen?reiter=mitarbeitende"),
      reader: staffAbsences,
    },
  ];

  const open = sources.filter(
    ({ reader }) => reader.state === "known" && reader.unreadCount > 0,
  );
  const failed = sources.filter(({ reader }) => reader.state === "failed");
  const loading = sources.some(({ reader }) => reader.state === "loading");
  const failure = failed[0]?.reader.error;
  const loadError = useSwrLoadError(
    failure,
    open.length > 0
      ? "ein Teil der offenen Anfragen"
      : "die Liste der offenen Anfragen",
    () => Promise.all(failed.map(({ reader }) => reader.refresh())),
  );
  // Der Fehlertext kommt aus dem Katalog und ist einen Moment unterwegs;
  // bis dahin steht das Skelett, nie die Entwarnung.
  const alert =
    failure !== undefined && loadError ? (
      <LoadErrorAlert error={loadError} actionLayout="responsive" />
    ) : null;
  let body: "rows" | "failed" | "loading" | "empty" = "empty";
  if (open.length > 0) body = "rows";
  else if (alert) body = "failed";
  else if (failure !== undefined || loading) body = "loading";

  return (
    <HomeCard
      title="Offene Anfragen"
      leading={<HomeCardIcon concept={requestsConcept} />}
      inlineActions
      actions={
        <HomeCardLink
          href={tenantPath("/anfragen")}
          label="Offene Anfragen: alle ansehen"
          tooltip="Öffnet die Liste aller offenen Anfragen."
        >
          Alle ansehen
        </HomeCardLink>
      }
    >
      {body === "rows" && (
        <div className="space-y-3" data-home-card-fit="">
          <ul className="space-y-2">
            {open.map((source) => (
              <li key={source.key}>
                <ListRow
                  href={source.href}
                  trailing={
                    <StatusBadge
                      tone="warning"
                      label={`${source.reader.unreadCount} ${source.badge ?? "offen"}`}
                    />
                  }
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-gray-900">
                      {source.label}
                    </span>
                    <span className="block truncate text-xs text-gray-500">
                      {source.hint}
                    </span>
                  </span>
                </ListRow>
              </li>
            ))}
          </ul>
          {alert}
        </div>
      )}
      {body === "failed" && <div data-home-card-fit="">{alert}</div>}
      {body === "loading" && (
        <SkeletonRegion label="Offene Anfragen werden geladen">
          <SkeletonRows rows={2} />
        </SkeletonRegion>
      )}
      {body === "empty" && (
        <HomeCardEmpty
          title="Nichts wartet auf eine Entscheidung"
          description="Neue Anfragen von Eltern und aus dem Team erscheinen hier."
        />
      )}
    </HomeCard>
  );
}
