import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { TRAEGER_LIST_FORMATS } from "~/lib/traeger-list-export";

// Jede Liste und jeder Bericht des Träger-Portals ist als PDF, Excel und CSV
// herunterladbar, für eine Schule oder alle (#4718). Der Test liest den
// Quelltext jeder Seite unter app/traeger: Eine neue Seite steht in genau einem
// der zwei Register, und eine Liste mit Download nutzt das gemeinsame Menü,
// sodass sie alle drei Formate anbietet. Eine neue Liste ohne Download lässt
// den Test rot werden.

const SRC_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const TRAEGER_DIR = path.join(SRC_DIR, "app", "traeger");

/**
 * Listen und Berichte mit Download. „page“: Die Seite selbst nutzt
 * `TraegerListExportMenu`, `useTraegerListExportItems` (Einträge im
 * Drei-Punkte-Menü, #7403) oder `TRAEGER_LIST_FORMAT_OPTIONS`. Sonst nennt der
 * Wert die Komponente unter `src/`, die den Download der Liste trägt.
 */
const LIST_EXPORTS: Readonly<Record<string, string>> = {
  "/": "page",
  "/abrechnung": "page",
  "/abrechnung/[id]": "components/traeger/billing-run-overview-card.tsx",
  "/abrechnung/exporte": "page",
  "/abrechnung/familien": "page",
  "/abrechnung/familien/[id]": "page",
  "/abrechnung/jahresbescheide": "page",
  "/abrechnung/jahresbescheide/[id]": "page",
  "/abrechnung/jahresbescheide/[id]/versand": "page",
  "/abrechnung/kinderzahl": "page",
  "/abrechnung/kostentraeger": "page",
  "/abrechnung/lastschrift": "page",
  "/abrechnung/monatsbeitraege": "page",
  "/abrechnung/monatsbeitraege/[id]": "page",
  "/abrechnung/nachweise": "page",
  "/ankunft-abholung": "page",
  "/anmeldephasen": "page",
  "/auslastung": "page",
  "/belegung": "page",
  "/berichte": "page",
  "/dokumente": "page",
  "/einstellungen/briefkopf/vorlagen": "page",
  "/einstellungen/mitglieder": "page",
  "/einstellungen/zugriffsprotokoll": "page",
  "/ferien": "page",
  "/ferien/[id]/anmeldungen": "page",
  "/ferien/[id]/plaetze": "page",
  "/ferien/[id]/vergabe": "page",
  "/nachweise": "page",
  "/personal": "page",
  "/personal/einsatzplanung": "page",
  "/personal/vertretungspool": "page",
  "/schliesstage": "page",
  "/standortvergleich": "page",
  "/tagesmeldung": "page",
  "/uebersicht": "page",
  "/vertraege": "page",
  "/vertraege/geschwister": "page",
  "/zeitvergleich": "page",
};

/**
 * Seiten ohne Liste: Formulare, Einstellungen, Einzelansichten, Anmeldung.
 * Eine Seite mit eigener Tabelle (`<DataTable`) ist eine Liste und steht nie
 * hier.
 */
