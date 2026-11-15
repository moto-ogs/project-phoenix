/**
 * Matches a browser path against route templates such as `/rooms/:id`.
 *
 * Shared by the usage analytics (`analytics-routes.ts`) and the page titles
 * (`page-titles.ts`): both name every page by its template. A dynamic segment
 * is `:param`, a catch-all `:param*`.
 */

export type RouteTemplateMatcher = (pathname: string) => string | null;

interface CompiledTemplate {
  readonly template: string;
  readonly pattern: RegExp;
}

function segmentPattern(segment: string): string {
  if (segment.startsWith(":")) {
    return segment.endsWith("*") ? "[^/]+(?:/[^/]+)*" : "[^/]+";
  }
  return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Dynamic segments, a catch-all counting as more than any template has. */
function dynamicWeight(template: string): number {
  if (template.includes("*")) return Number.MAX_SAFE_INTEGER;
  return template.split(":").length;
}

/**
 * Static templates win over dynamic ones (`/rooms/unterwegs` before
 * `/rooms/:id`), and a catch-all comes last.
 */
export function createRouteTemplateMatcher(
  templates: readonly string[],
): RouteTemplateMatcher {
  const compiled: readonly CompiledTemplate[] = [...templates]
    .sort((left, right) => dynamicWeight(left) - dynamicWeight(right))
    .map((template) => ({
      template,
      pattern: new RegExp(
        `^${template.split("/").map(segmentPattern).join("/")}$`,
      ),
    }));
  return (pathname) =>
    compiled.find(({ pattern }) => pattern.test(pathname))?.template ?? null;
}

/** The path below `prefix`, `/` for the prefix itself, else null. */
export function pathBelow(pathname: string, prefix: string): string | null {
  if (pathname === prefix) return "/";
  return pathname.startsWith(`${prefix}/`)
    ? pathname.slice(prefix.length)
    : null;
}
