import { readdirSync } from "node:fs";
import { join } from "node:path";
import { PORTAL_PAGES } from "../../src/proxy-pages.generated";

interface Group {
  family: string;
  representative: string;
  reason: string;
}
const group = (
  family: string,
  representative: string,
  reason: string,
): Group => ({ family, representative, reason });
const excluded = group(
  "Nicht wiederverwendbar",
  "–",
  "Einmaliger, schreibender oder tokengebundener Vorgang; kein erneuter Besuch gültigen Fachinhalts.",
);
const publicPage = group(
  "Öffentlich",
  "–",
  "Öffentlicher Einstieg, Hilfe, Einladung oder Anmeldung; keine bestehende Fachsitzung.",
);
const portalGroups: Record<string, Array<[RegExp, Group]>> = {
  OGS: [
    [
      /^(students|rooms|staff|database|activities|lists|care-offerings)(\/|$)/,
      group(
        "Verzeichnis und Detail",
        "kindersuche-admin, kinderakte-admin, team-person, räume-raum",
        "Datenliste mit Suche, Auswahl und separat geladener Detailansicht; keine Zeitbehauptung für einzelne ungemessene Unterseiten.",
      ),
    ],
    [
      /^(active-supervisions|ogs-groups|vertretung|substitutions|emergency|absences|tagesinformationen|dashboard|home)(\/|$)/,
      group(
        "Tagesbetrieb",
        "aufsicht-admin, gruppe-navigation, start-betreuer",
        "Kontextabhängige Tagesdaten oder Startkarten, bei Aufsicht und Gruppen mit aktiver Auswahl.",
      ),
    ],
    [
      /^(betreuungsplan|time-tracking|payroll|dienstplan|mein-dienstplan|tagesplan|calendar|calendar-periods|day-log|ferienwochen|statistics|wochenprotokolle)(\/|$)/,
      group(
        "Zeit und Planung",
        "zeit-admin, plan-admin, plan-betreuer, dienstplan-admin",
        "Zeitraumabhängige Auswertung, Wochenansicht oder Plan.",
      ),
    ],
    [
      /^(anfragen|admin|parent-attention|@parentAttention|parent-announcements|enrollment-|messages|team-chat|umfragen|reminders|eltern|meal-plan|dateien|info-displays|settings|profile)/,
      group(
        "Fachlisten und Verwaltung",
        "anfragen-admin",
        "Geschützte Fachansichten mit eigener Datenquelle; Liste, Detail, Konfiguration oder Postfach.",
      ),
    ],
  ],
  parents: [
    [
      /^\/?(children|$)/,
      group(
        "Familie und Kind",
        "start-kind, kind-start",
        "Kontogebundene Kinderkarten und kindbezogene Detaildaten.",
      ),
    ],
    [
      /^(calendar|documents|messages|news|meal-plan|ferienanmeldungen|settings)/,
      group(
        "Familienlisten und Konto",
        "start-nachrichten",
        "Weitere wiederkehrende Familienansichten; Zwischenstationen sind keine separat gemessenen Zielzeiten.",
      ),
    ],
  ],
  school: [
    [
      /^($|klasse|fehlzeiten|aufsichten|kalender|tagesinformationen|elternbriefe|elternsprechtag|nachrichten|einstellungen)/,
      group(
        "Schultag, Listen und Klassenkontext",
        "tagesübersicht-klasse, fehlzeiten-start",
        "Schulhülle mit Tagesdaten, Klassen-/Kind-Auswahl oder eigener Fachliste.",
      ),
    ],
  ],
  traeger: [
    [
      /^(uebersicht|schulen|auslastung|belegung|standortvergleich|zeitvergleich|tagesmeldung|ankunft-abholung|$)/,
      group(
        "Standorte und Kennzahlen",
        "übersicht-schule, belegung-übersicht",
        "Trägerweite Ansicht, Zeilen je Schule und Auswahl einer einzelnen Schule.",
      ),
    ],
    [
      /^(abrechnung|berichte|ferien|anmeldephasen|vertraege|nachweise|dokumente|personal|schliesstage|einstellungen|konto)/,
      group(
        "Trägerverwaltung",
        "schulen-ferien, ferien-zeitraum",
        "Wiederkehrende Listen mit Drilldown, Auswertungen und Einstellungen. Bestätigungen und Schreibaktionen sind kein warmer Lesezugriff.",
      ),
    ],
  ],
  operator: [
    [
      /^($|accounts|organizations|persons|operators|schools|caterers|provisioning|devices|unregistered-tags|billing|announcements|settings)/,
      group(
        "Plattformverzeichnis",
        "trägerliste-detail, schulen-schuldetail, trägerliste-konten",
        "Plattformweite Liste, Stammdaten und gefilterte Unterlisten in der Operator-Hülle.",
      ),
    ],
  ],
  caterer: [
    [
      /^($|konto)/,
      group(
        "Bestellungen und Konto",
        "bestellungen-konto, konto-bestellungen, bestellungen-zeitraum",
        "Zwei geschützte Seiten; Zeiträume und Schuldetails bleiben im selben History-Eintrag.",
      ),
    ],
  ],
};
function pagePaths(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return pagePaths(join(dir, entry.name));
    return entry.name === "page.tsx" ? [dir] : [];
  });
}
export function routeCatalog() {
  const app = join(process.cwd(), "src/app");
  const routes = pagePaths(app)
    .sort()
    .map((dir) => {
      const route = dir.slice(app.length + 1);
      const [root, ...segments] = route.split("/");
      const tenant = root === "[tenant]";
      const portal = tenant
        ? "OGS"
        : root && Object.hasOwn(PORTAL_PAGES, root)
          ? root
          : "öffentlich";
      const path = (
        tenant
          ? segments.filter(
              (segment) => !/^\((protected|public)\)$/.test(segment),
            )
          : segments
      ).join("/");
      if (
        portal !== "öffentlich" &&
        !tenant &&
        segments[0] &&
        !(
          PORTAL_PAGES[portal as keyof typeof PORTAL_PAGES] as readonly string[]
        ).includes("/" + segments[0])
      )
        throw new Error("Portalroute fehlt im Proxy: " + route);
      let classification: Group | undefined;
      if (
        /\[(token|link)\]|(?:^|\/)(?:invite|einladung|email-confirm|reset-password|accept-guardian-invite|onboarding|traeger-uebergabe|neu|import|einstellen|versand)(?:\/|$)/.test(
          route,
        ) ||
        /^(anmeldung(?:\/|$)|ferienanmeldung\/|ferienkonto\/|vertrag-unterschreiben\/)/.test(
          path,
        )
      )
        classification = excluded;
      else if (
        portal === "öffentlich" ||
        (tenant && !segments.includes("(protected)")) ||
        /^(login|demo)(\/|$)/.test(path)
      )
        classification = publicPage;
      else if (portal === "operator" && !path)
        classification = group(
          "Weiterleitung",
          "trägerliste-detail",
          "Die Operator-Wurzel leitet auf das Trägerverzeichnis weiter; kein eigener Fachinhalt.",
        );
      else
        classification = portalGroups[portal]?.find(([pattern]) =>
          pattern.test(path),
        )?.[1];
      if (!classification)
        throw new Error("Seitenfamilie ohne Messgruppe: " + route);
      return { route: "/" + route, portal, ...classification };
    });
  for (const [portal, pages] of Object.entries(PORTAL_PAGES)) {
    for (const path of pages) {
      if (
        !routes.some(
          (r) =>
            r.portal === portal &&
            (r.route === "/" + portal + path ||
              r.route.startsWith("/" + portal + path + "/")),
        )
      )
        throw new Error(
          "Proxy verweist auf fehlende Seitenfamilie: " + portal + path,
        );
    }
  }
  return routes;
}
