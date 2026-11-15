import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import dePageTitles from "~/i18n/messages/de/pageTitles.json";
import enPageTitles from "~/i18n/messages/en/pageTitles.json";
import plPageTitles from "~/i18n/messages/pl/pageTitles.json";
import ruPageTitles from "~/i18n/messages/ru/pageTitles.json";
import sqPageTitles from "~/i18n/messages/sq/pageTitles.json";
import trPageTitles from "~/i18n/messages/tr/pageTitles.json";
import ukPageTitles from "~/i18n/messages/uk/pageTitles.json";
import { appRoot, collectPageRoutes } from "~/test/page-routes";
import {
  formatPageTitle,
  GERMAN_PAGE_TITLES,
  LOCALIZED_PAGE_TITLES,
  METADATA_TITLE_TEMPLATES,
  OGS_NOT_FOUND_TEMPLATE,
  pageTitleSurfaceOf,
  pageTitleText,
  resolvePageTitle,
  type PageTitleSurface,
} from "./page-titles";

const LOCALE_PAGE_TITLES = {
  de: dePageTitles,
  en: enPageTitles,
  pl: plPageTitles,
  ru: ruPageTitles,
  sq: sqPageTitles,
  tr: trPageTitles,
  uk: ukPageTitles,
};

const PORTAL_DIRECTORIES = [
  "[tenant]",
  "parents",
  "school",
  "caterer",
  "traeger",
  "operator",
  "api",
];

// Each portal's page tree. A new page.tsx without a title fails here: add
// its template to GERMAN_PAGE_TITLES or LOCALIZED_PAGE_TITLES (#7109).
const PAGE_TREES: ReadonlyArray<{
  readonly surface: PageTitleSurface;
  readonly directory: string;
  readonly skip?: ReadonlySet<string>;
}> = [
  { surface: "ogs", directory: "[tenant]" },
  { surface: "parents", directory: "parents" },
  { surface: "school", directory: "school" },
  { surface: "caterer", directory: "caterer" },
  { surface: "traeger", directory: "traeger" },
  { surface: "operator", directory: "operator" },
  { surface: "public", directory: ".", skip: new Set(PORTAL_DIRECTORIES) },
];

function germanTitles(surface: PageTitleSurface): Record<string, string> {
  return { ...GERMAN_PAGE_TITLES[surface] };
}

function localizedTitles(surface: PageTitleSurface): Record<string, string> {
  return { ...LOCALIZED_PAGE_TITLES[surface] };
}

function titledTemplates(surface: PageTitleSurface): string[] {
  return [
    ...Object.keys(germanTitles(surface)),
    ...Object.keys(localizedTitles(surface)),
    ...(surface === "public" ? METADATA_TITLE_TEMPLATES : []),
  ].sort();
}

const GERMAN_MESSAGES = {
  portals: dePageTitles.portals,
  pages: dePageTitles.pages,
};

/** The German tab title of a template, as the browser shows it. */
function germanTabTitle(surface: PageTitleSurface, template: string) {
  return pageTitleText(
    { kind: "route", surface, template },
    GERMAN_MESSAGES,
    null,
  );
}

/**
 * Redirect pages: they only forward to another page, so they carry that
 * page's title. Every other page of a portal has a title of its own.
 */
const REDIRECT_ALIASES: Readonly<
  Partial<Record<PageTitleSurface, Readonly<Record<string, string>>>>
> = {
  ogs: {
    "/admin/change-requests": "/anfragen",
    "/admin/enrollments/change-requests": "/anfragen",
    "/dashboard": "/home",
    "/parent-attention/:studentId": "/students/:id",
  },
  operator: {
    "/": "/organizations",
    "/provisioning": "/organizations",
  },
  public: { "/onboarding": "/start" },
};

