import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { bffPath, type Portal } from "~/lib/bff-fetch";
import {
  portalRoutes,
  routeFileRoutes,
} from "~/lib/contract/portals.generated";

const src = path.resolve(__dirname, "../..");

// These names must not come back as imports, declarations or property calls,
// even in a route that does more than forwarding or builds its path elsewhere.
const retired = new Set([
  ...["Get", "Post", "Put", "Patch", "Delete", "File", "Upload"].map(
    (suffix) => "proxy" + suffix,
  ),
  ["json", "Proxy"].join(""),
  ["forwardTo", "Backend"].join(""),
  ...["Get", "Post", "Delete"].map((suffix) => "operatorApi" + suffix),
]);

const filePatterns = new Set<string>();
for (const table of [portalRoutes, routeFileRoutes]) {
  for (const [portal, routes] of Object.entries(table)) {
    for (const route of routes) {
      if (!("kind" in route.response) || route.response.kind !== "file")
        continue;
      // Mark parameters before building the proxy URL without a real ID.
      const params = Object.fromEntries(
        [...route.pattern.matchAll(/\{([^}]+)\}/g)].map((match) => [
          match[1],
          "__file_param__",
        ]),
      );
      const url = bffPath(portal as Portal, route.pattern, params);
      for (const pattern of [
        url,
        route.pattern.replace(/\{[^}]+\}/g, "__file_param__"),
      ]) {
        filePatterns.add(pattern.replace(/\/$/, ""));
      }
    }
  }
}
const filePaths = [...filePatterns]
  // A raw backend pathname need not start with /api. Those can also be
  // frontend page paths, so only check them when passed to the URL builder.
  .map((pattern) => ({
    bff: pattern.startsWith("/api/"),
    match: new RegExp(
      "^" +
        pattern
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          .replaceAll("__file_param__", "[^/]+") +
        "/?$",
    ),
  }));

/** Collapse literal concatenations and templates without knowing parameter values. */
function urlShape(node: ts.Node): string {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return urlShape(node.expression);
  if (ts.isTemplateExpression(node)) {
    return (
      node.head.text +
      node.templateSpans
        .map(({ expression, literal }) => urlShape(expression) + literal.text)
        .join("")
    );
  }
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    return urlShape(node.left) + urlShape(node.right);
  }
  return "__file_param__";
}

function violations(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const findings: string[] = [];
  const report = (node: ts.Node, message: string) => {
    const { line } = source.getLineAndCharacterOfPosition(
      node.getStart(source),
    );
    findings.push(`${line + 1}: ${message}`);
  };
  const isFile = (value: string, buildingUrl = false) => {
    const pathname = value.split(/[?#]/, 1)[0]!;
    return filePaths.some(
      ({ bff, match }) => (bff || buildingUrl) && match.test(pathname),
    );
  };
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && retired.has(node.text)) {
      report(node, `retired route helper: ${node.text}`);
    }
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateExpression(node) ||
      ts.isBinaryExpression(node)
    ) {
      const call = node.parent;
      const buildingUrl =
        ts.isCallExpression(call) &&
        ts.isIdentifier(call.expression) &&
        call.expression.text === "bffPath";
      if (isFile(urlShape(node), buildingUrl)) {
        report(node, "use a registered file route with bffFileHref or bffFile");
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

describe("BFF routes use the generated contract", () => {
  it("rejects a retired helper even with custom code and a computed endpoint", () => {
    const helper = ["proxy", "Get"].join("");
    const source = `
      import { ${helper} as forward } from "~/lib/route-wrapper.server";
      const endpoint = buildPath();
      export const GET = forward(endpoint);
    `;
    expect(violations("route.ts", source)).toEqual([
      `2: retired route helper: ${helper}`,
    ]);
  });

  it("rejects both a manually written file URL and a raw file pattern", () => {
    const source = [
      "const link = `/api/staff/${staffId}/documents/${docId}/download`;",
      'const logo = bffPath("org", "/traeger/master-data/logo");',
      'const pdf = "/api/week-protocols/" + id + "/pdf";',
      'const typed = bffFileHref("platform", "GET /operator/unrelated");',
    ].join("\n");
    expect(violations("links.ts", source)).toEqual([
      "1: use a registered file route with bffFileHref or bffFile",
      "2: use a registered file route with bffFileHref or bffFile",
      "3: use a registered file route with bffFileHref or bffFile",
    ]);
  });

  it("finds no retired route helpers or handwritten file URLs in production source", () => {
    const findings = readdirSync(src, { recursive: true, encoding: "utf8" })
      .filter(
        (name) =>
          /\.tsx?$/.test(name) &&
          !/\.(?:generated|test|stories|d)\.tsx?$/.test(name) &&
          !name.startsWith("test/"),
      )
      .flatMap((name) => {
        const text = readFileSync(path.join(src, name), "utf8");
        if (
          !text.includes("/api/") &&
          !text.includes("bffPath") &&
          ![...retired].some((helper) => text.includes(helper))
        )
          return [];
        return violations(name, text).map((finding) => `${name}:${finding}`);
      });
    expect(findings).toEqual([]);
  });
});
