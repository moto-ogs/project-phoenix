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
  "school:/einstellungen",
  "school:/elternbriefe/[id]",
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

/**
 * Seiten, deren Info-Knopf nur in einem klar abgegrenzten Zustand fehlt.
 * Diese Ausnahme bleibt sichtbar: eine neue bedingte `info`-Eigenschaft
 * besteht den Wächter nicht stillschweigend.
 */
const PAGES_WITH_CONDITIONAL_INFO: readonly string[] = [
  "/home", // Nur beim Anordnen der Startseite erklärt der Knopf das Verschieben.
  "/mein-dienstplan", // Der Modulwächter erhält den Hinweis über seine Eigenschaft.
  "/parent-announcements", // Die Erklärung richtet sich nach der gewählten Mitteilungsart.
  "/students/[id]", // Ferienkinder haben keine Reiter; der normale Text wäre falsch.
  "/team-chat", // Der Posteingang hat keinen einheitlichen Erklärungstext.
  "/team-chat/[threadID]", // Gesperrte und fehlerhafte Unterhaltungen erklären sich selbst.
  "school:/nachrichten", // Ist der Team-Chat aus, erklärt sich die Seite selbst.
  "school:/nachrichten/[threadID]", // Gesperrte und fehlerhafte Unterhaltungen erklären sich selbst.
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
  readonly info: InfoAvailability;
  readonly imports: readonly string[];
}

type InfoAvailability = "none" | "conditional" | "always";

const parsedModules = new Map<string, ParsedModule>();

function combineConditionalBranches(
  left: InfoAvailability,
  right: InfoAvailability,
): InfoAvailability {
  return left === right ? left : "conditional";
}

function combineRendererAvailability(
  left: InfoAvailability,
  right: InfoAvailability,
): InfoAvailability {
  return left === right ? left : "conditional";
}

function infoAvailability(
  expression: ts.Expression,
  constants: ReadonlyMap<string, ts.Expression>,
  resolving = new Set<string>(),
): InfoAvailability {
  if (
    expression.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(expression) && expression.text === "undefined") ||
    expression.kind === ts.SyntaxKind.TrueKeyword ||
    expression.kind === ts.SyntaxKind.FalseKeyword
  ) {
    return "none";
  }
  // `info` ist die optionale Eigenschaft gemeinsamer Seitengerüste. Ohne
  // Aufrufanalyse kann sie leer sein und zählt deshalb nicht als Erklärung.
  if (ts.isIdentifier(expression) && expression.text === "info") {
    return "none";
  }
  if (ts.isIdentifier(expression)) {
    const initializer = constants.get(expression.text);
    if (!initializer || resolving.has(expression.text)) return "conditional";
    const nextResolving = new Set(resolving);
    nextResolving.add(expression.text);
    return infoAvailability(initializer, constants, nextResolving);
  }
  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  ) {
    return expression.text.trim() === "" ? "none" : "always";
  }
  if (ts.isParenthesizedExpression(expression)) {
    return infoAvailability(expression.expression, constants, resolving);
  }
  if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) {
    return infoAvailability(expression.expression, constants, resolving);
  }
  if (ts.isConditionalExpression(expression)) {
    return combineConditionalBranches(
      infoAvailability(expression.whenTrue, constants, resolving),
      infoAvailability(expression.whenFalse, constants, resolving),
    );
  }
  if (ts.isBinaryExpression(expression)) {
    switch (expression.operatorToken.kind) {
      case ts.SyntaxKind.AmpersandAmpersandToken:
      case ts.SyntaxKind.BarBarToken:
      case ts.SyntaxKind.QuestionQuestionToken:
        return "conditional";
    }
  }
  if (
    ts.isPrefixUnaryExpression(expression) &&
    expression.operator === ts.SyntaxKind.ExclamationToken
  ) {
    return "none";
  }
  if (ts.isJsxElement(expression) || ts.isJsxFragment(expression)) {
    return "always";
  }
  // Nicht statisch auflösbare Werte können leer sein. Sie bleiben als
  // bedingter Zustand sichtbar, statt eine Seite fälschlich abzudecken.
  return "conditional";
}

