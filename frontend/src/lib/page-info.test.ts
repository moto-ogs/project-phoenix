import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Wächter für den Info-Knopf am Seitentitel (#7565). Eine OGS- oder
// Lehrer-Seite erklärt sich über die `info`-Eigenschaft von `TenantPage`:
// wofür sie da ist und was man dort zuerst tut. Der Test liest Quelltext,
// nicht das DOM, wie die Baseline der Hilfe-Zuordnung (help-topics.test.ts).

const SRC_ROOT = resolve(process.cwd(), "src");
const KIT_ROOT = resolve(SRC_ROOT, "components/ui");

const PORTALS = [
  {
    prefix: "",
    root: resolve(SRC_ROOT, "app/[tenant]/(protected)"),
    // Seiten vor der Anmeldung haben keine Portalhülle und keinen Titel.
    publicPages: new Set<string>(),
  },
  {
    prefix: "school:",
    root: resolve(SRC_ROOT, "app/school"),
    publicPages: new Set(["/login", "/invite", "/reset-password"]),
  },
] as const;

/**
 * OGS- und Lehrer-Seiten ohne Info-Knopf. Die Liste darf nur schrumpfen: eine
 * neue Seite braucht `info`, und eine Seite, die `info` bekommt, fliegt hier
 * heraus. Lehrer-Seiten tragen das Präfix `school:`.
 */
const PAGES_WITHOUT_INFO_BASELINE: readonly string[] = [
  "/absences",
  "/activities",
  "/admin/change-requests",
  "/admin/enrollments",
  "/admin/enrollments/[id]",
  "/admin/enrollments/change-requests",
  "/admin/enrollments/change-requests/[id]",
  "/admin/enrollments/phases/[phaseId]",
  "/admin/guardian-approvals",
  "/anfragen",
  "/betreuungsplan",
  "/calendar-periods",
  "/care-offerings",
  "/dashboard",
  "/database/absence-types",
  "/database/activities",
  "/database/categories",
  "/database/devices",
  "/database/exports",
  "/database/grade-transitions",
  "/database/groups",
  "/database/permissions",
  "/database/personal",
  "/database/personal/import",
  "/database/personal/opening-balances",
  "/database/planning-tracks",
  "/database/qualification-types",
  "/database/roles",
  "/database/rooms",
  "/database/shift-types",
  "/database/students",
  "/database/students/class-list",
  "/database/students/class-list/import",
  "/database/students/ended-care",
  "/database/students/import",
  "/database/work-time-models",
  "/dateien",
  "/day-log",
  "/dienstplan",
  "/eltern/bankverbindungen",
  "/emergency",
  "/enrollment-form",
  "/enrollment-phases",
  "/enrollment-phases/[id]/review",
  "/enrollment-phases/[id]/rollover",
  "/info-displays",
  "/lists",
  "/meal-plan",
  "/messages",
  "/messages/[threadId]",
  "/messages/groups",
  "/messages/groups/[groupThreadId]",
  "/parent-announcements/[id]",
  "/parent-attention/[studentId]",
  "/payroll",
  "/profile",
  "/reminders",
  "/rooms/[id]",
  "/rooms/unterwegs",
  "/settings",
  "/staff",
  "/staff/[id]",
  "/statistics",
  "/students/[id]/change-history",
  "/students/[id]/feedback-history",
  "/students/[id]/room-history",
  "/students/[id]/unfallanzeigen/[reportId]",
  "/substitutions",
  "/tagesinformationen",
  "/umfragen/[id]",
  "/vertretung",
  "/wochenprotokolle/[protocolId]",
  "school:/aufsichten",
  "school:/einstellungen",
  "school:/elternbriefe/[id]",
  "school:/klasse",
  "school:/klasse/kind",
  "school:/tagesinformationen",
];

/** Die Einstiegsseiten der Betreuung, die #7565 erklärt. */
const FIRST_WEEK_PAGES = [
  "/tagesplan",
  "/ogs-groups",
  "/students/search",
  "/active-supervisions",
  "/rooms",
  "/time-tracking",
  "/calendar",
  "/mein-dienstplan",
  "/students/[id]",
];

function collectPageFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      // Slot-Seiten überlagern eine kanonische Seite, die selbst zählt.
      return entry.name.startsWith("@") ? [] : collectPageFiles(path);
    }
    return entry.name === "page.tsx" ? [path] : [];
  });
}