describe("page title registry", () => {
  it.each(PAGE_TREES)(
    "gives every page of $surface a title",
    ({ surface, directory, skip }) => {
      const pages = collectPageRoutes(path.join(appRoot, directory), skip);

      expect(titledTemplates(surface)).toEqual([...new Set(pages)].sort());
    },
  );

  it.each(PAGE_TREES)("names each page of $surface once", ({ surface }) => {
    const aliases = REDIRECT_ALIASES[surface] ?? {};
    const owners = new Map<string, string>();
    const ownMetadata: readonly string[] = METADATA_TITLE_TEMPLATES;
    for (const template of titledTemplates(surface)) {
      // The Metadata API pages set their own title.
      if (ownMetadata.includes(template)) continue;
      const title = germanTabTitle(surface, template) ?? "";
      expect(title, template).toMatch(/ – moto$/);
      const target = aliases[template];
      if (target !== undefined) {
        expect(title).toBe(germanTabTitle(surface, target));
        continue;
      }
      expect(owners.get(title), `${template}: ${title}`).toBeUndefined();
      owners.set(title, template);
    }
  });

  it("keeps a template in one list per portal", () => {
    for (const { surface } of PAGE_TREES) {
      const german = Object.keys(germanTitles(surface));
      const localized = Object.keys(localizedTitles(surface));
      expect(german.filter((template) => localized.includes(template))).toEqual(
        [],
      );
    }
  });

  it.each(Object.entries(LOCALE_PAGE_TITLES))(
    "names each translated page once in %s",
    (_locale, catalog) => {
      for (const titles of Object.values(LOCALIZED_PAGE_TITLES)) {
        const texts = Object.values(titles).map(
          (key) => (catalog.pages as Record<string, string>)[key],
        );
        expect(new Set(texts).size).toBe(texts.length);
      }
    },
  );

  it("finds a German text for every localized title", () => {
    const keys = Object.values(LOCALIZED_PAGE_TITLES).flatMap((titles) =>
      Object.values(titles),
    );
    for (const key of keys) {
      expect(dePageTitles.pages, key).toHaveProperty(key);
    }
  });

  it("lets every Metadata API page name itself", () => {
    const files = {
      "/help": "help/[[...topic]]/page.tsx",
      "/help/:topic*": "help/[[...topic]]/page.tsx",
      "/help/nfc/erste-schritte": "help/nfc/erste-schritte/page.tsx",
      "/lohnbuero/:link": "lohnbuero/[link]/page.tsx",
    } satisfies Record<(typeof METADATA_TITLE_TEMPLATES)[number], string>;
    for (const file of Object.values(files)) {
      const source = readFileSync(path.join(appRoot, file), "utf8");
      expect(source, file).toMatch(/\btitle:/);
      expect(source, file).toMatch(
        /export (const metadata|async function generateMetadata)/,
      );
    }
  });
});

describe("resolvePageTitle", () => {
  it("reads the path of a portal host without its namespace", () => {
    expect(resolvePageTitle("school", "/kalender")).toEqual({
      kind: "route",
      surface: "school",
      template: "/kalender",
    });
    // The server render can still show the rewritten path.
    expect(resolvePageTitle("school", "/school/kalender")).toEqual({
      kind: "route",
      surface: "school",
      template: "/kalender",
    });
  });

  it("prefers a static page over a dynamic one", () => {
    expect(resolvePageTitle("ogs", "/rooms/unterwegs")).toMatchObject({
      template: "/rooms/unterwegs",
    });
    expect(resolvePageTitle("ogs", "/rooms/12")).toMatchObject({
      template: "/rooms/:id",
    });
  });

  it("strips the school's slug of path routing", () => {
    expect(resolvePageTitle("public", "/school-a/students/42")).toMatchObject({
      surface: "ogs",
      template: "/students/:id",
    });
    expect(resolvePageTitle("public", "/school-a")).toMatchObject({
      surface: "ogs",
      template: "/",
    });
    expect(resolvePageTitle("public", "/school-a/home")).toMatchObject({
      surface: "ogs",
      template: "/home",
    });
  });

  it("names an unknown page of a school as not found", () => {
    // The server render sees the browser path, so a single unknown segment
    // on the school's host is no login slug.
    expect(resolvePageTitle("ogs", "/gibtsnicht")).toMatchObject({
      template: OGS_NOT_FOUND_TEMPLATE,
    });
    expect(resolvePageTitle("ogs", "/gibt/es/nicht")).toMatchObject({
      template: OGS_NOT_FOUND_TEMPLATE,
    });
    expect(resolvePageTitle("ogs", "/")).toMatchObject({ template: "/" });
  });

  it("finds the portal in the path on the bare domain", () => {
    expect(resolvePageTitle("public", "/parents/children/7")).toMatchObject({
      surface: "parents",
      template: "/children/:id",
    });
    expect(resolvePageTitle("public", "/traeger")).toMatchObject({
      surface: "traeger",
      template: "/",
    });
    expect(resolvePageTitle("public", "/start")).toMatchObject({
      surface: "public",
      template: "/start",
    });
  });

  it("leaves the help to its own metadata on every host", () => {
    expect(resolvePageTitle("parents", "/help/kindersuche")).toEqual({
      kind: "metadata",
    });
    expect(resolvePageTitle("public", "/help")).toEqual({ kind: "metadata" });
  });

  it("ignores a trailing slash", () => {
    expect(resolvePageTitle("traeger", "/vertraege/")).toMatchObject({
      template: "/vertraege",
    });
  });
});

