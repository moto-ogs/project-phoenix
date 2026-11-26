"use client";

/**
 * The only SWR configuration code outside ~/lib/swr may set (#5007). SWR's
 * own SWRConfig hands out the cache and a raw mutate (`defaultValue`,
 * `provider`); these components take data or nothing, never a cache.
 */

// swr/no-direct-import permits package imports inside this shared wrapper only.
import { SWRConfig } from "swr";
import { useLayoutEffect, useState, type ReactNode } from "react";

/**
 * Server seeds of the session's shell under their full scoped keys:
 * `fallback` for the first render, `cacheData` as the mount revalidation.
 * Stamp them with stampSWRSeeds; the read side shows unstamped values only
 * under the fallback rules of the generation lock.
 */
export function SWRSeedBoundary({
  seed,
  children,
}: Readonly<{
  seed: {
    fallback: Record<string, unknown>;
    cacheData: Record<string, unknown>;
  };
  children: ReactNode;
}>) {
  // Copied, never passed on: an object that carries `use` or `provider`
  // besides the seed would reach SWR's configuration (#5007).
  return (
    <SWRConfig value={{ fallback: seed.fallback, cacheData: seed.cacheData }}>
      {children}
    </SWRConfig>
  );
}

/**
 * A subtree with its own empty cache: nothing it loads is shared with the
 * portal, and every new reveal (a remount or a restored Activity) must read
 * again. Used for data that requires an audited read before every disclosure.
 */
export function IsolatedSWRCache({
  children,
}: Readonly<{ children: ReactNode }>) {
  const [reveal, setReveal] = useState(0);
  // Activity disconnects layout effects but retains state and DOM. Replace
  // the whole provider on return: a pending answer may still resolve into the
  // old isolated map, but it cannot fill the new one.
  useLayoutEffect(() => () => setReveal((current) => current + 1), []);
  return (
    <SWRConfig key={reveal} value={{ provider: () => new Map() }}>
      {children}
    </SWRConfig>
  );
}