function routeOf(root: string, file: string): string {
  const pagePath = relative(root, file).split(sep).join("/");
  const route = pagePath.slice(0, -"/page.tsx".length);
  return route === "page.tsx" ? "/" : `/${route}`;
}

const MODULE_EXTENSIONS = [".tsx", ".ts", "/index.tsx", "/index.ts"];

/** Löst eine Projekt-Import-Quelle auf; Pakete und der UI-Kit zählen nicht. */
function resolveImport(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("~/") || specifier.startsWith("@/")) {
    base = resolve(SRC_ROOT, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = resolve(dirname(fromFile), specifier);
  } else {
    return null;
  }
  for (const extension of MODULE_EXTENSIONS) {
    const candidate = base + extension;
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate.startsWith(KIT_ROOT + sep) ? null : candidate;
    }
  }
  return null;
}

interface ParsedModule {
  readonly rendersTenantPage: boolean;
  readonly hasInfo: boolean;
  readonly imports: readonly string[];
}

const parsedModules = new Map<string, ParsedModule>();

function parseModule(file: string): ParsedModule {
  const cached = parsedModules.get(file);
  if (cached) return cached;
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let rendersTenantPage = false;
  let hasInfo = false;
  const imports: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      !(ts.isImportDeclaration(node) && node.importClause?.isTypeOnly)
    ) {
      const target = resolveImport(file, node.moduleSpecifier.text);
      if (target) imports.push(target);
    }
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(source) === "TenantPage"
    ) {
      rendersTenantPage = true;
      if (
        node.attributes.properties.some(
          (attribute) =>
            ts.isJsxAttribute(attribute) &&
            attribute.name.getText(source) === "info",
        )
      ) {
        hasInfo = true;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const parsed = { rendersTenantPage, hasInfo, imports };
  parsedModules.set(file, parsed);
  return parsed;
}

/**
 * Eine Seite rendert ihr Gerüst selbst oder über eine View-Komponente. Der
 * Test folgt den Importen Ebene für Ebene bis zur ersten, auf der ein Modul
 * `TenantPage` rendert, und fragt nur diese Module nach `info`. Tiefer liegende
 * Gerüste gehören zu anderen Seiten.
 */
function pageHasInfo(pageFile: string): boolean {
  const seen = new Set([pageFile]);
  let level = [pageFile];
  for (let depth = 0; depth < 4 && level.length > 0; depth++) {
    const renderers = level.filter(
      (file) => parseModule(file).rendersTenantPage,
    );
    if (renderers.length > 0) {
      return renderers.some((file) => parseModule(file).hasInfo);
    }
    level = level
      .flatMap((file) => parseModule(file).imports)
      .filter((file) => {
        if (seen.has(file)) return false;
        seen.add(file);
        return true;
      });
  }
  return false;
}

const pages = PORTALS.flatMap(({ prefix, root, publicPages }) =>
  collectPageFiles(root)
    .map((file) => ({ id: `${prefix}${routeOf(root, file)}`, file }))
    .filter(({ id }) => !publicPages.has(id.slice(prefix.length))),
);

describe("Info-Knopf am Seitentitel (#7565)", () => {
  it("findet OGS- und Lehrer-Seiten", () => {
    expect(
      pages.filter(({ id }) => !id.startsWith("school:")).length,
    ).toBeGreaterThanOrEqual(90);
    expect(
      pages.filter(({ id }) => id.startsWith("school:")).length,
    ).toBeGreaterThanOrEqual(12);
  });

  it("hält die Seiten ohne Info-Knopf auf einer schrumpfenden Liste", () => {
    const withoutInfo = pages
      .filter(({ file }) => !pageHasInfo(file))
      .map(({ id }) => id)
      .sort();

    expect(withoutInfo).toEqual([...PAGES_WITHOUT_INFO_BASELINE].sort());
  });

  it("erklärt die Einstiegsseiten der Betreuung", () => {
    const missing = FIRST_WEEK_PAGES.filter((route) =>
      PAGES_WITHOUT_INFO_BASELINE.includes(route),
    );
    expect(missing).toEqual([]);
    for (const route of FIRST_WEEK_PAGES) {
      expect(pages.some(({ id }) => id === route)).toBe(true);
    }
  });
});
