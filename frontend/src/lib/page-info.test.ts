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
  "/calendar-periods",
  "/dashboard",
  "/dateien",
  "/day-log",
  "/emergency",
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

/**
 * Seiten ohne eigenen Seitenkopf: Sie leiten nur weiter und zeigen nie einen
 * Titel, an dem ein Info-Knopf stehen könnte. Sie fallen aus der Prüfung; der
 * Test unten verlangt, dass sie weiterhin kein Seitengerüst rendern.
 */
const PAGES_WITHOUT_OWN_HEAD: Readonly<Record<string, string>> = {
  "/admin/change-requests": "Leitet zu /anfragen weiter (#2429).",
  "/admin/enrollments/change-requests": "Leitet zu /anfragen weiter (#2429).",
};

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
  "/dienstplan", // Der Modulwächter erhält den Hinweis über seine Eigenschaft.
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
  readonly info: ModuleInfo;
  readonly imports: readonly string[];
  /** Was dieses Modul den importierten Komponenten als `info` mitgibt. */
  readonly infoSupplies: ReadonlyMap<string, ModuleInfo>;
}

type InfoAvailability = "none" | "conditional" | "always";

/**
 * „forwarded“: das Modul reicht die `info` seiner Aufrufer durch, etwa
 * `info={info}` oder `info={intro.info}`. Was dort ankommt, entscheidet die
 * Seite, die das Modul rendert.
 */
type ModuleInfo = InfoAvailability | "forwarded";

const parsedModules = new Map<string, ParsedModule>();

function combineConditionalBranches(
  left: InfoAvailability,
  right: InfoAvailability,
): InfoAvailability {
  return left === right ? left : "conditional";
}

function combineRendererAvailability<T extends ModuleInfo>(
  left: T,
  right: T,
): T | "conditional" {
  return left === right ? left : "conditional";
}

/**
 * `info` oder `intro.info` aus den Eigenschaften des Moduls. Eine lokale
 * Konstante (`copy.info`) ist kein Durchreichen, sie wird aufgelöst.
 */
