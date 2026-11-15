import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The page tree of the App Router, for the guards that need an entry per
 * page: usage analytics (`analytics-routes.test.ts`) and page titles
 * (`page-titles.test.ts`).
 */
export const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../app",
);

/** Route of every page.tsx below `directory`, as the browser shows it. */
export function collectPageRoutes(
  directory: string,
  skip: ReadonlySet<string> = new Set(),
  prefix: readonly string[] = [],
): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      // Parallel slots reuse canonical routes; they are not full pages.
      if (skip.has(entry.name) || entry.name.startsWith("@")) continue;
      // Route groups such as (public) do not appear in the URL.
      const segment = /^\(.+\)$/.test(entry.name)
        ? []
        : [
            entry.name
              .replace(/^\[\[\.\.\.(.+)]]$/, ":$1*")
              .replace(/^\[\.\.\.(.+)]$/, ":$1*")
              .replace(/^\[(.+)]$/, ":$1"),
          ];
      const nested = collectPageRoutes(
        path.join(directory, entry.name),
        new Set(),
        [...prefix, ...segment],
      );
      routes.push(...nested);
      // An optional catch-all ([[...topic]]) also serves its parent path.
      if (/^\[\[\.\.\..+]]$/.test(entry.name) && nested.length > 0) {
        routes.push(`/${prefix.join("/")}`);
      }
    } else if (entry.name === "page.tsx") {
      routes.push(`/${prefix.join("/")}`);
    }
  }
  return routes;
}
