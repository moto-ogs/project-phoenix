import type { Session } from "next-auth";
import type { PrefetchResource } from "~/components/ui/data-prefetch-intent";
import { canReadStudents } from "~/lib/student-access";
import { groups } from "~/lib/swr/groups";
import { fetchOgsGroupLive } from "~/lib/ogs-group-live-api";

/** Explicit opt-in destinations. Never a URL-to-API conversion or an audited read. */
export async function tenantPrefetchResources(
  href: string,
  context: {
    session: Session;
    slug: string;
    groupId: string | null;
    groups: readonly string[];
  },
): Promise<readonly PrefetchResource[]> {
  if (!href.startsWith("/") || href.startsWith("//")) return [];
  const [pathname, query] = href.split("?");
  const path = pathname?.startsWith(`/${context.slug}/`)
    ? pathname.slice(context.slug.length + 1)
    : pathname;
  const params = new URLSearchParams(query);
  const { session } = context;
  if (session.user.scope && session.user.scope !== "tenant") return [];

  if (path === "/ogs-groups" && canReadStudents(session)) {
    const id = params.get("group") ?? context.groupId;
    // Membership/supervision is confirmed by the shell, not inferred from URL.
    if (id ? !context.groups.includes(id) : context.groups.length === 0)
      return [];
    return [{ key: groups.live(id), fetcher: () => fetchOgsGroupLive(id) }];
  }
  return [];
}