const NOT_A_LIST: Readonly<Record<string, string>> = {
  "/abrechnung/[id]/faelligkeiten": "Formular",
  "/abrechnung/ermaessigungen": "Einstellungen",
  "/abrechnung/exporte/empfaenger": "Einstellungen",
  "/abrechnung/exporte/empfaenger/[id]": "Einzelansicht",
  "/abrechnung/exporte/empfaenger/neu": "Formular",
  "/abrechnung/exporte/feldzuordnung": "Einstellungen",
  "/abrechnung/exporte/konten": "Einstellungen",
  "/abrechnung/familien/zahlung/[contractId]": "Formular",
  "/abrechnung/jahresbescheide/[id]/bescheid/[contractId]": "Dokument",
  "/abrechnung/jahresbescheide/[id]/lastschrift": "Schritt eines Laufs",
  "/abrechnung/kinderzahl/import": "Import",
  "/abrechnung/lastschrift/[contractId]": "Einzelansicht",
  "/abrechnung/lastschrift/import": "Import",
  "/abrechnung/mensa": "Einstellungen",
  "/abrechnung/monatsbeitraege/[id]/empfaenger/[contractId]": "Einzelansicht",
  "/abrechnung/monatsbeitraege/[id]/faelligkeiten": "Formular",
  "/abrechnung/monatsbeitraege/[id]/rechnung/[contractId]": "Dokument",
  "/abrechnung/monatsbeitraege/[id]/schreiben": "Schritt eines Laufs",
  "/abrechnung/preise": "Einstellungen",
  "/anmeldephasen/[id]": "Einzelansicht",
  "/anmeldephasen/[id]/angebote/[offeringId]": "Formular",
  "/anmeldephasen/[id]/angebote/neu": "Formular",
  "/anmeldephasen/[id]/vorschau": "Vorschau",
  "/anmeldephasen/neu": "Formular",
  "/berichte/vorlagen/[id]": "Formular",
  "/berichte/vorlagen/neu": "Formular",
  "/demo": "Anmeldung",
  "/dokumente/[id]": "Einzelansicht",
  "/einstellungen": "Einstellungen",
  "/einstellungen/abrechnung": "Einstellungen",
  "/einstellungen/briefkopf": "Einstellungen",
  "/einstellungen/briefkopf/vorlagen/[kind]": "Einstellungen",
  "/einstellungen/dokumentarten": "Einstellungen",
  "/einstellungen/schulrollen": "Einstellungen",
  "/einstellungen/zustaendigkeiten": "Einstellungen",
  "/ferien/[id]": "Einzelansicht",
  "/ferien/[id]/anmeldungen/[registrationId]": "Einzelansicht mit eigener PDF",
  "/ferien/[id]/formular": "Formular",
  "/ferien/kriterien": "Einstellungen",
  "/ferien/neu": "Formular",
  "/invite": "Anmeldung",
  "/konto": "Eigenes Konto",
  "/login": "Anmeldung",
  "/personal/[id]": "Einzelansicht",
  "/personal/abwesenheitsarten": "Einstellungen",
  "/personal/einstellen": "Formular",
  "/personal/import": "Import",
  "/personal/lohnexport": "Export in eigenen Formaten (DATEV, Zeitexport)",
  "/reset-password": "Anmeldung",
  "/schulen/[id]": "Einzelansicht",
  "/vertraege/[id]": "Einzelansicht",
  "/vertraege/bedingungen": "Einstellungen",
  "/vertraege/import": "Import",
  "/vertraege/nachpflege": "Nachpflege aus einer Datei",
  "/vertraege/module-zuordnen": "Import",
  "/vertraege/verknuepfen": "Import",
  "/vertraege/anmeldungen": "Vorschau",
};

function collectPages(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const entryPath = path.join(directory, entry);
    if (statSync(entryPath).isDirectory()) return collectPages(entryPath);
    return entry === "page.tsx" ? [entryPath] : [];
  });
}

const pages = collectPages(TRAEGER_DIR).map((file) => {
  const route = path
    .relative(TRAEGER_DIR, path.dirname(file))
    .split(path.sep)
    .join("/");
  return { route: `/${route}`, source: readFileSync(file, "utf8") };
});

/** The shared menu, its page-menu entries or its formats: PDF, Excel and CSV. */
function offersEveryFormat(source: string): boolean {
  return (
    source.includes("<TraegerListExportMenu") ||
    source.includes("useTraegerListExportItems(") ||
    source.includes("TRAEGER_LIST_FORMAT_OPTIONS") ||
    /exportFormatOptions\(\[\s*"pdf",\s*"xlsx",\s*"csv",?\s*\]\)/.test(source)
  );
}

describe("Downloads der Listen im Träger-Portal (#4718)", () => {
  it("offers PDF, Excel and CSV", () => {
    expect(TRAEGER_LIST_FORMATS).toEqual(["pdf", "xlsx", "csv"]);
  });

  it("classifies every page in exactly one register", () => {
    const unclassified = pages
      .map((page) => page.route)
      .filter((route) => {
        const registers = [LIST_EXPORTS, NOT_A_LIST].filter(
          (register) => route in register,
        );
        return registers.length !== 1;
      });
    expect(
      unclassified,
      "Eine neue Träger-Seite: Ist sie eine Liste, bekommt sie den Download (LIST_EXPORTS), sonst steht sie mit Grund in NOT_A_LIST.",
    ).toEqual([]);
  });

  it("keeps no entry for a page that is gone", () => {
    const routes = new Set(pages.map((page) => page.route));
    const stale = [LIST_EXPORTS, NOT_A_LIST]
      .flatMap((register) => Object.keys(register))
      .filter((route) => !routes.has(route));
    expect(stale).toEqual([]);
  });

  it("gives every list in LIST_EXPORTS its three formats", () => {
    const missing = pages
      .filter((page) => page.route in LIST_EXPORTS)
      .filter((page) => {
        const carrier = LIST_EXPORTS[page.route]!;
        const source =
          carrier === "page"
            ? page.source
            : readFileSync(path.join(SRC_DIR, carrier), "utf8");
        return !offersEveryFormat(source);
      })
      .map((page) => page.route);
    expect(missing).toEqual([]);
  });

  it("keeps every page with a table out of NOT_A_LIST", () => {
    const tables = pages
      .filter((page) => page.route in NOT_A_LIST)
      .filter((page) => page.source.includes("<DataTable"))
      .map((page) => page.route);
    expect(
      tables,
      "Eine Seite mit Tabelle ist eine Liste: Sie bekommt den Download.",
    ).toEqual([]);
  });
});
