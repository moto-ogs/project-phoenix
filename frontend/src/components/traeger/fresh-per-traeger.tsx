"use client";

import { useSession } from "next-auth/react";
import { Fragment, type ReactNode } from "react";

/**
 * Starts `children` afresh for each signed-in Träger. The cache keys keep
 * the data of two Träger apart, but a choice in page state (a school, a
 * template) made under the previous one must not go into the requests of
 * the next one.
 */
export function FreshPerTraeger({
  children,
}: Readonly<{ children: ReactNode }>) {
  const { data: session } = useSession();
  return <Fragment key={session?.user?.orgId ?? "none"}>{children}</Fragment>;
}