function infoAttributeAvailability(
  attribute: ts.JsxAttribute,
  constants: ReadonlyMap<string, ts.Expression>,
): InfoAvailability {
  if (!attribute.initializer) return "none";
  if (ts.isStringLiteral(attribute.initializer)) {
    return attribute.initializer.text.trim() === "" ? "none" : "always";
  }
  if (ts.isJsxExpression(attribute.initializer)) {
    return attribute.initializer.expression
      ? infoAvailability(attribute.initializer.expression, constants)
      : "none";
  }
  return "always";
}

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
  let info: InfoAvailability | undefined;
  const imports: string[] = [];
  const constants = new Map<string, ts.Expression>();
  const collectConstants = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      constants.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, collectConstants);
  };
  collectConstants(source);
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
      const infoAttribute = node.attributes.properties.find(
        (attribute): attribute is ts.JsxAttribute =>
          ts.isJsxAttribute(attribute) &&
          attribute.name.getText(source) === "info",
      );
      if (infoAttribute) {
        const currentInfo = infoAttributeAvailability(infoAttribute, constants);
        info = info
          ? combineRendererAvailability(info, currentInfo)
          : currentInfo;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const parsed = { rendersTenantPage, info: info ?? "none", imports };
  parsedModules.set(file, parsed);
  return parsed;
}

/**
 * Eine Seite rendert ihr Gerüst selbst oder über eine View-Komponente. Der
 * Test folgt den Importen Ebene für Ebene bis zur ersten, auf der ein Modul
 * `TenantPage` rendert, und fragt nur diese Module nach `info`. Tiefer liegende
 * Gerüste gehören zu anderen Seiten.
 */
// Tiefste Importebene, auf der ein Seitengerüst gesucht wird. Heute rendert
// jede Seite es selbst (Ebene 0) oder in ihrer View (Ebene 1). Liegt es
// tiefer, zählt die Seite als „ohne Info-Knopf“ und steht auf der Liste.
const MAX_IMPORT_DEPTH = 4;

function pageInfoAvailability(pageFile: string): InfoAvailability {
  const seen = new Set([pageFile]);
  let level = [pageFile];
  for (let depth = 0; depth < MAX_IMPORT_DEPTH && level.length > 0; depth++) {
    const renderers = level.filter(
      (file) => parseModule(file).rendersTenantPage,
    );
    if (renderers.length > 0) {
      const [firstRenderer, ...otherRenderers] = renderers;
      if (!firstRenderer) return "none";
      return otherRenderers.reduce<InfoAvailability>(
        (availability, file) =>
          combineRendererAvailability(availability, parseModule(file).info),
        parseModule(firstRenderer).info,
      );
    }
    level = level
      .flatMap((file) => parseModule(file).imports)
      .filter((file) => {
        if (seen.has(file)) return false;
        seen.add(file);
        return true;
      });
  }
  return "none";
}

const pages = PORTALS.flatMap(({ prefix, root, publicPages }) =>
  collectPageFiles(root)
    .map((file) => ({ id: `${prefix}${routeOf(root, file)}`, file }))
    .filter(({ id }) => !publicPages.has(id.slice(prefix.length))),
);

describe("Info-Knopf am Seitentitel (#7565)", () => {
  // Untergrenzen knapp unter dem Stand vom November 2026 (94 OGS-, 13
  // Lehrer-Seiten): Findet der Test plötzlich kaum Seiten, ist die Suche
  // kaputt und die Liste prüfte nichts mehr.
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
      .filter(({ file }) => pageInfoAvailability(file) === "none")
      .map(({ id }) => id)
      .sort();

    expect(withoutInfo).toEqual([...PAGES_WITHOUT_INFO_BASELINE].sort());
  });

  it("dokumentiert Zustände ohne Info-Knopf ausdrücklich", () => {
    const conditionalInfo = pages
      .filter(({ file }) => pageInfoAvailability(file) === "conditional")
      .map(({ id }) => id)
      .sort();

    expect(conditionalInfo).toEqual([...PAGES_WITH_CONDITIONAL_INFO].sort());
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