function isForwardedInfo(
  expression: ts.Expression,
  constants: ReadonlyMap<string, ts.Expression>,
): boolean {
  if (ts.isIdentifier(expression)) {
    return expression.text === "info" && !constants.has("info");
  }
  return (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === "info" &&
    ts.isIdentifier(expression.expression) &&
    !constants.has(expression.expression.text)
  );
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
  // Weitergereichte `info` löst `infoAttributeAvailability` über die Aufrufer
  // auf. Bleibt sie innerhalb eines Ausdrucks stehen, zählt sie nicht.
  if (ts.isIdentifier(expression) && isForwardedInfo(expression, constants)) {
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
): ModuleInfo {
  if (!attribute.initializer) return "none";
  if (ts.isStringLiteral(attribute.initializer)) {
    return attribute.initializer.text.trim() === "" ? "none" : "always";
  }
  if (ts.isJsxExpression(attribute.initializer)) {
    const expression = attribute.initializer.expression;
    if (!expression) return "none";
    return isForwardedInfo(expression, constants)
      ? "forwarded"
      : infoAvailability(expression, constants);
  }
  return "always";
}

/**
 * `info` an einer Komponente, die ihr Gerüst weiter unten rendert: direkt als
 * `info` oder im Kopf-Objekt `intro={{ title, info }}` der
 * Datenverwaltungs-Seiten.
 */
function suppliedInfo(
  attributes: ts.JsxAttributes,
  constants: ReadonlyMap<string, ts.Expression>,
): ModuleInfo {
  for (const attribute of attributes.properties) {
    if (!ts.isJsxAttribute(attribute)) continue;
    const name = attribute.name.getText();
    if (name === "info") {
      return infoAttributeAvailability(attribute, constants);
    }
    const expression =
      name === "intro" &&
      attribute.initializer &&
      ts.isJsxExpression(attribute.initializer)
        ? attribute.initializer.expression
        : undefined;
    if (expression && ts.isObjectLiteralExpression(expression)) {
      for (const property of expression.properties) {
        if (ts.isShorthandPropertyAssignment(property)) {
          if (property.name.text === "info") {
            return constants.has("info")
              ? infoAvailability(property.name, constants)
              : "forwarded";
          }
        } else if (
          ts.isPropertyAssignment(property) &&
          property.name.getText() === "info"
        ) {
          return isForwardedInfo(property.initializer, constants)
            ? "forwarded"
            : infoAvailability(property.initializer, constants);
        }
      }
    }
  }
  return "none";
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
  let info: ModuleInfo | undefined;
  const imports: string[] = [];
  // Lokaler Name einer importierten Komponente -> ihr Modul.
  const importedComponents = new Map<string, string>();
  const infoSupplies = new Map<string, ModuleInfo>();
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
      if (target) {
        imports.push(target);
        const clause = ts.isImportDeclaration(node)
          ? node.importClause
          : undefined;
        if (clause?.name) importedComponents.set(clause.name.text, target);
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) {
            importedComponents.set(element.name.text, target);
          }
        }
      }
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
    } else if (
      ts.isJsxOpeningElement(node) ||
      ts.isJsxSelfClosingElement(node)
    ) {
      const target = importedComponents.get(node.tagName.getText(source));
      if (target) {
        const supplied = suppliedInfo(node.attributes, constants);
        const previous = infoSupplies.get(target);
        infoSupplies.set(
          target,
          previous ? combineRendererAvailability(previous, supplied) : supplied,
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const parsed = {
    rendersTenantPage,
    info: info ?? "none",
    imports,
    infoSupplies,
  };
  parsedModules.set(file, parsed);
  return parsed;
}

/**
 * Eine Seite rendert ihr Gerüst selbst oder über eine View-Komponente. Der
 * Test folgt den Importen Ebene für Ebene bis zur ersten, auf der ein Modul
 * `TenantPage` rendert, und fragt nur diese Module nach `info`. Tiefer liegende
 * Gerüste gehören zu anderen Seiten. Reicht ein Gerüst-Modul `info` nur durch
 * (`CatalogPage`, `DatabasePageLayout`, Modulwächter), zählt, was seine
 * Aufrufer auf dem Weg von der Seite dorthin mitgeben.
 */
// Tiefste Importebene, auf der ein Seitengerüst gesucht wird. Heute rendert
// jede Seite es selbst (Ebene 0) oder in ihrer View (Ebene 1). Liegt es
// tiefer, zählt die Seite als „ohne Info-Knopf“ und steht auf der Liste.
const MAX_IMPORT_DEPTH = 4;

function pageInfoAvailability(pageFile: string): InfoAvailability {
  const seen = new Set([pageFile]);
  // Je Modul die Module der vorigen Ebene, die es importieren.
  const importers = new Map<string, string[]>();

  // Was die Aufrufer eines Moduls als `info` mitgeben. Die Seite selbst hat
  // keinen Aufrufer: bei ihr endet weitergereichte `info` leer.
  const resolve = (file: string, info: ModuleInfo): InfoAvailability => {
    if (info !== "forwarded") return info;
    const callers = importers.get(file) ?? [];
    if (callers.length === 0) return "none";
    return callers
      .map((caller) =>
        resolve(caller, parseModule(caller).infoSupplies.get(file) ?? "none"),
      )
      .reduce((left, right) => combineRendererAvailability(left, right));
  };

  let level = [pageFile];
  for (let depth = 0; depth < MAX_IMPORT_DEPTH && level.length > 0; depth++) {
    const renderers = level.filter(
      (file) => parseModule(file).rendersTenantPage,
    );
    if (renderers.length > 0) {
      return renderers
        .map((file) => resolve(file, parseModule(file).info))
        .reduce((left, right) => combineRendererAvailability(left, right));
    }
    const next: string[] = [];
    for (const file of level) {
      for (const target of parseModule(file).imports) {
        if (!seen.has(target)) {
          seen.add(target);
          next.push(target);
          importers.set(target, [file]);
        } else if (next.includes(target)) {
          importers.get(target)?.push(file);
        }
      }
    }
    level = next;
  }
  return "none";
}

const pages = PORTALS.flatMap(({ prefix, root, publicPages }) =>
  collectPageFiles(root)
    .map((file) => ({ id: `${prefix}${routeOf(root, file)}`, file }))
    .filter(({ id }) => !publicPages.has(id.slice(prefix.length))),
);
const checkedPages = pages.filter(({ id }) => !(id in PAGES_WITHOUT_OWN_HEAD));

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
    const withoutInfo = checkedPages
      .filter(({ file }) => pageInfoAvailability(file) === "none")
      .map(({ id }) => id)
      .sort();

    expect(withoutInfo).toEqual([...PAGES_WITHOUT_INFO_BASELINE].sort());
  });

  it("dokumentiert Zustände ohne Info-Knopf ausdrücklich", () => {
    const conditionalInfo = checkedPages
      .filter(({ file }) => pageInfoAvailability(file) === "conditional")
      .map(({ id }) => id)
      .sort();

    expect(conditionalInfo).toEqual([...PAGES_WITH_CONDITIONAL_INFO].sort());
  });

  it("nimmt nur Seiten ohne eigenen Seitenkopf aus der Prüfung", () => {
    for (const route of Object.keys(PAGES_WITHOUT_OWN_HEAD)) {
      const page = pages.find(({ id }) => id === route);
      expect(page, route).toBeDefined();
      if (!page) continue;
      expect(parseModule(page.file).rendersTenantPage, route).toBe(false);
      expect(parseModule(page.file).imports, route).not.toContainEqual(
        expect.stringContaining("/components/"),
      );
    }
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
