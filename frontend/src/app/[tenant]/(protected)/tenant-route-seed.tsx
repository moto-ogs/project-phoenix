import type { ReactNode } from "react";
import type { ModuleScope } from "~/lib/module-register";
import { seedOf } from "~/lib/server-seed.server";
import { SWRServerSeed, type ServerSeedEntry } from "~/lib/swr/server-seed";
import { readTenantPageContext } from "~/lib/tenant-page-seed.server";

type TenantContext = NonNullable<
  Awaited<ReturnType<typeof readTenantPageContext>>
>;

export async function TenantRouteSeed({
  slug,
  module,
  load,
  children,
}: {
  slug: string;
  module?: ModuleScope;
  load: (context: TenantContext) => readonly ServerSeedEntry[];
  children: ReactNode;
}) {
  const builtAt = Date.now();
  const context = await readTenantPageContext(slug, module).catch(() => null);
  if (!context) return children;

  const entries = load(context);
  const seed = seedOf(context.snapshot, entries, builtAt);
  if (entries.length === 0 || !seed) return children;

  // Offer the exact keys before the client readers mount, even when the
  // page's individual response promises are still in flight.
  return (
    <SWRServerSeed seed={seed} render>
      {children}
    </SWRServerSeed>
  );
}