describe("pageTitleText", () => {
  it("builds page, portal and brand", () => {
    expect(germanTabTitle("traeger", "/vertraege")).toBe(
      "Verträge – Träger – moto",
    );
    expect(germanTabTitle("public", "/start")).toBe("Erstgespräch – moto");
  });

  it("names no record, only the kind of page", () => {
    const title = pageTitleText(
      resolvePageTitle("ogs", "/students/42"),
      GERMAN_MESSAGES,
      null,
    );
    expect(title).toBe("Kindakte – OGS – moto");
  });

  it("puts the addressed tab in front", () => {
    expect(
      pageTitleText(
        resolvePageTitle("ogs", "/students/42"),
        GERMAN_MESSAGES,
        "Verlauf",
      ),
    ).toBe("Verlauf – Kindakte – OGS – moto");
  });

  it("translates the localized portals", () => {
    expect(
      pageTitleText(
        resolvePageTitle("parents", "/children"),
        {
          portals: { parents: "Parents" },
          pages: { children: "Children" },
        },
        null,
      ),
    ).toBe("Children – Parents – moto");
  });

  it("falls back to the brand for a path no page serves", () => {
    expect(
      pageTitleText(
        resolvePageTitle("traeger", "/gibt-es-nicht"),
        GERMAN_MESSAGES,
        null,
      ),
    ).toBe("moto");
  });

  it("returns nothing for a page with its own metadata", () => {
    expect(
      pageTitleText({ kind: "metadata" }, GERMAN_MESSAGES, null),
    ).toBeNull();
  });
});

describe("formatPageTitle", () => {
  it("drops empty and repeated parts", () => {
    expect(
      formatPageTitle({ page: "Preisliste", portal: "Träger", section: "" }),
    ).toBe("Preisliste – Träger – moto");
    expect(
      formatPageTitle({
        page: "Monatsbeiträge",
        portal: "Träger",
        section: "Monatsbeiträge",
      }),
    ).toBe("Monatsbeiträge – Träger – moto");
    expect(
      formatPageTitle({
        page: "Klassenliste – Datenverwaltung",
        portal: "OGS",
        section: "Klassenliste",
      }),
    ).toBe("Klassenliste – Datenverwaltung – OGS – moto");
  });
});

describe("pageTitleSurfaceOf", () => {
  it("maps the request host to its portal", () => {
    expect(
      pageTitleSurfaceOf("parent", "eltern.moto-app.de", "moto-app.de"),
    ).toBe("parents");
    expect(
      pageTitleSurfaceOf("traeger", "traeger.moto-app.de", "moto-app.de"),
    ).toBe("traeger");
    expect(
      pageTitleSurfaceOf("tenant", "school-a.moto-app.de", "moto-app.de"),
    ).toBe("ogs");
    expect(pageTitleSurfaceOf("tenant", "moto-app.de", "moto-app.de")).toBe(
      "public",
    );
    expect(pageTitleSurfaceOf("tenant", "localhost", "localhost:3000")).toBe(
      "public",
    );
  });
});
