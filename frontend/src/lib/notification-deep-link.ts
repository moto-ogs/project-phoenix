import { tenantAwarePath } from "~/lib/tenant-path";

/**
 * Ein Deep Link einer Benachrichtigung ist nur dann ein Ziel, wenn er auf
 * dieselbe Herkunft zeigt: ein Pfad mit genau einem führenden Schrägstrich,
 * den der URL-Parser nicht auf einen anderen Host auflöst. Toast (#1624) und
 * Glocke (#7148) prüfen damit dieselbe Regel.
 */
export function isSafeAppRelativePath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//")) return false;

  try {
    return (
      new URL(path, window.location.origin).origin === window.location.origin
    );
  } catch {
    // A path the URL parser rejects is not safe to navigate to.
    return false;
  }
}

export function tenantNotificationPath(
  path: string,
  tenantSlug: string | undefined,
  hostname: string,
): string {
  const routingMode =
    tenantSlug && hostname.startsWith(`${tenantSlug}.`) ? "subdomain" : "path";
  return tenantAwarePath(path, tenantSlug, routingMode);
}
