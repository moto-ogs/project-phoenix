"use client";

import { createContext, useContext, type ReactNode } from "react";

import { ButtonLink } from "./button";

/**
 * The place where the person fixes a refusal with a known code (#7092),
 * such as the settings entry the message names. Which code leads where, and
 * whether the viewer may go there, depend on the session and the portal, so
 * `components/tenant/` provides the resolver; the kit only leaves a place
 * for the link (#5586). Without a provider, or without the viewer's right,
 * no link shows and the message names who acts.
 */
export interface ErrorFixTarget {
  /** Tenant-aware path of the target page. */
  readonly href: string;
  readonly label: string;
  /** „Öffnet …“, per the jump rule in `jump-button.tsx`. */
  readonly tooltip: string;
}

type ErrorFixResolver = (code: string) => ErrorFixTarget | null;

const ErrorFixContext = createContext<ErrorFixResolver | null>(null);

export function ErrorFixProvider({
  resolve,
  children,
}: {
  readonly resolve: ErrorFixResolver;
  readonly children: ReactNode;
}) {
  return (
    <ErrorFixContext.Provider value={resolve}>
      {children}
    </ErrorFixContext.Provider>
  );
}

/** The link to the place that fixes the refusal `code`, else `undefined`. */
export function useErrorFixLink(code: string | undefined): ReactNode {
  const resolve = useContext(ErrorFixContext);
  const target = code && resolve ? resolve(code) : null;
  if (!target) return undefined;
  return (
    <ButtonLink
      href={target.href}
      variant="surface"
      size="compact"
      tooltip={target.tooltip}
      className="shrink-0 self-start"
    >
      {target.label}
    </ButtonLink>
  );
}
