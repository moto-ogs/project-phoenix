"use client";

import type { Session } from "next-auth";
import { useSession } from "next-auth/react";
import { redirect, usePathname } from "next/navigation";
import { PORTAL_FRAME } from "~/components/auth/portal-frame";
import { Loading } from "~/components/ui/loading";
import { PORTAL_ROUTES, type HostedPortalKey } from "~/lib/portal-paths";

export function FullPageLoading({ message }: { readonly message?: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4">
      <Loading fullPage message={message} />
    </div>
  );
}

/**
 * The client-side guard every portal on its own host shares. Other portals'
 * tokens never reach it (host-only cookies plus the proxy), so it only
 * renders public pages as they are, sends a visitor without a session or
 * with a session of another scope away, waits for the session and then
 * renders the signed-in portal through `renderShell`.
 */
export function PortalAuthGuard({
  portal,
  publicPages,
  wrongScope,
  endedSessionRedirect,
  loading = "full-page",
  loadingMessage,
  renderShell,
  children,
}: {
  readonly portal: HostedPortalKey;
  /** Pages without a session, without the portal prefix; each matches with
   * and without it and covers its subpaths. */
  readonly publicPages: readonly string[];
  /** Where a session of another scope goes: the root or the login page. */
  readonly wrongScope: "root" | "login";
  /** Where a session of the portal's scope goes that can no longer be used;
   * null keeps it. Without it the guard does not look at the session's
   * error. */
  readonly endedSessionRedirect?: (session: Session) => string | null;
  /** "shell" renders the portal while the session loads. */
  readonly loading?: "full-page" | "shell";
  readonly loadingMessage?: string;
  readonly renderShell: (
    page: React.ReactNode,
    session: Session | null,
  ) => React.ReactNode;
  readonly children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const frame = PORTAL_FRAME[portal];
  const prefix = PORTAL_ROUTES[portal].appPrefix;
  const isPublicPage = publicPages.some((page) =>
    [page, `${prefix}${page}`].some(
      (p) => pathname === p || pathname.startsWith(`${p}/`),
    ),
  );

  if (isPublicPage) {
    return <>{children}</>;
  }

  const loginHref = () => frame.path(`${prefix}/login`);
  if (status === "authenticated") {
    if (session?.user?.scope !== frame.scope) {
      redirect(wrongScope === "root" ? "/" : loginHref());
    } else {
      const target = endedSessionRedirect?.(session);
      if (target) redirect(target);
    }
  }
  if (status === "unauthenticated") {
    redirect(loginHref());
  }

  if (status === "loading" && loading === "full-page") {
    return <FullPageLoading message={loadingMessage} />;
  }

  return renderShell(children, session ?? null);
}
