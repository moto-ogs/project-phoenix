import type { Session } from "next-auth";
import { describe, expect, it } from "vitest";

import { MODULE_KEYS } from "~/lib/modules";

import {
  TRAEGER_MODULE_KEYS,
  TRAEGER_MODULE_SUMMARIES,
  isTraegerDashboardPath,
  seesLockedTraegerModules,
  traegerDashboardBooked,
  traegerModuleNotBookedExplanation,
  traegerModuleOfPath,
  traegerModuleVisibility,
} from "./traeger-modules";

function sessionWith(permissions: string[]): Session {
  return {
    user: { id: "1", scope: "org", permissions },
    expires: "2099-01-01T00:00:00Z",
  } as unknown as Session;
}

describe("traegerModuleOfPath", () => {
  it("names the module of a page with and without the /traeger prefix", () => {
    expect(traegerModuleOfPath("/traeger/abrechnung")).toBe("elternbeitraege");
    expect(traegerModuleOfPath("/abrechnung/familien/zahlung/7")).toBe(
      "elternbeitraege",
    );
    expect(traegerModuleOfPath("/vertraege/12")).toBe("vertraege");
    expect(traegerModuleOfPath("/traeger/ferien/3/anmeldungen")).toBe(
      "ferienbetreuung",
    );
    expect(traegerModuleOfPath("/zeitvergleich")).toBe("traeger_uebersicht");
    expect(traegerModuleOfPath("/einstellungen/dokumentarten")).toBe(
      "elternbeitraege",
    );
  });

  it("leaves the frame of the portal to moto Basis", () => {
    for (const path of [
      "/",
      "/traeger",
      "/schulen/4",
      "/schliesstage",
      "/anmeldephasen",
      "/dokumente",
      "/personal/einsatzplanung",
      "/einstellungen",
      // Bank accounts stand here for every module; the page explains its
      // billing part itself.
      "/einstellungen/abrechnung",
      "/konto",
    ]) {
      expect(traegerModuleOfPath(path), path).toBeNull();
    }
  });

  it("matches whole path segments only", () => {
    expect(traegerModuleOfPath("/ferienplan")).toBeNull();
    expect(traegerModuleOfPath("/vertraege-alt")).toBeNull();
  });
});

describe("traegerModuleVisibility", () => {
  it("opens Basis and booked modules for everyone", () => {
    expect(traegerModuleVisibility(null, [], false)).toBe("open");
    expect(traegerModuleVisibility("vertraege", ["vertraege"], false)).toBe(
      "open",
    );
  });

  it("shows a missing module with a lock only to who leads the office", () => {
    expect(traegerModuleVisibility("vertraege", [], true)).toBe("locked");
    expect(traegerModuleVisibility("vertraege", [], false)).toBe("hidden");
  });

  it("locks nothing while the booked modules are unknown", () => {
    expect(traegerModuleVisibility("vertraege", null, false)).toBe("open");
    expect(traegerDashboardBooked(null)).toBe(true);
  });
});

describe("the dashboard as start page", () => {
  it("knows the dashboard with and without the /traeger prefix", () => {
    expect(isTraegerDashboardPath("/uebersicht")).toBe(true);
    expect(isTraegerDashboardPath("/traeger/uebersicht")).toBe(true);
    expect(isTraegerDashboardPath("/belegung")).toBe(false);
  });

  it("follows Träger-Übersicht", () => {
    expect(traegerDashboardBooked(["traeger_uebersicht"])).toBe(true);
    expect(traegerDashboardBooked(["vertraege"])).toBe(false);
  });
});

describe("who sees a lock and what the explanation says", () => {
  it("counts the right „Mitglieder und Rollen“ as leading the office", () => {
    expect(
      seesLockedTraegerModules(sessionWith(["traeger_accounts:manage"])),
    ).toBe(true);
    expect(
      seesLockedTraegerModules(sessionWith(["traeger_billing:manage"])),
    ).toBe(false);
    expect(seesLockedTraegerModules(null)).toBe(false);
  });

  it("names the module and who acts next", () => {
    expect(traegerModuleNotBookedExplanation("elternbeitraege", true)).toBe(
      "Diese Seite gehört zum moto-Modul „Elternbeiträge und Abrechnung“. Keine Schule deines Trägers hat es gebucht. Für eine Buchung wende dich an das moto-Team.",
    );
    expect(traegerModuleNotBookedExplanation("ferienbetreuung", false)).toBe(
      "Diese Seite gehört zum moto-Modul „Ferienbetreuung“. Dein Träger nutzt es nicht. Wenn du es brauchst, sprich mit der Leitung deines Träger-Büros.",
    );
  });
});

describe("the modules of the Träger portal", () => {
  it("are modules of the catalog, each with a summary", () => {
    for (const key of TRAEGER_MODULE_KEYS) {
      expect(MODULE_KEYS).toContain(key);
      expect(TRAEGER_MODULE_SUMMARIES[key]).not.toBe("");
    }
  });
});
